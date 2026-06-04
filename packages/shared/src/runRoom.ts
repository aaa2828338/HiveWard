export const runRoomStatuses = ["open", "completed", "failed", "cancelled"] as const;
export type RunRoomStatus = typeof runRoomStatuses[number];

export interface RunRoom {
  id: string;
  companyId: string;
  blueprintId?: string;
  runId?: string;
  status: RunRoomStatus;
  title?: string;
  summary?: string;
  managerRoleId?: string;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export const runInterjectionTargets = ["manager"] as const;
export type RunInterjectionTarget = typeof runInterjectionTargets[number];

export interface RunInterjection {
  id: string;
  runRoomId: string;
  target: RunInterjectionTarget;
  messageMarkdown: string;
  createdByRoleId?: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export const managerCommandActions = [
  "dispatch_worker_task",
  "request_human_action",
  "cancel_worker_task",
  "summarize_run_room",
  "complete_run_room"
] as const;
export type ManagerCommandAction = typeof managerCommandActions[number];

export const managerCommandStatuses = ["queued", "running", "waiting_user", "succeeded", "failed", "cancelled"] as const;
export type ManagerCommandStatus = typeof managerCommandStatuses[number];

export interface ManagerCommand {
  id: string;
  runRoomId: string;
  managerRoleId?: string;
  action: ManagerCommandAction;
  status: ManagerCommandStatus;
  workerTaskId?: string;
  humanActionRequestId?: string;
  instructionMarkdown?: string;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export const workerTaskStatuses = ["queued", "running", "waiting_user", "succeeded", "failed", "cancelled"] as const;
export type WorkerTaskStatus = typeof workerTaskStatuses[number];

export const activeWorkerTaskStatuses = ["queued", "running", "waiting_user"] as const;

export interface WorkerTask {
  id: string;
  runRoomId: string;
  managerCommandId: string;
  workerSeatId?: string;
  title?: string;
  instructionMarkdown?: string;
  status: WorkerTaskStatus;
  startedAt?: string;
  endedAt?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export const humanActionRequestSourceContextTypes = ["run_room", "executive_chat", "blueprint_governance"] as const;
export type HumanActionRequestSourceContextType = typeof humanActionRequestSourceContextTypes[number];

export const humanActionRequestResponseIntents = ["decision_required", "reply_required", "review_required"] as const;
export type HumanActionRequestResponseIntent = typeof humanActionRequestResponseIntents[number];

export const humanActionRequestStatuses = ["pending", "responded", "closed", "cancelled"] as const;
export type HumanActionRequestStatus = typeof humanActionRequestStatuses[number];

export interface HumanActionRequest {
  id: string;
  runRoomId?: string;
  sourceContextType: HumanActionRequestSourceContextType;
  sourceContextId: string;
  responseIntent: HumanActionRequestResponseIntent;
  status: HumanActionRequestStatus;
  approvalRequestId?: string;
  title: string;
  bodyMarkdown: string;
  createdByRoleId?: string;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export interface HumanActionResponse {
  id: string;
  requestId: string;
  messageMarkdown: string;
  createdByRoleId?: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface InboxProjection {
  id: string;
  humanActionRequestId: string;
  sourceContextType: HumanActionRequestSourceContextType;
  sourceContextId: string;
  responseIntent: HumanActionRequestResponseIntent;
  status: HumanActionRequestStatus;
  approvalRequestId?: string;
  title: string;
  bodyMarkdown: string;
  createdAt: string;
  updatedAt: string;
  latestResponseAt?: string;
}

export const blueprintKanbanCardLanes = ["running", "waiting_user", "completed", "failed"] as const;
export type BlueprintKanbanCardLane = typeof blueprintKanbanCardLanes[number];

export type BlueprintKanbanCardTargetRef =
  | { type: "run_room"; runRoomId: string; runId?: string; blueprintId?: string }
  | { type: "inbox_projection"; inboxProjectionId: string; humanActionRequestId: string; runRoomId?: string }
  | { type: "blueprint"; blueprintId: string };

export interface BlueprintKanbanCard {
  id: string;
  runRoomId?: string;
  companyId?: string;
  blueprintId?: string;
  runId?: string;
  workerTaskId?: string;
  humanActionRequestId?: string;
  inboxProjectionId?: string;
  lane: BlueprintKanbanCardLane;
  sourceContextType?: HumanActionRequestSourceContextType;
  responseIntent?: HumanActionRequestResponseIntent;
  title: string;
  summary?: string;
  updatedAt: string;
  targetRef: BlueprintKanbanCardTargetRef;
}

export interface BlueprintKanbanBoard {
  lanes: Record<BlueprintKanbanCardLane, BlueprintKanbanCard[]>;
  cards: BlueprintKanbanCard[];
  updatedAt: string;
}

export function blueprintKanbanLaneFromRunRoomStatus(status: RunRoomStatus): BlueprintKanbanCardLane {
  if (status === "open") return "running";
  if (status === "completed") return "completed";
  return "failed";
}

export function isActiveWorkerTaskStatus(status: WorkerTaskStatus): boolean {
  return activeWorkerTaskStatuses.includes(status as typeof activeWorkerTaskStatuses[number]);
}

export function assertRunRoom(runRoom: RunRoom): void {
  assertString(runRoom.id, "RunRoom.id");
  assertString(runRoom.companyId, "RunRoom.companyId");
  assertAllowed(runRoom.status, runRoomStatuses, "RunRoom.status");
  assertString(runRoom.createdAt, "RunRoom.createdAt");
  assertString(runRoom.updatedAt, "RunRoom.updatedAt");
}

export function assertRunInterjection(interjection: RunInterjection): void {
  assertString(interjection.id, "RunInterjection.id");
  assertString(interjection.runRoomId, "RunInterjection.runRoomId");
  assertAllowed(interjection.target, runInterjectionTargets, "RunInterjection.target");
  assertString(interjection.messageMarkdown, "RunInterjection.messageMarkdown");
  assertString(interjection.createdAt, "RunInterjection.createdAt");
}

export function assertManagerCommand(command: ManagerCommand): void {
  assertString(command.id, "ManagerCommand.id");
  assertString(command.runRoomId, "ManagerCommand.runRoomId");
  assertAllowed(command.action, managerCommandActions, "ManagerCommand.action");
  assertAllowed(command.status, managerCommandStatuses, "ManagerCommand.status");
  assertString(command.createdAt, "ManagerCommand.createdAt");
  assertString(command.updatedAt, "ManagerCommand.updatedAt");
}

export function assertWorkerTask(task: WorkerTask): void {
  assertString(task.id, "WorkerTask.id");
  assertString(task.runRoomId, "WorkerTask.runRoomId");
  assertString(task.managerCommandId, "WorkerTask.managerCommandId");
  assertAllowed(task.status, workerTaskStatuses, "WorkerTask.status");
  assertString(task.createdAt, "WorkerTask.createdAt");
  assertString(task.updatedAt, "WorkerTask.updatedAt");
}

export function assertHumanActionRequest(request: HumanActionRequest): void {
  assertString(request.id, "HumanActionRequest.id");
  assertAllowed(request.sourceContextType, humanActionRequestSourceContextTypes, "HumanActionRequest.sourceContextType");
  assertString(request.sourceContextId, "HumanActionRequest.sourceContextId");
  assertAllowed(request.responseIntent, humanActionRequestResponseIntents, "HumanActionRequest.responseIntent");
  assertAllowed(request.status, humanActionRequestStatuses, "HumanActionRequest.status");
  if (request.responseIntent === "decision_required") {
    assertString(request.approvalRequestId, "HumanActionRequest.approvalRequestId");
  } else if (request.approvalRequestId !== undefined) {
    throw new Error("HumanActionRequest.approvalRequestId can only bind decision_required requests.");
  }
  assertString(request.title, "HumanActionRequest.title");
  assertString(request.bodyMarkdown, "HumanActionRequest.bodyMarkdown");
  assertString(request.createdAt, "HumanActionRequest.createdAt");
  assertString(request.updatedAt, "HumanActionRequest.updatedAt");
}

export function assertHumanActionResponse(response: HumanActionResponse): void {
  assertString(response.id, "HumanActionResponse.id");
  assertString(response.requestId, "HumanActionResponse.requestId");
  assertString(response.messageMarkdown, "HumanActionResponse.messageMarkdown");
  assertString(response.createdAt, "HumanActionResponse.createdAt");
}

export function assertInboxProjectionDirectWrite(value: unknown): never {
  throw new Error("InboxProjection is a read-only projection from HumanActionRequest and cannot be direct-written.");
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
