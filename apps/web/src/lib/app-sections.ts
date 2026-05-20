export type AppSectionId =
  | "company"
  | "mission"
  | "runs"
  | "approvals"
  | "models"
  | "agents"
  | "schedule"
  | "channels"
  | "openclaw";

export const appSections: Array<Exclude<AppSectionId, "company" | "openclaw">> = [
  "mission",
  "runs",
  "approvals",
  "models",
  "agents",
  "schedule",
  "channels"
];
