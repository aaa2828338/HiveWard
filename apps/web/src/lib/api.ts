import type {
  CatalogSnapshot,
  CatalogSnapshotResponse,
  LatestWorkflowRunResponse,
  ListWorkflowsResponse,
  SaveWorkflowRequest,
  StartWorkflowRunResponse,
  WorkflowDefinition,
  WorkflowResponse,
  WorkflowRunResponse
} from "@openclaw-cui/shared";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init?.headers
    }
  });

  if (!response.ok) {
    const body = await response.json().catch(() => undefined);
    const message = body?.error?.message ?? `Request failed: ${response.status}`;
    throw new Error(message);
  }

  return response.json() as Promise<T>;
}

export const api = {
  async listWorkflows(): Promise<WorkflowDefinition[]> {
    const response = await request<ListWorkflowsResponse>("/api/workflows");
    return response.workflows;
  },

  async getWorkflow(id: string): Promise<WorkflowDefinition> {
    const response = await request<WorkflowResponse>(`/api/workflows/${id}`);
    return response.workflow;
  },

  async saveWorkflow(workflow: WorkflowDefinition): Promise<WorkflowDefinition> {
    const response = await request<WorkflowResponse>(`/api/workflows/${workflow.id}`, {
      method: "PUT",
      body: JSON.stringify({ workflow } satisfies SaveWorkflowRequest)
    });
    return response.workflow;
  },

  async startWorkflowRun(workflowId: string): Promise<StartWorkflowRunResponse["run"]> {
    const response = await request<StartWorkflowRunResponse>(`/api/workflows/${workflowId}/runs`, {
      method: "POST",
      body: JSON.stringify({ startedBy: "local-user" })
    });
    return response.run;
  },

  async getLatestWorkflowRun(workflowId: string): Promise<StartWorkflowRunResponse["run"] | undefined> {
    const response = await request<LatestWorkflowRunResponse>(`/api/workflows/${workflowId}/runs/latest`);
    return response.run ?? undefined;
  },

  async approveWorkflowRun(runId: string): Promise<WorkflowRunResponse["run"]> {
    const response = await request<WorkflowRunResponse>(`/api/workflow-runs/${runId}/approve`, {
      method: "POST",
      body: JSON.stringify({})
    });
    return response.run;
  },

  async getCatalogSnapshot(): Promise<CatalogSnapshot> {
    const response = await request<CatalogSnapshotResponse>("/api/catalog/snapshot");
    return response.snapshot;
  },

  async refreshCatalog(): Promise<CatalogSnapshot> {
    const response = await request<CatalogSnapshotResponse>("/api/catalog/refresh", {
      method: "POST",
      body: JSON.stringify({})
    });
    return response.snapshot;
  }
};
