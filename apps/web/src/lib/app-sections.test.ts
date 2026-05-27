import { describe, expect, it } from "vitest";
import { appSectionGroups } from "./app-sections";

describe("appSectionGroups", () => {
  it("keeps Claude Code model settings on a dedicated Claude Code page", () => {
    const claudeCodeGroup = appSectionGroups.find((group) => group.id === "claudeCode");

    expect(claudeCodeGroup?.sections).toEqual(["claudeCodeConfig", "claudeCodeModels"]);
  });
});
