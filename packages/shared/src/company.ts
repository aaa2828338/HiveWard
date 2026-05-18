export interface CompanyProfile {
  id: string;
  name: string;
  logoUrl?: string;
  logoLabel?: string;
  businessGoal: string;
  createdAt: string;
  updatedAt: string;
}

export interface CompanyOverview extends CompanyProfile {
  workflowCount: number;
  runCount: number;
  totalTokens: number;
  totalCostUsd: number;
  dashboardWidgetCount: number;
  savedViewCount: number;
  noteCount: number;
  activeApprovalCount: number;
  latestRunAt?: string;
}

export const defaultCompanyId = "company-openclaw-studio";

export function createDefaultCompanies(now: string): CompanyProfile[] {
  return [
    {
      id: defaultCompanyId,
      name: "OpenClaw Studio",
      logoLabel: "OC",
      businessGoal: "Embed OpenClaw into a company-owned orchestration surface with reviewable workflow logic and visible runtime evidence.",
      createdAt: now,
      updatedAt: now
    }
  ];
}
