import { nanoid } from "nanoid";
import type {
  ApprovalCapabilities,
  ApprovalDecision,
  ApprovalDecisionAction,
  ApprovalRequest,
  ApprovalRequestKind,
  ApprovalRequestStatus,
  ReleaseReport,
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
  nextApprovalRequest?: ApprovalRequest;
}

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

  async createRequest(input: {
    runId: string;
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
    replacesRequestId?: string;
    closeReplacedRequest?: boolean;
    finalRound?: boolean;
    requestedAt?: string;
    capabilities?: ApprovalCapabilities;
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
      threadId: input.threadId ?? input.replacesRequestId ?? `thread-${nanoid(10)}`,
      revision: input.revision ?? 1,
      replacesRequestId: input.replacesRequestId,
      capabilities: input.capabilities ?? resolveApprovalCapabilities(input.kind, "pending", { finalRound: input.finalRound }),
      requestedBy: input.requestedBy,
      requestedAt: now,
      updatedAt: now
    };

    if (input.replacesRequestId && input.closeReplacedRequest !== false) {
      const previous = await this.store.getApprovalRequest(input.replacesRequestId);
      if (previous && previous.status === "pending") {
        await this.closeRequest(previous, "superseded", "supersede", "system", request.id);
      }
    }

    await this.store.upsertApprovalRequest(request);
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
    return request;
  }

  approve(id: string, comment?: string, selectedReplyId?: string): Promise<ApprovalActionResult> {
    return this.decide(id, "approve", "approved", { comment, selectedReplyId });
  }

  reject(id: string, comment?: string): Promise<ApprovalActionResult> {
    return this.decide(id, "reject", "rejected", { comment });
  }

  complete(id: string, comment?: string): Promise<ApprovalActionResult> {
    return this.decide(id, "complete", "completed", { comment });
  }

  terminate(id: string, comment?: string): Promise<ApprovalActionResult> {
    return this.decide(id, "terminate", "terminated", { comment });
  }

  async reply(
    id: string,
    message: string,
    revisionOverride: {
      title?: string;
      body?: string;
      payloadRef?: string;
      releaseReport?: ReleaseReport;
      capabilities?: ApprovalCapabilities;
    } = {}
  ): Promise<ApprovalActionResult> {
    const trimmed = message.trim();
    if (!trimmed) throw new Error("Approval reply message is required.");

    const current = await this.requirePendingRequest(id, "reply");
    const now = new Date().toISOString();
    const revision = current.revision + 1;
    const baseRevision = await this.buildReplyRevision(current, trimmed, revision);
    const revised = {
      ...baseRevision,
      ...revisionOverride
    };
    const nextRequest: ApprovalRequest = {
      id: `approval-${nanoid(10)}`,
      runId: current.runId,
      roundId: current.roundId,
      nodeRunId: current.nodeRunId,
      kind: current.kind,
      status: "pending",
      title: revised.title,
      body: revised.body,
      payloadRef: revised.payloadRef,
      sourceRef: current.sourceRef,
      threadId: current.threadId,
      revision,
      replacesRequestId: current.id,
      capabilities: revised.capabilities ?? resolveApprovalCapabilities(
        current.kind,
        "pending",
        { finalRound: current.kind === "manager_release_report" && current.capabilities.complete && !current.capabilities.approve }
      ),
      requestedBy: current.requestedBy,
      requestedAt: now,
      updatedAt: now
    };
    const linkedClosed: ApprovalRequest = {
      ...current,
      status: "replied",
      supersededByRequestId: nextRequest.id,
      capabilities: { ...emptyApprovalCapabilities },
      updatedAt: now
    };
    const decision = this.buildDecision(current.id, "reply", "replied", "user", trimmed, now);
    return this.applyDecisionOrThrow({
      approvalRequest: linkedClosed,
      decision,
      nextApprovalRequest: nextRequest,
      releaseReport: revised.releaseReport
        ? {
            ...revised.releaseReport,
            approvalRequestId: nextRequest.id,
            createdAt: nextRequest.requestedAt
          }
        : undefined
    });
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
    if (request.capabilities.complete) {
      return this.decide(request.id, "complete", "completed", { actor: "system", comment });
    }
    throw new Error("Approval request cannot be auto-resolved.");
  }

  async supersede(id: string, supersededByRequestId?: string): Promise<ApprovalActionResult> {
    const current = await this.requireRequest(id);
    const closed = await this.closeRequest(current, "superseded", "supersede", "system", supersededByRequestId);
    const decision = (await this.store.listApprovalDecisions(current.id)).at(-1);
    if (!decision) throw new Error("Supersede decision was not recorded.");
    return { approvalRequest: closed, decision };
  }

  async closePendingForRun(runId: string, comment: string): Promise<ApprovalRequest[]> {
    const pending = await this.store.listApprovalRequests({ runId, status: "pending" });
    const closed: ApprovalRequest[] = [];
    for (const request of pending) {
      closed.push(await this.closeRequest(request, "superseded", "supersede", "system", undefined, comment));
    }
    return closed;
  }

  private async decide(
    id: string,
    action: ApprovalDecisionAction,
    resultingStatus: ApprovalRequestStatus,
    options: { actor?: ApprovalDecision["actor"]; comment?: string; selectedReplyId?: string } = {}
  ): Promise<ApprovalActionResult> {
    const current = await this.requirePendingRequest(id, action);
    if (action === "complete" && current.kind !== "manager_release_report") {
      throw new Error("Only manager release reports can be completed.");
    }
    if (action === "terminate" && current.kind === "manager_release_report") {
      throw new Error("Manager release reports cannot be terminated.");
    }
    const now = new Date().toISOString();
    const decision = this.buildDecision(
      current.id,
      action,
      resultingStatus,
      options.actor ?? "user",
      options.comment,
      now,
      options.selectedReplyId
    );
    const next: ApprovalRequest = {
      ...current,
      status: resultingStatus,
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
    supersededByRequestId?: string,
    comment?: string
  ): Promise<ApprovalRequest> {
    const now = new Date().toISOString();
    const decision = this.buildDecision(request.id, action, status, actor, comment, now);
    const next: ApprovalRequest = {
      ...request,
      status,
      supersededByRequestId,
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
    createdAt: string,
    selectedReplyId?: string
  ): ApprovalDecision {
    return {
      id: `decision-${nanoid(10)}`,
      approvalRequestId,
      action,
      actor,
      comment: comment?.trim() || undefined,
      selectedReplyId,
      resultingStatus,
      createdAt
    };
  }

  private async applyDecisionOrThrow(input: {
    approvalRequest: ApprovalRequest;
    decision: ApprovalDecision;
    nextApprovalRequest?: ApprovalRequest;
    releaseReport?: ReleaseReport;
  }): Promise<ApprovalActionResult> {
    const result = await this.store.applyApprovalDecision({
      approvalRequestId: input.approvalRequest.id,
      expectedStatus: "pending",
      nextRequest: input.approvalRequest,
      decision: input.decision,
      nextApprovalRequest: input.nextApprovalRequest,
      releaseReport: input.releaseReport,
      timelineItem: await this.store.getBlueprintRun(input.approvalRequest.runId)
        ? this.buildDecisionTimelineItem(input.approvalRequest, input.decision)
        : undefined
    });
    if (result.status === "conflict") {
      throw new ApprovalConflictError();
    }
    return result;
  }

  private appendDecisionTimeline(request: ApprovalRequest, decision: ApprovalDecision): Promise<unknown> {
    return this.store.appendRunTimelineItem(this.buildDecisionTimelineItem(request, decision));
  }

  private buildDecisionTimelineItem(
    request: ApprovalRequest,
    decision: ApprovalDecision
  ): Omit<RunTimelineItem, "sequence"> & { sequence?: number } {
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

  private async buildReplyRevision(
    current: ApprovalRequest,
    message: string,
    revision: number
  ): Promise<{
    title: string;
    body: string;
    payloadRef?: string;
    releaseReport?: ReleaseReport;
  }> {
    if (current.kind === "manager_release_report" && current.roundId) {
      const reports = (await this.store.listReleaseReports(current.runId)).filter((report) => report.roundId === current.roundId);
      const currentReport = reports.find((report) => report.approvalRequestId === current.id || report.id === current.payloadRef) ?? reports.at(-1);
      const round = (await this.store.listIterationRounds({ runId: current.runId }))
        .find((candidate) => candidate.id === current.roundId);
      const version = Math.max(0, ...reports.map((report) => report.version)) + 1;
      const reportId = `release-report-${nanoid(10)}`;
      const title = `Round ${round?.roundNumber ?? current.roundId} Release Report v${version}`;
      const artifactRefs = currentReport?.artifactRefs ?? [];
      const summary = [
        `This is the revised v${version} report based on review feedback.`,
        "Revision feedback:",
        message,
        "Previous report summary:",
        currentReport?.summary ?? current.body
      ].join("\n\n");
      const artifactBody = artifactRefs.length
        ? artifactRefs.map((ref) => `- ${ref.title}: ${ref.location}`).join("\n")
        : "- No artifacts were published for this report revision.";
      return {
        title,
        body: `${summary}\n\nArtifacts:\n${artifactBody}`,
        payloadRef: reportId,
        releaseReport: {
          id: reportId,
          runId: current.runId,
          roundId: current.roundId,
          approvalRequestId: "",
          version,
          title,
          summary,
          artifactRefs,
          supersedesReportId: currentReport?.id,
          createdAt: ""
        }
      };
    }

    const title = appendRevisionSuffix(current.title, revision);
    return {
      title,
      body: [
        `Revision ${revision} for ${current.kind}.`,
        "Previous request:",
        current.body,
        "Revision feedback:",
        message,
        "Revised request:",
        `${current.body}\n\nRequested adjustment: ${message}`
      ].join("\n\n"),
      payloadRef: current.payloadRef
    };
  }
}

function appendRevisionSuffix(title: string, revision: number): string {
  return `${title.replace(/\s+v\d+$/i, "")} v${revision}`;
}
