import type {
  CatalogSnapshot,
  CatalogSnapshotResponse,
  CompanyDirectoryResponse,
  CreateOpenClawAgentRequest,
  DashboardStateResponse,
  LatestWorkflowRunResponse,
  ListPendingApprovalsResponse,
  ListWorkflowRunViewsResponse,
  ListWorkflowsResponse,
  OpenClawConfigResponse,
  RuntimeOverview,
  RuntimeOverviewResponse,
  SaveDashboardStateRequest,
  SaveWorkflowRequest,
  SelectCompanyRequest,
  StartWorkflowRunResponse,
  UpdateOpenClawDefaultModelRequest,
  PendingApprovalItem,
  OpenClawConfigState,
  WorkspaceDashboard,
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
  async getOpenClawConfig(): Promise<OpenClawConfigState> {
    const response = await request<OpenClawConfigResponse>("/api/openclaw-config");
    return response.config;
  },

  async updateOpenClawDefaultModel(modelId: string): Promise<OpenClawConfigState> {
    const response = await request<OpenClawConfigResponse>("/api/openclaw-config/default-model", {
      method: "PUT",
      body: JSON.stringify({ modelId } satisfies UpdateOpenClawDefaultModelRequest)
    });
    return response.config;
  },

  async addOpenClawAgent(input: CreateOpenClawAgentRequest): Promise<OpenClawConfigState> {
    const response = await request<OpenClawConfigResponse>("/api/openclaw-config/agents", {
      method: "POST",
      body: JSON.stringify(input satisfies CreateOpenClawAgentRequest)
    });
    return response.config;
  },

  async listCompanies(): Promise<CompanyDirectoryResponse> {
    return request<CompanyDirectoryResponse>("/api/companies");
  },

  async selectCompany(companyId?: string): Promise<CompanyDirectoryResponse> {
    return request<CompanyDirectoryResponse>("/api/companies/selected", {
      method: "PUT",
      body: JSON.stringify({ companyId } satisfies SelectCompanyRequest)
    });
  },

  async listWorkflows(): Promise<WorkflowDefinition[]> {
    const response = await request<ListWorkflowsResponse>("/api/workflows");
    return response.workflows;
  },

  async getWorkflow(id: string): Promise<WorkflowDefinition> {
    const response = await request<WorkflowResponse>(`/api/workflows/${id}`);
    return response.workflow;
  },

  async listWorkflowRuns(): Promise<ListWorkflowRunViewsResponse["runs"]> {
    const response = await request<ListWorkflowRunViewsResponse>("/api/workflow-runs");
    return response.runs;
  },

  async listPendingApprovals(): Promise<PendingApprovalItem[]> {
    const response = await request<ListPendingApprovalsResponse>("/api/approvals/pending");
    return response.approvals;
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
  },

  async getDashboardState(): Promise<WorkspaceDashboard> {
    const response = await request<DashboardStateResponse>("/api/dashboard-state");
    return response.dashboard;
  },

  async saveDashboardState(dashboard: WorkspaceDashboard): Promise<WorkspaceDashboard> {
    const response = await request<DashboardStateResponse>("/api/dashboard-state", {
      method: "PUT",
      body: JSON.stringify({ dashboard } satisfies SaveDashboardStateRequest)
    });
    return response.dashboard;
  },

  async getRuntimeOverview(): Promise<RuntimeOverview> {
    const response = await request<RuntimeOverviewResponse>("/api/runtime-overview");
    return response.runtime;
  }
};
