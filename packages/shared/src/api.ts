import type { CatalogSnapshot } from "./catalog";
import type { OpenClawSessionSummary, OpenClawTaskSummary } from "./openclaw";
import type { WorkflowDefinition, WorkflowRunView } from "./workflow";
import type { PendingApprovalItem, WorkspaceDashboard } from "./workspace";

export interface ListWorkflowsResponse {
  workflows: WorkflowDefinition[];
}

export interface WorkflowResponse {
  workflow: WorkflowDefinition;
}

export interface SaveWorkflowRequest {
  workflow: WorkflowDefinition;
}

export interface StartWorkflowRunRequest {
  startedBy?: string;
}

export interface StartWorkflowRunResponse {
  run: WorkflowRunView;
}

export interface LatestWorkflowRunResponse {
  run: WorkflowRunView | null;
}

export interface WorkflowRunResponse {
  run: WorkflowRunView;
}

export interface ListWorkflowRunViewsResponse {
  runs: WorkflowRunView[];
}

export interface ListPendingApprovalsResponse {
  approvals: PendingApprovalItem[];
}

export interface DashboardStateResponse {
  dashboard: WorkspaceDashboard;
}

export interface SaveDashboardStateRequest {
  dashboard: WorkspaceDashboard;
}

export interface RuntimeOverview {
  sessions: OpenClawSessionSummary[];
  tasks: OpenClawTaskSummary[];
}

export interface RuntimeOverviewResponse {
  runtime: RuntimeOverview;
}

export interface CatalogSnapshotResponse {
  snapshot: CatalogSnapshot;
}

export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
  };
}
