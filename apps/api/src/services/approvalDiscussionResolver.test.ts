import { describe, expect, it } from "vitest";
import type { ApprovalDiscussionBinding, ApprovalRequest, NodeExecutionSession } from "@hiveward/shared";
import { resolveApprovalCapabilities } from "@hiveward/shared";
import { resolveApprovalDiscussion } from "./approvalDiscussionResolver";

const now = "2026-05-21T01:03:00.000Z";

describe("approval discussion resolver", () => {
  it("treats missing binding as missing canonical discussion facts", () => {
    const request = createApprovalRequest({ id: "approval-missing-binding", kind: "agent_proposal" });

    expect(resolveApprovalDiscussion({ request }).capability).toEqual({
      mode: "none",
      canStreamReply: false,
      canCreateCandidate: false,
      reason: "discussion_binding_missing"
    });
  });

  it("keeps message-only bindings from creating candidate replies", () => {
    const request = createApprovalRequest({ id: "approval-message-only", kind: "blueprint_proposal" });
    const binding: ApprovalDiscussionBinding = {
      approvalRequestId: request.id,
      threadId: request.threadId,
      mode: "message_only",
      route: "message_only",
      canStreamReply: false,
      canCreateCandidate: false,
      reason: "message_only_approval_kind",
      resolverVersion: 1,
      createdAt: now,
      updatedAt: now
    };

    expect(resolveApprovalDiscussion({ request, binding }).capability).toEqual({
      mode: "message_only",
      canStreamReply: false,
      canCreateCandidate: false,
      reason: "message_only_approval_kind"
    });
  });

  it("does not project unavailable executor sessions as message-only", () => {
    const request = createApprovalRequest({ id: "approval-unavailable-executor", kind: "agent_proposal" });
    const binding: ApprovalDiscussionBinding = {
      approvalRequestId: request.id,
      threadId: request.threadId,
      mode: "executor",
      route: "agent_approval",
      executorActor: "agent",
      executorKind: "agent_approval",
      executorNodeId: "delivery",
      executorNodeRunId: "node-run-delivery",
      executorSessionId: "session-unavailable",
      canStreamReply: true,
      canCreateCandidate: true,
      resolverVersion: 1,
      createdAt: now,
      updatedAt: now
    };
    const unavailableSession: NodeExecutionSession = {
      id: "session-unavailable",
      runId: "run-approval",
      nodeRunId: "node-run-delivery",
      nodeId: "delivery",
      harnessId: "codex",
      policy: "refresh_per_run",
      status: "unavailable",
      createdAt: now,
      updatedAt: now
    };

    expect(resolveApprovalDiscussion({ request, binding, sessions: [unavailableSession] }).capability).toEqual({
      mode: "none",
      canStreamReply: false,
      canCreateCandidate: false,
      reason: "executor_session_unavailable"
    });
  });
});

function createApprovalRequest(input: {
  id: string;
  kind: ApprovalRequest["kind"];
}): ApprovalRequest {
  return {
    id: input.id,
    runId: "run-approval",
    nodeRunId: "node-run-delivery",
    kind: input.kind,
    status: "pending",
    title: "Approval",
    body: "Review output.",
    threadId: `thread-${input.id}`,
    revision: 1,
    capabilities: resolveApprovalCapabilities(input.kind, "pending"),
    requestedBy: { type: "node", label: "Delivery", nodeId: "delivery" },
    requestedAt: now,
    updatedAt: now
  };
}
