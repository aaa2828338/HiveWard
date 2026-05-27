import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const styles = readFileSync(fileURLToPath(new URL("../styles.css", import.meta.url)), "utf8");

function cssRulesContaining(selector: string): string[] {
  return styles.match(/[^{}]+\{[^{}]+\}/g)?.filter((rule) => rule.includes(selector)) ?? [];
}

describe("sidebar navigation styles", () => {
  it("does not color inactive system labels as selected when the toggle is hovered", () => {
    const hoverRules = cssRulesContaining(".sidebar-nav .nav-system-toggle:hover:not(:disabled)").join("\n");

    expect(hoverRules).not.toMatch(/color\s*:\s*var\(--text\)/);
    expect(hoverRules).toMatch(/color\s*:\s*#7e8999/);
    expect(hoverRules).toMatch(/color\s*:\s*#667085/);
  });

  it("does not color inactive system labels as selected when the toggle only has keyboard focus", () => {
    const focusVisibleRules = cssRulesContaining(".sidebar-nav .nav-system-toggle:focus-visible").join("\n");

    expect(focusVisibleRules).not.toMatch(/color\s*:/);
    expect(focusVisibleRules).toMatch(/box-shadow\s*:\s*0 0 0 2px/);
  });

  it("colors only active system labels as selected", () => {
    const activeRules = cssRulesContaining(".sidebar-nav .nav-system-toggle.active").join("\n");

    expect(activeRules).toMatch(/color\s*:\s*var\(--text\)/);
  });

  it("renders beta markers as framed inline badges instead of plain label text", () => {
    const betaBadgeRules = cssRulesContaining(".harness-label-badge").join("\n");

    expect(betaBadgeRules).toMatch(/border\s*:\s*1px solid/);
    expect(betaBadgeRules).toMatch(/border-radius\s*:\s*var\(--radius-xs\)/);
    expect(betaBadgeRules).toMatch(/text-transform\s*:\s*uppercase/);
  });
});
