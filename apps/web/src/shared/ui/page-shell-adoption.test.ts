import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const uiDir = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(uiDir, "../..");
const appLayoutSource = readFileSync(resolve(srcDir, "layouts/AppLayout.tsx"), "utf8");
const chatPageSource = readFileSync(resolve(srcDir, "components/ChatPage.tsx"), "utf8");
const blueprintPageSource = readFileSync(resolve(srcDir, "components/BlueprintStudioPage.tsx"), "utf8");
const workspacePagesSource = readFileSync(resolve(srcDir, "pages/workspace/WorkspacePages.tsx"), "utf8");
const systemPagesSource = readFileSync(resolve(srcDir, "pages/system/SystemPages.tsx"), "utf8");
const runRoomOutputSource = readFileSync(resolve(srcDir, "components/RunRoomOutputView.tsx"), "utf8");
const pageShellSource = readFileSync(resolve(srcDir, "shared/ui/PageShell.tsx"), "utf8");
const pageShellStylesSource = readFileSync(resolve(srcDir, "shared/styles/page-shell.css"), "utf8");
const globalStylesSource = readFileSync(resolve(srcDir, "styles.css"), "utf8");
const normalProductSources = [
  appLayoutSource,
  chatPageSource,
  blueprintPageSource,
  runRoomOutputSource,
  workspacePagesSource,
  systemPagesSource
].join("\n");
const oldTracePageGrid = [["trace", "page", "grid"].join("-"), "blueprint-kanban-page"].join(" ");
const oldTraceLayout = [["trace", "layout"].join("-"), "blueprint-kanban-layout"].join(" ");
const oldTraceColumnShell = [["trace", "column", "shell"].join("-"), "blueprint-kanban-lane"].join(" ");
const oldTraceColumnHeader = [["trace", "column", "header"].join("-"), "blueprint-kanban-lane-header"].join(" ");
const oldChatTraceTitle = [["trace", "page", "title"].join("-"), "chat-page-title"].join(" ");
const forbiddenPageTitleClasses = [
  "openclaw-page-title",
  "openclaw-panel-title",
  "blueprint-kanban-title",
  "runs-page-title",
  "chat-page-title-copy",
  "inbox-page-title",
  "trace-page-header"
];
const forbiddenPageRootLayoutClasses = [
  "trace-page-grid",
  "runs-page-grid"
];

describe("page shell adoption", () => {
  it("keeps AppLayout from owning the page shell class", () => {
    expect(appLayoutSource).not.toContain('className="page-shell"');
    expect(appLayoutSource).not.toContain('<main className="app-shell"');
    expect(appLayoutSource).toContain('"app-content-shell"');
  });

  it("keeps PageBody as the page landmark owner", () => {
    expect(pageShellSource).toContain('<main className={cx("page-body", className)}');
    expect(appLayoutSource).toContain('<div className="app-shell">');
  });

  it("keeps ChatPage on shared page shell instead of trace page title", () => {
    expect(chatPageSource).toContain("PageShell");
    expect(chatPageSource).toContain("PageHeader");
    expect(chatPageSource).not.toContain(oldChatTraceTitle);
  });

  it("keeps PageHeader as the only normal page title structure", () => {
    expect(pageShellSource).toContain("leading?: ReactNode");
    expect(pageShellSource).toContain("page-header-main");
    expect(sliceFunctionSource(pageShellSource, "type PageHeaderProps", "type PageBodyProps")).not.toContain("children?: ReactNode;");
    expect(pageShellSource).not.toContain("if (children)");
    expect([...workspacePagesSource.matchAll(/<PageHeader\s+className=/g)]).toHaveLength(0);
    expect([...systemPagesSource.matchAll(/<PageHeader\s+className=/g)]).toHaveLength(0);
    expect([...chatPageSource.matchAll(/<PageHeader\s+className=/g)]).toHaveLength(0);
  });

  it("keeps normal page headers on one fixed title geometry", () => {
    expect(pageShellStylesSource).toContain("--page-header-copy-min-height");
    expect(pageShellStylesSource).toContain("--page-header-actions-min-height");
    expect(pageShellStylesSource).toMatch(/\.page-header\s*\{[^}]*align-items:\s*start;/s);
    expect(pageShellStylesSource).toMatch(/\.page-header-main\s*\{[^}]*align-items:\s*start;/s);
    expect(pageShellStylesSource).toMatch(/\.page-header-copy\s*\{[^}]*min-height:\s*var\(--page-header-copy-min-height\);/s);
    expect(pageShellStylesSource).toMatch(/\.page-header-actions\s*\{[^}]*min-height:\s*var\(--page-header-actions-min-height\);/s);
  });

  it("keeps Runs and Inbox titles on the shared page header without page-root layout overrides", () => {
    const runsSource = sliceFunctionSource(workspacePagesSource, "export function RunsPage", "type RunArtifact");
    const approvalsSource = sliceFunctionSource(workspacePagesSource, "export function ApprovalsPage", "type HumanActionInboxEntry");

    expect(runsSource).toContain('<PageShell className="runs-page">');
    expect(runsSource).toContain("<Toolbar");
    expect(runsSource).toContain("<Button");
    expect(approvalsSource).toContain('<PageShell className="approvals-page">');
    forbiddenPageRootLayoutClasses.forEach((className) => {
      expect(runsSource).not.toContain(className);
      expect(approvalsSource).not.toContain(className);
      expect(globalStylesSource).not.toContain(`.${className}`);
    });
    expect(globalStylesSource).not.toMatch(/^\.approvals-page\s*\{/m);
  });

  it("keeps BlueprintKanbanPage off run trace layout primitives", () => {
    const start = workspacePagesSource.indexOf("export function BlueprintKanbanPage");
    const end = workspacePagesSource.indexOf("function blueprintKanbanLaneLabel");
    const kanbanSource = workspacePagesSource.slice(start, end);

    expect(kanbanSource).toContain("PageShell");
    expect(kanbanSource).toContain("PageBody");
    expect(kanbanSource).not.toContain(oldTracePageGrid);
    expect(kanbanSource).not.toContain(oldTraceLayout);
    expect(kanbanSource).not.toContain(oldTraceColumnShell);
    expect(kanbanSource).not.toContain(oldTraceColumnHeader);
  });

  it.each([
    ["CompanyDirectoryPage", "function CompanyPage"],
    ["CompanyPage", "export function RunsPage"],
    ["RunsPage", "type RunArtifact"],
    ["ApprovalsPage", "type HumanActionInboxEntry"],
    ["DashboardPage", "export function ModelsPage"],
    ["ModelsPage", "export type ConfiguredModelCardModel"],
    ["AgentsPage", "export function SkillsPage"],
    ["SkillsPage", "function runResultTitle"],
    ["ChannelsPage", "function WidgetCard"]
  ])("keeps %s on the shared standard page shell", (functionName, nextMarker) => {
    const pageSource = sliceFunctionSource(workspacePagesSource, `export function ${functionName}`, nextMarker);
    expect(pageSource).toContain("<PageShell");
    expect(pageSource).toContain("<PageHeader");
    expect(pageSource).toContain("<PageBody");
    expect(pageSource).not.toContain('<section className="page-grid');
  });

  it.each([
    ["OpenClawControlPanelPage", "export function HarnessConfigPage"],
    ["HarnessConfigPage", "type ClaudeCodeModelSlotField"],
    ["ClaudeCodeModelsPage", "export function HermesModelsPage"],
    ["HermesModelsPage", "export function HermesAgentsPage"],
    ["HermesAgentsPage", "export function HarnessSkillsPage"],
    ["HarnessSkillsPage", "export function HermesChannelsPage"],
    ["HermesChannelsPage", "function ClaudeCodeModelConfigCard"]
  ])("keeps %s on the shared standard page shell", (functionName, nextMarker) => {
    const pageSource = sliceFunctionSource(systemPagesSource, `export function ${functionName}`, nextMarker);
    expect(pageSource).toContain("<PageShell");
    expect(pageSource).toContain("<PageHeader");
    expect(pageSource).toContain("<PageBody");
    expect(pageSource).not.toContain('<section className="page-grid');
    expect(pageSource).not.toContain("trace-page-title");
  });

  it("keeps normal page-grid layout inside PageBody instead of page roots", () => {
    expect(workspacePagesSource).not.toContain('<section className="page-grid');
    expect(systemPagesSource).not.toContain('<section className="page-grid');
    expect(workspacePagesSource).toContain('<PageBody className="page-grid page-scroll');
    expect(systemPagesSource).toContain('<PageBody className="page-grid page-scroll');
  });

  it("keeps BlueprintStudioPage on the shared canvas page shell", () => {
    expect(blueprintPageSource).toContain("CanvasPageShell");
    expect(blueprintPageSource).not.toContain('<section className="blueprint-shell compact-blueprint-shell">');
  });

  it("keeps page shell and page-title ownership out of global legacy CSS", () => {
    expect(globalStylesSource).not.toMatch(/^\.page-shell\s*\{/m);
    expect(globalStylesSource).not.toMatch(/^\.trace-page-title\b/m);
    expect(globalStylesSource).not.toMatch(/^\.company-directory-header\b/m);
    expect(globalStylesSource).not.toContain(".company-directory-header .card-title-block h3");
    expect(globalStylesSource).not.toContain(".company-directory-page .page-header");
    forbiddenPageTitleClasses.forEach((className) => {
      expect(globalStylesSource).not.toContain(`.${className}`);
      expect(workspacePagesSource).not.toContain(className);
      expect(systemPagesSource).not.toContain(className);
      expect(chatPageSource).not.toContain(className);
    });
  });

  it("keeps reusable fixed component ownership in shared UI", () => {
    [
      "Button",
      "IconButton",
      "CardHeader",
      "PanelHeader",
      "Toolbar",
      "FilterBar",
      "FormField",
      "StatusBadge",
      "EmptyState",
      "ErrorState",
      "LoadingState",
      "Dialog",
      "ConfirmDialog",
      "Tooltip",
      "Tabs",
      "Listbox",
      "SelectMenu"
    ].forEach((componentName) => {
      expect(pageShellSource).toContain(`function ${componentName}`);
    });
  });

  it("keeps shared button hover states in the shared style owner", () => {
    expect(globalStylesSource).toContain("button:hover:not(:disabled)");
    expect(pageShellStylesSource).toContain(".ui-button:hover:not(:disabled)");
    expect(pageShellStylesSource).toContain(".ui-icon-button:hover:not(:disabled)");
  });

  it("forbids old normal product fixed-component class owners", () => {
    [
      "card-title-block",
      "trace-column-header",
      "inbox-list-header",
      "inbox-detail-header",
      "chat-column-header",
      "toolbar-cluster",
      "filter-label",
      "field-control",
      "status-pill",
      "empty-state page-empty",
      "compact-empty-state",
      'className="icon-button"',
      "error-banner"
    ].forEach((oldClassName) => {
      expect(normalProductSources).not.toContain(oldClassName);
    });
    expect(normalProductSources).not.toContain("window.confirm");
  });
});

function sliceFunctionSource(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}
