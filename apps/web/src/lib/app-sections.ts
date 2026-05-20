export type AppSectionId =
  | "company"
  | "blueprint"
  | "runs"
  | "approvals"
  | "models"
  | "agents"
  | "schedule"
  | "channels"
  | "openclaw";

export const appSections: Array<Exclude<AppSectionId, "company" | "openclaw">> = [
  "blueprint",
  "runs",
  "approvals",
  "models",
  "agents",
  "schedule",
  "channels"
];
