import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const styles = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../styles.css"), "utf8");

describe("app shell CSS", () => {
  it("keeps visually hidden permission checkboxes from expanding the app shell width", () => {
    expect(styles).toMatch(
      /\.harness-permission-toggle input,\s*\.config-form \.blueprint-permission-toggle input\s*\{[^}]*width:\s*0;[^}]*height:\s*0;[^}]*padding:\s*0;[^}]*border:\s*0;/s
    );
  });
});
