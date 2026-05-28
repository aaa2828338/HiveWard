import type { AgentRuntimeId, HarnessId } from "@hiveward/shared";

export type HarnessDisplayParts = {
  label: string;
  badgeLabel?: string;
};

const betaBadgeLabel = "Beta";

const betaHarnessIds = new Set<HarnessId>(["google", "cursor", "opencode", "hermes"]);

const harnessDisplayBaseLabels = {
  openclaw: "OpenClaw",
  claudeCode: "Claude Code",
  codex: "Codex",
  google: "Google CLI",
  cursor: "Cursor CLI",
  opencode: "OpenCode",
  hermes: "Hermes"
} satisfies Record<HarnessId, string>;

export const harnessDisplayLabels = {
  openclaw: harnessDisplayBaseLabels.openclaw,
  claudeCode: harnessDisplayBaseLabels.claudeCode,
  codex: harnessDisplayBaseLabels.codex,
  google: `${harnessDisplayBaseLabels.google} ${betaBadgeLabel}`,
  cursor: `${harnessDisplayBaseLabels.cursor} ${betaBadgeLabel}`,
  opencode: `${harnessDisplayBaseLabels.opencode} ${betaBadgeLabel}`,
  hermes: `${harnessDisplayBaseLabels.hermes} ${betaBadgeLabel}`
} satisfies Record<HarnessId, string>;

export function harnessDisplayLabel(harnessId: HarnessId): string {
  return harnessDisplayLabels[harnessId];
}

export function harnessDisplayParts(harnessId: HarnessId): HarnessDisplayParts {
  const label = harnessDisplayBaseLabels[harnessId];
  return betaHarnessIds.has(harnessId) ? { label, badgeLabel: betaBadgeLabel } : { label };
}

export function runtimeDisplayLabel(runtimeId: AgentRuntimeId): string {
  return runtimeId === "claude" ? harnessDisplayLabel("claudeCode") : harnessDisplayLabel(runtimeId);
}

export function runtimeDisplayParts(runtimeId: AgentRuntimeId): HarnessDisplayParts {
  return runtimeId === "claude" ? harnessDisplayParts("claudeCode") : harnessDisplayParts(runtimeId);
}

export function harnessLikeDisplayLabel(harnessId: string | undefined): string {
  if (harnessId === "claude") return harnessDisplayLabel("claudeCode");
  if (isHarnessId(harnessId)) return harnessDisplayLabel(harnessId);
  return harnessDisplayLabel("openclaw");
}

export function harnessLikeDisplayParts(harnessId: string | undefined): HarnessDisplayParts {
  if (harnessId === "claude") return harnessDisplayParts("claudeCode");
  if (isHarnessId(harnessId)) return harnessDisplayParts(harnessId);
  return harnessDisplayParts("openclaw");
}

export function isHarnessId(value: unknown): value is HarnessId {
  return typeof value === "string" && value in harnessDisplayLabels;
}
