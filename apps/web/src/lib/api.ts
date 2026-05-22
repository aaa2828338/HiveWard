import type {
  CatalogSnapshot,
  CatalogSnapshotResponse,
  CompanyDirectoryResponse,
  ConfigureOpenClawChannelRequest,
  ConfigureOpenClawModelAuthRequest,
  CreateCompanyRequest,
  CreateOpenClawAgentRequest,
  CreateBlueprintRequest,
  DashboardStateResponse,
  DeleteBlueprintResponse,
  DeleteCompanyResponse,
  ExportBlueprintResponse,
  HarnessStatus,
  HarnessStatusResponse,
  ImportBlueprintPackageRequest,
  ImportBlueprintPackageResponse,
  LatestBlueprintRunResponse,
  ListPendingApprovalsResponse,
  ListBlueprintRunSummariesResponse,
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
  ApproveBlueprintRunRequest,
  ChatSessionHistoryResponse,
  CreateChatSessionRequest,
  CreateChatSessionResponse,
  SendChatMessageRequest,
  ChatStreamEvent,
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

export interface ChatStreamHandlers {
  onEvent: (event: ChatStreamEvent) => void;
}

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
  async createChatSession(input: CreateChatSessionRequest): Promise<CreateChatSessionResponse> {
    return request<CreateChatSessionResponse>("/api/chat/session", {
      method: "POST",
      body: JSON.stringify(input satisfies CreateChatSessionRequest)
    });
  },

  async streamChat(input: SendChatMessageRequest, handlers: ChatStreamHandlers): Promise<void> {
    const response = await fetch(`${apiBaseUrl}/api/chat/stream`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(input)
    });

    if (!response.ok) {
      const body = await response.json().catch(() => undefined);
      const message = body?.error?.message ?? `Request failed: ${response.status}`;
      throw new Error(message);
    }

    if (!response.body) {
      throw new Error("Chat stream response did not include a body.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = consumeChatStreamBuffer(buffer, handlers);
    }

    buffer += decoder.decode();
    consumeChatStreamBuffer(`${buffer}\n\n`, handlers);
  },

  async getChatSessionHistory(sessionKey: string): Promise<ChatSessionHistoryResponse["messages"]> {
    const response = await request<ChatSessionHistoryResponse>(`/api/chat/history?sessionKey=${encodeURIComponent(sessionKey)}`);
    return response.messages;
  },

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

  async getHarnessStatus(): Promise<HarnessStatus[]> {
    const response = await request<HarnessStatusResponse>("/api/harness-status");
    return response.statuses;
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

  async createCompany(input: CreateCompanyRequest): Promise<CompanyDirectoryResponse> {
    return request<CompanyDirectoryResponse>("/api/companies", {
      method: "POST",
      body: JSON.stringify(input satisfies CreateCompanyRequest)
    });
  },

  async selectCompany(companyId?: string): Promise<CompanyDirectoryResponse> {
    return request<CompanyDirectoryResponse>("/api/companies/selected", {
      method: "PUT",
      body: JSON.stringify({ companyId } satisfies SelectCompanyRequest)
    });
  },

  async deleteCompany(companyId: string): Promise<DeleteCompanyResponse> {
    return request<DeleteCompanyResponse>(`/api/companies/${encodeURIComponent(companyId)}`, {
      method: "DELETE"
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

  async listBlueprintRuns(): Promise<ListBlueprintRunSummariesResponse["runs"]> {
    const response = await request<ListBlueprintRunSummariesResponse>("/api/blueprint-runs");
    return response.runs;
  },

  async getBlueprintRun(runId: string): Promise<BlueprintRunResponse["run"]> {
    const response = await request<BlueprintRunResponse>(`/api/blueprint-runs/${runId}`);
    return response.run;
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

  async deleteBlueprint(blueprintId: string): Promise<string> {
    const response = await request<DeleteBlueprintResponse>(`/api/blueprints/${blueprintId}`, {
      method: "DELETE"
    });
    return response.blueprintId;
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

  async approveBlueprintRun(runId: string, nodeRunId?: string): Promise<BlueprintRunResponse["run"]> {
    const response = await request<BlueprintRunResponse>(`/api/blueprint-runs/${runId}/approve`, {
      method: "POST",
      body: JSON.stringify({ nodeRunId } satisfies ApproveBlueprintRunRequest)
    });
    return response.run;
  },

  async cancelBlueprintRun(runId: string): Promise<BlueprintRunResponse["run"]> {
    const response = await request<BlueprintRunResponse>(`/api/blueprint-runs/${runId}/cancel`, {
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

function consumeChatStreamBuffer(buffer: string, handlers: ChatStreamHandlers): string {
  const frames = buffer.split(/\n\n/);
  const remainder = frames.pop() ?? "";
  for (const frame of frames) {
    const event = readChatStreamFrame(frame);
    if (event) handlers.onEvent(event);
  }
  return remainder;
}

function readChatStreamFrame(frame: string): ChatStreamEvent | undefined {
  const data = frame
    .split(/\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  if (!data) return undefined;
  return JSON.parse(data) as ChatStreamEvent;
}
