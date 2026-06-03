import { nanoid } from "nanoid";
import type { AgentOutputEvent, RunInterjection, RunRoomFeed, RunRoomFeedRow } from "@hiveward/shared";
import { assertAgentOutputEvent, assertRunRoomFeedRow } from "@hiveward/shared";
import type { HivewardStore } from "../store/hivewardStore";

export type AppendAgentOutputEventInput =
  Omit<AgentOutputEvent, "id" | "sequence" | "createdAt"> &
  Partial<Pick<AgentOutputEvent, "id" | "sequence" | "createdAt">>;

export class AgentOutputService {
  constructor(
    private readonly store: Pick<HivewardStore, "appendAgentOutputEvent" | "listAgentOutputEvents" | "listRunInterjections">
  ) {}

  async appendEvent(input: AppendAgentOutputEventInput): Promise<AgentOutputEvent> {
    const createdAt = input.createdAt ?? new Date().toISOString();
    const sequence = input.sequence ?? await this.nextSequence(input.ownerType, input.ownerId);
    const event: AgentOutputEvent = {
      ...input,
      id: input.id ?? `agent-output-${nanoid(10)}`,
      sequence,
      createdAt
    };
    assertAgentOutputEvent(event);
    return this.store.appendAgentOutputEvent(event);
  }

  async listOwnerEvents(ownerType: AgentOutputEvent["ownerType"], ownerId: string): Promise<AgentOutputEvent[]> {
    return this.store.listAgentOutputEvents({ ownerType, ownerId });
  }

  async projectRunRoomFeed(runRoomId: string): Promise<RunRoomFeed> {
    const [events, interjections] = await Promise.all([
      this.store.listAgentOutputEvents(),
      this.store.listRunInterjections({ runRoomId })
    ]);
    return projectRunRoomFeed(runRoomId, events, interjections);
  }

  private async nextSequence(ownerType: AgentOutputEvent["ownerType"], ownerId: string): Promise<number> {
    const existing = await this.store.listAgentOutputEvents({ ownerType, ownerId });
    return existing.reduce((max, event) => Math.max(max, event.sequence), 0) + 1;
  }
}

export function projectRunRoomFeed(
  runRoomId: string,
  events: readonly AgentOutputEvent[],
  interjections: readonly RunInterjection[] = []
): RunRoomFeed {
  const rows = [
    ...events
      .filter((event) => (event.ownerType === "run_room" && event.ownerId === runRoomId) || event.metadata?.runRoomId === runRoomId)
      .filter((event) => event.kind === "message_completed" || event.kind === "message_failed" || event.kind === "runtime_state")
      .map((event) => projectRunRoomFeedRow(runRoomId, event))
      .filter((row): row is RunRoomFeedRow => Boolean(row)),
    ...interjections
      .filter((interjection) => interjection.runRoomId === runRoomId)
      .map((interjection) => projectRunInterjectionFeedRow(interjection))
  ]
    .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime() || left.id.localeCompare(right.id));

  return { runRoomId, rows };
}

function projectRunInterjectionFeedRow(interjection: RunInterjection): RunRoomFeedRow {
  const row: RunRoomFeedRow = {
    id: `run-room-feed-row-${interjection.id}`,
    runRoomId: interjection.runRoomId,
    sourceType: "user",
    displayMode: "formal_message",
    bodyMarkdown: interjection.messageMarkdown,
    actions: {},
    createdAt: interjection.createdAt
  };
  assertRunRoomFeedRow(row);
  return row;
}

function projectRunRoomFeedRow(runRoomId: string, event: AgentOutputEvent): RunRoomFeedRow | undefined {
  const sourceType = runRoomSourceTypeForEvent(event);
  const displayMode = sourceType === "worker" ? "execution_output" : "formal_message";
  const bodyMarkdown = event.bodyMarkdown ?? event.delta ?? readMetadataString(event.metadata, "message") ?? "";
  if (!bodyMarkdown && event.kind !== "runtime_state") return undefined;
  const row: RunRoomFeedRow = {
    id: `run-room-feed-row-${event.id}`,
    runRoomId,
    sourceType,
    displayMode,
    bodyMarkdown,
    agentOutputEventId: event.id,
    workerTaskId: event.ownerType === "worker_task" ? event.ownerId : readMetadataString(event.metadata, "workerTaskId"),
    managerCommandId: readMetadataString(event.metadata, "managerCommandId"),
    humanActionRequestId: event.ownerType === "human_action_request" ? event.ownerId : readMetadataString(event.metadata, "humanActionRequestId"),
    runtimeState: event.runtimeState,
    actions: sourceType === "worker" ? {} : { canReply: sourceType === "manager" || sourceType === "user" },
    createdAt: event.createdAt
  };
  assertRunRoomFeedRow(row);
  return row;
}

function runRoomSourceTypeForEvent(event: AgentOutputEvent): RunRoomFeedRow["sourceType"] {
  if (event.ownerType === "worker_task" || event.actorType === "worker") return "worker";
  if (event.ownerType === "manager_thread" || event.actorType === "manager") return "manager";
  if (event.actorType === "user") return "user";
  return "system";
}

function readMetadataString(metadata: AgentOutputEvent["metadata"], key: string): string | undefined {
  const value = metadata?.[key];
  return typeof value === "string" && value ? value : undefined;
}
