import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FileHivewardStore } from "../store/fileHivewardStore";
import { ApprovalService } from "./lifecycleServices";

describe("ApprovalService", () => {
  it("replies by closing the old request once and creating a revised request", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hiveward-lifecycle-"));
    const store = new FileHivewardStore(join(dir, "hiveward-store.json"));
    await store.init();
    const service = new ApprovalService(store);

    const request = await service.createRequest({
      runId: "run-1",
      kind: "iteration_requirement_plan",
      title: "Round 1 requirement",
      body: "Initial plan",
      requestedBy: {
        type: "node",
        label: "Top Manager",
        nodeId: "manager"
      }
    });

    const result = await service.reply(request.id, "Clarify the acceptance criteria.");
    const original = await store.getApprovalRequest(request.id);
    const decisions = await store.listApprovalDecisions(request.id);

    expect(original).toMatchObject({
      status: "replied",
      supersededByRequestId: result.nextApprovalRequest?.id
    });
    expect(decisions.map((decision) => decision.action)).toEqual(["reply"]);
    expect(result.nextApprovalRequest).toMatchObject({
      title: "Round 1 requirement v2",
      status: "pending",
      revision: 2,
      replacesRequestId: request.id,
      threadId: request.threadId
    });
    expect(result.nextApprovalRequest?.body).toContain("Revision feedback:");
    expect(result.nextApprovalRequest?.body).not.toContain("User reply:");
  });

  it("freezes all pending approvals for a terminal run", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hiveward-lifecycle-"));
    const store = new FileHivewardStore(join(dir, "hiveward-store.json"));
    await store.init();
    const service = new ApprovalService(store);

    const first = await service.createRequest({
      runId: "run-terminal",
      kind: "iteration_requirement_plan",
      title: "Requirement",
      body: "Plan",
      requestedBy: { type: "node", label: "Top Manager", nodeId: "manager" }
    });
    const second = await service.createRequest({
      runId: "run-terminal",
      kind: "manager_release_report",
      title: "Round 1 Release Report v1",
      body: "Report",
      requestedBy: { type: "node", label: "Top Manager", nodeId: "manager" }
    });

    await service.closePendingForRun("run-terminal", "Run cancelled.");

    expect(await store.getApprovalRequest(first.id)).toMatchObject({ status: "superseded" });
    expect(await store.getApprovalRequest(second.id)).toMatchObject({ status: "superseded" });
    expect((await store.listApprovalDecisions()).map((decision) => decision.comment)).toEqual([
      "Run cancelled.",
      "Run cancelled."
    ]);
  });
});
