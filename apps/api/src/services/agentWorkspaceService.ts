import { createHash } from "node:crypto";
import { join } from "node:path";
import type { BlueprintDefinition, BlueprintNode } from "@hiveward/shared";

export const agentWorkspaceRootFolder = "agents";
export const agentWorkspaceMetadataFile = "agent-workspace.json";

export interface AgentWorkspaceRef {
  nodeId: string;
  nodeLabel: string;
  directoryName: string;
  path: string;
  artifactsPath: string;
  tmpPath: string;
}

export function agentWorkspaceDirectoryName(nodeId: string): string {
  const normalized = nodeId.trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
  const hash = createHash("sha256").update(nodeId).digest("hex").slice(0, 8);
  return `${normalized || "agent"}-${hash}`;
}

export function agentWorkspaceRefForNode(
  blueprintWorkspacePath: string,
  node: BlueprintNode
): AgentWorkspaceRef {
  const directoryName = agentWorkspaceDirectoryName(node.id);
  const workspacePath = join(blueprintWorkspacePath, agentWorkspaceRootFolder, directoryName);
  return {
    nodeId: node.id,
    nodeLabel: node.config.label,
    directoryName,
    path: workspacePath,
    artifactsPath: join(workspacePath, "artifacts"),
    tmpPath: join(workspacePath, "tmp")
  };
}

export function agentWorkspaceRefsForBlueprint(
  blueprintWorkspacePath: string,
  blueprint: BlueprintDefinition
): AgentWorkspaceRef[] {
  return blueprint.nodes
    .filter((node) => node.type === "agent")
    .map((node) => agentWorkspaceRefForNode(blueprintWorkspacePath, node));
}
