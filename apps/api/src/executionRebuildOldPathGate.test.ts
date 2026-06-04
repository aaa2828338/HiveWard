import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

type SourceFile = {
  path: string;
  text: string;
};

const sourceRoots = [
  "apps/api/src",
  "apps/api/harness-skills",
  "apps/web/src",
  "packages/adapter/src",
  "packages/shared/src"
];

describe("execution rebuild old-path exclusion gate", () => {
  it("keeps removed old public surfaces and second owners out of production source", () => {
    const productionSource = readSourceTree(...sourceRoots, { includeTests: false });

    [
      "requestChangesApprovalRequest",
      "reviseApprovalRequest",
      "reviewOutputSelectionId",
      "projectRunViewApprovalDiscussion",
      "PendingApprovalReply.selected",
      "selected?: boolean",
      "reply.selected",
      "canRequestChanges",
      "canRevise",
      "selectedReplyId",
      "selected_reply_id",
      "selectApprovalReply",
      "selectApprovalRequestReply",
      "selectApprovalCandidate",
      "resolveApprovedOutput",
      "canCreateCandidate",
      "ApprovalReplyPurpose",
      "InboxDiscussionMode",
      "approveInboxItem",
      "rejectInboxItem",
      "replyToInboxItem",
      "applyInboxDecision",
      "Generate candidate",
      "Request changes",
      "ManagerLifecycleMode",
      "ManagerDispatchMode",
      "self_iteration_prepare_round",
      "self_iteration_execute_round",
      "self_iteration_release_report",
      "resolveSequentialManagerDecision",
      "isAgentDrivenManager",
      "run connected slots in ascending order",
      "ManagerSlotExecutionMode",
      "executeManagerSlotNode",
      "dispatch_worker_tasks",
      "ChatStreamEvent",
      "HivewardChatMessage",
      "NodeSessionTranscriptEvent",
      "RunTranscriptEventRow",
      "InboxConversationMessage",
      "buildInboxConversationMessages",
      "buildFormalInboxConversation",
      "buildApprovalConversation",
      "hiveward-inbox",
      "hiveward.inbox-submission/v1",
      "type `blueprint_proposal`",
      "inbox_item_created",
      "extractChatInboxSubmissionBlock",
      "repairExtraJsonObjectClosers",
      "stripHivewardInboxSubmissionBlocks",
      "legacyBootstrapCommands",
      "legacyBackfill",
      "legacyPreflightModeFromNodeRunId",
      "preflightModeFromNodeRunId",
      "buildRunExecutionTimelineFallback",
      "buildRunTimelineTraceItems",
      "timelineFallback"
    ].forEach((forbiddenFragment) => {
      expect(productionSource).not.toContain(forbiddenFragment);
    });
    const lifecycleSource = readSource("packages/shared/src/lifecycle.ts");
    expect(lifecycleSource).not.toMatch(/\brequest_changes\b/);
    expect(productionSource).not.toMatch(/request-changes/);
    expect(productionSource).not.toMatch(/\/api\/blueprint-runs\/:runId\/(?:approve|reject|reply|select-approval-reply)/);
    expect(productionSource).not.toMatch(/\/api\/approval-requests\/[^"`']*\/(?:request-changes|request_changes|revise)/);
  });

  it("keeps the run page main trace owned by execution facts without legacy inference", () => {
    const source = readSource("apps/web/src/components/WorkspacePages.tsx");
    const executionRowsIndex = source.indexOf("const executionRows = buildRunExecutionTraceRows");
    const executionReturnIndex = source.indexOf("if (executionRows.length > 0)", executionRowsIndex);
    const missingFactsIndex = source.indexOf("return [createMissingExecutionFactsTraceIssue", executionReturnIndex);
    const buildTraceIssuesBody = sliceBetween(source, "function buildTraceIssues", "function createMissingExecutionFactsTraceIssue");
    const executionRowsBody = sliceBetween(source, "function buildRunExecutionTraceRows", "function buildCommandOnlyTraceRow");

    expect(source).not.toContain("preflightModeFromNodeRunId");
    expect(source).not.toContain("legacyPreflightModeFromNodeRunId");
    expect(source).not.toContain("legacyReadOnlyTraceBody");
    expect(source).not.toContain("buildRunExecutionTimelineFallback");
    expect(source).not.toContain("buildRunTimelineTraceItems");
    expect(source).not.toContain("const nodeRunIds = new Set");
    expect(executionRowsIndex).toBeGreaterThanOrEqual(0);
    expect(executionReturnIndex).toBeGreaterThan(executionRowsIndex);
    expect(missingFactsIndex).toBeGreaterThan(executionReturnIndex);
    expect(buildTraceIssuesBody).toContain("buildRunExecutionTraceRows");
    expect(buildTraceIssuesBody).toContain("createMissingExecutionFactsTraceIssue");
    expect(executionRowsBody).not.toContain("timelineFallback");
    expect(executionRowsBody).not.toContain("runTimeline");
  });

  it("keeps frontend discussion and approval capability decisions on backend projections", () => {
    const webSource = readSourceTree("apps/web/src", { includeTests: false });

    expect(webSource).not.toContain("projectRunViewApprovalDiscussion");
    expect(webSource).not.toContain("approvalDiscussionBindings");
    expect(webSource).not.toContain("approvalDiscussionBinding");
    expect(webSource).not.toContain("executor_session_unavailable");
    expect(webSource).not.toContain("requestChangesApprovalRequest");
    expect(webSource).not.toContain("reviseApprovalRequest");
    expect(webSource).not.toContain("reviewOutputSelectionId");
    expect(webSource).not.toContain("reply.selected");
  });

  it("keeps runtime policy and preflight mode legacy helpers out of normal source names", () => {
    const allSource = readSourceTree(...sourceRoots, { includeTests: false });

    expect(allSource).not.toContain("normalizePermissionProfile(input.permissionProfile)");
    expect(allSource).not.toContain("preflightModeFromNodeRunId");
  });

  it("keeps run scheduling and node execution behind command and step owners", () => {
    const worker = readSource("apps/api/src/worker/blueprintWorker.ts");
    const scheduleCalls = linesContaining(worker, "this.scheduleRun(");
    const executeNodeOccurrences = [...worker.matchAll(/\bexecuteNode\(/g)].map((match) => match.index ?? 0);
    const directQueuedNodeRunOwners = methodNamesContaining(worker, "this.store.createQueuedNodeRun");
    const adapterTaskOwners = methodNamesContaining(worker, "this.runAgentTask({");
    const executeNodeBody = methodBody(worker, "executeNode");
    const commandStepNodeRunBody = methodBody(worker, "createRunningNodeRunFromCommandStep");
    const existingStepNodeRunBody = methodBody(worker, "createRunningNodeRunFromExistingStep");
    const releaseReportBody = methodBody(worker, "writeSelfIterationReleaseReport");

    expect(scheduleCalls.length).toBeGreaterThan(0);
    for (const call of scheduleCalls) {
      expect(call).toMatch(/,\s*(command|executeCommand|pending\.command)\);/);
    }
    expect(worker).toContain("private async executeNode(");
    expect(worker).toContain("await this.executeNode(blueprint, run, node, command, step);");
    expect(executeNodeOccurrences).toHaveLength(2);
    expect(worker).not.toContain("await this.executeAgentNode(");
    expect(worker).not.toContain("await this.executeSummaryNode(");
    expect(directQueuedNodeRunOwners).toEqual([
      "startPreflightNodeRun",
      "rerunAgentApprovalForRequestedChanges",
      "createRunningNodeRun",
      "ensureNodeRunClaim"
    ]);
    expect(adapterTaskOwners).toEqual([
      "runPreflightAgentTask",
      "runPreflightManagerFallback",
      "writeSelfIterationReleaseReport",
      "runManagerDecisionTask",
      "executeAgentNodeWithInput",
      "executeSummaryNodeWithUpstream"
    ]);
    expect(executeNodeBody).toContain("command: RunCommand");
    expect(executeNodeBody).toContain("step: RunCommandStep");
    expect(executeNodeBody).toContain("createRunningNodeRunFromExistingStep(blueprint, run, node, step, input)");
    expect(executeNodeBody).toContain("await this.syncRunCommandStepFromNodeRun({ ...runningStep, nodeRunId: nodeRun.id });");
    expect(commandStepNodeRunBody).toContain("const step = await this.ensureNodeExecutionCommandStep(command, run, node, mode);");
    expect(commandStepNodeRunBody).toContain("return this.createRunningNodeRunFromExistingStep(blueprint, run, node, step, input);");
    expect(existingStepNodeRunBody).toContain("findNodeRunById(run.id, step.nodeRunId)");
    expect(existingStepNodeRunBody).toContain("step.nodeRunId ?? stableNodeExecutionNodeRunId(step.stepKey)");
    expect(existingStepNodeRunBody).toContain("await this.markRunCommandStepRunning({ ...step, nodeRunId: nodeRun.id }, nodeRun.runtimeRef)");
    expect(methodBody(worker, "runPreflightAgentTask")).toContain("const step = await this.ensurePreflightCommandStep");
    expect(methodBody(worker, "runPreflightManagerFallback")).toContain("const step = await this.ensurePreflightCommandStep");
    expect(releaseReportBody).toContain("command?: RunCommand");
    expect(releaseReportBody).toContain("if (input.command)");
    expect(releaseReportBody).toContain("const started = await this.createRunningNodeRunFromCommandStep");
    expect(releaseReportBody).toContain("\"release_report\"");
    expect(worker).not.toContain("legacyBootstrapCommands");
    expect(worker).not.toContain("legacyBackfill");
    expect(worker).not.toContain("backfillLegacy");
  });

  it("keeps SQLite schema audit checks on execution facts", () => {
    const schema = readSource("apps/api/src/store/sqlite/schema.ts");

    [
      "run_command_steps",
      "node_execution_sessions",
      "approval_discussion_bindings",
      "mode IN ('research_resolution','requirement_resolution','revise_plan','preflight_judgment','context_snapshot','release_report','node_execution')",
      "status IN ('queued','running','waiting_approval','succeeded','failed','cancelled')",
      "status IN ('active','paused','completed','failed','unavailable','fallback')",
      "mode IN ('none','message_only','executor')",
      "route IN ('none','message_only','agent_approval','requirement_agent','requirement_manager','release_report_manager','function_manager','function_summary')",
      "{ table: \"node_execution_sessions\", from: \"fallback_of_session_id\", targetTable: \"node_execution_sessions\", to: \"id\" }",
      "{ table: \"node_execution_sessions\", from: \"resumed_from_session_id\", targetTable: \"node_execution_sessions\", to: \"id\" }",
      "{ table: \"approval_discussion_bindings\", from: \"executor_session_id\", targetTable: \"node_execution_sessions\", to: \"id\" }"
    ].forEach((requiredFragment) => {
      expect(schema).toContain(requiredFragment);
    });
  });

  it("keeps native session resume proof as an explicit runtime contract", () => {
    const runtimeTypes = readSource("packages/shared/src/runtime.ts");
    const taskRegistry = readSource("packages/adapter/src/sdk-runtime/task-registry.ts");
    const worker = readSource("apps/api/src/worker/blueprintWorker.ts");

    ["resumeRequested", "resumeAttempted", "resumeProven", "providerSessionId", "providerStartedNewSession", "resumable"].forEach((field) => {
      expect(runtimeTypes).toContain(field);
      expect(taskRegistry).toContain(field);
      expect(worker).toContain(field);
    });
    expect(worker).toContain("runtimeProviderNativeSessionId");
  });

  it("keeps old-path behavior gates wired into executable test suites", () => {
    const routeTests = readSource("apps/api/src/routes/apiRouter.test.ts");
    const lifecycleTests = readSource("apps/api/src/services/lifecycleServices.test.ts");
    const approvalDiscussionResolverTests = readSource("apps/api/src/services/approvalDiscussionResolver.test.ts");
    const migrationTests = readSource("apps/api/src/store/sqlite/jsonToSqliteMigration.test.ts");
    const workerTests = readSource("apps/api/src/worker/blueprintWorker.test.ts");
    const workspacePageTests = readSource("apps/web/src/components/WorkspacePages.test.tsx");
    const runStateTests = readSource("apps/web/src/lib/run-state.test.ts");
    const adapterTests = readSource("packages/adapter/src/sdk-runtime/sdk-runtime.test.ts");
    const lifecycleContractTests = readSource("packages/shared/src/lifecycle.test.ts");

    expectSourceToContainAll(lifecycleContractTests, [
      "approvalActionCanTriggerWorkflow(removedRevisionAction(\"request_changes\"))",
      "approvalActionCanTriggerWorkflow(removedRevisionAction(\"revise\"))",
      "capabilitiesAllow(requirement, removedRevisionAction(\"request_changes\"))",
      "capabilitiesAllow(requirement, removedRevisionAction(\"revise\"))"
    ]);
    expectSourceToContainAll(routeTests, [
      "does not expose run-scoped approval action routes",
      "Run-scoped approval routes must not call the worker.",
      "does not expose request-scoped approval selection as a normal route",
      "Request-scoped approval selection routes must not call the worker.",
      "does not expose request-scoped approval selection on terminal runs",
      "returns 409 for repeated approval decisions and forbids old inbox decision routes",
      "expect(secondApproval.status, JSON.stringify(secondApprovalBody)).toBe(409)",
      "expect(oldApprove.status).toBe(404)",
      "expect(oldReject.status).toBe(404)",
      "expect(oldReply.status).toBe(404)",
      "streams hiveward-inbox markdown as ordinary chat output without creating inbox items",
      "does not repair malformed hiveward-inbox markdown into an inbox item",
      "routes only canonical return_for_revision approval request actions",
      "expect(dashedAlias.status).toBe(404)",
      "expect(underscoredAlias.status).toBe(404)",
      "expect(reviseAlias.status).toBe(404)"
    ]);
    expectSourceToContainAll(lifecycleTests, [
      "does not expose approval selection or persist selected reply facts",
      "expect(\"selectApprovalCandidate\" in service).toBe(false)",
      "expect(result.decision).not.toHaveProperty(\"selectedReplyId\")"
    ]);
    expectSourceToContainAll(workerTests, [
      "keeps approvalRequestId Agent approval replies append-only and approves the original output",
      "expect(\"selectApprovalReply\" in worker).toBe(false)",
      "expect(firstReplyOutput.replies).toEqual([])",
      "expect(finalView?.approvalDecisions?.some((decision) => \"selectedReplyId\" in decision)).toBe(false)",
      "drives regular runs through a durable regular command and node execution steps",
      "keeps resumed command-step SDK agent nodes running when task lookup is temporarily unavailable",
      "expect(adapter.calls).toHaveLength(0)",
      "forbids historical self-iteration fields and commands from starting or resuming manager execution",
      "resumes an interrupted manager-slot run from the persisted OpenClaw task ref",
      "expect(adapter.waitCalls[0]).toMatchObject",
      "treats provider-started native sessions as fallback boundaries instead of proven resume",
      "provider_started_new_session",
      "marks unsupported native resume unavailable and starts an explicit fallback session",
      "expect(\"listNodeSessionTranscriptEvents\" in store).toBe(false)",
      "expect(\"nodeSessionTranscriptEvents\" in (view ?? {})).toBe(false)"
    ]);
    expectSourceToContainAll(approvalDiscussionResolverTests, [
      "treats missing binding as missing canonical discussion facts",
      "keeps message-only bindings from streaming replies",
      "does not project unavailable executor sessions as message-only"
    ]);
    expectSourceToContainAll(migrationTests, [
      "backfills historical pending approvals with canonical unavailable discussion bindings",
      "fails verification when migrated execution facts are missing"
    ]);
    expectSourceToContainAll(runStateTests, [
      "uses approval reply facts instead of node output reply facts",
      "expect(approvals[0]).not.toHaveProperty(\"selectedReplyId\")",
      "body: \"approval reply answer\"",
      "uses backend-projected approval discussion capabilities",
      "does not resolve raw approval discussion bindings in the browser",
      "marks missing approval discussion projection unavailable instead of synthesizing message-only",
      "does not synthesize pending approvals from legacy node output"
    ]);
    expectSourceToContainAll(workspacePageTests, [
      "renders RunRoomFeed rows instead of residual transcript and timeline facts",
      "derives preflight display mode from command step facts instead of node-run id prefixes",
      "does not use legacy timeline fallback when command and step facts exist",
      "renders explicit missing execution facts when canonical trace facts are absent",
      "does not project preflight approval fallback without execution facts",
      "does not infer manager report rounds without execution facts",
      "does not guess missing manager report rounds from text or ids"
    ]);
    expectSourceToContainAll(adapterTests, [
      "does not mark Codex resume proven when the provider starts a new thread",
      "rejects Codex native resume when the SDK cannot prove a resume path",
      "does not mark Claude resume proven when the provider reports a new session"
    ]);
  });
});

function readSource(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

function readSourceTree(
  ...inputs: Array<string | { includeTests?: boolean }>
): string {
  const options = typeof inputs.at(-1) === "object"
    ? inputs.pop() as { includeTests?: boolean }
    : {};
  const roots = inputs as string[];
  return roots.flatMap((root) => listSourceFiles(join(process.cwd(), root), options))
    .map((file) => `\n/* ${file.path} */\n${file.text}`)
    .join("\n");
}

function listSourceFiles(
  absolutePath: string,
  options: { includeTests?: boolean } = {}
): SourceFile[] {
  return readdirSync(absolutePath).flatMap((entry) => {
    const childPath = join(absolutePath, entry);
    const stats = statSync(childPath);
    if (stats.isDirectory()) return listSourceFiles(childPath, options);
    if (!/\.(ts|tsx|css|md)$/.test(entry)) return [];
    if (options.includeTests === false && /\.test\.(ts|tsx)$/.test(entry)) return [];
    return [{
      path: relative(process.cwd(), childPath).replace(/\\/g, "/"),
      text: readFileSync(childPath, "utf8")
    }];
  });
}

function sliceBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

function linesContaining(source: string, needle: string): string[] {
  return source.split(/\r?\n/).filter((line) => line.includes(needle));
}

function methodNamesContaining(source: string, needle: string): string[] {
  return [...source.matchAll(new RegExp(escapeRegExp(needle), "g"))].map((match) => {
    const prefix = source.slice(0, match.index);
    const methods = [...prefix.matchAll(/\n  private (?:async )?(\w+)\(/g)];
    const name = methods.at(-1)?.[1];
    expect(name, `No private method owner found for ${needle}`).toBeTruthy();
    return name!;
  });
}

function methodBody(source: string, methodName: string): string {
  const methodStart = source.search(new RegExp(`\\n  private (?:async )?${methodName}\\(`));
  expect(methodStart).toBeGreaterThanOrEqual(0);
  const nextMethodStart = source.slice(methodStart + 1).search(/\n  private (?:async )?\w+\(/);
  return nextMethodStart === -1
    ? source.slice(methodStart)
    : source.slice(methodStart, methodStart + 1 + nextMethodStart);
}

function expectSourceToContainAll(source: string, fragments: string[]): void {
  for (const fragment of fragments) {
    expect(source).toContain(fragment);
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
