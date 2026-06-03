import { nanoid } from "nanoid";
import type { RunInterjection, RunRoom } from "@hiveward/shared";
import { assertRunInterjection } from "@hiveward/shared";
import type { HivewardStore } from "../store/hivewardStore";

export interface CreateRunInterjectionInput {
  runRoomId: string;
  messageMarkdown: string;
  createdByRoleId?: string;
  metadata?: Record<string, unknown>;
}

export class RunRoomService {
  constructor(
    private readonly store: Pick<HivewardStore, "getRunRoom" | "appendRunInterjection">
  ) {}

  async createInterjection(input: CreateRunInterjectionInput): Promise<RunInterjection> {
    const runRoom = await this.requireOpenRunRoom(input.runRoomId);
    const messageMarkdown = input.messageMarkdown.trim();
    if (!messageMarkdown) throw new Error("RunInterjection.messageMarkdown is required.");

    const interjection: RunInterjection = {
      id: `run-interjection-${nanoid(10)}`,
      runRoomId: runRoom.id,
      target: "manager",
      messageMarkdown,
      createdByRoleId: input.createdByRoleId,
      createdAt: new Date().toISOString(),
      metadata: input.metadata
    };
    assertRunInterjection(interjection);
    return this.store.appendRunInterjection(interjection);
  }

  private async requireOpenRunRoom(runRoomId: string): Promise<RunRoom> {
    const runRoom = await this.store.getRunRoom(runRoomId);
    if (!runRoom) throw new Error(`RunRoom not found: ${runRoomId}`);
    if (runRoom.status !== "open") throw new Error(`RunRoom is not open: ${runRoomId}`);
    return runRoom;
  }
}
