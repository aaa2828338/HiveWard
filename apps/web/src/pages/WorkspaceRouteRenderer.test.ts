import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const pagesDir = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(pagesDir, "..");
const appSource = readFileSync(resolve(pagesDir, "../App.tsx"), "utf8");
const routeRendererSource = readFileSync(resolve(pagesDir, "WorkspaceRouteRenderer.tsx"), "utf8");

describe("page extraction ownership", () => {
  it("keeps page bodies and old page imports out of App", () => {
    expect(appSource).not.toMatch(/function .*Page|const .*Page|renderSection|section ===/);
    expect(appSource).not.toContain("from \"./components/WorkspacePages\"");
    expect(appSource).not.toContain("CompanyDirectoryPage");
    expect(appSource).not.toContain("BlueprintStudioPage");
    expect(appSource).not.toContain("RunsPage");
    expect(appSource).not.toContain("ApprovalsPage");
    expect(existsSync(resolve(srcDir, "components/WorkspacePages.tsx"))).toBe(false);
  });

  it("mounts routes through extracted page modules", () => {
    expect(routeRendererSource).toContain("export type PageProps");
    expect(routeRendererSource).toContain("WorkspaceRouteRenderer");
    expect(routeRendererSource).not.toContain("HivewardHomePage");
    expect(routeRendererSource).toContain("OpenClawControlPanelPage");
    expect(routeRendererSource).toContain("BlueprintStudioPage");
    expect(routeRendererSource).toContain("ApprovalsPage");
  });

  it("does not import backend or store owners from page modules", () => {
    const sources = collectSourceFiles(pagesDir);
    for (const [file, source] of sources) {
      expect(source, file).not.toMatch(/from ["'].*apps\/api/);
      expect(source, file).not.toMatch(/from ["'].*packages\/shared\/src\/store/);
      expect(source, file).not.toMatch(/from ["'].*server|from ["'].*service/);
    }
  });
});

function collectSourceFiles(dir: string): Array<[string, string]> {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return collectSourceFiles(path);
    if (!entry.name.endsWith(".ts") && !entry.name.endsWith(".tsx")) return [];
    return [[path, readFileSync(path, "utf8")]];
  });
}
