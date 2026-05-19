import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { OpenClawAdapter } from "@openclaw-cui/adapter";
import {
  type AgentTaskResult,
  createManagerDrivenHtmlWorkflow,
  createRealThreeAgentWorkflow,
  type SendChannelResult,
  type StartAgentTaskInput,
  type StartedAgentTaskResult,
  type WaitForAgentTaskInput,
  type WorkflowDefinition,
  type WorkflowEdge,
  type WorkflowNode
} from "@openclaw-cui/shared";
import { FileCuiStore } from "../store/fileCuiStore";
import { WorkflowWorker } from "./workflowWorker";

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

describe("WorkflowWorker", () => {
  it("persists a newly-created blank workflow for the selected company", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "openclaw-cui-store-"));
    const store = new FileCuiStore(path.join(tempDir, "cui-store.json"));
    await store.init();

    const workflow = await store.createWorkflow({ name: "Launch review" });
    const workflows = await store.listWorkflows();

    expect(workflow.id).toMatch(/^workflow-/);
    expect(workflow.companyId).toBe("company-openclaw-studio");
    expect(workflow.name).toBe("Launch review");
    expect(workflow.nodes).toEqual([]);
    expect(workflows.some((item) => item.id === workflow.id)).toBe(true);
  });

  it("marks the run failed and stops downstream execution when an agent result fails", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "openclaw-cui-worker-"));
    const store = new FileCuiStore(path.join(tempDir, "cui-store.json"));
    await store.init();

    const workflow = createRealThreeAgentWorkflow(new Date().toISOString(), "company-openclaw-studio");
    const worker = new WorkflowWorker(
      store,
      new ScriptedAdapter([
        createStartedAgentTask("task-1"),
        createStartedAgentTask("task-2")
      ], [
        createCompletedAgentTask("task-1", "succeeded", "brief ok"),
        createCompletedAgentTask("task-2", "failed", undefined, "output new_sensitive (1027)")
      ])
    );

    const run = await worker.startRun(workflow, "test-user");
    const view = await waitForRunTerminal(store, run.id);

    expect(run.status).toBe("running");
    expect(view?.run.status).toBe("failed");
    expect(view?.nodeRuns.find((nodeRun) => nodeRun.nodeId === "brief")?.status).toBe("succeeded");
    expect(view?.nodeRuns.find((nodeRun) => nodeRun.nodeId === "plan")?.status).toBe("failed");
    expect(view?.nodeRuns.find((nodeRun) => nodeRun.nodeId === "verify")?.status).toBe("skipped");
    expect(view?.events.some((event) => event.type === "workflow.run.failed")).toBe(true);
  });

  it("skips the branch that does not match a condition result", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "openclaw-cui-worker-"));
    const store = new FileCuiStore(path.join(tempDir, "cui-store.json"));
    await store.init();

    const workflow = createWorkflow(
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
    const worker = new WorkflowWorker(
      store,
      new ScriptedAdapter([
        createStartedAgentTask("task-1"),
        createStartedAgentTask("task-2")
      ], [
        createCompletedAgentTask("task-1", "succeeded", "brief ready"),
        createCompletedAgentTask("task-2", "succeeded", "yes path")
      ])
    );

    const run = await worker.startRun(workflow, "test-user");
    const view = await waitForRunTerminal(store, run.id);

    expect(run.status).toBe("running");
    expect(view?.run.status).toBe("succeeded");
    expect(view?.nodeRuns.find((nodeRun) => nodeRun.nodeId === "gate")?.output).toEqual({ result: true });
    expect(view?.nodeRuns.find((nodeRun) => nodeRun.nodeId === "yes")?.status).toBe("succeeded");
    expect(view?.nodeRuns.find((nodeRun) => nodeRun.nodeId === "no")?.status).toBe("skipped");
  });

  it("runs sibling agent branches in parallel after a shared upstream node succeeds", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "openclaw-cui-worker-"));
    const store = new FileCuiStore(path.join(tempDir, "cui-store.json"));
    await store.init();

    const workflow = createWorkflow(
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
    const worker = new WorkflowWorker(store, adapter);

    const run = await worker.startRun(workflow, "test-user");
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
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "openclaw-cui-worker-"));
    const store = new FileCuiStore(path.join(tempDir, "cui-store.json"));
    await store.init();

    const workflow = createWorkflow(
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
    const worker = new WorkflowWorker(store, adapter);

    const run = await worker.startRun(workflow, "test-user");
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
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "openclaw-cui-worker-"));
    const store = new FileCuiStore(path.join(tempDir, "cui-store.json"));
    await store.init();

    const workflow = createWorkflow(
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
    const worker = new WorkflowWorker(store, adapter);

    const run = await worker.startRun(workflow, "test-user");
    const view = await waitForRunTerminal(store, run.id);

    expect(view?.run.status).toBe("succeeded");
    expect(view?.nodeRuns.filter((nodeRun) => nodeRun.nodeId === "dev" && nodeRun.status === "succeeded")).toHaveLength(2);
    expect(view?.nodeRuns.filter((nodeRun) => nodeRun.nodeId === "test" && nodeRun.status === "succeeded")).toHaveLength(2);
    expect(view?.nodeRuns.find((nodeRun) => nodeRun.nodeId === "manager")?.status).toBe("succeeded");
    expect(adapter.calls.map((call) => call.agentName)).toEqual(["product", "dev", "test", "dev", "test"]);
  });

  it("lets a manager route work to a nested manager", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "openclaw-cui-worker-"));
    const store = new FileCuiStore(path.join(tempDir, "cui-store.json"));
    await store.init();

    const workflow = createWorkflow(
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
    const worker = new WorkflowWorker(store, adapter);

    const run = await worker.startRun(workflow, "test-user");
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

  it("executes a manager slot box as a nested workflow and returns its output to the manager", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "openclaw-cui-worker-"));
    const store = new FileCuiStore(path.join(tempDir, "cui-store.json"));
    await store.init();

    const workflow = createWorkflow(
      [
        {
          id: "manager",
          type: "manager",
          position: { x: 80, y: 180 },
          config: {
            label: "Manager",
            portCount: 1,
            maxHandoffs: 3,
            instructions: "Run the slot workflow."
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
    const worker = new WorkflowWorker(store, adapter);

    const run = await worker.startRun(workflow, "test-user");
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
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "openclaw-cui-worker-"));
    const store = new FileCuiStore(path.join(tempDir, "cui-store.json"));
    await store.init();

    const workflow = createWorkflow(
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
    const worker = new WorkflowWorker(store, adapter);

    const run = await worker.startRun(workflow, "test-user");
    const view = await waitForRunTerminal(store, run.id);

    expect(view?.run.status).toBe("succeeded");
    expect(view?.nodeRuns.find((nodeRun) => nodeRun.nodeId === "brief")?.status).toBe("succeeded");
    expect(view?.nodeRuns.some((nodeRun) => nodeRun.nodeId === "unassigned-slot")).toBe(false);
  });

  it("runs the manager-driven HTML delivery example through all slot boxes", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "openclaw-cui-worker-"));
    const store = new FileCuiStore(path.join(tempDir, "cui-store.json"));
    await store.init();

    const workflow = createManagerDrivenHtmlWorkflow(new Date().toISOString(), "company-openclaw-studio");
    const adapter = new ScriptedAdapter([
      createStartedAgentTask("task-1"),
      createStartedAgentTask("task-2"),
      createStartedAgentTask("task-3"),
      createStartedAgentTask("task-4")
    ], [
      createCompletedAgentTask("task-1", "succeeded", JSON.stringify({ status: "continue", inspiration: ["clear hero", "dense checklist"] })),
      createCompletedAgentTask(
        "task-2",
        "succeeded",
        JSON.stringify({
          status: "continue",
          nextSlot: 2,
          executionDocumentHtml: "<section><h1>Execution Document</h1></section>"
        })
      ),
      createCompletedAgentTask(
        "task-3",
        "succeeded",
        JSON.stringify({
          status: "continue",
          nextSlot: 3,
          html: "<!doctype html><html><body><h1>Execution Plan</h1></body></html>"
        })
      ),
      createCompletedAgentTask("task-4", "succeeded", JSON.stringify({ status: "complete", verified: true, result: "passed" }))
    ]);
    const worker = new WorkflowWorker(store, adapter);

    const run = await worker.startRun(workflow, "test-user");
    const view = await waitForRunTerminal(store, run.id);

    expect(view?.run.status).toBe("succeeded");
    expect(adapter.calls.map((call) => call.agentName)).toEqual([
      "inspiration-collector",
      "execution-doc-writer",
      "html-code-builder",
      "html-qa-tester"
    ]);
    expect(view?.nodeRuns.find((nodeRun) => nodeRun.nodeId === "html-manager-slot-1")?.status).toBe("succeeded");
    expect(view?.nodeRuns.find((nodeRun) => nodeRun.nodeId === "html-manager-slot-2")?.status).toBe("succeeded");
    expect(view?.nodeRuns.find((nodeRun) => nodeRun.nodeId === "html-manager-slot-3")?.status).toBe("succeeded");
    expect(view?.nodeRuns.find((nodeRun) => nodeRun.nodeId === "html-manager")?.output).toMatchObject({
      status: "completed"
    });
  });

  it("reruns the loop output branch until the loop reaches max iterations", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "openclaw-cui-worker-"));
    const store = new FileCuiStore(path.join(tempDir, "cui-store.json"));
    await store.init();

    const workflow = createWorkflow(
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
    const worker = new WorkflowWorker(
      store,
      new ScriptedAdapter([
        createStartedAgentTask("task-1"),
        createStartedAgentTask("task-2")
      ], [
        createCompletedAgentTask("task-1", "succeeded", "brief ready"),
        createCompletedAgentTask("task-2", "succeeded", "brief ready again")
      ])
    );

    const run = await worker.startRun(workflow, "test-user");
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
      upstream: [{ nodeId: "brief", nodeLabel: "Brief", output: "brief ready again" }]
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

async function waitForRunTerminal(store: FileCuiStore, runId: string): Promise<Awaited<ReturnType<FileCuiStore["getRunView"]>>> {
  const deadline = Date.now() + 2_000;

  while (Date.now() < deadline) {
    const view = await store.getRunView(runId);
    if (view && !["queued", "running", "waiting_approval"].includes(view.run.status)) {
      return view;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error(`Workflow run did not reach a terminal state in time: ${runId}`);
}

function createWorkflow(nodes: WorkflowNode[], edges: WorkflowEdge[]): WorkflowDefinition {
  const now = new Date().toISOString();
  return {
    id: "test-workflow",
    companyId: "company-openclaw-studio",
    name: "Test workflow",
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

function createAgentNode(id: string, label: string, position = { x: 120, y: 180 }): WorkflowNode {
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
