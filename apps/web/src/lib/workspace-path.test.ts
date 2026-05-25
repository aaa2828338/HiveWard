import { describe, expect, it } from "vitest";
import { formatWorkspacePathPlaceholder, joinWorkspacePath } from "./workspace-path";

describe("workspace path formatting", () => {
  it("uses POSIX separators for macOS and Linux workspace roots", () => {
    expect(joinWorkspacePath("/Users/alice/.openclaw/workspace", "researcher")).toBe(
      "/Users/alice/.openclaw/workspace/researcher"
    );
    expect(formatWorkspacePathPlaceholder("/Users/alice/.openclaw/workspace")).toBe(
      "/Users/alice/.openclaw/workspace/<agent-id>"
    );
  });

  it("keeps Windows separators for Windows workspace roots", () => {
    expect(joinWorkspacePath("D:\\HiveWard\\workspace", "researcher")).toBe(
      "D:\\HiveWard\\workspace\\researcher"
    );
    expect(formatWorkspacePathPlaceholder("D:\\HiveWard\\workspace")).toBe(
      "D:\\HiveWard\\workspace\\<agent-id>"
    );
  });

  it("handles filesystem roots without duplicating separators", () => {
    expect(joinWorkspacePath("/", "researcher")).toBe("/researcher");
    expect(joinWorkspacePath("C:\\", "researcher")).toBe("C:\\researcher");
  });
});
