import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { OpenClawModelUsageDay, OpenClawModelUsageSummary } from "@openclaw-cui/shared";

type JsonObject = Record<string, unknown>;

type ModelUsageAccumulator = Omit<OpenClawModelUsageSummary, "days"> & {
  days: Map<string, OpenClawModelUsageDay>;
};

export async function listOpenClawModelUsage(): Promise<OpenClawModelUsageSummary[]> {
  const usageByModel = new Map<string, ModelUsageAccumulator>();
  const seenSessions = new Set<string>();

  for (const cachePath of await findUsageCachePaths()) {
    await mergeUsageCache(cachePath, usageByModel, seenSessions);
  }

  return [...usageByModel.values()]
    .map((summary) => ({
      ...summary,
      days: [...summary.days.values()].sort((left, right) => left.date.localeCompare(right.date))
    }))
    .sort((left, right) => left.modelId.localeCompare(right.modelId));
}

async function findUsageCachePaths(): Promise<string[]> {
  const agentsDir = path.join(resolveStateDir(), "agents");
  try {
    const entries = await readdir(agentsDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(agentsDir, entry.name, "sessions", ".usage-cost-cache.json"));
  } catch {
    return [];
  }
}

async function mergeUsageCache(
  cachePath: string,
  usageByModel: Map<string, ModelUsageAccumulator>,
  seenSessions: Set<string>
): Promise<void> {
  let cache: unknown;
  try {
    cache = JSON.parse(await readFile(cachePath, "utf8"));
  } catch {
    return;
  }

  const files = readRecord(readObject(cache)?.files);
  if (!files) return;

  for (const [sessionPath, rawSession] of Object.entries(files)) {
    const sessionKey = path.normalize(sessionPath).toLowerCase();
    if (seenSessions.has(sessionKey)) continue;
    seenSessions.add(sessionKey);

    const session = readObject(rawSession);
    const dailyModelUsage = readArray(readObject(session?.sessionSummary)?.dailyModelUsage);
    if (dailyModelUsage?.length) {
      for (const rawDay of dailyModelUsage) {
        const day = readObject(rawDay);
        const date = toDateKey(day?.date);
        const modelId = readUsageModelId(day);
        if (!date || !modelId) continue;

        const totalTokens =
          readNumber(day?.tokens) ??
          readNumber(day?.totalTokens) ??
          sumNumbers(day?.input, day?.output, day?.cacheRead, day?.cacheWrite) ??
          0;

        addModelUsageDay(usageByModel, {
          date,
          modelId,
          inputTokens: readNumber(day?.inputTokens) ?? readNumber(day?.input) ?? 0,
          outputTokens: readNumber(day?.outputTokens) ?? readNumber(day?.output) ?? 0,
          cacheReadTokens: readNumber(day?.cacheReadTokens) ?? readNumber(day?.cacheRead) ?? 0,
          cacheWriteTokens: readNumber(day?.cacheWriteTokens) ?? readNumber(day?.cacheWrite) ?? 0,
          totalTokens,
          costUsd: readNumber(day?.costUsd) ?? readNumber(day?.cost) ?? readNumber(day?.totalCost) ?? 0,
          calls: readNumber(day?.calls) ?? readNumber(day?.count) ?? (totalTokens > 0 ? 1 : 0)
        });
      }
      continue;
    }

    const usageEntries = readArray(session?.usageEntries);
    if (!usageEntries?.length) continue;

    for (const rawEntry of usageEntries) {
      const entry = readObject(rawEntry);
      const date = toDateKey(entry?.recordedAt ?? entry?.timestamp ?? entry?.time);
      const modelId = readUsageModelId(entry);
      if (!date || !modelId) continue;

      const inputTokens = readNumber(entry?.inputTokens) ?? readNumber(entry?.input) ?? readNumber(entry?.prompt_tokens) ?? 0;
      const outputTokens =
        readNumber(entry?.outputTokens) ?? readNumber(entry?.output) ?? readNumber(entry?.completion_tokens) ?? 0;
      const cacheReadTokens = readNumber(entry?.cacheReadTokens) ?? readNumber(entry?.cacheRead) ?? 0;
      const cacheWriteTokens = readNumber(entry?.cacheWriteTokens) ?? readNumber(entry?.cacheWrite) ?? 0;
      const totalTokens =
        readNumber(entry?.totalTokens) ??
        readNumber(entry?.total_tokens) ??
        inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens;

      addModelUsageDay(usageByModel, {
        date,
        modelId,
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheWriteTokens,
        totalTokens,
        costUsd: readNumber(entry?.costUsd) ?? readNumber(entry?.totalCost) ?? readNumber(entry?.cost) ?? 0,
        calls: 1
      });
    }
  }
}

function addModelUsageDay(usageByModel: Map<string, ModelUsageAccumulator>, day: OpenClawModelUsageDay): void {
  const summary =
    usageByModel.get(day.modelId) ?? {
      modelId: day.modelId,
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 0,
      costUsd: 0,
      days: new Map<string, OpenClawModelUsageDay>()
    };

  summary.calls += day.calls;
  summary.inputTokens += day.inputTokens;
  summary.outputTokens += day.outputTokens;
  summary.cacheReadTokens += day.cacheReadTokens;
  summary.cacheWriteTokens += day.cacheWriteTokens;
  summary.totalTokens += day.totalTokens;
  summary.costUsd += day.costUsd;

  const currentDay =
    summary.days.get(day.date) ?? {
      date: day.date,
      modelId: day.modelId,
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 0,
      costUsd: 0
    };
  currentDay.calls += day.calls;
  currentDay.inputTokens += day.inputTokens;
  currentDay.outputTokens += day.outputTokens;
  currentDay.cacheReadTokens += day.cacheReadTokens;
  currentDay.cacheWriteTokens += day.cacheWriteTokens;
  currentDay.totalTokens += day.totalTokens;
  currentDay.costUsd += day.costUsd;
  summary.days.set(day.date, currentDay);

  usageByModel.set(day.modelId, summary);
}

function readUsageModelId(value: JsonObject | undefined): string | undefined {
  if (!value) return undefined;
  const explicit = readString(value.modelId) ?? readString(value.model_id);
  if (explicit) return explicit;

  const provider = readString(value.provider);
  const model = readString(value.model) ?? readString(value.name);
  if (provider && model) return `${provider}/${model}`;
  return model;
}

function toDateKey(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) return formatLocalDate(parsed);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const timestamp = value < 1_000_000_000_000 ? value * 1000 : value;
    return formatLocalDate(new Date(timestamp));
  }
  return undefined;
}

function formatLocalDate(value: Date): string {
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, "0");
  const day = `${value.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function resolveStateDir(): string {
  const explicit = process.env.OPENCLAW_STATE_DIR?.trim();
  if (explicit) return path.resolve(expandHome(explicit));
  return path.join(homedir(), ".openclaw");
}

function expandHome(value: string): string {
  if (value === "~") return homedir();
  if (value.startsWith("~/") || value.startsWith("~\\")) return path.join(homedir(), value.slice(2));
  return value;
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return readObject(value);
}

function readObject(value: unknown): JsonObject | undefined {
  return Boolean(value && typeof value === "object" && !Array.isArray(value)) ? (value as JsonObject) : undefined;
}

function readArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function sumNumbers(...values: unknown[]): number | undefined {
  let total = 0;
  for (const value of values) {
    total += readNumber(value) ?? 0;
  }
  return total > 0 ? total : undefined;
}
