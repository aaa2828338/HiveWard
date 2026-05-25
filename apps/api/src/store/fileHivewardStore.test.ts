import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { BlueprintDefinition, BlueprintNode, BlueprintNodeRun } from "@hiveward/shared";
import { createBlankBlueprint } from "@hiveward/shared";
import { FileHivewardStore } from "./fileHivewardStore";

describe("FileHivewardStore blueprint node sanitization", () => {
  it("strips removed standalone nodes from saved blueprints and run archives", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hiveward-store-"));
    const store = new FileHivewardStore(join(dir, "hiveward-store.json"));
    await store.init();

    const dirtyBlueprint = createDirtyBlueprint(new Date().toISOString());
    const saved = await store.saveBlueprint(dirtyBlueprint);

    expect(saved.nodes.map((node) => node.type)).toEqual(["agent"]);
    expect(saved.edges).toEqual([]);
    await expect(store.getBlueprint(dirtyBlueprint.id)).resolves.toMatchObject({
      nodes: [{ id: "draft", type: "agent" }],
      edges: []
    });

    const run = await store.createBlueprintRun(dirtyBlueprint, "tester");
    await store.upsertNodeRun(createNodeRun(run.id, dirtyBlueprint.id, "draft", "agent", "succeeded"));
    await store.upsertNodeRun(createNodeRun(run.id, dirtyBlueprint.id, "approval", "approval", "waiting_approval"));
    await store.appendEvent({
      id: "event-approval",
      blueprintRunId: run.id,
      nodeRunId: "node-run-approval",
      type: "node.run.waiting_approval",
      message: "Old approval node waiting.",
      createdAt: new Date().toISOString()
    });

    await expect(store.listNodeRuns(run.id)).resolves.toMatchObject([
      { nodeId: "draft", nodeType: "agent" }
    ]);
    await expect(store.listPendingApprovals()).resolves.toEqual([]);
    await expect(store.getRunView(run.id)).resolves.toMatchObject({
      nodeRuns: [{ nodeId: "draft", nodeType: "agent" }],
      events: []
    });
    await expect(store.listRunArchives()).resolves.toMatchObject([
      {
        blueprintSnapshot: {
          nodes: [{ id: "draft", type: "agent" }],
          edges: []
        },
        nodeRuns: [{ nodeId: "draft", nodeType: "agent" }]
      }
    ]);
  });
});

function createDirtyBlueprint(now: string): BlueprintDefinition {
  const blueprint = createBlankBlueprint({
    id: "dirty-blueprint",
    companyId: "company-hiveward-studio",
    now,
    name: "Dirty legacy blueprint"
  });
  return {
    ...blueprint,
    nodes: [
      {
        id: "draft",
        type: "agent",
        runtimeId: "openclaw",
        position: { x: 0, y: 0 },
        config: {
          label: "Draft",
          openclawAgentId: "main",
          agentName: "writer",
          prompt: "Write the draft.",
          tools: []
        }
      },
      createRemovedNode("approval", "approval"),
      createRemovedNode("send", "send"),
      createRemovedNode("parallel", "parallel_agents")
    ],
    edges: [
      { id: "edge-draft-approval", source: "draft", target: "approval" },
      { id: "edge-approval-send", source: "approval", target: "send" },
      { id: "edge-send-parallel", source: "send", target: "parallel" }
    ]
  };
}

function createRemovedNode(id: string, type: string): BlueprintNode {
  return {
    id,
    type,
    position: { x: 0, y: 0 },
    config: {
      label: id
    }
  } as unknown as BlueprintNode;
}

function createNodeRun(
  blueprintRunId: string,
  blueprintId: string,
  nodeId: string,
  nodeType: string,
  status: BlueprintNodeRun["status"]
): BlueprintNodeRun {
  return {
    id: `node-run-${nodeId}`,
    blueprintRunId,
    blueprintId,
    nodeId,
    nodeLabel: nodeId,
    nodeType,
    status,
    queuedAt: new Date().toISOString(),
    ...(status === "succeeded" ? { output: `${nodeId} output` } : {})
  } as unknown as BlueprintNodeRun;
}
