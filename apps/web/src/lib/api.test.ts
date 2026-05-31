import { describe, expect, it } from "vitest";
import { ApiRequestError, isClosedApprovalConflictError, resolveApiResourceUrl } from "./api";

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

describe("isClosedApprovalConflictError", () => {
  it("recognizes already-closed approval conflicts", () => {
    expect(isClosedApprovalConflictError(new ApiRequestError("Approval request is already closed.", 409))).toBe(true);
  });

  it("recognizes coded approval conflicts", () => {
    expect(isClosedApprovalConflictError(new ApiRequestError("Conflict", 409, "approval_conflict"))).toBe(true);
  });

  it("ignores unrelated request errors", () => {
    expect(isClosedApprovalConflictError(new ApiRequestError("Approval request is already closed.", 500))).toBe(false);
    expect(isClosedApprovalConflictError(new Error("Approval request is already closed."))).toBe(false);
  });
});
