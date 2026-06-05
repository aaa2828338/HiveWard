import { nanoid } from "nanoid";
import type { AgentOutputEvent, RunInterjection, RunRoomOutputSnapshot } from "@hiveward/shared";
import { assertAgentOutputEvent, isCanonicalRunRoomOutputEvent } from "@hiveward/shared";
import type { HivewardStore } from "../store/hivewardStore";

export type AppendAgentOutputEventInput =
  Omit<AgentOutputEvent, "id" | "sequence" | "createdAt"> &
  Partial<Pick<AgentOutputEvent, "id" | "sequence" | "createdAt">>;

export class AgentOutputService {
  constructor(
    private readonly store: Pick<
      HivewardStore,
      | "appendAgentOutputEvent"
      | "listAgentOutputEvents"
      | "listRunInterjections"
    >
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

  async listRunRoomOutputSnapshot(runRoomId: string): Promise<RunRoomOutputSnapshot> {
    const [events, interjections] = await Promise.all([
      this.store.listAgentOutputEvents({ ownerType: "run_room", ownerId: runRoomId }),
      this.store.listRunInterjections({ runRoomId })
    ]);
    return projectRunRoomOutputSnapshot(runRoomId, events, interjections);
  }

  private async nextSequence(ownerType: AgentOutputEvent["ownerType"], ownerId: string): Promise<number> {
    const existing = await this.store.listAgentOutputEvents({ ownerType, ownerId });
    return existing.reduce((max, event) => Math.max(max, event.sequence), 0) + 1;
  }
}

export function projectRunRoomOutputSnapshot(
  runRoomId: string,
  events: readonly AgentOutputEvent[],
  interjections: readonly RunInterjection[] = []
): RunRoomOutputSnapshot {
  return {
    runRoomId,
    events: events
      .filter((event) => isCanonicalRunRoomOutputEvent(runRoomId, event))
      .sort((left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id)),
    interjections: interjections
      .filter((interjection) => interjection.runRoomId === runRoomId)
      .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime() || left.id.localeCompare(right.id))
  };
}
