export type AppSectionId =
  | "company"
  | "workflow"
  | "runs"
  | "approvals"
  | "models"
  | "agents"
  | "schedule"
  | "channels"
  | "openclaw";

export const appSections: Array<Exclude<AppSectionId, "company" | "openclaw">> = [
  "workflow",
  "runs",
  "approvals",
  "models",
  "agents",
  "schedule",
  "channels"
];
