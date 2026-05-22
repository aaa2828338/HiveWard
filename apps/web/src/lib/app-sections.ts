export type AppNavSectionId =
  | "company"
  | "chat"
  | "blueprint"
  | "runs"
  | "approvals"
  | "models"
  | "agents"
  | "skills"
  | "schedule"
  | "channels"
  | "openclaw"
  | "claudeCodeConfig"
  | "codexConfig";

export type AppSectionId = AppNavSectionId | "companyDirectory" | "hivewardHome";

export type AppSystemId = "hiveward" | "openclaw" | "claudeCode" | "codex";

export type AppSectionGroup = {
  id: AppSystemId;
  sections: AppNavSectionId[];
};

export const appSectionGroups = [
  {
    id: "hiveward",
    sections: ["company", "chat", "blueprint", "runs", "approvals", "schedule"]
  },
  {
    id: "openclaw",
    sections: ["openclaw", "models", "agents", "skills", "channels"]
  },
  {
    id: "claudeCode",
    sections: ["claudeCodeConfig"]
  },
  {
    id: "codex",
    sections: ["codexConfig"]
  }
] satisfies AppSectionGroup[];
