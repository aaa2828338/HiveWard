import type { CompanyRoleKind } from "./roles";

export interface HivewardRoleSkillIdentity {
  role: CompanyRoleKind;
  companyId?: string;
  roleId?: string;
  roleLabel?: string;
  blueprintId?: string;
  skillFilePath?: string;
}

export function buildHivewardRoleSkillPrompt(identity: HivewardRoleSkillIdentity): string {
  return [
    buildHivewardRoleIdentityPrompt(identity),
    "",
    "Installed external skill:",
    `- name: ${identity.role === "leader" ? "hiveward-leader" : "hiveward-ceo"}`,
    "- Use this installed skill for HiveWard platform work. For simple greetings or identity questions, answer directly without reading files, calling tools, or inspecting platform records.",
    "- Load the skill file only when the task needs HiveWard records, blueprint logic, run history, approvals, or troubleshooting. HiveWard does not replace your native harness memory, tools, or personality.",
    "",
    "Compact fallback if the file is not readable:",
    "- HiveWard supplies the job identity and governance boundary only; the external harness supplies reasoning, memory, tools, and execution.",
    "- CEO and Leader are permanent role seats. Manager and Worker are blueprint nodes, not permanent company roles.",
    "- CEO owns company-wide understanding across all Leaders and blueprints.",
    "- Leader owns exactly one bound business blueprint and its runs, errors, proposals, and reports.",
    "- Business blueprints are executable workflow DAGs. Architecture blueprint is the company management view.",
    "- Runs, node runs, events, final results, usage, and errors are stored in HiveWard run records.",
    "- Chat has no implicit side effects. Formal changes go through HiveWard inbox approval and backend validation."
  ].filter((line): line is string => typeof line === "string").join("\n");
}

export function buildHivewardRoleIdentityPrompt(identity: HivewardRoleSkillIdentity): string {
  const roleLabel = identity.roleLabel ?? (identity.role === "leader" ? "Blueprint Leader" : "CEO");
  const roleId = identity.roleId ?? (identity.role === "leader" ? "leader" : "ceo");
  if (identity.role === "leader") {
    return [
      "HiveWard appointment:",
      `You are the external harness agent powering the HiveWard role seat "${roleLabel}" (${roleId}).`,
      `You are on duty as the Blueprint Leader${identity.blueprintId ? ` for blueprint ${identity.blueprintId}` : ""}${identity.companyId ? ` in company ${identity.companyId}` : ""}.`
    ].join("\n");
  }

  return [
    "HiveWard appointment:",
    `You are the external harness agent powering the HiveWard role seat "${roleLabel}" (${roleId}).`,
    `You are on duty as the Company CEO${identity.companyId ? ` for company ${identity.companyId}` : ""}.`
  ].join("\n");
}
