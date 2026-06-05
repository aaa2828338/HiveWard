import type {
  CatalogSnapshot,
  CatalogSnapshotResponse,
  ClaudeCodeModelConfig,
  ClaudeCodeModelConfigResponse,
  CompanyDirectoryResponse,
  ConfigureOpenClawChannelRequest,
  ConfigureOpenClawModelAuthRequest,
  CreateCompanyRequest,
  CreateHermesChannelRequest,
  CreateHermesProfileRequest,
  CreateOpenClawAgentRequest,
  CreateBlueprintRequest,
  CreateHumanActionResponseRequest,
  DashboardStateResponse,
  DeleteBlueprintResponse,
  DeleteCompanyResponse,
  ExportBlueprintResponse,
  HarnessId,
  HarnessSkillStatusResponse,
  HarnessStatus,
  HarnessStatusResponse,
  HermesConfigResponse,
  ApplyHivewardUpdateResponse,
  ApplyHivewardUpdateRequest,
  ApprovalThread,
  ApprovalThreadRepliesResponse,
  ApprovalThreadResponse,
  ApprovalRequest,
  ApprovalRequestResponse,
  HivewardUpdateResponse,
  ImportBlueprintPackageRequest,
  ImportBlueprintPackageResponse,
  InstallHarnessSkillsResponse,
  LatestBlueprintRunResponse,
  ListPendingApprovalsResponse,
  ListApprovalMessagesResponse,
  ListApprovalRequestsResponse,
  ListApprovalThreadsResponse,
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
  SaveArchitectureBlueprintLayoutRequest,
  SaveBlueprintRequest,
  SelectCompanyRequest,
  UpdateCompanyRequest,
  ReplyApprovalRequestRequest,
  ChatSessionHistoryResponse,
  ChatSessionMessagesResponse,
  CreateChatSessionRequest,
  CreateChatSessionResponse,
  CreateHivewardChatSessionRequest,
  CreateRunInterjectionRequest,
  UpdateChatSessionTitleRequest,
  UpdateChatSessionTitleResponse,
  UpdateHivewardChatSessionRequest,
  SaveClaudeCodeModelProfileRequest,
  UpdateClaudeCodeModelConfigRequest,
  SendChatSessionMessageRequest,
  AgentOutputEvent,
  BlueprintKanbanBoard,
  HumanActionResponse,
  HumanActionRequestResponseIntent,
  HumanActionRequestSourceContextType,
  HivewardChatSession,
  HivewardChatSessionResponse,
  InboxProjection,
  ListHumanActionResponsesResponse,
  ListBlueprintKanbanResponse,
  ListInboxProjectionsResponse,
  ListChatSessionsResponse,
  StartBlueprintRunResponse,
  UpdateOpenClawDefaultModelRequest,
  PendingApprovalItem,
  RoleDirectoryResponse,
  OpenClawConfigState,
  PortableBlueprintPackage,
  WorkspaceDashboard,
  BlueprintDefinition,
  BlueprintResponse,
  BlueprintRunResponse,
  ExecutiveCommand,
  ExecuteExecutiveCommandResponse,
  RunInterjectionResponse,
  RunRoomOutputEventsResponse,
  RunRoomOutputStreamEvent
} from "@hiveward/shared";

const importMetaEnv = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {};
const apiBaseUrl = (importMetaEnv.VITE_API_BASE_URL ?? "").trim().replace(/\/+$/, "");

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

export function isClosedApprovalConflictError(error: unknown): boolean {
  if (!(error instanceof ApiRequestError) || error.status !== 409) return false;
  return error.code === "approval_conflict" ||
    /approval request is (already closed|no longer pending)/i.test(error.message);
}

export interface ChatStreamHandlers {
  onEvent: (event: AgentOutputEvent) => void;
}

export interface RunRoomOutputStreamHandlers {
  onEvent: (event: RunRoomOutputStreamEvent) => void;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetchApi(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init?.headers
    }
  });

  if (!response.ok) {
    const body = await response.json().catch(() => undefined);
    const message = body?.error?.message ?? `Request failed: ${response.status}`;
    const code = typeof body?.error?.code === "string" ? body.error.code : undefined;
    throw new ApiRequestError(message, response.status, code);
  }

  return response.json() as Promise<T>;
}

async function fetchApi(path: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(buildApiUrl(path), init);
  } catch (error) {
    if (isAbortError(error)) throw error;
    if (apiBaseUrl) {
      try {
        return await fetch(path, init);
      } catch (fallbackError) {
        if (isAbortError(fallbackError)) throw fallbackError;
      }
    }
    throw new Error("Cannot reach Hiveward API. Make sure the local Hiveward server is running.");
  }
}

function buildApiUrl(path: string, baseUrl = apiBaseUrl): string {
  if (isAbsoluteResourceUrl(path)) return path;
  return baseUrl ? `${baseUrl}${path.startsWith("/") ? path : `/${path}`}` : path;
}

export function resolveApiResourceUrl(path: string, baseUrl = apiBaseUrl): string {
  const trimmed = path.trim();
  if (!trimmed) return trimmed;
  return buildApiUrl(trimmed, baseUrl);
}

function isAbsoluteResourceUrl(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith("//");
}

function isAbortError(error: unknown): boolean {
  return typeof DOMException !== "undefined" && error instanceof DOMException && error.name === "AbortError";
}

async function consumeChatStreamResponse(response: Response, handlers: ChatStreamHandlers): Promise<void> {
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
}

async function consumeRunRoomOutputStreamResponse(response: Response, handlers: RunRoomOutputStreamHandlers): Promise<void> {
  if (!response.body) {
    throw new Error("RunRoom output stream response did not include a body.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    buffer = consumeRunRoomOutputStreamBuffer(buffer, handlers);
  }

  buffer += decoder.decode();
  consumeRunRoomOutputStreamBuffer(`${buffer}\n\n`, handlers);
}

export const api = {
  async listChatSessions(): Promise<HivewardChatSession[]> {
    const response = await request<ListChatSessionsResponse>("/api/chat/sessions");
    return response.sessions;
  },

  async createHivewardChatSession(input: CreateHivewardChatSessionRequest): Promise<HivewardChatSession> {
    const response = await request<HivewardChatSessionResponse>("/api/chat/sessions", {
      method: "POST",
      body: JSON.stringify(input satisfies CreateHivewardChatSessionRequest)
    });
    return response.session;
  },

  async updateHivewardChatSession(sessionId: string, input: UpdateHivewardChatSessionRequest): Promise<HivewardChatSession> {
    const response = await request<HivewardChatSessionResponse>(`/api/chat/sessions/${encodeURIComponent(sessionId)}`, {
      method: "PATCH",
      body: JSON.stringify(input satisfies UpdateHivewardChatSessionRequest)
    });
    return response.session;
  },

  async endHivewardChatSession(sessionId: string): Promise<HivewardChatSession> {
    const response = await request<HivewardChatSessionResponse>(`/api/chat/sessions/${encodeURIComponent(sessionId)}/end`, {
      method: "POST"
    });
    return response.session;
  },

  async getChatOutputEvents(sessionId: string): Promise<ChatSessionMessagesResponse["messages"]> {
    const response = await request<ChatSessionMessagesResponse>(`/api/chat/sessions/${encodeURIComponent(sessionId)}/messages`);
    return response.messages;
  },

  async streamSessionChat(
    sessionId: string,
    input: SendChatSessionMessageRequest,
    handlers: ChatStreamHandlers,
    signal?: AbortSignal
  ): Promise<void> {
    const response = await fetchApi(`/api/chat/sessions/${encodeURIComponent(sessionId)}/messages/stream`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      signal,
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

    await consumeChatStreamResponse(response, handlers);
  },

  async executeExecutiveCommand(sessionId: string, command: ExecutiveCommand): Promise<ExecuteExecutiveCommandResponse> {
    return request<ExecuteExecutiveCommandResponse>(`/api/chat/sessions/${encodeURIComponent(sessionId)}/executive-commands`, {
      method: "POST",
      body: JSON.stringify({ command })
    });
  },

  async createChatSession(input: CreateChatSessionRequest): Promise<CreateChatSessionResponse> {
    return request<CreateChatSessionResponse>("/api/chat/session", {
      method: "POST",
      body: JSON.stringify(input satisfies CreateChatSessionRequest)
    });
  },

  async updateChatSessionTitle(input: UpdateChatSessionTitleRequest): Promise<UpdateChatSessionTitleResponse> {
    return request<UpdateChatSessionTitleResponse>("/api/chat/session", {
      method: "PATCH",
      body: JSON.stringify(input satisfies UpdateChatSessionTitleRequest)
    });
  },

  async getChatSessionHistory(sessionKey: string): Promise<ChatSessionHistoryResponse> {
    return request<ChatSessionHistoryResponse>(`/api/chat/history?sessionKey=${encodeURIComponent(sessionKey)}`);
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

  async getHivewardUpdate(): Promise<HivewardUpdateResponse["update"]> {
    const response = await request<HivewardUpdateResponse>("/api/hiveward-update");
    return response.update;
  },

  async applyHivewardUpdate(input: ApplyHivewardUpdateRequest = {}): Promise<ApplyHivewardUpdateResponse> {
    return request<ApplyHivewardUpdateResponse>("/api/hiveward-update/apply", {
      method: "POST",
      body: JSON.stringify(input satisfies ApplyHivewardUpdateRequest)
    });
  },

  async getHarnessStatus(): Promise<HarnessStatus[]> {
    const response = await request<HarnessStatusResponse>("/api/harness-status");
    return response.statuses;
  },

  async getHermesConfig(): Promise<HermesConfigResponse> {
    return request<HermesConfigResponse>("/api/hermes-config");
  },

  async addHermesProfile(input: CreateHermesProfileRequest): Promise<HermesConfigResponse> {
    return request<HermesConfigResponse>("/api/hermes-config/profiles", {
      method: "POST",
      body: JSON.stringify(input satisfies CreateHermesProfileRequest)
    });
  },

  async addHermesChannel(input: CreateHermesChannelRequest): Promise<HermesConfigResponse> {
    return request<HermesConfigResponse>("/api/hermes-config/channels", {
      method: "POST",
      body: JSON.stringify(input satisfies CreateHermesChannelRequest)
    });
  },

  async getClaudeCodeModelConfig(): Promise<ClaudeCodeModelConfigResponse> {
    return request<ClaudeCodeModelConfigResponse>("/api/claude-code-config/models");
  },

  async updateClaudeCodeModelConfig(input: UpdateClaudeCodeModelConfigRequest): Promise<ClaudeCodeModelConfigResponse> {
    return request<ClaudeCodeModelConfigResponse>("/api/claude-code-config/models", {
      method: "PUT",
      body: JSON.stringify(input satisfies UpdateClaudeCodeModelConfigRequest)
    });
  },

  async saveClaudeCodeModelProfile(input: SaveClaudeCodeModelProfileRequest = {}): Promise<ClaudeCodeModelConfigResponse> {
    return request<ClaudeCodeModelConfigResponse>("/api/claude-code-config/model-profiles", {
      method: "POST",
      body: JSON.stringify(input satisfies SaveClaudeCodeModelProfileRequest)
    });
  },

  async applyClaudeCodeModelProfile(profileId: string): Promise<ClaudeCodeModelConfigResponse> {
    return request<ClaudeCodeModelConfigResponse>(`/api/claude-code-config/model-profiles/${encodeURIComponent(profileId)}/apply`, {
      method: "POST",
      body: JSON.stringify({})
    });
  },

  async deleteClaudeCodeModelProfile(profileId: string): Promise<ClaudeCodeModelConfigResponse> {
    return request<ClaudeCodeModelConfigResponse>(`/api/claude-code-config/model-profiles/${encodeURIComponent(profileId)}`, {
      method: "DELETE"
    });
  },

  async getHarnessSkillStatus(harnessId: HarnessId): Promise<HarnessSkillStatusResponse> {
    return request<HarnessSkillStatusResponse>(`/api/harness-skills/${encodeURIComponent(harnessId)}`);
  },

  async installHarnessSkills(harnessId: HarnessId): Promise<InstallHarnessSkillsResponse> {
    return request<InstallHarnessSkillsResponse>(`/api/harness-skills/${encodeURIComponent(harnessId)}/install`, {
      method: "POST"
    });
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

  async updateCompany(companyId: string, input: UpdateCompanyRequest): Promise<CompanyDirectoryResponse> {
    return request<CompanyDirectoryResponse>(`/api/companies/${encodeURIComponent(companyId)}`, {
      method: "PATCH",
      body: JSON.stringify(input satisfies UpdateCompanyRequest)
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

  async listBlueprintKanban(filter: {
    companyId?: string;
    blueprintId?: string;
    sourceContextType?: HumanActionRequestSourceContextType;
    responseIntent?: HumanActionRequestResponseIntent;
  } = {}): Promise<BlueprintKanbanBoard> {
    const params = new URLSearchParams();
    if (filter.companyId) params.set("companyId", filter.companyId);
    if (filter.blueprintId) params.set("blueprintId", filter.blueprintId);
    if (filter.sourceContextType) params.set("sourceContextType", filter.sourceContextType);
    if (filter.responseIntent) params.set("responseIntent", filter.responseIntent);
    const query = params.toString();
    const response = await request<ListBlueprintKanbanResponse>(`/api/blueprints/kanban${query ? `?${query}` : ""}`);
    return response.board;
  },

  // 保留为历史事实，不参与决策: BlueprintKanban owns the primary status projection.
  async listBlueprintRuns(): Promise<ListBlueprintRunSummariesResponse["runs"]> {
    const response = await request<ListBlueprintRunSummariesResponse>("/api/blueprint-runs");
    return response.runs;
  },

  async getBlueprintRun(runId: string): Promise<BlueprintRunResponse["run"]> {
    const response = await request<BlueprintRunResponse>(`/api/blueprint-runs/${runId}`);
    return response.run;
  },

  async getRunRoomOutput(runRoomId: string): Promise<RunRoomOutputEventsResponse["output"]> {
    const response = await request<RunRoomOutputEventsResponse>(`/api/run-rooms/${encodeURIComponent(runRoomId)}/output/events`);
    return response.output;
  },

  async streamRunRoomOutputEvents(runRoomId: string, handlers: RunRoomOutputStreamHandlers, signal?: AbortSignal): Promise<void> {
    const response = await fetchApi(`/api/run-rooms/${encodeURIComponent(runRoomId)}/output/events/stream`, {
      method: "GET",
      signal
    });

    if (!response.ok) {
      const body = await response.json().catch(() => undefined);
      const message = body?.error?.message ?? `Request failed: ${response.status}`;
      const code = typeof body?.error?.code === "string" ? body.error.code : undefined;
      throw new ApiRequestError(message, response.status, code);
    }

    await consumeRunRoomOutputStreamResponse(response, handlers);
  },

  async sendRunInterjection(runRoomId: string, input: CreateRunInterjectionRequest): Promise<RunInterjectionResponse> {
    return request<RunInterjectionResponse>(`/api/run-rooms/${encodeURIComponent(runRoomId)}/interjections`, {
      method: "POST",
      body: JSON.stringify(input satisfies CreateRunInterjectionRequest)
    });
  },

  async listPendingApprovals(): Promise<PendingApprovalItem[]> {
    const response = await request<ListPendingApprovalsResponse>("/api/approvals/pending");
    return response.approvals;
  },

  async listApprovalRequests(): Promise<ApprovalRequest[]> {
    const response = await request<ListApprovalRequestsResponse>("/api/approval-requests");
    return response.approvalRequests;
  },

  async listApprovalThreads(filter: { runId?: string; status?: ApprovalThread["status"] } = {}): Promise<ApprovalThread[]> {
    const params = new URLSearchParams();
    if (filter.runId) params.set("runId", filter.runId);
    if (filter.status) params.set("status", filter.status);
    const query = params.toString();
    const response = await request<ListApprovalThreadsResponse>(`/api/approval-threads${query ? `?${query}` : ""}`);
    return response.approvalThreads;
  },

  async getApprovalThread(approvalThreadId: string): Promise<ApprovalThreadResponse> {
    return request<ApprovalThreadResponse>(`/api/approval-threads/${encodeURIComponent(approvalThreadId)}`);
  },

  async listApprovalThreadReplies(approvalThreadId: string): Promise<ApprovalThreadRepliesResponse["approvalReplies"]> {
    const response = await request<ApprovalThreadRepliesResponse>(
      `/api/approval-threads/${encodeURIComponent(approvalThreadId)}/replies`
    );
    return response.approvalReplies;
  },

  async listApprovalMessages(): Promise<ListApprovalMessagesResponse["messages"]> {
    const response = await request<ListApprovalMessagesResponse>("/api/approval-messages");
    return response.messages;
  },

  async approveApprovalRequest(approvalRequestId: string, comment?: string): Promise<ApprovalRequestResponse> {
    return request<ApprovalRequestResponse>(`/api/approval-requests/${encodeURIComponent(approvalRequestId)}/approve`, {
      method: "POST",
      body: JSON.stringify({ comment })
    });
  },

  async rejectApprovalRequest(approvalRequestId: string, comment?: string): Promise<ApprovalRequestResponse> {
    return request<ApprovalRequestResponse>(`/api/approval-requests/${encodeURIComponent(approvalRequestId)}/reject`, {
      method: "POST",
      body: JSON.stringify({ comment })
    });
  },

  async replyToApprovalRequest(
    approvalRequestId: string,
    message: string
  ): Promise<ApprovalRequestResponse> {
    return request<ApprovalRequestResponse>(`/api/approval-requests/${encodeURIComponent(approvalRequestId)}/reply`, {
      method: "POST",
      body: JSON.stringify({ message } satisfies ReplyApprovalRequestRequest)
    });
  },

  async returnForRevisionApprovalRequest(approvalRequestId: string, message: string): Promise<ApprovalRequestResponse> {
    return request<ApprovalRequestResponse>(`/api/approval-requests/${encodeURIComponent(approvalRequestId)}/return-for-revision`, {
      method: "POST",
      body: JSON.stringify({ message })
    });
  },

  async completeApprovalRequest(approvalRequestId: string, comment?: string): Promise<ApprovalRequestResponse> {
    return request<ApprovalRequestResponse>(`/api/approval-requests/${encodeURIComponent(approvalRequestId)}/complete`, {
      method: "POST",
      body: JSON.stringify({ comment })
    });
  },

  async terminateApprovalRequest(approvalRequestId: string, comment?: string): Promise<ApprovalRequestResponse> {
    return request<ApprovalRequestResponse>(`/api/approval-requests/${encodeURIComponent(approvalRequestId)}/terminate`, {
      method: "POST",
      body: JSON.stringify({ comment })
    });
  },

  async getRoleDirectory(): Promise<RoleDirectoryResponse> {
    return request<RoleDirectoryResponse>("/api/roles");
  },

  async saveArchitectureLayout(
    positions: SaveArchitectureBlueprintLayoutRequest["positions"]
  ): Promise<RoleDirectoryResponse> {
    return request<RoleDirectoryResponse>("/api/roles/architecture-layout", {
      method: "PUT",
      body: JSON.stringify({ positions } satisfies SaveArchitectureBlueprintLayoutRequest)
    });
  },

  async listInboxProjections(): Promise<InboxProjection[]> {
    const response = await request<ListInboxProjectionsResponse>("/api/inbox-projections");
    return response.projections;
  },

  async listHumanActionResponses(requestId: string): Promise<HumanActionResponse[]> {
    const response = await request<ListHumanActionResponsesResponse>(
      `/api/human-action-requests/${encodeURIComponent(requestId)}/responses`
    );
    return response.responses;
  },

  async sendHumanActionResponse(
    requestId: string,
    input: CreateHumanActionResponseRequest
  ): Promise<{ response: HumanActionResponse; projections: InboxProjection[] }> {
    return request<{ response: HumanActionResponse; projections: InboxProjection[] }>(
      `/api/human-action-requests/${encodeURIComponent(requestId)}/responses`,
      {
        method: "POST",
        body: JSON.stringify(input satisfies CreateHumanActionResponseRequest)
      }
    );
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

function consumeRunRoomOutputStreamBuffer(buffer: string, handlers: RunRoomOutputStreamHandlers): string {
  const frames = buffer.split(/\n\n/);
  const remainder = frames.pop() ?? "";
  for (const frame of frames) {
    const event = readRunRoomOutputStreamFrame(frame);
    if (event) handlers.onEvent(event);
  }
  return remainder;
}

function readChatStreamFrame(frame: string): AgentOutputEvent | undefined {
  const data = frame
    .split(/\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  if (!data) return undefined;
  return JSON.parse(data) as AgentOutputEvent;
}

function readRunRoomOutputStreamFrame(frame: string): RunRoomOutputStreamEvent | undefined {
  const data = frame
    .split(/\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  if (!data) return undefined;
  return JSON.parse(data) as RunRoomOutputStreamEvent;
}
