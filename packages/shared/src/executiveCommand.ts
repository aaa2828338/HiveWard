import type { BlueprintDefinition, BlueprintRunView } from "./blueprint";
import type { ChatRoleScope } from "./roles";
import type { HumanActionRequest, HumanActionRequestResponseIntent, RunRoom } from "./runRoom";

export const executiveCommandActions = [
  "inspect_blueprint",
  "create_blueprint_draft",
  "update_blueprint_draft",
  "govern_blueprint_version",
  "start_blueprint_run",
  "batch_start_blueprint_runs",
  "summarize_blueprint",
  "request_human_action"
] as const;

export type ExecutiveCommandAction = typeof executiveCommandActions[number];

export const executiveCommandSourceRoles = ["ceo", "leader"] as const;
export type ExecutiveCommandSourceRole = typeof executiveCommandSourceRoles[number];

export type ExecutiveGovernanceDecision = "approve" | "reject" | "request_changes";

export interface InspectBlueprintExecutiveCommand {
  action: "inspect_blueprint";
  sourceRole: ExecutiveCommandSourceRole;
  payload: {
    blueprintId: string;
  };
}

export interface CreateBlueprintDraftExecutiveCommand {
  action: "create_blueprint_draft";
  sourceRole: ExecutiveCommandSourceRole;
  payload: {
    title: string;
    description?: string;
  };
}

export interface UpdateBlueprintDraftExecutiveCommand {
  action: "update_blueprint_draft";
  sourceRole: ExecutiveCommandSourceRole;
  payload: {
    blueprintId: string;
    title?: string;
    description?: string;
    patch?: Record<string, unknown>;
  };
}

export interface GovernBlueprintVersionExecutiveCommand {
  action: "govern_blueprint_version";
  sourceRole: ExecutiveCommandSourceRole;
  payload: {
    blueprintId: string;
    decision: ExecutiveGovernanceDecision;
    comment?: string;
  };
}

export interface StartBlueprintRunExecutiveCommand {
  action: "start_blueprint_run";
  sourceRole: ExecutiveCommandSourceRole;
  payload: {
    blueprintId: string;
    startedBy?: string;
    title?: string;
    summary?: string;
  };
}

export interface BatchStartBlueprintRunsExecutiveCommand {
  action: "batch_start_blueprint_runs";
  sourceRole: ExecutiveCommandSourceRole;
  payload: {
    blueprintIds: string[];
    startedBy?: string;
  };
}

export interface SummarizeBlueprintExecutiveCommand {
  action: "summarize_blueprint";
  sourceRole: ExecutiveCommandSourceRole;
  payload: {
    blueprintId: string;
  };
}

export interface RequestHumanActionExecutiveCommand {
  action: "request_human_action";
  sourceRole: ExecutiveCommandSourceRole;
  payload: {
    sourceContextType: "executive_chat" | "blueprint_governance";
    sourceContextId?: string;
    blueprintId?: string;
    responseIntent: HumanActionRequestResponseIntent;
    title: string;
    bodyMarkdown: string;
    createdByRoleId?: string;
  };
}

export type ExecutiveCommand =
  | InspectBlueprintExecutiveCommand
  | CreateBlueprintDraftExecutiveCommand
  | UpdateBlueprintDraftExecutiveCommand
  | GovernBlueprintVersionExecutiveCommand
  | StartBlueprintRunExecutiveCommand
  | BatchStartBlueprintRunsExecutiveCommand
  | SummarizeBlueprintExecutiveCommand
  | RequestHumanActionExecutiveCommand;

export interface ExecuteExecutiveCommandRequest {
  command: ExecutiveCommand;
}

export type ExecutiveCommandResult =
  | {
      status: "accepted";
      action: Exclude<
        ExecutiveCommandAction,
        "inspect_blueprint" | "start_blueprint_run" | "batch_start_blueprint_runs" | "summarize_blueprint" | "request_human_action"
      >;
      sourceRole: ExecutiveCommandSourceRole;
      roleScope?: ChatRoleScope;
    }
  | {
      status: "completed";
      action: "inspect_blueprint";
      blueprint: BlueprintDefinition;
    }
  | {
      status: "completed";
      action: "summarize_blueprint";
      summary: {
        blueprintId: string;
        name: string;
        version: number;
        nodeCount: number;
        edgeCount: number;
      };
    }
  | {
      status: "completed";
      action: "start_blueprint_run";
      run: BlueprintRunView;
      runRoom: RunRoom;
    }
  | {
      status: "completed";
      action: "batch_start_blueprint_runs";
      runs: BlueprintRunView[];
      runRooms: RunRoom[];
    }
  | {
      status: "completed";
      action: "request_human_action";
      humanActionRequest: HumanActionRequest;
    };

export interface ExecuteExecutiveCommandResponse {
  command: ExecutiveCommand;
  result: ExecutiveCommandResult;
}

export function parseExecutiveCommand(value: unknown): ExecutiveCommand {
  const command = readStrictRecord(value, "ExecutiveCommand");
  assertOnlyKeys(command, ["action", "sourceRole", "payload"], "ExecutiveCommand");
  const action = readRequiredString(command.action, "ExecutiveCommand.action");
  if (action === "dispatch_worker_task" || action === "dispatch_worker_tasks") {
    throw new Error("ExecutiveCommand.action cannot dispatch WorkerTask.");
  }
  assertAllowed(action, executiveCommandActions, "ExecutiveCommand.action");
  const sourceRole = readRequiredString(command.sourceRole, "ExecutiveCommand.sourceRole");
  assertAllowed(sourceRole, executiveCommandSourceRoles, "ExecutiveCommand.sourceRole");

  switch (action) {
    case "inspect_blueprint":
      return { action, sourceRole, payload: readBlueprintIdPayload(command.payload, action) };
    case "create_blueprint_draft":
      return { action, sourceRole, payload: readCreateBlueprintDraftPayload(command.payload) };
    case "update_blueprint_draft":
      return { action, sourceRole, payload: readUpdateBlueprintDraftPayload(command.payload) };
    case "govern_blueprint_version":
      return { action, sourceRole, payload: readGovernBlueprintVersionPayload(command.payload) };
    case "start_blueprint_run":
      return { action, sourceRole, payload: readStartBlueprintRunPayload(command.payload) };
    case "batch_start_blueprint_runs":
      return { action, sourceRole, payload: readBatchStartBlueprintRunsPayload(command.payload) };
    case "summarize_blueprint":
      return { action, sourceRole, payload: readBlueprintIdPayload(command.payload, action) };
    case "request_human_action":
      return { action, sourceRole, payload: readRequestHumanActionPayload(command.payload) };
  }
}

function readBlueprintIdPayload(value: unknown, action: ExecutiveCommandAction): { blueprintId: string } {
  const payload = readStrictRecord(value, `ExecutiveCommand.${action}.payload`);
  assertOnlyKeys(payload, ["blueprintId"], `ExecutiveCommand.${action}.payload`);
  return {
    blueprintId: readRequiredString(payload.blueprintId, `ExecutiveCommand.${action}.payload.blueprintId`)
  };
}

function readCreateBlueprintDraftPayload(value: unknown): CreateBlueprintDraftExecutiveCommand["payload"] {
  const payload = readStrictRecord(value, "ExecutiveCommand.create_blueprint_draft.payload");
  assertOnlyKeys(payload, ["title", "description"], "ExecutiveCommand.create_blueprint_draft.payload");
  return {
    title: readRequiredString(payload.title, "ExecutiveCommand.create_blueprint_draft.payload.title"),
    description: readOptionalString(payload.description, "ExecutiveCommand.create_blueprint_draft.payload.description")
  };
}

function readUpdateBlueprintDraftPayload(value: unknown): UpdateBlueprintDraftExecutiveCommand["payload"] {
  const payload = readStrictRecord(value, "ExecutiveCommand.update_blueprint_draft.payload");
  assertOnlyKeys(payload, ["blueprintId", "title", "description", "patch"], "ExecutiveCommand.update_blueprint_draft.payload");
  return {
    blueprintId: readRequiredString(payload.blueprintId, "ExecutiveCommand.update_blueprint_draft.payload.blueprintId"),
    title: readOptionalString(payload.title, "ExecutiveCommand.update_blueprint_draft.payload.title"),
    description: readOptionalString(payload.description, "ExecutiveCommand.update_blueprint_draft.payload.description"),
    patch: payload.patch === undefined ? undefined : readStrictRecord(payload.patch, "ExecutiveCommand.update_blueprint_draft.payload.patch")
  };
}

function readGovernBlueprintVersionPayload(value: unknown): GovernBlueprintVersionExecutiveCommand["payload"] {
  const payload = readStrictRecord(value, "ExecutiveCommand.govern_blueprint_version.payload");
  assertOnlyKeys(payload, ["blueprintId", "decision", "comment"], "ExecutiveCommand.govern_blueprint_version.payload");
  const decision = readRequiredString(payload.decision, "ExecutiveCommand.govern_blueprint_version.payload.decision");
  assertAllowed(decision, ["approve", "reject", "request_changes"] as const, "ExecutiveCommand.govern_blueprint_version.payload.decision");
  return {
    blueprintId: readRequiredString(payload.blueprintId, "ExecutiveCommand.govern_blueprint_version.payload.blueprintId"),
    decision,
    comment: readOptionalString(payload.comment, "ExecutiveCommand.govern_blueprint_version.payload.comment")
  };
}

function readStartBlueprintRunPayload(value: unknown): StartBlueprintRunExecutiveCommand["payload"] {
  const payload = readStrictRecord(value, "ExecutiveCommand.start_blueprint_run.payload");
  assertOnlyKeys(payload, ["blueprintId", "startedBy", "title", "summary"], "ExecutiveCommand.start_blueprint_run.payload");
  return {
    blueprintId: readRequiredString(payload.blueprintId, "ExecutiveCommand.start_blueprint_run.payload.blueprintId"),
    startedBy: readOptionalString(payload.startedBy, "ExecutiveCommand.start_blueprint_run.payload.startedBy"),
    title: readOptionalString(payload.title, "ExecutiveCommand.start_blueprint_run.payload.title"),
    summary: readOptionalString(payload.summary, "ExecutiveCommand.start_blueprint_run.payload.summary")
  };
}

function readBatchStartBlueprintRunsPayload(value: unknown): BatchStartBlueprintRunsExecutiveCommand["payload"] {
  const payload = readStrictRecord(value, "ExecutiveCommand.batch_start_blueprint_runs.payload");
  assertOnlyKeys(payload, ["blueprintIds", "startedBy"], "ExecutiveCommand.batch_start_blueprint_runs.payload");
  if (!Array.isArray(payload.blueprintIds)) {
    throw new Error("ExecutiveCommand.batch_start_blueprint_runs.payload.blueprintIds must be an array.");
  }
  const blueprintIds = payload.blueprintIds.map((item, index) =>
    readRequiredString(item, `ExecutiveCommand.batch_start_blueprint_runs.payload.blueprintIds[${index}]`)
  );
  if (blueprintIds.length === 0) {
    throw new Error("ExecutiveCommand.batch_start_blueprint_runs.payload.blueprintIds must not be empty.");
  }
  return {
    blueprintIds,
    startedBy: readOptionalString(payload.startedBy, "ExecutiveCommand.batch_start_blueprint_runs.payload.startedBy")
  };
}

function readRequestHumanActionPayload(value: unknown): RequestHumanActionExecutiveCommand["payload"] {
  const payload = readStrictRecord(value, "ExecutiveCommand.request_human_action.payload");
  assertOnlyKeys(
    payload,
    ["sourceContextType", "sourceContextId", "blueprintId", "responseIntent", "title", "bodyMarkdown", "createdByRoleId"],
    "ExecutiveCommand.request_human_action.payload"
  );
  const sourceContextType = readRequiredString(
    payload.sourceContextType,
    "ExecutiveCommand.request_human_action.payload.sourceContextType"
  );
  if (sourceContextType === "run_room") {
    throw new Error("ExecutiveCommand.request_human_action.payload.sourceContextType cannot be run_room.");
  }
  assertAllowed(sourceContextType, ["executive_chat", "blueprint_governance"] as const, "ExecutiveCommand.request_human_action.payload.sourceContextType");
  const responseIntent = readRequiredString(payload.responseIntent, "ExecutiveCommand.request_human_action.payload.responseIntent");
  assertAllowed(
    responseIntent,
    ["decision_required", "reply_required", "review_required"] as const,
    "ExecutiveCommand.request_human_action.payload.responseIntent"
  );
  return {
    sourceContextType,
    sourceContextId: readOptionalString(payload.sourceContextId, "ExecutiveCommand.request_human_action.payload.sourceContextId"),
    blueprintId: readOptionalString(payload.blueprintId, "ExecutiveCommand.request_human_action.payload.blueprintId"),
    responseIntent,
    title: readRequiredString(payload.title, "ExecutiveCommand.request_human_action.payload.title"),
    bodyMarkdown: readRequiredString(payload.bodyMarkdown, "ExecutiveCommand.request_human_action.payload.bodyMarkdown"),
    createdByRoleId: readOptionalString(payload.createdByRoleId, "ExecutiveCommand.request_human_action.payload.createdByRoleId")
  };
}

function readStrictRecord(value: unknown, fieldName: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${fieldName} must be a JSON object.`);
  }
  return value as Record<string, unknown>;
}

function assertOnlyKeys(value: Record<string, unknown>, allowedKeys: readonly string[], fieldName: string): void {
  const allowed = new Set(allowedKeys);
  const unknownKeys = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknownKeys.length) {
    throw new Error(`${fieldName} contains unsupported fields: ${unknownKeys.join(", ")}.`);
  }
}

function readRequiredString(value: unknown, fieldName: string): string {
  const stringValue = readOptionalString(value, fieldName);
  if (!stringValue) throw new Error(`${fieldName} is required.`);
  return stringValue;
}

function readOptionalString(value: unknown, fieldName: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new Error(`${fieldName} must be a string.`);
  const trimmed = value.trim();
  return trimmed || undefined;
}

function assertAllowed<T extends readonly string[]>(value: string, allowedValues: T, fieldName: string): asserts value is T[number] {
  if (!allowedValues.includes(value)) {
    throw new Error(`${fieldName} must be one of ${allowedValues.join(", ")}.`);
  }
}
