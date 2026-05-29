import type { AgentHandoff, AgentHumanReport, BlueprintNodeRun } from "@hiveward/shared";
import type { HivewardStore } from "../store/hivewardStore";

export interface ExtractedHumanReport {
  bodyMd: string;
  source: AgentHumanReport["source"];
  fallbackReason?: string;
}

export class AgentReportService {
  constructor(private readonly store: HivewardStore) {}

  extractHumanReport(output: unknown): ExtractedHumanReport | undefined {
    const record = readOutputRecord(output);
    const explicitReport = readString(record?.humanReportMd);
    if (explicitReport) {
      return {
        bodyMd: explicitReport,
        source: "agent"
      };
    }

    const fallback =
      readString(record?.summary) ??
      readString(record?.body) ??
      readString(record?.markdown) ??
      readString(record?.reason) ??
      readString(record?.message) ??
      readString(record?.result) ??
      readStatusFallback(record) ??
      formatFallbackValue(record?.result) ??
      (typeof output === "string" ? output.trim() : undefined) ??
      formatFallbackValue(output);
    if (!fallback?.trim()) return undefined;

    return {
      bodyMd: fallback.trim(),
      source: "fallback",
      fallbackReason: "Agent output did not include humanReportMd."
    };
  }

  extractHandoffJson(output: unknown): unknown | undefined {
    const record = readOutputRecord(output);
    if (!record) return undefined;
    if (Object.prototype.hasOwnProperty.call(record, "handoffJson")) {
      return record.handoffJson;
    }
    if (typeof output === "string") return record;
    return undefined;
  }

  async publishFromNodeRun(input: {
    runId: string;
    roundId?: string;
    nodeRun: BlueprintNodeRun;
  }): Promise<{ humanReport?: AgentHumanReport; handoff?: AgentHandoff }> {
    return this.publishFromOutput({
      runId: input.runId,
      roundId: input.roundId ?? input.nodeRun.iterationRoundId,
      nodeRunId: input.nodeRun.id,
      nodeId: input.nodeRun.nodeId,
      nodeLabel: input.nodeRun.nodeLabel,
      output: input.nodeRun.output
    });
  }

  async publishFromOutput(input: {
    runId: string;
    roundId?: string;
    nodeRunId: string;
    nodeId: string;
    nodeLabel: string;
    output: unknown;
  }): Promise<{ humanReport?: AgentHumanReport; handoff?: AgentHandoff }> {
    const prepared = this.prepareFromOutput(input);
    const result: { humanReport?: AgentHumanReport; handoff?: AgentHandoff } = {};
    if (prepared.humanReport) result.humanReport = await this.store.upsertAgentHumanReport(prepared.humanReport);
    if (prepared.handoff) result.handoff = await this.store.upsertAgentHandoff(prepared.handoff);
    return result;
  }

  prepareFromOutput(input: {
    runId: string;
    roundId?: string;
    nodeRunId: string;
    nodeId: string;
    nodeLabel: string;
    output: unknown;
    createdAt?: string;
  }): { humanReport?: AgentHumanReport; handoff?: AgentHandoff } {
    const createdAt = input.createdAt ?? new Date().toISOString();
    const extractedReport = this.extractHumanReport(input.output);
    const handoffJson = this.extractHandoffJson(input.output);
    const result: { humanReport?: AgentHumanReport; handoff?: AgentHandoff } = {};

    if (extractedReport) {
      const humanReport: AgentHumanReport = {
        id: `agent-human-report-${input.nodeRunId}`,
        runId: input.runId,
        roundId: input.roundId,
        nodeRunId: input.nodeRunId,
        nodeId: input.nodeId,
        nodeLabel: input.nodeLabel,
        title: `${input.nodeLabel} report`,
        bodyMd: extractedReport.bodyMd,
        source: extractedReport.source,
        fallbackReason: extractedReport.fallbackReason,
        createdAt
      };
      result.humanReport = humanReport;
    }

    if (handoffJson !== undefined) {
      const handoff: AgentHandoff = {
        id: `agent-handoff-${input.nodeRunId}`,
        runId: input.runId,
        roundId: input.roundId,
        nodeRunId: input.nodeRunId,
        nodeId: input.nodeId,
        payload: handoffJson,
        createdAt
      };
      result.handoff = handoff;
    }

    return result;
  }
}

function readOutputRecord(output: unknown): Record<string, unknown> | undefined {
  if (isRecord(output)) return output;
  if (typeof output !== "string") return undefined;

  const trimmed = output.trim();
  if (!trimmed.startsWith("{")) return undefined;
  try {
    const parsed = JSON.parse(trimmed);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function formatFallbackValue(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return readString(value);
  try {
    const serialized = JSON.stringify(value, null, 2);
    return serialized && serialized !== "{}" ? serialized : undefined;
  } catch {
    return String(value);
  }
}

function readStatusFallback(record: Record<string, unknown> | undefined): string | undefined {
  const status = readString(record?.status);
  if (!status) return undefined;
  return `Status: ${status}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
