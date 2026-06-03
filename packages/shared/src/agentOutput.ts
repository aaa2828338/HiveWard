export const agentOutputOwnerTypes = [
  "executive_chat",
  "run_room",
  "manager_command",
  "worker_task",
  "human_action_request",
  "blueprint_governance"
] as const;
export type AgentOutputOwnerType = typeof agentOutputOwnerTypes[number];

export const agentOutputKinds = [
  "message_started",
  "message_delta",
  "message_completed",
  "runtime_state",
  "tool_state",
  "message_failed"
] as const;
export type AgentOutputKind = typeof agentOutputKinds[number];

export const agentOutputActorTypes = ["user", "ceo", "leader", "manager", "worker", "system"] as const;
export type AgentOutputActorType = typeof agentOutputActorTypes[number];

export interface AgentOutputEvent {
  id: string;
  ownerType: AgentOutputOwnerType;
  ownerId: string;
  actorType: AgentOutputActorType;
  kind: AgentOutputKind;
  sequence: number;
  bodyMarkdown?: string;
  delta?: string;
  sourceType?: string;
  sourceId?: string;
  runtimeState?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export const runRoomFeedRowDisplayModes = ["formal_message", "execution_output"] as const;
export type RunRoomFeedRowDisplayMode = typeof runRoomFeedRowDisplayModes[number];

export const runRoomFeedRowSourceTypes = ["user", "manager", "worker", "system"] as const;
export type RunRoomFeedRowSourceType = typeof runRoomFeedRowSourceTypes[number];

export interface RunRoomFeedRowActions {
  canReply?: boolean;
  canMention?: boolean;
  canDirectMessage?: boolean;
  canSelectSendTarget?: boolean;
}

export interface RunRoomFeedRow {
  id: string;
  runRoomId: string;
  sourceType: RunRoomFeedRowSourceType;
  displayMode: RunRoomFeedRowDisplayMode;
  bodyMarkdown: string;
  agentOutputEventId?: string;
  workerTaskId?: string;
  managerCommandId?: string;
  humanActionRequestId?: string;
  actions?: RunRoomFeedRowActions;
  createdAt: string;
}

export interface RunRoomFeed {
  runRoomId: string;
  rows: RunRoomFeedRow[];
}

export function assertAgentOutputEvent(event: AgentOutputEvent): void {
  assertString(event.id, "AgentOutputEvent.id");
  assertAllowed(event.ownerType, agentOutputOwnerTypes, "AgentOutputEvent.ownerType");
  assertString(event.ownerId, "AgentOutputEvent.ownerId");
  assertAllowed(event.actorType, agentOutputActorTypes, "AgentOutputEvent.actorType");
  assertAllowed(event.kind, agentOutputKinds, "AgentOutputEvent.kind");
  if (!Number.isInteger(event.sequence) || event.sequence < 1) {
    throw new Error("AgentOutputEvent.sequence must be a positive integer.");
  }
  assertString(event.createdAt, "AgentOutputEvent.createdAt");
}

export function assertRunRoomFeedRow(row: RunRoomFeedRow): void {
  assertString(row.id, "RunRoomFeedRow.id");
  assertString(row.runRoomId, "RunRoomFeedRow.runRoomId");
  assertAllowed(row.sourceType, runRoomFeedRowSourceTypes, "RunRoomFeedRow.sourceType");
  assertAllowed(row.displayMode, runRoomFeedRowDisplayModes, "RunRoomFeedRow.displayMode");
  assertString(row.bodyMarkdown, "RunRoomFeedRow.bodyMarkdown");
  assertString(row.createdAt, "RunRoomFeedRow.createdAt");
  if (
    row.displayMode === "execution_output" &&
    (
      row.actions?.canReply === true ||
      row.actions?.canMention === true ||
      row.actions?.canDirectMessage === true ||
      row.actions?.canSelectSendTarget === true
    )
  ) {
    throw new Error("RunRoomFeedRow.displayMode execution_output cannot expose reply, mention, direct message, or send-target actions.");
  }
}

function assertString(value: unknown, fieldName: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${fieldName} is required.`);
  }
}

function assertAllowed<T extends readonly string[]>(value: unknown, allowedValues: T, fieldName: string): asserts value is T[number] {
  if (typeof value !== "string" || !allowedValues.includes(value)) {
    throw new Error(`${fieldName} must be one of ${allowedValues.join(", ")}.`);
  }
}
