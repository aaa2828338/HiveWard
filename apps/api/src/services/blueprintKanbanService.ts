import type {
  BlueprintKanbanBoard,
  BlueprintKanbanCard,
  BlueprintKanbanCardLane,
  HumanActionRequest,
  HumanActionRequestResponseIntent,
  HumanActionRequestSourceContextType,
  RunRoom,
  WorkerTask
} from "@hiveward/shared";
import { blueprintKanbanLaneFromRunRoomStatus, isActiveWorkerTaskStatus } from "@hiveward/shared";
import type { HivewardStore } from "../store/hivewardStore";

export interface BlueprintKanbanFilter {
  companyId?: string;
  blueprintId?: string;
  sourceContextType?: HumanActionRequestSourceContextType;
  responseIntent?: HumanActionRequestResponseIntent;
}

export class BlueprintKanbanService {
  constructor(
    private readonly store: Pick<
      HivewardStore,
      "listRunRooms" | "listWorkerTasks" | "listHumanActionRequests"
    >
  ) {}

  async buildBoard(filter: BlueprintKanbanFilter = {}): Promise<BlueprintKanbanBoard> {
    const [runRooms, workerTasks, humanActionRequests] = await Promise.all([
      this.store.listRunRooms({
        companyId: filter.companyId,
        blueprintId: filter.blueprintId
      }),
      this.store.listWorkerTasks(),
      this.store.listHumanActionRequests({ status: "pending" })
    ]);

    const runRoomById = new Map(runRooms.map((runRoom) => [runRoom.id, runRoom]));
    const cards = [
      ...runRooms.map((runRoom) => this.cardFromRunRoom(runRoom)),
      ...workerTasks.map((task) => this.cardFromWorkerTask(task, runRoomById.get(task.runRoomId))).filter(isCard),
      ...humanActionRequests.map((request) => this.cardFromHumanActionRequest(request, runRoomById.get(request.runRoomId ?? "")))
    ]
      .filter((card) => matchesFilter(card, filter))
      .sort(compareCards);

    const lanes = emptyLanes();
    for (const card of cards) {
      lanes[card.lane].push(card);
    }

    return {
      lanes,
      cards,
      updatedAt: cards[0]?.updatedAt ?? new Date().toISOString()
    };
  }

  private cardFromRunRoom(runRoom: RunRoom): BlueprintKanbanCard {
    return {
      id: `blueprint-kanban-run-room-${runRoom.id}`,
      runRoomId: runRoom.id,
      companyId: runRoom.companyId,
      blueprintId: runRoom.blueprintId,
      runId: runRoom.runId,
      lane: blueprintKanbanLaneFromRunRoomStatus(runRoom.status),
      sourceContextType: "run_room",
      title: runRoom.title ?? runRoom.id,
      summary: runRoom.summary,
      updatedAt: runRoom.updatedAt,
      targetRef: {
        type: "run_room",
        runRoomId: runRoom.id,
        runId: runRoom.runId,
        blueprintId: runRoom.blueprintId
      }
    };
  }

  private cardFromWorkerTask(task: WorkerTask, runRoom: RunRoom | undefined): BlueprintKanbanCard | undefined {
    if (!isActiveWorkerTaskStatus(task.status) && task.status !== "failed") return undefined;
    return {
      id: `blueprint-kanban-worker-task-${task.id}`,
      runRoomId: task.runRoomId,
      companyId: runRoom?.companyId,
      blueprintId: runRoom?.blueprintId,
      runId: runRoom?.runId,
      workerTaskId: task.id,
      lane: task.status === "failed" ? "failed" : "running",
      sourceContextType: "run_room",
      title: task.title ?? `WorkerTask ${task.id}`,
      summary: task.instructionMarkdown,
      updatedAt: task.updatedAt,
      targetRef: {
        type: "run_room",
        runRoomId: task.runRoomId,
        runId: runRoom?.runId,
        blueprintId: runRoom?.blueprintId
      }
    };
  }

  private cardFromHumanActionRequest(request: HumanActionRequest, runRoom: RunRoom | undefined): BlueprintKanbanCard {
    const inboxProjectionId = `inbox-projection-${request.id}`;
    return {
      id: `blueprint-kanban-human-action-${request.id}`,
      runRoomId: request.runRoomId,
      companyId: runRoom?.companyId,
      blueprintId: runRoom?.blueprintId,
      runId: runRoom?.runId,
      humanActionRequestId: request.id,
      inboxProjectionId,
      lane: "waiting_user",
      sourceContextType: request.sourceContextType,
      responseIntent: request.responseIntent,
      title: request.title,
      summary: request.bodyMarkdown,
      updatedAt: request.updatedAt,
      targetRef: {
        type: "inbox_projection",
        inboxProjectionId,
        humanActionRequestId: request.id,
        runRoomId: request.runRoomId
      }
    };
  }
}

function emptyLanes(): Record<BlueprintKanbanCardLane, BlueprintKanbanCard[]> {
  return {
    running: [],
    waiting_user: [],
    completed: [],
    failed: []
  };
}

function matchesFilter(card: BlueprintKanbanCard, filter: BlueprintKanbanFilter): boolean {
  return (!filter.companyId || card.companyId === filter.companyId) &&
    (!filter.blueprintId || card.blueprintId === filter.blueprintId) &&
    (!filter.sourceContextType || card.sourceContextType === filter.sourceContextType) &&
    (!filter.responseIntent || card.responseIntent === filter.responseIntent);
}

function compareCards(left: BlueprintKanbanCard, right: BlueprintKanbanCard): number {
  return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime() || left.id.localeCompare(right.id);
}

function isCard(card: BlueprintKanbanCard | undefined): card is BlueprintKanbanCard {
  return card !== undefined;
}
