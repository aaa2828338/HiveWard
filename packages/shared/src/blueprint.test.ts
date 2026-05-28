import { describe, expect, it } from "vitest";
import {
  createActiveManagerNewsHtmlChaosBlueprint,
  createActiveManagerRemotionVideoChaosBlueprint,
  createPortableBlueprintPackage,
  createBlankBlueprint,
  createDefaultBlueprints,
  createManagerDrivenHtmlBlueprint,
  createMultiAgentCompatibilityBlueprint,
  createRealThreeAgentBlueprint,
  createStarterBlueprint,
  hydrateImportedBlueprint,
  readPortableBlueprintPackage,
  resolveFinalRunResult,
  resolveManagerSlotExecutionMode,
  type AgentNodeConfig,
  type BlueprintDefinition,
  type BlueprintEdge,
  type BlueprintNode,
  type BlueprintNodeRun,
  type ManagerSlotNodeConfig
} from "./blueprint";
import { isCatalogStale, type CatalogSnapshot } from "./catalog";
import { defaultCompanyId } from "./company";

describe("blueprint contracts", () => {
  it("creates a starter blueprint owned by Hiveward with OpenClaw execution nodes", () => {
    const blueprint = createStarterBlueprint("2026-05-18T00:00:00.000Z");

    expect(blueprint.nodes.map((node) => node.type)).toEqual([
      "agent",
      "agent",
      "agent",
      "summary",
      "agent"
    ]);
    expect(blueprint.nodes.filter((node) => node.type === "agent").map((node) => node.runtimeId)).toEqual([
      "openclaw",
      "openclaw",
      "openclaw",
      "openclaw"
    ]);
    expect((blueprint.nodes.find((node) => node.id === "delivery")!.config as AgentNodeConfig).approval?.enabled).toBe(true);
    expect((blueprint.nodes.find((node) => node.id === "delivery")!.config as AgentNodeConfig).send?.enabled).toBe(true);
    expect(blueprint.edges).toHaveLength(5);
    expect(blueprint.nodes.every((node) => "position" in node)).toBe(true);
    expect(blueprint.companyId).toBe(defaultCompanyId);
  });

  it("creates a real three-node OpenClaw agent chain", () => {
    const blueprint = createRealThreeAgentBlueprint("2026-05-18T00:00:00.000Z");

    expect(blueprint.nodes.map((node) => node.id)).toEqual(["brief", "plan", "verify"]);
    expect(blueprint.nodes.every((node) => node.type === "agent")).toBe(true);
    expect(blueprint.nodes.every((node) => node.runtimeId === "openclaw")).toBe(true);
    expect(blueprint.edges.map((edge) => `${edge.source}->${edge.target}`)).toEqual([
      "brief->plan",
      "plan->verify"
    ]);
    expect(blueprint.nodes.every((node) => "openclawAgentId" in node.config && node.config.openclawAgentId === "main")).toBe(true);
    expect(blueprint.companyId).toBe(defaultCompanyId);
  });

  it("creates a manager-driven HTML delivery blueprint", () => {
    const blueprint = createManagerDrivenHtmlBlueprint("2026-05-18T00:00:00.000Z");
    const agentConfigs = blueprint.nodes
      .filter((node) => node.type === "agent")
      .map((node) => node.config as AgentNodeConfig);

    expect(blueprint.nodes.map((node) => node.id)).toContain("html-manager");
    expect(blueprint.nodes.filter((node) => node.type === "manager_slot")).toHaveLength(2);
    expect(agentConfigs.map((config) => config.agentName)).toEqual([
      "news-researcher",
      "execution-doc-writer",
      "html-code-builder"
    ]);
    expect(agentConfigs.map((config) => config.resultRole)).toEqual(["ignore", "ignore", "final"]);
    expect(agentConfigs.every((config) => !config.prompt.includes("Return strict JSON"))).toBe(true);
    expect(agentConfigs.every((config) => config.outputSchema === undefined)).toBe(true);
    expect(blueprint.edges.some((edge) => edge.sourceHandle === "manager-slot-inner-out")).toBe(true);
    expect(blueprint.edges.some((edge) => edge.targetHandle === "manager-slot-inner-in")).toBe(true);
    expect(blueprint.companyId).toBe(defaultCompanyId);
  });

  it("creates an active manager chaos blueprint with intentionally scrambled slots", () => {
    const blueprint = createActiveManagerNewsHtmlChaosBlueprint("2026-05-18T00:00:00.000Z");
    const manager = blueprint.nodes.find((node) => node.id === "chaos-manager");
    const slots = blueprint.nodes.filter((node) => node.type === "manager_slot");
    const agentConfigs = blueprint.nodes
      .filter((node) => node.type === "agent")
      .map((node) => node.config as AgentNodeConfig);

    expect(manager?.runtimeId).toBe("openclaw");
    expect(manager?.config.label).toBe("主动分发 Manager");
    expect(slots.map((node) => node.id)).toEqual([
      "chaos-slot-build",
      "chaos-slot-qa",
      "chaos-slot-research",
      "chaos-slot-spec"
    ]);
    expect(slots.map((node) => Number("slot" in node.config ? node.config.slot : 0))).toEqual([1, 2, 3, 4]);
    expect(agentConfigs.map((config) => config.agentName)).toEqual([
      "html-builder",
      "html-qa-reviewer",
      "news-researcher-cn",
      "html-execution-doc-writer"
    ]);
    expect(agentConfigs.map((config) => config.resultRole)).toEqual(["final", "ignore", "ignore", "ignore"]);
    expect(blueprint.edges.filter((edge) => edge.source === "chaos-manager")).toHaveLength(4);
  });

  it("creates an active manager Remotion chaos blueprint with strict QA rollback slots", () => {
    const blueprint = createActiveManagerRemotionVideoChaosBlueprint("2026-05-18T00:00:00.000Z");
    const manager = blueprint.nodes.find((node) => node.id === "remotion-manager");
    const slots = blueprint.nodes.filter((node) => node.type === "manager_slot");
    const agentConfigs = blueprint.nodes
      .filter((node) => node.type === "agent")
      .map((node) => node.config as AgentNodeConfig);

    expect(manager?.runtimeId).toBe("openclaw");
    expect(manager?.config.label).toBe("Remotion 主动分发 Manager");
    expect(slots.map((node) => node.id)).toEqual([
      "remotion-slot-build",
      "remotion-slot-qa",
      "remotion-slot-research",
      "remotion-slot-storyboard",
      "remotion-slot-tech-plan"
    ]);
    expect(slots.map((node) => Number("slot" in node.config ? node.config.slot : 0))).toEqual([1, 2, 3, 4, 5]);
    expect(agentConfigs.map((config) => config.agentName)).toEqual([
      "remotion-code-builder",
      "remotion-qa-reviewer",
      "remotion-video-researcher",
      "remotion-storyboard-writer",
      "remotion-tech-planner"
    ]);
    expect(agentConfigs.map((config) => config.resultRole)).toEqual(["final", "ignore", "ignore", "ignore", "ignore"]);
    expect(blueprint.edges.filter((edge) => edge.source === "remotion-manager")).toHaveLength(5);
  });

  it("creates a multi-agent compatibility smoke blueprint", () => {
    const blueprint = createMultiAgentCompatibilityBlueprint(
      "2026-05-18T00:00:00.000Z",
      defaultCompanyId,
      "D:\\hiveward"
    );

    expect(blueprint.nodes.map((node) => node.type)).toEqual([
      "agent",
      "agent",
      "agent",
      "summary",
      "agent"
    ]);
    expect(blueprint.nodes.map((node) => node.runtimeId ?? null)).toEqual([
      "openclaw",
      "codex",
      "claude",
      null,
      "openclaw"
    ]);
    expect(blueprint.edges.map((edge) => `${edge.source}->${edge.target}`)).toEqual([
      "compat-openclaw-brief->compat-codex-check",
      "compat-openclaw-brief->compat-claude-check",
      "compat-codex-check->compat-merge",
      "compat-claude-check->compat-merge",
      "compat-merge->compat-openclaw-verify"
    ]);
    expect((blueprint.nodes.find((node) => node.id === "compat-codex-check")!.config as AgentNodeConfig).workingDirectory).toBe(
      "D:\\hiveward"
    );
    expect((blueprint.nodes.find((node) => node.id === "compat-claude-check")!.config as AgentNodeConfig).permissionProfile).toBe(
      "read_only"
    );
  });

  it("seeds the default blueprint set", () => {
    expect(createDefaultBlueprints("2026-05-18T00:00:00.000Z").map((blueprint) => blueprint.id)).toEqual([
      "starter-blueprint",
      "real-three-agent-blueprint",
      "multi-agent-compatibility-blueprint",
      "manager-driven-html-blueprint",
      "active-manager-news-html-chaos-blueprint",
      "active-manager-remotion-video-chaos-blueprint"
    ]);
  });

  it("accepts OpenCode and Hermes runtime ids in portable blueprints", () => {
    const imported = readPortableBlueprintPackage({
      schema: "hiveward.blueprint-package/v1",
      exportedAt: "2026-05-27T00:00:00.000Z",
      blueprints: [
        {
          id: "cli-harness-blueprint",
          name: "CLI harness blueprint",
          version: 1,
          nodes: [
            {
              id: "opencode-agent",
              type: "agent",
              runtimeId: "opencode",
              position: { x: 0, y: 0 },
              config: {
                label: "OpenCode Agent",
                agentName: "opencode-agent",
                prompt: "Use OpenCode.",
                tools: []
              }
            },
            {
              id: "hermes-summary",
              type: "summary",
              position: { x: 320, y: 0 },
              config: {
                label: "Hermes Summary",
                mode: "harness_summary",
                runtimeId: "hermes"
              }
            }
          ],
          edges: [],
          variables: {},
          display: { viewport: { x: 0, y: 0, zoom: 1 } }
        }
      ]
    });

    expect(imported.blueprints[0]?.nodes.map((node) => node.runtimeId ?? (node.config as { runtimeId?: string }).runtimeId)).toEqual([
      "opencode",
      "hermes"
    ]);
  });

  it("creates a blank blueprint for user-authored canvases", () => {
    const blueprint = createBlankBlueprint({
      id: "blueprint-new",
      companyId: "company-a",
      name: "  Launch review  ",
      now: "2026-05-18T00:00:00.000Z"
    });

    expect(blueprint.id).toBe("blueprint-new");
    expect(blueprint.companyId).toBe("company-a");
    expect(blueprint.name).toBe("Launch review");
    expect(blueprint.version).toBe(1);
    expect(blueprint.nodes).toEqual([]);
    expect(blueprint.edges).toEqual([]);
    expect(blueprint.display.viewport).toEqual({ x: 0, y: 0, zoom: 1 });
  });

  it("exports portable blueprint packages without OpenClaw environment bindings", () => {
    const blueprint = createStarterBlueprint("2026-05-18T00:00:00.000Z");
    const sourceAgent = blueprint.nodes.find((node) => node.id === "requirements")!.config as AgentNodeConfig;
    sourceAgent.skillIds = ["hiveward-ceo"];
    const blueprintPackage = createPortableBlueprintPackage([blueprint], "2026-05-19T00:00:00.000Z");
    const exportedBlueprint = blueprintPackage.blueprints[0]!;
    const exportedAgent = exportedBlueprint.nodes.find((node) => node.id === "requirements")!.config as AgentNodeConfig;
    const exportedDelivery = exportedBlueprint.nodes.find((node) => node.id === "delivery")!.config as AgentNodeConfig;

    expect(blueprintPackage.schema).toBe("hiveward.blueprint-package/v1");
    expect(exportedAgent.openclawAgentId).toBeUndefined();
    expect(exportedAgent.modelId).toBeUndefined();
    expect(exportedAgent.skillIds).toEqual(["hiveward-ceo"]);
    expect(exportedAgent.tools).toEqual([]);
    expect(exportedDelivery.openclawAgentId).toBeUndefined();
    expect(exportedDelivery.approval?.enabled).toBe(true);
    expect(exportedDelivery.send?.channelId).toBe("");
    expect(exportedDelivery.send?.target).toBe("");
    expect(JSON.stringify(blueprintPackage)).not.toContain(blueprint.companyId);
  });

  it("imports portable blueprints with local default bindings and local delivery channels", () => {
    const blueprint = createStarterBlueprint("2026-05-18T00:00:00.000Z");
    const blueprintPackage = readPortableBlueprintPackage(
      createPortableBlueprintPackage([blueprint], "2026-05-19T00:00:00.000Z")
    );
    const imported = hydrateImportedBlueprint(blueprintPackage.blueprints[0]!, {
      id: "blueprint-imported",
      companyId: "company-local",
      now: "2026-05-19T00:00:00.000Z",
      defaults: {
        openclawAgentId: "local-main",
        modelId: "local/model",
        channelId: "local-channel"
      }
    });
    const importedAgent = imported.nodes.find((node) => node.id === "requirements")!.config as AgentNodeConfig;
    const importedDelivery = imported.nodes.find((node) => node.id === "delivery")!;
    const importedDeliveryConfig = importedDelivery.config as AgentNodeConfig;

    expect(imported.id).toBe("blueprint-imported");
    expect(imported.companyId).toBe("company-local");
    expect(imported.version).toBe(1);
    expect(importedAgent.openclawAgentId).toBe("local-main");
    expect(importedAgent.modelId).toBe("local/model");
    expect(importedAgent.tools).toEqual([]);
    expect(importedDelivery.disabled).toBeUndefined();
    expect(importedDeliveryConfig.openclawAgentId).toBe("local-main");
    expect(importedDeliveryConfig.send?.enabled).toBe(true);
    expect(importedDeliveryConfig.send?.channelId).toBe("local-channel");
    expect(importedDeliveryConfig.send?.target).toBe("");
  });

  it("imports agent defaults from the node runtime instead of always using OpenClaw", () => {
    const blueprintPackage = readPortableBlueprintPackage({
      schema: "hiveward.blueprint-package/v1",
      exportedAt: "2026-05-24T00:00:00.000Z",
      blueprints: [
        {
          id: "sdk-runtime-import",
          name: "SDK runtime import",
          version: 1,
          nodes: [
            createContractNode("openclaw-agent", "agent", "OpenClaw Agent"),
            {
              ...createContractNode("codex-agent", "agent", "Codex Agent", {}, { x: 1, y: 0 }),
              runtimeId: "codex"
            }
          ],
          edges: [],
          variables: {},
          display: { viewport: { x: 0, y: 0, zoom: 1 } }
        }
      ]
    });

    const imported = hydrateImportedBlueprint(blueprintPackage.blueprints[0]!, {
      id: "blueprint-imported",
      companyId: "company-local",
      now: "2026-05-24T00:00:00.000Z",
      defaults: {
        openclawAgentId: "local-main",
        modelId: "openclaw/local-default",
        modelIds: {
          openclaw: "openclaw/local-default",
          codex: "gpt-5.5",
          claude: "inherit"
        }
      }
    });

    const openclawAgent = imported.nodes.find((node) => node.id === "openclaw-agent")!;
    const codexAgent = imported.nodes.find((node) => node.id === "codex-agent")!;

    expect(openclawAgent.runtimeId).toBe("openclaw");
    expect((openclawAgent.config as AgentNodeConfig).openclawAgentId).toBe("local-main");
    expect((openclawAgent.config as AgentNodeConfig).modelId).toBe("openclaw/local-default");
    expect(codexAgent.runtimeId).toBe("codex");
    expect((codexAgent.config as AgentNodeConfig).openclawAgentId).toBeUndefined();
    expect((codexAgent.config as AgentNodeConfig).modelId).toBe("gpt-5.5");
  });

  it("rejects removed standalone approval, send, and parallel agent node types", () => {
    for (const type of ["approval", "send", "parallel_agents"]) {
      expect(() =>
        readPortableBlueprintPackage({
          schema: "hiveward.blueprint-package/v1",
          exportedAt: "2026-05-24T00:00:00.000Z",
          blueprints: [
            {
              id: `removed-${type}`,
              name: `Removed ${type}`,
              version: 1,
              nodes: [
                {
                  id: "removed-node",
                  type,
                  position: { x: 0, y: 0 },
                  config: { label: "Removed" }
                }
              ],
              edges: [],
              variables: {},
              display: { viewport: { x: 0, y: 0, zoom: 1 } }
            }
          ]
        })
      ).toThrow(`Unsupported blueprint node type: ${type}.`);
    }
  });

  it("auto-layouts imported blueprints when model coordinates are compressed", () => {
    const blueprintPackage = readPortableBlueprintPackage({
      schema: "hiveward.blueprint-package/v1",
      exportedAt: "2026-05-23T00:00:00.000Z",
      blueprints: [
        {
          id: "model-generated",
          name: "Model generated",
          version: 1,
          nodes: [
            createContractNode("fetch", "agent", "Fetch", undefined, { x: 0, y: 0 }),
            createContractNode("parse", "agent", "Parse", undefined, { x: 0, y: 1 }),
            createContractNode("render", "agent", "Render", undefined, { x: 0, y: 2 })
          ],
          edges: [
            { id: "fetch-parse", source: "fetch", target: "parse" },
            { id: "parse-render", source: "parse", target: "render" }
          ],
          variables: {},
          display: { viewport: { x: 0, y: 0, zoom: 1 } }
        }
      ]
    });

    const imported = hydrateImportedBlueprint(blueprintPackage.blueprints[0]!, {
      id: "blueprint-imported",
      companyId: "company-local",
      now: "2026-05-23T00:00:00.000Z"
    });

    expect(imported.nodes.map((node) => node.position.x)).toEqual([80, 440, 800]);
    expect(new Set(imported.nodes.map((node) => `${node.position.x}:${node.position.y}`))).toHaveLength(3);
    expect(imported.display.viewport?.zoom).toBe(0.85);
  });

  it("normalizes imported manager-slot structures with canonical handles and nested children", () => {
    const blueprintPackage = readPortableBlueprintPackage({
      schema: "hiveward.blueprint-package/v1",
      exportedAt: "2026-05-23T00:00:00.000Z",
      blueprints: [
        {
          id: "manager-generated",
          name: "Manager generated",
          version: 1,
          nodes: [
            {
              id: "manager",
              type: "manager",
              position: { x: 0, y: 0 },
              config: { label: "HTML Delivery Manager", portCount: 1, maxHandoffs: 4 }
            },
            {
              id: "slot-1",
              type: "manager_slot",
              position: { x: 0, y: 0 },
              config: { label: "Slot 1", slot: 1 }
            },
            createContractNode("research", "agent", "News Research", undefined, { x: 0, y: 0 }),
            createContractNode("build", "agent", "HTML Build", undefined, { x: 0, y: 0 }),
            createContractNode("publish", "agent", "Publish", undefined, { x: 0, y: 0 })
          ],
          edges: [
            { id: "manager-to-slot", source: "manager", target: "slot-1" },
            { id: "slot-to-research", source: "slot-1", target: "research" },
            { id: "research-to-build", source: "research", target: "build" },
            { id: "build-to-slot", source: "build", target: "slot-1" },
            { id: "slot-to-manager", source: "slot-1", target: "manager" },
            { id: "slot-to-publish", source: "slot-1", sourceHandle: "manager-slot-forward-out", target: "publish" }
          ],
          variables: {},
          display: { viewport: { x: 0, y: 0, zoom: 1 } }
        }
      ]
    });

    const portable = blueprintPackage.blueprints[0]!;
    const slot = portable.nodes.find((node) => node.id === "slot-1")!;
    const research = portable.nodes.find((node) => node.id === "research")!;
    const build = portable.nodes.find((node) => node.id === "build")!;
    const publish = portable.nodes.find((node) => node.id === "publish")!;

    expect(slot.config).toMatchObject({ managerNodeId: "manager", slot: 1, parallelLaneCount: 1 });
    expect(resolveManagerSlotExecutionMode(slot.config as ManagerSlotNodeConfig)).toBe("manual");
    expect(slot.size).toEqual({ width: 560, height: 300 });
    expect(research.parentId).toBe("slot-1");
    expect(build.parentId).toBe("slot-1");
    expect(publish.parentId).toBeUndefined();
    expect(portable.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: "manager",
        sourceHandle: "manager-out-1",
        target: "slot-1",
        targetHandle: "manager-slot-in"
      }),
      expect.objectContaining({
        source: "slot-1",
        sourceHandle: "manager-slot-out",
        target: "manager",
        targetHandle: "manager-in-1"
      }),
      expect.objectContaining({
        source: "slot-1",
        sourceHandle: "manager-slot-inner-out",
        target: "research"
      }),
      expect.objectContaining({
        source: "research",
        target: "build"
      }),
      expect.objectContaining({
        source: "build",
        target: "slot-1",
        targetHandle: "manager-slot-inner-in"
      }),
      expect.objectContaining({
        source: "slot-1",
        sourceHandle: "manager-slot-forward-out",
        target: "publish"
      })
    ]));

    const imported = hydrateImportedBlueprint(portable, {
      id: "blueprint-imported",
      companyId: "company-local",
      now: "2026-05-23T00:00:00.000Z"
    });
    const importedManager = imported.nodes.find((node) => node.id === "manager")!;
    const importedSlot = imported.nodes.find((node) => node.id === "slot-1")!;
    const importedResearch = imported.nodes.find((node) => node.id === "research")!;
    const importedBuild = imported.nodes.find((node) => node.id === "build")!;
    const importedPublish = imported.nodes.find((node) => node.id === "publish")!;

    expect(importedManager.position.x).toBe(80);
    expect(importedSlot.position.x).toBe(460);
    expect(importedSlot.size?.width).toBe(832);
    expect(importedResearch.parentId).toBe(importedSlot.id);
    expect(importedBuild.parentId).toBe(importedSlot.id);
    expect(importedPublish.parentId).toBeUndefined();
    expect(imported.display.viewport?.zoom).toBe(0.85);
  });

  it("rejects manager-slot left outer output connections to non-manager nodes", () => {
    expect(() =>
      readPortableBlueprintPackage({
        schema: "hiveward.blueprint-package/v1",
        exportedAt: "2026-05-25T00:00:00.000Z",
        blueprints: [
          {
            id: "invalid-manager-slot-output",
            name: "Invalid manager slot output",
            version: 1,
            nodes: [
              {
                id: "manager",
                type: "manager",
                position: { x: 0, y: 0 },
                config: { label: "Manager", portCount: 1, maxHandoffs: 4 }
              },
              {
                id: "slot-1",
                type: "manager_slot",
                position: { x: 0, y: 0 },
                config: { label: "Slot 1", managerNodeId: "manager", slot: 1 }
              },
              createContractNode("research", "agent", "Research", undefined, { x: 0, y: 0 })
            ],
            edges: [
              { id: "manager-to-slot", source: "manager", target: "slot-1" },
              { id: "slot-left-to-research", source: "slot-1", sourceHandle: "manager-slot-out", target: "research" },
              { id: "slot-to-manager", source: "slot-1", target: "manager" }
            ],
            variables: {},
            display: { viewport: { x: 0, y: 0, zoom: 1 } }
          }
        ]
      })
    ).toThrow("right forward handle");
  });

  it("normalizes legacy OpenClaw summary-agent configs into harness summary configs", () => {
    const blueprintPackage = readPortableBlueprintPackage({
      schema: "hiveward.blueprint-package/v1",
      exportedAt: "2026-05-25T00:00:00.000Z",
      blueprints: [
        {
          id: "summary-legacy",
          name: "Summary legacy",
          version: 1,
          nodes: [
            {
              id: "summary",
              type: "summary",
              position: { x: 0, y: 0 },
              config: {
                label: "Harness summary",
                mode: "openclaw_summary_agent",
                modelId: "openclaw-model",
                prompt: "Use this prompt."
              }
            }
          ],
          edges: [],
          variables: {},
          display: { viewport: { x: 0, y: 0, zoom: 1 } }
        }
      ]
    });

    expect(blueprintPackage.blueprints[0]?.nodes[0]?.config).toMatchObject({
      label: "Harness summary",
      mode: "harness_summary",
      runtimeId: "openclaw",
      modelId: "openclaw-model",
      prompt: "Use this prompt."
    });
  });

  it("allows empty manager slots as explicit planning containers", () => {
    const blueprintPackage = readPortableBlueprintPackage({
      schema: "hiveward.blueprint-package/v1",
      exportedAt: "2026-05-23T00:00:00.000Z",
      blueprints: [
        {
          id: "empty-manager-slot",
          name: "Empty manager slot",
          version: 1,
          nodes: [
            {
              id: "manager",
              type: "manager",
              position: { x: 0, y: 0 },
              config: { label: "Manager", portCount: 1, maxHandoffs: 4 }
            },
            {
              id: "slot-1",
              type: "manager_slot",
              position: { x: 0, y: 0 },
              config: { label: "Slot 1", managerNodeId: "manager", slot: 1 }
            }
          ],
          edges: [
            { id: "manager-to-slot", source: "manager", target: "slot-1" },
            { id: "slot-to-manager", source: "slot-1", target: "manager" }
          ],
          variables: {},
          display: { viewport: { x: 0, y: 0, zoom: 1 } }
        }
      ]
    });

    expect(blueprintPackage.blueprints[0]?.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: "manager",
        sourceHandle: "manager-out-1",
        target: "slot-1",
        targetHandle: "manager-slot-in"
      }),
      expect.objectContaining({
        source: "slot-1",
        sourceHandle: "manager-slot-out",
        target: "manager",
        targetHandle: "manager-in-1"
      })
    ]));
  });

  it("normalizes parallel manager slots as fan-out and fan-in containers", () => {
    const blueprintPackage = readPortableBlueprintPackage({
      schema: "hiveward.blueprint-package/v1",
      exportedAt: "2026-05-24T00:00:00.000Z",
      blueprints: [
        {
          id: "parallel-manager-slot",
          name: "Parallel manager slot",
          version: 1,
          nodes: [
            {
              id: "manager",
              type: "manager",
              position: { x: 0, y: 0 },
              config: { label: "Manager", portCount: 1, maxHandoffs: 4 }
            },
            {
              id: "slot-1",
              type: "manager_slot",
              position: { x: 0, y: 0 },
              config: { label: "Slot 1", managerNodeId: "manager", slot: 1, executionMode: "parallel", parallelLaneCount: 3 }
            },
            {
              ...createContractNode("alpha", "agent", "Alpha", undefined, { x: 0, y: 0 }),
              parentId: "slot-1"
            },
            {
              ...createContractNode("beta", "agent", "Beta", undefined, { x: 0, y: 0 }),
              parentId: "slot-1"
            }
          ],
          edges: [
            { id: "manager-to-slot", source: "manager", target: "slot-1" },
            { id: "alpha-to-beta-old-pipeline", source: "alpha", target: "beta" },
            { id: "slot-to-manager", source: "slot-1", target: "manager" }
          ],
          variables: {},
          display: { viewport: { x: 0, y: 0, zoom: 1 } }
        }
      ]
    });

    const portable = blueprintPackage.blueprints[0]!;
    const slot = portable.nodes.find((node) => node.id === "slot-1")!;

    expect((slot.config as ManagerSlotNodeConfig).executionMode).toBe("parallel");
    expect((slot.config as ManagerSlotNodeConfig).parallelLaneCount).toBe(3);
    expect(resolveManagerSlotExecutionMode(slot.config as ManagerSlotNodeConfig)).toBe("parallel");
    expect(portable.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: "slot-1",
        sourceHandle: "manager-slot-inner-out",
        target: "alpha"
      }),
      expect.objectContaining({
        source: "slot-1",
        sourceHandle: "manager-slot-inner-out-2",
        target: "beta"
      }),
      expect.objectContaining({
        source: "alpha",
        target: "slot-1",
        targetHandle: "manager-slot-inner-in"
      }),
      expect.objectContaining({
        source: "beta",
        target: "slot-1",
        targetHandle: "manager-slot-inner-in-2"
      })
    ]));
    expect(portable.edges.some((edge) => edge.source === "alpha" && edge.target === "beta")).toBe(false);
  });

  it("derives manager slot execution from lane count rather than the legacy mode flag", () => {
    expect(resolveManagerSlotExecutionMode({ executionMode: "parallel", parallelLaneCount: 1 })).toBe("manual");
    expect(resolveManagerSlotExecutionMode({ executionMode: "manual", parallelLaneCount: 2 })).toBe("parallel");
  });

  it("resolves explicit final results without relying on node labels", () => {
    const brief = createContractNode("brief", "agent", "Final Report");
    const chosen = createContractNode("chosen", "agent", "Implementation Notes", {
      resultRole: "final"
    });
    const blueprint = createResolverBlueprint([brief, chosen], [
      { id: "brief-chosen", source: "brief", target: "chosen", condition: "success" }
    ]);

    const result = resolveFinalRunResult(
      blueprint,
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

  it("keeps only the latest explicit final result when the same node reruns", () => {
    const builder = createContractNode("builder", "agent", "Builder", {
      resultRole: "final"
    });
    const blueprint = createResolverBlueprint([builder]);

    const result = resolveFinalRunResult(
      blueprint,
      [
        createContractNodeRun(builder, "<!doctype html>bad retry output", "succeeded", {
          id: "node-run-builder-1",
          endedAt: "2026-05-20T00:00:01.000Z"
        }),
        createContractNodeRun(builder, "src/Root.tsx AgentOpsBriefVideo", "succeeded", {
          id: "node-run-builder-2",
          endedAt: "2026-05-20T00:00:02.000Z"
        })
      ],
      "succeeded"
    );

    expect(result?.candidates).toHaveLength(1);
    expect(result?.candidates[0]?.nodeRunId).toBe("node-run-builder-2");
    expect(result?.candidates[0]?.output).toBe("src/Root.tsx AgentOpsBriefVideo");
  });

  it("resolves multiple terminal result branches without silently merging them", () => {
    const researchA = createContractNode("research-a", "agent", "Research A");
    const researchB = createContractNode("research-b", "agent", "Research B");
    const blueprint = createResolverBlueprint([researchA, researchB]);

    const result = resolveFinalRunResult(blueprint, [
      createContractNodeRun(researchA, { answer: "a" }),
      createContractNodeRun(researchB, { answer: "b" })
    ]);

    expect(result?.candidates.map((candidate) => candidate.nodeId)).toEqual(["research-a", "research-b"]);
    expect(result?.candidates.every((candidate) => candidate.selectionReason === "terminal_result")).toBe(true);
  });

  it("chooses merged downstream output over earlier branch outputs", () => {
    const researchA = createContractNode("research-a", "agent", "Research A");
    const researchB = createContractNode("research-b", "agent", "Research B");
    const merge = createContractNode("merge", "summary", "Merge");
    const blueprint = createResolverBlueprint([researchA, researchB, merge], [
      { id: "a-merge", source: "research-a", target: "merge", condition: "success" },
      { id: "b-merge", source: "research-b", target: "merge", condition: "success" }
    ]);

    const result = resolveFinalRunResult(blueprint, [
      createContractNodeRun(researchA, "a"),
      createContractNodeRun(researchB, "b"),
      createContractNodeRun(merge, { merged: true })
    ]);

    expect(result?.candidates.map((candidate) => candidate.nodeId)).toEqual(["merge"]);
  });

  it("allows an explicit final role to select a delivery node", () => {
    const summary = createContractNode("summary", "summary", "Summary");
    const delivery = createContractNode("delivery", "agent", "Delivery", {
      resultRole: "final"
    });
    const blueprint = createResolverBlueprint([summary, delivery], [
      { id: "summary-delivery", source: "summary", target: "delivery", condition: "success" }
    ]);

    const result = resolveFinalRunResult(blueprint, [
      createContractNodeRun(summary, "summary"),
      createContractNodeRun(delivery, { delivered: true })
    ]);

    expect(result?.candidates).toHaveLength(1);
    expect(result?.candidates[0]).toMatchObject({
      nodeId: "delivery",
      nodeType: "agent",
      resultRole: "final",
      selectionReason: "explicit_final",
      output: { delivered: true }
    });
  });

  it("excludes nodes marked resultRole ignore from final result candidates", () => {
    const ignored = createContractNode("ignored", "summary", "Ignored summary", {
      resultRole: "ignore"
    });
    const fallback = createContractNode("fallback", "agent", "Fallback");
    const blueprint = createResolverBlueprint([ignored, fallback], [
      { id: "ignored-fallback", source: "ignored", target: "fallback", condition: "success" }
    ]);

    const result = resolveFinalRunResult(blueprint, [
      createContractNodeRun(ignored, "ignored output"),
      createContractNodeRun(fallback, "fallback output")
    ]);

    expect(result?.candidates.map((candidate) => candidate.nodeId)).toEqual(["fallback"]);
  });

  it("includes failed node context and current result candidates for failed runs", () => {
    const brief = createContractNode("brief", "agent", "Brief");
    const plan = createContractNode("plan", "agent", "Plan");
    const blueprint = createResolverBlueprint([brief, plan], [
      { id: "brief-plan", source: "brief", target: "plan", condition: "success" }
    ]);
    const failedInput = {
      upstream: [{ nodeId: "brief", nodeLabel: "Brief", output: "brief output" }]
    };

    const result = resolveFinalRunResult(
      blueprint,
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

  it("does not let cleanup cancellations make a succeeded run look failed", () => {
    const final = createContractNode("final", "agent", "Final", {
      resultRole: "final"
    });
    const stale = createContractNode("stale", "agent", "Stale child");
    const blueprint = createResolverBlueprint([final, stale]);

    const result = resolveFinalRunResult(
      blueprint,
      [
        createContractNodeRun(final, "final output"),
        createContractNodeRun(stale, undefined, "cancelled", {
          error: "Run already reached a terminal state; closing stale work."
        })
      ],
      "succeeded"
    );

    expect(result?.state).toBe("available");
    expect(result?.failedNode).toBeUndefined();
    expect(result?.candidates.map((candidate) => candidate.nodeId)).toEqual(["final"]);
  });

  it("uses top-level manager output as the automatic manager result", () => {
    const manager = createContractNode("manager", "manager", "Manager");
    const participant = createContractNode("participant", "agent", "Participant");
    const blueprint = createResolverBlueprint([manager, participant], [
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

    const result = resolveFinalRunResult(blueprint, [
      createContractNodeRun(participant, "participant output"),
      createContractNodeRun(manager, { status: "completed" })
    ]);

    expect(result?.candidates.map((candidate) => candidate.nodeId)).toEqual(["manager"]);
  });

  it("returns an empty final result state for terminal runs without result candidates", () => {
    const note = createContractNode("note", "note", "Note");
    const blueprint = createResolverBlueprint([note]);

    const result = resolveFinalRunResult(
      blueprint,
      [
        createContractNodeRun(note, { noted: true })
      ],
      "succeeded"
    );

    expect(result).toEqual({
      state: "empty",
      candidates: []
    });
  });

  it("returns failed state for run-level failures without a failed node", () => {
    const note = createContractNode("note", "note", "Note");
    const blueprint = createResolverBlueprint([note]);

    const result = resolveFinalRunResult(blueprint, [], "failed");

    expect(result).toEqual({
      state: "failed",
      candidates: []
    });
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

function createResolverBlueprint(nodes: BlueprintNode[], edges: BlueprintEdge[] = []): BlueprintDefinition {
  return {
    id: "resolver-blueprint",
    companyId: defaultCompanyId,
    name: "Resolver blueprint",
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
  type: BlueprintNode["type"],
  label: string,
  config: Partial<BlueprintNode["config"]> = {},
  position = { x: 0, y: 0 }
): BlueprintNode {
  return {
    id,
    type,
    runtimeId: type === "agent" ? "openclaw" : undefined,
    position,
    config: {
      ...createContractNodeConfig(type, label),
      ...config
    } as BlueprintNode["config"]
  };
}

function createContractNodeConfig(type: BlueprintNode["type"], label: string): BlueprintNode["config"] {
  if (type === "summary") {
    return { label, mode: "structured_merge" };
  }
  if (type === "manager") {
    return { label, portCount: 1, maxHandoffs: 3 };
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
    openclawAgentId: "main",
    agentName: idFromLabel(label),
    prompt: `Run ${label}`,
    tools: []
  };
}

function createContractNodeRun(
  node: BlueprintNode,
  output: unknown,
  status: BlueprintNodeRun["status"] = "succeeded",
  overrides: Partial<BlueprintNodeRun> = {}
): BlueprintNodeRun {
  return {
    id: `node-run-${node.id}`,
    blueprintRunId: "run-1",
    blueprintId: "resolver-blueprint",
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
