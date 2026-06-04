export type DashboardWidgetType =
  | "pending_approvals"
  | "runtime_overview"
  | "catalog_status"
  | "notes";

export interface DashboardWidgetLayout {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DashboardWidget {
  id: string;
  type: DashboardWidgetType;
  title: string;
  layout: DashboardWidgetLayout;
  config?: Record<string, unknown>;
}

export interface SavedView {
  id: string;
  name: string;
  blueprintId?: string;
  filters: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceTag {
  id: string;
  label: string;
  color?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceNote {
  id: string;
  title: string;
  body: string;
  relatedBlueprintId?: string;
  relatedRunId?: string;
  tagIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface PendingApprovalItem {
  approvalRequestId?: string;
  approvalThreadId?: string;
  kind?: string;
  discussion?: PendingApprovalDiscussionCapabilities;
  blueprintId: string;
  blueprintName: string;
  blueprintRunId: string;
  nodeRunId: string;
  nodeId: string;
  nodeLabel: string;
  harnessId?: string;
  startedBy: string;
  startedAt: string;
  requestedAt: string;
  reviewOutput?: unknown;
  replies?: PendingApprovalReply[];
  status?: "pending" | "replying" | "approved" | "rejected" | "replied" | "completed" | "terminated" | "superseded";
  decidedAt?: string;
  decisionComment?: string;
  canApprove?: boolean;
  canReply?: boolean;
  canReject?: boolean;
  canComplete?: boolean;
  canTerminate?: boolean;
  canReturnForRevision?: boolean;
  upstream?: PendingApprovalUpstreamItem[];
}

export interface PendingApprovalDiscussionCapabilities {
  mode: "none" | "message_only" | "executor";
  canStreamReply: boolean;
  reason?: string;
  executorKind?:
    | "agent_approval"
    | "requirement_agent"
    | "requirement_manager"
    | "release_report_manager"
    | "function_manager"
    | "function_summary";
}

export interface PendingApprovalReply {
  id: string;
  role: "assistant" | "user";
  purpose?: "message";
  body: string;
  createdAt: string;
}

export interface PendingApprovalUpstreamItem {
  nodeId: string;
  nodeLabel: string;
  nodeRunId: string;
  output: unknown;
}

export interface WorkspaceDashboard {
  dashboardWidgets: DashboardWidget[];
  savedViews: SavedView[];
  tags: WorkspaceTag[];
  notes: WorkspaceNote[];
  updatedAt: string;
}

export function createDefaultWorkspaceDashboard(now: string): WorkspaceDashboard {
  return {
    dashboardWidgets: [],
    savedViews: [],
    tags: [],
    notes: [],
    updatedAt: now
  };
}

export function normalizeWorkspaceDashboard(
  value: Partial<WorkspaceDashboard> | undefined,
  now: string
): WorkspaceDashboard {
  return {
    dashboardWidgets: Array.isArray(value?.dashboardWidgets) ? value.dashboardWidgets : [],
    savedViews: Array.isArray(value?.savedViews) ? value.savedViews : [],
    tags: Array.isArray(value?.tags) ? value.tags : [],
    notes: Array.isArray(value?.notes) ? value.notes : [],
    updatedAt: typeof value?.updatedAt === "string" && value.updatedAt ? value.updatedAt : now
  };
}
