import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FileHivewardStore } from "../store/fileHivewardStore";
import { SqliteHivewardStore } from "../store/sqlite/sqliteHivewardStore";
import {
  createContractBlueprint,
  createContractIteration,
  createContractReleaseReport
} from "../store/storeContractFixtures";
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
import { HumanActionRequestService } from "./humanActionRequestService";

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

  it("records replies without changing request lifecycle or creating revisions", async () => {
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
    const replies = await store.listApprovalReplies({ approvalRequestId: request.id });
    const threads = await store.listApprovalThreads({ runId: "run-1" });

    expect(original).toMatchObject({
      status: "pending",
      updatedAt: expect.any(String)
    });
    expect(decisions.map((decision) => decision.action)).toEqual(["reply"]);
    expect(decisions[0]).toMatchObject({
      resultingStatus: "pending",
      comment: "Clarify the acceptance criteria."
    });
    expect(replies).toEqual([
      expect.objectContaining({
        threadId: request.threadId ?? request.id,
        approvalRequestId: request.id,
        body: "Clarify the acceptance criteria."
      })
    ]);
    expect(threads).toEqual([
      expect.objectContaining({
        id: request.threadId ?? request.id,
        status: "open",
        currentRequestId: request.id
      })
    ]);
    expect(result.approvalRequest).toMatchObject({
      id: request.id,
      status: "pending",
      revision: 1,
      threadId: request.threadId
    });
    expect((await store.listApprovalRequests({ runId: "run-1" }))).toHaveLength(1);
  });

  it("validates human action approval ownership before creating decision requests", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hiveward-human-action-owner-"));
    const store = new FileHivewardStore(join(dir, "hiveward-store.json"));
    await store.init();
    const approvalService = new ApprovalService(store);
    const humanActionService = new HumanActionRequestService(store);

    const approval = await approvalService.createRequest({
      kind: "leader_delegation",
      title: "Govern blueprint",
      body: "Approve the blueprint governance step.",
      requestedBy: {
        type: "role",
        label: "CEO",
        roleId: "ceo"
      }
    });

    const decisionRequest = await humanActionService.createRequest({
      producer: "ceo",
      sourceContextType: "blueprint_governance",
      sourceContextId: "blueprint-service-owner",
      responseIntent: "decision_required",
      approvalRequestId: approval.id,
      title: "Decision needed",
      bodyMarkdown: "Approve this governance step."
    });
    expect(decisionRequest).toMatchObject({
      responseIntent: "decision_required",
      status: "pending",
      approvalRequestId: approval.id
    });

    await expect(humanActionService.createRequest({
      producer: "ceo",
      sourceContextType: "blueprint_governance",
      sourceContextId: "blueprint-service-reply",
      responseIntent: "reply_required",
      title: "Reply needed",
      bodyMarkdown: "Please reply."
    })).resolves.toMatchObject({
      responseIntent: "reply_required",
      status: "pending"
    });
    await expect(humanActionService.createRequest({
      producer: "leader",
      sourceContextType: "blueprint_governance",
      sourceContextId: "blueprint-service-review",
      responseIntent: "reply_required",
      title: "Review needed",
      bodyMarkdown: "Please review."
    })).resolves.toMatchObject({
      responseIntent: "reply_required",
      status: "pending"
    });

    await expect(humanActionService.createRequest({
      producer: "ceo",
      sourceContextType: "blueprint_governance",
      sourceContextId: "blueprint-service-missing-owner",
      responseIntent: "decision_required",
      title: "Decision without owner",
      bodyMarkdown: "This must be rejected."
    })).rejects.toThrow(/HumanActionRequest\.approvalRequestId/);

    await expect(humanActionService.createRequest({
      producer: "ceo",
      sourceContextType: "blueprint_governance",
      sourceContextId: "blueprint-service-orphan-owner",
      responseIntent: "decision_required",
      approvalRequestId: "approval-does-not-exist",
      title: "Decision with missing owner",
      bodyMarkdown: "This must be rejected."
    })).rejects.toThrow(/ApprovalRequest not found/);

    await approvalService.approve(approval.id);
    await expect(humanActionService.createRequest({
      producer: "ceo",
      sourceContextType: "blueprint_governance",
      sourceContextId: "blueprint-service-terminal-owner",
      responseIntent: "decision_required",
      approvalRequestId: approval.id,
      title: "Decision with terminal owner",
      bodyMarkdown: "This must be rejected."
    })).rejects.toThrow(/ApprovalRequest is not pending/);

    await expect(humanActionService.createRequest({
      producer: "ceo",
      sourceContextType: "blueprint_governance",
      sourceContextId: "blueprint-service-reply-with-owner",
      responseIntent: "reply_required",
      approvalRequestId: approval.id,
      title: "Reply with approval owner",
      bodyMarkdown: "This must be rejected."
    })).rejects.toThrow(/can only bind decision_required/);
  });

  it("closes approval-owned decision human actions when a request is superseded by revision", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hiveward-human-action-supersede-"));
    const store = new FileHivewardStore(join(dir, "hiveward-store.json"));
    await store.init();
    const approvalService = new ApprovalService(store);
    const humanActionService = new HumanActionRequestService(store);

    const approval = await approvalService.createRequest({
      kind: "agent_proposal",
      title: "Superseded request",
      body: "This request will be superseded.",
      requestedBy: {
        type: "role",
        label: "CEO",
        roleId: "ceo"
      }
    });
    const request = await humanActionService.createRequest({
      producer: "ceo",
      sourceContextType: "blueprint_governance",
      sourceContextId: "blueprint-service-supersede",
      responseIntent: "decision_required",
      approvalRequestId: approval.id,
      title: "Decision needed",
      bodyMarkdown: "Approve this request before replacement."
    });
    expect("returnForRevision" in approvalService).toBe(false);
    expect("markSupersededByRevision" in approvalService).toBe(false);
    expect(await store.getHumanActionRequest(request.id)).toMatchObject({
      status: "pending"
    });

    await expect(approvalService.supersede(approval.id)).resolves.toMatchObject({
      approvalRequest: {
        id: approval.id,
        status: "superseded"
      },
      decision: {
        action: "supersede",
        resultingStatus: "superseded"
      }
    });
    expect(await store.getHumanActionRequest(request.id)).toMatchObject({
      status: "closed"
    });
    expect(await store.listApprovalDecisions(approval.id)).toEqual([
      expect.objectContaining({
        action: "supersede",
        resultingStatus: "superseded"
      })
    ]);

    await store.updateHumanActionRequest({
      id: request.id,
      status: "pending",
      updatedAt: "2026-06-04T00:10:00.000Z"
    });
    await expect(approvalService.supersede(approval.id))
      .rejects.toThrow("Approval request is already closed.");
    expect(await store.getHumanActionRequest(request.id)).toMatchObject({
      status: "closed"
    });
    expect(await store.listApprovalDecisions(approval.id)).toHaveLength(1);
  });

  it("does not expose approval selection or persist selected reply facts", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hiveward-lifecycle-selection-"));
    const store = new FileHivewardStore(join(dir, "hiveward-store.json"));
    await store.init();
    const service = new ApprovalService(store);

    const request = await service.createRequest({
      runId: "run-selection",
      kind: "agent_proposal",
      title: "Agent output",
      body: "Draft output",
      requestedBy: {
        type: "node",
        label: "Agent",
        nodeId: "agent"
      }
    });
    await store.appendApprovalReply({
      id: "reply-candidate-selection",
      threadId: request.threadId ?? request.id,
      approvalRequestId: request.id,
      actor: "agent",
      purpose: "message",
      body: "Discussion reply",
      createdAt: new Date().toISOString()
    });

    expect("selectApprovalCandidate" in service).toBe(false);
    const result = await service.approve(request.id, "Looks good.");
    expect(result.approvalRequest).not.toHaveProperty("selectedReplyId");
    expect(result.decision).not.toHaveProperty("selectedReplyId");
    expect(await store.getApprovalRequest(request.id)).not.toHaveProperty("selectedReplyId");
  });

  it("reply then approve release report carries reply into next round humanFeedback", async () => {
    const { store, approvalService, iterationService, request, run } = await createReleaseReportApprovalFixture();

    await approvalService.reply(request.id, "I tried it and the character keeps walking left.");
    const result = await approvalService.approve(request.id);
    const outcome = await iterationService.handleApprovalResult(result);

    expect(await store.listApprovalReplies({ approvalRequestId: request.id })).toEqual([
      expect.objectContaining({ body: "I tried it and the character keeps walking left." })
    ]);
    expect((await store.getApprovalRequest(request.id))?.status).toBe("approved");
    expect(outcome.prepareNextRound).toMatchObject({
      previousReportRequestId: request.id,
      humanFeedback: expect.stringContaining("I tried it and the character keeps walking left.")
    });
    expect(outcome.prepareNextRound?.humanFeedback).toContain("Human feedback / user acceptance feedback");
    expect((await store.listIterationRounds({ runId: run.id })).filter((round) => round.roundNumber === 2)).toHaveLength(1);
  });

  it("approve comment still carries into next round humanFeedback", async () => {
    const { approvalService, iterationService, request } = await createReleaseReportApprovalFixture();

    const result = await approvalService.approve(request.id, "Approve, but keep keyboard controls in the next round.");
    const outcome = await iterationService.handleApprovalResult(result);

    expect(outcome.prepareNextRound?.humanFeedback).toContain("Approve, but keep keyboard controls in the next round.");
    expect(outcome.prepareNextRound?.humanFeedback).toContain("Approval action note");
  });

  it("reply plus approve comment are both carried and ordered", async () => {
    const { approvalService, iterationService, request } = await createReleaseReportApprovalFixture();

    await approvalService.reply(request.id, "A: the mouse click does not break blocks.");
    const result = await approvalService.approve(request.id, "B: approve the next round to fix this.");
    const outcome = await iterationService.handleApprovalResult(result);
    const feedback = outcome.prepareNextRound?.humanFeedback ?? "";

    expect(feedback).toContain("A: the mouse click does not break blocks.");
    expect(feedback).toContain("B: approve the next round to fix this.");
    expect(feedback.indexOf("A: the mouse click does not break blocks.")).toBeLessThan(
      feedback.indexOf("B: approve the next round to fix this.")
    );
  });

  it("duplicate approve on closed approval does not create another round", async () => {
    const { store, approvalService, iterationService, request, run } = await createReleaseReportApprovalFixture();

    const result = await approvalService.approve(request.id, "Continue once.");
    await iterationService.handleApprovalResult(result);
    await expect(approvalService.approve(request.id, "Continue twice.")).rejects.toThrow("Approval request is already closed.");

    const rounds = await store.listIterationRounds({ runId: run.id });
    const decisions = await store.listApprovalDecisions(request.id);
    expect(rounds.filter((round) => round.roundNumber === 2)).toHaveLength(1);
    expect(decisions.filter((decision) => decision.action === "approve")).toHaveLength(1);
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
        capabilities: { approve: false, reject: false, reply: false },
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

async function createReleaseReportApprovalFixture() {
  const dir = mkdtempSync(join(tmpdir(), "hiveward-release-feedback-"));
  const store = new FileHivewardStore(join(dir, "hiveward-store.json"));
  await store.init();
  const approvalService = new ApprovalService(store);
  const iterationService = new IterationService(store, approvalService);
  const blueprint = await store.saveBlueprint(createContractBlueprint());
  const run = await store.createBlueprintRun(blueprint, "feedback-user");
  const { session, round: fixtureRound } = createContractIteration(run.id);
  const round = {
    ...fixtureRound,
    status: "report_pending" as const
  };

  await store.upsertIterationSession(session);
  await store.upsertIterationRound(round);
  const request = await approvalService.createRequest({
    runId: run.id,
    roundId: round.id,
    kind: "manager_release_report",
    title: "Round 1 Release Report v1",
    body: "Round 1 delivered the playable artifact.",
    payloadRef: "release-report-contract",
    sourceRef: { type: "blueprint_run", id: run.id },
    requestedBy: { type: "node", label: "Top Manager", nodeId: "contract-manager" }
  });
  await store.upsertIterationRound({
    ...round,
    releaseReportRequestId: request.id
  });
  await store.upsertReleaseReport(createContractReleaseReport(run.id, round.id, request.id));

  return {
    store,
    approvalService,
    iterationService,
    request,
    run
  };
}
