import type { CatalogSnapshot } from "./catalog";
import type { CompanyOverview } from "./company";
import type {
  OpenClawExecutionStatus,
  OpenClawConfigState,
  OpenClawModelUsageSummary,
  OpenClawObjectSource,
  OpenClawSessionSummary,
  ChatThinkingEffort,
  OpenClawTaskSummary,
  OpenClawUsageFact,
  OpenClawVersionInfo
} from "./openclaw";
import type { PortableBlueprintPackage, BlueprintDefinition, BlueprintRunSummary, BlueprintRunView } from "./blueprint";
import type { PendingApprovalItem, InboxItem, WorkspaceDashboard } from "./workspace";
import type { ArchitectureBlueprintView, ChatRoleScope, CompanyRoleDirectory } from "./roles";

export interface ListBlueprintsResponse {
  blueprints: BlueprintDefinition[];
}

export interface CreateBlueprintRequest {
  name?: string;
  description?: string;
}

export interface BlueprintResponse {
  blueprint: BlueprintDefinition;
}

export interface DeleteBlueprintResponse {
  blueprintId: string;
}

export interface SaveBlueprintRequest {
  blueprint: BlueprintDefinition;
}

export interface ExportBlueprintResponse {
  blueprintPackage: PortableBlueprintPackage;
}

export interface ImportBlueprintPackageRequest {
  blueprintPackage: PortableBlueprintPackage;
}

export interface ImportBlueprintPackageResponse {
  blueprints: BlueprintDefinition[];
}

export interface StartBlueprintRunRequest {
  startedBy?: string;
}

export interface StartBlueprintRunResponse {
  run: BlueprintRunView;
}

export interface LatestBlueprintRunResponse {
  run: BlueprintRunView | null;
}

export interface BlueprintRunResponse {
  run: BlueprintRunView;
}

export interface ListBlueprintRunSummariesResponse {
  runs: BlueprintRunSummary[];
}

export interface ListPendingApprovalsResponse {
  approvals: PendingApprovalItem[];
}

export interface RoleDirectoryResponse {
  roles: CompanyRoleDirectory;
  architecture: ArchitectureBlueprintView;
}

export interface ListInboxItemsResponse {
  items: InboxItem[];
}

export interface CreateLeaderDelegationRequest {
  leaderId: string;
  blueprintId?: string;
  title?: string;
  summary?: string;
  createdByRoleId?: string;
}

export interface CreateBlueprintProposalRequest {
  title: string;
  summary: string;
  blueprintId?: string;
  blueprintPackage: PortableBlueprintPackage;
  preview?: Record<string, unknown>;
  diffSummary?: string;
  createdByRoleId?: string;
  targetRoleId?: string;
}

export interface InboxItemResponse {
  item: InboxItem;
}

export interface ApproveInboxItemRequest {
  comment?: string;
}

export interface RejectInboxItemRequest {
  comment?: string;
}

export interface ApproveInboxItemResponse {
  item: InboxItem;
  importedBlueprints?: BlueprintDefinition[];
}

export interface ApproveBlueprintRunRequest {
  nodeRunId?: string;
}

export interface DashboardStateResponse {
  dashboard: WorkspaceDashboard;
}

export interface SaveDashboardStateRequest {
  dashboard: WorkspaceDashboard;
}

export interface CompanyDirectoryResponse {
  companies: CompanyOverview[];
  selectedCompanyId?: string;
}

export interface CreateCompanyRequest {
  name: string;
  businessGoal?: string;
  logoLabel?: string;
  logoUrl?: string;
}

export interface SelectCompanyRequest {
  companyId?: string;
}

export interface DeleteCompanyResponse extends CompanyDirectoryResponse {
  deleted: boolean;
}

export type HarnessId = "openclaw" | "claudeCode" | "codex";

export type HarnessConnectionState = "connected" | "available" | "needs_config" | "unavailable";

export interface HarnessStatusCheck {
  id: string;
  label: string;
  status: "pass" | "warning" | "fail";
  detail: string;
}

export interface HarnessStatus {
  id: HarnessId;
  label: string;
  defaultModelId?: string;
  installed: boolean;
  environmentOk: boolean;
  connectionState: HarnessConnectionState;
  summary: string;
  checkedAt: string;
  checks: HarnessStatusCheck[];
}

export interface HarnessStatusResponse {
  statuses: HarnessStatus[];
}

export type HarnessSkillId = "hiveward-ceo" | "hiveward-leader";

export type HarnessSkillInstallStatus = "installed" | "missing" | "stale" | "unsupported" | "error";

export interface HarnessSkillStatusItem {
  id: HarnessSkillId;
  label: string;
  sourcePath: string;
  targetPath?: string;
  installed: boolean;
  status: HarnessSkillInstallStatus;
  sourceHash?: string;
  installedHash?: string;
  error?: string;
}

export interface HarnessSkillStatusResponse {
  harnessId: HarnessId;
  supported: boolean;
  checkedAt: string;
  installRoot?: string;
  skills: HarnessSkillStatusItem[];
}

export interface InstallHarnessSkillsResponse extends HarnessSkillStatusResponse {
  installedCount: number;
}

export interface ChatAttachment {
  id: string;
  name: string;
  mediaType: string;
  size: number;
  text?: string;
  truncated?: boolean;
}

export interface ChatHistoryMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  attachments?: ChatAttachment[];
}

export interface SendChatMessageRequest {
  harnessId: HarnessId;
  message: string;
  attachments?: ChatAttachment[];
  modelId?: string;
  agentId?: string;
  nativeSessionKey?: string;
  thinkingEffort?: ChatThinkingEffort;
  includePlatformContext?: boolean;
  mode?: "chat" | "blueprint";
  roleScope?: ChatRoleScope;
}

export interface CreateChatSessionRequest {
  agentId?: string;
  parentSessionKey?: string;
  roleScope?: ChatRoleScope;
}

export interface CreateChatSessionResponse {
  sessionKey: string;
  sessionId?: string;
  title?: string;
}

export interface UpdateChatSessionTitleRequest {
  sessionKey: string;
  title: string;
}

export interface UpdateChatSessionTitleResponse {
  sessionKey: string;
  title: string;
}

export interface ChatStreamTimings {
  totalMs: number;
  hivewardPreprocessMs: number;
  openclawMs: number;
  hivewardPostprocessMs: number;
  inboxSubmissionMs?: number;
  openclawAcceptedMs?: number;
  openclawFirstDeltaMs?: number;
}

export type ChatStreamEvent =
  | {
      type: "started";
      taskId: string;
      runId: string;
      sessionKey: string;
      source: OpenClawObjectSource;
      status: OpenClawExecutionStatus;
      updatedAt: string;
    }
  | {
      type: "delta";
      text: string;
      replace?: boolean;
    }
  | {
      type: "done";
      taskId: string;
      runId: string;
      sessionKey: string;
      source: OpenClawObjectSource;
      status: OpenClawExecutionStatus;
      output?: string;
      error?: string;
      usage?: OpenClawUsageFact;
      timings?: ChatStreamTimings;
      updatedAt: string;
    }
  | {
      type: "inbox_item_created";
      item: InboxItem;
      message: string;
    }
  | {
      type: "error";
      message: string;
    };

export interface ChatSessionHistoryResponse {
  messages: ChatHistoryMessage[];
  inboxItems?: InboxItem[];
}

export interface OpenClawConfigResponse {
  config: OpenClawConfigState;
}

export type OpenClawWizardValue = string | number | boolean | undefined;

export interface OpenClawWizardFieldOption {
  value: string;
  label: string;
  hint?: string;
}

export interface OpenClawWizardFieldVisibility {
  fieldId: string;
  equals: OpenClawWizardValue;
}

export interface OpenClawWizardField {
  id: string;
  label: string;
  type: "text" | "password" | "number" | "select" | "checkbox";
  required?: boolean;
  placeholder?: string;
  hint?: string;
  defaultValue?: OpenClawWizardValue;
  options?: OpenClawWizardFieldOption[];
  visibleWhen?: OpenClawWizardFieldVisibility;
}

export interface OpenClawModelAuthMethodOption {
  id: string;
  label: string;
  hint?: string;
  kind: "api_key" | "oauth" | "device_code" | "token" | "local" | "custom";
  choiceId?: string;
  fields: OpenClawWizardField[];
  submitLabel?: string;
}

export interface OpenClawModelAuthProviderOption {
  id: string;
  label: string;
  hint?: string;
  methods: OpenClawModelAuthMethodOption[];
}

export interface OpenClawChannelSetupOption {
  id: string;
  label: string;
  hint?: string;
  fields: OpenClawWizardField[];
}

export interface OpenClawConfigWizardMetadata {
  modelProviders: OpenClawModelAuthProviderOption[];
  channels: OpenClawChannelSetupOption[];
}

export interface OpenClawConfigWizardResponse {
  wizard: OpenClawConfigWizardMetadata;
}

export interface OpenClawVersionResponse {
  version: OpenClawVersionInfo;
}

export interface ConfigureOpenClawModelAuthRequest {
  providerId: string;
  methodId: string;
  values: Record<string, OpenClawWizardValue>;
}

export interface ConfigureOpenClawChannelRequest {
  channelId: string;
  values: Record<string, OpenClawWizardValue>;
}

export interface UpdateOpenClawDefaultModelRequest {
  modelId: string;
}

export interface CreateOpenClawModelRequest {
  provider: string;
  modelId: string;
  label?: string;
  alias?: string;
  api?: string;
  baseUrl?: string;
  apiKeyEnv?: string;
  apiKey?: string;
  contextWindow?: number;
  maxTokens?: number;
  setDefault?: boolean;
}

export interface CreateOpenClawAgentRequest {
  name: string;
  workspace?: string;
  modelId?: string;
}

export interface CreateOpenClawChannelRequest {
  channel: string;
  account?: string;
  name?: string;
  useEnv?: boolean;
  token?: string;
  botToken?: string;
  appToken?: string;
  password?: string;
  secret?: string;
  url?: string;
  baseUrl?: string;
  dbPath?: string;
  httpHost?: string;
  httpPort?: string;
  httpUrl?: string;
  cliPath?: string;
  authDir?: string;
  region?: string;
  service?: string;
  signalNumber?: string;
  tokenFile?: string;
  secretFile?: string;
}

export interface RuntimeOverview {
  sessions: OpenClawSessionSummary[];
  tasks: OpenClawTaskSummary[];
}

export interface RuntimeOverviewResponse {
  runtime: RuntimeOverview;
}

export interface OpenClawModelUsageResponse {
  usage: OpenClawModelUsageSummary[];
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
