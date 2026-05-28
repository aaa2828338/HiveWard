import { describe, expect, it } from "vitest";
import type { BlueprintDefinition } from "@hiveward/shared";
import { applyHarnessPermissionModesToBlueprint, resolveRuntimePermissionProfile } from "./harness-permissions";

describe("harness permissions", () => {
  it("maps full-access harness settings to blueprint node workspace-write permissions", () => {
    expect(resolveRuntimePermissionProfile("codex", { codex: "full_access" })).toBe("workspace_write");
    expect(resolveRuntimePermissionProfile("claude", { claudeCode: "full_access" })).toBe("workspace_write");
    expect(resolveRuntimePermissionProfile("google", { google: "safe" })).toBe("read_only");
  });

  it("applies harness permission settings to blueprint agent and manager nodes", () => {
    const blueprint: BlueprintDefinition = {
      id: "blueprint-1",
      companyId: "company-1",
      name: "Permission test",
      description: "",
      version: 1,
      createdAt: "2026-05-28T00:00:00.000Z",
      updatedAt: "2026-05-28T00:00:00.000Z",
      variables: {},
      display: {},
      nodes: [
        {
          id: "codex-agent",
          type: "agent",
          runtimeId: "codex",
          position: { x: 0, y: 0 },
          config: {
            label: "Codex agent",
            agentName: "codex-agent",
            prompt: "Run",
            permissionProfile: "read_only",
            tools: []
          }
        },
        {
          id: "claude-manager",
          type: "manager",
          runtimeId: "claude",
          position: { x: 100, y: 0 },
          config: {
            label: "Claude manager",
            portCount: 2,
            maxHandoffs: 4,
            permissionProfile: "workspace_write"
          }
        },
        {
          id: "openclaw-agent",
          type: "agent",
          runtimeId: "openclaw",
          position: { x: 200, y: 0 },
          config: {
            label: "OpenClaw agent",
            openclawAgentId: "main",
            agentName: "openclaw-agent",
            prompt: "Run",
            permissionProfile: "read_only",
            tools: []
          }
        }
      ],
      edges: []
    };

    const next = applyHarnessPermissionModesToBlueprint(blueprint, {
      codex: "full_access",
      claudeCode: "safe"
    });

    expect(next.nodes[0]?.config).toMatchObject({ permissionProfile: "workspace_write" });
    expect(next.nodes[1]?.config).toMatchObject({ permissionProfile: "read_only" });
    expect(next.nodes[2]?.config).toMatchObject({ permissionProfile: "read_only" });
  });
});
