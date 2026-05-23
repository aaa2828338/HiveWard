import { describe, expect, it } from "vitest";
import { compareSemver, isNewerVersion, parseSemver } from "./version.js";

describe("CLI version comparison", () => {
  it("parses stable and prerelease versions", () => {
    expect(parseSemver("v1.2.3")).toEqual({ major: 1, minor: 2, patch: 3, prerelease: [] });
    expect(parseSemver("1.2.3-beta.4")).toEqual({ major: 1, minor: 2, patch: 3, prerelease: ["beta", "4"] });
  });

  it("orders prerelease versions below stable versions", () => {
    expect(compareSemver("1.0.0", "1.0.0-beta.1")).toBe(1);
    expect(compareSemver("1.0.0-beta.2", "1.0.0-beta.1")).toBe(1);
  });

  it("detects newer registry candidates", () => {
    expect(isNewerVersion("0.1.0-beta.2", "0.1.0-beta.1")).toBe(true);
    expect(isNewerVersion("0.1.0-beta.1", "0.1.0-beta.1")).toBe(false);
  });
});
