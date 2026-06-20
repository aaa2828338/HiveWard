import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../App.tsx"), "utf8");
const controllerSource = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "useWorkspaceController.ts"), "utf8");

describe("useWorkspaceController ownership", () => {
  it("keeps workspace API orchestration out of App", () => {
    expect(appSource).not.toMatch(/api\.|hydrateWorkspace|applyRunView|withBusy/);
    expect(appSource).not.toMatch(/BLUEPRINT_AUTOSAVE_INTERVAL_MS|RUN_POLL_INTERVAL_MS|BLUEPRINT_CHANGE_POLL_INTERVAL_MS/);
  });

  it("owns the workspace load, autosave, run polling, and approval refresh paths", () => {
    expect(controllerSource).toContain("export function useWorkspaceController");
    expect(controllerSource).toMatch(/api\.listCompanies\(\)/);
    expect(controllerSource).toMatch(/api\.saveBlueprint\(/);
    expect(controllerSource).toMatch(/api\.getBlueprintRun\(/);
    expect(controllerSource).toMatch(/api\.listHumanActionQueue\(/);
  });
});
