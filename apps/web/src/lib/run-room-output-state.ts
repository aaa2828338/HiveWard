import {
  isCanonicalRunRoomOutputEvent,
  type AgentOutputEvent,
  type BlueprintRunView,
  type ChatRuntimeActivity,
  type ChatRuntimeRef,
  type RunInterjection,
  type RunRoomOutputSnapshot,
  type RunRoomOutputStreamEvent,
  type RuntimeObjectSource
} from "@hiveward/shared";
import type {
  ModelOutputMessageStatus,
  ModelOutputThreadMessage
} from "./model-output-thread";

export type RunRoomOutputStreamState = "idle" | "connecting" | "live" | "error";

export interface RunRoomOutputMessage extends ModelOutputThreadMessage {
  runRoomId: string;
  runRoomInvocationId?: string;
}

export function applyRunRoomOutputStreamEventToRunView(
  runView: BlueprintRunView,
  event: RunRoomOutputStreamEvent
): BlueprintRunView {
  const nextOutput = applyRunRoomOutputStreamEvent(runView.runRoomOutput, event);
  if (nextOutput === runView.runRoomOutput) return runView;
  return {
    ...runView,
    runRoomOutput: nextOutput
  };
}

export function applyRunRoomOutputStreamEvent(
  currentOutput: RunRoomOutputSnapshot | undefined,
  event: RunRoomOutputStreamEvent
): RunRoomOutputSnapshot | undefined {
  if (event.type === "output_snapshot") {
    if (event.output.runRoomId !== event.runRoomId) return currentOutput;
    return normalizeRunRoomOutputSnapshot(event.output);
  }

  if (event.type === "agent_output_event") {
    if (event.event.ownerId !== event.runRoomId) return currentOutput;
    if (!currentOutput) {
      return normalizeRunRoomOutputSnapshot({
        runRoomId: event.runRoomId,
        events: [event.event],
        interjections: []
      });
    }
    if (currentOutput.runRoomId !== event.runRoomId) return currentOutput;
    return normalizeRunRoomOutputSnapshot({
      ...currentOutput,
      events: upsertAgentOutputEvent(currentOutput.events, event.event)
    });
  }

  if (event.type === "run_interjection") {
    if (event.interjection.runRoomId !== event.runRoomId) return currentOutput;
    if (!currentOutput) {
      return normalizeRunRoomOutputSnapshot({
        runRoomId: event.runRoomId,
        events: [],
        interjections: [event.interjection]
      });
    }
    if (currentOutput.runRoomId !== event.runRoomId) return currentOutput;
    return normalizeRunRoomOutputSnapshot({
      ...currentOutput,
      interjections: upsertRunInterjection(currentOutput.interjections, event.interjection)
    });
  }

  return currentOutput;
}

export function buildRunRoomOutputMessagesForDisplay(runView: BlueprintRunView | undefined): RunRoomOutputMessage[] {
  const output = runView?.runRoomOutput;
  if (!output) return [];
  const hideRuntimeOutput = Boolean(runView?.releaseReports?.at(-1));
  const invocationMessages = hideRuntimeOutput
    ? []
    : projectRunRoomInvocationMessages(output).filter(shouldDisplayRunRoomInvocationMessage);
  const interjectionMessages = output.interjections.map((interjection) => projectRunInterjectionMessage(output.runRoomId, interjection));
  return [...invocationMessages, ...interjectionMessages]
    .sort((left, right) => toSortableTimestamp(left.createdAt) - toSortableTimestamp(right.createdAt) || left.id.localeCompare(right.id));
}

function shouldDisplayRunRoomInvocationMessage(message: RunRoomOutputMessage): boolean {
  return message.status === "streaming" || message.content.trim().length > 0;
}

function normalizeRunRoomOutputSnapshot(output: RunRoomOutputSnapshot): RunRoomOutputSnapshot {
  return {
    runRoomId: output.runRoomId,
    events: output.events
      .filter((event) => isCanonicalRunRoomOutputEvent(output.runRoomId, event))
      .sort((left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id)),
    interjections: output.interjections
      .filter((interjection) => interjection.runRoomId === output.runRoomId)
      .sort((left, right) => toSortableTimestamp(left.createdAt) - toSortableTimestamp(right.createdAt) || left.id.localeCompare(right.id))
  };
}

function projectRunRoomInvocationMessages(output: RunRoomOutputSnapshot): RunRoomOutputMessage[] {
  const messagesByInvocation = new Map<string, RunRoomOutputMessage>();

  for (const event of output.events) {
    if (!isCanonicalRunRoomOutputEvent(output.runRoomId, event)) continue;
    const invocationId = event.sourceId!;

    if (event.kind === "runtime_state") {
      const current = messagesByInvocation.get(invocationId);
      if (!current) continue;
      messagesByInvocation.set(invocationId, updateRuntimeState(current, event));
      continue;
    }

    if (event.kind === "message_started") {
      const current = messagesByInvocation.get(invocationId);
      messagesByInvocation.set(invocationId, {
        ...baseRunRoomMessage(output.runRoomId, invocationId, event, "streaming"),
        ...(current ? {
          content: current.content,
          progressText: current.progressText,
          runtimeActivities: current.runtimeActivities,
          runtimeRef: current.runtimeRef,
          runtimeStatus: current.runtimeStatus
        } : {})
      });
      continue;
    }

    if (event.kind === "message_delta") {
      const current = messagesByInvocation.get(invocationId) ?? {
        ...baseRunRoomMessage(output.runRoomId, invocationId, event, "streaming"),
        content: ""
      };
      const rawContent = event.metadata?.replace === true
        ? event.delta ?? ""
        : `${current.progressText ?? current.content}${event.delta ?? ""}`;
      messagesByInvocation.set(invocationId, {
        ...current,
        content: projectRunRoomOutputMarkdown(rawContent),
        status: "streaming",
        progressText: rawContent,
        updatedAt: event.createdAt
      });
      continue;
    }

    if (event.kind === "message_completed" || event.kind === "message_failed") {
      const current = messagesByInvocation.get(invocationId) ?? baseRunRoomMessage(output.runRoomId, invocationId, event, completionStatus(event));
      const rawContent = event.bodyMarkdown ?? current.progressText ?? current.content ?? readRuntimeString(event, "error") ?? "";
      const runtimeActivities: ChatRuntimeActivity[] = [];
      const runtimeRef = toRuntimeRef(event, runtimeActivities) ?? (current.runtimeRef
        ? {
            ...current.runtimeRef,
            activity: undefined,
            updatedAt: event.createdAt
          }
        : undefined);
      messagesByInvocation.set(invocationId, {
        ...current,
        content: projectRunRoomOutputMarkdown(rawContent),
        status: completionStatus(event),
        progressText: undefined,
        runtimeStatus: undefined,
        runtimeActivities: undefined,
        runtimeRef,
        updatedAt: event.createdAt
      });
    }
  }

  return [...messagesByInvocation.values()];
}

function baseRunRoomMessage(
  runRoomId: string,
  runRoomInvocationId: string,
  event: AgentOutputEvent,
  status: ModelOutputMessageStatus
): RunRoomOutputMessage {
  const rawBodyMarkdown = event.bodyMarkdown ?? readRuntimeString(event, "error") ?? "";
  return {
    id: `run-room-output-${runRoomInvocationId}`,
    runRoomId,
    runRoomInvocationId,
    role: "assistant",
    content: event.kind === "message_started" || event.kind === "message_delta"
      ? ""
      : projectRunRoomOutputMarkdown(rawBodyMarkdown),
    status,
    runtimeRef: toRuntimeRef(event),
    speakerLabel: speakerLabelForEvent(event),
    createdAt: event.createdAt,
    updatedAt: event.createdAt
  };
}

function projectRunRoomOutputMarkdown(rawContent: string): string {
  const trimmed = rawContent.trim();
  if (!trimmed) return "";

  const directMarkdown = extractHumanMarkdownFromJsonText(trimmed);
  if (directMarkdown !== undefined) return directMarkdown;

  const concatenatedMarkdown = extractConcatenatedHumanMarkdown(trimmed);
  if (concatenatedMarkdown !== undefined) {
    const joinedMarkdown = concatenatedMarkdown.filter((item) => item.trim()).join("\n\n").trim();
    if (joinedMarkdown) return joinedMarkdown;
    if (looksLikeRunRoomOutputEnvelope(trimmed)) return "";
  }

  const partialMarkdown = extractPartialHumanMarkdown(trimmed);
  if (partialMarkdown !== undefined) return partialMarkdown;

  return looksLikeRunRoomOutputEnvelope(trimmed) ? "" : rawContent;
}

function extractHumanMarkdownFromJsonText(text: string): string | undefined {
  try {
    return extractHumanMarkdownFromJsonValue(JSON.parse(text));
  } catch {
    return undefined;
  }
}

function extractHumanMarkdownFromJsonValue(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const parts = value
      .map((item) => extractHumanMarkdownFromJsonValue(item))
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0);
    return parts.length > 0 ? parts.join("\n\n") : undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  const report = (value as Record<string, unknown>).humanReportMd;
  return typeof report === "string" ? report.trim() : undefined;
}

function extractConcatenatedHumanMarkdown(text: string): string[] | undefined {
  const parts: string[] = [];
  let index = 0;
  let parsedAny = false;

  while (index < text.length) {
    while (index < text.length && /\s/.test(text[index]!)) index += 1;
    if (index >= text.length) return parsedAny ? parts : undefined;
    if (text[index] !== "{") return parsedAny ? parts : undefined;

    const endIndex = findJsonObjectEnd(text, index);
    if (endIndex === undefined) {
      const partialMarkdown = extractPartialHumanMarkdown(text.slice(index));
      if (partialMarkdown !== undefined) parts.push(partialMarkdown);
      return parsedAny || looksLikeRunRoomOutputEnvelope(text) ? parts : undefined;
    }

    const markdown = extractHumanMarkdownFromJsonText(text.slice(index, endIndex + 1));
    parsedAny = true;
    if (markdown !== undefined) parts.push(markdown);
    index = endIndex + 1;
  }

  return parsedAny ? parts : undefined;
}

function extractPartialHumanMarkdown(text: string): string | undefined {
  if (!looksLikeRunRoomOutputEnvelope(text)) return undefined;
  const keyIndex = text.indexOf("\"humanReportMd\"");
  if (keyIndex < 0) return undefined;
  const colonIndex = text.indexOf(":", keyIndex + "\"humanReportMd\"".length);
  if (colonIndex < 0) return "";
  let index = colonIndex + 1;
  while (index < text.length && /\s/.test(text[index]!)) index += 1;
  if (text[index] !== "\"") return "";
  return readPartialJsonString(text, index + 1).trimStart();
}

function readPartialJsonString(text: string, startIndex: number): string {
  let output = "";
  for (let index = startIndex; index < text.length; index += 1) {
    const char = text[index]!;
    if (char === "\"") return output;
    if (char !== "\\") {
      output += char;
      continue;
    }

    const escaped = text[index + 1];
    if (escaped === undefined) return output;
    index += 1;
    if (escaped === "n") output += "\n";
    else if (escaped === "r") output += "\r";
    else if (escaped === "t") output += "\t";
    else if (escaped === "b") output += "\b";
    else if (escaped === "f") output += "\f";
    else if (escaped === "\"" || escaped === "\\" || escaped === "/") output += escaped;
    else if (escaped === "u") {
      const hex = text.slice(index + 1, index + 5);
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) return output;
      output += String.fromCharCode(Number.parseInt(hex, 16));
      index += 4;
    }
  }
  return output;
}

function findJsonObjectEnd(text: string, startIndex: number): number | undefined {
  let depth = 0;
  let inString = false;
  let escaping = false;

  for (let index = startIndex; index < text.length; index += 1) {
    const char = text[index]!;
    if (inString) {
      if (escaping) {
        escaping = false;
      } else if (char === "\\") {
        escaping = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  return undefined;
}

function looksLikeRunRoomOutputEnvelope(text: string): boolean {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return false;
  return trimmed.includes("humanReportMd") ||
    trimmed.includes("\"handoffJson\"") ||
    (trimmed.includes("\"result\"") && trimmed.includes("\"artifacts\""));
}

function projectRunInterjectionMessage(runRoomId: string, interjection: RunInterjection): RunRoomOutputMessage {
  return {
    id: `run-room-interjection-${interjection.id}`,
    runRoomId,
    role: "user",
    content: interjection.messageMarkdown,
    status: "sent",
    speakerLabel: "You",
    createdAt: interjection.createdAt,
    updatedAt: interjection.createdAt
  };
}

function updateRuntimeState(message: RunRoomOutputMessage, event: AgentOutputEvent): RunRoomOutputMessage {
  const activity = toRuntimeActivity(event);
  if (!activity) return message;
  const currentActivities = message.runtimeActivities ?? message.runtimeRef?.activity ?? [];
  const runtimeActivities = activeRuntimeActivities(upsertRuntimeActivity(currentActivities, activity));
  const activeActivity = [...runtimeActivities].reverse().find(isActiveRuntimeActivity);
  const runtimeRef = toRuntimeRef(event, runtimeActivities) ?? (message.runtimeRef
    ? {
        ...message.runtimeRef,
        activity: runtimeActivities.length > 0 ? runtimeActivities : undefined,
        updatedAt: activity.updatedAt
      }
    : undefined);
  return {
    ...message,
    runtimeStatus: activeActivity ? { phase: activeActivity.phase, label: activeActivity.label } : undefined,
    runtimeActivities: runtimeActivities.length > 0 ? runtimeActivities : undefined,
    runtimeRef,
    updatedAt: event.createdAt
  };
}

function toRuntimeActivity(event: AgentOutputEvent): ChatRuntimeActivity | undefined {
  const phase = event.runtimeState?.phase;
  const label = event.runtimeState?.label;
  const source = event.runtimeState?.source;
  if ((phase !== "thinking" && phase !== "tool" && phase !== "command") || typeof label !== "string" || !isRuntimeObjectSource(source)) {
    return undefined;
  }
  const activityStatus = event.runtimeState?.activityStatus ?? event.runtimeState?.status;
  return {
    id: readRuntimeString(event, "activityId") ?? readRuntimeString(event, "id") ?? `${source}:${phase}:${label}`,
    source,
    phase,
    label,
    status: runtimeActivityStatus(activityStatus),
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

function completionStatus(event: AgentOutputEvent): ModelOutputMessageStatus {
  if (event.kind === "message_failed") return "failed";
  const status = runtimeExecutionStatus(event);
  return status === "failed" || status === "cancelled" ? "failed" : "sent";
}

function runtimeExecutionStatus(event: AgentOutputEvent): ChatRuntimeRef["status"] | undefined {
  const value = event.runtimeState?.status;
  return typeof value === "string" ? value : undefined;
}

function speakerLabelForEvent(event: AgentOutputEvent): string {
  if (event.actorType === "manager") return "Manager";
  if (event.actorType === "worker") return "Worker";
  if (event.actorType === "system") return "System";
  return "Assistant";
}

function upsertAgentOutputEvent(current: readonly AgentOutputEvent[], event: AgentOutputEvent): AgentOutputEvent[] {
  const index = current.findIndex((candidate) => candidate.id === event.id);
  if (index === -1) return [...current, event];
  return current.map((candidate, candidateIndex) => candidateIndex === index ? event : candidate);
}

function upsertRunInterjection(current: readonly RunInterjection[], interjection: RunInterjection): RunInterjection[] {
  const index = current.findIndex((candidate) => candidate.id === interjection.id);
  if (index === -1) return [...current, interjection];
  return current.map((candidate, candidateIndex) => candidateIndex === index ? interjection : candidate);
}

function upsertRuntimeActivity(current: ChatRuntimeActivity[], activity: ChatRuntimeActivity): ChatRuntimeActivity[] {
  const index = current.findIndex((item) => item.id === activity.id);
  if (index < 0) return [...current, activity];
  return current.map((item, itemIndex) => itemIndex === index ? { ...item, ...activity } : item);
}

function activeRuntimeActivities(activities: ChatRuntimeActivity[]): ChatRuntimeActivity[] {
  return activities.filter(isActiveRuntimeActivity);
}

function isActiveRuntimeActivity(activity: ChatRuntimeActivity): boolean {
  return activity.status !== "completed";
}

function runtimeActivityStatus(value: unknown): ChatRuntimeActivity["status"] {
  if (value === "started") return "started";
  if (isTerminalRuntimeActivityStatus(value)) return "completed";
  return "updated";
}

function isTerminalRuntimeActivityStatus(value: unknown): boolean {
  return value === "completed" ||
    value === "succeeded" ||
    value === "success" ||
    value === "done" ||
    value === "finished" ||
    value === "failed" ||
    value === "cancelled" ||
    value === "canceled";
}

function readRuntimeString(event: AgentOutputEvent, key: string): string | undefined {
  const value = event.runtimeState?.[key];
  return typeof value === "string" && value ? value : undefined;
}

function readRuntimeRecord(event: AgentOutputEvent, key: string): Record<string, unknown> | undefined {
  const value = event.runtimeState?.[key];
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
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

function toSortableTimestamp(value: string): number {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}
