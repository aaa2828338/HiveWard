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
        },
        {
          id: "codex-summary",
          type: "summary",
          position: { x: 300, y: 0 },
          config: {
            label: "Codex summary",
            mode: "harness_summary",
            runtimeId: "codex"
          }
        }
      ],
      edges: []
    };

    const next = applyHarnessPermissionModesToBlueprint(blueprint, {
      codex: "full_access",
      claudeCode: "safe"
    });

    const nextConfigById = Object.fromEntries(next.nodes.map((node) => [node.id, node.config]));

    expect(nextConfigById["codex-agent"]).toMatchObject({
      permissionProfile: "workspace_write",
      runtimeAccessPolicy: {
        filesystem: "workspace_write",
        network: "enabled",
        webSearch: "live"
      }
    });
    expect(nextConfigById["claude-manager"]).toMatchObject({
      permissionProfile: "read_only",
      runtimeAccessPolicy: {
        filesystem: "read_only",
        network: "enabled",
        webSearch: "disabled"
      }
    });
    expect(nextConfigById["openclaw-agent"]).toMatchObject({ permissionProfile: "read_only" });
    expect(nextConfigById["codex-summary"]).toMatchObject({
      runtimeAccessPolicy: {
        filesystem: "workspace_write",
        network: "enabled",
        webSearch: "live"
      }
    });
  });
});
