import { nanoid } from "nanoid";
import type {
  ApprovalRequest,
  Artifact,
  BlueprintDefinition,
  BlueprintNode,
  BlueprintRun,
  IterationRound,
  IterationSession,
  ManagerNodeConfig,
  ManagerSlotNodeConfig,
  ReleaseReport
} from "@hiveward/shared";
import type { HivewardStore } from "../store/hivewardStore";
import type { ApprovalActionResult, LifecycleApprovalOutcome } from "./lifecycleApprovalService";
import { ApprovalService } from "./lifecycleApprovalService";
export class IterationService {
  constructor(
    private readonly store: HivewardStore,
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
    threadId?: string;
    replacesRequestId?: string;
    closeReplacedRequest?: boolean;
    metadata?: Pick<IterationRound, "researchStatus" | "researchSummary" | "researchArtifactIds" | "planSource" | "contextSnapshotId">;
  }): Promise<ApprovalRequest> {
    const zh = usesChineseText(input.body) || usesChineseText(input.managerNode.config.label);
    const title = zh
      ? `第 ${input.round.roundNumber} 轮执行计划${input.revision && input.revision > 1 ? ` v${input.revision}` : ""}`
      : `Round ${input.round.roundNumber} Execution Plan${input.revision && input.revision > 1 ? ` v${input.revision}` : ""}`;
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
      threadId: input.threadId,
      revision: input.revision,
      replacesRequestId: input.replacesRequestId,
      closeReplacedRequest: input.closeReplacedRequest,
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
      body: input.summary,
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
    const round = await this.roundForRequest(result.approvalRequest);
    if (!round) return { resumeExecution: false, completeRun: false };
    if (result.decision.action === "approve" || result.decision.action === "auto_approve") {
      await this.store.upsertIterationRound({
        ...round,
        status: "executing",
        approvedRequirementRequestId: result.approvalRequest.id,
        approvedRequirementRevision: result.approvalRequest.revision
      });
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
    const round = await this.roundForRequest(result.approvalRequest);
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

  private async roundForRequest(request: ApprovalRequest): Promise<IterationRound | undefined> {
    return (await this.store.listIterationRounds()).find((round) =>
      round.requirementRequestId === request.id || round.releaseReportRequestId === request.id || round.id === request.roundId
    );
  }

  private async requireSession(sessionId: string): Promise<IterationSession> {
    const session = (await this.store.listIterationSessions()).find((candidate) => candidate.id === sessionId);
    if (!session) throw new Error(`Iteration session not found: ${sessionId}`);
    return session;
  }
}

function usesChineseText(value: string | undefined): boolean {
  return /[\u3400-\u9fff]/.test(value ?? "");
}
