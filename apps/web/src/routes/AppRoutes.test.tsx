import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import type { Language } from "../lib/i18n";
import { AppRoutes } from "./AppRoutes";
import type { RouteId } from "./route-registry";

function renderRoute(path: string, selectedCompanyId?: string, language: Language = "en") {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes language={language} renderRoute={(routeId: RouteId) => <main>{routeId}</main>} selectedCompanyId={selectedCompanyId} />
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

  it("projects route guard copy through the selected language", () => {
    const html = renderRoute("/blueprint", undefined, "zh-CN");

    expect(html).toContain("需要公司");
    expect(html).toContain("选择公司");
  });

  it("keeps the removed root route as not-found instead of a normal product page", () => {
    const html = renderRoute("/");

    expect(html).toContain("This page does not exist");
    expect(html).not.toContain("<main>");
  });
});
