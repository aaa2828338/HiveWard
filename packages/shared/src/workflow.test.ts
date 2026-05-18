import { describe, expect, it } from "vitest";
import { createDefaultWorkflows, createRealThreeAgentWorkflow, createStarterWorkflow } from "./workflow";
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

  it("seeds both default workflows", () => {
    expect(createDefaultWorkflows("2026-05-18T00:00:00.000Z").map((workflow) => workflow.id)).toEqual([
      "starter-workflow",
      "real-three-agent-workflow"
    ]);
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
