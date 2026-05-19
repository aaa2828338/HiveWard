import { existsSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { AgentSdkError } from "./errors";

export function resolveSdkWorkingDirectory(inputDirectory: string | undefined, workspaceRoot: string): string {
  if (!inputDirectory?.trim()) {
    throw new AgentSdkError("workspace_not_allowed", "workingDirectory must be an absolute directory.");
  }
  if (!isAbsolute(inputDirectory)) {
    throw new AgentSdkError("workspace_not_allowed", "workingDirectory must be absolute.");
  }

  const resolvedRoot = resolve(workspaceRoot);
  const resolvedDirectory = resolve(inputDirectory);
  const relation = relative(resolvedRoot, resolvedDirectory);
  if (relation.startsWith("..") || isAbsolute(relation)) {
    throw new AgentSdkError("workspace_not_allowed", "workingDirectory must be under the configured SDK workspace root.");
  }
  if (!existsSync(resolvedDirectory) || !statSync(resolvedDirectory).isDirectory()) {
    throw new AgentSdkError("workspace_not_allowed", "workingDirectory does not exist.");
  }

  return resolvedDirectory;
}

export function assertGitWorkspace(workingDirectory: string, workspaceRoot: string): void {
  const resolvedRoot = resolve(workspaceRoot);
  let current = resolve(workingDirectory);

  while (true) {
    if (existsSync(join(current, ".git"))) {
      return;
    }
    if (current === resolvedRoot || dirname(current) === current) {
      throw new AgentSdkError("workspace_not_allowed", "Codex tasks require a git workspace.");
    }
    current = dirname(current);
  }
}
