export type AppSectionId =
  | "company"
  | "workflow"
  | "runs"
  | "approvals"
  | "dashboard"
  | "views"
  | "notes"
  | "catalog";

export const appSections: Array<Exclude<AppSectionId, "company">> = [
  "workflow",
  "runs",
  "approvals",
  "dashboard",
  "views",
  "notes",
  "catalog"
];
