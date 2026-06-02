import { describe, expect, it } from "vitest";
import {
  approvalActionCanTriggerWorkflow,
  approvalActionIsMessageOnly,
  approvalThreadFromRequest,
  capabilitiesAllow,
  resolveApprovalCapabilities,
  resolveApprovalThreadStatus,
  type ApprovalDecisionAction,
  type ApprovalRequest
} from "./lifecycle";

const removedRevisionAction = (action: "request_changes" | "revise"): ApprovalDecisionAction =>
  action as unknown as ApprovalDecisionAction;

describe("lifecycle contracts", () => {
  it("keeps reply as message-only while canonical decisions can trigger workflow", () => {
    expect(approvalActionIsMessageOnly("reply")).toBe(true);
    expect(approvalActionCanTriggerWorkflow("reply")).toBe(false);
    expect(approvalActionCanTriggerWorkflow("approve")).toBe(true);
    expect(approvalActionCanTriggerWorkflow("complete")).toBe(true);
    expect(approvalActionCanTriggerWorkflow("terminate")).toBe(true);
    expect(approvalActionCanTriggerWorkflow("return_for_revision")).toBe(true);
    expect(approvalActionCanTriggerWorkflow(removedRevisionAction("request_changes"))).toBe(false);
    expect(approvalActionCanTriggerWorkflow(removedRevisionAction("revise"))).toBe(false);
    expect(approvalActionCanTriggerWorkflow("reject")).toBe(false);
  });

  it("declares a single return-for-revision capability by request kind", () => {
    const requirement = resolveApprovalCapabilities("iteration_requirement_plan", "pending");
    const release = resolveApprovalCapabilities("manager_release_report", "pending");
    const agent = resolveApprovalCapabilities("agent_proposal", "pending");
    const delegation = resolveApprovalCapabilities("leader_delegation", "pending");

    expect(capabilitiesAllow(requirement, "reply")).toBe(true);
    expect(capabilitiesAllow(requirement, "return_for_revision")).toBe(true);
    expect(capabilitiesAllow(requirement, removedRevisionAction("request_changes"))).toBe(false);
    expect(capabilitiesAllow(requirement, removedRevisionAction("revise"))).toBe(false);
    expect(capabilitiesAllow(release, "complete")).toBe(true);
    expect(capabilitiesAllow(release, "return_for_revision")).toBe(true);
    expect(capabilitiesAllow(release, removedRevisionAction("request_changes"))).toBe(false);
    expect(capabilitiesAllow(release, removedRevisionAction("revise"))).toBe(false);
    expect(capabilitiesAllow(agent, "return_for_revision")).toBe(true);
    expect(capabilitiesAllow(agent, removedRevisionAction("request_changes"))).toBe(false);
    expect(capabilitiesAllow(agent, removedRevisionAction("revise"))).toBe(false);
    expect(agent).not.toHaveProperty("requestChanges");
    expect(agent).not.toHaveProperty("revise");
    expect(capabilitiesAllow(delegation, removedRevisionAction("request_changes"))).toBe(false);
    expect(capabilitiesAllow(delegation, removedRevisionAction("revise"))).toBe(false);
  });

  it("derives thread state from request lifecycle without splitting revisions into facts", () => {
    const request: ApprovalRequest = {
      id: "approval-1",
      runId: "run-1",
      roundId: "round-1",
      nodeRunId: "node-run-1",
      kind: "iteration_requirement_plan",
      status: "pending",
      title: "Round 1 Plan",
      body: "Plan body",
      threadId: "thread-1",
      revision: 2,
      capabilities: resolveApprovalCapabilities("iteration_requirement_plan", "pending"),
      requestedBy: { type: "node", label: "Top Manager", nodeId: "manager" },
      requestedAt: "2026-05-31T00:00:00.000Z",
      updatedAt: "2026-05-31T00:10:00.000Z"
    };

    expect(resolveApprovalThreadStatus("pending")).toBe("open");
    expect(resolveApprovalThreadStatus("approved")).toBe("closed");
    expect(approvalThreadFromRequest(request)).toEqual({
      id: "thread-1",
      kind: "iteration_requirement_plan",
      status: "open",
      title: "Round 1 Plan",
      runId: "run-1",
      roundId: "round-1",
      nodeRunId: "node-run-1",
      sourceRef: undefined,
      currentRequestId: "approval-1",
      currentRevision: 2,
      capabilities: request.capabilities,
      createdAt: "2026-05-31T00:00:00.000Z",
      updatedAt: "2026-05-31T00:10:00.000Z",
      closedAt: undefined
    });
  });
});
