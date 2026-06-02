import type {
  ApprovalDiscussionBinding,
  ApprovalRequest,
  BlueprintNodeRun,
  BlueprintRun,
  NodeExecutionSession,
  PendingApprovalDiscussionCapabilities
} from "@hiveward/shared";
import { resolveApprovalDiscussion } from "../services/approvalDiscussionResolver";

export function projectPendingApprovalDiscussion(input: {
  request: ApprovalRequest;
  binding?: ApprovalDiscussionBinding;
  run?: BlueprintRun;
  nodeRuns?: BlueprintNodeRun[];
  sessions?: NodeExecutionSession[];
}): PendingApprovalDiscussionCapabilities {
  return resolveApprovalDiscussion(input).capability;
}
