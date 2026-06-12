import { nanoid } from "nanoid";
import type {
  ApprovalCapabilities,
  ApprovalDecision,
  ApprovalDecisionAction,
  ApprovalDiscussionBinding,
  ApprovalReply,
  ApprovalRequest,
  ApprovalRequestKind,
  ApprovalRequestStatus,
  RunTimelineItem
} from "@hiveward/shared";
import {
  capabilitiesAllow,
  emptyApprovalCapabilities,
  resolveApprovalCapabilities
} from "@hiveward/shared";
import type { HivewardStore } from "../store/hivewardStore";
export interface ApprovalActionResult {
  approvalRequest: ApprovalRequest;
  decision: ApprovalDecision;
}

export type ApprovalDiscussionBindingDraft = Omit<
  ApprovalDiscussionBinding,
  "approvalRequestId" | "threadId" | "createdAt" | "updatedAt"
> & {
  threadId?: string;
  createdAt?: string;
  updatedAt?: string;
};

export interface LifecycleApprovalOutcome {
  resumeExecution: boolean;
  completeRun: boolean;
  prepareNextRound?: {
    sessionId: string;
    roundId: string;
    previousReportRequestId: string;
    humanFeedback?: string;
  };
}

export class ApprovalConflictError extends Error {
  readonly statusCode = 409;
  readonly code = "approval_conflict";

  constructor(message = "Approval request is no longer pending.") {
    super(message);
    this.name = "ApprovalConflictError";
  }
}

export class ApprovalService {
  constructor(private readonly store: HivewardStore) {}

  async buildApprovalHumanFeedback(
    request: ApprovalRequest,
    decision?: ApprovalDecision
  ): Promise<string | undefined> {
    const threadId = request.threadId ?? request.id;
    const replies = await this.store.listApprovalReplies({ threadId });
    const entries: ApprovalFeedbackEntry[] = [];

    for (const reply of replies) {
      if (!isCurrentRequestUserReply(reply, request)) continue;
      const body = reply.body.trim();
      if (!body) continue;
      entries.push({
        source: "reply",
        body,
        createdAt: reply.createdAt
      });
    }

    const actionComment = decision?.comment?.trim();
    if (decision?.actor === "user" && decision.action !== "reply" && actionComment) {
      entries.push({
        source: "decision",
        body: actionComment,
        createdAt: decision.createdAt
      });
    }

    const uniqueEntries = dedupeApprovalFeedback(entries)
      .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());
    const zh = usesChineseText(request.title) ||
      usesChineseText(request.body) ||
      uniqueEntries.some((entry) => usesChineseText(entry.body));
    return formatApprovalHumanFeedback(uniqueEntries, zh);
  }

  async createRequest(input: {
    runId?: string;
    roundId?: string;
    nodeRunId?: string;
    kind: ApprovalRequestKind;
    title: string;
    body: string;
    payloadRef?: string;
    sourceRef?: ApprovalRequest["sourceRef"];
    threadId?: string;
    requestedBy: ApprovalRequest["requestedBy"];
    revision?: number;
    requestedAt?: string;
    capabilities?: ApprovalCapabilities;
    discussionBinding?: ApprovalDiscussionBindingDraft;
  }): Promise<ApprovalRequest> {
    const now = input.requestedAt ?? new Date().toISOString();
    const request: ApprovalRequest = {
      id: `approval-${nanoid(10)}`,
      runId: input.runId,
      roundId: input.roundId,
      nodeRunId: input.nodeRunId,
      kind: input.kind,
      status: "pending",
      title: input.title,
      body: input.body,
      payloadRef: input.payloadRef,
      sourceRef: input.sourceRef,
      threadId: input.threadId ?? `thread-${nanoid(10)}`,
      revision: input.revision ?? 1,
      capabilities: input.capabilities ?? resolveApprovalCapabilities(input.kind, "pending"),
      requestedBy: input.requestedBy,
      requestedAt: now,
      updatedAt: now
    };

    const discussionBinding = input.discussionBinding
      ? buildApprovalDiscussionBindingForRequest(request, input.discussionBinding, now)
      : buildDefaultApprovalDiscussionBinding(request, now);
    await this.store.createApprovalRequestWithDiscussionBinding({ request, discussionBinding });
    if (input.runId && await this.store.getBlueprintRun(input.runId)) {
      await this.store.appendRunTimelineItem({
        id: `timeline-${nanoid(10)}`,
        runId: input.runId,
        createdAt: now,
        actorNodeId: input.requestedBy.nodeId,
        actorLabel: input.requestedBy.label,
        kind: "approval_created",
        title: input.title,
        body: input.body,
        payloadRef: input.payloadRef
      });
    }
    return request;
  }

  approve(id: string, comment?: string): Promise<ApprovalActionResult> {
    return this.decide(id, "approve", "approved", { comment });
  }

  reject(id: string, comment?: string): Promise<ApprovalActionResult> {
    return this.decide(id, "reject", "rejected", { comment });
  }

  async reply(
    id: string,
    message: string
  ): Promise<ApprovalActionResult> {
    return this.recordPendingReply(id, message);
  }

  async recordPendingReply(id: string, message: string): Promise<ApprovalActionResult> {
    const trimmed = message.trim();
    if (!trimmed) throw new Error("Approval reply message is required.");

    const current = await this.requirePendingRequest(id, "reply");
    const now = new Date().toISOString();
    const updated: ApprovalRequest = { ...current, updatedAt: now };
    const decision = this.buildDecision(current.id, "reply", "pending", "user", trimmed, now);
    return this.applyDecisionOrThrow({ approvalRequest: updated, decision });
  }

  async closeWithReply(id: string, message: string): Promise<ApprovalActionResult> {
    return this.recordPendingReply(id, message);
  }

  async autoApprove(input: Parameters<ApprovalService["createRequest"]>[0], comment?: string): Promise<ApprovalActionResult> {
    const request = await this.createRequest(input);
    return this.autoResolve(request.id, comment);
  }

  async autoResolve(id: string, comment?: string): Promise<ApprovalActionResult> {
    const request = await this.requireRequest(id);
    if (request.status !== "pending") {
      throw new ApprovalConflictError("Approval request is already closed.");
    }
    if (request.capabilities.approve) {
      return this.decide(request.id, "auto_approve", "approved", { actor: "system", comment });
    }
    throw new Error("Approval request cannot be auto-resolved.");
  }

  async supersede(id: string): Promise<ApprovalActionResult> {
    const current = await this.requireRequest(id);
    const closed = await this.closeRequest(current, "superseded", "supersede", "system");
    const decision = (await this.store.listApprovalDecisions(current.id)).at(-1);
    if (!decision) throw new Error("Supersede decision was not recorded.");
    return { approvalRequest: closed, decision };
  }

  async closePendingForRun(runId: string, comment: string): Promise<ApprovalRequest[]> {
    const pending = await this.store.listApprovalRequests({ runId, status: "pending" });
    const closed: ApprovalRequest[] = [];
    for (const request of pending) {
      closed.push(await this.closeRequest(request, "superseded", "supersede", "system", comment));
    }
    return closed;
  }

  private async decide(
    id: string,
    action: ApprovalDecisionAction,
    resultingStatus: ApprovalRequestStatus,
    options: { actor?: ApprovalDecision["actor"]; comment?: string } = {}
  ): Promise<ApprovalActionResult> {
    const current = await this.requireRequest(id);
    if (current.status === "pending") {
      if (!capabilitiesAllow(current.capabilities, action)) {
        throw new Error(`Approval request does not allow ${action}.`);
      }
    }
    const now = new Date().toISOString();
    const decision = this.buildDecision(
      current.id,
      action,
      current.status === "pending" ? resultingStatus : current.status,
      options.actor ?? "user",
      options.comment,
      now
    );
    const next: ApprovalRequest = {
      ...current,
      status: current.status === "pending" ? resultingStatus : current.status,
      capabilities: { ...emptyApprovalCapabilities },
      updatedAt: now
    };
    return this.applyDecisionOrThrow({ approvalRequest: next, decision });
  }

  private async closeRequest(
    request: ApprovalRequest,
    status: ApprovalRequestStatus,
    action: ApprovalDecisionAction,
    actor: ApprovalDecision["actor"],
    comment?: string
  ): Promise<ApprovalRequest> {
    const now = new Date().toISOString();
    const decision = this.buildDecision(request.id, action, status, actor, comment, now);
    const next: ApprovalRequest = {
      ...request,
      status,
      capabilities: { ...emptyApprovalCapabilities },
      updatedAt: now
    };
    await this.applyDecisionOrThrow({ approvalRequest: next, decision });
    return next;
  }

  private async requirePendingRequest(id: string, action: ApprovalDecisionAction): Promise<ApprovalRequest> {
    const request = await this.requireRequest(id);
    if (request.status !== "pending") {
      throw new ApprovalConflictError("Approval request is already closed.");
    }
    if (!capabilitiesAllow(request.capabilities, action)) {
      throw new Error(`Approval request does not allow ${action}.`);
    }
    return request;
  }

  private async requireRequest(id: string): Promise<ApprovalRequest> {
    const request = await this.store.getApprovalRequest(id);
    if (!request) throw new Error(`Approval request not found: ${id}`);
    return request;
  }

  private buildDecision(
    approvalRequestId: string,
    action: ApprovalDecisionAction,
    resultingStatus: ApprovalRequestStatus,
    actor: ApprovalDecision["actor"],
    comment: string | undefined,
    createdAt: string
  ): ApprovalDecision {
    return {
      id: `decision-${nanoid(10)}`,
      approvalRequestId,
      action,
      actor,
      comment: comment?.trim() || undefined,
      resultingStatus,
      createdAt
    };
  }

  private async applyDecisionOrThrow(input: {
    approvalRequest: ApprovalRequest;
    decision: ApprovalDecision;
  }): Promise<ApprovalActionResult> {
    const result = await this.store.applyApprovalDecision({
      approvalRequestId: input.approvalRequest.id,
      expectedStatus: "pending",
      nextRequest: input.approvalRequest,
      decision: input.decision,
      timelineItem: input.approvalRequest.runId && await this.store.getBlueprintRun(input.approvalRequest.runId)
        ? this.buildDecisionTimelineItem(input.approvalRequest, input.decision)
        : undefined
    });
    if (result.status === "conflict") {
      throw new ApprovalConflictError(result.approvalRequest ? "Approval request is already closed." : undefined);
    }
    return result;
  }

  private buildDecisionTimelineItem(
    request: ApprovalRequest,
    decision: ApprovalDecision
  ): Omit<RunTimelineItem, "sequence"> & { sequence?: number } {
    if (!request.runId) throw new Error("Approval decision timeline requires a blueprint run id.");
    return {
      id: `timeline-${nanoid(10)}`,
      runId: request.runId,
      createdAt: decision.createdAt,
      actorNodeId: request.requestedBy.nodeId,
      actorLabel: decision.actor,
      kind: "decision_created",
      title: `${request.title}: ${decision.action}`,
      body: decision.comment,
      payloadRef: request.payloadRef
    };
  }

}

function buildDefaultApprovalDiscussionBinding(
  request: ApprovalRequest,
  now: string
): ApprovalDiscussionBinding | undefined {
  if (!approvalKindDefaultsToMessageOnly(request.kind)) return undefined;
  return {
    approvalRequestId: request.id,
    threadId: request.threadId,
    mode: "message_only",
    route: "message_only",
    canStreamReply: false,
    reason: "message_only_approval_kind",
    resolverVersion: 1,
    createdAt: now,
    updatedAt: now
  };
}

export function buildApprovalDiscussionBindingForRequest(
  request: ApprovalRequest,
  draft: ApprovalDiscussionBindingDraft,
  now: string
): ApprovalDiscussionBinding {
  return {
    ...draft,
    approvalRequestId: request.id,
    threadId: draft.threadId ?? request.threadId,
    createdAt: draft.createdAt ?? now,
    updatedAt: draft.updatedAt ?? now
  };
}

function approvalKindDefaultsToMessageOnly(kind: ApprovalRequestKind): boolean {
  return kind === "blueprint_proposal" ||
    kind === "leader_delegation" ||
    kind === "run_request" ||
    kind === "company_config";
}

type ApprovalFeedbackEntry = {
  source: "reply" | "decision";
  body: string;
  createdAt: string;
};

function isCurrentRequestUserReply(reply: ApprovalReply, request: ApprovalRequest): boolean {
  if (reply.actor !== "user") return false;
  if (reply.approvalRequestId) return reply.approvalRequestId === request.id;
  return reply.threadId === (request.threadId ?? request.id);
}

function dedupeApprovalFeedback(entries: ApprovalFeedbackEntry[]): ApprovalFeedbackEntry[] {
  const seen = new Set<string>();
  const unique: ApprovalFeedbackEntry[] = [];
  for (const entry of entries) {
    const key = entry.body.replace(/\s+/g, " ").trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(entry);
  }
  return unique;
}

function formatApprovalHumanFeedback(entries: ApprovalFeedbackEntry[], zh: boolean): string | undefined {
  if (entries.length === 0) return undefined;
  return [
    zh ? "Human feedback / 用户验收反馈:" : "Human feedback / user acceptance feedback:",
    ...entries.map((entry, index) => `${index + 1}. ${approvalFeedbackSourceLabel(entry.source, zh)}: ${entry.body}`)
  ].join("\n");
}

function approvalFeedbackSourceLabel(source: ApprovalFeedbackEntry["source"], zh: boolean): string {
  if (zh) return source === "reply" ? "审批留言" : "审批动作备注";
  return source === "reply" ? "Approval message" : "Approval action note";
}

function usesChineseText(value: string | undefined): boolean {
  return /[\u3400-\u9fff]/.test(value ?? "");
}
