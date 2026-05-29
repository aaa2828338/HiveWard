import { runtimeAccessPolicySupportByRuntime } from "@hiveward/shared";
import type {
  AgentNodeConfig,
  AgentPermissionProfile,
  AgentRuntimeId,
  BlueprintDefinition,
  BlueprintNode,
  ChatPermissionMode,
  HarnessId,
  ManagerNodeConfig,
  RuntimeAccessPolicy,
  SummaryNodeConfig
} from "@hiveward/shared";

export function runtimeHarnessId(runtimeId: AgentRuntimeId): HarnessId {
  return runtimeId === "claude" ? "claudeCode" : runtimeId;
}

export function permissionProfileForHarnessMode(permissionMode: ChatPermissionMode): AgentPermissionProfile {
  return permissionMode === "full_access" ? "workspace_write" : "read_only";
}

export function resolveRuntimeHarnessPermissionMode(
  runtimeId: AgentRuntimeId,
  harnessPermissionModes: Partial<Record<HarnessId, ChatPermissionMode>> | undefined
): ChatPermissionMode | undefined {
  if (runtimeId === "openclaw") return undefined;
  return harnessPermissionModes?.[runtimeHarnessId(runtimeId)];
}

export function resolveRuntimePermissionProfile(
  runtimeId: AgentRuntimeId,
  harnessPermissionModes: Partial<Record<HarnessId, ChatPermissionMode>> | undefined,
  fallback: AgentPermissionProfile = "read_only"
): AgentPermissionProfile {
  const permissionMode = resolveRuntimeHarnessPermissionMode(runtimeId, harnessPermissionModes);
  return permissionMode ? permissionProfileForHarnessMode(permissionMode) : fallback;
}

export function runtimeAccessPolicyForHarnessPermissionMode(
  runtimeId: AgentRuntimeId,
  permissionMode: ChatPermissionMode
): RuntimeAccessPolicy {
  const support = runtimeAccessPolicySupportByRuntime[runtimeId];
  if (permissionMode === "full_access") {
    return {
      filesystem: "workspace_write",
      network: "enabled",
      webSearch: support.webSearch === "unsupported" ? "disabled" : "live"
    };
  }
  return {
    filesystem: "read_only",
    network: support.network === "unsupported" ? "enabled" : "disabled",
    webSearch: "disabled"
  };
}

export function applyHarnessPermissionModesToBlueprint(
  blueprint: BlueprintDefinition,
  harnessPermissionModes: Partial<Record<HarnessId, ChatPermissionMode>> | undefined
): BlueprintDefinition {
  let changed = false;
  const nodes = blueprint.nodes.map((node) => {
    const patch = resolveNodePermissionPatch(node, harnessPermissionModes);
    if (!patch) return node;
    changed = true;
    return {
      ...node,
      config: {
        ...node.config,
        ...patch
      } as BlueprintNode["config"]
    };
  });

  return changed ? { ...blueprint, nodes } : blueprint;
}

function resolveNodePermissionPatch(
  node: BlueprintNode,
  harnessPermissionModes: Partial<Record<HarnessId, ChatPermissionMode>> | undefined
): Partial<AgentNodeConfig & ManagerNodeConfig & SummaryNodeConfig> | undefined {
  const runtimeId = readNodeRuntimeId(node);
  if (!runtimeId) return undefined;
  const permissionMode = resolveRuntimeHarnessPermissionMode(runtimeId, harnessPermissionModes);
  if (!permissionMode) return undefined;

  const runtimeAccessPolicy = runtimeAccessPolicyForHarnessPermissionMode(runtimeId, permissionMode);
  if (node.type === "summary") {
    const config = node.config as SummaryNodeConfig;
    return runtimeAccessPoliciesEqual(config.runtimeAccessPolicy, runtimeAccessPolicy)
      ? undefined
      : { runtimeAccessPolicy };
  }

  const config = node.config as AgentNodeConfig | ManagerNodeConfig;
  const permissionProfile = permissionProfileForHarnessMode(permissionMode);
  if (
    config.permissionProfile === permissionProfile &&
    runtimeAccessPoliciesEqual(config.runtimeAccessPolicy, runtimeAccessPolicy)
  ) {
    return undefined;
  }
  return { permissionProfile, runtimeAccessPolicy };
}

function readNodeRuntimeId(node: BlueprintNode): AgentRuntimeId | undefined {
  if (node.type === "agent" || node.type === "manager") return node.runtimeId ?? "openclaw";
  if (node.type !== "summary") return undefined;
  const config = node.config as SummaryNodeConfig;
  return config.mode === "harness_summary" ? config.runtimeId ?? "openclaw" : undefined;
}

function runtimeAccessPoliciesEqual(
  current: RuntimeAccessPolicy | undefined,
  next: RuntimeAccessPolicy
): boolean {
  return current?.filesystem === next.filesystem &&
    current.network === next.network &&
    current.webSearch === next.webSearch;
}
