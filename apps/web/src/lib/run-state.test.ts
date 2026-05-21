import { describe, expect, it } from "vitest";
import type { BlueprintRunSummary, BlueprintRunView, PendingApprovalItem } from "@hiveward/shared";
import { syncApprovalsForRun } from "./run-state";

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
});

function createRunView(approvalStatus: "waiting_approval" | "succeeded" | "running"): BlueprintRunView {
  const run: BlueprintRunSummary = {
    id: "run-1",
    companyId: "company-1",
    blueprintId: "blueprint-1",
    blueprintName: "Blueprint 1",
    blueprintVersion: 1,
    status: approvalStatus === "waiting_approval" ? "waiting_approval" : "running",
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
        status: approvalStatus,
        queuedAt: "2026-05-21T01:01:00.000Z",
        startedAt: "2026-05-21T01:02:00.000Z",
        output: approvalStatus === "waiting_approval"
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
