import { describe, expect, it } from "vitest";
import type { ApprovalRequest, ManagerNodeConfig } from "@hiveward/shared";
import { SelfIterationOrchestrator } from "./selfIterationOrchestrator";

describe("SelfIterationOrchestrator", () => {
  it("selects auto-resolvable self-iteration approvals owned by the top manager", () => {
    const orchestrator = new SelfIterationOrchestrator();
    const config = {
      autoApproveRequirements: true,
      autoApproveReleaseReports: true
    } as ManagerNodeConfig;
    const selected = orchestrator.selectNextAutoResolvableRequest({
      requests: [
        approval("other", "iteration_requirement_plan", "2026-05-30T00:00:00.000Z", { approve: true }),
        approval("top-manager", "manager_release_report", "2026-05-30T00:00:02.000Z", { complete: true }),
        approval("top-manager", "iteration_requirement_plan", "2026-05-30T00:00:01.000Z", { approve: true })
      ],
      topManagerNodeId: "top-manager",
      config
    });

    expect(selected?.kind).toBe("iteration_requirement_plan");
    expect(selected?.requestedAt).toBe("2026-05-30T00:00:01.000Z");
  });

  it("does not auto-resolve blocked or disabled approval actions", () => {
    const orchestrator = new SelfIterationOrchestrator();
    const config = {
      autoApproveRequirements: true,
      autoApproveReleaseReports: true
    } as ManagerNodeConfig;

    expect(orchestrator.canAutoResolveRequest(
      approval("top-manager", "iteration_requirement_plan", "2026-05-30T00:00:00.000Z", { approve: false }),
      config
    )).toBe(false);
    expect(orchestrator.canAutoResolveRequest(
      approval("top-manager", "manager_release_report", "2026-05-30T00:00:00.000Z", { approve: false, complete: false }),
      config
    )).toBe(false);
  });
});

function approval(
  nodeId: string,
  kind: ApprovalRequest["kind"],
  requestedAt: string,
  capabilities: Partial<ApprovalRequest["capabilities"]>
): ApprovalRequest {
  return {
    id: `approval-${nodeId}-${kind}-${requestedAt}`,
    runId: "run-1",
    kind,
    status: "pending",
    title: kind,
    body: kind,
    revision: 1,
    capabilities: {
      approve: false,
      reject: false,
      reply: false,
      complete: false,
      terminate: false,
      ...capabilities
    },
    requestedBy: {
      type: "node",
      nodeId,
      label: nodeId
    },
    requestedAt,
    updatedAt: requestedAt
  };
}
