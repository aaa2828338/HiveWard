import type { BlueprintRunView, RunRoomFeedRow } from "@hiveward/shared";
import type { Language } from "./i18n";

export const runRoomFeedHistoricalFactOnlyMarker = "保留为历史事实，不参与决策";

export function buildRunRoomFeedRowsForDisplay(
  runView: BlueprintRunView | undefined,
  language: Language = "en"
): RunRoomFeedRow[] {
  if (!runView) return [];
  const rows = runView.runRoomFeed?.rows ?? [];
  if (rows.length > 0) return sortRunRoomFeedRows(rows).map(normalizeRunRoomFeedRowForDisplay);
  return [createMissingRunRoomFeedSystemRow(runView, language)];
}

export function canOpenRunRoomFeedWorkerDetails(row: RunRoomFeedRow): boolean {
  return row.sourceType === "worker" && row.displayMode === "execution_output";
}

export function formatRunRoomFeedRuntimeState(row: RunRoomFeedRow, language: Language = "en"): string | undefined {
  const state = row.runtimeState;
  if (!state) return undefined;
  const phase = readRuntimeStateText(state.phase);
  const status = readRuntimeStateText(state.status);
  const label = readRuntimeStateText(state.label);
  const message = readRuntimeStateText(state.message);
  const parts = [phase, status, label, message].filter((part): part is string => Boolean(part));
  if (parts.length === 0) return undefined;
  return language === "zh-CN" ? `运行状态: ${parts.join(" / ")}` : `Runtime state: ${parts.join(" / ")}`;
}

function sortRunRoomFeedRows(rows: RunRoomFeedRow[]): RunRoomFeedRow[] {
  return [...rows].sort((left, right) =>
    toSortableTimestamp(left.createdAt) - toSortableTimestamp(right.createdAt) || left.id.localeCompare(right.id)
  );
}

function normalizeRunRoomFeedRowForDisplay(row: RunRoomFeedRow): RunRoomFeedRow {
  if (row.sourceType === "worker" || row.displayMode === "execution_output") {
    return {
      ...row,
      displayMode: "execution_output",
      actions: undefined
    };
  }
  return row;
}

function createMissingRunRoomFeedSystemRow(runView: BlueprintRunView, language: Language): RunRoomFeedRow {
  const zh = language === "zh-CN";
  return {
    id: `run-room-feed-missing:${runView.run.id}`,
    runRoomId: `historical-run:${runView.run.id}`,
    sourceType: "system",
    displayMode: "formal_message",
    bodyMarkdown: [
      zh ? "RunRoomFeed 尚未为本次运行记录。" : "RunRoomFeed has not been recorded for this run.",
      "",
      zh
        ? `旧运行记录${runRoomFeedHistoricalFactOnlyMarker}，不会投影成正常 RunRoomFeed 消息。`
        : `Older run records are ${runRoomFeedHistoricalFactOnlyMarker} and are not projected as normal RunRoomFeed messages.`
    ].join("\n"),
    createdAt: runView.run.startedAt
  };
}

function readRuntimeStateText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function toSortableTimestamp(value: string): number {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}
