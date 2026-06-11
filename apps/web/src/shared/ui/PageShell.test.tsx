import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EmptyState, ErrorState, PageBody, PageHeader, PageShell, StatusBadge } from "./PageShell";

const uiDir = dirname(fileURLToPath(import.meta.url));
const uiSource = readFileSync(resolve(uiDir, "PageShell.tsx"), "utf8");

describe("shared page shell primitives", () => {
  it("renders page shell, header, actions, and body without business ownership", () => {
    const html = renderToStaticMarkup(
      <PageShell className="custom-page">
        <PageHeader title="Runs" description="Current work" actions={<button type="button">Refresh</button>} />
        <PageBody className="custom-body">Rows</PageBody>
      </PageShell>
    );

    expect(html).toContain("page-shell custom-page");
    expect(html).toContain("page-header");
    expect(html).toContain("page-header-actions");
    expect(html).toContain("page-body custom-body");
    expect(html).toContain("Current work");
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

  it("keeps empty and error states distinct", () => {
    const html = renderToStaticMarkup(
      <>
        <EmptyState title="Nothing here" description="No rows yet." />
        <ErrorState title="Could not load" description="Try again." />
      </>
    );

    expect(html).toContain("ui-empty-state");
    expect(html).toContain("ui-error-state");
    expect(html).toContain("role=\"alert\"");
  });
});
