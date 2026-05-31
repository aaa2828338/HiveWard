import { describe, expect, it } from "vitest";
import { appSectionGroups, appSystemLabels } from "./app-sections";

describe("appSectionGroups", () => {
  it("orders harness groups by operator priority", () => {
    expect(appSectionGroups.map((group) => group.id)).toEqual([
      "hiveward",
      "codex",
      "claudeCode",
      "openclaw",
      "hermes",
      "google",
      "cursor",
      "opencode"
    ]);
  });

  it("keeps Claude Code model settings on a dedicated Claude Code page", () => {
    const claudeCodeGroup = appSectionGroups.find((group) => group.id === "claudeCode");

    expect(claudeCodeGroup?.sections).toEqual(["claudeCodeConfig", "claudeCodeModels"]);
  });

  it("keeps the company directory out of the primary Hiveward navigation group", () => {
    const hivewardGroup = appSectionGroups.find((group) => group.id === "hiveward");

    expect(hivewardGroup?.sections).toEqual(["chat", "blueprint", "runs", "approvals", "schedule"]);
  });

  it("gives Hermes the same operator-facing sections as OpenClaw", () => {
    const hermesGroup = appSectionGroups.find((group) => group.id === "hermes");

    expect(hermesGroup?.sections).toEqual(["hermesConfig", "hermesModels", "hermesAgents", "hermesSkills", "hermesChannels"]);
  });

  it("keeps CLI system group labels direct", () => {
    expect(appSystemLabels.google).toBe("Google CLI");
    expect(appSystemLabels.cursor).toBe("Cursor CLI");
    expect(appSystemLabels.opencode).toBe("OpenCode");
    expect(appSystemLabels.hermes).toBe("Hermes");
  });
});
