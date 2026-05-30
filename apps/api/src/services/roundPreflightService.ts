import type {
  AgentNodeConfig,
  AgentTaskResult,
  BlueprintDefinition,
  BlueprintNode,
  BlueprintRun,
  IterationRound,
  IterationSession,
  ManagerNodeConfig
} from "@hiveward/shared";
import { isAgentBlueprintNode, isManagerSlotInnerOutHandle } from "@hiveward/shared";
import { ManagerContextService, type ManagerInjectedContext, type RoundStartContext } from "./managerContextService";

export type RoundPreflightMode =
  | "research_resolution"
  | "requirement_resolution"
  | "revise_plan"
  | "preflight_judgment"
  | "context_snapshot";

export interface RoundPreflightExecutionResult {
  result: AgentTaskResult;
  artifactIds: string[];
}

export interface RoundPreflightExecutors {
  runAgentNode(input: {
    node: BlueprintNode & { type: "agent"; config: AgentNodeConfig };
    mode: RoundPreflightMode;
    runContext: ManagerInjectedContext;
    taskInput: Record<string, unknown>;
  }): Promise<RoundPreflightExecutionResult>;
  runManagerFallback(input: {
    mode: RoundPreflightMode;
    runContext: ManagerInjectedContext;
    taskInput: Record<string, unknown>;
  }): Promise<RoundPreflightExecutionResult>;
  recordContextSufficientResearch(input: {
    runContext: ManagerInjectedContext;
    taskInput: Record<string, unknown>;
    summary: string;
    source: "previous_snapshot" | "previous_release_report";
  }): Promise<RoundPreflightExecutionResult>;
}

export interface RoundPreflightResult {
  body: string;
  researchStatus: NonNullable<IterationRound["researchStatus"]>;
  researchSummary?: string;
  researchArtifactIds: string[];
  planSource: NonNullable<IterationRound["planSource"]>;
  assumptions: string[];
  risks: string[];
  runContext: ManagerInjectedContext;
}

interface ResearchResolution {
  status: NonNullable<IterationRound["researchStatus"]>;
  summary: string;
  artifactIds: string[];
  source: string;
}

interface RequirementResolution {
  source: NonNullable<IterationRound["planSource"]>;
  body: string;
  assumptions: string[];
  risks: string[];
}

interface ParsedPreflightOutput {
  text?: string;
  hardBlocker?: boolean;
  humanReportMd?: string;
  needsMoreResearch?: boolean;
  reason?: string;
  researchBrief?: string;
  assumptions?: string[];
  risks?: string[];
  assumptionBased?: boolean;
}

const selfIterationResearchSlot = 1;
const selfIterationRequirementSlot = 2;

class RoundPreflightBlockedError extends Error {
  constructor(
    message: string,
    readonly source = "manager",
    readonly artifactIds: string[] = [],
    readonly humanReportMd?: string
  ) {
    super(message);
    this.name = "RoundPreflightBlockedError";
  }
}

export class RoundPreflightService {
  constructor(private readonly managerContextService: ManagerContextService) {}

  async prepareRoundPlan(input: {
    blueprint: BlueprintDefinition;
    run: BlueprintRun;
    session: IterationSession;
    round: IterationRound;
    topManagerNode: BlueprintNode;
    humanFeedback?: string;
    previousRequirement?: string;
    revision?: number;
    executors: RoundPreflightExecutors;
  }): Promise<RoundPreflightResult> {
    const managerConfig = input.topManagerNode.config as ManagerNodeConfig;
    const maxPreparationAttempts = normalizePreparationAttempts(managerConfig.maxPreparationAttempts);
    const context = await this.managerContextService.buildRoundStartContext({
      run: input.run,
      session: input.session,
      round: input.round,
      managerNode: input.topManagerNode,
      humanFeedback: input.humanFeedback
    });

    let research: ResearchResolution;
    try {
      research = await this.resolveResearch({
        ...input,
        context,
        preparationAttempt: 1,
        maxPreparationAttempts
      });
    } catch (error) {
      return this.blockedResult(input, context, toBlockedError(error));
    }

    let plan: RequirementResolution | undefined;
    for (let attempt = 1; attempt <= maxPreparationAttempts; attempt += 1) {
      try {
        plan = await this.resolveRequirement({
          ...input,
          context,
          research,
          preparationAttempt: attempt,
          maxPreparationAttempts
        });

        if (attempt >= maxPreparationAttempts) break;
        const judgment = await this.judgePlanNeedsMoreResearch({
          ...input,
          context,
          research,
          plan,
          preparationAttempt: attempt,
          maxPreparationAttempts
        });
        if (!judgment.needsMoreResearch) break;

        research = await this.resolveResearch({
          ...input,
          context,
          humanFeedback: [
            input.humanFeedback,
            `Manager preflight judgment requested more research: ${judgment.reason ?? "No reason provided."}`,
            judgment.researchBrief ? `Research brief: ${judgment.researchBrief}` : undefined
          ].filter(Boolean).join("\n\n"),
          forceResearch: true,
          preparationAttempt: attempt + 1,
          maxPreparationAttempts
        });
      } catch (error) {
        return this.blockedResult(input, context, toBlockedError(error));
      }
    }

    if (!plan) {
      return this.blockedResult(input, context, new RoundPreflightBlockedError("Round preflight did not produce an execution plan."));
    }

    const runContext = this.managerContextService.buildManagerInjectedContext(context, {
      mode: input.revision && input.revision > 1 ? "revise_plan" : "requirement_resolution",
      roundStatus: input.round.status,
      research: {
        status: research.status,
        summary: research.summary,
        source: research.source
      },
      assumptions: plan.assumptions,
      risks: plan.risks
    });
    return {
      body: formatRoundExecutionPlan({
        roundNumber: input.round.roundNumber,
        revision: input.revision ?? 1,
        planText: plan.body,
        research,
        planSource: plan.source,
        context,
        assumptions: plan.assumptions,
        risks: plan.risks
      }),
      researchStatus: research.status,
      researchSummary: research.summary,
      researchArtifactIds: research.artifactIds,
      planSource: plan.source,
      assumptions: plan.assumptions,
      risks: plan.risks,
      runContext
    };
  }

  private async resolveResearch(input: {
    blueprint: BlueprintDefinition;
    run: BlueprintRun;
    round: IterationRound;
    topManagerNode: BlueprintNode;
    humanFeedback?: string;
    executors: RoundPreflightExecutors;
    context: RoundStartContext;
    forceResearch?: boolean;
    preparationAttempt?: number;
    maxPreparationAttempts?: number;
  }): Promise<ResearchResolution> {
    const managerConfig = input.topManagerNode.config as ManagerNodeConfig;
    const preparationAttempt = input.preparationAttempt ?? 1;
    const maxPreparationAttempts = input.maxPreparationAttempts ?? normalizePreparationAttempts(managerConfig.maxPreparationAttempts);
    const researchAgent = this.resolvePreflightSlotAgent(input.blueprint, input.topManagerNode, selfIterationResearchSlot);
    const baseRunContext = this.managerContextService.buildManagerInjectedContext(input.context, {
      mode: "research_resolution",
      roundStatus: input.round.status
    });
    const taskInput = {
      runId: input.run.id,
      blueprintName: input.blueprint.name,
      manager: input.topManagerNode.config.label,
      instructions: managerConfig.instructions,
      roundNumber: input.round.roundNumber,
      humanFeedback: input.humanFeedback,
      preparationAttempt,
      maxPreparationAttempts,
      runContext: baseRunContext
    };
    if (!input.forceResearch && input.context.previousSnapshot && !input.humanFeedback?.trim()) {
      await input.executors.recordContextSufficientResearch({
        runContext: baseRunContext,
        taskInput,
        summary: input.context.previousSnapshot.summary,
        source: "previous_snapshot"
      });
      return {
        status: "context_sufficient",
        summary: input.context.previousSnapshot.summary,
        artifactIds: [],
        source: "previous_snapshot"
      };
    }
    if (!input.forceResearch && input.context.previousReleaseReport && !input.humanFeedback?.trim() && !researchAgent) {
      await input.executors.recordContextSufficientResearch({
        runContext: baseRunContext,
        taskInput,
        summary: input.context.previousReleaseReport.summary,
        source: "previous_release_report"
      });
      return {
        status: "context_sufficient",
        summary: input.context.previousReleaseReport.summary,
        artifactIds: [],
        source: "previous_release_report"
      };
    }
    if (researchAgent) {
      const executed = await executeRequired(
        () => input.executors.runAgentNode({
          node: researchAgent,
          mode: "research_resolution",
          runContext: baseRunContext,
          taskInput
        }),
        `Research agent ${researchAgent.config.label}`
      );
      const parsed = parsePreflightOutput(executed.result);
      assertNoHardBlocker(parsed, researchAgent.config.label, executed.artifactIds);
      if (!parsed.text) {
        throw new RoundPreflightBlockedError(`Research agent ${researchAgent.config.label} returned no usable research output.`, researchAgent.config.label, executed.artifactIds);
      }
      return {
        status: parsed.assumptionBased ? "assumption_based" : "agent_generated",
        summary: parsed.text,
        artifactIds: executed.artifactIds,
        source: researchAgent.config.label
      };
    }

    const executed = await executeRequired(
      () => input.executors.runManagerFallback({
        mode: "research_resolution",
        runContext: baseRunContext,
        taskInput
      }),
      "Manager research fallback"
    );
    const parsed = parsePreflightOutput(executed.result);
    assertNoHardBlocker(parsed, "manager_fallback", executed.artifactIds);
    if (!parsed.text) {
      throw new RoundPreflightBlockedError("Manager research fallback returned no usable research output.", "manager_fallback", executed.artifactIds);
    }
    return {
      status: parsed.assumptionBased ? "assumption_based" : "manager_fallback",
      summary: parsed.text,
      artifactIds: executed.artifactIds,
      source: "manager_fallback"
    };
  }

  private async resolveRequirement(input: {
    blueprint: BlueprintDefinition;
    run: BlueprintRun;
    round: IterationRound;
    topManagerNode: BlueprintNode;
    humanFeedback?: string;
    previousRequirement?: string;
    executors: RoundPreflightExecutors;
    context: RoundStartContext;
    research: ResearchResolution;
    preparationAttempt?: number;
    maxPreparationAttempts?: number;
  }): Promise<RequirementResolution> {
    const managerConfig = input.topManagerNode.config as ManagerNodeConfig;
    const preparationAttempt = input.preparationAttempt ?? 1;
    const maxPreparationAttempts = input.maxPreparationAttempts ?? normalizePreparationAttempts(managerConfig.maxPreparationAttempts);
    const runContext = this.managerContextService.buildManagerInjectedContext(input.context, {
      mode: input.previousRequirement ? "revise_plan" : "requirement_resolution",
      roundStatus: input.round.status,
      research: {
        status: input.research.status,
        summary: input.research.summary,
        source: input.research.source
      }
    });
    const taskInput = {
      runId: input.run.id,
      blueprintName: input.blueprint.name,
      manager: input.topManagerNode.config.label,
      instructions: managerConfig.instructions,
      revisionFeedback: input.humanFeedback,
      previousRequirement: input.previousRequirement,
      previousReportSummary: input.context.previousReleaseReport?.summary,
      researchSummary: input.research.summary,
      researchStatus: input.research.status,
      roundNumber: input.round.roundNumber,
      preparationAttempt,
      maxPreparationAttempts,
      runContext
    };
    const requirementAgent = this.resolvePreflightSlotAgent(input.blueprint, input.topManagerNode, selfIterationRequirementSlot);
    if (requirementAgent) {
      const executed = await executeRequired(
        () => input.executors.runAgentNode({
          node: requirementAgent,
          mode: input.previousRequirement ? "revise_plan" : "requirement_resolution",
          runContext,
          taskInput
        }),
        `Requirement agent ${requirementAgent.config.label}`
      );
      const parsed = parsePreflightOutput(executed.result);
      assertNoHardBlocker(parsed, requirementAgent.config.label, executed.artifactIds);
      if (!parsed.text) {
        throw new RoundPreflightBlockedError(`Requirement agent ${requirementAgent.config.label} returned no usable plan output.`, requirementAgent.config.label, executed.artifactIds);
      }
      return {
        source: input.previousRequirement ? "revised_from_reply" : "agent_generated",
        body: parsed.text,
        assumptions: parsed.assumptions ?? defaultAssumptions(input.research),
        risks: parsed.risks ?? defaultRisks(input.research)
      };
    }

    const executed = await executeRequired(
      () => input.executors.runManagerFallback({
        mode: input.previousRequirement ? "revise_plan" : "requirement_resolution",
        runContext,
        taskInput
      }),
      "Manager plan fallback"
    );
    const parsed = parsePreflightOutput(executed.result);
    assertNoHardBlocker(parsed, "manager_fallback", executed.artifactIds);
    if (!parsed.text) {
      throw new RoundPreflightBlockedError("Manager plan fallback returned no usable plan output.", "manager_fallback", executed.artifactIds);
    }
    return {
      source: input.previousRequirement ? "revised_from_reply" : "manager_fallback",
      body: parsed.text,
      assumptions: parsed.assumptions ?? defaultAssumptions(input.research),
      risks: parsed.risks ?? defaultRisks(input.research)
    };
  }

  private async judgePlanNeedsMoreResearch(input: {
    blueprint: BlueprintDefinition;
    run: BlueprintRun;
    round: IterationRound;
    topManagerNode: BlueprintNode;
    humanFeedback?: string;
    executors: RoundPreflightExecutors;
    context: RoundStartContext;
    research: ResearchResolution;
    plan: RequirementResolution;
    preparationAttempt: number;
    maxPreparationAttempts: number;
  }): Promise<{ needsMoreResearch: boolean; reason?: string; researchBrief?: string }> {
    const managerConfig = input.topManagerNode.config as ManagerNodeConfig;
    const runContext = this.managerContextService.buildManagerInjectedContext(input.context, {
      mode: "preflight_judgment",
      roundStatus: input.round.status,
      research: {
        status: input.research.status,
        summary: input.research.summary,
        source: input.research.source
      },
      assumptions: input.plan.assumptions,
      risks: input.plan.risks
    });
    const executed = await executeRequired(
      () => input.executors.runManagerFallback({
        mode: "preflight_judgment",
        runContext,
        taskInput: {
          runId: input.run.id,
          blueprintName: input.blueprint.name,
          manager: input.topManagerNode.config.label,
          instructions: managerConfig.instructions,
          roundNumber: input.round.roundNumber,
          preparationAttempt: input.preparationAttempt,
          maxPreparationAttempts: input.maxPreparationAttempts,
          humanFeedback: input.humanFeedback,
          researchSummary: input.research.summary,
          draftPlan: input.plan.body,
          instruction: "Judge semantically whether this draft plan can proceed or needs another research pass. Put needsMoreResearch, reason, optional researchBrief, and optional hardBlocker inside result.",
          runContext
        }
      }),
      "Manager preflight judgment"
    );
    const parsed = parsePreflightOutput(executed.result);
    assertNoHardBlocker(parsed, "manager_preflight_judgment", executed.artifactIds);
    return {
      needsMoreResearch: parsed.needsMoreResearch === true,
      reason: parsed.reason ?? parsed.text,
      researchBrief: parsed.researchBrief
    };
  }

  private resolvePreflightSlotAgent(
    blueprint: BlueprintDefinition,
    managerNode: BlueprintNode,
    slot: number
  ): BlueprintNode & { type: "agent"; config: AgentNodeConfig } | undefined {
    const target = this.resolveManagerSlotTarget(blueprint, managerNode, slot);
    if (!target || target.disabled) return undefined;
    if (isAgentBlueprintNode(target)) return target;
    if (target.type !== "manager_slot") return undefined;

    const childAgents = blueprint.nodes.filter(
      (node): node is BlueprintNode & { type: "agent"; config: AgentNodeConfig } =>
        node.parentId === target.id && !node.disabled && isAgentBlueprintNode(node)
    );
    if (childAgents.length === 0) return undefined;

    const entryEdge = blueprint.edges.find(
      (edge) => edge.source === target.id && isManagerSlotInnerOutHandle(edge.sourceHandle)
    );
    return childAgents.find((node) => node.id === entryEdge?.target) ?? childAgents[0];
  }

  private resolveManagerSlotTarget(
    blueprint: BlueprintDefinition,
    managerNode: BlueprintNode,
    slot: number
  ): BlueprintNode | undefined {
    const edge = blueprint.edges.find(
      (candidate) => candidate.source === managerNode.id && candidate.sourceHandle === `manager-out-${slot}`
    );
    return edge ? blueprint.nodes.find((node) => node.id === edge.target) : undefined;
  }

  private blockedResult(
    input: {
      round: IterationRound;
      revision?: number;
    },
    context: RoundStartContext,
    blocker: RoundPreflightBlockedError
  ): RoundPreflightResult {
    const research: ResearchResolution = {
      status: "blocked",
      summary: blocker.message,
      artifactIds: blocker.artifactIds,
      source: blocker.source
    };
    const risks = [`Blocked before execution: ${blocker.message}`];
    const runContext = this.managerContextService.buildManagerInjectedContext(context, {
      mode: input.revision && input.revision > 1 ? "revise_plan" : "requirement_resolution",
      roundStatus: input.round.status,
      research: {
        status: research.status,
        summary: research.summary,
        source: research.source
      },
      risks
    });
    return {
      body: formatBlockedRoundPlan({
        roundNumber: input.round.roundNumber,
        revision: input.revision ?? 1,
        blocker,
        context
      }),
      researchStatus: "blocked",
      researchSummary: blocker.message,
      researchArtifactIds: blocker.artifactIds,
      planSource: "manager_fallback",
      assumptions: [],
      risks,
      runContext
    };
  }
}

function formatRoundExecutionPlan(input: {
  roundNumber: number;
  revision: number;
  planText: string;
  research: { status: string; summary: string; source: string; artifactIds: string[] };
  planSource: string;
  context: RoundStartContext;
  assumptions: string[];
  risks: string[];
}): string {
  const zh = usesChineseText([
    input.planText,
    input.research.summary,
    input.context.previousReleaseReport?.summary,
    input.context.humanFeedback,
    ...input.assumptions,
    ...input.risks
  ].filter((value): value is string => Boolean(value)).join("\n"));
  if (zh) {
    const assumptions = input.assumptions.length ? input.assumptions.map((item) => `- ${item}`).join("\n") : "- 未记录。";
    const risks = input.risks.length ? input.risks.map((item) => `- ${item}`).join("\n") : "- 未记录。";
    return [
      `# 第 ${input.roundNumber} 轮执行计划${input.revision > 1 ? ` v${input.revision}` : ""}`,
      "",
      "前期准备工作已完成。请确认本轮执行计划；确认后会开始后续 Agent 工作。如需调整，请直接回复修改意见。",
      "",
      `调研来源：${input.research.status}（${input.research.source}）`,
      `计划来源：${input.planSource}`,
      input.context.previousReleaseReport ? `上一轮报告：${firstLine(input.context.previousReleaseReport.summary)}` : undefined,
      input.context.humanFeedback ? `用户反馈：${input.context.humanFeedback}` : undefined,
      "",
      "## 调研摘要",
      input.research.summary,
      "",
      "## 执行计划",
      input.planText,
      "",
      "## 假设",
      assumptions,
      "",
      "## 风险",
      risks,
      "",
      "## 确认后会发生什么",
      "- 用户确认后，本轮会进入执行阶段。",
      "- Manager 只会调度本轮计划中的工作槽位。",
      "- 产物与本轮报告会在执行后继续交给用户验收。"
    ].filter((part) => part !== undefined).join("\n");
  }
  const assumptions = input.assumptions.length ? input.assumptions.map((item) => `- ${item}`).join("\n") : "- None recorded.";
  const risks = input.risks.length ? input.risks.map((item) => `- ${item}`).join("\n") : "- None recorded.";
  return [
    `# Round ${input.roundNumber} Execution Plan v${input.revision}`,
    `Research source: ${input.research.status} (${input.research.source})`,
    `Plan source: ${input.planSource}`,
    input.context.previousReleaseReport ? `Previous report: ${firstLine(input.context.previousReleaseReport.summary)}` : undefined,
    input.context.humanFeedback ? `Human feedback: ${input.context.humanFeedback}` : undefined,
    "",
    "## Research Summary",
    input.research.summary,
    "",
    "## Plan",
    input.planText,
    "",
    "## Assumptions",
    assumptions,
    "",
    "## Risks",
    risks,
    "",
    "## Acceptance",
    "- Human approval starts execution for this round.",
    "- Manager dispatch runs only the configured work slots for this round.",
    "- Published artifacts and the release report will be reviewed before continuing."
  ].filter((part) => part !== undefined).join("\n");
}

function formatBlockedRoundPlan(input: {
  roundNumber: number;
  revision: number;
  blocker: RoundPreflightBlockedError;
  context: RoundStartContext;
}): string {
  const zh = usesChineseText([
    input.blocker.humanReportMd,
    input.blocker.message,
    input.context.humanFeedback
  ].filter((value): value is string => Boolean(value)).join("\n"));
  if (zh) {
    return [
      `# 第 ${input.roundNumber} 轮预检受阻${input.revision > 1 ? ` v${input.revision}` : ""}`,
      "调研来源：blocked",
      "计划来源：blocked",
      input.context.humanFeedback ? `用户反馈：${input.context.humanFeedback}` : undefined,
      "",
      "## 阻塞原因",
      input.blocker.humanReportMd ?? input.blocker.message,
      "",
      "## 需要用户处理",
      "- 请回复缺失的凭据、权限、事实或修订指令。",
      "- 在修订计划生成前，本审批不能直接批准进入执行。"
    ].filter((part) => part !== undefined).join("\n");
  }
  return [
    `# Round ${input.roundNumber} Preflight Blocked v${input.revision}`,
    "Research source: blocked",
    "Plan source: blocked",
    input.context.humanFeedback ? `Human feedback: ${input.context.humanFeedback}` : undefined,
    "",
    "## Blocker",
    input.blocker.humanReportMd ?? input.blocker.message,
    "",
    "## Required Action",
    "- Reply with missing credentials, permissions, facts, or revised instructions.",
    "- This approval cannot be approved into execution until a revised plan is generated."
  ].filter((part) => part !== undefined).join("\n");
}

async function executeRequired(
  operation: () => Promise<RoundPreflightExecutionResult>,
  label: string
): Promise<RoundPreflightExecutionResult> {
  try {
    const executed = await operation();
    if (executed.result.status !== "succeeded") {
      throw new RoundPreflightBlockedError(`${label} failed with status ${executed.result.status}${executed.result.error ? `: ${executed.result.error}` : "."}`, label, executed.artifactIds);
    }
    return executed;
  } catch (error) {
    if (error instanceof RoundPreflightBlockedError) throw error;
    throw new RoundPreflightBlockedError(`${label} failed: ${error instanceof Error ? error.message : String(error)}.`, label);
  }
}

function assertNoHardBlocker(parsed: ParsedPreflightOutput, source: string, artifactIds: string[]): void {
  if (parsed.hardBlocker) {
    throw new RoundPreflightBlockedError(
      parsed.reason ?? parsed.humanReportMd ?? parsed.text ?? "Manager reported a hard blocker.",
      source,
      artifactIds,
      parsed.humanReportMd
    );
  }
}

function toBlockedError(error: unknown): RoundPreflightBlockedError {
  if (error instanceof RoundPreflightBlockedError) return error;
  return new RoundPreflightBlockedError(error instanceof Error ? error.message : String(error));
}

function parsePreflightOutput(result: AgentTaskResult): ParsedPreflightOutput {
  const raw = result.output;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    const parsed = parseJsonObject(trimmed);
    if (parsed) return parsePreflightObject(parsed, trimmed);
    return {
      text: trimmed || undefined,
      needsMoreResearch: parseNeedsMoreResearchText(trimmed)
    };
  }
  if (isRecord(raw)) return parsePreflightObject(raw, JSON.stringify(raw, null, 2));
  if (raw === undefined || raw === null) return {};
  return { text: JSON.stringify(raw, null, 2) };
}

function parsePreflightObject(value: Record<string, unknown>, fallbackText: string): ParsedPreflightOutput {
  const result = isRecord(value.result) ? value.result : undefined;
  const record = result ? { ...value, ...result } : value;
  const humanReportMd = readString(value.humanReportMd) ?? readString(record.humanReportMd);
  const text = readString(record.body) ??
    humanReportMd ??
    readString(record.markdown) ??
    readString(record.summary) ??
    readString(record.plan) ??
    readString(record.text) ??
    readString(record.content) ??
    readString(value.result) ??
    fallbackText;
  const hardBlocker = readBoolean(record.hardBlocker) ?? readBoolean(record.blocked);
  return {
    text: text.trim() || undefined,
    hardBlocker,
    humanReportMd,
    needsMoreResearch: readBoolean(record.needsMoreResearch) ?? readBoolean(record.requiresMoreResearch),
    reason: readString(record.reason) ?? readString(record.blockerReason),
    researchBrief: readString(record.researchBrief),
    assumptions: readStringList(record.assumptions),
    risks: readStringList(record.risks),
    assumptionBased: readBoolean(record.assumptionBased) ?? record.status === "assumption_based"
  };
}

function parseJsonObject(value: string): Record<string, unknown> | undefined {
  if (!value.startsWith("{")) return undefined;
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function parseNeedsMoreResearchText(value: string): boolean | undefined {
  const normalized = value.trim().toLowerCase();
  if (normalized === "yes" || normalized === "true") return true;
  if (normalized === "no" || normalized === "false") return false;
  return undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function readStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const normalized = value.map((item) => typeof item === "string" ? item.trim() : undefined).filter((item): item is string => Boolean(item));
  return normalized.length ? normalized : undefined;
}

function defaultAssumptions(research: { status: string }): string[] {
  return research.status === "assumption_based" ? ["Research could not be fully verified; manager fallback assumptions are in effect."] : [];
}

function defaultRisks(research: { status: string }): string[] {
  return research.status === "blocked" || research.status === "assumption_based"
    ? ["Round quality depends on the stated assumptions because research was incomplete."]
    : [];
}

function normalizePreparationAttempts(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 3;
  return Math.max(1, Math.min(10, Math.round(value)));
}

function firstLine(value: string): string {
  return value.split(/\r?\n/).find((line) => line.trim())?.trim() ?? value.trim();
}

function usesChineseText(value: string | undefined): boolean {
  return /[\u3400-\u9fff]/.test(value ?? "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
