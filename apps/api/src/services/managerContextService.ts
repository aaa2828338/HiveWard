import { nanoid } from "nanoid";
import type {
  Artifact,
  ApprovalDecision,
  BlueprintNode,
  BlueprintNodeRun,
  BlueprintRun,
  CrossRoundContextMode,
  IterationRound,
  IterationSession,
  ManagerContextSnapshot,
  ManagerNodeConfig,
  ReleaseReport
} from "@hiveward/shared";
import type { HivewardStore } from "../store/hivewardStore";

export interface RoundStartContext {
  runId: string;
  sessionId: string;
  roundId: string;
  roundNumber: number;
  originalGoal?: string;
  managerInstructions?: string;
  previousSnapshot?: ManagerContextSnapshot;
  previousReleaseReport?: ReleaseReport;
  currentPlan?: ManagerInjectedContext["currentPlan"];
  humanFeedback?: string;
  artifactIndex: Artifact[];
  rejectedArtifactIndex: Artifact[];
}

export interface ManagerInjectedContext {
  mode:
    | "research_resolution"
    | "requirement_resolution"
    | "dispatch"
    | "revise_plan"
    | "revise_report"
    | "preflight_judgment"
    | "context_snapshot";
  round: {
    id: string;
    number: number;
    status: string;
  };
  fixedBase: {
    originalGoal?: string;
    hardConstraints: string[];
    successCriteria: string[];
  };
  runMemory: ManagerContextSnapshot | null;
  lastRound: {
    report?: ReleaseReport;
    humanFeedback?: string;
  };
  currentPlan?: {
    requestId: string;
    title: string;
    revision: number;
    body: string;
    approvedAt?: string;
  };
  research: {
    status?: string;
    summary?: string;
    source?: string;
  };
  artifactIndex: Artifact[];
  rejectedArtifactIndex: Artifact[];
  assumptions: string[];
  risks: string[];
}

export interface ManagerSnapshotDraft {
  completedItems?: string[];
  rejectedOptions?: string[];
  keyDecisions?: string[];
  validatedFacts?: string[];
  openQuestions?: string[];
  activeRisks?: string[];
  assumptions?: string[];
  recommendedNextStep?: ManagerContextSnapshot["recommendedNextStep"];
  summary?: string;
  freeform?: string;
}

export interface NodeCrossRoundContext {
  mode: CrossRoundContextMode;
  runId: string;
  nodeId: string;
  currentRoundId?: string;
  previousNodeOutputs: Array<{
    roundNumber: number;
    status: string;
    summary: string;
    unresolvedItems: string[];
  }>;
  upstreamArtifacts: Array<{
    artifactId: string;
    title: string;
    kind: string;
    url?: string;
  }>;
  managerMemorySummary?: string;
}

export interface BuildNodeCrossRoundContextInput {
  mode: CrossRoundContextMode;
  run: BlueprintRun;
  node: BlueprintNode;
  currentNodeRun: BlueprintNodeRun;
  upstream?: Array<{
    nodeRunId?: string;
    nodeId: string;
    nodeLabel: string;
    output?: unknown;
  }>;
}

export class ManagerContextService {
  constructor(private readonly store: HivewardStore) {}

  async buildRoundStartContext(input: {
    run: BlueprintRun;
    session: IterationSession;
    round: IterationRound;
    managerNode: BlueprintNode;
    humanFeedback?: string;
  }): Promise<RoundStartContext> {
    const [snapshots, reports, artifacts, approvedPlan] = await Promise.all([
      this.store.listManagerContextSnapshots(input.run.id),
      this.store.listReleaseReports(input.run.id),
      this.store.listArtifacts(input.run.id),
      this.resolveCurrentPlan(input.round)
    ]);
    const previousSnapshot = snapshots.filter((snapshot) => snapshot.roundId !== input.round.id).at(-1);
    const previousReleaseReport = reports.filter((report) => report.roundId !== input.round.id).at(-1);
    const managerConfig = input.managerNode.config as ManagerNodeConfig;
    const artifactIndex = artifacts.filter((artifact) => artifact.status !== "rejected" && artifact.status !== "superseded");
    const rejectedArtifactIndex = artifacts.filter((artifact) =>
      artifact.status === "rejected" && artifact.roundId === input.round.id
    );
    return {
      runId: input.run.id,
      sessionId: input.session.id,
      roundId: input.round.id,
      roundNumber: input.round.roundNumber,
      originalGoal: input.run.blueprintName,
      managerInstructions: managerConfig.instructions,
      previousSnapshot,
      previousReleaseReport,
      currentPlan: approvedPlan,
      humanFeedback: input.humanFeedback?.trim() || undefined,
      artifactIndex,
      rejectedArtifactIndex
    };
  }

  buildManagerInjectedContext(
    context: RoundStartContext,
    input: {
      mode: ManagerInjectedContext["mode"];
      roundStatus: string;
      research?: ManagerInjectedContext["research"];
      assumptions?: string[];
      risks?: string[];
    }
  ): ManagerInjectedContext {
    const snapshot = context.previousSnapshot ?? null;
    return {
      mode: input.mode,
      round: {
        id: context.roundId,
        number: context.roundNumber,
        status: input.roundStatus
      },
      fixedBase: {
        originalGoal: context.originalGoal,
        hardConstraints: [],
        successCriteria: []
      },
      runMemory: snapshot,
      lastRound: {
        report: context.previousReleaseReport,
        humanFeedback: context.humanFeedback
      },
      currentPlan: context.currentPlan,
      research: input.research ?? {},
      artifactIndex: context.artifactIndex,
      rejectedArtifactIndex: context.rejectedArtifactIndex,
      assumptions: input.assumptions ?? snapshot?.assumptions ?? [],
      risks: input.risks ?? snapshot?.activeRisks ?? []
    };
  }

  async createSnapshotFromRoundResult(input: {
    run: BlueprintRun;
    session: IterationSession;
    round: IterationRound;
    releaseReport?: ReleaseReport;
    humanFeedback?: string;
    managerSummary?: ManagerSnapshotDraft;
  }): Promise<ManagerContextSnapshot> {
    const existing = await this.store.listManagerContextSnapshots(input.run.id);
    const version = Math.max(0, ...existing.map((snapshot) => snapshot.version)) + 1;
    const artifactRefs = input.releaseReport?.artifactRefs.map((ref) => ({
      artifactId: ref.artifactId,
      title: ref.title,
      current: ref.current
    })) ?? [];
    const summary = input.releaseReport?.summary
      ?? `Round ${input.round.roundNumber} completed without a release report summary.`;
    const draft = input.managerSummary;
    const activeRisks = normalizeList(draft?.activeRisks);
    const assumptions = normalizeList(draft?.assumptions);
    const snapshot: ManagerContextSnapshot = {
      id: `manager-context-${nanoid(10)}`,
      runId: input.run.id,
      sessionId: input.session.id,
      roundId: input.round.id,
      version,
      sourceReportId: input.releaseReport?.id,
      completedItems: normalizeList(draft?.completedItems, [`Round ${input.round.roundNumber}: ${firstLine(summary)}`]),
      rejectedOptions: normalizeList(draft?.rejectedOptions, input.humanFeedback ? [`Review feedback: ${input.humanFeedback}`] : []),
      keyDecisions: normalizeList(draft?.keyDecisions),
      validatedFacts: normalizeList(draft?.validatedFacts),
      openQuestions: normalizeList(draft?.openQuestions),
      activeRisks: input.round.researchStatus === "assumption_based"
        ? [...activeRisks, "Research used assumptions for this round."]
        : activeRisks,
      assumptions: input.round.researchStatus === "assumption_based"
        ? [...assumptions, "Proceeding with manager-stated assumptions."]
        : assumptions,
      artifactRefs,
      recommendedNextStep: draft?.recommendedNextStep ?? (input.round.roundNumber >= input.session.maxRounds ? "complete" : "plan"),
      summary: draft?.summary?.trim() || summary,
      freeform: draft?.freeform?.trim() || undefined,
      createdAt: new Date().toISOString()
    };
    return this.store.upsertManagerContextSnapshot(snapshot);
  }

  compactSnapshot(snapshot: ManagerContextSnapshot): ManagerContextSnapshot {
    return snapshot;
  }

  async buildNodeCrossRoundContext(input: BuildNodeCrossRoundContextInput): Promise<NodeCrossRoundContext | undefined> {
    if (input.mode === "off") return undefined;

    const [nodeRuns, rounds, artifacts, snapshots] = await Promise.all([
      this.store.listNodeRuns(input.run.id),
      this.store.listIterationRounds({ runId: input.run.id }),
      this.store.listArtifacts(input.run.id),
      this.store.listManagerContextSnapshots(input.run.id)
    ]);
    const roundById = new Map(rounds.map((round) => [round.id, round]));
    const currentRoundId = input.currentNodeRun.iterationRoundId;
    const previousNodeOutputs = nodeRuns
      .filter((nodeRun) => nodeRun.id !== input.currentNodeRun.id)
      .filter((nodeRun) => nodeRun.nodeId === input.node.id)
      .filter((nodeRun) => !currentRoundId || nodeRun.iterationRoundId !== currentRoundId)
      .filter((nodeRun) => nodeRun.status !== "queued" && nodeRun.status !== "running" && nodeRun.status !== "waiting_approval")
      .map((nodeRun) => {
        const round = nodeRun.iterationRoundId ? roundById.get(nodeRun.iterationRoundId) : undefined;
        return {
          roundNumber: round?.roundNumber ?? 0,
          status: nodeRun.status,
          summary: summarizeNodeRunOutput(nodeRun),
          unresolvedItems: extractUnresolvedItems(nodeRun.output, nodeRun.error)
        };
      })
      .filter((item) => item.summary || item.unresolvedItems.length > 0)
      .slice(-6);

    const upstreamArtifacts = input.mode === "node_history"
      ? []
      : collectUpstreamArtifacts(artifacts, input.upstream ?? []);

    const managerMemorySummary = input.mode === "node_history_with_upstream_and_manager_memory"
      ? summarizeManagerMemory(snapshots.filter((snapshot) => snapshot.roundId !== currentRoundId).at(-1))
      : undefined;

    if (previousNodeOutputs.length === 0 && upstreamArtifacts.length === 0 && !managerMemorySummary) {
      return undefined;
    }

    return {
      mode: input.mode,
      runId: input.run.id,
      nodeId: input.node.id,
      currentRoundId,
      previousNodeOutputs,
      upstreamArtifacts,
      managerMemorySummary
    };
  }

  formatNodeCrossRoundContextPrompt(context: NodeCrossRoundContext): string {
    const lines = [
      "Worker cross-round context for this blueprint run only.",
      "This is platform-injected prompt context, not long-term harness memory. Do not assume it exists outside this run.",
      `Mode: ${context.mode}`,
      `Run: ${context.runId}`,
      `Node: ${context.nodeId}`,
      context.currentRoundId ? `Current round: ${context.currentRoundId}` : undefined
    ].filter(Boolean) as string[];

    if (context.previousNodeOutputs.length > 0) {
      lines.push("", "Previous executions of this node:");
      for (const previous of context.previousNodeOutputs) {
        lines.push(`- Round ${previous.roundNumber || "unknown"} (${previous.status}): ${previous.summary}`);
        if (previous.unresolvedItems.length > 0) {
          lines.push("  Unresolved items:");
          previous.unresolvedItems.forEach((item, index) => {
            lines.push(`  ${index + 1}. ${item}`);
          });
        }
      }
    }

    if (context.upstreamArtifacts.length > 0) {
      lines.push("", "Relevant upstream artifacts:");
      for (const artifact of context.upstreamArtifacts) {
        lines.push(`- ${artifact.title} (${artifact.kind})${artifact.url ? `: ${artifact.url}` : ""}`);
      }
    }

    if (context.managerMemorySummary) {
      lines.push("", "Manager memory summary:", context.managerMemorySummary);
    }

    return lines.join("\n");
  }

  private async resolveCurrentPlan(round: IterationRound): Promise<ManagerInjectedContext["currentPlan"] | undefined> {
    if (!round.approvedRequirementRequestId) return undefined;

    const request = await this.store.getApprovalRequest(round.approvedRequirementRequestId);
    if (!request) return undefined;

    const decisions = await this.store.listApprovalDecisions(request.id);
    const approval = decisions.find((decision): decision is ApprovalDecision =>
      decision.action === "approve" || decision.action === "auto_approve"
    );
    return {
      requestId: request.id,
      title: request.title,
      revision: round.approvedRequirementRevision ?? request.revision,
      body: request.body,
      approvedAt: approval?.createdAt ?? request.updatedAt ?? request.requestedAt
    };
  }
}

function firstLine(value: string): string {
  return value.split(/\r?\n/).find((line) => line.trim())?.trim() ?? value.trim();
}

function normalizeList(value: string[] | undefined, fallback: string[] = []): string[] {
  const normalized = Array.isArray(value)
    ? value.map((item) => item.trim()).filter(Boolean)
    : [];
  return normalized.length ? normalized : fallback;
}

function summarizeNodeRunOutput(nodeRun: BlueprintNodeRun): string {
  if (nodeRun.error && nodeRun.output === undefined) return `Error: ${nodeRun.error}`;
  return truncateText(stringifySummaryValue(nodeRun.output), 1400);
}

function stringifySummaryValue(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (value === undefined || value === null) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function extractUnresolvedItems(output: unknown, error?: string): string[] {
  const values = new Set<string>();
  if (error?.trim()) values.add(error.trim());
  collectUnresolvedItems(parseJsonIfString(output), values);
  return [...values].slice(0, 30);
}

function collectUnresolvedItems(value: unknown, values: Set<string>): void {
  if (typeof value === "string") {
    for (const item of extractListItems(value)) {
      values.add(item);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => {
      if (typeof item === "string") values.add(item.trim());
      else collectUnresolvedItems(item, values);
    });
    return;
  }
  if (!value || typeof value !== "object") return;

  const record = value as Record<string, unknown>;
  for (const key of ["unresolvedItems", "issues", "problems", "findings", "fixes", "todos", "openQuestions", "activeRisks"]) {
    collectUnresolvedItems(record[key], values);
  }
}

function extractListItems(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*(?:[-*]|\d+[.)])\s+(.+?)\s*$/)?.[1]?.trim())
    .filter((item): item is string => Boolean(item));
}

function parseJsonIfString(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed || (!trimmed.startsWith("{") && !trimmed.startsWith("["))) return value;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return value;
  }
}

function collectUpstreamArtifacts(
  artifacts: Artifact[],
  upstream: NonNullable<BuildNodeCrossRoundContextInput["upstream"]>
): NodeCrossRoundContext["upstreamArtifacts"] {
  const upstreamNodeRunIds = new Set(upstream.flatMap((item) => item.nodeRunId ? [item.nodeRunId] : []));
  return artifacts
    .filter((artifact) => artifact.nodeRunId && upstreamNodeRunIds.has(artifact.nodeRunId))
    .map((artifact) => ({
      artifactId: artifact.id,
      title: artifact.title ?? artifact.id,
      kind: artifact.kind,
      url: artifact.downloadUrl
    }))
    .slice(-20);
}

function summarizeManagerMemory(snapshot: ManagerContextSnapshot | undefined): string | undefined {
  if (!snapshot) return undefined;
  const sections = [
    snapshot.summary,
    snapshot.openQuestions.length > 0 ? `Open questions: ${snapshot.openQuestions.join("; ")}` : undefined,
    snapshot.activeRisks.length > 0 ? `Active risks: ${snapshot.activeRisks.join("; ")}` : undefined,
    snapshot.recommendedNextStep ? `Recommended next step: ${snapshot.recommendedNextStep}` : undefined
  ].filter(Boolean);
  return truncateText(sections.join("\n"), 1800);
}

function truncateText(value: string, maxLength: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength - 3)}...`;
}
