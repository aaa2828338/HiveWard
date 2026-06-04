import type { BlueprintRunStatus } from "./blueprint";

export type CompanyRoleKind = "ceo" | "leader";

export type RoleDriverHarnessId = "openclaw" | "codex" | "claude" | "google" | "cursor" | "opencode" | "hermes";

export type RoleCapability =
  | "read_company"
  | "read_blueprint"
  | "discuss"
  | "delegate_leader"
  | "create_blueprint_proposal";

export interface CompanyRoleProfile {
  id: string;
  companyId: string;
  kind: CompanyRoleKind;
  label: string;
  description?: string;
  blueprintId?: string;
  defaultDriverBindingId?: string;
  capabilities: RoleCapability[];
  instructions?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RoleDriverBinding {
  id: string;
  companyId: string;
  roleId: string;
  harnessId: RoleDriverHarnessId;
  label: string;
  agentId?: string;
  modelId?: string;
  workspacePath?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CompanyRoleDirectory {
  companyId: string;
  ceo: CompanyRoleProfile;
  leaders: CompanyRoleProfile[];
  driverBindings: RoleDriverBinding[];
  architecturePositions?: Record<string, ArchitectureBlueprintNode["position"]>;
  updatedAt: string;
}

export interface ArchitectureBlueprintNode {
  id: string;
  roleId: string;
  kind: CompanyRoleKind;
  label: string;
  blueprintId?: string;
  blueprintName?: string;
  pendingApprovalCount: number;
  latestRunStatus?: BlueprintRunStatus;
  latestRunAt?: string;
  lastImportAt?: string;
  lastReportAt?: string;
  position: {
    x: number;
    y: number;
  };
}

export interface ArchitectureBlueprintEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}

export interface ArchitectureBlueprintView {
  companyId: string;
  rootRoleId: string;
  nodes: ArchitectureBlueprintNode[];
  edges: ArchitectureBlueprintEdge[];
  updatedAt: string;
}

export interface ChatRoleScope {
  companyId?: string;
  role: CompanyRoleKind;
  leaderId?: string;
  blueprintId?: string;
}
