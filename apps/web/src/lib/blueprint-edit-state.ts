import type { BlueprintDefinition } from "@hiveward/shared";

export function applyBlueprintUpdaterToCollection(
  blueprint: BlueprintDefinition | undefined,
  blueprints: BlueprintDefinition[],
  updater: (current: BlueprintDefinition) => BlueprintDefinition
): { blueprint: BlueprintDefinition | undefined; blueprints: BlueprintDefinition[]; changed: boolean } {
  if (!blueprint) {
    return { blueprint, blueprints, changed: false };
  }

  const nextBlueprint = updater(blueprint);
  if (blueprintSignature(nextBlueprint) === blueprintSignature(blueprint)) {
    return { blueprint, blueprints, changed: false };
  }

  return {
    blueprint: nextBlueprint,
    blueprints: replaceBlueprint(blueprints, nextBlueprint),
    changed: true
  };
}

export function replaceBlueprint(blueprints: BlueprintDefinition[], blueprint: BlueprintDefinition): BlueprintDefinition[] {
  let replaced = false;
  const next = blueprints.map((candidate) => {
    if (candidate.id !== blueprint.id) return candidate;
    replaced = true;
    return blueprint;
  });
  return replaced ? next : [blueprint, ...next];
}

export function mergeBlueprintsPreservingLocalEdits(
  serverBlueprints: BlueprintDefinition[],
  localBlueprints: BlueprintDefinition[],
  dirtyBlueprintIds: Set<string>
): BlueprintDefinition[] {
  if (dirtyBlueprintIds.size === 0) return serverBlueprints;

  const localById = new Map(localBlueprints.map((blueprint) => [blueprint.id, blueprint]));
  const serverIds = new Set<string>();
  const merged = serverBlueprints.map((serverBlueprint) => {
    serverIds.add(serverBlueprint.id);
    return dirtyBlueprintIds.has(serverBlueprint.id) ? localById.get(serverBlueprint.id) ?? serverBlueprint : serverBlueprint;
  });

  for (const localBlueprint of localBlueprints) {
    if (serverIds.has(localBlueprint.id) || !dirtyBlueprintIds.has(localBlueprint.id)) continue;
    merged.push(localBlueprint);
  }

  return merged;
}

export function listDirtyBlueprintsForAutosave(
  blueprints: BlueprintDefinition[],
  dirtyBlueprintIds: Set<string>
): BlueprintDefinition[] {
  if (dirtyBlueprintIds.size === 0) return [];
  return blueprints.filter((blueprint) => dirtyBlueprintIds.has(blueprint.id));
}

export function blueprintCollectionSignature(blueprints: BlueprintDefinition[]): string {
  return JSON.stringify([...blueprints].sort((left, right) => left.id.localeCompare(right.id)));
}

export function isSameBlueprintSnapshot(left: BlueprintDefinition, right: BlueprintDefinition): boolean {
  return blueprintSignature(left) === blueprintSignature(right);
}

export function markBlueprintDirty(dirtyBlueprintIds: Set<string>, blueprintId: string): Set<string> {
  if (dirtyBlueprintIds.has(blueprintId)) return dirtyBlueprintIds;
  return new Set([...dirtyBlueprintIds, blueprintId]);
}

export function clearBlueprintDirty(dirtyBlueprintIds: Set<string>, blueprintId: string): Set<string> {
  if (!dirtyBlueprintIds.has(blueprintId)) return dirtyBlueprintIds;
  const next = new Set(dirtyBlueprintIds);
  next.delete(blueprintId);
  return next;
}

export function removeBlueprintFromDirtySet(dirtyBlueprintIds: Set<string>, blueprintId: string): Set<string> {
  return clearBlueprintDirty(dirtyBlueprintIds, blueprintId);
}

function blueprintSignature(blueprint: BlueprintDefinition): string {
  return JSON.stringify(blueprint);
}
