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
  resolveFinalRunResult,
  type AgentNodeConfig,
  type MissionDefinition,
  type MissionEdge,
  type MissionNode,
  type MissionNodeRun,
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
    const agentConfigs = mission.nodes
      .filter((node) => node.type === "openclaw_agent")
      .map((node) => node.config as AgentNodeConfig);

    expect(mission.nodes.map((node) => node.id)).toContain("html-manager");
    expect(mission.nodes.filter((node) => node.type === "manager_slot")).toHaveLength(2);
    expect(agentConfigs.map((config) => config.agentName)).toEqual([
      "news-researcher",
      "execution-doc-writer",
      "html-code-builder"
    ]);
    expect(agentConfigs.map((config) => config.resultRole)).toEqual(["ignore", "ignore", "final"]);
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

  it("resolves explicit final results without relying on node labels", () => {
    const brief = createContractNode("brief", "openclaw_agent", "Final Report");
    const chosen = createContractNode("chosen", "openclaw_agent", "Implementation Notes", {
      resultRole: "final"
    });
    const mission = createResolverMission([brief, chosen], [
      { id: "brief-chosen", source: "brief", target: "chosen", condition: "success" }
    ]);

    const result = resolveFinalRunResult(
      mission,
      [
        createContractNodeRun(brief, "brief output"),
        createContractNodeRun(chosen, "chosen output")
      ],
      "succeeded"
    );

    expect(result?.state).toBe("available");
    expect(result?.candidates.map((candidate) => candidate.nodeId)).toEqual(["chosen"]);
    expect(result?.candidates[0]?.selectionReason).toBe("explicit_final");
  });

  it("resolves multiple terminal result branches without silently merging them", () => {
    const researchA = createContractNode("research-a", "openclaw_agent", "Research A");
    const researchB = createContractNode("research-b", "codex_agent", "Research B");
    const mission = createResolverMission([researchA, researchB]);

    const result = resolveFinalRunResult(mission, [
      createContractNodeRun(researchA, { answer: "a" }),
      createContractNodeRun(researchB, { answer: "b" })
    ]);

    expect(result?.candidates.map((candidate) => candidate.nodeId)).toEqual(["research-a", "research-b"]);
    expect(result?.candidates.every((candidate) => candidate.selectionReason === "terminal_result")).toBe(true);
  });

  it("chooses merged downstream output over earlier branch outputs", () => {
    const researchA = createContractNode("research-a", "openclaw_agent", "Research A");
    const researchB = createContractNode("research-b", "claude_code_agent", "Research B");
    const merge = createContractNode("merge", "summary", "Merge");
    const mission = createResolverMission([researchA, researchB, merge], [
      { id: "a-merge", source: "research-a", target: "merge", condition: "success" },
      { id: "b-merge", source: "research-b", target: "merge", condition: "success" }
    ]);

    const result = resolveFinalRunResult(mission, [
      createContractNodeRun(researchA, "a"),
      createContractNodeRun(researchB, "b"),
      createContractNodeRun(merge, { merged: true })
    ]);

    expect(result?.candidates.map((candidate) => candidate.nodeId)).toEqual(["merge"]);
  });

  it("keeps approval and send nodes from taking the final result", () => {
    const brief = createContractNode("brief", "openclaw_agent", "Brief");
    const summary = createContractNode("summary", "summary", "Summary");
    const approval = createContractNode("approval", "approval", "Approval");
    const send = createContractNode("send", "send", "Send");
    const mission = createResolverMission([brief, summary, approval, send], [
      { id: "brief-summary", source: "brief", target: "summary", condition: "success" },
      { id: "summary-approval", source: "summary", target: "approval", condition: "success" },
      { id: "approval-send", source: "approval", target: "send", condition: "success" }
    ]);

    const result = resolveFinalRunResult(mission, [
      createContractNodeRun(brief, "brief"),
      createContractNodeRun(summary, "summary"),
      createContractNodeRun(approval, { approved: true }),
      createContractNodeRun(send, { delivered: true })
    ]);

    expect(result?.candidates.map((candidate) => candidate.nodeId)).toEqual(["summary"]);
  });

  it("excludes nodes marked resultRole ignore from final result candidates", () => {
    const ignored = createContractNode("ignored", "summary", "Ignored summary", {
      resultRole: "ignore"
    });
    const fallback = createContractNode("fallback", "openclaw_agent", "Fallback");
    const mission = createResolverMission([ignored, fallback], [
      { id: "ignored-fallback", source: "ignored", target: "fallback", condition: "success" }
    ]);

    const result = resolveFinalRunResult(mission, [
      createContractNodeRun(ignored, "ignored output"),
      createContractNodeRun(fallback, "fallback output")
    ]);

    expect(result?.candidates.map((candidate) => candidate.nodeId)).toEqual(["fallback"]);
  });

  it("includes failed node context and current result candidates for failed runs", () => {
    const brief = createContractNode("brief", "openclaw_agent", "Brief");
    const plan = createContractNode("plan", "openclaw_agent", "Plan");
    const mission = createResolverMission([brief, plan], [
      { id: "brief-plan", source: "brief", target: "plan", condition: "success" }
    ]);
    const failedInput = {
      upstream: [{ nodeId: "brief", nodeLabel: "Brief", output: "brief output" }]
    };

    const result = resolveFinalRunResult(
      mission,
      [
        createContractNodeRun(brief, "brief output"),
        createContractNodeRun(plan, undefined, "failed", {
          input: failedInput,
          error: "planner failed"
        })
      ],
      "failed"
    );

    expect(result?.state).toBe("failed");
    expect(result?.failedNode).toMatchObject({
      nodeId: "plan",
      error: "planner failed",
      input: failedInput
    });
    expect(result?.candidates.map((candidate) => candidate.nodeId)).toEqual(["brief"]);
  });

  it("uses top-level manager output as the automatic manager result", () => {
    const manager = createContractNode("manager", "manager", "Manager");
    const participant = createContractNode("participant", "openclaw_agent", "Participant");
    const mission = createResolverMission([manager, participant], [
      {
        id: "manager-participant",
        source: "manager",
        sourceHandle: "manager-out-1",
        target: "participant",
        condition: "success"
      },
      {
        id: "participant-manager",
        source: "participant",
        target: "manager",
        targetHandle: "manager-in-1",
        condition: "success"
      }
    ]);

    const result = resolveFinalRunResult(mission, [
      createContractNodeRun(participant, "participant output"),
      createContractNodeRun(manager, { status: "completed" })
    ]);

    expect(result?.candidates.map((candidate) => candidate.nodeId)).toEqual(["manager"]);
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

function createResolverMission(nodes: MissionNode[], edges: MissionEdge[] = []): MissionDefinition {
  return {
    id: "resolver-mission",
    companyId: defaultCompanyId,
    name: "Resolver mission",
    version: 1,
    nodes,
    edges,
    variables: {},
    display: {
      viewport: { x: 0, y: 0, zoom: 1 }
    },
    createdAt: "2026-05-20T00:00:00.000Z",
    updatedAt: "2026-05-20T00:00:00.000Z"
  };
}

function createContractNode(
  id: string,
  type: MissionNode["type"],
  label: string,
  config: Partial<MissionNode["config"]> = {}
): MissionNode {
  return {
    id,
    type,
    position: { x: 0, y: 0 },
    config: {
      ...createContractNodeConfig(type, label),
      ...config
    } as MissionNode["config"]
  };
}

function createContractNodeConfig(type: MissionNode["type"], label: string): MissionNode["config"] {
  if (type === "summary") {
    return { label, mode: "structured_merge" };
  }
  if (type === "approval") {
    return { label };
  }
  if (type === "send") {
    return { label, channelId: "slack", target: "#ops", bodyTemplate: "{{summary}}" };
  }
  if (type === "manager") {
    return { label, portCount: 1, maxHandoffs: 3 };
  }
  if (type === "parallel_agents") {
    return { label, agents: [], waitFor: "all" };
  }
  if (type === "manager_slot") {
    return { label, managerNodeId: "manager", slot: 1 };
  }
  if (type === "loop") {
    return { label, maxIterations: 1 };
  }
  if (type === "condition") {
    return { label, expression: "true" };
  }
  if (type === "note") {
    return { label, body: "" };
  }
  if (type === "group") {
    return { label, color: "#ffffff" };
  }
  return {
    label,
    agentId: "main",
    agentName: idFromLabel(label),
    prompt: `Run ${label}`,
    tools: []
  };
}

function createContractNodeRun(
  node: MissionNode,
  output: unknown,
  status: MissionNodeRun["status"] = "succeeded",
  overrides: Partial<MissionNodeRun> = {}
): MissionNodeRun {
  return {
    id: `node-run-${node.id}`,
    missionRunId: "run-1",
    missionId: "resolver-mission",
    nodeId: node.id,
    nodeLabel: node.config.label,
    nodeType: node.type,
    status,
    queuedAt: "2026-05-20T00:00:00.000Z",
    startedAt: "2026-05-20T00:00:00.000Z",
    endedAt: "2026-05-20T00:00:01.000Z",
    output,
    ...overrides
  };
}

function idFromLabel(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "agent";
}
