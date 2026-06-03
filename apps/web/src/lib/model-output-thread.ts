import type {
  AgentOutputEvent,
  ChatAttachment,
  ChatRuntimeActivity,
  ChatRuntimeRef,
  HarnessId,
  RuntimeObjectSource,
  RunRoomFeedRow
} from "@hiveward/shared";
import { isAgentOutputEvent } from "@hiveward/shared";

export type ModelOutputMessageRole = "user" | "assistant" | "system";
export type ModelOutputMessageStatus = "sent" | "streaming" | "failed";

export interface ModelOutputRuntimeStatusView {
  phase: "thinking" | "tool" | "command";
  label: string;
}

export interface ModelOutputThreadMessage {
  id: string;
  sessionId?: string;
  role: ModelOutputMessageRole;
  sourceType?: RunRoomFeedRow["sourceType"];
  displayMode?: RunRoomFeedRow["displayMode"];
  content: string;
  attachments?: ChatAttachment[];
  harnessId?: HarnessId;
  modelId?: string;
  nativeMessageId?: string;
  status?: ModelOutputMessageStatus;
  runtimeRef?: ChatRuntimeRef;
  runtimeStatus?: ModelOutputRuntimeStatusView;
  runtimeActivities?: ChatRuntimeActivity[];
  progressText?: string;
  speakerLabel?: string;
  createdAt: string;
  updatedAt?: string;
}

export function projectModelOutputThread(events: readonly AgentOutputEvent[]): ModelOutputThreadMessage[] {
  return projectAgentOutputEvents(events);
}

export function projectModelOutputThreadFromUnknown(value: unknown): ModelOutputThreadMessage[] {
  const events = Array.isArray(value) ? value.filter(isAgentOutputEvent) : [];
  return projectAgentOutputEvents(events);
}

export function applyAgentOutputEventToThread(
  current: readonly ModelOutputThreadMessage[],
  event: AgentOutputEvent
): ModelOutputThreadMessage[] {
  return projectAgentOutputEvents([...eventsFromThread(current), event]);
}

function projectAgentOutputEvents(events: readonly AgentOutputEvent[]): ModelOutputThreadMessage[] {
  const messages: ModelOutputThreadMessage[] = [];
  let activeAssistantId: string | undefined;

  for (const event of [...events].sort((left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id))) {
    const role = messageRoleForEvent(event);
    if (event.kind === "message_started") {
      const message = toBaseMessage(event, role === "user" ? "user" : "assistant", "streaming");
      messages.push(message);
      if (message.role === "assistant") activeAssistantId = message.id;
      continue;
    }

    if (event.kind === "message_delta") {
      const targetId = activeAssistantId ?? findLastAssistantId(messages);
      if (targetId) {
        updateMessage(messages, targetId, (message) => ({
          ...message,
          content: event.metadata?.replace === true ? event.delta ?? "" : `${message.content}${event.delta ?? ""}`,
          status: "streaming",
          progressText: undefined,
          updatedAt: event.createdAt
        }));
      } else {
        const message = toBaseMessage(event, "assistant", "streaming");
        message.content = event.delta ?? "";
        messages.push(message);
        activeAssistantId = message.id;
      }
      continue;
    }

    if (event.kind === "runtime_state") {
      const targetId = activeAssistantId ?? findLastAssistantId(messages);
      if (!targetId) continue;
      updateMessage(messages, targetId, (message) => updateMessageRuntimeState(message, event));
      continue;
    }

    if (event.kind === "message_completed" || event.kind === "message_failed") {
      const targetId = role === "assistant" ? activeAssistantId ?? findLastAssistantId(messages) : undefined;
      const status: ModelOutputMessageStatus = event.kind === "message_failed" || runtimeExecutionStatus(event) === "failed" || runtimeExecutionStatus(event) === "cancelled"
        ? "failed"
        : "sent";
      if (targetId) {
        updateMessage(messages, targetId, (message) => ({
          ...message,
          content: event.bodyMarkdown ?? (message.content || readRuntimeString(event, "error") || ""),
          status,
          runtimeStatus: undefined,
          runtimeRef: toRuntimeRef(event, message.runtimeActivities ?? message.runtimeRef?.activity),
          updatedAt: event.createdAt
        }));
        activeAssistantId = undefined;
      } else {
        messages.push(toBaseMessage(event, role, status));
      }
    }
  }

  return messages;
}

function findLastAssistantId(messages: readonly ModelOutputThreadMessage[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "assistant") return messages[index]?.id;
  }
  return undefined;
}

function toBaseMessage(
  event: AgentOutputEvent,
  role: ModelOutputMessageRole,
  status: ModelOutputMessageStatus
): ModelOutputThreadMessage {
  return {
    id: event.id,
    sessionId: event.ownerType === "chat_session" ? event.ownerId : undefined,
    role,
    content: event.bodyMarkdown ?? event.delta ?? readRuntimeString(event, "error") ?? "",
    attachments: readAttachments(event),
    harnessId: readHarnessId(event),
    modelId: readMetadataString(event, "modelId"),
    nativeMessageId: readMetadataString(event, "nativeMessageId"),
    status,
    runtimeRef: toRuntimeRef(event),
    createdAt: event.createdAt,
    updatedAt: event.createdAt
  };
}

function updateMessage(
  messages: ModelOutputThreadMessage[],
  id: string,
  update: (message: ModelOutputThreadMessage) => ModelOutputThreadMessage
): void {
  const index = messages.findIndex((message) => message.id === id);
  if (index >= 0) messages[index] = update(messages[index]!);
}

function updateMessageRuntimeState(message: ModelOutputThreadMessage, event: AgentOutputEvent): ModelOutputThreadMessage {
  const activity = toRuntimeActivity(event);
  if (!activity) return message;
  const runtimeActivities = upsertRuntimeActivity(message.runtimeActivities ?? message.runtimeRef?.activity ?? [], activity);
  return {
    ...message,
    runtimeStatus: { phase: activity.phase, label: activity.label },
    runtimeActivities,
    runtimeRef: message.runtimeRef
      ? {
          ...message.runtimeRef,
          activity: runtimeActivities,
          updatedAt: activity.updatedAt
        }
      : undefined,
    updatedAt: event.createdAt
  };
}

function messageRoleForEvent(event: AgentOutputEvent): ModelOutputMessageRole {
  const metadataRole = readMetadataString(event, "role");
  if (metadataRole === "user" || metadataRole === "assistant" || metadataRole === "system") return metadataRole;
  if (event.actorType === "user") return "user";
  if (event.actorType === "system") return "system";
  return "assistant";
}

function toRuntimeActivity(event: AgentOutputEvent): ChatRuntimeActivity | undefined {
  const phase = event.runtimeState?.phase;
  const label = event.runtimeState?.label;
  const source = event.runtimeState?.source;
  if ((phase !== "thinking" && phase !== "tool" && phase !== "command") || typeof label !== "string" || !isRuntimeObjectSource(source)) {
    return undefined;
  }
  const activityStatus = event.runtimeState?.activityStatus;
  return {
    id: readRuntimeString(event, "activityId") ?? `${source}:${phase}:${label}`,
    source,
    phase,
    label,
    status: activityStatus === "started" || activityStatus === "completed" ? activityStatus : "updated",
    updatedAt: readRuntimeString(event, "updatedAt") ?? event.createdAt
  };
}

function toRuntimeRef(event: AgentOutputEvent, activity?: ChatRuntimeActivity[]): ChatRuntimeRef | undefined {
  const taskId = readRuntimeString(event, "taskId");
  const runId = readRuntimeString(event, "runId");
  const sessionKey = readRuntimeString(event, "sessionKey");
  const source = event.runtimeState?.source;
  const status = runtimeExecutionStatus(event);
  const updatedAt = readRuntimeString(event, "updatedAt") ?? event.createdAt;
  if (!taskId || !runId || !sessionKey || !isRuntimeObjectSource(source) || !status) return undefined;
  return {
    taskId,
    runId,
    sessionKey,
    source,
    status,
    updatedAt,
    error: readRuntimeString(event, "error"),
    usage: readRuntimeRecord(event, "usage") as ChatRuntimeRef["usage"],
    timings: readRuntimeRecord(event, "timings") as ChatRuntimeRef["timings"],
    activity: activity?.length ? activity : undefined
  };
}

function runtimeExecutionStatus(event: AgentOutputEvent): ChatRuntimeRef["status"] | undefined {
  const value = event.runtimeState?.status;
  return typeof value === "string" ? value : undefined;
}

function upsertRuntimeActivity(current: ChatRuntimeActivity[], activity: ChatRuntimeActivity): ChatRuntimeActivity[] {
  const index = current.findIndex((item) => item.id === activity.id);
  if (index < 0) return [...current, activity];
  return current.map((item, itemIndex) => itemIndex === index ? { ...item, ...activity } : item);
}

function readAttachments(event: AgentOutputEvent): ChatAttachment[] | undefined {
  const attachments = event.metadata?.attachments;
  return Array.isArray(attachments) ? attachments as ChatAttachment[] : undefined;
}

function readHarnessId(event: AgentOutputEvent): HarnessId | undefined {
  const value = readMetadataString(event, "harnessId");
  return isHarnessId(value) ? value : undefined;
}

function readMetadataString(event: AgentOutputEvent, key: string): string | undefined {
  const value = event.metadata?.[key];
  return typeof value === "string" && value ? value : undefined;
}

function readRuntimeString(event: AgentOutputEvent, key: string): string | undefined {
  const value = event.runtimeState?.[key];
  return typeof value === "string" && value ? value : undefined;
}

function readRuntimeRecord(event: AgentOutputEvent, key: string): Record<string, unknown> | undefined {
  const value = event.runtimeState?.[key];
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function isHarnessId(value: unknown): value is HarnessId {
  return value === "openclaw" ||
    value === "claudeCode" ||
    value === "codex" ||
    value === "google" ||
    value === "cursor" ||
    value === "opencode" ||
    value === "hermes";
}

function isRuntimeObjectSource(value: unknown): value is RuntimeObjectSource {
  return value === "openclaw" ||
    value === "claude" ||
    value === "codex" ||
    value === "google" ||
    value === "cursor" ||
    value === "opencode" ||
    value === "hermes";
}

function eventsFromThread(messages: readonly ModelOutputThreadMessage[]): AgentOutputEvent[] {
  return messages.map((message, index) => ({
    id: message.id,
    ownerType: "chat_session",
    ownerId: message.sessionId ?? "local",
    actorType: message.role === "user" ? "user" : message.role === "system" ? "system" : "worker",
    kind: message.status === "failed" ? "message_failed" : message.status === "streaming" ? "message_started" : "message_completed",
    sequence: index + 1,
    bodyMarkdown: message.content,
    metadata: {
      role: message.role,
      harnessId: message.harnessId,
      modelId: message.modelId,
      nativeMessageId: message.nativeMessageId,
      attachments: message.attachments
    },
    runtimeState: message.runtimeRef ? { ...message.runtimeRef } : undefined,
    createdAt: message.createdAt
  }));
}
