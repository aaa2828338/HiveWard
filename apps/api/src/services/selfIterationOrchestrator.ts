import type {
  ApprovalRequest,
  ManagerNodeConfig
} from "@hiveward/shared";

export class SelfIterationOrchestrator {
  selectNextAutoResolvableRequest(input: {
    requests: ApprovalRequest[];
    topManagerNodeId: string;
    config: ManagerNodeConfig;
  }): ApprovalRequest | undefined {
    return input.requests
      .filter((request) => request.requestedBy.nodeId === input.topManagerNodeId)
      .filter((request) => this.canAutoResolveRequest(request, input.config))
      .sort((left, right) => new Date(left.requestedAt).getTime() - new Date(right.requestedAt).getTime())[0];
  }

  canAutoResolveRequest(request: ApprovalRequest, config: ManagerNodeConfig): boolean {
    if (request.kind === "iteration_requirement_plan") {
      return config.autoApproveRequirements === true && request.capabilities.approve === true;
    }
    if (request.kind === "manager_release_report") {
      return config.autoApproveReleaseReports === true && request.capabilities.approve === true;
    }
    return false;
  }
}
