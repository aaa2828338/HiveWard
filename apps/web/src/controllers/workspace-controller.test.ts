import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const controllerSource = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../app/useWorkspaceController.ts"), "utf8");

describe("workspace controller source ownership", () => {
  it("owns workspace API calls outside the app shell", () => {
    expect(controllerSource).toContain("export function useWorkspaceController");
    expect(controllerSource).toMatch(/api\.listCompanies\(\)/);
    expect(controllerSource).toMatch(/api\.saveBlueprint\(/);
    expect(controllerSource).toMatch(/api\.getBlueprintRun\(/);
    expect(controllerSource).toMatch(/api\.listHumanActionQueue\(/);
  });
});
