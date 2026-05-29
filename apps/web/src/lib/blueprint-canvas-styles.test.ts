import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const styles = readFileSync(fileURLToPath(new URL("../styles.css", import.meta.url)), "utf8");

type RgbColor = {
  r: number;
  g: number;
  b: number;
};

function cssRules(): Array<{ selectors: string[]; body: string }> {
  return Array.from(styles.matchAll(/([^{}]+)\{([^{}]+)\}/g), (match) => ({
    selectors: (match[1] ?? "")
      .split(",")
      .map((selector) => selector.trim())
      .filter(Boolean),
    body: match[2] ?? ""
  }));
}

function latestDeclaration(selector: string, property: string): string | undefined {
  let value: string | undefined;

  for (const rule of cssRules()) {
    if (!rule.selectors.includes(selector)) continue;

    const declaration = rule.body.match(new RegExp(`${escapeRegex(property)}\\s*:\\s*([^;]+);`));
    if (declaration?.[1]) {
      value = declaration[1].trim();
    }
  }

  return value;
}

function expectHexCustomProperty(selector: string, property: string): RgbColor {
  const value = latestDeclaration(selector, property);
  expect(value).toMatch(/^#[\da-f]{6}$/i);
  return parseHexColor(value ?? "#000000");
}

function parseHexColor(value: string): RgbColor {
  const normalized = value.replace("#", "");
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16)
  };
}

function contrastRatio(first: RgbColor, second: RgbColor): number {
  const firstLuminance = relativeLuminance(first);
  const secondLuminance = relativeLuminance(second);
  const lighter = Math.max(firstLuminance, secondLuminance);
  const darker = Math.min(firstLuminance, secondLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

function luminance(color: RgbColor): number {
  return relativeLuminance(color);
}

function relativeLuminance(color: RgbColor): number {
  const r = linearizeColorChannel(color.r);
  const g = linearizeColorChannel(color.g);
  const b = linearizeColorChannel(color.b);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function linearizeColorChannel(channel: number): number {
  const value = channel / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

describe("blueprint canvas styles", () => {
  it("routes the canvas and node surfaces through dedicated contrast tokens", () => {
    expect(latestDeclaration(".blueprint-canvas-panel", "background")).toBe("var(--blueprint-canvas-bg)");
    expect(latestDeclaration(".blueprint-node", "background")).toBe("var(--blueprint-node-bg)");
    expect(latestDeclaration(".blueprint-node", "border-color")).toBe("var(--blueprint-node-border)");
  });

  it("keeps light-theme overrides on the same contrast tokens", () => {
    expect(latestDeclaration("html[data-theme=\"light\"] .blueprint-canvas-panel", "background")).toBe("var(--blueprint-canvas-bg)");
    expect(latestDeclaration("html[data-theme=\"light\"] .blueprint-node", "background")).toBe("var(--blueprint-node-bg)");
    expect(latestDeclaration("html[data-theme=\"light\"] .blueprint-node", "border-color")).toBe("var(--blueprint-node-border)");
  });

  it("keeps dark-mode nodes separated with restrained surfaces and stronger borders", () => {
    const canvas = expectHexCustomProperty(":root", "--blueprint-canvas-bg");
    const node = expectHexCustomProperty(":root", "--blueprint-node-bg");
    const border = expectHexCustomProperty(":root", "--blueprint-node-border");

    expect(contrastRatio(canvas, node)).toBeGreaterThanOrEqual(1.05);
    expect(contrastRatio(canvas, node)).toBeLessThanOrEqual(1.14);
    expect(contrastRatio(canvas, border)).toBeGreaterThanOrEqual(2.8);
    expect(luminance(canvas)).toBeGreaterThanOrEqual(0.014);
    expect(luminance(canvas)).toBeLessThanOrEqual(0.02);
  });

  it("keeps dark-mode nodes solid gray-black instead of pure black", () => {
    const canvas = expectHexCustomProperty(":root", "--blueprint-canvas-bg");
    const node = expectHexCustomProperty(":root", "--blueprint-node-bg");

    expect(luminance(canvas)).toBeGreaterThan(luminance(node));
    expect(luminance(node)).toBeGreaterThanOrEqual(0.009);
    expect(luminance(node)).toBeLessThanOrEqual(0.013);
  });

  it("makes dark-mode canvas anchor dots easy to see", () => {
    expect(latestDeclaration(":root", "--blueprint-grid-color")).toBe("rgb(226 232 240 / 0.30)");
    expect(latestDeclaration(".blueprint-canvas-panel .react-flow__background", "opacity")).toBe("1");
  });

  it("keeps light-mode nodes visibly separated from the canvas", () => {
    const canvas = expectHexCustomProperty("html[data-theme=\"light\"]", "--blueprint-canvas-bg");
    const node = expectHexCustomProperty("html[data-theme=\"light\"]", "--blueprint-node-bg");
    const border = expectHexCustomProperty("html[data-theme=\"light\"]", "--blueprint-node-border");

    expect(contrastRatio(canvas, node)).toBeGreaterThanOrEqual(1.18);
    expect(contrastRatio(canvas, border)).toBeGreaterThanOrEqual(1.45);
  });
});
