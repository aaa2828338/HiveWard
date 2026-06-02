import type { AgentPermissionProfile, RuntimeAccessPolicy, RuntimeAccessPolicyRuntime } from "@hiveward/shared";
import { normalizeRuntimeAccessPolicy, unsupportedRuntimeAccessPolicyChanges } from "@hiveward/shared";
import type { PermissionMode } from "@anthropic-ai/claude-agent-sdk";
import type { SandboxMode } from "@openai/codex-sdk";

const claudeReadTools = ["Read", "Glob", "Grep", "LS"];
const claudeWriteTools = ["Edit", "Write", "MultiEdit"];
const claudeCommandTools = ["Bash(npm test:*)", "Bash(npm run:*)"];

export function normalizePermissionProfile(value: unknown): AgentPermissionProfile {
  return value === "workspace_write" ? "workspace_write" : "read_only";
}

export function normalizeTaskRuntimeAccessPolicy(input: {
  runtimeAccessPolicy?: Partial<RuntimeAccessPolicy>;
  permissionProfile?: AgentPermissionProfile;
}, runtime?: RuntimeAccessPolicyRuntime): RuntimeAccessPolicy {
  const legacyPermissionProfile = input.runtimeAccessPolicy?.filesystem === undefined
    ? input.permissionProfile
    : undefined;
  const policy = normalizeRuntimeAccessPolicy(input.runtimeAccessPolicy, legacyPermissionProfile);
  const unsupported = runtime ? unsupportedRuntimeAccessPolicyChanges(runtime, policy) : [];
  if (runtime && unsupported.length > 0) {
    throw new Error(`Runtime ${runtime} does not support requested access policy axes: ${unsupported.join(", ")}.`);
  }
  return policy;
}

export function mapClaudePermission(profile: AgentPermissionProfile): PermissionMode {
  return profile === "workspace_write" ? "acceptEdits" : "dontAsk";
}

export function mapClaudeTools(profile: AgentPermissionProfile, tools: string[]): string[] {
  if (profile === "read_only") {
    return [...claudeReadTools];
  }

  const mapped = [...claudeReadTools, ...claudeWriteTools];
  if (tools.includes("repo.test")) {
    mapped.push(...claudeCommandTools);
  }
  return mapped;
}

export function mapClaudeAvailableTools(profile: AgentPermissionProfile, tools: string[]): string[] {
  return mapClaudeTools(profile, tools);
}

export function mapCodexSandbox(profile: AgentPermissionProfile): SandboxMode {
  return profile === "workspace_write" ? "workspace-write" : "read-only";
}
