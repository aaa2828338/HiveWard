import type { CatalogSnapshot } from "./catalog";
import type { CompanyOverview } from "./company";
import type {
  OpenClawConfigState,
  OpenClawModelUsageSummary,
  OpenClawSessionSummary,
  OpenClawTaskSummary,
  OpenClawVersionInfo
} from "./openclaw";
import type { PortableBlueprintPackage, BlueprintDefinition, BlueprintRunSummary, BlueprintRunView } from "./blueprint";
import type { PendingApprovalItem, WorkspaceDashboard } from "./workspace";

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
