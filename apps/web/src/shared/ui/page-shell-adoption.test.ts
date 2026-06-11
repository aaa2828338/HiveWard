import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const uiDir = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(uiDir, "../..");
const chatPageSource = readFileSync(resolve(srcDir, "components/ChatPage.tsx"), "utf8");
const workspacePagesSource = readFileSync(resolve(srcDir, "pages/workspace/WorkspacePages.tsx"), "utf8");
const oldTracePageGrid = [["trace", "page", "grid"].join("-"), "blueprint-kanban-page"].join(" ");
const oldTraceLayout = [["trace", "layout"].join("-"), "blueprint-kanban-layout"].join(" ");
const oldTraceColumnShell = [["trace", "column", "shell"].join("-"), "blueprint-kanban-lane"].join(" ");
const oldTraceColumnHeader = [["trace", "column", "header"].join("-"), "blueprint-kanban-lane-header"].join(" ");
const oldChatTraceTitle = [["trace", "page", "title"].join("-"), "chat-page-title"].join(" ");

describe("page shell adoption", () => {
  it("keeps ChatPage on shared page shell instead of trace page title", () => {
    expect(chatPageSource).toContain("PageShell");
    expect(chatPageSource).toContain("PageHeader");
    expect(chatPageSource).not.toContain(oldChatTraceTitle);
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
});
