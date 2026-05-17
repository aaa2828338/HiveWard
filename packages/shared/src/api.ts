import type { CatalogSnapshot } from "./catalog";
import type { WorkflowDefinition, WorkflowRunView } from "./workflow";

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

export interface CatalogSnapshotResponse {
  snapshot: CatalogSnapshot;
}

export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
  };
}
