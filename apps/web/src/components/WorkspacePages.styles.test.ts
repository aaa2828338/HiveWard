import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const styles = readFileSync(fileURLToPath(new URL("../styles.css", import.meta.url)), "utf8");

const cssRule = (selectorPattern: string): string => {
  const match = styles.match(new RegExp(`${selectorPattern}\\s*\\{([\\s\\S]*?)\\}`));
  expect(match, `Missing CSS rule for ${selectorPattern}`).not.toBeNull();
  return match?.[1] ?? "";
};

describe("RunsPage work card tag styles", () => {
  it("keeps role and work tags aligned with status chip sizing", () => {
    const sharedTagRule = cssRule("\\.trace-role-tag,\\s*\\.trace-work-tag");

    expect(sharedTagRule).toContain("min-height: 22px;");
    expect(sharedTagRule).toContain("border: 1px solid currentColor;");
    expect(sharedTagRule).toContain("font-size: 11px;");
    expect(sharedTagRule).toContain("font-weight: 760;");
  });

  it("renders Manager and Agent role tags with white text", () => {
    expect(cssRule("\\.trace-role-tag")).toContain("color: #ffffff;");
    expect(cssRule("\\.trace-role-tag-manager")).toContain("color: #ffffff;");
    expect(cssRule("\\.trace-role-tag-agent")).toContain("color: #ffffff;");
  });

  it("keeps generic issue text styling from overriding tag colors", () => {
    const issueTextRule = cssRule("\\.trace-issue-main span:not\\(\\.trace-status-chip\\):not\\(\\.trace-role-tag\\):not\\(\\.trace-work-tag\\)");

    expect(issueTextRule).toContain("color: var(--muted);");
    expect(styles).not.toMatch(/(^|\n)\.trace-issue-main span\s*\{/);
    expect(styles).not.toMatch(/(^|\n)\.trace-issue-main span,\n/);
  });

  it("uses tinted outlined work tags instead of solid filled blocks", () => {
    const tones = ["research", "requirements", "planning", "dispatch", "page", "qa", "review", "artifact", "issue"];

    for (const tone of tones) {
      const rule = cssRule(`\\.trace-work-tag-${tone}`);

      expect(rule).toMatch(/color:\s*#[0-9a-f]{6};/i);
      expect(rule).toMatch(/background:\s*rgb\([^;]+\/\s*0\.\d+\);/i);
      expect(rule).not.toMatch(/^\s*background:\s*#[0-9a-f]{3,6};\s*$/im);
    }
  });
});
