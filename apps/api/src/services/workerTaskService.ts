import { nanoid } from "nanoid";
import type { ManagerCommand, WorkerTask } from "@hiveward/shared";
import { activeWorkerTaskStatuses, assertWorkerTask } from "@hiveward/shared";
import type { HivewardStore } from "../store/hivewardStore";

export interface CreateWorkerTaskFromManagerCommandInput {
  workerSeatId?: string;
  title?: string;
  instructionMarkdown?: string;
  metadata?: Record<string, unknown>;
}

export class WorkerTaskService {
  constructor(
    private readonly store: Pick<HivewardStore, "createWorkerTask" | "listWorkerTasks">
  ) {}

  async createFromManagerCommand(
    command: ManagerCommand,
    input: CreateWorkerTaskFromManagerCommandInput = {}
  ): Promise<WorkerTask> {
    if (command.action !== "dispatch_worker_task") {
      throw new Error(`ManagerCommand.action cannot create WorkerTask: ${command.action}`);
    }
    await this.assertNoActiveWorkerTask(command.runRoomId);
    const now = new Date().toISOString();
    const task: WorkerTask = {
      id: `worker-task-${nanoid(10)}`,
      runRoomId: command.runRoomId,
      managerCommandId: command.id,
      workerSeatId: input.workerSeatId,
      title: input.title,
      instructionMarkdown: input.instructionMarkdown ?? command.instructionMarkdown,
      status: "queued",
      createdAt: now,
      updatedAt: now,
      metadata: input.metadata
    };
    assertWorkerTask(task);
    return this.store.createWorkerTask(task);
  }

  async assertNoActiveWorkerTask(runRoomId: string): Promise<void> {
    const activeTasks = await this.store.listWorkerTasks({
      runRoomId,
      statuses: [...activeWorkerTaskStatuses]
    });
    if (activeTasks.length > 0) {
      throw new Error(`RunRoom already has an active WorkerTask: ${runRoomId}`);
    }
  }
}
