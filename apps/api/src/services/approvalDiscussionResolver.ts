import type {
  ApprovalDiscussionBinding,
  ApprovalDiscussionRoute,
  ApprovalRequest,
  BlueprintNodeRun,
  BlueprintRun,
  NodeExecutionSession,
  PendingApprovalDiscussionCapabilities
} from "@hiveward/shared";

export interface ApprovalDiscussionExecutor {
  nodeId: string;
  nodeRunId: string;
  sessionId: string;
  runtimeId?: ApprovalDiscussionBinding["runtimeId"];
}

export interface ApprovalDiscussionResolution {
  route: ApprovalDiscussionRoute;
  capability: PendingApprovalDiscussionCapabilities;
  executor?: ApprovalDiscussionExecutor;
  reason?: string;
  binding?: ApprovalDiscussionBinding;
}

export interface ResolveApprovalDiscussionInput {
  request: ApprovalRequest;
  binding?: ApprovalDiscussionBinding;
  run?: BlueprintRun;
  nodeRuns?: BlueprintNodeRun[];
  sessions?: NodeExecutionSession[];
}

export function resolveApprovalDiscussion(input: ResolveApprovalDiscussionInput): ApprovalDiscussionResolution {
  const { request, binding } = input;
  if (request.status !== "pending") {
    return noneResolution("approval_not_pending", binding);
  }
  if (!binding) {
    return noneResolution("discussion_binding_missing");
  }
  if (binding.mode === "none") {
    return noneResolution(binding.reason ?? "discussion_disabled", binding);
  }
  if (binding.mode === "message_only") {
    return messageOnlyResolution(binding, binding.reason);
  }

  const executorNodeRunId = binding.executorNodeRunId;
  const executorSessionId = binding.executorSessionId;
  const executorNodeId = binding.executorNodeId;
  if (!executorNodeRunId || !executorSessionId || !executorNodeId) {
    return noneResolution("executor_binding_incomplete", binding);
  }

  const nodeRun = input.nodeRuns?.find((candidate) => candidate.id === executorNodeRunId);
  if (input.nodeRuns && !nodeRun) {
    return noneResolution("executor_node_run_missing", binding);
  }

  const session = input.sessions?.find((candidate) => candidate.id === executorSessionId);
  if (input.sessions && !session) {
    return noneResolution("executor_session_missing", binding);
  }
  if (session?.status === "unavailable") {
    return noneResolution("executor_session_unavailable", binding);
  }

  return {
    route: binding.route,
    binding,
    capability: {
      mode: "executor",
      canStreamReply: binding.canStreamReply,
      ...(capabilityExecutorKind(binding.executorKind ?? binding.route)
        ? { executorKind: capabilityExecutorKind(binding.executorKind ?? binding.route) }
        : {}),
      ...(binding.reason ? { reason: binding.reason } : {})
    },
    executor: {
      nodeId: executorNodeId,
      nodeRunId: executorNodeRunId,
      sessionId: executorSessionId,
      runtimeId: binding.runtimeId
    }
  };
}

function noneResolution(reason: string, binding?: ApprovalDiscussionBinding): ApprovalDiscussionResolution {
  return {
    route: "none",
    binding,
    reason,
    capability: {
      mode: "none",
      canStreamReply: false,
      reason
    }
  };
}

function messageOnlyResolution(
  binding: ApprovalDiscussionBinding,
  reason: string | undefined
): ApprovalDiscussionResolution {
  return {
    route: binding.route === "none" ? "message_only" : binding.route,
    binding,
    reason,
    capability: {
      mode: "message_only",
      canStreamReply: false,
      ...(capabilityExecutorKind(binding.executorKind ?? binding.route)
        ? { executorKind: capabilityExecutorKind(binding.executorKind ?? binding.route) }
        : {}),
      ...(reason ? { reason } : binding.reason ? { reason: binding.reason } : {})
    }
  };
}

function capabilityExecutorKind(
  route: ApprovalDiscussionRoute | undefined
): PendingApprovalDiscussionCapabilities["executorKind"] | undefined {
  if (!route || route === "none" || route === "message_only") return undefined;
  return route;
}
