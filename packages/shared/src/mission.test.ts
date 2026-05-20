import { describe, expect, it } from "vitest";
import {
  createPortableMissionPackage,
  createBlankMission,
  createDefaultMissions,
  createManagerDrivenHtmlMission,
  createMultiAgentCompatibilityMission,
  createRealThreeAgentMission,
  createStarterMission,
  hydrateImportedMission,
  readPortableMissionPackage,
  type AgentNodeConfig,
  type SendNodeConfig
} from "./mission";
import { isCatalogStale, type CatalogSnapshot } from "./catalog";
import { defaultCompanyId } from "./company";

describe("mission contracts", () => {
  it("creates a starter mission owned by Hiveward with OpenClaw execution nodes", () => {
    const mission = createStarterMission("2026-05-18T00:00:00.000Z");

    expect(mission.nodes.map((node) => node.type)).toEqual([
      "openclaw_agent",
      "openclaw_agent",
      "openclaw_agent",
      "summary",
      "approval",
      "send"
    ]);
    expect(mission.edges).toHaveLength(6);
    expect(mission.nodes.every((node) => "position" in node)).toBe(true);
    expect(mission.companyId).toBe(defaultCompanyId);
  });

  it("creates a real three-node OpenClaw agent chain", () => {
    const mission = createRealThreeAgentMission("2026-05-18T00:00:00.000Z");

    expect(mission.nodes.map((node) => node.id)).toEqual(["brief", "plan", "verify"]);
    expect(mission.nodes.every((node) => node.type === "openclaw_agent")).toBe(true);
    expect(mission.edges.map((edge) => `${edge.source}->${edge.target}`)).toEqual([
      "brief->plan",
      "plan->verify"
    ]);
    expect(mission.nodes.every((node) => "agentId" in node.config && node.config.agentId === "main")).toBe(true);
    expect(mission.companyId).toBe(defaultCompanyId);
  });

  it("creates a manager-driven HTML delivery mission", () => {
    const mission = createManagerDrivenHtmlMission("2026-05-18T00:00:00.000Z");

    expect(mission.nodes.map((node) => node.id)).toContain("html-manager");
    expect(mission.nodes.filter((node) => node.type === "manager_slot")).toHaveLength(3);
    expect(mission.edges.some((edge) => edge.sourceHandle === "manager-slot-inner-out")).toBe(true);
    expect(mission.edges.some((edge) => edge.targetHandle === "manager-slot-inner-in")).toBe(true);
    expect(mission.companyId).toBe(defaultCompanyId);
  });

  it("creates a multi-agent compatibility smoke mission", () => {
    const mission = createMultiAgentCompatibilityMission(
      "2026-05-18T00:00:00.000Z",
      defaultCompanyId,
      "D:\\hiveward"
    );

    expect(mission.nodes.map((node) => node.type)).toEqual([
      "openclaw_agent",
      "codex_agent",
      "claude_code_agent",
      "summary",
      "openclaw_agent"
    ]);
    expect(mission.edges.map((edge) => `${edge.source}->${edge.target}`)).toEqual([
      "compat-openclaw-brief->compat-codex-check",
      "compat-openclaw-brief->compat-claude-check",
      "compat-codex-check->compat-merge",
      "compat-claude-check->compat-merge",
      "compat-merge->compat-openclaw-verify"
    ]);
    expect((mission.nodes.find((node) => node.id === "compat-codex-check")!.config as AgentNodeConfig).workingDirectory).toBe(
      "D:\\hiveward"
    );
    expect((mission.nodes.find((node) => node.id === "compat-claude-check")!.config as AgentNodeConfig).permissionProfile).toBe(
      "read_only"
    );
  });

  it("seeds the default mission set", () => {
    expect(createDefaultMissions("2026-05-18T00:00:00.000Z").map((mission) => mission.id)).toEqual([
      "starter-mission",
      "real-three-agent-mission",
      "multi-agent-compatibility-mission",
      "manager-driven-html-mission"
    ]);
  });

  it("creates a blank mission for user-authored canvases", () => {
    const mission = createBlankMission({
      id: "mission-new",
      companyId: "company-a",
      name: "  Launch review  ",
      now: "2026-05-18T00:00:00.000Z"
    });

    expect(mission.id).toBe("mission-new");
    expect(mission.companyId).toBe("company-a");
    expect(mission.name).toBe("Launch review");
    expect(mission.version).toBe(1);
    expect(mission.nodes).toEqual([]);
    expect(mission.edges).toEqual([]);
    expect(mission.display.viewport).toEqual({ x: 0, y: 0, zoom: 1 });
  });

  it("exports portable mission packages without OpenClaw environment bindings", () => {
    const mission = createStarterMission("2026-05-18T00:00:00.000Z");
    const missionPackage = createPortableMissionPackage([mission], "2026-05-19T00:00:00.000Z");
    const exportedMission = missionPackage.missions[0]!;
    const exportedAgent = exportedMission.nodes.find((node) => node.id === "requirements")!.config as AgentNodeConfig;
    const exportedSend = exportedMission.nodes.find((node) => node.id === "send")!.config as SendNodeConfig;

    expect(missionPackage.schema).toBe("hiveward.mission-package/v1");
    expect(exportedAgent.agentId).toBeUndefined();
    expect(exportedAgent.modelId).toBeUndefined();
    expect(exportedAgent.tools).toEqual([]);
    expect(exportedSend.channelId).toBe("");
    expect(exportedSend.target).toBe("");
    expect(JSON.stringify(missionPackage)).not.toContain(mission.companyId);
  });

  it("imports portable missions with local default bindings and disabled delivery nodes", () => {
    const mission = createStarterMission("2026-05-18T00:00:00.000Z");
    const missionPackage = readPortableMissionPackage(
      createPortableMissionPackage([mission], "2026-05-19T00:00:00.000Z")
    );
    const imported = hydrateImportedMission(missionPackage.missions[0]!, {
      id: "mission-imported",
      companyId: "company-local",
      now: "2026-05-19T00:00:00.000Z",
      defaults: {
        agentId: "local-main",
        modelId: "local/model",
        channelId: "local-channel"
      }
    });
    const importedAgent = imported.nodes.find((node) => node.id === "requirements")!.config as AgentNodeConfig;
    const importedSend = imported.nodes.find((node) => node.id === "send")!;
    const importedSendConfig = importedSend.config as SendNodeConfig;

    expect(imported.id).toBe("mission-imported");
    expect(imported.companyId).toBe("company-local");
    expect(imported.version).toBe(1);
    expect(importedAgent.agentId).toBe("local-main");
    expect(importedAgent.modelId).toBe("local/model");
    expect(importedAgent.tools).toEqual([]);
    expect(importedSend.disabled).toBe(true);
    expect(importedSendConfig.channelId).toBe("local-channel");
    expect(importedSendConfig.target).toBe("");
  });

  it("marks catalog snapshots stale only after staleAfter", () => {
    const snapshot: CatalogSnapshot = {
      id: "snapshot",
      source: "openclaw",
      sourceUpdatedAt: "2026-05-18T00:00:00.000Z",
      refreshedAt: "2026-05-18T00:00:00.000Z",
      staleAfter: "2026-05-18T00:15:00.000Z",
      models: [],
      agents: [],
      tools: [],
      channels: []
    };

    expect(isCatalogStale(snapshot, new Date("2026-05-18T00:14:59.000Z"))).toBe(false);
    expect(isCatalogStale(snapshot, new Date("2026-05-18T00:15:00.000Z"))).toBe(true);
  });
});
