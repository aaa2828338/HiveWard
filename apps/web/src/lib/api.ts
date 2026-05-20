import type {
  CatalogSnapshot,
  CatalogSnapshotResponse,
  CompanyDirectoryResponse,
  ConfigureOpenClawChannelRequest,
  ConfigureOpenClawModelAuthRequest,
  CreateOpenClawAgentRequest,
  CreateMissionRequest,
  DashboardStateResponse,
  ExportMissionResponse,
  ImportMissionPackageRequest,
  ImportMissionPackageResponse,
  LatestMissionRunResponse,
  ListPendingApprovalsResponse,
  ListMissionRunViewsResponse,
  ListMissionsResponse,
  OpenClawConfigResponse,
  OpenClawConfigWizardMetadata,
  OpenClawConfigWizardResponse,
  OpenClawModelUsageResponse,
  OpenClawModelUsageSummary,
  OpenClawVersionInfo,
  OpenClawVersionResponse,
  RuntimeOverview,
  RuntimeOverviewResponse,
  SaveMissionRequest,
  SelectCompanyRequest,
  StartMissionRunResponse,
  UpdateOpenClawDefaultModelRequest,
  PendingApprovalItem,
  OpenClawConfigState,
  PortableMissionPackage,
  WorkspaceDashboard,
  MissionDefinition,
  MissionResponse,
  MissionRunResponse
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

  async listMissions(): Promise<MissionDefinition[]> {
    const response = await request<ListMissionsResponse>("/api/missions");
    return response.missions;
  },

  async createMission(input: CreateMissionRequest): Promise<MissionDefinition> {
    const response = await request<MissionResponse>("/api/missions", {
      method: "POST",
      body: JSON.stringify(input satisfies CreateMissionRequest)
    });
    return response.mission;
  },

  async getMission(id: string): Promise<MissionDefinition> {
    const response = await request<MissionResponse>(`/api/missions/${id}`);
    return response.mission;
  },

  async listMissionRuns(): Promise<ListMissionRunViewsResponse["runs"]> {
    const response = await request<ListMissionRunViewsResponse>("/api/mission-runs");
    return response.runs;
  },

  async listPendingApprovals(): Promise<PendingApprovalItem[]> {
    const response = await request<ListPendingApprovalsResponse>("/api/approvals/pending");
    return response.approvals;
  },

  async saveMission(mission: MissionDefinition): Promise<MissionDefinition> {
    const response = await request<MissionResponse>(`/api/missions/${mission.id}`, {
      method: "PUT",
      body: JSON.stringify({ mission } satisfies SaveMissionRequest)
    });
    return response.mission;
  },

  async exportMission(missionId: string): Promise<PortableMissionPackage> {
    const response = await request<ExportMissionResponse>(`/api/missions/${missionId}/export`);
    return response.missionPackage;
  },

  async importMissionPackage(missionPackage: PortableMissionPackage): Promise<MissionDefinition[]> {
    const response = await request<ImportMissionPackageResponse>("/api/missions/import", {
      method: "POST",
      body: JSON.stringify({ missionPackage } satisfies ImportMissionPackageRequest)
    });
    return response.missions;
  },

  async startMissionRun(missionId: string): Promise<StartMissionRunResponse["run"]> {
    const response = await request<StartMissionRunResponse>(`/api/missions/${missionId}/runs`, {
      method: "POST",
      body: JSON.stringify({ startedBy: "local-user" })
    });
    return response.run;
  },

  async getLatestMissionRun(missionId: string): Promise<StartMissionRunResponse["run"] | undefined> {
    const response = await request<LatestMissionRunResponse>(`/api/missions/${missionId}/runs/latest`);
    return response.run ?? undefined;
  },

  async approveMissionRun(runId: string): Promise<MissionRunResponse["run"]> {
    const response = await request<MissionRunResponse>(`/api/mission-runs/${runId}/approve`, {
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
