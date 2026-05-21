import type { BlueprintRunStatus, BlueprintRunSummary, BlueprintRunView, PendingApprovalItem } from "@hiveward/shared";

export type RunPollingView = "blueprint" | "runs";

export function selectRunPollingTarget({
  runs,
  selectedBlueprintId,
  selectedRunId,
  view
}: {
  runs: BlueprintRunView[];
  selectedBlueprintId?: string;
  selectedRunId?: string;
  view: RunPollingView;
}): string | undefined {
  const selectedRun = selectedRunId ? runs.find((runView) => runView.run.id === selectedRunId) : undefined;
  if (view === "runs" && selectedRun && isPollingRunStatus(selectedRun.run.status)) {
    return selectedRun.run.id;
  }

  return runs.find((runView) => {
    return runView.run.blueprintId === selectedBlueprintId && isPollingRunStatus(runView.run.status);
  })?.run.id;
}

export function isPollingRunStatus(status: BlueprintRunStatus): boolean {
  return status === "queued" || status === "running";
}

export function syncRunDetails(
  current: Record<string, BlueprintRunView>,
  summaries: BlueprintRunSummary[],
  selectedRunView: BlueprintRunView | undefined
): Record<string, BlueprintRunView> {
  const summaryIds = new Set(summaries.map((summary) => summary.id));
  const next = Object.fromEntries(Object.entries(current).filter(([runId]) => summaryIds.has(runId)));
  if (selectedRunView) {
    next[selectedRunView.run.id] = selectedRunView;
  }
  return next;
}

export function upsertRunSummary(summaries: BlueprintRunSummary[], summary: BlueprintRunSummary): BlueprintRunSummary[] {
  const next = [summary, ...summaries.filter((candidate) => candidate.id !== summary.id)];
  return sortRunSummaries(next);
}

export function syncApprovalsForRun(
  current: PendingApprovalItem[],
  runView: BlueprintRunView
): PendingApprovalItem[] {
  const pendingForRun = runView.nodeRuns
    .filter((nodeRun) => nodeRun.status === "waiting_approval")
    .map((nodeRun): PendingApprovalItem => {
      const output = isRecord(nodeRun.output) ? nodeRun.output : undefined;
      return {
        blueprintId: runView.run.blueprintId,
        blueprintName: runView.run.blueprintName,
        blueprintRunId: runView.run.id,
        nodeRunId: nodeRun.id,
        nodeId: nodeRun.nodeId,
        nodeLabel: nodeRun.nodeLabel,
        startedBy: runView.run.startedBy,
        startedAt: runView.run.startedAt,
        requestedAt: nodeRun.startedAt ?? nodeRun.queuedAt,
        approverHint: readOptionalString(output?.approverHint),
        instructions: readOptionalString(output?.instructions)
      };
    });

  return [...pendingForRun, ...current.filter((approval) => approval.blueprintRunId !== runView.run.id)]
    .sort((left, right) => new Date(right.requestedAt).getTime() - new Date(left.requestedAt).getTime());
}

function sortRunSummaries(summaries: BlueprintRunSummary[]): BlueprintRunSummary[] {
  return summaries.slice().sort((left, right) => new Date(right.startedAt).getTime() - new Date(left.startedAt).getTime());
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
