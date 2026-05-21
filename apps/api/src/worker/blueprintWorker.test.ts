import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { OpenClawAdapter } from "@hiveward/adapter";
import {
  type AgentTaskResult,
  blueprintRunArchiveSchema,
  createManagerDrivenHtmlBlueprint,
  createRealThreeAgentBlueprint,
  type SendChannelResult,
  type StartAgentTaskInput,
  type StartedAgentTaskResult,
  type WaitForAgentTaskInput,
  type BlueprintDefinition,
  type BlueprintEdge,
  type BlueprintNode
} from "@hiveward/shared";
import { FileHivewardStore } from "../store/fileHivewardStore";
import { BlueprintWorker } from "./blueprintWorker";

class ScriptedAdapter implements OpenClawAdapter {
  readonly calls: StartAgentTaskInput[] = [];
  readonly waitCalls: WaitForAgentTaskInput[] = [];

  constructor(
    private readonly startResults: StartedAgentTaskResult[],
    private readonly completionResults: AgentTaskResult[]
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

  async startAgentTask(input: StartAgentTaskInput): Promise<StartedAgentTaskResult> {
    this.calls.push(input);
    const result = this.startResults.shift();
    if (!result) {
      throw new Error("No scripted agent start result available.");
    }
    return result;
  }

  async waitForAgentTask(input: WaitForAgentTaskInput): Promise<AgentTaskResult> {
    this.waitCalls.push(input);
    const result = this.completionResults.shift();
    if (!result) {
      throw new Error("No scripted agent completion result available.");
    }
    return result;
  }

  async sendChannelMessage(): Promise<SendChannelResult> {
    return {
      deliveryId: "delivery-1",
      status: "sent",
      updatedAt: new Date().toISOString()
    };
  }
}

class BlockingAdapter implements OpenClawAdapter {
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

  async startAgentTask(input: StartAgentTaskInput): Promise<StartedAgentTaskResult> {
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
    expect(view?.nodeRuns.find((nodeRun) => nodeRun.nodeId === "brief")?.status).toBe("succeeded");
    expect(view?.nodeRuns.find((nodeRun) => nodeRun.nodeId === "brief")?.input).toEqual({ upstream: [] });
    const failedPlanRun = view?.nodeRuns.find((nodeRun) => nodeRun.nodeId === "plan");
    expect(failedPlanRun?.status).toBe("failed");
    expect(failedPlanRun?.input).toEqual({
      upstream: [expect.objectContaining({ nodeId: "brief", nodeLabel: "1. Brief", status: "succeeded", output: "brief ok" })]
    });
    expect((failedPlanRun?.input as { upstream?: Array<{ nodeRunId?: string; openclawRef?: { runId?: string } }> } | undefined)?.upstream?.[0])
      .toMatchObject({
        nodeRunId: expect.any(String),
        openclawRef: expect.objectContaining({ runId: "task-1-run" })
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

  it("writes node input to the run archive before the agent task finishes", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "hiveward-worker-"));
    const storePath = path.join(tempDir, "hiveward-store.json");
    const store = new FileHivewardStore(storePath);
    await store.init();

    const blueprint = createBlueprint([createAgentNode("brief", "Brief")], []);
    const adapter = new BlockingAdapter(createStartedAgentTask("task-1"));
    const worker = new BlueprintWorker(store, adapter);

    const run = await worker.startRun(blueprint, "test-user");
    const runningNode = await waitForNodeRun(store, run.id, "brief", (nodeRun) => nodeRun.status === "running" && nodeRun.input !== undefined);
    const archiveWhileRunning = JSON.parse(readFileSync(path.join(tempDir, "runs", `${run.id}.json`), "utf8")) as {
      nodeRuns: Array<{ nodeId: string; status: string; input?: unknown }>;
    };

    expect(runningNode.input).toEqual({ upstream: [] });
    expect(archiveWhileRunning.nodeRuns.find((nodeRun) => nodeRun.nodeId === "brief")).toMatchObject({
      status: "running",
      input: { upstream: [] }
    });

    adapter.complete(createCompletedAgentTask("task-1", "succeeded", "brief ok"));
    const view = await waitForRunTerminal(store, run.id);
    expect(view?.run.status).toBe("succeeded");
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
      openclawRef: {
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
    expect(view?.nodeRuns.find((nodeRun) => nodeRun.nodeId === "gate")?.input).toEqual({
      upstream: [expect.objectContaining({ nodeId: "brief", nodeLabel: "Brief", status: "succeeded", output: "brief ready" })]
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
    expect((adapter.calls[1]?.input as { upstream?: Array<{ output: unknown }> }).upstream?.[0]?.output).toBe("brief ready");
    expect((adapter.calls[2]?.input as { upstream?: Array<{ output: unknown }> }).upstream?.[0]?.output).toBe("brief ready");
  });

  it("passes SDK node configuration to the adapter and persists provider refs", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "hiveward-worker-"));
    const store = new FileHivewardStore(path.join(tempDir, "hiveward-store.json"));
    await store.init();

    const blueprint = createBlueprint(
      [
        {
          ...createAgentNode("sdk-node", "SDK Node"),
          type: "codex_agent",
          config: {
            label: "SDK Node",
            agentName: "codex-runner",
            prompt: "Return JSON.",
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
        ...createCompletedAgentTask("codex-task-1", "succeeded", "{\"ok\":true}"),
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
      modelId: "gpt-5.4",
      permissionProfile: "read_only",
      workingDirectory: tempDir,
      timeoutMs: 120000
    });
    expect(adapter.waitCalls[0]).toMatchObject({
      source: "codex",
      sessionKey: "codex-session-start"
    });
    expect(view?.nodeRuns[0]?.openclawRef).toMatchObject({
      source: "codex",
      sourceId: "codex-task-1",
      sessionKey: "codex-session-final"
    });
    expect(view?.run.openclawRefs[0]?.source).toBe("codex");
  });

  it("lets a manager node route numbered slots and return to an earlier agent slot", async () => {
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
            portCount: 3,
            maxHandoffs: 6,
            instructions: "Route product, developer, and test slots."
          }
        },
        createAgentNode("product", "Product", { x: 420, y: 80 }),
        createAgentNode("dev", "Dev", { x: 420, y: 220 }),
        createAgentNode("test", "Test", { x: 420, y: 360 })
      ],
      [
        { id: "m-product", source: "manager", sourceHandle: "manager-out-1", target: "product", condition: "success" },
        { id: "product-m", source: "product", target: "manager", targetHandle: "manager-in-1", condition: "success" },
        { id: "m-dev", source: "manager", sourceHandle: "manager-out-2", target: "dev", condition: "success" },
        { id: "dev-m", source: "dev", target: "manager", targetHandle: "manager-in-2", condition: "success" },
        { id: "m-test", source: "manager", sourceHandle: "manager-out-3", target: "test", condition: "success" },
        { id: "test-m", source: "test", target: "manager", targetHandle: "manager-in-3", condition: "success" }
      ]
    );
    const adapter = new ScriptedAdapter([
      createStartedAgentTask("task-1"),
      createStartedAgentTask("task-2"),
      createStartedAgentTask("task-3"),
      createStartedAgentTask("task-4"),
      createStartedAgentTask("task-5")
    ], [
      createCompletedAgentTask("task-1", "succeeded", "prd ready"),
      createCompletedAgentTask("task-2", "succeeded", "app draft"),
      createCompletedAgentTask("task-3", "succeeded", JSON.stringify({ status: "fail", returnToSlot: 2, reason: "missing loading state" })),
      createCompletedAgentTask("task-4", "succeeded", "app fixed"),
      createCompletedAgentTask("task-5", "succeeded", JSON.stringify({ status: "pass" }))
    ]);
    const worker = new BlueprintWorker(store, adapter);

    const run = await worker.startRun(blueprint, "test-user");
    const view = await waitForRunTerminal(store, run.id);

    expect(view?.run.status).toBe("succeeded");
    expect(view?.nodeRuns.filter((nodeRun) => nodeRun.nodeId === "dev" && nodeRun.status === "succeeded")).toHaveLength(2);
    expect(view?.nodeRuns.filter((nodeRun) => nodeRun.nodeId === "test" && nodeRun.status === "succeeded")).toHaveLength(2);
    expect(view?.nodeRuns.find((nodeRun) => nodeRun.nodeId === "manager")?.status).toBe("succeeded");
    expect(adapter.calls.map((call) => call.agentName)).toEqual(["product", "dev", "test", "dev", "test"]);
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
        (adapter.calls[0]?.input as { upstream?: Array<{ output?: { manager?: { slot?: number } } }> }).upstream?.[0]?.output
      )?.manager?.slot
    ).toBe(1);
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

  it("runs the manager-driven HTML delivery example through the news, execution-doc, and build agents", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "hiveward-worker-"));
    const store = new FileHivewardStore(path.join(tempDir, "hiveward-store.json"));
    await store.init();

    const blueprint = createManagerDrivenHtmlBlueprint(new Date().toISOString(), "company-hiveward-studio");
    const adapter = new ScriptedAdapter([
      createStartedAgentTask("task-1"),
      createStartedAgentTask("task-2"),
      createStartedAgentTask("task-3")
    ], [
      createCompletedAgentTask(
        "task-1",
        "succeeded",
        [
          "# News brief",
          "",
          "Topic: AI agent productivity.",
          "",
          "- Agent teams move into production workflows: builders are using coordinated AI agents for research and delivery.",
          "",
          "Page thesis: Agentic workflows are becoming production infrastructure."
        ].join("\n")
      ),
      createCompletedAgentTask(
        "task-2",
        "succeeded",
        [
          "# HTML execution document",
          "",
          "Page title: Agentic Workflow Brief",
          "",
          "Hero headline: Agentic workflows are becoming production infrastructure.",
          "",
          "Acceptance criteria: standalone HTML, no placeholders."
        ].join("\n")
      ),
      createCompletedAgentTask(
        "task-3",
        "succeeded",
        "<!doctype html><html><body><h1>Agentic Workflow Brief</h1></body></html>"
      )
    ]);
    const worker = new BlueprintWorker(store, adapter);

    const run = await worker.startRun(blueprint, "test-user");
    const view = await waitForRunTerminal(store, run.id);

    expect(view?.run.status).toBe("succeeded");
    expect(adapter.calls.map((call) => call.agentName)).toEqual([
      "news-researcher",
      "execution-doc-writer",
      "html-code-builder"
    ]);
    expect(view?.nodeRuns.find((nodeRun) => nodeRun.nodeId === "html-manager-slot-1")?.status).toBe("succeeded");
    expect(view?.nodeRuns.find((nodeRun) => nodeRun.nodeId === "html-manager-slot-2")?.status).toBe("succeeded");
    expect(view?.nodeRuns.some((nodeRun) => nodeRun.nodeId === "html-manager-slot-3")).toBe(false);
    const builderOutput = view?.nodeRuns.find((nodeRun) => nodeRun.nodeId === "html-manager-slot-2-agent-1")?.output;
    expect(builderOutput).toEqual(expect.stringContaining("<!doctype html>"));
    expect(view?.nodeRuns.find((nodeRun) => nodeRun.nodeId === "html-manager")?.output).toMatchObject({
      status: "completed"
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
      upstream: [expect.objectContaining({ nodeId: "brief", nodeLabel: "Brief", status: "succeeded", output: "brief ready again" })]
    });
  });
});

function createStartedAgentTask(taskId: string): StartedAgentTaskResult {
  return {
    taskId,
    runId: `${taskId}-run`,
    sessionKey: "agent:main:main",
    source: "openclaw",
    status: "running",
    updatedAt: new Date().toISOString()
  };
}

function createCompletedAgentTask(
  taskId: string,
  status: AgentTaskResult["status"],
  output?: string,
  error?: string
): AgentTaskResult {
  return {
    taskId,
    runId: `${taskId}-run`,
    sessionKey: "agent:main:main",
    source: "openclaw",
    status,
    output,
    error,
    updatedAt: new Date().toISOString()
  };
}

async function waitForRunTerminal(store: FileHivewardStore, runId: string): Promise<Awaited<ReturnType<FileHivewardStore["getRunView"]>>> {
  const deadline = Date.now() + 2_000;

  while (Date.now() < deadline) {
    const view = await store.getRunView(runId);
    if (view && !["queued", "running", "waiting_approval"].includes(view.run.status)) {
      return view;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error(`Blueprint run did not reach a terminal state in time: ${runId}`);
}

async function waitForNodeRun(
  store: FileHivewardStore,
  runId: string,
  nodeId: string,
  predicate: (nodeRun: NonNullable<Awaited<ReturnType<FileHivewardStore["getRunView"]>>>["nodeRuns"][number]) => boolean
): Promise<NonNullable<Awaited<ReturnType<FileHivewardStore["getRunView"]>>>["nodeRuns"][number]> {
  const deadline = Date.now() + 2_000;

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
    type: "openclaw_agent",
    position,
    config: {
      label,
      agentId: "main",
      agentName: id,
      prompt: `Run ${id}`,
      tools: []
    }
  };
}
