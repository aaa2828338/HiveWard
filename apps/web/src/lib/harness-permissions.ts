import type {
  AgentNodeConfig,
  AgentPermissionProfile,
  AgentRuntimeId,
  BlueprintDefinition,
  BlueprintNode,
  ChatPermissionMode,
  HarnessId,
  ManagerNodeConfig
} from "@hiveward/shared";

export function runtimeHarnessId(runtimeId: AgentRuntimeId): HarnessId {
  return runtimeId === "claude" ? "claudeCode" : runtimeId;
}

export function permissionProfileForHarnessMode(permissionMode: ChatPermissionMode): AgentPermissionProfile {
  return permissionMode === "full_access" ? "workspace_write" : "read_only";
}

export function resolveRuntimePermissionProfile(
  runtimeId: AgentRuntimeId,
  harnessPermissionModes: Partial<Record<HarnessId, ChatPermissionMode>> | undefined,
  fallback: AgentPermissionProfile = "read_only"
): AgentPermissionProfile {
  if (runtimeId === "openclaw") return fallback;
  const permissionMode = harnessPermissionModes?.[runtimeHarnessId(runtimeId)];
  return permissionMode ? permissionProfileForHarnessMode(permissionMode) : fallback;
}

export function applyHarnessPermissionModesToBlueprint(
  blueprint: BlueprintDefinition,
  harnessPermissionModes: Partial<Record<HarnessId, ChatPermissionMode>> | undefined
): BlueprintDefinition {
  let changed = false;
  const nodes = blueprint.nodes.map((node) => {
    const currentPermissionProfile = readNodePermissionProfile(node);
    const nextPermissionProfile = resolveNodePermissionProfile(node, harnessPermissionModes);
    if (!nextPermissionProfile || currentPermissionProfile === nextPermissionProfile) return node;
    changed = true;
    return {
      ...node,
      config: {
        ...node.config,
        permissionProfile: nextPermissionProfile
      } as BlueprintNode["config"]
    };
  });

  return changed ? { ...blueprint, nodes } : blueprint;
}

function resolveNodePermissionProfile(
  node: BlueprintNode,
  harnessPermissionModes: Partial<Record<HarnessId, ChatPermissionMode>> | undefined
): AgentPermissionProfile | undefined {
  if (node.type !== "agent" && node.type !== "manager") return undefined;
  const runtimeId = node.runtimeId ?? "openclaw";
  if (runtimeId === "openclaw") return undefined;
  return resolveRuntimePermissionProfile(
    runtimeId,
    harnessPermissionModes,
    readNodePermissionProfile(node) ?? "read_only"
  );
}

function readNodePermissionProfile(node: BlueprintNode): AgentPermissionProfile | undefined {
  if (node.type !== "agent" && node.type !== "manager") return undefined;
  return (node.config as AgentNodeConfig | ManagerNodeConfig).permissionProfile;
}
