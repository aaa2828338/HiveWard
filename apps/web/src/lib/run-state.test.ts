import { describe, expect, it } from "vitest";
import type { BlueprintRunStatus, BlueprintRunSummary, BlueprintRunView, PendingApprovalItem } from "@hiveward/shared";
import { selectRunPollingTarget, syncApprovalsForRun } from "./run-state";

describe("run state sync", () => {
  it("derives pending inbox items from a waiting approval node in run detail", () => {
    const runView = createRunView("waiting_approval");

    const approvals = syncApprovalsForRun([], runView);

    expect(approvals).toEqual([
      {
        blueprintId: "blueprint-1",
        blueprintName: "Blueprint 1",
        blueprintRunId: "run-1",
        nodeRunId: "node-run-approval",
        nodeId: "approval",
        nodeLabel: "Human Approval",
        startedBy: "tester",
        startedAt: "2026-05-21T01:00:00.000Z",
        requestedAt: "2026-05-21T01:02:00.000Z",
        approverHint: "Lead",
        instructions: "Approve before send."
      }
    ]);
  });

  it("removes stale inbox items when the same run no longer has a waiting approval node", () => {
    const existing: PendingApprovalItem[] = [
      {
        blueprintId: "blueprint-1",
        blueprintName: "Blueprint 1",
        blueprintRunId: "run-1",
        nodeRunId: "node-run-approval",
        nodeId: "approval",
        nodeLabel: "Human Approval",
        startedBy: "tester",
        startedAt: "2026-05-21T01:00:00.000Z",
        requestedAt: "2026-05-21T01:02:00.000Z",
        approverHint: "Lead",
        instructions: "Approve before send."
      }
    ];

    expect(syncApprovalsForRun(existing, createRunView("running"))).toEqual([]);
  });

  it("polls the selected running run on the runs page", () => {
    const running = createRunView("running", { runId: "run-running" });
    const queued = createRunView("queued", { runId: "run-queued" });

    expect(
      selectRunPollingTarget({
        runs: [queued, running],
        selectedBlueprintId: "blueprint-1",
        selectedRunId: "run-running",
        view: "runs"
      })
    ).toBe("run-running");
  });

  it("moves from a stale selected run to the current blueprint active run", () => {
    const stale = createRunView("failed", { runId: "run-stale" });
    const running = createRunView("running", { runId: "run-running" });

    expect(
      selectRunPollingTarget({
        runs: [running, stale],
        selectedBlueprintId: "blueprint-1",
        selectedRunId: "run-stale",
        view: "runs"
      })
    ).toBe("run-running");
  });

  it("does not poll waiting approval runs", () => {
    expect(
      selectRunPollingTarget({
        runs: [createRunView("waiting_approval")],
        selectedBlueprintId: "blueprint-1",
        selectedRunId: "run-1",
        view: "runs"
      })
    ).toBeUndefined();
  });

  it("does not poll runs from another blueprint", () => {
    expect(
      selectRunPollingTarget({
        runs: [createRunView("running", { blueprintId: "blueprint-2" })],
        selectedBlueprintId: "blueprint-1",
        view: "blueprint"
      })
    ).toBeUndefined();
  });
});

function createRunView(
  nodeStatus: "waiting_approval" | "succeeded" | "running" | "queued" | "failed",
  options: {
    blueprintId?: string;
    runId?: string;
  } = {}
): BlueprintRunView {
  const run: BlueprintRunSummary = {
    id: options.runId ?? "run-1",
    companyId: "company-1",
    blueprintId: options.blueprintId ?? "blueprint-1",
    blueprintName: "Blueprint 1",
    blueprintVersion: 1,
    status: toRunStatus(nodeStatus),
    startedBy: "tester",
    startedAt: "2026-05-21T01:00:00.000Z",
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCostUsd: 0,
    openclawRefs: []
  };

  return {
    run,
    nodeRuns: [
      {
        id: "node-run-approval",
        blueprintRunId: run.id,
        blueprintId: run.blueprintId,
        nodeId: "approval",
        nodeLabel: "Human Approval",
        nodeType: "approval",
        status: nodeStatus,
        queuedAt: "2026-05-21T01:01:00.000Z",
        startedAt: "2026-05-21T01:02:00.000Z",
        output: nodeStatus === "waiting_approval"
          ? {
              approverHint: "Lead",
              instructions: "Approve before send."
            }
          : { approved: true }
      }
    ],
    events: [],
    finalResult: null
  };
}

function toRunStatus(nodeStatus: "waiting_approval" | "succeeded" | "running" | "queued" | "failed"): BlueprintRunStatus {
  if (nodeStatus === "waiting_approval") return "waiting_approval";
  if (nodeStatus === "failed") return "failed";
  if (nodeStatus === "succeeded") return "succeeded";
  return nodeStatus;
}
