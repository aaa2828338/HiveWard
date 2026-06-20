import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { Sidebar, type SidebarProps } from "./Sidebar";

const baseSidebarProps: SidebarProps = {
  activityMeta: {},
  companySwitcherLabel: "Choose company",
  dashboardDirty: false,
  dirtyWorkspaceLabel: "Dirty workspace",
  expandedSystems: {
    hiveward: true,
    codex: true,
    claudeCode: true,
    openclaw: true,
    hermes: true,
    google: true,
    cursor: true,
    opencode: true
  },
  hivewardUpdateBadge: "New",
  hivewardUpdateAvailable: false,
  hivewardVersionLabel: "v0.0.0",
  hivewardVersionTitle: "HiveWard version",
  language: "en",
  languageSwitchTitle: "Switch language",
  navigationLabels: {
    approvals: "Inbox",
    blueprint: "Blueprint",
    chat: "Chat",
    company: "Company",
    runs: "Runs"
  },
  selectedCompanyName: "HiveWard",
  selectedCompanyLogoUrl: undefined,
  systemMenuOpen: false,
  systemMenuRef: { current: null },
  systemUi: {
    language: "Language",
    settings: "Settings",
    theme: "Theme",
    title: "System"
  },
  theme: "light",
  themeToggleLabel: "Day",
  themeToggleTitle: "Switch theme",
  onCheckHivewardUpdate: () => undefined,
  onCloseSystemMenu: () => undefined,
  onToggleLanguage: () => undefined,
  onToggleSystemGroup: () => undefined,
  onToggleSystemMenu: () => undefined,
  onToggleTheme: () => undefined
};

function renderSidebar(path: string, props: Partial<SidebarProps> = {}) {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[path]}>
      <Sidebar {...baseSidebarProps} {...props} />
    </MemoryRouter>
  );
}

describe("Sidebar", () => {
  it("renders navigation links from the route registry", () => {
    const html = renderSidebar("/blueprint");

    expect(html).toContain('href="/blueprint"');
    expect(html).toContain('href="/runs"');
    expect(html).toContain('href="/approvals"');
    expect(html).toContain('href="/company"');
  });

  it("marks the active route from the router location", () => {
    const html = renderSidebar("/runs");

    expect(html).toContain('href="/runs"');
    expect(html).toContain("nav-item active");
  });

  it("opens a collapsed route group when the current location is inside it", () => {
    const html = renderSidebar("/codex", {
      expandedSystems: {
        ...baseSidebarProps.expandedSystems,
        codex: false
      }
    });

    expect(html).toContain("nav-system-toggle active");
    expect(html).toContain('href="/codex"');
    expect(html).toContain("nav-item active");
  });

  it("marks utility sidebar links active from the router location", () => {
    const companiesHtml = renderSidebar("/companies");

    expect(companiesHtml).toContain("sidebar-company-switcher active");
  });

  it("does not expose the removed root route as a sidebar link", () => {
    const html = renderSidebar("/blueprint");

    expect(html).not.toContain('href="/"');
    expect(html).toContain("sidebar-system-version online");
  });
});
