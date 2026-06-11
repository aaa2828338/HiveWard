import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { AppRoutes } from "./AppRoutes";
import type { RouteId } from "./route-registry";

function renderRoute(path: string, selectedCompanyId?: string) {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes renderRoute={(routeId: RouteId) => <main>{routeId}</main>} selectedCompanyId={selectedCompanyId} />
    </MemoryRouter>
  );
}

describe("AppRoutes", () => {
  it("blocks company-required pages when no company is selected", () => {
    const html = renderRoute("/blueprint");

    expect(html).toContain("Company required");
    expect(html).toContain("/companies");
    expect(html).not.toContain("<main>blueprint</main>");
  });

  it("keeps non-company pages accessible without selected company", () => {
    const html = renderRoute("/codex");

    expect(html).toContain("<main>codexConfig</main>");
    expect(html).not.toContain("Company required");
  });
});
