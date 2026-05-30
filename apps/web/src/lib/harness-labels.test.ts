import { describe, expect, it } from "vitest";
import {
  harnessDisplayLabel,
  harnessDisplayParts,
  harnessLikeDisplayLabel,
  runtimeDisplayLabel,
  runtimeDisplayParts
} from "./harness-labels";

describe("harness display labels", () => {
  it("keeps CLI harness labels direct", () => {
    expect(harnessDisplayLabel("google")).toBe("Google CLI");
    expect(harnessDisplayLabel("cursor")).toBe("Cursor CLI");
    expect(harnessDisplayLabel("opencode")).toBe("OpenCode");
    expect(harnessDisplayLabel("hermes")).toBe("Hermes");
  });

  it("maps blueprint runtime ids to the same direct labels", () => {
    expect(runtimeDisplayLabel("google")).toBe("Google CLI");
    expect(runtimeDisplayLabel("cursor")).toBe("Cursor CLI");
    expect(runtimeDisplayLabel("opencode")).toBe("OpenCode");
    expect(runtimeDisplayLabel("hermes")).toBe("Hermes");
  });

  it("splits CLI harness names without status badges", () => {
    expect(harnessDisplayParts("google")).toEqual({ label: "Google CLI" });
    expect(harnessDisplayParts("cursor")).toEqual({ label: "Cursor CLI" });
    expect(harnessDisplayParts("opencode")).toEqual({ label: "OpenCode" });
    expect(harnessDisplayParts("hermes")).toEqual({ label: "Hermes" });
  });

  it("splits blueprint runtime names the same way", () => {
    expect(runtimeDisplayParts("google")).toEqual({ label: "Google CLI" });
    expect(runtimeDisplayParts("cursor")).toEqual({ label: "Cursor CLI" });
    expect(runtimeDisplayParts("opencode")).toEqual({ label: "OpenCode" });
    expect(runtimeDisplayParts("hermes")).toEqual({ label: "Hermes" });
  });

  it("keeps legacy claude runtime ids readable", () => {
    expect(harnessLikeDisplayLabel("claude")).toBe("Claude Code");
  });
});
