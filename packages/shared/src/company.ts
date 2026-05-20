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
  missionCount: number;
  runCount: number;
  totalTokens: number;
  totalCostUsd: number;
  dashboardWidgetCount: number;
  savedViewCount: number;
  noteCount: number;
  activeApprovalCount: number;
  latestRunAt?: string;
}

export const defaultCompanyId = "company-hiveward-studio";

export function createDefaultCompanies(now: string): CompanyProfile[] {
  return [
    {
      id: defaultCompanyId,
      name: "Hiveward Studio",
      logoLabel: "HW",
      logoUrl: "/brand/hiveward-hive.png",
      businessGoal:
        "Command autonomous agent teams through structured missions, governed handoffs, review gates, and auditable runs.",
      createdAt: now,
      updatedAt: now
    }
  ];
}
