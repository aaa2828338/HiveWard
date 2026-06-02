import type {
  BlueprintNodeRun,
  BlueprintNodeRunStatus,
  BlueprintRunStatus,
  BlueprintRunSummary,
  BlueprintRunView,
  ApprovalReply,
  ApprovalRequest,
  PendingApprovalItem
} from "@hiveward/shared";

export type RunPollingView = "blueprint" | "runs";
export type BlueprintActivityState = "idle" | "running" | "succeeded" | "failed";
export type RunTranscriptEvent = NonNullable<BlueprintRunView["nodeSessionTranscriptEvents"]>[number];

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

export function resolveRunViewDisplayStatus(runView?: BlueprintRunView): BlueprintRunStatus | undefined {
  if (!runView) return undefined;
  if (hasFailedNodeRun(runView)) return "failed";
  return isActiveRunView(runView) ? "running" : runView.run.status;
}

export function sortedRunTranscriptEventsForDisplay(runView: BlueprintRunView): RunTranscriptEvent[] {
  const sessionOrder = buildTranscriptSessionOrder(runView);
  return [...(runView.nodeSessionTranscriptEvents ?? [])].sort((left, right) => {
    const sessionOrderDelta = (sessionOrder.get(left.sessionId) ?? Number.MAX_SAFE_INTEGER) -
      (sessionOrder.get(right.sessionId) ?? Number.MAX_SAFE_INTEGER);
    if (sessionOrderDelta !== 0) return sessionOrderDelta;
    const sequenceOrder = toSortableSequence(left.sequence) - toSortableSequence(right.sequence);
    if (sequenceOrder !== 0) return sequenceOrder;
    return toSortableTimestamp(left.createdAt) - toSortableTimestamp(right.createdAt);
  });
}

export function hasRunTranscriptEvents(runView: BlueprintRunView): boolean {
  return sortedRunTranscriptEventsForDisplay(runView).length > 0;
}

function hasActiveNodeRun(runView: BlueprintRunView): boolean {
  return runView.nodeRuns.some((nodeRun) => isActiveNodeRunStatus(nodeRun.status));
}

function isActiveNodeRunStatus(status?: BlueprintNodeRunStatus): boolean {
  return status === "queued" || status === "running" || status === "waiting_approval";
}

function toSortableTimestamp(value: string): number {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function toSortableSequence(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
}

function buildTranscriptSessionOrder(runView: BlueprintRunView): Map<string, number> {
  const commands = [...(runView.runCommands ?? [])].sort((left, right) =>
    compareByTimestampThenId(left.createdAt, right.createdAt, left.id, right.id)
  );
  const commandOrderById = new Map(commands.map((command, index) => [command.id, index]));
  const steps = [...(runView.runCommandSteps ?? [])].sort((left, right) => {
    const commandOrder = (commandOrderById.get(left.commandId) ?? Number.MAX_SAFE_INTEGER) -
      (commandOrderById.get(right.commandId) ?? Number.MAX_SAFE_INTEGER);
    if (commandOrder !== 0) return commandOrder;
    const revisionOrder = left.revision - right.revision;
    if (revisionOrder !== 0) return revisionOrder;
    return compareByTimestampThenId(left.createdAt, right.createdAt, left.id, right.id);
  });
  const stepOrderByNodeRunId = new Map<string, number>();
  steps.forEach((step, index) => {
    if (step.nodeRunId && !stepOrderByNodeRunId.has(step.nodeRunId)) {
      stepOrderByNodeRunId.set(step.nodeRunId, index);
    }
  });

  const firstEventBySessionId = new Map<string, RunTranscriptEvent>();
  for (const event of runView.nodeSessionTranscriptEvents ?? []) {
    const current = firstEventBySessionId.get(event.sessionId);
    if (!current || compareTranscriptEvents(event, current) < 0) {
      firstEventBySessionId.set(event.sessionId, event);
    }
  }

  const sessionIds = new Set<string>();
  for (const session of runView.nodeExecutionSessions ?? []) sessionIds.add(session.id);
  for (const event of runView.nodeSessionTranscriptEvents ?? []) sessionIds.add(event.sessionId);

  const sessionsById = new Map((runView.nodeExecutionSessions ?? []).map((session) => [session.id, session]));
  const orderedSessionIds = [...sessionIds].sort((leftId, rightId) => {
    const leftSession = sessionsById.get(leftId);
    const rightSession = sessionsById.get(rightId);
    const leftEvent = firstEventBySessionId.get(leftId);
    const rightEvent = firstEventBySessionId.get(rightId);
    const leftStepOrder = stepOrderByNodeRunId.get(leftSession?.nodeRunId ?? leftEvent?.nodeRunId ?? "") ?? Number.MAX_SAFE_INTEGER;
    const rightStepOrder = stepOrderByNodeRunId.get(rightSession?.nodeRunId ?? rightEvent?.nodeRunId ?? "") ?? Number.MAX_SAFE_INTEGER;
    if (leftStepOrder !== rightStepOrder) return leftStepOrder - rightStepOrder;
    const timestampOrder = toSortableTimestamp(leftSession?.createdAt ?? leftEvent?.createdAt ?? "") -
      toSortableTimestamp(rightSession?.createdAt ?? rightEvent?.createdAt ?? "");
    if (timestampOrder !== 0) return timestampOrder;
    return leftId.localeCompare(rightId);
  });

  return new Map(orderedSessionIds.map((sessionId, index) => [sessionId, index]));
}

function compareTranscriptEvents(left: RunTranscriptEvent, right: RunTranscriptEvent): number {
  const sequenceOrder = toSortableSequence(left.sequence) - toSortableSequence(right.sequence);
  if (sequenceOrder !== 0) return sequenceOrder;
  const timestampOrder = toSortableTimestamp(left.createdAt) - toSortableTimestamp(right.createdAt);
  if (timestampOrder !== 0) return timestampOrder;
  return left.id.localeCompare(right.id);
}

function compareByTimestampThenId(leftDate: string, rightDate: string, leftId: string, rightId: string): number {
  const timestampOrder = toSortableTimestamp(leftDate) - toSortableTimestamp(rightDate);
  if (timestampOrder !== 0) return timestampOrder;
  return leftId.localeCompare(rightId);
}

function hasFailedNodeRun(runView: BlueprintRunView): boolean {
  if (runView.run.status === "succeeded") return false;
  return runView.nodeRuns.some((nodeRun) => nodeRun.status === "failed" || nodeRun.status === "cancelled");
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
  const approvalRequests = runView.approvalRequests ?? [];
  const approvalsForRun = approvalRequests.length > 0
    ? approvalRequests.map((request) => buildApprovalItemFromRequest(runView, request))
    : buildLegacyApprovalItems(current, runView);

  return [...approvalsForRun, ...current.filter((approval) => approval.blueprintRunId !== runView.run.id)]
    .sort((left, right) => new Date(right.requestedAt).getTime() - new Date(left.requestedAt).getTime());
}

function buildLegacyApprovalItems(current: PendingApprovalItem[], runView: BlueprintRunView): PendingApprovalItem[] {
  const previousForRun = new Map(
    current
      .filter((approval) => approval.blueprintRunId === runView.run.id)
      .map((approval) => [approval.nodeRunId, approval])
  );
  return runView.nodeRuns.flatMap((nodeRun) => {
    const approval = buildLegacyApprovalItemFromNodeRun(runView, nodeRun);
    if (approval) return [approval];

    const previous = previousForRun.get(nodeRun.id);
    if (!previous) return [];
    if (nodeRun.status === "succeeded") {
      return [
        {
          ...previous,
          status: "approved" as const,
          decidedAt: nodeRun.endedAt,
          canApprove: false,
          canReply: false,
          canReject: false
        }
      ];
    }
    if (nodeRun.status === "failed" || nodeRun.status === "cancelled") {
      return [
        {
          ...previous,
          status: "rejected" as const,
          decidedAt: nodeRun.endedAt,
          decisionComment: nodeRun.error,
          canApprove: false,
          canReply: false,
          canReject: false
        }
      ];
    }
    return [];
  });
}

function buildApprovalItemFromRequest(
  runView: BlueprintRunView,
  request: ApprovalRequest
): PendingApprovalItem {
  const nodeRun = request.nodeRunId ? runView.nodeRuns.find((candidate) => candidate.id === request.nodeRunId) : undefined;
  const upstream = readPendingApprovalUpstream(nodeRun?.input);
  const replies = mergePendingApprovalReplies(
    readApprovalFactReplies(runView, request),
    readApprovalDecisionReplies(runView, request.id)
  );
  const selectedReplyId = request.selectedReplyId ?? null;
  const discussion = readApprovalRequestDiscussion(runView, request.id);
  const isPending = request.status === "pending";
  return {
    approvalRequestId: request.id,
    approvalThreadId: request.threadId ?? request.id,
    kind: request.kind,
    blueprintId: runView.run.blueprintId,
    blueprintName: runView.run.blueprintName,
    blueprintRunId: runView.run.id,
    nodeRunId: request.nodeRunId ?? request.id,
    nodeId: request.requestedBy.nodeId ?? request.id,
    nodeLabel: request.requestedBy.label,
    startedBy: runView.run.startedBy,
    startedAt: runView.run.startedAt,
    requestedAt: request.requestedAt,
    status: isPending ? nodeRun?.status === "running" ? "replying" : "pending" : request.status,
    reviewOutput: request.body,
    discussion,
    ...(replies ? { replies } : {}),
    selectedReplyId,
    canApprove: request.capabilities.approve,
    canReject: request.capabilities.reject,
    canReply: request.capabilities.reply,
    canComplete: request.capabilities.complete,
    canTerminate: request.capabilities.terminate,
    canReturnForRevision: request.capabilities.returnForRevision === true,
    decidedAt: isPending ? undefined : request.updatedAt,
    ...(upstream ? { upstream } : {})
  };
}

function buildLegacyApprovalItemFromNodeRun(
  runView: BlueprintRunView,
  nodeRun: BlueprintNodeRun
): PendingApprovalItem | undefined {
  const output = isRecord(nodeRun.output) ? nodeRun.output : undefined;
  if (!output || output.approvalType !== "agent") return undefined;
  if (nodeRun.status !== "waiting_approval" && nodeRun.status !== "running") return undefined;

  const upstream = readPendingApprovalUpstream(nodeRun.input);
  const replies = readPendingApprovalReplies(output.replies);
  const isReplying = nodeRun.status === "running";
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
    status: isReplying ? "replying" : "pending",
    ...("reviewOutput" in output ? { reviewOutput: output.reviewOutput } : {}),
    ...(replies ? { replies } : {}),
    discussion: {
      mode: "none",
      canStreamReply: false,
      canCreateCandidate: false,
      reason: "legacy_node_output_read_only"
    },
    canApprove: false,
    canReject: false,
    canReply: false,
    canComplete: false,
    canTerminate: false,
    canReturnForRevision: false,
    ...(upstream ? { upstream } : {})
  };
}

function sortRunSummaries(summaries: BlueprintRunSummary[]): BlueprintRunSummary[] {
  return summaries.slice().sort((left, right) => new Date(right.startedAt).getTime() - new Date(left.startedAt).getTime());
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readPendingApprovalReplies(value: unknown): PendingApprovalItem["replies"] {
  if (!Array.isArray(value)) return undefined;
  const replies = value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const id = readOptionalString(item.id);
    const role: "assistant" | "user" | undefined =
      item.role === "assistant" || item.role === "user" ? item.role : undefined;
    const body = readOptionalString(item.body);
    const createdAt = readOptionalString(item.createdAt);
    if (!id || !role || !body || !createdAt) return [];
    const purpose: "message" | "candidate" = item.purpose === "candidate" ? "candidate" : "message";
    return [{ id, role, purpose, body, createdAt }];
  });
  return replies.length ? replies : undefined;
}

function readApprovalFactReplies(runView: BlueprintRunView, request: ApprovalRequest): PendingApprovalItem["replies"] {
  const threadId = request.threadId ?? request.id;
  const replies = (runView.approvalReplies ?? [])
    .filter((reply) => reply.threadId === threadId || reply.approvalRequestId === request.id)
    .map((reply) => pendingApprovalReplyFromApprovalReply(reply));
  return replies.length ? replies : undefined;
}

function pendingApprovalReplyFromApprovalReply(reply: ApprovalReply): NonNullable<PendingApprovalItem["replies"]>[number] {
  return {
    id: reply.id,
    role: reply.actor === "user" ? "user" : "assistant",
    purpose: reply.purpose ?? "message",
    body: reply.body,
    createdAt: reply.createdAt
  };
}

function readApprovalDecisionReplies(runView: BlueprintRunView, approvalRequestId: string): PendingApprovalItem["replies"] {
  const replies = (runView.approvalDecisions ?? []).flatMap((decision) => {
    if (decision.approvalRequestId !== approvalRequestId || decision.action !== "reply" || !decision.comment) return [];
    return [{
      id: decision.id,
      role: "user" as const,
      purpose: "message" as const,
      body: decision.comment,
      createdAt: decision.createdAt
    }];
  });
  return replies.length ? replies : undefined;
}

function readApprovalRequestDiscussion(
  runView: BlueprintRunView,
  approvalRequestId: string
): PendingApprovalItem["discussion"] {
  return (runView.approvalRequestDiscussions ?? [])
    .find((candidate) => candidate.approvalRequestId === approvalRequestId)
    ?.discussion ?? {
      mode: "none",
      canStreamReply: false,
      canCreateCandidate: false,
      reason: "backend_discussion_projection_missing"
    };
}

function mergePendingApprovalReplies(
  ...groups: Array<PendingApprovalItem["replies"]>
): PendingApprovalItem["replies"] {
  const merged: NonNullable<PendingApprovalItem["replies"]> = [];
  const seenExact = new Set<string>();
  const seenContentFromEarlierSources = new Set<string>();
  groups.forEach((group, groupIndex) => {
    for (const reply of group ?? []) {
      const exactKey = `${reply.role}\0${reply.body}\0${reply.createdAt}`;
      if (seenExact.has(exactKey)) continue;
      const contentKey = `${reply.role}\0${reply.body}`;
      if (groupIndex > 0 && seenContentFromEarlierSources.has(contentKey)) continue;
      seenExact.add(exactKey);
      seenContentFromEarlierSources.add(contentKey);
      merged.push(reply);
    }
  });
  return merged.length ? merged : undefined;
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
