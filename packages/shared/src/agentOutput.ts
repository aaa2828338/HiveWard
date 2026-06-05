import type { RunInterjection } from "./runRoom";

export const agentOutputOwnerTypes = [
  "chat_session",
  "run_room",
  "manager_thread",
  "worker_task",
  "human_action_request"
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

export interface RunRoomOutputSnapshot {
  runRoomId: string;
  events: AgentOutputEvent[];
  interjections: RunInterjection[];
}

const runRoomOutputEventKinds = new Set<AgentOutputKind>([
  "message_started",
  "message_delta",
  "message_completed",
  "message_failed",
  "runtime_state"
]);

export function isCanonicalRunRoomOutputEvent(runRoomId: string, event: AgentOutputEvent): boolean {
  return event.ownerType === "run_room" &&
    event.ownerId === runRoomId &&
    event.sourceType === "blueprint_node_run" &&
    typeof event.sourceId === "string" &&
    event.sourceId.length > 0 &&
    runRoomOutputEventKinds.has(event.kind) &&
    hasMatchingMetadataRunRoomId(runRoomId, event);
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

export function isAgentOutputEvent(value: unknown): value is AgentOutputEvent {
  try {
    assertAgentOutputEvent(value as AgentOutputEvent);
    return true;
  } catch {
    return false;
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

function hasMatchingMetadataRunRoomId(runRoomId: string, event: AgentOutputEvent): boolean {
  const metadataRunRoomId = readMetadataString(event.metadata, "runRoomId");
  return metadataRunRoomId === undefined || metadataRunRoomId === runRoomId;
}

function readMetadataString(metadata: AgentOutputEvent["metadata"], key: string): string | undefined {
  const value = metadata?.[key];
  return typeof value === "string" && value ? value : undefined;
}
