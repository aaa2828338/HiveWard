import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { RuntimeAdapter, RuntimeChatSessionResult, RuntimeChatSessionTitleResult } from "@hiveward/adapter";
import {
  type AgentTaskResult,
  type AgentOutputEvent,
  type ApprovalDiscussionBinding,
  type ApprovalRequest,
  blueprintRunArchiveSchema,
  createActiveManagerNewsHtmlChaosBlueprint,
  createActiveManagerRemotionVideoChaosBlueprint,
  createManagerDrivenHtmlBlueprint,
  createRealThreeAgentBlueprint,
  type SendChannelInput,
  type SendChannelResult,
  type StartAgentTaskInput,
  type StartedAgentTaskResult,
  type WaitForAgentTaskInput,
  type BlueprintDefinition,
  type BlueprintEdge,
  type BlueprintNode,
  type BlueprintNodeRun,
  type BlueprintRunStatus,
  type ManagerNodeConfig,
  type RunCommand,
  type RunRoomStatus,
  type RuntimeTaskEvent,
  type RuntimeTaskEventHandler
} from "@hiveward/shared";
import { FileHivewardStore } from "../store/fileHivewardStore";
import type { HivewardStore } from "../store/hivewardStore";
import { SqliteHivewardStore } from "../store/sqlite/sqliteHivewardStore";
import { resolveApprovalDiscussion } from "../services/approvalDiscussionResolver";
import {
  BlueprintWorker,
  buildRunCommandKey,
  buildRunCommandStepKey,
  stableNodeExecutionNodeRunId,
  stablePreflightNodeRunId
} from "./blueprintWorker";

class ScriptedAdapter implements RuntimeAdapter {
  readonly calls: StartAgentTaskInput[] = [];
  readonly waitCalls: WaitForAgentTaskInput[] = [];
  readonly sendCalls: SendChannelInput[] = [];

  constructor(
    private readonly startResults: StartedAgentTaskResult[],
    private readonly completionResults: Array<AgentTaskResult | Error | Promise<AgentTaskResult>>,
    private readonly taskEvents: RuntimeTaskEvent[][] = []
  ) {}

  async listModels() {
    return [];
  }

  async listAgents() {
    return [];
  }

  async listTools() {
    return [];
  }

  async listChannels() {
    return [];
  }

  async listSessions() {
    return [];
  }

  async listTasks() {
    return [];
  }

  async getRuntimeOverview() {
    return {
      sessions: [],
      tasks: []
    };
  }

  async getSessionMessages() {
    return [];
  }

  async createChatSession(): Promise<RuntimeChatSessionResult> {
    throw new Error("Chat session creation is not used by blueprint worker tests.");
  }

  async updateChatSessionTitle(): Promise<RuntimeChatSessionTitleResult> {
    throw new Error("Chat session title updates are not used by blueprint worker tests.");
  }

  async streamChatMessage(): Promise<void> {
    throw new Error("Chat stream is not used by blueprint worker tests.");
  }

  async startAgentTask(input: StartAgentTaskInput, onEvent?: RuntimeTaskEventHandler): Promise<StartedAgentTaskResult> {
    this.calls.push(input);
    const result = this.startResults.shift();
    if (!result) {
      throw new Error("No scripted agent start result available.");
    }
    for (const event of this.taskEvents.shift() ?? []) {
      onEvent?.(event);
    }
    return result;
  }

  async waitForAgentTask(input: WaitForAgentTaskInput): Promise<AgentTaskResult> {
    this.waitCalls.push(input);
    const matchingIndex = this.completionResults.findIndex((candidate) =>
      !(candidate instanceof Error) &&
      !(candidate instanceof Promise) &&
      candidate.taskId === input.taskId
    );
    const result = matchingIndex >= 0
      ? this.completionResults.splice(matchingIndex, 1)[0]
      : this.completionResults.shift();
    if (!result) {
      throw new Error("No scripted agent completion result available.");
    }
    if (result instanceof Promise) {
      return result;
    }
    if (result instanceof Error) {
      throw result;
    }
    return result;
  }

  async sendChannelMessage(input: SendChannelInput): Promise<SendChannelResult> {
    this.sendCalls.push(input);
    return {
      deliveryId: "delivery-1",
      status: "sent",
      updatedAt: new Date().toISOString()
    };
  }
}

class BlockingAdapter implements RuntimeAdapter {
  readonly calls: StartAgentTaskInput[] = [];
  readonly waitCalls: WaitForAgentTaskInput[] = [];
  private resolveCompletion?: (result: AgentTaskResult) => void;
  private readonly completion: Promise<AgentTaskResult>;

  constructor(private readonly startedResult: StartedAgentTaskResult) {
    this.completion = new Promise((resolve) => {
      this.resolveCompletion = resolve;
    });
  }

  async listModels() {
    return [];
  }

  async listAgents() {
    return [];
  }

  async listTools() {
    return [];
  }

  async listChannels() {
    return [];
  }

  async listSessions() {
    return [];
  }

  async listTasks() {
    return [];
  }

  async getRuntimeOverview() {
    return {
      sessions: [],
      tasks: []
    };
  }

  async getSessionMessages() {
    return [];
  }

  async createChatSession(): Promise<RuntimeChatSessionResult> {
    throw new Error("Chat session creation is not used by blueprint worker tests.");
  }

  async updateChatSessionTitle(): Promise<RuntimeChatSessionTitleResult> {
    throw new Error("Chat session title updates are not used by blueprint worker tests.");
  }

  async streamChatMessage(): Promise<void> {
    throw new Error("Chat stream is not used by blueprint worker tests.");
  }

  async startAgentTask(input: StartAgentTaskInput, _onEvent?: RuntimeTaskEventHandler): Promise<StartedAgentTaskResult> {
    this.calls.push(input);
    return this.startedResult;
  }

  async waitForAgentTask(input: WaitForAgentTaskInput): Promise<AgentTaskResult> {
    this.waitCalls.push(input);
    return this.completion;
  }

  async sendChannelMessage(): Promise<SendChannelResult> {
    return {
      deliveryId: "delivery-1",
      status: "sent",
      updatedAt: new Date().toISOString()
    };
  }

  complete(result: AgentTaskResult): void {
    this.resolveCompletion?.(result);
  }
}

describe("BlueprintWorker", () => {
  it("resolves missing approval discussion bindings as unavailable without node-run fallback", () => {
    const now = new Date().toISOString();
    const request: ApprovalRequest = {
      id: "approval-legacy-missing-binding",
      runId: "run-legacy",
      nodeRunId: "node-run-agent_approval-looks-bound",
      kind: "agent_proposal",
      status: "pending",
      title: "Legacy approval",
      body: "Review legacy output.",
      threadId: "thread-legacy-missing-binding",
      revision: 1,
      capabilities: {
        approve: true,
        reject: true,
        reply: true
      },
      requestedBy: { type: "node", label: "Delivery", nodeId: "delivery" },
      requestedAt: now,
      updatedAt: now
    };

    expect(resolveApprovalDiscussion({
      request,
      nodeRuns: [{
        id: "node-run-agent_approval-looks-bound",
        blueprintRunId: "run-legacy",
        blueprintId: "blueprint-legacy",
        nodeId: "delivery",
        nodeLabel: "Delivery",
        nodeType: "agent",
        status: "waiting_approval",
        queuedAt: now
      }]
    }).capability).toMatchObject({
      mode: "none",
      canStreamReply: false,
      reason: "discussion_binding_missing"
    });
  });

  it("resolves broken executor approval discussion bindings as unavailable", () => {
    const now = new Date().toISOString();
    const request: ApprovalRequest = {
      id: "approval-broken-executor-binding",
      runId: "run-broken",
      kind: "agent_proposal",
      status: "pending",
      title: "Broken approval",
      body: "Review broken binding.",
      threadId: "thread-broken-executor-binding",
      revision: 1,
      capabilities: {
        approve: true,
        reject: true,
        reply: true
      },
      requestedBy: { type: "node", label: "Delivery", nodeId: "delivery" },
      requestedAt: now,
      updatedAt: now
    };
    const binding: ApprovalDiscussionBinding = {
      approvalRequestId: request.id,
      threadId: request.threadId,
      mode: "executor",
      route: "agent_approval",
      executorActor: "agent",
      executorKind: "agent_approval",
      executorNodeId: "delivery",
      executorNodeRunId: "node-run-delivery",
      canStreamReply: false,
      resolverVersion: 1,
      createdAt: now,
      updatedAt: now
    };

    expect(resolveApprovalDiscussion({ request, binding }).capability).toEqual({
      mode: "none",
      canStreamReply: false,
      reason: "executor_binding_incomplete"
    });
    expect(resolveApprovalDiscussion({
      request,
      binding: { ...binding, executorSessionId: "session-unavailable" },
      nodeRuns: [{
        id: "node-run-delivery",
        blueprintRunId: "run-broken",
        blueprintId: "blueprint-broken",
        nodeId: "delivery",
        nodeLabel: "Delivery",
        nodeType: "agent",
        status: "waiting_approval",
        queuedAt: now
      }],
      sessions: [{
        id: "session-unavailable",
        runId: "run-broken",
        nodeRunId: "node-run-delivery",
        nodeId: "delivery",
        harnessId: "codex",
        policy: "refresh_per_run",
        status: "unavailable",
        createdAt: now,
        updatedAt: now
      }]
    }).capability).toEqual({
      mode: "none",
      canStreamReply: false,
      reason: "executor_session_unavailable"
    });
  });

  it("persists a newly-created blank blueprint for the selected company", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "hiveward-store-"));
    const storePath = path.join(tempDir, "hiveward-store.json");
    const store = new FileHivewardStore(storePath);
    await store.init();

    const blueprint = await store.createBlueprint({ name: "Launch review" });
    const blueprints = await store.listBlueprints();
    const index = JSON.parse(readFileSync(storePath, "utf8")) as {
      schema: string;
      blueprints?: unknown[];
      blueprintIndex?: Array<{ id: string; name: string }>;
    };
    const blueprintPath = path.join(tempDir, "blueprints", `${blueprint.id}.json`);

    expect(blueprint.id).toMatch(/^blueprint-/);
    expect(blueprint.companyId).toBe("company-hiveward-studio");
    expect(blueprint.name).toBe("Launch review");
    expect(blueprint.nodes).toEqual([]);
    expect(blueprints.some((item) => item.id === blueprint.id)).toBe(true);
    expect(existsSync(blueprintPath)).toBe(true);
    expect(index.schema).toBe("hiveward.store-index/v1");
    expect(index.blueprints).toBeUndefined();
    expect(index.blueprintIndex?.some((item) => item.id === blueprint.id && item.name === "Launch review")).toBe(true);

    const saved = await store.saveBlueprint({ ...blueprint, name: "Launch review v2" });
    const savedIndex = JSON.parse(readFileSync(storePath, "utf8")) as {
      blueprintIndex?: Array<{ id: string; name: string; version: number }>;
    };
    const savedBlueprint = JSON.parse(readFileSync(blueprintPath, "utf8")) as { name: string; version: number };
    expect(saved.name).toBe("Launch review v2");
    expect(savedBlueprint).toMatchObject({ name: "Launch review v2", version: 2 });
    expect(savedIndex.blueprintIndex?.find((item) => item.id === blueprint.id)).toMatchObject({
      name: "Launch review v2",
      version: 2
    });
  });

  it("marks the run failed and stops downstream execution when an agent result fails", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "hiveward-worker-"));
    const storePath = path.join(tempDir, "hiveward-store.json");
    const store = new FileHivewardStore(storePath);
    await store.init();

    const blueprint = createRealThreeAgentBlueprint(new Date().toISOString(), "company-hiveward-studio");
    const worker = new BlueprintWorker(
      store,
      new ScriptedAdapter([
        createStartedAgentTask("task-1"),
        createStartedAgentTask("task-2")
      ], [
        createCompletedAgentTask("task-1", "succeeded", "brief ok"),
        createCompletedAgentTask("task-2", "failed", undefined, "output new_sensitive (1027)")
      ])
    );

    const run = await worker.startRun(blueprint, "test-user");
    const view = await waitForRunTerminal(store, run.id);

    expect(run.status).toBe("running");
    expect(view?.run.status).toBe("failed");
    await expectRunRoomStatus(store, blueprint.id, run.id, "failed");
    expect(view?.nodeRuns.find((nodeRun) => nodeRun.nodeId === "brief")?.status).toBe("succeeded");
    expect(view?.nodeRuns.find((nodeRun) => nodeRun.nodeId === "brief")?.input).toMatchObject({
      upstream: [],
      agentWorkspace: expect.objectContaining({
        path: expect.stringContaining(path.join("blueprint-workspaces", blueprint.id, "agents"))
      })
    });
    const failedPlanRun = view?.nodeRuns.find((nodeRun) => nodeRun.nodeId === "plan");
    expect(failedPlanRun?.status).toBe("failed");
    expect(failedPlanRun?.input).toMatchObject({
      upstream: [expect.objectContaining({ nodeId: "brief", nodeLabel: "1. Brief", status: "succeeded", humanReportMd: "brief ok" })]
    });
    expect((failedPlanRun?.input as { upstream?: Array<Record<string, unknown>> } | undefined)?.upstream?.[0]).not.toHaveProperty("output");
    expect((failedPlanRun?.input as { upstream?: Array<{ nodeRunId?: string; runtimeRef?: { runId?: string } }> } | undefined)?.upstream?.[0])
      .toMatchObject({
        nodeRunId: expect.any(String),
        runtimeRef: expect.objectContaining({ runId: "task-1-run" })
      });
    expect(view?.nodeRuns.find((nodeRun) => nodeRun.nodeId === "verify")?.status).toBe("skipped");
    expect(view?.events.some((event) => event.type === "blueprint.run.failed")).toBe(true);

    const archive = JSON.parse(readFileSync(path.join(tempDir, "runs", `${run.id}.json`), "utf8")) as {
      schema: string;
      run: { id: string; status: string };
      blueprintSnapshot: { id: string };
      nodeRuns: unknown[];
      events: unknown[];
    };
    const index = JSON.parse(readFileSync(storePath, "utf8")) as {
      nodeRuns?: unknown[];
      events?: unknown[];
      runIndex?: Array<{ id: string; status: string }>;
    };
    expect(archive.schema).toBe(blueprintRunArchiveSchema);
    expect(archive.run).toMatchObject({ id: run.id, status: "failed" });
    expect(archive.blueprintSnapshot.id).toBe(blueprint.id);
    expect(archive.nodeRuns.length).toBeGreaterThan(0);
    expect(archive.events.length).toBeGreaterThan(0);
    expect(index.nodeRuns).toBeUndefined();
    expect(index.events).toBeUndefined();
    expect(index.runIndex?.find((item) => item.id === run.id)?.status).toBe("failed");
  });

  it("drives regular runs through a durable regular command and node execution steps", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "hiveward-worker-"));
    const store = new FileHivewardStore(path.join(tempDir, "hiveward-store.json"));
    await store.init();

    const blueprint = createRealThreeAgentBlueprint(new Date().toISOString(), "company-hiveward-studio");
    const adapter = new ScriptedAdapter([
      createStartedAgentTask("task-command-brief"),
      createStartedAgentTask("task-command-plan"),
      createStartedAgentTask("task-command-verify")
    ], [
      createCompletedAgentTask("task-command-brief", "succeeded", "brief ok"),
      createCompletedAgentTask("task-command-plan", "succeeded", "plan ok"),
      createCompletedAgentTask("task-command-verify", "succeeded", "verify ok")
    ]);
    const worker = new BlueprintWorker(store, adapter);

    const run = await worker.startRun(blueprint, "test-user");
    const view = await waitForRunTerminal(store, run.id);
    const command = (await store.listRunCommands({ runId: run.id }))[0];
    if (!command) throw new Error("Expected regular run command.");
    const steps = await store.listRunCommandSteps({ commandId: command.id });

    expect(view?.run.status).toBe("succeeded");
    await expectRunRoomStatus(store, blueprint.id, run.id, "completed");
    expect(command).toMatchObject({
      commandKey: buildRunCommandKey(run.id, undefined, "regular_run"),
      kind: "regular_run",
      status: "succeeded",
      currentStep: "node_execution"
    });
    expect(steps.map((step) => step.nodeId)).toEqual(["brief", "plan", "verify"]);
    expect(steps.map((step) => step.mode)).toEqual(["node_execution", "node_execution", "node_execution"]);
    expect(steps.map((step) => step.status)).toEqual(["succeeded", "succeeded", "succeeded"]);
    expect(steps.map((step) => step.nodeRunId)).toEqual(steps.map((step) => stableNodeExecutionNodeRunId(step.stepKey)));
    expect(view?.nodeRuns.map((nodeRun) => nodeRun.id)).toEqual(steps.map((step) => step.nodeRunId));
  });

  it("writes node input and runtime ref to the run archive before the agent task finishes", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "hiveward-worker-"));
    const storePath = path.join(tempDir, "hiveward-store.json");
    const store = new FileHivewardStore(storePath);
    await store.init();

    const blueprint = createBlueprint([createAgentNode("brief", "Brief")], []);
    const adapter = new BlockingAdapter(createStartedAgentTask("task-1"));
    const worker = new BlueprintWorker(store, adapter);

    const run = await worker.startRun(blueprint, "test-user");
    const runningNode = await waitForNodeRun(store, run.id, "brief", (nodeRun) =>
      nodeRun.status === "running" && nodeRun.input !== undefined && nodeRun.runtimeRef?.taskId === "task-1"
    );
    const archiveWhileRunning = JSON.parse(readFileSync(path.join(tempDir, "runs", `${run.id}.json`), "utf8")) as {
      nodeRuns: Array<{ nodeId: string; status: string; input?: unknown; runtimeRef?: { taskId?: string; runId?: string } }>;
    };
    const agentWorkspace = (runningNode.input as {
      agentWorkspace?: { path?: string; artifactsPath?: string; tmpPath?: string };
    }).agentWorkspace;

    expect(runningNode.input).toMatchObject({
      upstream: [],
      agentWorkspace: {
        path: expect.stringContaining(path.join("blueprint-workspaces", blueprint.id, "agents")),
        artifactsPath: expect.stringContaining("artifacts"),
        tmpPath: expect.stringContaining("tmp")
      }
    });
    expect(existsSync(agentWorkspace?.path ?? "")).toBe(true);
    expect(existsSync(agentWorkspace?.artifactsPath ?? "")).toBe(true);
    expect(existsSync(agentWorkspace?.tmpPath ?? "")).toBe(true);
    expect(runningNode.runtimeRef).toMatchObject({ taskId: "task-1", runId: "task-1-run" });
    expect(archiveWhileRunning.nodeRuns.find((nodeRun) => nodeRun.nodeId === "brief")).toMatchObject({
      status: "running",
      input: expect.objectContaining({
        upstream: [],
        agentWorkspace: expect.objectContaining({
          path: expect.stringContaining(path.join("blueprint-workspaces", blueprint.id, "agents"))
        })
      }),
      runtimeRef: expect.objectContaining({ taskId: "task-1", runId: "task-1-run" })
    });

    adapter.complete(createCompletedAgentTask("task-1", "succeeded", "brief ok"));
    const view = await waitForRunTerminal(store, run.id);
    expect(view?.run.status).toBe("succeeded");
  });

  it("keeps agent output succeeded when a declared artifact path cannot be copied", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "hiveward-worker-artifact-fail-"));
    const store = new FileHivewardStore(path.join(tempDir, "hiveward-store.json"));
    await store.init();

    const blueprint = createBlueprint([createAgentNode("builder", "Builder")], []);
    const adapter = new ScriptedAdapter([
      createStartedAgentTask("task-missing-artifact")
    ], [
      createCompletedAgentTask("task-missing-artifact", "succeeded", {
        contractVersion: 2,
        humanReportMd: "## Builder report\n\nThe file path is invalid.",
        result: { attempted: true },
        artifacts: [{
          kind: "file",
          title: "Missing artifact",
          path: "definitely-missing-hiveward-artifact-file.txt"
        }]
      })
    ]);
    const worker = new BlueprintWorker(store, adapter);

    const run = await worker.startRun(blueprint, "test-user");
    const view = await waitForRunTerminal(store, run.id);
    const nodeRun = view?.nodeRuns.find((candidate) => candidate.nodeId === "builder");

    expect(view?.run.status).toBe("succeeded");
    expect(nodeRun?.status).toBe("succeeded");
    expect(view?.agentHumanReports?.[0]?.bodyMd).toContain("The file path is invalid.");
    expect(view?.artifacts ?? []).toEqual([
      expect.objectContaining({
        kind: "json",
        title: "Missing artifact",
        downloadUrl: expect.stringContaining("/artifacts/")
      })
    ]);
    expect(view?.events.some((event) => event.message.includes("does not exist"))).toBe(false);
  });

  it("keeps resumed command-step SDK agent nodes running when task lookup is temporarily unavailable", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "hiveward-worker-"));
    const storePath = path.join(tempDir, "hiveward-store.json");
    const store = new FileHivewardStore(storePath);
    await store.init();

    const baseAgent = createAgentNode("brief", "Brief");
    const agent: BlueprintNode = {
      ...baseAgent,
      runtimeId: "codex" as const,
      config: {
        ...baseAgent.config,
        modelId: "test-model",
        permissionProfile: "read_only" as const
      }
    };
    const blueprint = createBlueprint([agent], []);
    const run = await store.createBlueprintRun(blueprint, "test-user");
    const runningRun = { ...run, status: "running" as const };
    await store.updateBlueprintRun(runningRun);

    const startedAt = new Date().toISOString();
    const nodeRun: BlueprintNodeRun = {
      id: "node-run-sdk-resume",
      blueprintRunId: run.id,
      blueprintId: blueprint.id,
      nodeId: "brief",
      nodeLabel: "Brief",
      nodeType: "agent",
      status: "running",
      queuedAt: startedAt,
      startedAt,
      input: { upstream: [] },
      output: "partial output must survive resume",
      error: "preexisting runtime note",
      runtimeRef: {
        source: "codex",
        sourceId: "codex-task-1",
        sourceUpdatedAt: startedAt,
        taskId: "codex-task-1",
        runId: "codex-task-1-run",
        sessionKey: "codex-thread-1"
      }
    };
    await store.upsertNodeRun(nodeRun);
    const { command } = await store.createRunCommandIfAbsent({
      id: "command-sdk-resume",
      commandKey: buildRunCommandKey(run.id, undefined, "regular_run"),
      blueprintId: blueprint.id,
      runId: run.id,
      kind: "regular_run",
      status: "running",
      currentRevision: 0,
      currentStep: "node_execution",
      startedAt,
      createdAt: startedAt,
      updatedAt: startedAt
    });
    const stepKey = buildRunCommandStepKey(command, "node_execution", "brief");
    await store.createRunCommandStepIfAbsent({
      id: "step-sdk-resume",
      commandId: command.id,
      stepKey,
      runId: run.id,
      revision: 0,
      mode: "node_execution",
      nodeId: "brief",
      nodeRunId: nodeRun.id,
      status: "running",
      startedAt,
      runtimeRef: nodeRun.runtimeRef,
      createdAt: startedAt,
      updatedAt: startedAt
    });

    const missingTaskAdapter = new ScriptedAdapter([], [
      new Error("SDK task not found: codex-task-1")
    ]);
    const firstWorker = new BlueprintWorker(store, missingTaskAdapter, { nodeRunLeaseMs: 10 });
    await firstWorker.resumeActiveRuns();

    const stillRunningView = await waitForRunView(store, run.id, (view) =>
      view.events.some((event) => event.message.includes("is still running"))
    );
    expect(missingTaskAdapter.waitCalls).toHaveLength(1);
    expect(stillRunningView.run.status).toBe("running");
    expect(stillRunningView.nodeRuns.find((candidate) => candidate.id === nodeRun.id)).toMatchObject({
      status: "running",
      startedAt,
      output: "partial output must survive resume",
      error: "preexisting runtime note",
      runtimeRef: expect.objectContaining({ taskId: "codex-task-1", sessionKey: "codex-thread-1" })
    });
    expect(stillRunningView.events.some((event) => event.type === "blueprint.run.failed")).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 20));

    const recoveredAdapter = new ScriptedAdapter([], [
      createCompletedAgentTask("codex-task-1", "succeeded", "brief ok", undefined, "codex")
    ]);
    const secondWorker = new BlueprintWorker(store, recoveredAdapter);
    await secondWorker.resumeActiveRuns();

    const finalView = await waitForRunTerminal(store, run.id);
    expect(finalView?.run.status).toBe("succeeded");
    expect(finalView?.nodeRuns.find((candidate) => candidate.id === nodeRun.id)?.status).toBe("succeeded");
    expect(finalView?.events.some((event) => event.type === "blueprint.run.failed")).toBe(false);
  });

  it("cancels a running blueprint and ignores late agent completion", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "hiveward-worker-"));
    const store = new FileHivewardStore(path.join(tempDir, "hiveward-store.json"));
    await store.init();

    const blueprint = createBlueprint([createAgentNode("brief", "Brief")], []);
    const adapter = new BlockingAdapter(createStartedAgentTask("task-1"));
    const worker = new BlueprintWorker(store, adapter);

    const run = await worker.startRun(blueprint, "test-user");
    await waitForNodeRun(store, run.id, "brief", (nodeRun) => nodeRun.status === "running");

    const cancelled = await worker.cancelRun(run);
    expect(cancelled.status).toBe("cancelled");

    const cancelledView = await store.getRunView(run.id);
    expect(cancelledView?.run.status).toBe("cancelled");
    await expectRunRoomStatus(store, blueprint.id, run.id, "cancelled");
    expect(cancelledView?.nodeRuns.find((nodeRun) => nodeRun.nodeId === "brief")?.status).toBe("cancelled");
    expect(cancelledView?.events.some((event) => event.type === "blueprint.run.cancelled")).toBe(true);

    adapter.complete(createCompletedAgentTask("task-1", "succeeded", "brief ok"));
    await new Promise((resolve) => setTimeout(resolve, 20));

    const finalView = await store.getRunView(run.id);
    expect(finalView?.run.status).toBe("cancelled");
    await expectRunRoomStatus(store, blueprint.id, run.id, "cancelled");
    expect(finalView?.nodeRuns.find((nodeRun) => nodeRun.nodeId === "brief")?.status).toBe("cancelled");
    expect(finalView?.nodeRuns.some((nodeRun) => nodeRun.status === "succeeded")).toBe(false);
  });

  it("closes stale open node runs when cancelling a terminal blueprint", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "hiveward-worker-"));
    const store = new FileHivewardStore(path.join(tempDir, "hiveward-store.json"));
    await store.init();

    const blueprint = createBlueprint([createAgentNode("brief", "Brief")], []);
    const run = await store.createBlueprintRun(blueprint, "test-user");
    await store.createRunRoom({
      id: "run-room-terminal-failed",
      companyId: blueprint.companyId,
      blueprintId: blueprint.id,
      runId: run.id,
      status: "open",
      title: blueprint.name,
      createdAt: run.startedAt,
      updatedAt: run.startedAt
    });
    await store.upsertNodeRun({
      id: "node-run-stale",
      blueprintRunId: run.id,
      blueprintId: blueprint.id,
      nodeId: "brief",
      nodeLabel: "Brief",
      nodeType: "agent",
      status: "running",
      queuedAt: run.startedAt,
      startedAt: run.startedAt
    });
    const failedRun = {
      ...run,
      status: "failed" as const,
      endedAt: new Date().toISOString(),
      durationMs: 1
    };
    await store.updateBlueprintRun(failedRun);
    const worker = new BlueprintWorker(store, new ScriptedAdapter([], []));

    const normalized = await worker.cancelRun(failedRun);
    const view = await store.getRunView(run.id);

    expect(normalized.status).toBe("failed");
    expect(view?.run.status).toBe("failed");
    await expectRunRoomStatus(store, blueprint.id, run.id, "failed");
    expect(view?.nodeRuns.find((nodeRun) => nodeRun.nodeId === "brief")?.status).toBe("cancelled");
    expect(view?.nodeRuns.find((nodeRun) => nodeRun.nodeId === "brief")?.error).toContain("terminal state");
  });

  it("keeps a succeeded terminal blueprint successful when closing stale open node runs", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "hiveward-worker-"));
    const store = new FileHivewardStore(path.join(tempDir, "hiveward-store.json"));
    await store.init();

    const blueprint = createBlueprint([createAgentNode("final", "Final"), createAgentNode("stale", "Stale child")], []);
    const run = await store.createBlueprintRun(blueprint, "test-user");
    await store.upsertNodeRun({
      id: "node-run-final",
      blueprintRunId: run.id,
      blueprintId: blueprint.id,
      nodeId: "final",
      nodeLabel: "Final",
      nodeType: "agent",
      status: "succeeded",
      queuedAt: run.startedAt,
      startedAt: run.startedAt,
      endedAt: new Date().toISOString(),
      output: "final ok"
    });
    await store.upsertNodeRun({
      id: "node-run-stale",
      blueprintRunId: run.id,
      blueprintId: blueprint.id,
      nodeId: "stale",
      nodeLabel: "Stale child",
      nodeType: "agent",
      status: "running",
      queuedAt: run.startedAt,
      startedAt: run.startedAt
    });
    const succeededRun = {
      ...run,
      status: "succeeded" as const,
      endedAt: new Date().toISOString(),
      durationMs: 1
    };
    await store.updateBlueprintRun(succeededRun);
    const worker = new BlueprintWorker(store, new ScriptedAdapter([], []));

    const normalized = await worker.cancelRun(succeededRun);
    const view = await store.getRunView(run.id);

    expect(normalized.status).toBe("succeeded");
    expect(view?.run.status).toBe("succeeded");
    expect(view?.nodeRuns.find((nodeRun) => nodeRun.nodeId === "stale")?.status).toBe("cancelled");
    expect(view?.finalResult?.state).toBe("available");
    expect(view?.finalResult?.failedNode).toBeUndefined();
    expect(view?.finalResult?.candidates[0]).toMatchObject({
      nodeId: "final",
      output: "final ok"
    });
  });

  it("fails an agent node that finishes without visible output", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "hiveward-worker-"));
    const store = new FileHivewardStore(path.join(tempDir, "hiveward-store.json"));
    await store.init();

    const blueprint = createBlueprint([createAgentNode("brief", "Brief")], []);
    const adapter = new ScriptedAdapter([
      createStartedAgentTask("task-1")
    ], [
      createCompletedAgentTask("task-1", "succeeded")
    ]);
    const worker = new BlueprintWorker(store, adapter);

    const run = await worker.startRun(blueprint, "test-user");
    const view = await waitForRunTerminal(store, run.id);
    const nodeRun = view?.nodeRuns.find((candidate) => candidate.nodeId === "brief");

    expect(view?.run.status).toBe("failed");
    expect(nodeRun?.status).toBe("failed");
    expect(nodeRun?.output).toBeUndefined();
    expect(nodeRun?.error).toContain("visible output");
  });

  it("runs harness summary nodes through the selected harness with the default merge prompt", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "hiveward-worker-"));
    const store = new FileHivewardStore(path.join(tempDir, "hiveward-store.json"));
    await store.init();

    const summary: BlueprintNode = {
      id: "summary",
      type: "summary",
      position: { x: 420, y: 180 },
      config: {
        label: "Summary",
        mode: "harness_summary",
        runtimeId: "codex",
        modelId: "gpt-5-codex"
      }
    };
    const blueprint = createBlueprint([
      createAgentNode("brief", "Brief"),
      summary
    ], [
      { id: "brief-summary", source: "brief", target: "summary", condition: "success" }
    ]);
    const adapter = new ScriptedAdapter([
      createStartedAgentTask("task-brief"),
      createStartedAgentTask("task-summary", "codex")
    ], [
      createCompletedAgentTask("task-brief", "succeeded", "brief ready"),
      createCompletedAgentTask("task-summary", "succeeded", "merged brief", undefined, "codex")
    ]);
    const worker = new BlueprintWorker(store, adapter);

    const run = await worker.startRun(blueprint, "test-user");
    const view = await waitForRunTerminal(store, run.id);

    expect(view?.run.status).toBe("succeeded");
    expect(adapter.calls[1]).toMatchObject({
      source: "codex",
      agentId: undefined,
      agentName: "summary-agent",
      modelId: "gpt-5-codex",
      prompt: expect.stringContaining("structured merge")
    });
    expect((adapter.calls[1]?.input as { upstream?: Array<{ humanReportMd?: string }> }).upstream?.[0]?.humanReportMd).toBe("brief ready");
    expect(view?.nodeRuns.find((nodeRun) => nodeRun.nodeId === "summary")?.output).toBe("merged brief");
  });

  it("uses a custom prompt for harness summary nodes when provided", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "hiveward-worker-"));
    const store = new FileHivewardStore(path.join(tempDir, "hiveward-store.json"));
    await store.init();

    const summary: BlueprintNode = {
      id: "summary",
      type: "summary",
      position: { x: 120, y: 180 },
      config: {
        label: "Summary",
        mode: "harness_summary",
        runtimeId: "claude",
        modelId: "inherit",
        prompt: "Return an executive summary."
      }
    };
    const blueprint = createBlueprint([summary], []);
    const adapter = new ScriptedAdapter([
      createStartedAgentTask("task-summary", "claude")
    ], [
      createCompletedAgentTask("task-summary", "succeeded", "executive summary", undefined, "claude")
    ]);
    const worker = new BlueprintWorker(store, adapter);

    const run = await worker.startRun(blueprint, "test-user");
    const view = await waitForRunTerminal(store, run.id);

    expect(view?.run.status).toBe("succeeded");
    expect(adapter.calls[0]).toMatchObject({
      source: "claude",
      agentId: undefined,
      agentName: "summary-agent",
      modelId: "inherit",
      prompt: expect.stringContaining("Return an executive summary.")
    });
    expect(adapter.calls[0]?.prompt).toContain("humanReportMd");
    expect(adapter.calls[0]?.prompt).toContain("AgentOutputEnvelope is a transport wrapper");
    expect(adapter.calls[0]?.prompt).toContain("humanReportMd is your free-form human answer");
    expect(adapter.calls[0]?.prompt).toContain("do not repeat fixed section headings");
    expect(adapter.calls[0]?.prompt).not.toContain("must start with a visible summary section");
    expect(adapter.calls[0]?.prompt).not.toContain("100-150");
    expect(adapter.calls[0]?.prompt).toContain("real file path, browser URL, or exact artifacts[] reference");
    expect(adapter.calls[0]?.prompt).toContain("Top-level artifacts[] is a publication hint and link/address index");
    expect(adapter.calls[0]?.prompt).toContain("One step may declare many artifacts");
    expect(adapter.calls[0]?.prompt).toContain("For generated deliverables, create or update files and return path");
    expect(adapter.calls[0]?.prompt).toContain("Do not paste artifact source");
    expect(adapter.calls[0]?.outputSchema).toMatchObject({
      properties: {
        artifacts: {
          items: {
            properties: {
              content: { description: expect.stringContaining("Compatibility") },
              path: { description: expect.stringContaining("generated file") }
            }
          }
        }
      }
    });
  });

  it("records Agent approval replies without rerunning before approval", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "hiveward-worker-"));
    const store = new FileHivewardStore(path.join(tempDir, "hiveward-store.json"));
    await store.init();

    const delivery = createAgentNode("delivery", "Delivery");
    delivery.config = {
      ...delivery.config,
      approval: {
        enabled: true
      },
      send: {
        enabled: true,
        channelId: "slack",
        target: "#engineering",
        bodyTemplate: "Blueprint {{blueprint.name}} completed: {{summary}}"
      }
    };
    const blueprint = createBlueprint([delivery], []);
    const adapter = new ScriptedAdapter([
      createStartedAgentTask("task-1"),
      createStartedAgentTask("task-2")
    ], [
      createCompletedAgentTask("task-1", "succeeded", "draft answer"),
      createCompletedAgentTask("task-2", "succeeded", "final answer")
    ]);
    const worker = new BlueprintWorker(store, adapter);

    const run = await worker.startRun(blueprint, "test-user");
    const waitingView = await waitForRunStatus(store, run.id, "waiting_approval");
    const waitingNode = waitingView.nodeRuns.find((nodeRun) => nodeRun.nodeId === "delivery")!;
    const approvalRequest = waitingView.approvalRequests?.find((request) => request.kind === "agent_proposal");
    if (!approvalRequest) throw new Error("Expected agent approval request.");
    const waitingCommand = (await store.listRunCommands({ runId: run.id }))[0];
    if (!waitingCommand) throw new Error("Expected regular command for waiting approval.");
    const waitingStep = (await store.listRunCommandSteps({ commandId: waitingCommand.id }))
      .find((step) => step.nodeRunId === waitingNode.id);

    expect(waitingNode.output).toMatchObject({
      approvalType: "agent",
      reviewOutput: "draft answer",
      replies: []
    });
    expect(waitingCommand).toMatchObject({
      kind: "regular_run",
      status: "waiting_approval",
      currentStep: "node_execution"
    });
    expect(waitingStep).toMatchObject({
      mode: "node_execution",
      status: "waiting_approval",
      nodeRunId: waitingNode.id
    });
    expect(adapter.sendCalls).toHaveLength(0);

    await worker.applyApprovalRequest(blueprint, waitingView.run, approvalRequest.id, "reply", {
      message: "Use the final wording."
    });
    const repliedView = await waitForRunStatus(store, run.id, "waiting_approval");
    const repliedNode = repliedView.nodeRuns.find((nodeRun) => nodeRun.nodeId === "delivery")!;
    const repliedOutput = repliedNode.output as {
      reviewOutput: string;
      replies: Array<{ role: string; body: string }>;
    };
    const approvalReplies = await store.listApprovalReplies({ approvalRequestId: approvalRequest.id });

    expect(repliedOutput.reviewOutput).toBe("draft answer");
    expect(repliedOutput.replies).toEqual([]);
    expect(approvalReplies.map((reply) => [reply.actor, reply.purpose, reply.body])).toEqual([
      ["user", "message", "Use the final wording."],
      ["agent", "message", "final answer"]
    ]);
    expect(adapter.calls).toHaveLength(2);
    expect(adapter.sendCalls).toHaveLength(0);

    await worker.applyApprovalRequest(blueprint, repliedView.run, approvalRequest.id, "approve", {
      comment: "Approved."
    });
    const finalView = await waitForRunTerminal(store, run.id);
    const finalNode = finalView?.nodeRuns.find((nodeRun) => nodeRun.nodeId === "delivery");
    const finalStep = (await store.listRunCommandSteps({ commandId: waitingCommand.id }))
      .find((step) => step.nodeRunId === repliedNode.id);

    expect(finalView?.run.status).toBe("succeeded");
    expect(finalNode).toMatchObject({
      status: "succeeded",
      output: {
          approvedOutput: "draft answer",
          approval: {
            status: "approved",
            comment: "Approved.",
            replies: [
              {
                role: "user",
                body: "Use the final wording."
              },
              {
                role: "assistant",
                body: "final answer"
              }
            ]
          }
        }
      });
    expect(finalStep).toMatchObject({
      status: "succeeded",
      nodeRunId: repliedNode.id
    });
    expect(adapter.sendCalls).toHaveLength(1);
    expect(adapter.sendCalls[0]).toMatchObject({
      channelId: "slack",
      target: "#engineering",
      blueprintRunId: run.id,
      nodeRunId: repliedNode.id
    });
    expect(adapter.sendCalls[0]?.body).toContain("Blueprint Test blueprint completed");
    expect(adapter.sendCalls[0]?.body).toContain("draft answer");
  });

  it("falls back before publishing approval discussion replies when native resume is unproven", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "hiveward-worker-"));
    const store = new FileHivewardStore(path.join(tempDir, "hiveward-store.json"));
    await store.init();

    const delivery = createAgentNode("delivery", "Delivery");
    delivery.config = {
      ...delivery.config,
      approval: {
        enabled: true
      }
    };
    const blueprint = createBlueprint([delivery], []);
    const adapter = new ScriptedAdapter([
      {
        ...createStartedAgentTask("task-approval-fallback-1"),
        sessionKey: "runtime-approval-original",
        nativeSessionId: "native-approval-original"
      },
      {
        ...createStartedAgentTask("task-approval-fallback-resume"),
        sessionKey: "runtime-approval-resume",
        resumeRequested: true,
        resumeAttempted: true,
        resumeProven: false,
        providerStartedNewSession: true,
        resumable: false
      },
      {
        ...createStartedAgentTask("task-approval-fallback-retry"),
        sessionKey: "runtime-approval-fallback",
        nativeSessionId: "native-approval-fallback"
      }
    ], [
      {
        ...createCompletedAgentTask("task-approval-fallback-1", "succeeded", "draft answer"),
        sessionKey: "runtime-approval-original",
        nativeSessionId: "native-approval-original"
      },
      {
        ...createCompletedAgentTask("task-approval-fallback-resume", "succeeded", "discarded approval reply"),
        sessionKey: "runtime-approval-resume",
        providerSessionId: "native-provider-new",
        resumeRequested: true,
        resumeAttempted: true,
        resumeProven: false,
        providerStartedNewSession: true,
        resumable: false
      },
      {
        ...createCompletedAgentTask("task-approval-fallback-retry", "succeeded", "fallback approval reply"),
        sessionKey: "runtime-approval-fallback",
        nativeSessionId: "native-approval-fallback"
      }
    ]);
    const worker = new BlueprintWorker(store, adapter);

    const run = await worker.startRun(blueprint, "test-user");
    const waitingView = await waitForRunStatus(store, run.id, "waiting_approval");
    const waitingNode = waitingView.nodeRuns.find((nodeRun) => nodeRun.nodeId === "delivery")!;
    const approvalRequest = waitingView.approvalRequests?.find((request) => request.kind === "agent_proposal");
    if (!approvalRequest) throw new Error("Expected agent approval request.");
    const originalSessions = await store.listNodeExecutionSessions({ runId: run.id, nodeRunId: waitingNode.id });
    const originalSession = originalSessions[0];
    if (!originalSession) throw new Error("Expected original execution session.");

    await worker.applyApprovalRequest(blueprint, waitingView.run, approvalRequest.id, "reply", {
      message: "Use the final wording."
    });
    await waitForRunStatus(store, run.id, "waiting_approval");
    const approvalReplies = await store.listApprovalReplies({ approvalRequestId: approvalRequest.id });
    const sessions = await store.listNodeExecutionSessions({ runId: run.id, nodeRunId: waitingNode.id });
    const unavailable = sessions.find((session) => session.status === "unavailable");
    const fallback = sessions.find((session) => session.status === "fallback");
    if (!unavailable) throw new Error("Expected unavailable execution session.");
    if (!fallback) throw new Error("Expected fallback execution session.");
    const binding = await store.getApprovalDiscussionBinding(approvalRequest.id);

    expect(adapter.calls.map((call) => call.nativeSessionId)).toEqual([
      undefined,
      "native-approval-original",
      undefined
    ]);
    expect(approvalReplies.map((reply) => [reply.actor, reply.purpose, reply.body])).toEqual([
      ["user", "message", "Use the final wording."],
      ["agent", "message", "fallback approval reply"]
    ]);
    expect(approvalReplies.map((reply) => reply.body)).not.toContain("discarded approval reply");
    expect(unavailable).toMatchObject({
      id: originalSession.id,
      status: "unavailable",
      statusReason: expect.stringContaining("provider_started_new_session")
    });
    expect(fallback).toMatchObject({
      status: "fallback",
      nativeSessionId: "native-approval-fallback",
      fallbackOfSessionId: unavailable.id
    });
    expect(binding).toMatchObject({
      mode: "executor",
      executorSessionId: fallback.id
    });
    expect("listNodeSessionTranscriptEvents" in store).toBe(false);
  });

  it("keeps Agent approval rejection from rerunning or continuing the run", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "hiveward-worker-"));
    const store = new FileHivewardStore(path.join(tempDir, "hiveward-store.json"));
    await store.init();

    const delivery = createAgentNode("delivery", "Delivery");
    delivery.config = {
      ...delivery.config,
      approval: {
        enabled: true
      }
    };
    const blueprint = createBlueprint([delivery], []);
    const adapter = new ScriptedAdapter([
      createStartedAgentTask("task-agent-reject-1"),
      createStartedAgentTask("task-agent-reject-2")
    ], [
      createCompletedAgentTask("task-agent-reject-1", "succeeded", "draft answer"),
      createCompletedAgentTask("task-agent-reject-2", "succeeded", "implicit rerun answer")
    ]);
    const worker = new BlueprintWorker(store, adapter);

    const run = await worker.startRun(blueprint, "test-user");
    const waitingView = await waitForRunStatus(store, run.id, "waiting_approval");
    const waitingNode = waitingView.nodeRuns.find((nodeRun) => nodeRun.nodeId === "delivery")!;
    const approvalRequest = waitingView.approvalRequests?.find((request) => request.kind === "agent_proposal");
    if (!approvalRequest) throw new Error("Expected agent approval request.");

    await worker.applyApprovalRequest(blueprint, waitingView.run, approvalRequest.id, "reject", {
      comment: "Do not use this output."
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const rejectedView = await store.getRunView(run.id);
    const rejectedRequest = rejectedView?.approvalRequests?.find((request) => request.id === approvalRequest.id);
    const rejectedNode = rejectedView?.nodeRuns.find((nodeRun) => nodeRun.id === waitingNode.id);

    expect(rejectedView?.run.status).toBe("waiting_approval");
    expect(rejectedRequest).toMatchObject({ status: "rejected" });
    expect(rejectedNode).toMatchObject({
      status: "waiting_approval",
      output: expect.objectContaining({ reviewOutput: "draft answer" })
    });
    expect(adapter.calls).toHaveLength(1);
    expect(adapter.sendCalls).toHaveLength(0);
  });

  it("rejects removed Agent approval actions without mutating approval state", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "hiveward-worker-"));
    const store = new FileHivewardStore(path.join(tempDir, "hiveward-store.json"));
    await store.init();

    const delivery = createAgentNode("delivery", "Delivery");
    delivery.config = {
      ...delivery.config,
      approval: {
        enabled: true
      }
    };
    const blueprint = createBlueprint([delivery], []);
    const adapter = new ScriptedAdapter([
      createStartedAgentTask("task-agent-change-1")
    ], [
      createCompletedAgentTask("task-agent-change-1", "succeeded", "draft answer")
    ]);
    const worker = new BlueprintWorker(store, adapter);

    const run = await worker.startRun(blueprint, "test-user");
    const waitingView = await waitForRunStatus(store, run.id, "waiting_approval");
    const approvalRequest = waitingView.approvalRequests?.find((request) => request.kind === "agent_proposal");
    if (!approvalRequest) throw new Error("Expected agent approval request.");
    const binding = await store.getApprovalDiscussionBinding(approvalRequest.id);
    expect(binding).toMatchObject({
      approvalRequestId: approvalRequest.id,
      threadId: approvalRequest.threadId,
      mode: "executor",
      route: "agent_approval",
      resolverVersion: 1
    });
    const pendingApproval = (await store.listPendingApprovals()).find((approval) => approval.approvalRequestId === approvalRequest.id);
    expect(pendingApproval?.discussion).toEqual(resolveApprovalDiscussion({
      request: approvalRequest,
      binding,
      run: waitingView.run,
      nodeRuns: waitingView.nodeRuns,
      sessions: await store.listNodeExecutionSessions({ runId: run.id })
    }).capability);

    const unsafeApply = worker.applyApprovalRequest.bind(worker) as (
      blueprint: BlueprintDefinition,
      run: typeof waitingView.run,
      approvalRequestId: string,
      action: string,
      input?: { comment?: string; message?: string }
    ) => Promise<unknown>;
    await expect(unsafeApply(blueprint, waitingView.run, approvalRequest.id, "return_for_revision", {
      comment: "Regenerate with sources."
    })).rejects.toThrow("Unsupported approval action: return_for_revision");

    const unchangedView = await store.getRunView(run.id);
    const originalRequest = unchangedView?.approvalRequests?.find((request) => request.id === approvalRequest.id);
    const unchangedNode = unchangedView?.nodeRuns.find((nodeRun) => nodeRun.nodeId === "delivery");

    expect(adapter.calls).toHaveLength(1);
    expect(unchangedView?.run.status).toBe("waiting_approval");
    expect(originalRequest).toMatchObject({
      status: "pending",
      capabilities: { approve: true, reject: true, reply: true }
    });
    expect(unchangedNode).toMatchObject({
      status: "waiting_approval",
      output: expect.objectContaining({ reviewOutput: "draft answer" })
    });
    expect(await store.listApprovalDecisions(approvalRequest.id)).toEqual([]);
  });

  it("keeps approvalRequestId Agent approval replies append-only and approves the original output", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "hiveward-worker-"));
    const store = new FileHivewardStore(path.join(tempDir, "hiveward-store.json"));
    await store.init();

    const delivery = createAgentNode("delivery", "Delivery");
    delivery.config = {
      ...delivery.config,
      approval: {
        enabled: true
      }
    };
    const blueprint = createBlueprint([delivery], []);
    const adapter = new ScriptedAdapter([
      createStartedAgentTask("task-1"),
      createStartedAgentTask("task-2"),
      createStartedAgentTask("task-3")
    ], [
      createCompletedAgentTask("task-1", "succeeded", "draft answer"),
      createCompletedAgentTask("task-2", "succeeded", "first usable plan"),
      createCompletedAgentTask("task-3", "succeeded", "second plan")
    ]);
    const worker = new BlueprintWorker(store, adapter);

    const run = await worker.startRun(blueprint, "test-user");
    const waitingView = await waitForRunStatus(store, run.id, "waiting_approval");
    const approvalRequest = waitingView.approvalRequests?.find((request) => request.kind === "agent_proposal");
    if (!approvalRequest) throw new Error("Expected agent approval request.");
    expect("selectApprovalReply" in worker).toBe(false);
    expect(approvalRequest).not.toHaveProperty("selectedReplyId");

    await worker.applyApprovalRequest(blueprint, waitingView.run, approvalRequest.id, "reply", {
      message: "Give me a concrete plan."
    });
    const firstReplyView = await waitForRunStatus(store, run.id, "waiting_approval");
    const firstReplyNode = firstReplyView.nodeRuns.find((nodeRun) => nodeRun.nodeId === "delivery")!;
    const firstReplyOutput = firstReplyNode.output as {
      replies: Array<{ id: string; role: string; body: string }>;
    };
    expect(firstReplyOutput.replies).toEqual([]);
    expect((await store.listApprovalReplies({ approvalRequestId: approvalRequest.id })).map((reply) => [reply.actor, reply.body])).toEqual([
      ["user", "Give me a concrete plan."],
      ["agent", "first usable plan"]
    ]);

    await worker.applyApprovalRequest(blueprint, firstReplyView.run, approvalRequest.id, "reply", {
      message: "Try one more variant."
    });
    const secondReplyView = await waitForRunStatus(store, run.id, "waiting_approval");
    const secondReplyNode = secondReplyView.nodeRuns.find((nodeRun) => nodeRun.nodeId === "delivery")!;
    const secondReplyOutput = secondReplyNode.output as {
      reviewOutput: string;
      replies: Array<{ role: string; body: string }>;
    };

    expect(secondReplyOutput.reviewOutput).toBe("draft answer");
    expect(secondReplyOutput.replies).toEqual([]);
    expect(secondReplyOutput).not.toHaveProperty("selectedReplyId");
    expect((await store.listApprovalReplies({ approvalRequestId: approvalRequest.id })).map((reply) => [reply.actor, reply.body])).toEqual([
      ["user", "Give me a concrete plan."],
      ["agent", "first usable plan"],
      ["user", "Try one more variant."],
      ["agent", "second plan"]
    ]);
    expect(adapter.calls).toHaveLength(3);

    await worker.applyApprovalRequest(blueprint, secondReplyView.run, approvalRequest.id, "approve");
    const finalView = await waitForRunTerminal(store, run.id);
    const finalNode = finalView?.nodeRuns.find((nodeRun) => nodeRun.nodeId === "delivery");

    expect(finalView?.run.status).toBe("succeeded");
    expect(finalNode?.output).toMatchObject({
      approvedOutput: "draft answer",
      approval: {
        status: "approved"
      }
    });
    expect(finalNode?.output).not.toHaveProperty("selectedReplyId");
    expect((finalNode?.output as { approval?: Record<string, unknown> } | undefined)?.approval).not.toHaveProperty("selectedReplyId");
    expect(finalView?.approvalRequests?.find((request) => request.id === approvalRequest.id)).not.toHaveProperty("selectedReplyId");
    expect(finalView?.approvalDecisions?.map((decision) => decision.action)).toEqual(["reply", "reply", "approve"]);
    expect(finalView?.approvalDecisions?.some((decision) => "selectedReplyId" in decision)).toBe(false);
  });

  it("keeps the run waiting when an Agent approval discussion reply is added", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "hiveward-worker-"));
    const store = new FileHivewardStore(path.join(tempDir, "hiveward-store.json"));
    await store.init();

    const delivery = createAgentNode("delivery", "Delivery");
    delivery.config = {
      ...delivery.config,
      approval: {
        enabled: true
      }
    };
    const blueprint = createBlueprint([delivery], []);
    const adapter = new ScriptedAdapter([
      createStartedAgentTask("task-1"),
      createStartedAgentTask("task-2")
    ], [
      createCompletedAgentTask("task-1", "succeeded", "draft answer"),
      createCompletedAgentTask("task-2", "succeeded", "discussion acknowledgement")
    ]);
    const worker = new BlueprintWorker(store, adapter);

    const run = await worker.startRun(blueprint, "test-user");
    const waitingView = await waitForRunStatus(store, run.id, "waiting_approval");
    const waitingNode = waitingView.nodeRuns.find((nodeRun) => nodeRun.nodeId === "delivery")!;
    const approvalRequest = waitingView.approvalRequests?.find((request) => request.kind === "agent_proposal");
    if (!approvalRequest) throw new Error("Expected agent approval request.");

    await worker.applyApprovalRequest(blueprint, waitingView.run, approvalRequest.id, "reply", {
      message: "Try again."
    });
    const replyView = await waitForRunStatus(store, run.id, "waiting_approval");
    const waitingAfterReply = replyView.nodeRuns.find((nodeRun) => nodeRun.nodeId === "delivery");

    expect(replyView.run.status).toBe("waiting_approval");
    expect(waitingAfterReply?.status).toBe("waiting_approval");
    expect(waitingAfterReply?.error).toBeUndefined();
    expect(waitingAfterReply?.id).toBe(waitingNode.id);
    expect((await store.listApprovalReplies({ approvalRequestId: approvalRequest.id })).map((reply) => [reply.actor, reply.body])).toEqual([
      ["user", "Try again."],
      ["agent", "discussion acknowledgement"]
    ]);
    expect(adapter.calls).toHaveLength(2);
  });

  it("runs downstream nodes connected to a manager slot forward output", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "hiveward-worker-"));
    const store = new FileHivewardStore(path.join(tempDir, "hiveward-store.json"));
    await store.init();

    const slotAgent = createAgentNode("slot-agent", "Slot Agent", { x: 520, y: 180 });
    slotAgent.parentId = "slot-1";
    const followUp = createAgentNode("follow-up", "Follow Up", { x: 980, y: 180 });
    const blueprint = createBlueprint(
      [
        {
          id: "manager",
          type: "manager",
          position: { x: 80, y: 180 },
          config: {
            label: "Manager",
            portCount: 1,
            maxHandoffs: 1
          }
        },
        {
          id: "slot-1",
          type: "manager_slot",
          position: { x: 420, y: 120 },
          config: {
            label: "Slot 1",
            managerNodeId: "manager",
            slot: 1
          }
        },
        slotAgent,
        followUp
      ],
      [
        { id: "manager-slot", source: "manager", sourceHandle: "manager-out-1", target: "slot-1", targetHandle: "manager-slot-in" },
        { id: "slot-manager", source: "slot-1", sourceHandle: "manager-slot-out", target: "manager", targetHandle: "manager-in-1" },
        { id: "slot-agent", source: "slot-1", sourceHandle: "manager-slot-inner-out", target: "slot-agent" },
        { id: "agent-slot", source: "slot-agent", target: "slot-1", targetHandle: "manager-slot-inner-in" },
        { id: "slot-follow-up", source: "slot-1", sourceHandle: "manager-slot-forward-out", target: "follow-up" }
      ]
    );
    const adapter = new ScriptedAdapter([
      createStartedAgentTask("task-slot-agent"),
      createStartedAgentTask("task-follow-up")
    ], [
      createCompletedAgentTask("task-slot-agent", "succeeded", "slot output"),
      createCompletedAgentTask("task-follow-up", "succeeded", "follow-up output")
    ]);
    const worker = new BlueprintWorker(store, adapter);

    const run = await worker.startRun(blueprint, "test-user");
    const view = await waitForRunTerminal(store, run.id);
    const slotRun = view?.nodeRuns.find((nodeRun) => nodeRun.nodeId === "slot-1");
    const followUpRun = view?.nodeRuns.find((nodeRun) => nodeRun.nodeId === "follow-up");

    expect(view?.run.status).toBe("succeeded");
    expect(slotRun).toMatchObject({
      status: "succeeded",
      output: "slot output"
    });
    expect(followUpRun).toMatchObject({
      status: "succeeded",
      output: "follow-up output",
      input: {
        upstream: [
          expect.objectContaining({
            nodeId: "slot-1",
            humanReportMd: "slot output"
          })
        ]
      }
    });
    expect((followUpRun?.input as { upstream?: Array<Record<string, unknown>> } | undefined)?.upstream?.[0]).not.toHaveProperty("output");
    expect(adapter.calls.map((call) => call.agentName)).toEqual(["slot-agent", "follow-up"]);
  });

  it("keeps platform-owned fields authoritative when agent output contains matching names", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "hiveward-worker-"));
    const storePath = path.join(tempDir, "hiveward-store.json");
    const store = new FileHivewardStore(storePath);
    await store.init();

    const blueprint = createBlueprint([createAgentNode("brief", "Brief")], []);
    const agentOutput = JSON.stringify({
      status: "failed",
      nodeRunId: "agent-node-run",
      taskId: "agent-task",
      runId: "agent-run",
      sessionKey: "agent-session",
      inputTokens: 999,
      outputTokens: 999,
      error: "agent-claimed-error",
      source: "agent-source",
      nextNode: "agent-next",
      slotIndex: 42,
      resultRole: "ignore",
      artifactId: "agent-artifact",
      answer: "semantic content"
    });
    const adapter = new ScriptedAdapter([
      createStartedAgentTask("task-1")
    ], [
      {
        ...createCompletedAgentTask("task-1", "succeeded", agentOutput),
        usage: createUsageFact(7, 11, 0.012345)
      }
    ]);
    const worker = new BlueprintWorker(store, adapter);

    const run = await worker.startRun(blueprint, "test-user");
    const view = await waitForRunTerminal(store, run.id);
    const nodeRun = view?.nodeRuns.find((candidate) => candidate.nodeId === "brief");
    const index = JSON.parse(readFileSync(storePath, "utf8")) as {
      runIndex?: Array<{ id: string; totalInputTokens: number; totalOutputTokens: number; totalCostUsd: number }>;
    };

    expect(nodeRun).toMatchObject({
      status: "succeeded",
      output: agentOutput,
      usage: {
        inputTokens: 7,
        outputTokens: 11,
        costUsd: 0.012345
      },
      runtimeRef: {
        taskId: "task-1",
        runId: "task-1-run",
        sessionKey: "agent:main:main",
        source: "openclaw"
      }
    });
    expect(nodeRun?.error).toBeUndefined();
    expect(view?.run).toMatchObject({
      id: run.id,
      status: "succeeded",
      totalInputTokens: 7,
      totalOutputTokens: 11,
      totalCostUsd: 0.012345
    });
    expect(view?.finalResult?.candidates[0]).toMatchObject({
      nodeId: "brief",
      resultRole: "auto",
      output: agentOutput
    });
    expect(index.runIndex?.find((candidate) => candidate.id === run.id)).toMatchObject({
      totalInputTokens: 7,
      totalOutputTokens: 11,
      totalCostUsd: 0.012345
    });
  });

  it("skips the branch that does not match a condition result", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "hiveward-worker-"));
    const store = new FileHivewardStore(path.join(tempDir, "hiveward-store.json"));
    await store.init();

    const blueprint = createBlueprint(
      [
        createAgentNode("brief", "Brief"),
        {
          id: "gate",
          type: "condition",
          position: { x: 360, y: 180 },
          config: {
            label: "Gate",
            expression: "true"
          }
        },
        createAgentNode("yes", "Yes branch"),
        createAgentNode("no", "No branch")
      ],
      [
        { id: "edge-1", source: "brief", target: "gate", condition: "success" },
        { id: "edge-2", source: "gate", target: "yes", condition: "true" },
        { id: "edge-3", source: "gate", target: "no", condition: "false" }
      ]
    );
    const worker = new BlueprintWorker(
      store,
      new ScriptedAdapter([
        createStartedAgentTask("task-1"),
        createStartedAgentTask("task-2")
      ], [
        createCompletedAgentTask("task-1", "succeeded", "brief ready"),
        createCompletedAgentTask("task-2", "succeeded", "yes path")
      ])
    );

    const run = await worker.startRun(blueprint, "test-user");
    const view = await waitForRunTerminal(store, run.id);

    expect(run.status).toBe("running");
    expect(view?.run.status).toBe("succeeded");
    expect(view?.nodeRuns.find((nodeRun) => nodeRun.nodeId === "gate")?.input).toMatchObject({
      upstream: [expect.objectContaining({ nodeId: "brief", nodeLabel: "Brief", status: "succeeded", humanReportMd: "brief ready" })]
    });
    expect(view?.nodeRuns.find((nodeRun) => nodeRun.nodeId === "gate")?.output).toEqual({ result: true });
    expect(view?.nodeRuns.find((nodeRun) => nodeRun.nodeId === "yes")?.status).toBe("succeeded");
    expect(view?.nodeRuns.find((nodeRun) => nodeRun.nodeId === "no")?.status).toBe("skipped");
  });

  it("runs sibling agent branches in parallel after a shared upstream node succeeds", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "hiveward-worker-"));
    const store = new FileHivewardStore(path.join(tempDir, "hiveward-store.json"));
    await store.init();

    const blueprint = createBlueprint(
      [
        createAgentNode("brief", "Brief"),
        createAgentNode("alpha", "Alpha", { x: 460, y: 120 }),
        createAgentNode("beta", "Beta", { x: 460, y: 260 })
      ],
      [
        { id: "edge-1", source: "brief", target: "alpha", condition: "success" },
        { id: "edge-2", source: "brief", target: "beta", condition: "success" }
      ]
    );
    const adapter = new ScriptedAdapter([
      createStartedAgentTask("task-1"),
      createStartedAgentTask("task-2"),
      createStartedAgentTask("task-3")
    ], [
      createCompletedAgentTask("task-1", "succeeded", "brief ready"),
      createCompletedAgentTask("task-2", "succeeded", "alpha ready"),
      createCompletedAgentTask("task-3", "succeeded", "beta ready")
    ]);
    const worker = new BlueprintWorker(store, adapter);

    const run = await worker.startRun(blueprint, "test-user");
    const view = await waitForRunTerminal(store, run.id);

    expect(run.status).toBe("running");
    expect(view?.run.status).toBe("succeeded");
    expect(view?.nodeRuns.find((nodeRun) => nodeRun.nodeId === "alpha")?.status).toBe("succeeded");
    expect(view?.nodeRuns.find((nodeRun) => nodeRun.nodeId === "beta")?.status).toBe("succeeded");
    expect(adapter.calls.slice(1).every((call) => Array.isArray((call.input as { upstream?: unknown[] }).upstream))).toBe(true);
    expect((adapter.calls[1]?.input as { upstream?: Array<{ humanReportMd?: string }> }).upstream?.[0]?.humanReportMd).toBe("brief ready");
    expect((adapter.calls[2]?.input as { upstream?: Array<{ humanReportMd?: string }> }).upstream?.[0]?.humanReportMd).toBe("brief ready");
  });

  it("approves the requested Agent approval when multiple approvals are waiting", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "hiveward-worker-"));
    const store = new FileHivewardStore(path.join(tempDir, "hiveward-store.json"));
    await store.init();
    const worker = new BlueprintWorker(
      store,
      new ScriptedAdapter([
        createStartedAgentTask("task-approval-a"),
        createStartedAgentTask("task-approval-b")
      ], [
        createCompletedAgentTask("task-approval-a", "succeeded", "A ready"),
        createCompletedAgentTask("task-approval-b", "succeeded", "B ready")
      ])
    );
    const approvalA = createAgentNode("approval-a", "Approval A");
    approvalA.config = {
      ...approvalA.config,
      approval: { enabled: true }
    };
    const approvalB = createAgentNode("approval-b", "Approval B", { x: 260, y: 0 });
    approvalB.config = {
      ...approvalB.config,
      approval: { enabled: true }
    };
    const blueprint = createBlueprint(
      [approvalA, approvalB],
      []
    );

    const run = await worker.startRun(blueprint, "test-user");
    const firstApproval = await waitForNodeRun(store, run.id, "approval-a", (nodeRun) => nodeRun.status === "waiting_approval");
    const secondApproval = await waitForNodeRun(store, run.id, "approval-b", (nodeRun) => nodeRun.status === "waiting_approval");
    const waitingRun = await waitForRunStatus(store, run.id, "waiting_approval");
    const secondApprovalExpectedOutput = secondApproval.runtimeRef?.sourceId === "task-approval-a" ? "A ready" : "B ready";

    await worker.approveRun(blueprint, waitingRun.run, secondApproval.id);
    await waitForNodeRun(store, run.id, "approval-b", (nodeRun) => nodeRun.status === "succeeded");
    const latestView = await waitForRunStatus(store, run.id, "waiting_approval");

    expect(latestView.nodeRuns.find((nodeRun) => nodeRun.id === firstApproval.id)?.status).toBe("waiting_approval");
    expect(latestView.nodeRuns.find((nodeRun) => nodeRun.id === secondApproval.id)?.status).toBe("succeeded");
    expect(["task-approval-a", "task-approval-b"]).toContain(secondApproval.runtimeRef?.sourceId);
    expect(latestView.nodeRuns.find((nodeRun) => nodeRun.id === secondApproval.id)?.output).toBe(secondApprovalExpectedOutput);
  });

  it("passes SDK node configuration to the adapter and persists provider refs", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "hiveward-worker-"));
    const store = new FileHivewardStore(path.join(tempDir, "hiveward-store.json"));
    await store.init();

    const blueprint = createBlueprint(
      [
        {
          ...createAgentNode("sdk-node", "SDK Node"),
          runtimeId: "codex",
          config: {
            label: "SDK Node",
            agentName: "codex-runner",
            prompt: "Return JSON.",
            skillIds: ["hiveward-leader"],
            modelId: "gpt-5.4",
            permissionProfile: "read_only",
            workingDirectory: tempDir,
            timeoutMs: 120000,
            outputSchema: { type: "object", required: ["ok"], properties: { ok: { type: "boolean" } } },
            tools: []
          }
        }
      ],
      []
    );
    const adapter = new ScriptedAdapter([
      {
        ...createStartedAgentTask("codex-task-1"),
        source: "codex",
        sessionKey: "codex-session-start"
      }
    ], [
      {
        ...createCompletedAgentTask("codex-task-1", "succeeded", {
          humanReportMd: "## SDK node report\n\n## Delivery location\n\n- No new deliverable produced in this step.",
          result: { ok: true }
        }),
        source: "codex",
        sessionKey: "codex-session-final"
      }
    ]);
    const worker = new BlueprintWorker(store, adapter);

    const run = await worker.startRun(blueprint, "test-user");
    const view = await waitForRunTerminal(store, run.id);

    expect(adapter.calls[0]).toMatchObject({
      source: "codex",
      agentName: "codex-runner",
      skillIds: ["hiveward-leader"],
      modelId: "gpt-5.4",
      permissionProfile: "read_only",
      workingDirectory: tempDir,
      timeoutMs: 120000,
      outputSchema: {
        type: "object",
        required: ["humanReportMd", "result"],
        properties: {
          humanReportMd: { type: "string" },
          handoffJson: { type: ["object", "null"] },
          result: { type: "object", required: ["ok"], properties: { ok: { type: "boolean" } } }
        }
      }
    });
    expect(adapter.waitCalls[0]).toMatchObject({
      source: "codex",
      sessionKey: "codex-session-start"
    });
    expect(view?.nodeRuns[0]?.runtimeRef).toMatchObject({
      source: "codex",
      sourceId: "codex-task-1",
      sessionKey: "codex-session-final"
    });
    expect(view?.nodeRuns[0]).not.toHaveProperty("openclawRef");
    expect(view?.run.runtimeRefs[0]?.source).toBe("codex");
    expect(view?.run).not.toHaveProperty("openclawRefs");
  });

  it("lets a manager route work to a nested manager", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "hiveward-worker-"));
    const store = new FileHivewardStore(path.join(tempDir, "hiveward-store.json"));
    await store.init();

    const blueprint = createBlueprint(
      [
        {
          id: "parent-manager",
          type: "manager",
          position: { x: 80, y: 180 },
          config: {
            label: "Parent Manager",
            portCount: 2,
            maxHandoffs: 3,
            instructions: "Delegate to the child manager, then run the parent slot."
          }
        },
        {
          id: "child-manager",
          type: "manager",
          position: { x: 420, y: 180 },
          config: {
            label: "Child Manager",
            portCount: 1,
            maxHandoffs: 3,
            instructions: "Run the implementation slot."
          }
        },
        createAgentNode("implementation", "Implementation", { x: 760, y: 180 }),
        {
          id: "parent-slot-2",
          type: "manager_slot",
          position: { x: 420, y: 420 },
          config: {
            label: "Slot 2",
            managerNodeId: "parent-manager",
            slot: 2
          }
        },
        {
          ...createAgentNode("parent-followup", "Parent Followup", { x: 120, y: 100 }),
          parentId: "parent-slot-2"
        }
      ],
      [
        { id: "parent-child", source: "parent-manager", sourceHandle: "manager-out-1", target: "child-manager", condition: "success" },
        { id: "child-parent", source: "child-manager", target: "parent-manager", targetHandle: "manager-in-1", condition: "success" },
        { id: "child-implementation", source: "child-manager", sourceHandle: "manager-out-1", target: "implementation", condition: "success" },
        { id: "implementation-child", source: "implementation", target: "child-manager", targetHandle: "manager-in-1", condition: "success" },
        { id: "parent-slot-2-out", source: "parent-manager", sourceHandle: "manager-out-2", target: "parent-slot-2", targetHandle: "manager-slot-in", condition: "success" },
        { id: "parent-slot-2-in", source: "parent-slot-2", sourceHandle: "manager-slot-out", target: "parent-manager", targetHandle: "manager-in-2", condition: "success" },
        { id: "parent-slot-2-start", source: "parent-slot-2", sourceHandle: "manager-slot-inner-out", target: "parent-followup", condition: "success" },
        { id: "parent-slot-2-finish", source: "parent-followup", target: "parent-slot-2", targetHandle: "manager-slot-inner-in", condition: "success" }
      ]
    );
    const adapter = new ScriptedAdapter([
      createStartedAgentTask("task-1"),
      createStartedAgentTask("task-2")
    ], [
      createCompletedAgentTask("task-1", "succeeded", JSON.stringify({ status: "complete", result: "implemented" })),
      createCompletedAgentTask("task-2", "succeeded", JSON.stringify({ status: "complete", result: "parent followup complete" }))
    ]);
    const worker = new BlueprintWorker(store, adapter);

    const run = await worker.startRun(blueprint, "test-user");
    const view = await waitForRunTerminal(store, run.id);

    expect(view?.run.status).toBe("succeeded");
    expect(view?.nodeRuns.find((nodeRun) => nodeRun.nodeId === "parent-manager")?.status).toBe("succeeded");
    expect(view?.nodeRuns.find((nodeRun) => nodeRun.nodeId === "child-manager")?.status).toBe("succeeded");
    expect(view?.nodeRuns.find((nodeRun) => nodeRun.nodeId === "implementation")?.status).toBe("succeeded");
    expect(view?.nodeRuns.find((nodeRun) => nodeRun.nodeId === "parent-slot-2")?.status).toBe("succeeded");
    expect(view?.nodeRuns.find((nodeRun) => nodeRun.nodeId === "parent-followup")?.status).toBe("succeeded");
    expect(adapter.calls.map((call) => call.agentName)).toEqual(["implementation", "parent-followup"]);
    expect((adapter.calls[0]?.input as { upstream?: Array<{ nodeId: string }> }).upstream?.[0]?.nodeId).toBe("parent-manager");
    expect((adapter.calls[1]?.input as { upstream?: Array<{ nodeId: string }> }).upstream?.[0]?.nodeId).toBe("parent-slot-2");
  });

  it("executes a manager slot box as a nested blueprint and returns its output to the manager", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "hiveward-worker-"));
    const store = new FileHivewardStore(path.join(tempDir, "hiveward-store.json"));
    await store.init();

    const blueprint = createBlueprint(
      [
        {
          id: "manager",
          type: "manager",
          position: { x: 80, y: 180 },
          config: {
            label: "Manager",
            portCount: 1,
            maxHandoffs: 3,
            instructions: "Run the slot blueprint."
          }
        },
        {
          id: "manager-slot-1",
          type: "manager_slot",
          position: { x: 420, y: 120 },
          config: {
            label: "Slot 1",
            managerNodeId: "manager",
            slot: 99
          }
        },
        {
          ...createAgentNode("slot-agent", "Slot Agent", { x: 120, y: 100 }),
          parentId: "manager-slot-1"
        }
      ],
      [
        { id: "manager-slot-out", source: "manager", sourceHandle: "manager-out-1", target: "manager-slot-1", targetHandle: "manager-slot-in", condition: "success" },
        { id: "slot-manager-in", source: "manager-slot-1", sourceHandle: "manager-slot-out", target: "manager", targetHandle: "manager-in-1", condition: "success" },
        { id: "slot-start", source: "manager-slot-1", sourceHandle: "manager-slot-inner-out", target: "slot-agent", condition: "success" },
        { id: "slot-finish", source: "slot-agent", target: "manager-slot-1", targetHandle: "manager-slot-inner-in", condition: "success" }
      ]
    );
    const adapter = new ScriptedAdapter([
      createStartedAgentTask("task-1")
    ], [
      createCompletedAgentTask("task-1", "succeeded", JSON.stringify({ status: "complete", result: "slot done" }))
    ]);
    const worker = new BlueprintWorker(store, adapter);

    const run = await worker.startRun(blueprint, "test-user");
    const view = await waitForRunTerminal(store, run.id);

    expect(view?.run.status).toBe("succeeded");
    expect(view?.nodeRuns.find((nodeRun) => nodeRun.nodeId === "manager-slot-1")?.status).toBe("succeeded");
    expect(view?.nodeRuns.find((nodeRun) => nodeRun.nodeId === "slot-agent")?.status).toBe("succeeded");
    expect(view?.nodeRuns.find((nodeRun) => nodeRun.nodeId === "manager")?.output).toMatchObject({
      status: "completed"
    });
    expect(adapter.calls[0]?.agentName).toBe("slot-agent");
    expect((adapter.calls[0]?.input as { upstream?: Array<{ nodeId: string }> }).upstream?.[0]?.nodeId).toBe("manager-slot-1");
    expect(
      (
        (adapter.calls[0]?.input as { upstream?: Array<{ context?: { manager?: { slot?: number } } }> }).upstream?.[0]?.context
      )?.manager?.slot
    ).toBe(1);
  });

  it("fails a manager run without leaving manager slot children running", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "hiveward-worker-"));
    const store = new FileHivewardStore(path.join(tempDir, "hiveward-store.json"));
    await store.init();

    const blueprint = createBlueprint(
      [
        {
          id: "manager",
          type: "manager",
          position: { x: 80, y: 180 },
          config: {
            label: "Manager",
            portCount: 1,
            maxHandoffs: 3,
            instructions: "Run the slot blueprint."
          }
        },
        {
          id: "manager-slot-1",
          type: "manager_slot",
          position: { x: 420, y: 120 },
          config: {
            label: "Slot 1",
            managerNodeId: "manager",
            slot: 1
          }
        },
        {
          ...createAgentNode("slot-agent", "Slot Agent", { x: 120, y: 100 }),
          parentId: "manager-slot-1"
        }
      ],
      [
        { id: "manager-slot-out", source: "manager", sourceHandle: "manager-out-1", target: "manager-slot-1", targetHandle: "manager-slot-in", condition: "success" },
        { id: "slot-manager-in", source: "manager-slot-1", sourceHandle: "manager-slot-out", target: "manager", targetHandle: "manager-in-1", condition: "success" },
        { id: "slot-start", source: "manager-slot-1", sourceHandle: "manager-slot-inner-out", target: "slot-agent", condition: "success" },
        { id: "slot-finish", source: "slot-agent", target: "manager-slot-1", targetHandle: "manager-slot-inner-in", condition: "success" }
      ]
    );
    const worker = new BlueprintWorker(
      store,
      new ScriptedAdapter([
        createStartedAgentTask("task-1")
      ], [
        new Error("protocol mismatch")
      ])
    );

    const run = await worker.startRun(blueprint, "test-user");
    const view = await waitForRunTerminal(store, run.id);

    expect(view?.run.status).toBe("failed");
    expect(view?.nodeRuns.find((nodeRun) => nodeRun.nodeId === "manager")).toMatchObject({
      status: "failed",
      error: "protocol mismatch"
    });
    expect(view?.nodeRuns.find((nodeRun) => nodeRun.nodeId === "manager-slot-1")?.status).toBe("cancelled");
    expect(view?.nodeRuns.find((nodeRun) => nodeRun.nodeId === "slot-agent")?.status).toBe("cancelled");
    expect(view?.nodeRuns.some((nodeRun) => nodeRun.status === "running" || nodeRun.status === "queued")).toBe(false);
    expect(view?.finalResult?.failedNode?.nodeId).toBe("manager");
  });

  it("runs all child nodes in a parallel manager slot from one manager handoff", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "hiveward-worker-"));
    const store = new FileHivewardStore(path.join(tempDir, "hiveward-store.json"));
    await store.init();

    const blueprint = createBlueprint(
      [
        {
          id: "manager",
          type: "manager",
          position: { x: 80, y: 180 },
          config: {
            label: "Manager",
            portCount: 1,
            maxHandoffs: 3,
            instructions: "Run the parallel slot."
          }
        },
        {
          id: "parallel-slot",
          type: "manager_slot",
          position: { x: 420, y: 120 },
          config: {
            label: "Parallel Slot",
            managerNodeId: "manager",
            slot: 1,
            parallelLaneCount: 2
          }
        },
        {
          ...createAgentNode("alpha", "Alpha", { x: 120, y: 100 }),
          parentId: "parallel-slot"
        },
        {
          ...createAgentNode("beta", "Beta", { x: 120, y: 240 }),
          parentId: "parallel-slot"
        }
      ],
      [
        { id: "manager-slot-out", source: "manager", sourceHandle: "manager-out-1", target: "parallel-slot", targetHandle: "manager-slot-in", condition: "success" },
        { id: "slot-manager-in", source: "parallel-slot", sourceHandle: "manager-slot-out", target: "manager", targetHandle: "manager-in-1", condition: "success" }
      ]
    );
    const adapter = new ScriptedAdapter([
      createStartedAgentTask("task-1"),
      createStartedAgentTask("task-2")
    ], [
      createCompletedAgentTask("task-1", "succeeded", "done"),
      createCompletedAgentTask("task-2", "succeeded", "done")
    ]);
    const worker = new BlueprintWorker(store, adapter);

    const run = await worker.startRun(blueprint, "test-user");
    const view = await waitForRunTerminal(store, run.id);
    const slotOutput = view?.nodeRuns.find((nodeRun) => nodeRun.nodeId === "parallel-slot")?.output;

    expect(view?.run.status).toBe("succeeded");
    expect(adapter.calls.map((call) => call.agentName).sort()).toEqual(["alpha", "beta"]);
    expect(adapter.calls.every((call) => (call.input as { upstream?: Array<{ nodeId: string }> }).upstream?.[0]?.nodeId === "parallel-slot")).toBe(true);
    expect(typeof slotOutput).toBe("string");
    const parsedSlotOutput = JSON.parse(String(slotOutput)) as { outputs?: unknown[] };
    expect(parsedSlotOutput.outputs).toHaveLength(2);
    expect(parsedSlotOutput.outputs).toEqual(expect.arrayContaining([
      { nodeId: "alpha", nodeLabel: "Alpha", output: "done" },
      { nodeId: "beta", nodeLabel: "Beta", output: "done" }
    ]));
    expect(view?.nodeRuns.find((nodeRun) => nodeRun.nodeId === "manager")?.output).toMatchObject({
      status: "completed"
    });
  });

  it("runs a one-lane manager slot as a single scoped chain", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "hiveward-worker-"));
    const store = new FileHivewardStore(path.join(tempDir, "hiveward-store.json"));
    await store.init();

    const blueprint = createBlueprint(
      [
        {
          id: "manager",
          type: "manager",
          position: { x: 80, y: 180 },
          config: {
            label: "Manager",
            portCount: 1,
            maxHandoffs: 3,
            instructions: "Run the single slot."
          }
        },
        {
          id: "single-slot",
          type: "manager_slot",
          position: { x: 420, y: 120 },
          config: {
            label: "Single Slot",
            managerNodeId: "manager",
            slot: 1,
            parallelLaneCount: 1
          }
        },
        {
          ...createAgentNode("alpha", "Alpha", { x: 120, y: 100 }),
          parentId: "single-slot"
        },
        {
          ...createAgentNode("beta", "Beta", { x: 360, y: 100 }),
          parentId: "single-slot"
        }
      ],
      [
        { id: "manager-slot-out", source: "manager", sourceHandle: "manager-out-1", target: "single-slot", targetHandle: "manager-slot-in", condition: "success" },
        { id: "slot-manager-in", source: "single-slot", sourceHandle: "manager-slot-out", target: "manager", targetHandle: "manager-in-1", condition: "success" },
        { id: "slot-alpha", source: "single-slot", sourceHandle: "manager-slot-inner-out", target: "alpha", condition: "success" },
        { id: "alpha-beta", source: "alpha", target: "beta", condition: "success" },
        { id: "beta-slot", source: "beta", target: "single-slot", targetHandle: "manager-slot-inner-in", condition: "success" }
      ]
    );
    const adapter = new ScriptedAdapter([
      createStartedAgentTask("task-alpha"),
      createStartedAgentTask("task-beta")
    ], [
      createCompletedAgentTask("task-alpha", "succeeded", "alpha done"),
      createCompletedAgentTask("task-beta", "succeeded", "beta done")
    ]);
    const worker = new BlueprintWorker(store, adapter);

    const run = await worker.startRun(blueprint, "test-user");
    const view = await waitForRunTerminal(store, run.id);
    const slotOutput = view?.nodeRuns.find((nodeRun) => nodeRun.nodeId === "single-slot")?.output;

    expect(view?.run.status).toBe("succeeded");
    expect(adapter.calls.map((call) => call.agentName)).toEqual(["alpha", "beta"]);
    expect((adapter.calls[0]?.input as { upstream?: Array<{ nodeId: string }> }).upstream?.[0]?.nodeId).toBe("single-slot");
    expect((adapter.calls[1]?.input as { upstream?: Array<{ nodeId: string; humanReportMd?: string }> }).upstream?.[0]).toMatchObject({
      nodeId: "alpha",
      humanReportMd: "alpha done"
    });
    expect(slotOutput).toBe("beta done");
  });

  it("runs sequential manager slots in port order without treating slot output as a routing decision", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "hiveward-worker-"));
    const store = new FileHivewardStore(path.join(tempDir, "hiveward-store.json"));
    await store.init();

    const blueprint = createBlueprint(
      [
        {
          id: "manager",
          type: "manager",
          runtimeId: "openclaw",
          position: { x: 80, y: 180 },
          config: {
            label: "Manager",
            portCount: 2,
            maxHandoffs: 4,
            instructions: "Run both connected slots in order."
          }
        },
        createAgentNode("first", "First", { x: 420, y: 120 }),
        createAgentNode("second", "Second", { x: 420, y: 280 })
      ],
      [
        { id: "manager-first", source: "manager", sourceHandle: "manager-out-1", target: "first", condition: "success" },
        { id: "first-manager", source: "first", target: "manager", targetHandle: "manager-in-1", condition: "success" },
        { id: "manager-second", source: "manager", sourceHandle: "manager-out-2", target: "second", condition: "success" },
        { id: "second-manager", source: "second", target: "manager", targetHandle: "manager-in-2", condition: "success" }
      ]
    );
    const adapter = new ScriptedAdapter([
      createStartedAgentTask("task-first"),
      createStartedAgentTask("task-second")
    ], [
      createCompletedAgentTask("task-first", "succeeded", JSON.stringify({ status: "complete", reason: "first slot is done" })),
      createCompletedAgentTask("task-second", "succeeded", "second slot receipt")
    ]);
    const worker = new BlueprintWorker(store, adapter);

    const run = await worker.startRun(blueprint, "test-user");
    const view = await waitForRunTerminal(store, run.id);
    const managerOutput = view?.nodeRuns.find((nodeRun) => nodeRun.nodeId === "manager")?.output;

    expect(view?.run.status).toBe("succeeded");
    expect(adapter.calls.map((call) => call.agentName)).toEqual(["first", "second"]);
    expect(view?.nodeRuns.find((nodeRun) => nodeRun.nodeId === "first")?.status).toBe("succeeded");
    expect(view?.nodeRuns.find((nodeRun) => nodeRun.nodeId === "second")?.status).toBe("succeeded");
    expect(managerOutput).toMatchObject({
      status: "completed",
      reason: "manager_reached_final_connected_slot"
    });
  });

  it("resumes an interrupted manager-slot run from the persisted OpenClaw task ref", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "hiveward-worker-"));
    const store = new FileHivewardStore(path.join(tempDir, "hiveward-store.json"));
    await store.init();

    const blueprint = createBlueprint(
      [
        {
          id: "manager",
          type: "manager",
          position: { x: 120, y: 120 },
          config: {
            label: "Manager",
            portCount: 1,
            maxHandoffs: 3,
            instructions: "Run the slot."
          }
        },
        {
          id: "slot-1",
          type: "manager_slot",
          position: { x: 420, y: 120 },
          config: {
            label: "Slot 1",
            managerNodeId: "manager",
            slot: 1
          }
        },
        {
          ...createAgentNode("builder", "Builder", { x: 120, y: 100 }),
          parentId: "slot-1"
        }
      ],
      [
        { id: "manager-slot", source: "manager", sourceHandle: "manager-out-1", target: "slot-1", targetHandle: "manager-slot-in", condition: "success" },
        { id: "slot-manager", source: "slot-1", sourceHandle: "manager-slot-out", target: "manager", targetHandle: "manager-in-1", condition: "success" },
        { id: "slot-start", source: "slot-1", sourceHandle: "manager-slot-inner-out", target: "builder", condition: "success" },
        { id: "slot-finish", source: "builder", target: "slot-1", targetHandle: "manager-slot-inner-in", condition: "success" }
      ]
    );
    const blockedAdapter = new BlockingAdapter(createStartedAgentTask("task-1"));
    const firstWorker = new BlueprintWorker(store, blockedAdapter, { nodeRunLeaseMs: 100 });

    const run = await firstWorker.startRun(blueprint, "test-user");
    await waitForNodeRun(store, run.id, "builder", (nodeRun) =>
      nodeRun.status === "running" && nodeRun.runtimeRef?.taskId === "task-1"
    );
    await new Promise((resolve) => setTimeout(resolve, 150));

    const recoveryAdapter = new ScriptedAdapter([], [
      createCompletedAgentTask("task-1", "succeeded", "built html")
    ]);
    const recoveryWorker = new BlueprintWorker(store, recoveryAdapter);
    await recoveryWorker.resumeActiveRuns();

    const view = await waitForRunTerminal(store, run.id);
    expect(recoveryAdapter.waitCalls[0]).toMatchObject({ taskId: "task-1", runId: "task-1-run" });
    expect(view?.run.status).toBe("succeeded");
    expect(view?.nodeRuns.find((nodeRun) => nodeRun.nodeId === "builder")?.status).toBe("succeeded");
    expect(view?.nodeRuns.find((nodeRun) => nodeRun.nodeId === "slot-1")?.status).toBe("succeeded");
    expect(view?.nodeRuns.find((nodeRun) => nodeRun.nodeId === "manager")?.status).toBe("succeeded");
  });

  it("does not treat unassigned manager slot boxes as global start nodes", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "hiveward-worker-"));
    const store = new FileHivewardStore(path.join(tempDir, "hiveward-store.json"));
    await store.init();

    const blueprint = createBlueprint(
      [
        createAgentNode("brief", "Brief"),
        {
          id: "unassigned-slot",
          type: "manager_slot",
          position: { x: 420, y: 120 },
          config: {
            label: "Slot 1",
            managerNodeId: "",
            slot: 1
          }
        }
      ],
      []
    );
    const adapter = new ScriptedAdapter([
      createStartedAgentTask("task-1")
    ], [
      createCompletedAgentTask("task-1", "succeeded", "brief ready")
    ]);
    const worker = new BlueprintWorker(store, adapter);

    const run = await worker.startRun(blueprint, "test-user");
    const view = await waitForRunTerminal(store, run.id);

    expect(view?.run.status).toBe("succeeded");
    expect(view?.nodeRuns.find((nodeRun) => nodeRun.nodeId === "brief")?.status).toBe("succeeded");
    expect(view?.nodeRuns.some((nodeRun) => nodeRun.nodeId === "unassigned-slot")).toBe(false);
  });

  it("forbids historical self-iteration fields and commands from starting or resuming manager execution", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "hiveward-worker-"));
    const store = new FileHivewardStore(path.join(tempDir, "hiveward-store.json"));
    await store.init();

    const blueprint = createBlueprint([
      {
        id: "historical-manager",
        type: "manager",
        runtimeId: "openclaw",
        position: { x: 80, y: 180 },
        config: {
          label: "Historical Manager",
          lifecycleMode: "self_iteration",
          dispatchMode: "self_dispatch",
          portCount: 1,
          maxHandoffs: 1,
          instructions: "Historical fields must not own execution."
        } as unknown as ManagerNodeConfig
      }
    ], []);
    const adapter = new ScriptedAdapter([], []);
    const worker = new BlueprintWorker(store, adapter);

    const run = await worker.startRun(blueprint, "test-user");
    const view = await waitForRunTerminal(store, run.id);

    expect(view?.iterationSessions ?? []).toHaveLength(0);
    expect(view?.approvalRequests ?? []).toEqual([]);
    expect(view?.runCommands?.map((command) => command.kind)).toEqual(["regular_run"]);
    expect(adapter.calls).toHaveLength(0);

    const historicalRun = await store.createBlueprintRun(blueprint, "test-user");
    const runningHistoricalRun = { ...historicalRun, status: "running" as const };
    await store.updateBlueprintRun(runningHistoricalRun);
    await store.createRunCommandIfAbsent({
      id: "historical-command",
      commandKey: "historical-command",
      blueprintId: blueprint.id,
      runId: historicalRun.id,
      roundId: "historical-round",
      kind: "self_iteration_prepare_round" as unknown as RunCommand["kind"],
      status: "running",
      currentRevision: 0,
      currentStep: "research_resolution",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    await worker.resumeActiveRuns();

    const [historicalCommand] = await store.listRunCommands({ runId: historicalRun.id });
    expect(historicalCommand).toMatchObject({
      status: "failed",
      error: "保留为历史事实，不参与决策"
    });
    expect(adapter.calls).toHaveLength(0);
  });

  it("stores agent reports and passes report handoff and artifact refs downstream without raw output", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "hiveward-worker-"));
    const store = new FileHivewardStore(path.join(tempDir, "hiveward-store.json"));
    await store.init();

    const producer = createAgentNode("producer", "Producer", { x: 120, y: 180 });
    const consumer = createAgentNode("consumer", "Consumer", { x: 360, y: 180 });
    const blueprint = createBlueprint([
      producer,
      consumer
    ], [
      { id: "edge-producer-consumer", source: "producer", target: "consumer" }
    ]);
    const adapter = new ScriptedAdapter([
      createStartedAgentTask("task-producer"),
      createStartedAgentTask("task-consumer")
    ], [
      createCompletedAgentTask("task-producer", "succeeded", {
        humanReportMd: "## Producer report\n\nThe producer made structured facts for the next agent.",
        handoffJson: { facts: ["handoff fact"], next: "consumer" },
        result: {
          ok: true,
          rawHtml: "<!doctype html><html><body>large deliverable should stay behind an artifact ref</body></html>"
        },
        artifacts: [{
          kind: "html",
          title: "Producer preview",
          content: "<!doctype html><html><body>preview</body></html>"
        }]
      }),
      createCompletedAgentTask("task-consumer", "succeeded", {
        summary: "Consumer used the handoff.",
        result: { done: true }
      })
    ]);
    const worker = new BlueprintWorker(store, adapter);

    const run = await worker.startRun(blueprint, "test-user");
    const completed = await waitForRunTerminal(store, run.id);
    const producerRun = completed?.nodeRuns.find((nodeRun) => nodeRun.nodeId === "producer");
    const consumerRun = completed?.nodeRuns.find((nodeRun) => nodeRun.nodeId === "consumer");
    const upstream = isRecord(consumerRun?.input) && Array.isArray(consumerRun.input.upstream)
      ? consumerRun.input.upstream
      : [];

    expect(adapter.calls[0]?.prompt).toContain("humanReportMd");
    expect(adapter.calls[0]?.prompt).toContain("handoffJson");
    expect(adapter.calls[0]?.prompt).toContain("downstream consumers");
    expect(adapter.calls[1]?.prompt).toContain("humanReportMd");
    expect(adapter.calls[1]?.prompt).toContain("handoffJson");
    expect(completed?.agentHumanReports).toEqual(expect.arrayContaining([
      expect.objectContaining({
        nodeId: "producer",
        nodeRunId: producerRun?.id,
        source: "agent",
        bodyMd: expect.stringContaining("Producer report")
      }),
      expect.objectContaining({
        nodeId: "consumer",
        source: "fallback",
        bodyMd: expect.stringContaining("Consumer used the handoff")
      })
    ]));
    expect(completed?.agentHandoffs).toEqual([
      expect.objectContaining({
        nodeId: "producer",
        nodeRunId: producerRun?.id,
        payload: { facts: ["handoff fact"], next: "consumer" }
      })
    ]);
    expect(upstream[0]).toMatchObject({
      handoffJson: { facts: ["handoff fact"], next: "consumer" },
      humanReportMd: expect.stringContaining("Producer report"),
      artifacts: [
        expect.objectContaining({
          title: "Producer preview",
          kind: "html",
          downloadUrl: expect.stringContaining("/artifacts/")
        })
      ]
    });
    expect(upstream[0]).not.toHaveProperty("output");
    expect(producerRun?.output).toMatchObject({
      result: expect.objectContaining({ ok: true })
    });
  });

  it("reruns the loop output branch until the loop reaches max iterations", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "hiveward-worker-"));
    const store = new FileHivewardStore(path.join(tempDir, "hiveward-store.json"));
    await store.init();

    const blueprint = createBlueprint(
      [
        createAgentNode("brief", "Brief"),
        {
          id: "loop",
          type: "loop",
          position: { x: 420, y: 180 },
          config: {
            label: "Loop",
            maxIterations: 2
          }
        }
      ],
      [
        { id: "brief-loop", source: "brief", target: "loop", condition: "success" },
        { id: "loop-brief", source: "loop", target: "brief", condition: "success" }
      ]
    );
    const worker = new BlueprintWorker(
      store,
      new ScriptedAdapter([
        createStartedAgentTask("task-1"),
        createStartedAgentTask("task-2")
      ], [
        createCompletedAgentTask("task-1", "succeeded", "brief ready"),
        createCompletedAgentTask("task-2", "succeeded", "brief ready again")
      ])
    );

    const run = await worker.startRun(blueprint, "test-user");
    const view = await waitForRunTerminal(store, run.id);

    expect(view?.run.status).toBe("succeeded");
    expect(view?.nodeRuns.filter((nodeRun) => nodeRun.nodeId === "brief" && nodeRun.status === "succeeded")).toHaveLength(2);
    expect(view?.nodeRuns.filter((nodeRun) => nodeRun.nodeId === "loop").map((nodeRun) => (nodeRun.output as { status?: string }).status)).toEqual([
      "rerun",
      "completed"
    ]);
    expect(view?.nodeRuns.filter((nodeRun) => nodeRun.nodeId === "loop").at(-1)?.output).toEqual({
      status: "completed",
      iteration: 2,
      maxIterations: 2,
      rerunTargets: [{ nodeId: "brief", nodeLabel: "Brief" }],
      upstream: [expect.objectContaining({ nodeId: "brief", nodeLabel: "Brief", status: "succeeded", humanReportMd: "brief ready again" })]
    });
  });

  it("binds agent node runs to native execution sessions and RunRoom output events", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "hiveward-worker-"));
    const store = new FileHivewardStore(path.join(tempDir, "hiveward-store.json"));
    await store.init();

    const blueprint = createBlueprint([createAgentNode("brief", "Brief")], []);
    const adapter = new ScriptedAdapter([
      {
        ...createStartedAgentTask("task-session"),
        sessionKey: "runtime-session",
        nativeSessionId: "native-start"
      }
    ], [
      {
        ...createCompletedAgentTask("task-session", "succeeded", "brief ready"),
        sessionKey: "runtime-session",
        nativeSessionId: "native-done"
      }
    ]);
    const worker = new BlueprintWorker(store, adapter);

    const run = await worker.startRun(blueprint, "test-user");
    const view = await waitForRunTerminal(store, run.id);
    const nodeRun = view?.nodeRuns.find((candidate) => candidate.nodeId === "brief");
    if (!nodeRun) throw new Error("Expected brief node run.");
    const sessions = await store.listNodeExecutionSessions({ runId: run.id, nodeRunId: nodeRun.id });
    const outputEvents = await listRunRoomAgentOutputEvents(store, blueprint.id, run.id);
    const completedOutput = outputEvents.find((event) => event.kind === "message_completed");

    expect(view?.run.status).toBe("succeeded");
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      runId: run.id,
      nodeRunId: nodeRun.id,
      nodeId: "brief",
      harnessId: "openclaw",
      nativeSessionId: "native-done",
      policy: "refresh_per_run",
      status: "completed",
      runtimeRef: expect.objectContaining({
        taskId: "task-session",
        sessionKey: "runtime-session"
      })
    });
    expect("listNodeSessionTranscriptEvents" in store).toBe(false);
    expect("nodeSessionTranscriptEvents" in (view ?? {})).toBe(false);
    expect(outputEvents.map((event) => event.kind)).toEqual(expect.arrayContaining([
      "message_started",
      "runtime_state",
      "message_completed"
    ]));
    expect(completedOutput).toEqual(
      expect.objectContaining({
        ownerType: "run_room",
        actorType: "worker",
        kind: "message_completed",
        bodyMarkdown: "brief ready",
        sourceType: "blueprint_node_run",
        sourceId: nodeRun.id,
        runtimeState: expect.objectContaining({
          taskId: "task-session",
          sessionKey: "runtime-session"
        }),
        metadata: expect.objectContaining({
          runRoomId: expect.any(String),
          blueprintRunId: run.id,
          nodeRunId: nodeRun.id,
          nodeId: "brief",
          nodeType: "agent"
        })
      })
    );
    expect(completedOutput?.ownerType).not.toBe("worker_task");
    expect(completedOutput?.metadata?.workerTaskId).toBeUndefined();
    expect(completedOutput?.metadata?.managerCommandId).toBeUndefined();
  });

  it("persists provider task deltas as canonical RunRoom output events", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "hiveward-worker-"));
    const store = new FileHivewardStore(path.join(tempDir, "hiveward-store.json"));
    await store.init();

    const baseAgent = createAgentNode("brief", "Brief");
    const codexAgent: BlueprintNode = {
      ...baseAgent,
      runtimeId: "codex",
      config: {
        ...baseAgent.config,
        modelId: "test-codex-model"
      }
    };
    const blueprint = createBlueprint([codexAgent], []);
    const adapter = new ScriptedAdapter([
      {
        ...createStartedAgentTask("task-stream", "codex"),
        sessionKey: "codex-provider-session",
        nativeSessionId: "codex-provider-session"
      }
    ], [
      {
        ...createCompletedAgentTask("task-stream", "succeeded", "brief ready", undefined, "codex"),
        sessionKey: "codex-provider-session",
        nativeSessionId: "codex-provider-session"
      }
    ], [[
      {
        type: "runtime_state",
        source: "codex",
        phase: "thinking",
        label: "provider planning",
        status: "started",
        updatedAt: "2026-06-04T00:00:01.000Z"
      },
      {
        type: "delta",
        text: "live provider chunk"
      }
    ]]);
    const worker = new BlueprintWorker(store, adapter);

    const run = await worker.startRun(blueprint, "test-user");
    const view = await waitForRunTerminal(store, run.id);
    const nodeRun = view?.nodeRuns.find((candidate) => candidate.nodeId === "brief");
    if (!nodeRun) throw new Error("Expected brief node run.");
    const outputEvents = await listRunRoomAgentOutputEvents(store, blueprint.id, run.id);
    const delta = outputEvents.find((event) => event.kind === "message_delta");
    const completed = outputEvents.filter((event) => event.kind === "message_completed");

    expect(view?.run.status).toBe("succeeded");
    expect(outputEvents.map((event) => event.kind)).toEqual(expect.arrayContaining([
      "message_started",
      "runtime_state",
      "message_delta",
      "message_completed"
    ]));
    expect(delta).toMatchObject({
      ownerType: "run_room",
      actorType: "worker",
      kind: "message_delta",
      delta: "live provider chunk",
      sourceType: "blueprint_node_run",
      sourceId: nodeRun.id,
      runtimeState: expect.objectContaining({
        taskId: "task-stream",
        sessionKey: "codex-provider-session"
      }),
      metadata: expect.objectContaining({
        runRoomId: expect.any(String),
        blueprintRunId: run.id,
        nodeRunId: nodeRun.id,
        source: "codex",
        sessionKey: "codex-provider-session"
      })
    });
    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({
      bodyMarkdown: "brief ready",
      runtimeState: expect.objectContaining({
        sessionKey: "codex-provider-session"
      })
    });
  });

  it("does not synthesize message_delta rows for non-streaming task completions", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "hiveward-worker-"));
    const store = new FileHivewardStore(path.join(tempDir, "hiveward-store.json"));
    await store.init();

    const blueprint = createBlueprint([createAgentNode("brief", "Brief")], []);
    const adapter = new ScriptedAdapter([
      createStartedAgentTask("task-non-streaming")
    ], [
      createCompletedAgentTask("task-non-streaming", "succeeded", "final text must not become a fake delta")
    ]);
    const worker = new BlueprintWorker(store, adapter);

    const run = await worker.startRun(blueprint, "test-user");
    await waitForRunTerminal(store, run.id);
    const outputEvents = await listRunRoomAgentOutputEvents(store, blueprint.id, run.id);

    expect(outputEvents.some((event) => event.kind === "message_delta")).toBe(false);
    expect(outputEvents.filter((event) => event.kind === "message_completed").map((event) => event.bodyMarkdown)).toEqual([
      "final text must not become a fake delta"
    ]);
  });

  it("does not publish RunRoom feed events or create a fake RunRoom when the RunRoom is missing", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "hiveward-worker-"));
    const store = new FileHivewardStore(path.join(tempDir, "hiveward-store.json"));
    await store.init();

    const blueprint = createBlueprint([createAgentNode("brief", "Brief")], []);
    const run = await store.createBlueprintRun(blueprint, "test-user");
    const runningRun = { ...run, status: "running" as const };
    await store.updateBlueprintRun(runningRun);
    await store.createRunCommandIfAbsent({
      id: "command-missing-run-room",
      commandKey: buildRunCommandKey(run.id, undefined, "regular_run"),
      blueprintId: blueprint.id,
      runId: run.id,
      kind: "regular_run",
      status: "running",
      currentRevision: 0,
      currentStep: "node_execution",
      createdAt: run.startedAt,
      updatedAt: run.startedAt
    });
    const adapter = new ScriptedAdapter([
      createStartedAgentTask("task-missing-run-room")
    ], [
      createCompletedAgentTask("task-missing-run-room", "succeeded", "completed without run room")
    ], [[
      { type: "delta", text: "unpublished provider chunk" }
    ]]);
    const worker = new BlueprintWorker(store, adapter);

    await worker.resumeActiveRuns();
    const view = await waitForRunTerminal(store, run.id);

    expect(view?.run.status).toBe("succeeded");
    expect(await store.listRunRooms({ blueprintId: blueprint.id })).toEqual([]);
    expect(await store.listAgentOutputEvents()).toEqual([]);
  });

  it("creates a new preserved session row that resumes the previous native session", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "hiveward-worker-"));
    const store = new FileHivewardStore(path.join(tempDir, "hiveward-store.json"));
    await store.init();

    const preservingBrief = {
      ...createAgentNode("brief", "Brief"),
      config: {
        ...createAgentNode("brief", "Brief").config,
        crossRoundContextMode: "node_history" as const
      }
    };
    const blueprint = createBlueprint(
      [
        preservingBrief,
        {
          id: "loop",
          type: "loop",
          position: { x: 420, y: 180 },
          config: {
            label: "Loop",
            maxIterations: 2
          }
        }
      ],
      [
        { id: "brief-loop", source: "brief", target: "loop", condition: "success" },
        { id: "loop-brief", source: "loop", target: "brief", condition: "success" }
      ]
    );
    const adapter = new ScriptedAdapter([
      {
        ...createStartedAgentTask("task-preserve-1"),
        sessionKey: "runtime-session-1",
        nativeSessionId: "native-preserve-1"
      },
      {
        ...createStartedAgentTask("task-preserve-2"),
        sessionKey: "runtime-session-2",
        resumeRequested: true,
        resumeAttempted: true,
        resumeProven: false,
        resumable: false
      }
    ], [
      {
        ...createCompletedAgentTask("task-preserve-1", "succeeded", "brief ready"),
        sessionKey: "runtime-session-1",
        nativeSessionId: "native-preserve-1"
      },
      {
        ...createCompletedAgentTask("task-preserve-2", "succeeded", "brief ready again"),
        sessionKey: "runtime-session-2",
        nativeSessionId: "native-preserve-1",
        providerSessionId: "native-preserve-1",
        resumeRequested: true,
        resumeAttempted: true,
        resumeProven: true,
        resumeMode: "resumed",
        providerStartedNewSession: false,
        resumable: true
      }
    ]);
    const worker = new BlueprintWorker(store, adapter);

    const run = await worker.startRun(blueprint, "test-user");
    const view = await waitForRunTerminal(store, run.id);
    const sessions = await store.listNodeExecutionSessions({ runId: run.id, nodeId: "brief" });

    expect(view?.run.status).toBe("succeeded");
    expect(adapter.calls[0]?.nativeSessionId).toBeUndefined();
    expect(adapter.calls[1]?.nativeSessionId).toBe("native-preserve-1");
    expect(sessions).toHaveLength(2);
    expect(sessions[0]).toMatchObject({
      policy: "preserve_across_rounds",
      status: "completed",
      nativeSessionId: "native-preserve-1"
    });
    expect(sessions[1]).toMatchObject({
      policy: "preserve_across_rounds",
      status: "completed",
      nativeSessionId: "native-preserve-1",
      resumedFromSessionId: sessions[0]?.id
    });
  });

  it("treats provider-started native sessions as fallback boundaries instead of proven resume", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "hiveward-worker-"));
    const store = new FileHivewardStore(path.join(tempDir, "hiveward-store.json"));
    await store.init();

    const preservingBrief = {
      ...createAgentNode("brief", "Brief"),
      config: {
        ...createAgentNode("brief", "Brief").config,
        crossRoundContextMode: "node_history" as const
      }
    };
    const blueprint = createBlueprint(
      [
        preservingBrief,
        {
          id: "loop",
          type: "loop",
          position: { x: 420, y: 180 },
          config: {
            label: "Loop",
            maxIterations: 2
          }
        }
      ],
      [
        { id: "brief-loop", source: "brief", target: "loop", condition: "success" },
        { id: "loop-brief", source: "loop", target: "brief", condition: "success" }
      ]
    );
    const adapter = new ScriptedAdapter([
      {
        ...createStartedAgentTask("task-provider-new-1"),
        sessionKey: "runtime-provider-new-1",
        nativeSessionId: "native-original"
      },
      {
        ...createStartedAgentTask("task-provider-new-resume"),
        sessionKey: "runtime-provider-new-resume",
        resumeRequested: true,
        resumeAttempted: true,
        resumeProven: false,
        providerStartedNewSession: false,
        resumable: false
      },
      {
        ...createStartedAgentTask("task-provider-new-fallback"),
        sessionKey: "runtime-provider-new-fallback",
        nativeSessionId: "native-fallback-after-provider-new"
      }
    ], [
      {
        ...createCompletedAgentTask("task-provider-new-1", "succeeded", "first pass"),
        sessionKey: "runtime-provider-new-1",
        nativeSessionId: "native-original"
      },
      {
        ...createCompletedAgentTask("task-provider-new-resume", "succeeded", "discarded provider new session"),
        sessionKey: "runtime-provider-new-resume",
        providerSessionId: "native-provider-new",
        resumeRequested: true,
        resumeAttempted: true,
        resumeProven: false,
        providerStartedNewSession: true,
        resumable: false
      },
      {
        ...createCompletedAgentTask("task-provider-new-fallback", "succeeded", "fallback after provider new session"),
        sessionKey: "runtime-provider-new-fallback",
        nativeSessionId: "native-fallback-after-provider-new"
      }
    ]);
    const worker = new BlueprintWorker(store, adapter);

    const run = await worker.startRun(blueprint, "test-user");
    const view = await waitForRunTerminal(store, run.id);
    const sessions = await store.listNodeExecutionSessions({ runId: run.id, nodeId: "brief" });
    const unavailable = sessions.find((session) => session.status === "unavailable");
    const fallback = sessions.find((session) => session.status === "fallback");
    const outputEvents = await listRunRoomAgentOutputEvents(store, blueprint.id, run.id);

    expect(view?.run.status).toBe("succeeded");
    expect(adapter.calls.map((call) => call.nativeSessionId)).toEqual([
      undefined,
      "native-original",
      undefined
    ]);
    expect(sessions).toHaveLength(3);
    expect(unavailable).toMatchObject({
      statusReason: expect.stringContaining("provider_started_new_session"),
      resumedFromSessionId: sessions[0]?.id
    });
    expect(unavailable?.nativeSessionId).toBeUndefined();
    expect(fallback).toMatchObject({
      nativeSessionId: "native-fallback-after-provider-new",
      fallbackOfSessionId: unavailable?.id
    });
    expect("listNodeSessionTranscriptEvents" in store).toBe(false);
    expect(outputEvents.filter((event) => event.kind === "message_completed").map((event) => event.bodyMarkdown)).toEqual([
      "first pass",
      "fallback after provider new session"
    ]);
    expect(outputEvents.filter((event) => event.kind === "message_completed").map((event) => event.bodyMarkdown)).not.toContain("discarded provider new session");
    expect(view?.nodeRuns.find((nodeRun) => nodeRun.nodeId === "brief" && nodeRun.output === "fallback after provider new session")).toBeTruthy();
  });

  it("marks unsupported native resume unavailable and starts an explicit fallback session", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "hiveward-worker-"));
    const store = new FileHivewardStore(path.join(tempDir, "hiveward-store.json"));
    await store.init();

    const preservingBrief = {
      ...createAgentNode("brief", "Brief"),
      config: {
        ...createAgentNode("brief", "Brief").config,
        crossRoundContextMode: "node_history" as const
      }
    };
    const blueprint = createBlueprint(
      [
        preservingBrief,
        {
          id: "loop",
          type: "loop",
          position: { x: 420, y: 180 },
          config: {
            label: "Loop",
            maxIterations: 2
          }
        }
      ],
      [
        { id: "brief-loop", source: "brief", target: "loop", condition: "success" },
        { id: "loop-brief", source: "loop", target: "brief", condition: "success" }
      ]
    );
    const adapter = new ScriptedAdapter([
      {
        ...createStartedAgentTask("task-fallback-1"),
        sessionKey: "runtime-session-1",
        nativeSessionId: "native-original"
      },
      {
        taskId: "task-fallback-resume",
        runId: "task-fallback-resume-run",
        sessionKey: "runtime-session-resume",
        source: "openclaw",
        resumeMode: "started",
        resumeRequested: true,
        resumeAttempted: false,
        resumeProven: false,
        resumable: false,
        status: "failed",
        error: "native_resume_unsupported: test runtime cannot prove native resume.",
        updatedAt: new Date().toISOString()
      },
      {
        ...createStartedAgentTask("task-fallback-new"),
        sessionKey: "runtime-session-fallback",
        nativeSessionId: "native-fallback"
      }
    ], [
      {
        ...createCompletedAgentTask("task-fallback-1", "succeeded", "first pass"),
        sessionKey: "runtime-session-1",
        nativeSessionId: "native-original"
      },
      {
        ...createCompletedAgentTask("task-fallback-new", "succeeded", "fallback pass"),
        sessionKey: "runtime-session-fallback",
        nativeSessionId: "native-fallback"
      }
    ]);
    const worker = new BlueprintWorker(store, adapter);

    const run = await worker.startRun(blueprint, "test-user");
    const view = await waitForRunTerminal(store, run.id);
    const sessions = await store.listNodeExecutionSessions({ runId: run.id, nodeId: "brief" });
    const unavailable = sessions.find((session) => session.status === "unavailable");
    const fallback = sessions.find((session) => session.status === "fallback");
    const outputEvents = await listRunRoomAgentOutputEvents(store, blueprint.id, run.id);

    expect(view?.run.status).toBe("succeeded");
    expect(adapter.calls.map((call) => call.nativeSessionId)).toEqual([
      undefined,
      "native-original",
      undefined
    ]);
    expect(sessions).toHaveLength(3);
    expect(unavailable).toMatchObject({
      statusReason: expect.stringContaining("native_resume_unsupported")
    });
    expect(unavailable?.nativeSessionId).toBeUndefined();
    expect(unavailable?.resumedFromSessionId).toBe(sessions[0]?.id);
    expect(fallback).toMatchObject({
      nativeSessionId: "native-fallback",
      fallbackOfSessionId: unavailable?.id
    });
    expect("listNodeSessionTranscriptEvents" in store).toBe(false);
    expect(outputEvents.filter((event) => event.kind === "message_completed").map((event) => event.bodyMarkdown)).toEqual([
      "first pass",
      "fallback pass"
    ]);
  });
});

async function listRunRoomAgentOutputEvents(store: FileHivewardStore, blueprintId: string, runId: string): Promise<AgentOutputEvent[]> {
  const runRoom = (await store.listRunRooms({ blueprintId }))
    .find((candidate) => candidate.runId === runId);
  if (!runRoom) return [];
  return store.listAgentOutputEvents({ ownerType: "run_room", ownerId: runRoom.id });
}

async function expectRunRoomStatus(
  store: HivewardStore,
  blueprintId: string,
  runId: string,
  status: RunRoomStatus
): Promise<void> {
  const runRoom = (await store.listRunRooms({ blueprintId }))
    .find((candidate) => candidate.runId === runId);
  expect(runRoom).toMatchObject({ runId, status });
}

function createStartedAgentTask(taskId: string, source: StartedAgentTaskResult["source"] = "openclaw"): StartedAgentTaskResult {
  return {
    taskId,
    runId: `${taskId}-run`,
    sessionKey: "agent:main:main",
    nativeSessionId: "agent:main:main",
    source,
    resumeMode: "started",
    resumeRequested: false,
    resumeAttempted: false,
    resumeProven: false,
    providerStartedNewSession: false,
    resumable: true,
    status: "running",
    updatedAt: new Date().toISOString()
  };
}

function htmlArtifactOutput(label: string): Record<string, unknown> {
  return {
    contractVersion: 2,
    humanReportMd: `## Builder report\n\n${label}`,
    handoffJson: { delivered: label },
    result: { label },
    artifacts: [{
      slot: "html",
      title: `${label} HTML`,
      kind: "html",
      content: `<!doctype html><html><body>${label}</body></html>`
    }]
  };
}

function releaseReportOutput(label: string): Record<string, unknown> {
  return {
    contractVersion: 2,
    humanReportMd: [
      "## Summary",
      "",
      `${label} release report written by the manager.`,
      "",
      "## Delivery location",
      "",
      "None",
      "",
      "## Completed Work",
      "",
      `Builder delivered ${label}.`
    ].join("\n"),
    handoffJson: { releaseReport: label },
    result: { status: "ready_for_confirmation", summary: label }
  };
}

function markdownArtifactOutput(markdown: string, title: string): Record<string, unknown> {
  return {
    contractVersion: 2,
    humanReportMd: markdown,
    result: { summary: markdown },
    artifacts: [{
      slot: "research",
      title,
      kind: "markdown",
      content: markdown
    }]
  };
}

function createCompletedAgentTask(
  taskId: string,
  status: AgentTaskResult["status"],
  output?: unknown,
  error?: string,
  source: AgentTaskResult["source"] = "openclaw"
): AgentTaskResult {
  return {
    taskId,
    runId: `${taskId}-run`,
    sessionKey: "agent:main:main",
    nativeSessionId: "agent:main:main",
    source,
    resumeMode: "started",
    resumeRequested: false,
    resumeAttempted: false,
    resumeProven: false,
    providerStartedNewSession: false,
    resumable: true,
    status,
    output,
    error,
    updatedAt: new Date().toISOString()
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAgentApprovalWaitingOutputForTest(value: unknown): value is {
  approvalType: "agent";
  reviewOutput: unknown;
  replies: Array<{ id: string; body: string }>;
} {
  return isRecord(value) && value.approvalType === "agent" && Array.isArray(value.replies);
}

async function waitForCondition(predicate: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 10_000;

  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error(`Timed out waiting for ${label}.`);
}

async function waitForRunTerminal(store: HivewardStore, runId: string): Promise<Awaited<ReturnType<HivewardStore["getRunView"]>>> {
  const deadline = Date.now() + 10_000;
  let lastView: Awaited<ReturnType<HivewardStore["getRunView"]>> | undefined;

  while (Date.now() < deadline) {
    const view = await store.getRunView(runId);
    lastView = view;
    if (view && !["queued", "running", "waiting_approval"].includes(view.run.status)) {
      return view;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error(`Blueprint run did not reach a terminal state in time: ${runId}; last status=${lastView?.run.status}; approvals=${lastView?.approvalRequests?.map((request) => `${request.kind}:${request.status}:${request.requestedBy.nodeId}:approve=${request.capabilities.approve}:body=${request.body.slice(0, 240)}`).join(",")}; nodes=${lastView?.nodeRuns.map((nodeRun) => `${nodeRun.nodeId}:${nodeRun.status}`).join(",")}`);
}

async function waitForRunStatus(
  store: HivewardStore,
  runId: string,
  status: BlueprintRunStatus
): Promise<NonNullable<Awaited<ReturnType<HivewardStore["getRunView"]>>>> {
  const deadline = Date.now() + 10_000;

  while (Date.now() < deadline) {
    const view = await store.getRunView(runId);
    if (view?.run.status === status) {
      return view;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error(`Blueprint run did not reach ${status} in time: ${runId}`);
}

async function waitForRunView(
  store: HivewardStore,
  runId: string,
  predicate: (view: NonNullable<Awaited<ReturnType<HivewardStore["getRunView"]>>>) => boolean,
  timeoutMs = 10_000
): Promise<NonNullable<Awaited<ReturnType<HivewardStore["getRunView"]>>>> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const view = await store.getRunView(runId);
    if (view && predicate(view)) {
      return view;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error(`Blueprint run view did not match the expected state in time: ${runId}`);
}

async function waitForNodeRun(
  store: FileHivewardStore,
  runId: string,
  nodeId: string,
  predicate: (nodeRun: NonNullable<Awaited<ReturnType<FileHivewardStore["getRunView"]>>>["nodeRuns"][number]) => boolean
): Promise<NonNullable<Awaited<ReturnType<FileHivewardStore["getRunView"]>>>["nodeRuns"][number]> {
  const deadline = Date.now() + 10_000;

  while (Date.now() < deadline) {
    const view = await store.getRunView(runId);
    const nodeRun = view?.nodeRuns.find((candidate) => candidate.nodeId === nodeId);
    if (nodeRun && predicate(nodeRun)) {
      return nodeRun;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error(`Node run did not match the expected state in time: ${runId}/${nodeId}`);
}

function createBlueprint(nodes: BlueprintNode[], edges: BlueprintEdge[]): BlueprintDefinition {
  const now = new Date().toISOString();
  return {
    id: "test-blueprint",
    companyId: "company-hiveward-studio",
    name: "Test blueprint",
    version: 1,
    nodes,
    edges,
    variables: {},
    display: {
      viewport: { x: 0, y: 0, zoom: 1 }
    },
    createdAt: now,
    updatedAt: now
  };
}

function createUsageFact(inputTokens: number, outputTokens: number, costUsd: number) {
  return {
    id: "usage-1",
    modelId: "test-model",
    inputTokens,
    outputTokens,
    costUsd,
    recordedAt: new Date().toISOString()
  };
}

function createAgentNode(id: string, label: string, position = { x: 120, y: 180 }): BlueprintNode {
  return {
    id,
    type: "agent",
    runtimeId: "openclaw",
    position,
    config: {
      label,
      openclawAgentId: "main",
      agentName: id,
      prompt: `Run ${id}`,
      tools: []
    }
  };
}

function createSelfIterationBlueprint(config: {
  maxRounds: number;
  maxPreparationAttempts?: number;
  autoApproveRequirements?: boolean;
  autoApproveReleaseReports?: boolean;
  researchAgent?: boolean;
  requirementAgent?: boolean;
}): BlueprintDefinition {
  const builder = {
    ...createAgentNode("builder", "Builder", { x: 520, y: 180 }),
    parentId: "slot-1"
  };
  const researchSlot = config.researchAgent
    ? {
        id: "research-slot",
        type: "manager_slot" as const,
        position: { x: 300, y: -180 },
        config: {
          label: "Research Slot",
          managerNodeId: "top-manager",
          slot: 1
        }
      }
    : undefined;
  const requirementSlot = config.requirementAgent
    ? {
        id: "requirement-slot",
        type: "manager_slot" as const,
        position: { x: 300, y: -20 },
        config: {
          label: "Requirement Slot",
          managerNodeId: "top-manager",
          slot: 2
        }
      }
    : undefined;
  const requirementAgent = config.requirementAgent
    ? {
        ...createAgentNode("requirements", "Requirements", { x: 80, y: 360 }),
        parentId: "requirement-slot"
      }
    : undefined;
  const researchAgent = config.researchAgent
    ? {
        ...createAgentNode("research", "Research", { x: 80, y: 460 }),
        parentId: "research-slot"
      }
    : undefined;
  return createBlueprint(
    [
      {
        id: "top-manager",
        type: "manager",
        runtimeId: "openclaw",
        position: { x: 80, y: 180 },
        config: {
          label: "Top Manager",
          portCount: 3,
          maxHandoffs: 3,
          maxRounds: config.maxRounds,
          maxPreparationAttempts: config.maxPreparationAttempts ?? 1,
          autoApproveRequirements: config.autoApproveRequirements,
          autoApproveReleaseReports: config.autoApproveReleaseReports,
          researchAgentNodeId: config.researchAgent ? "research" : undefined,
          requirementAgentNodeId: config.requirementAgent ? "requirements" : undefined,
          instructions: "Coordinate self-iteration rounds."
        }
      },
      ...(researchSlot ? [researchSlot] : []),
      ...(researchAgent ? [researchAgent] : []),
      ...(requirementSlot ? [requirementSlot] : []),
      ...(requirementAgent ? [requirementAgent] : []),
      {
        id: "slot-1",
        type: "manager_slot",
        position: { x: 300, y: 180 },
        config: {
          label: "Build Slot",
          managerNodeId: "top-manager",
          slot: 3
        }
      },
      builder
    ],
    [
      ...(researchSlot && researchAgent
        ? [
            {
              id: "edge-top-manager-research-slot",
              source: "top-manager",
              sourceHandle: "manager-out-1",
              target: "research-slot",
              targetHandle: "manager-slot-in"
            },
            {
              id: "edge-research-slot-top-manager",
              source: "research-slot",
              sourceHandle: "manager-slot-out",
              target: "top-manager",
              targetHandle: "manager-in-1"
            },
            {
              id: "edge-research-slot-agent",
              source: "research-slot",
              sourceHandle: "manager-slot-inner-out",
              target: "research"
            },
            {
              id: "edge-research-agent-slot",
              source: "research",
              target: "research-slot",
              targetHandle: "manager-slot-inner-in"
            }
          ]
        : []),
      ...(requirementSlot && requirementAgent
        ? [
            {
              id: "edge-top-manager-requirement-slot",
              source: "top-manager",
              sourceHandle: "manager-out-2",
              target: "requirement-slot",
              targetHandle: "manager-slot-in"
            },
            {
              id: "edge-requirement-slot-top-manager",
              source: "requirement-slot",
              sourceHandle: "manager-slot-out",
              target: "top-manager",
              targetHandle: "manager-in-2"
            },
            {
              id: "edge-requirement-slot-agent",
              source: "requirement-slot",
              sourceHandle: "manager-slot-inner-out",
              target: "requirements"
            },
            {
              id: "edge-requirement-agent-slot",
              source: "requirements",
              target: "requirement-slot",
              targetHandle: "manager-slot-inner-in"
            }
          ]
        : []),
      {
        id: "edge-top-manager-slot-1",
        source: "top-manager",
        sourceHandle: "manager-out-3",
        target: "slot-1",
        targetHandle: "manager-slot-in"
      },
      {
        id: "edge-slot-1-top-manager",
        source: "slot-1",
        sourceHandle: "manager-slot-out",
        target: "top-manager",
        targetHandle: "manager-in-3"
      },
      {
        id: "edge-slot-1-builder",
        source: "slot-1",
        sourceHandle: "manager-slot-inner-out",
        target: "builder"
      },
      {
        id: "edge-builder-slot-1",
        source: "builder",
        target: "slot-1",
        targetHandle: "manager-slot-inner-in"
      }
    ]
  );
}

function isRuntimeNodeRun(nodeRun: BlueprintNodeRun): boolean {
  return !nodeRun.id.startsWith("preflight-");
}
