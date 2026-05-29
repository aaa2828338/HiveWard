import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FileHivewardStore } from "../store/fileHivewardStore";
import { SqliteHivewardStore } from "../store/sqlite/sqliteHivewardStore";
import { createContractBlueprint } from "../store/storeContractFixtures";
import {
  ApprovalService as CompatApprovalService,
  ArtifactService as CompatArtifactService,
  IterationService as CompatIterationService,
  ManagerMailProjector as CompatManagerMailProjector,
  MigrationService as CompatMigrationService,
  RuntimeAccessPolicyService as CompatRuntimeAccessPolicyService
} from "./lifecycleServices";
import { ApprovalService } from "./lifecycleApprovalService";
import { ArtifactService } from "./artifactService";
import { IterationService } from "./iterationLifecycleService";
import { ManagerMailProjector } from "./managerMailProjector";
import { MigrationService, RuntimeAccessPolicyService } from "./runtimeAccessPolicyService";

describe("ApprovalService", () => {
  it("keeps lifecycleServices as a compatibility barrel over split service implementations", () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "lifecycleServices.ts"), "utf8");

    expect(CompatApprovalService).toBe(ApprovalService);
    expect(CompatIterationService).toBe(IterationService);
    expect(CompatArtifactService).toBe(ArtifactService);
    expect(CompatManagerMailProjector).toBe(ManagerMailProjector);
    expect(CompatRuntimeAccessPolicyService).toBe(RuntimeAccessPolicyService);
    expect(CompatMigrationService).toBe(MigrationService);
    expect(source).not.toContain("class ApprovalService");
    expect(source).not.toContain("class IterationService");
    expect(source).not.toContain("class ArtifactService");
    expect(source.split(/\r?\n/).length).toBeLessThan(40);
  });

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

  it("treats manager mail as a rebuildable approval projection", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hiveward-manager-mail-projection-"));
    const store = new SqliteHivewardStore(join(dir, "hiveward.sqlite"));
    await store.init();
    try {
      const approvalService = new ApprovalService(store);
      const projector = new ManagerMailProjector(store);
      const blueprint = await store.saveBlueprint(createContractBlueprint());
      const run = await store.createBlueprintRun(blueprint, "projection-user");
      const request = await approvalService.createRequest({
        runId: run.id,
        roundId: "round-projection",
        kind: "iteration_requirement_plan",
        title: "Round plan",
        body: "Approve the round plan.",
        requestedBy: { type: "node", label: "Top Manager", nodeId: "manager" }
      });

      await projector.rebuild(run.id);
      expect(await projector.verify(run.id)).toMatchObject({ ok: true, expected: 1, actual: 1 });

      await store.replaceManagerMail([], { runId: run.id });
      expect(await store.listManagerMail(run.id)).toEqual([]);
      await projector.rebuild(run.id);
      expect(await store.listManagerMail(run.id)).toEqual([
        expect.objectContaining({ sourceId: request.id, status: "pending" })
      ]);

      await store.upsertApprovalRequest({
        ...request,
        status: "approved",
        capabilities: { approve: false, reject: false, reply: false, complete: false, terminate: false },
        updatedAt: "2026-05-29T00:00:00.000Z"
      });
      expect(await projector.verify(run.id)).toMatchObject({ ok: false, mismatches: [`drift:mail-${request.id}`] });
      await projector.refresh(run.id);
      expect(await store.listManagerMail(run.id)).toEqual([
        expect.objectContaining({ sourceId: request.id, status: "approved" })
      ]);

      await store.replaceManagerMail([
        {
          id: `mail-${request.id}`,
          sourceType: "approval_request",
          sourceId: request.id,
          kind: request.kind,
          status: "pending",
          title: request.title,
          body: request.body,
          capabilities: request.capabilities,
          relatedRunId: request.runId,
          relatedRoundId: request.roundId,
          createdAt: request.requestedAt,
          updatedAt: request.requestedAt
        }
      ], { runId: run.id });
      expect(await projector.verify(run.id)).toMatchObject({ ok: false, mismatches: [`drift:mail-${request.id}`] });
    } finally {
      store.close();
    }
  });
});
