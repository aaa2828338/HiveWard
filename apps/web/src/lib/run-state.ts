import type {
  BlueprintNodeRunStatus,
  BlueprintRunStatus,
  BlueprintRunSummary,
  BlueprintRunView,
  PendingApprovalItem
} from "@hiveward/shared";

export type RunPollingView = "blueprint" | "runs";
export type BlueprintActivityState = "idle" | "running" | "succeeded" | "failed";

export const acknowledgedTerminalRunIdsStorageKey = "hiveward-acknowledged-terminal-run-ids";

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
  if (view === "runs" && selectedRun && isActiveRunView(selectedRun)) {
    return selectedRun.run.id;
  }

  return runs.find((runView) => {
    return runView.run.blueprintId === selectedBlueprintId && isActiveRunView(runView);
  })?.run.id;
}

export function isPollingRunStatus(status: BlueprintRunStatus): boolean {
  return status === "queued" || status === "running" || status === "waiting_approval";
}

export function isActiveRunView(runView?: BlueprintRunView): boolean {
  return Boolean(runView && (isPollingRunStatus(runView.run.status) || hasActiveNodeRun(runView)));
}

export function resolveRunViewStatus(runView?: BlueprintRunView): BlueprintRunStatus | undefined {
  if (!runView) return undefined;
  return isActiveRunView(runView) ? "running" : runView.run.status;
}

function hasActiveNodeRun(runView: BlueprintRunView): boolean {
  return runView.nodeRuns.some((nodeRun) => isActiveNodeRunStatus(nodeRun.status));
}

function isActiveNodeRunStatus(status?: BlueprintNodeRunStatus): boolean {
  return status === "queued" || status === "running" || status === "waiting_approval";
}

export function resolveBlueprintActivityState(status?: BlueprintRunStatus, terminalStatusSeen = false): BlueprintActivityState {
  if (status === "queued" || status === "running" || status === "waiting_approval") return "running";
  if (terminalStatusSeen) return "idle";
  if (status === "succeeded") return "succeeded";
  if (status === "failed" || status === "cancelled") return "failed";
  return "idle";
}

export function isTerminalBlueprintRunStatus(status?: BlueprintRunStatus): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}

export function shouldShowBlueprintWorkspaceRunState(status?: BlueprintRunStatus, terminalStatusSeen = false): boolean {
  if (status === "queued" || status === "running" || status === "waiting_approval") return true;
  if (isTerminalBlueprintRunStatus(status)) return !terminalStatusSeen;
  return false;
}

export function readAcknowledgedTerminalRunIds(storage?: Pick<Storage, "getItem">): Set<string> {
  if (!storage) return new Set();

  try {
    const rawValue = storage.getItem(acknowledgedTerminalRunIdsStorageKey);
    const parsedValue = rawValue ? JSON.parse(rawValue) as unknown : [];
    if (!Array.isArray(parsedValue)) return new Set();
    return new Set(parsedValue.filter((item): item is string => typeof item === "string" && item.length > 0));
  } catch {
    return new Set();
  }
}

export function writeAcknowledgedTerminalRunIds(
  storage: Pick<Storage, "setItem"> | undefined,
  runIds: Iterable<string>
): void {
  if (!storage) return;

  try {
    storage.setItem(acknowledgedTerminalRunIdsStorageKey, JSON.stringify([...runIds].sort()));
  } catch {
    // Best-effort UI memory only; blocked storage should not break the blueprint page.
  }
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
      const upstream = readPendingApprovalUpstream(nodeRun.input);
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
        instructions: readOptionalString(output?.instructions),
        ...(upstream ? { upstream } : {})
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

function readPendingApprovalUpstream(input: unknown): PendingApprovalItem["upstream"] {
  if (!isRecord(input) || !Array.isArray(input.upstream)) return undefined;

  const upstream = input.upstream.flatMap((candidate) => {
    if (!isRecord(candidate)) return [];
    const nodeId = readOptionalString(candidate.nodeId);
    const nodeLabel = readOptionalString(candidate.nodeLabel);
    const nodeRunId = readOptionalString(candidate.nodeRunId);
    if (!nodeId || !nodeLabel || !nodeRunId) return [];
    return [
      {
        nodeId,
        nodeLabel,
        nodeRunId,
        output: candidate.output
      }
    ];
  });

  return upstream.length ? upstream : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
