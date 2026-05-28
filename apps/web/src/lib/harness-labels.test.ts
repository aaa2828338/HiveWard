import { describe, expect, it } from "vitest";
import {
  harnessDisplayLabel,
  harnessDisplayParts,
  harnessLikeDisplayLabel,
  runtimeDisplayLabel,
  runtimeDisplayParts
} from "./harness-labels";

describe("harness display labels", () => {
  it("marks newly added CLI harnesses as beta", () => {
    expect(harnessDisplayLabel("google")).toBe("Google CLI Beta");
    expect(harnessDisplayLabel("cursor")).toBe("Cursor CLI Beta");
    expect(harnessDisplayLabel("opencode")).toBe("OpenCode Beta");
    expect(harnessDisplayLabel("hermes")).toBe("Hermes Beta");
  });

  it("maps blueprint runtime ids to the same beta labels", () => {
    expect(runtimeDisplayLabel("google")).toBe("Google CLI Beta");
    expect(runtimeDisplayLabel("cursor")).toBe("Cursor CLI Beta");
    expect(runtimeDisplayLabel("opencode")).toBe("OpenCode Beta");
    expect(runtimeDisplayLabel("hermes")).toBe("Hermes Beta");
  });

  it("splits beta harness names into a base label and framed badge label for UI rendering", () => {
    expect(harnessDisplayParts("google")).toEqual({ label: "Google CLI", badgeLabel: "Beta" });
    expect(harnessDisplayParts("cursor")).toEqual({ label: "Cursor CLI", badgeLabel: "Beta" });
    expect(harnessDisplayParts("opencode")).toEqual({ label: "OpenCode", badgeLabel: "Beta" });
    expect(harnessDisplayParts("hermes")).toEqual({ label: "Hermes", badgeLabel: "Beta" });
  });

  it("splits beta blueprint runtime names the same way", () => {
    expect(runtimeDisplayParts("google")).toEqual({ label: "Google CLI", badgeLabel: "Beta" });
    expect(runtimeDisplayParts("cursor")).toEqual({ label: "Cursor CLI", badgeLabel: "Beta" });
    expect(runtimeDisplayParts("opencode")).toEqual({ label: "OpenCode", badgeLabel: "Beta" });
    expect(runtimeDisplayParts("hermes")).toEqual({ label: "Hermes", badgeLabel: "Beta" });
  });

  it("keeps legacy claude runtime ids readable", () => {
    expect(harnessLikeDisplayLabel("claude")).toBe("Claude Code");
  });
});
