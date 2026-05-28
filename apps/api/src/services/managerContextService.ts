import { nanoid } from "nanoid";
import type {
  Artifact,
  BlueprintNode,
  BlueprintRun,
  IterationRound,
  IterationSession,
  ManagerContextSnapshot,
  ManagerNodeConfig,
  ReleaseReport
} from "@hiveward/shared";
import type { FileHivewardStore } from "../store/fileHivewardStore";

export interface RoundStartContext {
  runId: string;
  sessionId: string;
  roundId: string;
  roundNumber: number;
  originalGoal?: string;
  managerInstructions?: string;
  previousSnapshot?: ManagerContextSnapshot;
  previousReleaseReport?: ReleaseReport;
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

export class ManagerContextService {
  constructor(private readonly store: FileHivewardStore) {}

  async buildRoundStartContext(input: {
    run: BlueprintRun;
    session: IterationSession;
    round: IterationRound;
    managerNode: BlueprintNode;
    humanFeedback?: string;
  }): Promise<RoundStartContext> {
    const [snapshots, reports, artifacts] = await Promise.all([
      this.store.listManagerContextSnapshots(input.run.id),
      this.store.listReleaseReports(input.run.id),
      this.store.listArtifacts(input.run.id)
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
