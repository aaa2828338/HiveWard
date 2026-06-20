import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  Button,
  CanvasPageShell,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  FilterBar,
  FormField,
  IconButton,
  Listbox,
  LoadingState,
  PageActions,
  PageBody,
  PageHeader,
  PageShell,
  Panel,
  PanelBody,
  PanelHeader,
  SelectControl,
  StateBoundary,
  StatusBadge,
  Tabs,
  Toolbar,
  Tooltip
} from "./PageShell";

const uiDir = dirname(fileURLToPath(import.meta.url));
const uiSource = readFileSync(resolve(uiDir, "PageShell.tsx"), "utf8");

describe("shared page shell primitives", () => {
  it("renders page shell, header, actions, and body without business ownership", () => {
    const html = renderToStaticMarkup(
      <PageShell className="custom-page">
        <PageHeader
          leading={<span>R</span>}
          title="Runs"
          description="Current work"
          actions={<PageActions><Button>Refresh</Button></PageActions>}
        />
        <PageBody className="custom-body">Rows</PageBody>
      </PageShell>
    );

    expect(html).toContain("page-shell custom-page");
    expect(html).toContain("page-header");
    expect(html).toContain("page-header-leading");
    expect(html).toContain("page-header-actions");
    expect(html).toContain("page-body custom-body");
    expect(html).toContain("Current work");
  });

  it("renders card, panel, toolbar, filter, and form primitives as business-agnostic fixed components", () => {
    const html = renderToStaticMarkup(
      <Card>
        <CardHeader title="Models" description="Configured models" actions={<Toolbar><Button variant="primary">Save</Button></Toolbar>} />
        <CardBody>
          <FilterBar>
            <FormField label="Provider" compact>
              <SelectControl value="all" onChange={() => undefined}>
                <option value="all">All</option>
              </SelectControl>
            </FormField>
          </FilterBar>
          <Panel>
            <PanelHeader title="Details" />
            <PanelBody>Rows</PanelBody>
          </Panel>
        </CardBody>
      </Card>
    );

    expect(html).toContain("ui-card");
    expect(html).toContain("ui-card-header");
    expect(html).toContain("ui-panel-header");
    expect(html).toContain("ui-toolbar");
    expect(html).toContain("ui-filter-bar");
    expect(html).toContain("ui-form-field");
  });

  it("requires IconButton accessible labels and renders icon-only controls through shared ownership", () => {
    const html = renderToStaticMarkup(<IconButton label="Remove widget" icon={<span>x</span>} />);

    expect(html).toContain("ui-icon-button");
    expect(html).toContain("aria-label=\"Remove widget\"");
    expect(() => renderToStaticMarkup(<IconButton label="" icon={<span>x</span>} />)).toThrow("IconButton requires");
  });

  it("requires explicit StatusBadge tone instead of label inference", () => {
    const html = renderToStaticMarkup(<StatusBadge label="Waiting" tone="warning" />);
    const wordA = "lab" + "el";
    const wordB = "stat" + "us";
    const wordC = "incl" + "udes";
    const displayTextPattern = new RegExp([wordA, wordC].join(".*"));
    const stateTextPattern = new RegExp([wordB, wordC].join(".*"));

    expect(html).toContain("ui-status-badge-warning");
    expect(html).toContain("Waiting");
    expect(uiSource).not.toMatch(displayTextPattern);
    expect(uiSource).not.toMatch(stateTextPattern);
  });

  it("renders canvas shell separately from normal page shell", () => {
    const html = renderToStaticMarkup(<CanvasPageShell className="custom-canvas">Canvas</CanvasPageShell>);

    expect(html).toContain("canvas-page-shell custom-canvas");
    expect(html).not.toContain('class="page-shell');
  });

  it("keeps empty and error states distinct", () => {
    const html = renderToStaticMarkup(
      <>
        <EmptyState title="Nothing here" description="No rows yet." />
        <ErrorState title="Could not load" description="Try again." />
        <LoadingState title="Loading" description="Please wait." />
      </>
    );

    expect(html).toContain("ui-empty-state");
    expect(html).toContain("ui-error-state");
    expect(html).toContain("ui-loading-state");
    expect(html).toContain("role=\"alert\"");
    expect(html).toContain("role=\"status\"");
  });

  it("renders state boundary and confirm dialog through shared primitives", () => {
    const html = renderToStaticMarkup(
      <>
        <StateBoundary
          state="empty"
          loading={{ title: "Loading" }}
          empty={{ title: "No rows" }}
          error={{ title: "Failed" }}
        >
          Rows
        </StateBoundary>
        <ConfirmDialog
          open
          title="Delete company"
          body="This cannot be undone."
          confirmLabel="Delete"
          cancelLabel="Cancel"
          destructive
          onCancel={() => undefined}
          onConfirm={() => undefined}
        />
      </>
    );

    expect(html).toContain("No rows");
    expect(html).toContain("ui-dialog");
    expect(html).toContain("Delete company");
    expect(html).toContain("ui-button-danger");
  });

  it("renders tooltip, tabs, and listbox control contracts", () => {
    const html = renderToStaticMarkup(
      <>
        <Tooltip label="Helpful detail"><button type="button">?</button></Tooltip>
        <Tabs label="Output tabs" value="current" options={[{ value: "current", label: "Current" }]} onChange={() => undefined} />
        <Listbox label="Rows" value="one" options={[{ value: "one", label: "One", description: "First" }]} onChange={() => undefined} />
      </>
    );

    expect(html).toContain("ui-tooltip");
    expect(html).toContain("role=\"tablist\"");
    expect(html).toContain("role=\"listbox\"");
  });
});
