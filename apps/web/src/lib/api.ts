import type {
  CatalogSnapshot,
  CatalogSnapshotResponse,
  CompanyDirectoryResponse,
  ConfigureOpenClawChannelRequest,
  ConfigureOpenClawModelAuthRequest,
  CreateOpenClawAgentRequest,
  CreateBlueprintRequest,
  DashboardStateResponse,
  ExportBlueprintResponse,
  ImportBlueprintPackageRequest,
  ImportBlueprintPackageResponse,
  LatestBlueprintRunResponse,
  ListPendingApprovalsResponse,
  ListBlueprintRunViewsResponse,
  ListBlueprintsResponse,
  OpenClawConfigResponse,
  OpenClawConfigWizardMetadata,
  OpenClawConfigWizardResponse,
  OpenClawModelUsageResponse,
  OpenClawModelUsageSummary,
  OpenClawVersionInfo,
  OpenClawVersionResponse,
  RuntimeOverview,
  RuntimeOverviewResponse,
  SaveBlueprintRequest,
  SelectCompanyRequest,
  StartBlueprintRunResponse,
  UpdateOpenClawDefaultModelRequest,
  PendingApprovalItem,
  OpenClawConfigState,
  PortableBlueprintPackage,
  WorkspaceDashboard,
  BlueprintDefinition,
  BlueprintResponse,
  BlueprintRunResponse
} from "@hiveward/shared";

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

  async getOpenClawConfigWizard(): Promise<OpenClawConfigWizardMetadata> {
    const response = await request<OpenClawConfigWizardResponse>("/api/openclaw-config/wizard");
    return response.wizard;
  },

  async getOpenClawVersion(): Promise<OpenClawVersionInfo> {
    const response = await request<OpenClawVersionResponse>("/api/openclaw-version");
    return response.version;
  },

  async getOpenClawModelUsage(): Promise<OpenClawModelUsageSummary[]> {
    const response = await request<OpenClawModelUsageResponse>("/api/openclaw-usage/models");
    return response.usage;
  },

  async updateOpenClawDefaultModel(modelId: string): Promise<OpenClawConfigState> {
    const response = await request<OpenClawConfigResponse>("/api/openclaw-config/default-model", {
      method: "PUT",
      body: JSON.stringify({ modelId } satisfies UpdateOpenClawDefaultModelRequest)
    });
    return response.config;
  },

  async configureOpenClawModelAuth(input: ConfigureOpenClawModelAuthRequest): Promise<OpenClawConfigState> {
    const response = await request<OpenClawConfigResponse>("/api/openclaw-config/model-auth", {
      method: "POST",
      body: JSON.stringify(input satisfies ConfigureOpenClawModelAuthRequest)
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

  async configureOpenClawChannel(input: ConfigureOpenClawChannelRequest): Promise<OpenClawConfigState> {
    const response = await request<OpenClawConfigResponse>("/api/openclaw-config/channel-setup", {
      method: "POST",
      body: JSON.stringify(input satisfies ConfigureOpenClawChannelRequest)
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

  async listBlueprints(): Promise<BlueprintDefinition[]> {
    const response = await request<ListBlueprintsResponse>("/api/blueprints");
    return response.blueprints;
  },

  async createBlueprint(input: CreateBlueprintRequest): Promise<BlueprintDefinition> {
    const response = await request<BlueprintResponse>("/api/blueprints", {
      method: "POST",
      body: JSON.stringify(input satisfies CreateBlueprintRequest)
    });
    return response.blueprint;
  },

  async getBlueprint(id: string): Promise<BlueprintDefinition> {
    const response = await request<BlueprintResponse>(`/api/blueprints/${id}`);
    return response.blueprint;
  },

  async listBlueprintRuns(): Promise<ListBlueprintRunViewsResponse["runs"]> {
    const response = await request<ListBlueprintRunViewsResponse>("/api/blueprint-runs");
    return response.runs;
  },

  async listPendingApprovals(): Promise<PendingApprovalItem[]> {
    const response = await request<ListPendingApprovalsResponse>("/api/approvals/pending");
    return response.approvals;
  },

  async saveBlueprint(blueprint: BlueprintDefinition): Promise<BlueprintDefinition> {
    const response = await request<BlueprintResponse>(`/api/blueprints/${blueprint.id}`, {
      method: "PUT",
      body: JSON.stringify({ blueprint } satisfies SaveBlueprintRequest)
    });
    return response.blueprint;
  },

  async exportBlueprint(blueprintId: string): Promise<PortableBlueprintPackage> {
    const response = await request<ExportBlueprintResponse>(`/api/blueprints/${blueprintId}/export`);
    return response.blueprintPackage;
  },

  async importBlueprintPackage(blueprintPackage: PortableBlueprintPackage): Promise<BlueprintDefinition[]> {
    const response = await request<ImportBlueprintPackageResponse>("/api/blueprints/import", {
      method: "POST",
      body: JSON.stringify({ blueprintPackage } satisfies ImportBlueprintPackageRequest)
    });
    return response.blueprints;
  },

  async startBlueprintRun(blueprintId: string): Promise<StartBlueprintRunResponse["run"]> {
    const response = await request<StartBlueprintRunResponse>(`/api/blueprints/${blueprintId}/runs`, {
      method: "POST",
      body: JSON.stringify({ startedBy: "local-user" })
    });
    return response.run;
  },

  async getLatestBlueprintRun(blueprintId: string): Promise<StartBlueprintRunResponse["run"] | undefined> {
    const response = await request<LatestBlueprintRunResponse>(`/api/blueprints/${blueprintId}/runs/latest`);
    return response.run ?? undefined;
  },

  async approveBlueprintRun(runId: string): Promise<BlueprintRunResponse["run"]> {
    const response = await request<BlueprintRunResponse>(`/api/blueprint-runs/${runId}/approve`, {
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

  async getRuntimeOverview(): Promise<RuntimeOverview> {
    const response = await request<RuntimeOverviewResponse>("/api/runtime-overview");
    return response.runtime;
  }
};
