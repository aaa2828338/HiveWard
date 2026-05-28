import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { nanoid } from "nanoid";
import type {
  ApprovalCapabilities,
  ApprovalDecision,
  ApprovalDecisionAction,
  ApprovalRequest,
  ApprovalRequestKind,
  ApprovalRequestStatus,
  Artifact,
  BlueprintDefinition,
  BlueprintNode,
  BlueprintNodeRun,
  BlueprintRun,
  IterationRound,
  IterationSession,
  ManagerMail,
  ManagerNodeConfig,
  ManagerSlotNodeConfig,
  ReleaseReport,
  RuntimeAccessPolicy
} from "@hiveward/shared";
import {
  capabilitiesAllow,
  emptyApprovalCapabilities,
  normalizeRuntimeAccessPolicy,
  resolveApprovalCapabilities,
  runtimeAccessPolicyToPermissionProfile
} from "@hiveward/shared";
import type { AgentPermissionProfile } from "@hiveward/shared";
import type { FileHivewardStore } from "../store/fileHivewardStore";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const defaultDataRoot = join(repositoryRoot, "data");

export function defaultArtifactRoot(): string {
  return join(defaultDataRoot, "artifacts");
}

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

export class ApprovalService {
  constructor(private readonly store: FileHivewardStore) {}

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
    const closed: ApprovalRequest = {
      ...current,
      status: "replied",
      capabilities: { ...emptyApprovalCapabilities },
      updatedAt: now
    };
    const decision = this.buildDecision(current.id, "reply", "replied", "user", trimmed, now);
    const nextRequest = await this.createRequest({
      runId: current.runId,
      roundId: current.roundId,
      nodeRunId: current.nodeRunId,
      kind: current.kind,
      title: revised.title,
      body: revised.body,
      payloadRef: revised.payloadRef,
      sourceRef: current.sourceRef,
      threadId: current.threadId,
      requestedBy: current.requestedBy,
      revision,
      replacesRequestId: current.id,
      closeReplacedRequest: false,
      capabilities: revised.capabilities,
      finalRound: current.kind === "manager_release_report" && current.capabilities.complete && !current.capabilities.approve
    });
    if (revised.releaseReport) {
      await this.store.upsertReleaseReport({
        ...revised.releaseReport,
        approvalRequestId: nextRequest.id,
        createdAt: nextRequest.requestedAt
      });
    }
    const linkedClosed: ApprovalRequest = {
      ...closed,
      supersededByRequestId: nextRequest.id
    };
    await this.store.upsertApprovalRequest(linkedClosed);
    await this.store.appendApprovalDecision(decision);
    await this.appendDecisionTimeline(linkedClosed, decision);
    return { approvalRequest: linkedClosed, decision, nextApprovalRequest: nextRequest };
  }

  async recordPendingReply(id: string, message: string): Promise<ApprovalActionResult> {
    const trimmed = message.trim();
    if (!trimmed) throw new Error("Approval reply message is required.");

    const current = await this.requirePendingRequest(id, "reply");
    const now = new Date().toISOString();
    const updated: ApprovalRequest = { ...current, updatedAt: now };
    const decision = this.buildDecision(current.id, "reply", "pending", "user", trimmed, now);
    await this.store.upsertApprovalRequest(updated);
    await this.store.appendApprovalDecision(decision);
    await this.appendDecisionTimeline(updated, decision);
    return { approvalRequest: updated, decision };
  }

  async autoApprove(input: Parameters<ApprovalService["createRequest"]>[0], comment?: string): Promise<ApprovalActionResult> {
    const request = await this.createRequest(input);
    return this.autoResolve(request.id, comment);
  }

  async autoResolve(id: string, comment?: string): Promise<ApprovalActionResult> {
    const request = await this.requireRequest(id);
    if (request.status !== "pending") {
      throw new Error("Approval request is already closed.");
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
    await this.store.upsertApprovalRequest(next);
    await this.store.appendApprovalDecision(decision);
    await this.appendDecisionTimeline(next, decision);
    return { approvalRequest: next, decision };
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
    await this.store.upsertApprovalRequest(next);
    await this.store.appendApprovalDecision(decision);
    await this.appendDecisionTimeline(next, decision);
    return next;
  }

  private async requirePendingRequest(id: string, action: ApprovalDecisionAction): Promise<ApprovalRequest> {
    const request = await this.requireRequest(id);
    if (request.status !== "pending") {
      throw new Error("Approval request is already closed.");
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

  private appendDecisionTimeline(request: ApprovalRequest, decision: ApprovalDecision): Promise<unknown> {
    return this.store.appendRunTimelineItem({
      id: `timeline-${nanoid(10)}`,
      runId: request.runId,
      createdAt: decision.createdAt,
      actorNodeId: request.requestedBy.nodeId,
      actorLabel: decision.actor,
      kind: "decision_created",
      title: `${request.title}: ${decision.action}`,
      body: decision.comment,
      payloadRef: request.payloadRef
    });
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

export class IterationService {
  constructor(
    private readonly store: FileHivewardStore,
    private readonly approvalService: ApprovalService
  ) {}

  findTopSelfIterationManager(blueprint: BlueprintDefinition): BlueprintNode | undefined {
    const managedManagerIds = new Set(
      blueprint.edges
        .filter((edge) => edge.targetHandle?.startsWith("manager-in-"))
        .filter((edge) => {
          const source = blueprint.nodes.find((node) => node.id === edge.source);
          if (source?.type !== "manager_slot") return true;
          return (source.config as ManagerSlotNodeConfig).managerNodeId !== edge.target;
        })
        .map((edge) => edge.target)
    );
    return blueprint.nodes.find((node) =>
      node.type === "manager" &&
      !node.parentId &&
      !managedManagerIds.has(node.id) &&
      (node.config as ManagerNodeConfig).lifecycleMode === "self_iteration"
    );
  }

  async startSession(input: {
    blueprint: BlueprintDefinition;
    run: BlueprintRun;
    topManagerNode: BlueprintNode;
  }): Promise<{ session: IterationSession; round: IterationRound }> {
    const config = input.topManagerNode.config as ManagerNodeConfig;
    const now = new Date().toISOString();
    const session: IterationSession = {
      id: `iteration-session-${nanoid(10)}`,
      runId: input.run.id,
      topManagerNodeId: input.topManagerNode.id,
      blueprintSnapshotId: input.blueprint.id,
      status: "running",
      maxRounds: Math.max(1, Math.round(config.maxRounds ?? 3)),
      createdAt: now
    };
    const round: IterationRound = {
      id: `iteration-round-${nanoid(10)}`,
      sessionId: session.id,
      runId: input.run.id,
      roundNumber: 1,
      status: "requirement_pending",
      artifactIds: [],
      startedAt: now
    };
    session.currentRoundId = round.id;
    await this.store.upsertIterationSession(session);
    await this.store.upsertIterationRound(round);
    await this.store.appendRunTimelineItem({
      id: `timeline-${nanoid(10)}`,
      runId: input.run.id,
      createdAt: now,
      actorNodeId: input.topManagerNode.id,
      actorLabel: input.topManagerNode.config.label,
      kind: "round_started",
      title: `Round 1 started`
    });
    return { session, round };
  }

  async handleApprovalResult(result: ApprovalActionResult): Promise<LifecycleApprovalOutcome> {
    const request = result.approvalRequest;
    if (request.kind === "iteration_requirement_plan") {
      return this.handleRequirementDecision(result);
    }
    if (request.kind === "manager_release_report") {
      return this.handleReleaseReportDecision(result);
    }
    return { resumeExecution: false, completeRun: false };
  }

  async publishExecutionResult(input: {
    run: BlueprintRun;
    managerNode: BlueprintNode;
    summary: string;
    artifacts: Artifact[];
  }): Promise<{ round: IterationRound; releaseReport: ReleaseReport; approvalRequest: ApprovalRequest } | undefined> {
    const round = await this.currentExecutingRound(input.run.id);
    if (!round) return undefined;
    const artifactIds = [...new Set([...round.artifactIds, ...input.artifacts.map((artifact) => artifact.id)])];
    const artifactPublished: IterationRound = {
      ...round,
      status: "artifact_published",
      artifactIds
    };
    await this.store.upsertIterationRound(artifactPublished);
    for (const artifact of input.artifacts) {
      await this.store.appendRunTimelineItem({
        id: `timeline-${nanoid(10)}`,
        runId: input.run.id,
        createdAt: artifact.createdAt,
        actorNodeId: artifact.nodeRunId,
        actorLabel: artifact.title ?? "Artifact",
        kind: "artifact_published",
        title: artifact.title ?? artifact.id,
        body: artifact.downloadUrl ?? artifact.relativePath
      });
    }
    return this.requestReleaseReport({
      run: input.run,
      round: artifactPublished,
      managerNode: input.managerNode,
      summary: input.summary,
      artifacts: input.artifacts
    });
  }

  async requestRoundPlan(input: {
    session: IterationSession;
    round: IterationRound;
    managerNode: BlueprintNode;
    body: string;
    revision?: number;
    metadata?: Pick<IterationRound, "researchStatus" | "researchSummary" | "researchArtifactIds" | "planSource" | "contextSnapshotId">;
  }): Promise<ApprovalRequest> {
    const title = `Round ${input.round.roundNumber} Execution Plan${input.revision && input.revision > 1 ? ` v${input.revision}` : ""}`;
    const request = await this.approvalService.createRequest({
      runId: input.session.runId,
      roundId: input.round.id,
      kind: "iteration_requirement_plan",
      title,
      body: input.body,
      sourceRef: { type: "blueprint_run", id: input.session.runId },
      requestedBy: {
        type: "node",
        label: input.managerNode.config.label,
        nodeId: input.managerNode.id
      },
      capabilities: input.metadata?.researchStatus === "blocked"
        ? { approve: false, reject: true, reply: true, complete: false, terminate: false }
        : undefined
    });
    await this.store.upsertIterationRound({
      ...input.round,
      ...input.metadata,
      requirementRequestId: request.id,
      status: "requirement_pending"
    });
    await this.store.appendRunTimelineItem({
      id: `timeline-${nanoid(10)}`,
      runId: input.session.runId,
      createdAt: request.requestedAt,
      actorNodeId: input.managerNode.id,
      actorLabel: input.managerNode.config.label,
      kind: "requirement_published",
      title,
      body: input.body
    });
    return request;
  }

  private async requestReleaseReport(input: {
    run: BlueprintRun;
    round: IterationRound;
    managerNode: BlueprintNode;
    summary: string;
    artifacts: Artifact[];
  }): Promise<{ round: IterationRound; releaseReport: ReleaseReport; approvalRequest: ApprovalRequest }> {
    const session = await this.requireSession(input.round.sessionId);
    const finalRound = input.round.roundNumber >= session.maxRounds;
    const priorReports = (await this.store.listReleaseReports(input.run.id)).filter((report) => report.roundId === input.round.id);
    const version = priorReports.length + 1;
    const reportId = `release-report-${nanoid(10)}`;
    const title = `Round ${input.round.roundNumber} Release Report v${version}`;
    const artifactRefs = input.artifacts.map((artifact) => ({
      artifactId: artifact.id,
      title: artifact.title ?? artifact.id,
      location: artifact.downloadUrl ?? artifact.relativePath ?? artifact.storagePath ?? artifact.id,
      current: true
    }));
    const priorReport = priorReports.at(-1);
    if (priorReport) {
      const currentPriorArtifactIds = priorReport.artifactRefs
        .filter((ref) => ref.current)
        .map((ref) => ref.artifactId);
      await this.store.upsertReleaseReport({
        ...priorReport,
        artifactRefs: priorReport.artifactRefs.map((ref) => ({ ...ref, current: false }))
      });
      await this.markArtifacts(currentPriorArtifactIds, "superseded");
    }
    const approvalRequest = await this.approvalService.createRequest({
      runId: input.run.id,
      roundId: input.round.id,
      kind: "manager_release_report",
      title,
      body: `${input.summary}\n\nArtifacts:\n${artifactRefs.map((ref) => `- ${ref.title}: ${ref.location}`).join("\n")}`,
      payloadRef: reportId,
      sourceRef: { type: "blueprint_run", id: input.run.id },
      requestedBy: {
        type: "node",
        label: input.managerNode.config.label,
        nodeId: input.managerNode.id
      },
      finalRound
    });
    const releaseReport: ReleaseReport = {
      id: reportId,
      runId: input.run.id,
      roundId: input.round.id,
      approvalRequestId: approvalRequest.id,
      version,
      title,
      summary: input.summary,
      artifactRefs,
      supersedesReportId: priorReport?.id,
      createdAt: approvalRequest.requestedAt
    };
    await this.store.upsertReleaseReport(releaseReport);
    const nextRound: IterationRound = {
      ...input.round,
      status: "report_pending",
      releaseReportRequestId: approvalRequest.id
    };
    await this.store.upsertIterationRound(nextRound);
    await this.store.appendRunTimelineItem({
      id: `timeline-${nanoid(10)}`,
      runId: input.run.id,
      createdAt: releaseReport.createdAt,
      actorNodeId: input.managerNode.id,
      actorLabel: input.managerNode.config.label,
      kind: "release_report_published",
      title,
      body: input.summary,
      payloadRef: releaseReport.id
    });
    return { round: nextRound, releaseReport, approvalRequest };
  }

  private async handleRequirementDecision(result: ApprovalActionResult): Promise<LifecycleApprovalOutcome> {
    const round = await this.roundForRequest(result.approvalRequest.id);
    if (!round) return { resumeExecution: false, completeRun: false };
    if (result.decision.action === "approve" || result.decision.action === "auto_approve") {
      await this.store.upsertIterationRound({ ...round, status: "requirement_approved" });
      await this.store.upsertIterationRound({ ...round, status: "executing" });
      return { resumeExecution: true, completeRun: false };
    }
    if (result.nextApprovalRequest) {
      await this.store.upsertIterationRound({
        ...round,
        status: "requirement_pending",
        requirementRequestId: result.nextApprovalRequest.id
      });
      await this.appendLifecycleRevisionTimeline(result.nextApprovalRequest, "requirement_published");
    }
    return { resumeExecution: false, completeRun: false };
  }

  private async handleReleaseReportDecision(result: ApprovalActionResult): Promise<LifecycleApprovalOutcome> {
    const round = await this.roundForRequest(result.approvalRequest.id);
    if (!round) return { resumeExecution: false, completeRun: false };
    const session = await this.requireSession(round.sessionId);
    if (result.decision.action === "complete") {
      const now = result.decision.createdAt;
      await this.store.upsertIterationRound({ ...round, status: "report_approved" });
      await this.store.upsertIterationRound({ ...round, status: "completed", endedAt: now });
      await this.store.upsertIterationSession({ ...session, status: "completed", endedAt: now });
      await this.store.appendRunTimelineItem({
        id: `timeline-${nanoid(10)}`,
        runId: round.runId,
        createdAt: now,
        actorLabel: "manager",
        kind: "run_completed",
        title: "Self-iteration completed"
      });
      return { resumeExecution: false, completeRun: true };
    }
    if (result.decision.action === "approve" || result.decision.action === "auto_approve") {
      const now = result.decision.createdAt;
      await this.store.upsertIterationRound({ ...round, status: "report_approved" });
      await this.store.upsertIterationRound({ ...round, status: "completed", endedAt: now });
      await this.store.appendRunTimelineItem({
        id: `timeline-${nanoid(10)}`,
        runId: round.runId,
        createdAt: now,
        actorLabel: "manager",
        kind: "round_completed",
        title: `Round ${round.roundNumber} completed`
      });
      if (round.roundNumber < session.maxRounds) {
        const nextRound = await this.startNextRound(session, round);
        return {
          resumeExecution: false,
          completeRun: false,
          prepareNextRound: {
            sessionId: session.id,
            roundId: nextRound.id,
            previousReportRequestId: result.approvalRequest.id,
            humanFeedback: result.decision.comment
          }
        };
      }
      return { resumeExecution: false, completeRun: false };
    }
    if (result.decision.action === "reject") {
      await this.markRoundArtifactsRejected(round);
      await this.store.upsertIterationRound({
        ...round,
        status: "executing",
        artifactIds: [],
        releaseReportRequestId: undefined,
        startedAt: result.decision.createdAt,
        endedAt: undefined
      });
      return { resumeExecution: true, completeRun: false };
    }
    if (result.nextApprovalRequest) {
      await this.store.upsertIterationRound({
        ...round,
        status: "report_pending",
        releaseReportRequestId: result.nextApprovalRequest.id
      });
      await this.appendLifecycleRevisionTimeline(result.nextApprovalRequest, "release_report_published");
    }
    return { resumeExecution: false, completeRun: false };
  }

  private async markRoundArtifactsRejected(round: IterationRound): Promise<void> {
    await this.markArtifacts(round.artifactIds, "rejected");
    const reports = (await this.store.listReleaseReports(round.runId)).filter((report) => report.roundId === round.id);
    const latestReport = reports.at(-1);
    if (!latestReport) return;
    await this.store.upsertReleaseReport({
      ...latestReport,
      artifactRefs: latestReport.artifactRefs.map((ref) => ({ ...ref, current: false }))
    });
  }

  private async markArtifacts(ids: string[], status: NonNullable<Artifact["status"]>): Promise<void> {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    const artifacts = await this.store.listArtifacts();
    await Promise.all(artifacts
      .filter((artifact) => idSet.has(artifact.id))
      .map((artifact) => this.store.upsertArtifact({ ...artifact, status })));
  }

  private appendLifecycleRevisionTimeline(
    request: ApprovalRequest,
    kind: "requirement_published" | "release_report_published"
  ): Promise<unknown> {
    return this.store.appendRunTimelineItem({
      id: `timeline-${nanoid(10)}`,
      runId: request.runId,
      createdAt: request.requestedAt,
      actorNodeId: request.requestedBy.nodeId,
      actorLabel: request.requestedBy.label,
      kind,
      title: request.title,
      body: request.body,
      payloadRef: request.payloadRef
    });
  }

  async markRunTerminal(
    runId: string,
    status: BlueprintRun["status"],
    endedAt: string
  ): Promise<void> {
    const sessionStatus = status === "succeeded" ? "completed" : status === "cancelled" ? "cancelled" : "failed";
    const roundStatus = status === "succeeded" ? "completed" : status === "cancelled" ? "cancelled" : "failed";
    const sessions = await this.store.listIterationSessions(runId);
    for (const session of sessions) {
      if (session.status === "completed" || session.status === "failed" || session.status === "cancelled") continue;
      await this.store.upsertIterationSession({ ...session, status: sessionStatus, endedAt });
    }
    const rounds = await this.store.listIterationRounds({ runId });
    for (const round of rounds) {
      if (round.status === "completed" || round.status === "failed" || round.status === "cancelled") continue;
      await this.store.upsertIterationRound({ ...round, status: roundStatus, endedAt });
    }
  }

  private async startNextRound(session: IterationSession, previousRound: IterationRound): Promise<IterationRound> {
    const now = new Date().toISOString();
    const round: IterationRound = {
      id: `iteration-round-${nanoid(10)}`,
      sessionId: session.id,
      runId: session.runId,
      roundNumber: previousRound.roundNumber + 1,
      status: "requirement_pending",
      artifactIds: [],
      startedAt: now
    };
    await this.store.upsertIterationRound(round);
    await this.store.upsertIterationSession({ ...session, currentRoundId: round.id });
    await this.store.appendRunTimelineItem({
      id: `timeline-${nanoid(10)}`,
      runId: session.runId,
      createdAt: now,
      actorLabel: "manager",
      kind: "round_started",
      title: `Round ${round.roundNumber} started`
    });
    return round;
  }

  private async currentExecutingRound(runId: string): Promise<IterationRound | undefined> {
    return (await this.store.listIterationRounds({ runId, status: "executing" })).at(-1);
  }

  private async roundForRequest(requestId: string): Promise<IterationRound | undefined> {
    return (await this.store.listIterationRounds()).find((round) =>
      round.requirementRequestId === requestId || round.releaseReportRequestId === requestId
    );
  }

  private async requireSession(sessionId: string): Promise<IterationSession> {
    const session = (await this.store.listIterationSessions()).find((candidate) => candidate.id === sessionId);
    if (!session) throw new Error(`Iteration session not found: ${sessionId}`);
    return session;
  }
}

export class ArtifactService {
  private readonly artifactRoot: string;
  private readonly downloadUrlPrefix: string;

  constructor(
    private readonly store: FileHivewardStore,
    options: { rootDir?: string; downloadUrlPrefix?: string } = {}
  ) {
    this.artifactRoot = resolve(options.rootDir ?? join(store.getDataDir(), "artifacts"));
    this.downloadUrlPrefix = normalizeDownloadUrlPrefix(options.downloadUrlPrefix ?? "/artifacts");
  }

  async publishFromNodeRun(input: {
    runId: string;
    roundId?: string;
    nodeRun: BlueprintNodeRun;
  }): Promise<Artifact[]> {
    if (input.nodeRun.output === undefined || input.nodeRun.output === null) return [];
    const artifacts = await this.extractArtifacts({
      runId: input.runId,
      roundId: input.roundId,
      nodeRunId: input.nodeRun.id,
      title: input.nodeRun.nodeLabel,
      output: input.nodeRun.output
    });
    for (const artifact of artifacts) {
      await this.store.upsertArtifact(artifact);
    }
    return artifacts;
  }

  private async extractArtifacts(input: {
    runId: string;
    roundId?: string;
    nodeRunId?: string;
    title: string;
    output: unknown;
  }): Promise<Artifact[]> {
    const createdAt = new Date().toISOString();
    const stringOutput = typeof input.output === "string" ? input.output.trim() : "";
    const html = extractHtml(stringOutput);
    if (html) {
      const artifact = await this.writeArtifactFile(input, html, createdAt, {
        extension: "html",
        kind: "html",
        format: "text/html",
        previewPolicy: "sandboxed_iframe",
        trusted: false
      });
      return [artifact];
    }
    if (stringOutput) {
      return [await this.writeArtifactFile(input, stringOutput, createdAt, {
        extension: "md",
        kind: "markdown",
        format: "text/markdown",
        previewPolicy: "source",
        trusted: true
      })];
    }
    return [await this.writeArtifactFile(input, JSON.stringify(input.output, null, 2), createdAt, {
      extension: "json",
      kind: "json",
      format: "application/json",
      previewPolicy: "source",
      trusted: true
    })];
  }

  private async writeArtifactFile(
    input: { runId: string; roundId?: string; nodeRunId?: string; title: string },
    body: string,
    createdAt: string,
    options: {
      extension: "html" | "md" | "json";
      kind: Artifact["kind"];
      format: string;
      previewPolicy: Artifact["previewPolicy"];
      trusted: boolean;
    }
  ): Promise<Artifact> {
    const id = `artifact-${nanoid(10)}`;
    const relativePath = join("runs", input.runId, input.roundId ?? "unscoped", `${id}.${options.extension}`);
    const storagePath = join(this.artifactRoot, relativePath);
    const resolved = resolve(storagePath);
    if (!isPathInside(resolved, this.artifactRoot)) {
      throw new Error("Artifact path escaped artifact root.");
    }
    await mkdir(dirname(resolved), { recursive: true });
    await writeFile(resolved, body, "utf8");
    const publicRelativePath = relative(this.artifactRoot, resolved).replace(/\\/g, "/");
    return {
      id,
      runId: input.runId,
      roundId: input.roundId,
      nodeRunId: input.nodeRunId,
      title: input.title,
      kind: options.kind,
      format: options.format,
      storagePath: resolved,
      relativePath: publicRelativePath,
      downloadUrl: `${this.downloadUrlPrefix}/${relativePath.replace(/\\/g, "/")}`,
      previewPolicy: options.previewPolicy,
      trusted: options.trusted,
      status: "current",
      createdAt
    };
  }
}

export class ManagerMailProjector {
  constructor(private readonly store: FileHivewardStore) {}

  async refresh(runId?: string): Promise<ManagerMail[]> {
    const requests = await this.store.listApprovalRequests({ runId });
    const mail = requests.map((request) => this.fromApprovalRequest(request));
    await this.store.replaceManagerMail(mail);
    return mail;
  }

  fromApprovalRequest(request: ApprovalRequest): ManagerMail {
    return {
      id: `mail-${request.id}`,
      sourceType: "approval_request",
      sourceId: request.id,
      kind: request.kind,
      status: request.status,
      title: request.title,
      body: request.body,
      capabilities: request.capabilities,
      relatedRunId: request.runId,
      relatedRoundId: request.roundId,
      createdAt: request.requestedAt,
      updatedAt: request.updatedAt ?? request.requestedAt
    };
  }
}

export class RuntimeAccessPolicyService {
  static normalize(value: Partial<RuntimeAccessPolicy> | undefined, legacyPermissionProfile?: AgentPermissionProfile): RuntimeAccessPolicy {
    return normalizeRuntimeAccessPolicy(value, legacyPermissionProfile);
  }

  static toPermissionProfile(policy: RuntimeAccessPolicy): AgentPermissionProfile {
    return runtimeAccessPolicyToPermissionProfile(policy);
  }
}

export class MigrationService {
  constructor(
    private readonly store: FileHivewardStore,
    private readonly approvalService: ApprovalService
  ) {}

  async migratePendingNodeApproval(input: {
    runId: string;
    nodeRun: BlueprintNodeRun;
    requestedByLabel: string;
  }): Promise<ApprovalRequest | undefined> {
    if (input.nodeRun.status !== "waiting_approval") return undefined;
    const existing = (await this.store.listApprovalRequests({ runId: input.runId, status: "pending" }))
      .find((request) => request.nodeRunId === input.nodeRun.id);
    const body = stringifyHumanBody(input.nodeRun.output);
    if (existing) {
      const updated: ApprovalRequest = {
        ...existing,
        body,
        sourceRef: { type: "node_run", id: input.nodeRun.id },
        capabilities: resolveApprovalCapabilities("agent_proposal", "pending"),
        updatedAt: new Date().toISOString()
      };
      await this.store.upsertApprovalRequest(updated);
      return updated;
    }
    return this.approvalService.createRequest({
      runId: input.runId,
      nodeRunId: input.nodeRun.id,
      kind: "agent_proposal",
      title: `${input.nodeRun.nodeLabel} approval`,
      body,
      sourceRef: { type: "node_run", id: input.nodeRun.id },
      requestedBy: {
        type: "node",
        label: input.requestedByLabel,
        nodeId: input.nodeRun.nodeId
      }
    });
  }
}

export function isPathInside(candidatePath: string, rootPath: string): boolean {
  const root = resolve(rootPath);
  const candidate = resolve(candidatePath);
  return candidate === root || candidate.startsWith(root.endsWith(sep) ? root : `${root}${sep}`);
}

function normalizeDownloadUrlPrefix(value: string): string {
  const trimmed = value.trim().replace(/\/+$/g, "");
  return trimmed.startsWith("/") ? trimmed || "/artifacts" : `/${trimmed || "artifacts"}`;
}

function extractHtml(value: string): string | undefined {
  if (!value) return undefined;
  const fenced = /```html\s*([\s\S]*?)```/i.exec(value);
  if (fenced?.[1]?.trim()) return fenced[1].trim();
  if (/<!doctype html/i.test(value) || /<html[\s>]/i.test(value)) return value;
  return undefined;
}

function stringifyHumanBody(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return String(value ?? "");
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
