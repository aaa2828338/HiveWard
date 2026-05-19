export type AppSectionId =
  | "company"
  | "workflow"
  | "runs"
  | "approvals"
  | "models"
  | "agents"
  | "schedule"
  | "channels";

export const appSections: Array<Exclude<AppSectionId, "company">> = [
  "workflow",
  "runs",
  "approvals",
  "models",
  "agents",
  "schedule",
  "channels"
];
