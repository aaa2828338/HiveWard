import { mkdtempSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { describe, expect, it } from "vitest";
import type { OpenClawAdapter } from "@openclaw-cui/adapter";
import { FileCuiStore } from "../store/fileCuiStore";
import { WorkflowWorker } from "./workflowWorker";
import { createRealThreeAgentWorkflow, type SendChannelResult, type StartAgentTaskInput, type StartAgentTaskResult } from "@openclaw-cui/shared";

class StubAdapter implements OpenClawAdapter {
  private callCount = 0;

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

  async startAgentTask(_input: StartAgentTaskInput): Promise<StartAgentTaskResult> {
    this.callCount += 1;
    if (this.callCount === 1) {
      return {
        taskId: "task-1",
        runId: "run-1",
        sessionKey: "agent:main:main",
        status: "succeeded",
        output: "brief ok",
        updatedAt: new Date().toISOString()
      };
    }

    return {
      taskId: "task-2",
      runId: "run-2",
      sessionKey: "agent:main:main",
      status: "failed",
      error: "output new_sensitive (1027)",
      updatedAt: new Date().toISOString()
    };
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
  it("marks the run failed and stops downstream execution when an agent result fails", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "openclaw-cui-worker-"));
    const store = new FileCuiStore(path.join(tempDir, "cui-store.json"));
    await store.init();

    const workflow = createRealThreeAgentWorkflow(new Date().toISOString(), "company-openclaw-studio");
    const worker = new WorkflowWorker(store, new StubAdapter());

    const run = await worker.startRun(workflow, "test-user");
    const view = await store.getRunView(run.id);

    expect(run.status).toBe("failed");
    expect(view?.nodeRuns.find((nodeRun) => nodeRun.nodeId === "brief")?.status).toBe("succeeded");
    expect(view?.nodeRuns.find((nodeRun) => nodeRun.nodeId === "plan")?.status).toBe("failed");
    expect(view?.nodeRuns.some((nodeRun) => nodeRun.nodeId === "verify")).toBe(false);
    expect(view?.events.some((event) => event.type === "workflow.run.failed")).toBe(true);
  });
});
