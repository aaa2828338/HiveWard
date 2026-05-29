import { describe, expect, it } from "vitest";
import { resolveApiResourceUrl } from "./api";

describe("resolveApiResourceUrl", () => {
  it("resolves relative artifact paths against the configured API base URL", () => {
    expect(resolveApiResourceUrl("/artifacts/objects/sha256/final.html", "http://127.0.0.1:10101")).toBe(
      "http://127.0.0.1:10101/artifacts/objects/sha256/final.html"
    );
  });

  it("keeps absolute artifact URLs unchanged", () => {
    expect(resolveApiResourceUrl("https://example.test/artifact.html", "http://127.0.0.1:10101")).toBe(
      "https://example.test/artifact.html"
    );
  });
});
