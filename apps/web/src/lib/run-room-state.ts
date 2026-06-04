import type { BlueprintRunView, RunRoomFeedRow } from "@hiveward/shared";
import type { Language } from "./i18n";

export function buildRunRoomFeedRowsForDisplay(runView: BlueprintRunView | undefined): RunRoomFeedRow[] {
  if (!runView) return [];
  const rows = runView.runRoomFeed?.rows ?? [];
  return sortRunRoomFeedRows(rows).map(normalizeRunRoomFeedRowForDisplay);
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

function readRuntimeStateText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function toSortableTimestamp(value: string): number {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}
