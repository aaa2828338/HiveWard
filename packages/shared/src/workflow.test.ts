import { describe, expect, it } from "vitest";
import {
  createPortableWorkflowPackage,
  createBlankWorkflow,
  createDefaultWorkflows,
  createManagerDrivenHtmlWorkflow,
  createRealThreeAgentWorkflow,
  createStarterWorkflow,
  hydrateImportedWorkflow,
  readPortableWorkflowPackage,
  type AgentNodeConfig,
  type SendNodeConfig
} from "./workflow";
import { isCatalogStale, type CatalogSnapshot } from "./catalog";
import { defaultCompanyId } from "./company";

describe("workflow contracts", () => {
  it("creates a starter workflow owned by CUI with OpenClaw execution nodes", () => {
    const workflow = createStarterWorkflow("2026-05-18T00:00:00.000Z");

    expect(workflow.nodes.map((node) => node.type)).toEqual([
      "agent",
      "agent",
      "agent",
      "summary",
      "approval",
      "send"
    ]);
    expect(workflow.edges).toHaveLength(6);
    expect(workflow.nodes.every((node) => "position" in node)).toBe(true);
    expect(workflow.companyId).toBe(defaultCompanyId);
  });

  it("creates a real three-node OpenClaw agent chain", () => {
    const workflow = createRealThreeAgentWorkflow("2026-05-18T00:00:00.000Z");

    expect(workflow.nodes.map((node) => node.id)).toEqual(["brief", "plan", "verify"]);
    expect(workflow.nodes.every((node) => node.type === "agent")).toBe(true);
    expect(workflow.edges.map((edge) => `${edge.source}->${edge.target}`)).toEqual([
      "brief->plan",
      "plan->verify"
    ]);
    expect(workflow.nodes.every((node) => "agentId" in node.config && node.config.agentId === "main")).toBe(true);
    expect(workflow.companyId).toBe(defaultCompanyId);
  });

  it("creates a manager-driven HTML delivery workflow", () => {
    const workflow = createManagerDrivenHtmlWorkflow("2026-05-18T00:00:00.000Z");

    expect(workflow.nodes.map((node) => node.id)).toContain("html-manager");
    expect(workflow.nodes.filter((node) => node.type === "manager_slot")).toHaveLength(3);
    expect(workflow.edges.some((edge) => edge.sourceHandle === "manager-slot-inner-out")).toBe(true);
    expect(workflow.edges.some((edge) => edge.targetHandle === "manager-slot-inner-in")).toBe(true);
    expect(workflow.companyId).toBe(defaultCompanyId);
  });

  it("seeds the default workflow set", () => {
    expect(createDefaultWorkflows("2026-05-18T00:00:00.000Z").map((workflow) => workflow.id)).toEqual([
      "starter-workflow",
      "real-three-agent-workflow",
      "manager-driven-html-workflow"
    ]);
  });

  it("creates a blank workflow for user-authored canvases", () => {
    const workflow = createBlankWorkflow({
      id: "workflow-new",
      companyId: "company-a",
      name: "  Launch review  ",
      now: "2026-05-18T00:00:00.000Z"
    });

    expect(workflow.id).toBe("workflow-new");
    expect(workflow.companyId).toBe("company-a");
    expect(workflow.name).toBe("Launch review");
    expect(workflow.version).toBe(1);
    expect(workflow.nodes).toEqual([]);
    expect(workflow.edges).toEqual([]);
    expect(workflow.display.viewport).toEqual({ x: 0, y: 0, zoom: 1 });
  });

  it("exports portable workflow packages without OpenClaw environment bindings", () => {
    const workflow = createStarterWorkflow("2026-05-18T00:00:00.000Z");
    const workflowPackage = createPortableWorkflowPackage([workflow], "2026-05-19T00:00:00.000Z");
    const exportedWorkflow = workflowPackage.workflows[0]!;
    const exportedAgent = exportedWorkflow.nodes.find((node) => node.id === "requirements")!.config as AgentNodeConfig;
    const exportedSend = exportedWorkflow.nodes.find((node) => node.id === "send")!.config as SendNodeConfig;

    expect(workflowPackage.schema).toBe("openclaw-cui.workflow-package/v1");
    expect(exportedAgent.agentId).toBeUndefined();
    expect(exportedAgent.modelId).toBeUndefined();
    expect(exportedAgent.tools).toEqual([]);
    expect(exportedSend.channelId).toBe("");
    expect(exportedSend.target).toBe("");
    expect(JSON.stringify(workflowPackage)).not.toContain(workflow.companyId);
  });

  it("imports portable workflows with local default bindings and disabled delivery nodes", () => {
    const workflow = createStarterWorkflow("2026-05-18T00:00:00.000Z");
    const workflowPackage = readPortableWorkflowPackage(
      createPortableWorkflowPackage([workflow], "2026-05-19T00:00:00.000Z")
    );
    const imported = hydrateImportedWorkflow(workflowPackage.workflows[0]!, {
      id: "workflow-imported",
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

    expect(imported.id).toBe("workflow-imported");
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
