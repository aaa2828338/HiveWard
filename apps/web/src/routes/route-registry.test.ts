import { describe, expect, it } from "vitest";
import {
  getRouteById,
  getRouteGuardState,
  routeNavigationGroups,
  routeRegistry,
  routePathById
} from "./route-registry";

describe("routeRegistry", () => {
  it("preserves the operator navigation group order", () => {
    expect(routeNavigationGroups.map((group) => group.systemId)).toEqual([
      "hiveward",
      "codex",
      "claudeCode",
      "openclaw",
      "hermes",
      "google",
      "cursor",
      "opencode"
    ]);
  });

  it("registers primary product paths explicitly", () => {
    expect(routePathById.blueprint).toBe("/blueprint");
    expect(routePathById.runs).toBe("/runs");
    expect(routePathById.approvals).toBe("/approvals");
    expect(routePathById.company).toBe("/company");
    expect(routePathById.companyDirectory).toBe("/companies");
  });

  it("keeps company-required routing in an explicit guard field", () => {
    expect(getRouteById("blueprint").requiresCompany).toBe(true);
    expect(getRouteById("companyDirectory").requiresCompany).toBe(false);
    expect(getRouteGuardState(getRouteById("blueprint"), undefined)).toBe("requiresCompany");
    expect(getRouteGuardState(getRouteById("blueprint"), "company-1")).toBe("available");
    expect(getRouteGuardState(getRouteById("companyDirectory"), undefined)).toBe("available");
  });

  it("uses one registry record per route id and path", () => {
    const routeIds = new Set(routeRegistry.map((route) => route.id));
    const routePaths = new Set(routeRegistry.map((route) => route.path));

    expect(routeIds.size).toBe(routeRegistry.length);
    expect(routePaths.size).toBe(routeRegistry.length);
  });
});
