import { describe, expect, it } from "vitest";
import type { BlueprintDefinition } from "@hiveward/shared";
import {
  applyBlueprintUpdaterToCollection,
  isSameBlueprintSnapshot,
  listDirtyBlueprintsForAutosave,
  mergeBlueprintsPreservingLocalEdits
} from "./blueprint-edit-state";

describe("blueprint edit state", () => {
  it("keeps the selected blueprint and blueprint list in sync after an edit", () => {
    const selected = createBlueprint("blueprint-a", "Draft A");
    const untouched = createBlueprint("blueprint-b", "Draft B");

    const result = applyBlueprintUpdaterToCollection(selected, [selected, untouched], (current) => ({
      ...current,
      nodes: [
        ...current.nodes,
        {
          id: "agent-1",
          type: "agent",
          position: { x: 10, y: 20 },
          runtimeId: "codex",
          config: { label: "Research", agentName: "Research", prompt: "Research", tools: [] }
        }
      ],
      updatedAt: "2026-05-28T10:00:00.000Z"
    }));

    expect(result.changed).toBe(true);
    expect(result.blueprint?.nodes).toHaveLength(1);
    expect(result.blueprints.find((item) => item.id === "blueprint-a")?.nodes).toHaveLength(1);
    expect(result.blueprints.find((item) => item.id === "blueprint-b")).toBe(untouched);
  });

  it("preserves dirty local blueprints when a server refresh returns older snapshots", () => {
    const localDirty = {
      ...createBlueprint("blueprint-a", "Local draft"),
      nodes: [
        {
          id: "agent-1",
          type: "agent",
          position: { x: 10, y: 20 },
          runtimeId: "codex",
          config: { label: "Unsaved agent", agentName: "Unsaved agent", prompt: "Do work", tools: [] }
        }
      ]
    } satisfies BlueprintDefinition;
    const localOnlyDirty = createBlueprint("blueprint-local", "Still local");
    const serverStale = createBlueprint("blueprint-a", "Server draft");
    const serverFresh = createBlueprint("blueprint-b", "Server fresh");

    expect(
      mergeBlueprintsPreservingLocalEdits(
        [serverStale, serverFresh],
        [localDirty, localOnlyDirty],
        new Set(["blueprint-a", "blueprint-local"])
      )
    ).toEqual([localDirty, serverFresh, localOnlyDirty]);
  });

  it("selects every dirty blueprint available for periodic autosave", () => {
    const first = createBlueprint("blueprint-a", "First");
    const second = createBlueprint("blueprint-b", "Second");
    const clean = createBlueprint("blueprint-c", "Clean");

    expect(listDirtyBlueprintsForAutosave([first, second, clean], new Set(["missing", "blueprint-b", "blueprint-a"]))).toEqual([
      first,
      second
    ]);
  });

  it("detects when a blueprint changed while autosave was in flight", () => {
    const snapshot = createBlueprint("blueprint-a", "Draft");
    const changed = {
      ...snapshot,
      nodes: [
        {
          id: "agent-1",
          type: "agent",
          position: { x: 10, y: 20 },
          runtimeId: "codex",
          config: { label: "Late edit", agentName: "Late edit", prompt: "Keep me", tools: [] }
        }
      ]
    } satisfies BlueprintDefinition;

    expect(isSameBlueprintSnapshot(snapshot, snapshot)).toBe(true);
    expect(isSameBlueprintSnapshot(changed, snapshot)).toBe(false);
  });
});

function createBlueprint(id: string, name: string): BlueprintDefinition {
  return {
    id,
    companyId: "company-1",
    name,
    version: 1,
    nodes: [],
    edges: [],
    variables: {},
    display: { viewport: { x: 0, y: 0, zoom: 1 } },
    createdAt: "2026-05-28T09:00:00.000Z",
    updatedAt: "2026-05-28T09:00:00.000Z"
  };
}
