import { nanoid } from "nanoid";
import type { ManagerCommand, ManagerCommandAction, WorkerTask } from "@hiveward/shared";
import { assertManagerCommand, managerCommandActions } from "@hiveward/shared";
import type { HivewardStore } from "../store/hivewardStore";
import { WorkerTaskService } from "./workerTaskService";

export interface ApplyManagerCommandInput {
  runRoomId: string;
  managerRoleId?: string;
  action: string;
  workerSeatId?: string;
  title?: string;
  instructionMarkdown?: string;
  metadata?: Record<string, unknown>;
}

export interface AppliedManagerCommand {
  managerCommand: ManagerCommand;
  workerTask?: WorkerTask;
}

export class ManagerCommandService {
  private readonly workerTaskService: WorkerTaskService;

  constructor(
    private readonly store: Pick<HivewardStore, "appendManagerCommand" | "createWorkerTask" | "listWorkerTasks">
  ) {
    this.workerTaskService = new WorkerTaskService(store);
  }

  async applyCommand(input: ApplyManagerCommandInput): Promise<AppliedManagerCommand> {
    const action = readManagerCommandAction(input.action);
    if (action === "dispatch_worker_task") {
      await this.workerTaskService.assertNoActiveWorkerTask(input.runRoomId);
    }
    const now = new Date().toISOString();
    const managerCommand: ManagerCommand = {
      id: `manager-command-${nanoid(10)}`,
      runRoomId: input.runRoomId,
      managerRoleId: input.managerRoleId,
      action,
      status: action === "request_human_action" ? "waiting_user" : "queued",
      instructionMarkdown: input.instructionMarkdown,
      createdAt: now,
      updatedAt: now,
      metadata: input.metadata
    };
    assertManagerCommand(managerCommand);
    const savedCommand = await this.store.appendManagerCommand(managerCommand);
    if (action !== "dispatch_worker_task") {
      return { managerCommand: savedCommand };
    }
    const workerTask = await this.workerTaskService.createFromManagerCommand(savedCommand, {
      workerSeatId: input.workerSeatId,
      title: input.title,
      instructionMarkdown: input.instructionMarkdown,
      metadata: input.metadata
    });
    return { managerCommand: savedCommand, workerTask };
  }
}

function readManagerCommandAction(action: string): ManagerCommandAction {
  if (!managerCommandActions.includes(action as ManagerCommandAction)) {
    throw new Error(`ManagerCommand.action must be one of ${managerCommandActions.join(", ")}.`);
  }
  return action as ManagerCommandAction;
}
