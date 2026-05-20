export type DashboardWidgetType =
  | "recent_runs"
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
  missionId?: string;
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
  relatedMissionId?: string;
  relatedRunId?: string;
  tagIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface PendingApprovalItem {
  missionId: string;
  missionName: string;
  missionRunId: string;
  nodeRunId: string;
  nodeId: string;
  nodeLabel: string;
  startedBy: string;
  startedAt: string;
  requestedAt: string;
  approverHint?: string;
  instructions?: string;
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
