import { describe, expect, it } from "vitest";
import { createDefaultWorkspaceDashboard, normalizeWorkspaceDashboard } from "./workspace";

describe("workspace dashboard contracts", () => {
  it("creates an empty default dashboard state", () => {
    const dashboard = createDefaultWorkspaceDashboard("2026-05-18T00:00:00.000Z");

    expect(dashboard).toEqual({
      dashboardWidgets: [],
      savedViews: [],
      tags: [],
      notes: [],
      updatedAt: "2026-05-18T00:00:00.000Z"
    });
  });

  it("normalizes missing dashboard collections", () => {
    const dashboard = normalizeWorkspaceDashboard(
      {
        updatedAt: "2026-05-18T00:10:00.000Z",
        notes: [
          {
            id: "note-1",
            title: "Ops",
            body: "Check pending approvals.",
            tagIds: [],
            createdAt: "2026-05-18T00:00:00.000Z",
            updatedAt: "2026-05-18T00:10:00.000Z"
          }
        ]
      },
      "2026-05-18T00:00:00.000Z"
    );

    expect(dashboard.dashboardWidgets).toEqual([]);
    expect(dashboard.savedViews).toEqual([]);
    expect(dashboard.tags).toEqual([]);
    expect(dashboard.notes).toHaveLength(1);
    expect(dashboard.updatedAt).toBe("2026-05-18T00:10:00.000Z");
  });
});
