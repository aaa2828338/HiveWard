import { existsSync, mkdtempSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type {
  AgentOutputEvent,
  ApprovalDiscussionBinding,
  HumanActionRequest,
  HumanActionResponse,
  ManagerCommand,
  NodeExecutionSession,
  RunInterjection,
  RunRoom,
  RunCommand,
  RunCommandStep,
  WorkerTask
} from "@hiveward/shared";
import type { HivewardStore } from "../hivewardStore";
import { FileHivewardStore } from "../fileHivewardStore";
import { SqliteDriver } from "./sqliteDriver";
import {
  contractNow,
  createContractApproval,
  createContractArtifact,
  createContractBlueprint,
  createContractDecision,
  createContractEvent,
  createContractHandoff,
  createContractHumanReport,
  createContractIteration,
  createContractManagerContext,
  createContractNodeRun,
  createContractPortablePackage,
  createContractReleaseReport,
  createContractTimelineItem
} from "../storeContractFixtures";
import { SqliteHivewardStore } from "./sqliteHivewardStore";

type Harness = {
  store: HivewardStore;
  dataDir: string;
  close?: () => void;
};

const storeCases: Array<[string, () => Promise<Harness>]> = [
  ["FileHivewardStore", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "hiveward-file-store-contract-"));
    const store = new FileHivewardStore(join(dataDir, "hiveward-store.json"));
    await store.init();
    return { store, dataDir };
  }],
  ["SqliteHivewardStore", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "hiveward-sqlite-store-contract-"));
    const store = new SqliteHivewardStore(join(dataDir, "hiveward.sqlite"));
    await store.init();
    return { store, dataDir, close: () => store.close() };
  }]
];

describe.each(storeCases)("%s store contract", (_label, createHarness) => {
  it("persists runtime state and rebuilds the existing run view shape", async () => {
    const { store, close } = await createHarness();
    try {
      const companyState = await store.createCompany({ name: "Contract Company" });
      const companyId = companyState.selectedCompanyId;
      if (!companyId) throw new Error("Expected selected company.");

      const blueprint = await store.saveBlueprint(createContractBlueprint(companyId));
      await expect(store.getBlueprint(blueprint.id)).resolves.toMatchObject({ id: blueprint.id, name: "Contract Blueprint" });
      await expect(store.listBlueprints()).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ id: blueprint.id })]));

      const run = await store.createBlueprintRun(blueprint, "contract-user");
      await store.saveBlueprint({ ...blueprint, name: "Current Blueprint After Run" });
      await expect(store.getBlueprint(blueprint.id)).resolves.toMatchObject({ name: "Current Blueprint After Run" });
      await expect(store.getRunArchive(run.id)).resolves.toMatchObject({
        blueprintSnapshot: { id: blueprint.id, name: "Contract Blueprint" }
      });
      const output = {
        contractVersion: 2,
        humanReportMd: "## Contract Report\n\nDone.",
        handoffJson: { next: "manager" },
        result: { ok: true },
        artifacts: [{
          id: "artifact-contract",
          slot: "deliverable",
          title: "Contract Markdown",
          kind: "markdown" as const,
          content: "# Done"
        }]
      };
      const nodeRun = createContractNodeRun(run, output);
      await store.upsertNodeRun(nodeRun);
      await store.appendEvent(createContractEvent(run.id, nodeRun.id, 1));
      await store.appendEvent(createContractEvent(run.id, nodeRun.id, 2));

      const { session, round } = createContractIteration(run.id);
      await store.upsertIterationSession(session);
      await store.upsertIterationRound(round);

      const command: RunCommand = {
        id: "run-command-contract",
        commandKey: `run:${run.id}:round:${round.id}:execute`,
        blueprintId: run.blueprintId,
        runId: run.id,
        roundId: round.id,
        kind: "regular_run",
        status: "running",
        currentRevision: 1,
        currentStep: "node_execution",
        metadata: { source: "contract" },
        createdAt: contractNow,
        updatedAt: contractNow
      };
      await expect(store.createRunCommandIfAbsent(command)).resolves.toMatchObject({ created: true });
      await expect(store.createRunCommandIfAbsent({ ...command, id: "run-command-duplicate" })).resolves.toMatchObject({
        created: false,
        command: expect.objectContaining({ id: command.id })
      });

      const commandStep: RunCommandStep = {
        id: "run-command-step-contract",
        commandId: command.id,
        stepKey: `${command.commandKey}:node:${nodeRun.id}`,
        runId: run.id,
        roundId: round.id,
        revision: 1,
        mode: "node_execution",
        nodeId: nodeRun.nodeId,
        nodeRunId: nodeRun.id,
        status: "succeeded",
        runtimeRef: {
          source: "codex",
          sourceId: "task-contract",
          sourceUpdatedAt: contractNow,
          taskId: "task-contract"
        },
        metadata: { source: "contract" },
        createdAt: contractNow,
        updatedAt: contractNow
      };
      await expect(store.createRunCommandStepIfAbsent(commandStep)).resolves.toMatchObject({ created: true });
      await expect(store.createRunCommandStepIfAbsent({ ...commandStep, id: "run-command-step-duplicate" })).resolves.toMatchObject({
        created: false,
        step: expect.objectContaining({ id: commandStep.id })
      });
      await expect(store.updateRunCommandStep({ id: commandStep.id, status: "waiting_approval" })).resolves.toMatchObject({
        id: commandStep.id,
        status: "waiting_approval"
      });

      const executionSession: NodeExecutionSession = {
        id: "node-execution-session-contract",
        runId: run.id,
        nodeRunId: nodeRun.id,
        nodeId: nodeRun.nodeId,
        agentSeatId: "contract-agent-seat",
        harnessId: "codex",
        nativeSessionId: "native-session-contract",
        runtimeRef: {
          source: "codex",
          sourceId: "native-session-contract",
          sourceUpdatedAt: contractNow,
          sessionKey: "native-session-contract"
        },
        policy: "preserve_across_rounds",
        status: "active",
        createdAt: contractNow,
        updatedAt: contractNow,
        lastUsedAt: contractNow
      };
      await expect(store.createNodeExecutionSession(executionSession)).resolves.toMatchObject({ id: executionSession.id });

      const approval = await store.upsertApprovalRequest(createContractApproval(run.id, nodeRun.id));
      await store.appendApprovalReply({
        id: "approval-reply-discussion-contract",
        threadId: approval.id,
        approvalRequestId: approval.id,
        actor: "agent",
        purpose: "message",
        body: "Discussion approval response.",
        createdAt: contractNow
      });
      const discussionBinding: ApprovalDiscussionBinding = {
        approvalRequestId: approval.id,
        threadId: approval.id,
        mode: "executor",
        route: "agent_approval",
        executorActor: "agent",
        executorKind: "agent_approval",
        executorNodeId: nodeRun.nodeId,
        executorNodeRunId: nodeRun.id,
        executorSessionId: executionSession.id,
        runtimeId: "codex",
        canStreamReply: true,
        resolverVersion: 1,
        createdAt: contractNow,
        updatedAt: contractNow
      };
      await expect(store.createApprovalDiscussionBinding(discussionBinding)).resolves.toMatchObject({ approvalRequestId: approval.id });
      await expect(store.createApprovalDiscussionBinding({ ...discussionBinding, reason: "duplicate" }))
        .rejects.toThrow(/Approval discussion binding already exists/);
      await store.appendApprovalDecision(createContractDecision(approval.id));
      await store.upsertApprovalRequest({
        ...approval,
        status: "replied",
        capabilities: resolveClosedCapabilities(),
        updatedAt: contractNow
      });

      const artifact = await store.upsertArtifact(createContractArtifact(run.id, nodeRun.id, round.id));
      await store.upsertReleaseReport(createContractReleaseReport(run.id, round.id, approval.id));
      await store.upsertAgentHumanReport(createContractHumanReport(run.id, nodeRun.id, round.id));
      await store.upsertAgentHandoff(createContractHandoff(run.id, nodeRun.id, round.id));
      await store.upsertManagerContextSnapshot(createContractManagerContext(run.id, session.id, round.id));
      await store.appendRunTimelineItem(createContractTimelineItem(run.id));

      const view = await store.getRunView(run.id);
      expect(view).toMatchObject({
        run: { id: run.id, blueprintName: "Contract Blueprint" },
        nodeRuns: [expect.objectContaining({ id: nodeRun.id, status: "succeeded", output })],
        runCommands: [expect.objectContaining({ id: command.id, commandKey: command.commandKey })],
        runCommandSteps: [expect.objectContaining({ id: commandStep.id, stepKey: commandStep.stepKey })],
        nodeExecutionSessions: [expect.objectContaining({ id: executionSession.id, nativeSessionId: "native-session-contract" })],
        approvalDiscussionBindings: [expect.objectContaining({ approvalRequestId: approval.id, mode: "executor" })],
        approvalRequestDiscussions: [expect.objectContaining({
          approvalRequestId: approval.id,
          discussion: expect.objectContaining({
            mode: "none",
            reason: "approval_not_pending"
          })
        })],
        approvalRequests: [expect.objectContaining({ id: approval.id, status: "replied" })],
        approvalThreads: [expect.objectContaining({ id: approval.id, status: "closed", currentRevision: 1 })],
        approvalReplies: expect.arrayContaining([
          expect.objectContaining({
            id: "reply-approval-decision-contract",
            threadId: approval.id,
            approvalRequestId: approval.id,
            purpose: "message",
            body: "Please tighten the report."
          }),
          expect.objectContaining({
            id: "approval-reply-discussion-contract",
            purpose: "message",
            body: "Discussion approval response."
          })
        ]),
        artifacts: [expect.objectContaining({ id: artifact.id, slot: "deliverable" })],
        agentHumanReports: [expect.objectContaining({ nodeRunId: nodeRun.id, bodyMd: expect.stringContaining("Contract Report") })],
        agentHandoffs: [expect.objectContaining({ nodeRunId: nodeRun.id, payload: { next: "manager", facts: ["contract complete"] } })],
        managerContextSnapshots: [expect.objectContaining({ id: "manager-context-contract" })],
        runTimeline: [expect.objectContaining({ id: "timeline-contract", sequence: 1 })]
      });
      expect("appendNodeSessionTranscriptEvent" in store).toBe(false);
      expect("listNodeSessionTranscriptEvents" in store).toBe(false);
      expect("nodeSessionTranscriptEvents" in (view ?? {})).toBe(false);
      expect(view?.events.map((event) => event.id)).toEqual(["event-contract-1", "event-contract-2"]);
      const archive = await store.getRunArchive(run.id);
      expect(archive).toMatchObject({
        runCommands: [expect.objectContaining({ id: command.id })],
        runCommandSteps: [expect.objectContaining({ id: commandStep.id })],
        nodeExecutionSessions: [expect.objectContaining({ id: executionSession.id })],
        approvalDiscussionBindings: [expect.objectContaining({ approvalRequestId: approval.id })]
      });
      expect("nodeSessionTranscriptEvents" in (archive ?? {})).toBe(false);

      await expect(store.listRunSummaries()).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ id: run.id })]));
      await expect(store.listPendingApprovals()).resolves.toEqual([]);
      await expect(store.listApprovalDecisions(approval.id)).resolves.toEqual([expect.objectContaining({ id: "approval-decision-contract" })]);
      await expect(store.listApprovalThreads({ runId: run.id })).resolves.toEqual([
        expect.objectContaining({ id: approval.id, status: "closed" })
      ]);
      await expect(store.listApprovalReplies({ approvalRequestId: approval.id })).resolves.toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: "reply-approval-decision-contract",
          purpose: "message",
          threadId: approval.id,
          metadata: expect.objectContaining({
            source: "approval_decision",
            requestKind: approval.kind,
            resultingStatus: "replied"
          })
        }),
        expect.objectContaining({
          id: "approval-reply-discussion-contract",
          purpose: "message"
        })
      ]));
      await expect(store.getApprovalDiscussionBinding(approval.id)).resolves.toMatchObject({
        mode: "executor",
        executorSessionId: executionSession.id
      });

      const humanActionRequest: HumanActionRequest = {
        id: "human-action-request-contract",
        sourceContextType: "run_room",
        sourceContextId: "run-room-contract",
        responseIntent: "reply_required",
        status: "pending",
        title: "Clarify scope",
        bodyMarkdown: "Please clarify the requested scope.",
        createdAt: contractNow,
        updatedAt: contractNow
      };
      await expect(store.appendHumanActionRequest(humanActionRequest)).resolves.toMatchObject({ id: humanActionRequest.id });
      const humanActionResponse: HumanActionResponse = {
        id: "human-action-response-contract",
        requestId: humanActionRequest.id,
        messageMarkdown: "Scope clarified.",
        createdAt: contractNow
      };
      await expect(store.appendHumanActionResponse(humanActionResponse)).resolves.toMatchObject({ id: humanActionResponse.id });
      await expect(store.listHumanActionResponses({ requestId: humanActionRequest.id })).resolves.toEqual([
        expect.objectContaining({ id: humanActionResponse.id, messageMarkdown: "Scope clarified." })
      ]);
      await expect(store.listInboxProjections()).resolves.toEqual([
        expect.objectContaining({
          humanActionRequestId: humanActionRequest.id,
          title: "Clarify scope",
          latestResponseAt: contractNow
        })
      ]);
      await expect(store.updateHumanActionRequest({
        id: humanActionRequest.id,
        status: "responded",
        updatedAt: "2026-06-04T00:00:00.000Z"
      })).resolves.toMatchObject({
        id: humanActionRequest.id,
        status: "responded",
        updatedAt: "2026-06-04T00:00:00.000Z"
      });
      await expect(store.listHumanActionRequests({ status: "pending" })).resolves.not.toEqual(
        expect.arrayContaining([expect.objectContaining({ id: humanActionRequest.id })])
      );
      await expect(store.listInboxProjections({ status: "pending" })).resolves.toEqual([]);
      await expect(store.updateHumanActionRequest({
        id: humanActionRequest.id,
        status: "waiting" as HumanActionRequest["status"]
      })).rejects.toThrow(/HumanActionRequest\.status/);
      expect("replyToInboxItem" in store).toBe(false);
      expect("approveInboxItem" in store).toBe(false);
      expect("rejectInboxItem" in store).toBe(false);
      expect("listInboxItems" in store).toBe(false);
      expect("createLeaderDelegationRequest" in store).toBe(false);
      expect("createBlueprintProposal" in store).toBe(false);

      const sessionRecord = await store.createChatSession({ harnessId: "codex", title: "Contract chat" });
      await expect(store.appendChatMessage({
        sessionId: sessionRecord.id,
        role: "user",
        content: "Hello",
        harnessId: "codex",
        status: "sent"
      })).rejects.toThrow("保留为历史事实，不参与决策");
      await expect(store.listChatMessages(sessionRecord.id)).resolves.toEqual([]);
    } finally {
      close?.();
    }
  });

  it("persists RunRoom foundation facts and rejects old owner shapes", async () => {
    const { store, close } = await createHarness();
    try {
      const companyState = await store.createCompany({ name: "RunRoom Contract Company" });
      const companyId = companyState.selectedCompanyId;
      if (!companyId) throw new Error("Expected selected company.");

      const runRoom: RunRoom = {
        id: "run-room-contract",
        companyId,
        blueprintId: "contract-blueprint",
        status: "open",
        title: "Contract RunRoom",
        summary: "RunRoom contract foundation.",
        managerRoleId: "manager-contract",
        createdAt: contractNow,
        updatedAt: contractNow
      };
      await expect(store.createRunRoom(runRoom)).resolves.toMatchObject({ id: runRoom.id, status: "open" });
      await expect(store.createRunRoom({ ...runRoom, id: "run-room-paused", status: "paused" as RunRoom["status"] }))
        .rejects.toThrow(/RunRoom\.status/);

      const interjection: RunInterjection = {
        id: "run-interjection-contract",
        runRoomId: runRoom.id,
        target: "manager",
        messageMarkdown: "Please inspect the latest result.",
        createdByRoleId: "user-contract",
        createdAt: contractNow
      };
      await expect(store.appendRunInterjection(interjection)).resolves.toMatchObject({ id: interjection.id, target: "manager" });
      await expect(store.appendRunInterjection({ ...interjection, id: "run-interjection-worker", target: "worker" as RunInterjection["target"] }))
        .rejects.toThrow(/RunInterjection\.target/);

      const command: ManagerCommand = {
        id: "manager-command-contract",
        runRoomId: runRoom.id,
        managerRoleId: "manager-contract",
        action: "dispatch_worker_task",
        status: "queued",
        instructionMarkdown: "Dispatch one worker task.",
        createdAt: contractNow,
        updatedAt: contractNow
      };
      await expect(store.appendManagerCommand(command)).resolves.toMatchObject({ id: command.id, action: "dispatch_worker_task" });
      await expect(store.appendManagerCommand({ ...command, id: "manager-command-plural", action: "dispatch_worker_tasks" as ManagerCommand["action"] }))
        .rejects.toThrow(/ManagerCommand\.action/);

      const workerTask: WorkerTask = {
        id: "worker-task-contract",
        runRoomId: runRoom.id,
        managerCommandId: command.id,
        workerSeatId: "worker-contract",
        title: "Worker contract task",
        instructionMarkdown: "Execute exactly one task.",
        status: "queued",
        createdAt: contractNow,
        updatedAt: contractNow
      };
      await expect(store.createWorkerTask(workerTask)).resolves.toMatchObject({ id: workerTask.id, status: "queued" });
      await expect(store.createWorkerTask({
        ...workerTask,
        id: "worker-task-missing-command",
        managerCommandId: undefined
      } as unknown as WorkerTask)).rejects.toThrow(/WorkerTask\.managerCommandId/);
      await expect(store.createWorkerTask({ ...workerTask, id: "worker-task-second-active", status: "running" }))
        .rejects.toThrow(/active WorkerTask/);

      const request: HumanActionRequest = {
        id: "human-action-request-contract",
        runRoomId: runRoom.id,
        sourceContextType: "run_room",
        sourceContextId: runRoom.id,
        responseIntent: "decision_required",
        approvalRequestId: "approval-human-action-contract",
        status: "pending",
        title: "Decision needed",
        bodyMarkdown: "Choose the next step.",
        createdByRoleId: "manager-contract",
        createdAt: contractNow,
        updatedAt: contractNow
      };
      await store.upsertApprovalRequest({
        ...createContractApproval(runRoom.id, "node-run-human-action-contract"),
        id: "approval-human-action-contract",
        runId: undefined,
        nodeRunId: undefined
      });
      await expect(store.appendHumanActionRequest(request)).resolves.toMatchObject({
        id: request.id,
        sourceContextType: "run_room",
        responseIntent: "decision_required",
        approvalRequestId: "approval-human-action-contract"
      });
      await expect(store.appendHumanActionRequest({ ...request, id: "human-action-request-inbox", sourceContextType: "inbox" as HumanActionRequest["sourceContextType"] }))
        .rejects.toThrow(/HumanActionRequest\.sourceContextType/);
      await expect(store.appendHumanActionRequest({ ...request, id: "human-action-request-approval", responseIntent: "approval" as HumanActionRequest["responseIntent"] }))
        .rejects.toThrow(/HumanActionRequest\.responseIntent/);

      const response: HumanActionResponse = {
        id: "human-action-response-contract",
        requestId: request.id,
        messageMarkdown: "Continue with the worker output.",
        createdByRoleId: "user-contract",
        createdAt: contractNow
      };
      await expect(store.appendHumanActionResponse(response)).resolves.toMatchObject({
        id: response.id,
        messageMarkdown: response.messageMarkdown
      });

      await expect(store.listInboxProjections({ sourceContextType: "run_room" })).resolves.toEqual([
        expect.objectContaining({
          id: `inbox-projection-${request.id}`,
          humanActionRequestId: request.id,
          responseIntent: "decision_required",
          latestResponseAt: contractNow
        })
      ]);
      expect(typeof (store as unknown as { createInboxProjection?: unknown }).createInboxProjection).toBe("undefined");
      expect(typeof (store as unknown as { listBlueprintKanbanCards?: unknown }).listBlueprintKanbanCards).toBe("undefined");
      expect(typeof (store as unknown as { listInboxItems?: unknown }).listInboxItems).toBe("undefined");
      expect(typeof (store as unknown as { createLeaderDelegationRequest?: unknown }).createLeaderDelegationRequest).toBe("undefined");
      expect(typeof (store as unknown as { createBlueprintProposal?: unknown }).createBlueprintProposal).toBe("undefined");

      const event: AgentOutputEvent = {
        id: "agent-output-event-contract",
        ownerType: "run_room",
        ownerId: runRoom.id,
        actorType: "manager",
        kind: "message_completed",
        sequence: 1,
        bodyMarkdown: "Manager output.",
        createdAt: contractNow
      };
      await expect(store.appendAgentOutputEvent(event)).resolves.toMatchObject({ id: event.id, ownerType: "run_room" });
      await expect(store.appendAgentOutputEvent({ ...event, id: "agent-output-event-inbox", ownerType: "inbox_item" as AgentOutputEvent["ownerType"], sequence: 2 }))
        .rejects.toThrow(/AgentOutputEvent\.ownerType/);
      await expect(store.listAgentOutputEvents({ ownerType: "run_room", ownerId: runRoom.id })).resolves.toEqual([
        expect.objectContaining({ id: event.id, sequence: 1 })
      ]);
    } finally {
      close?.();
    }
  });

  it("counts active approvals from approval and human-action facts only", async () => {
    const { store, close } = await createHarness();
    try {
      const companyState = await store.createCompany({ name: "Canonical Count Company" });
      const companyId = companyState.selectedCompanyId;
      if (!companyId) throw new Error("Expected selected company.");

      const blueprint = await store.saveBlueprint(createContractBlueprint(companyId));
      const run = await store.createBlueprintRun(blueprint, "contract-user");
      const runRoom: RunRoom = {
        id: "run-room-canonical-count",
        companyId,
        blueprintId: blueprint.id,
        runId: run.id,
        status: "open",
        title: "Canonical count room",
        createdAt: contractNow,
        updatedAt: contractNow
      };
      await store.createRunRoom(runRoom);

      await expect(store.listCompanies()).resolves.toMatchObject({
        companies: expect.arrayContaining([
          expect.objectContaining({ id: companyId, activeApprovalCount: 0 })
        ])
      });
      const approval = await store.upsertApprovalRequest({
        ...createContractApproval(run.id, "node-run-canonical-count"),
        id: "approval-canonical-count"
      });
      const request: HumanActionRequest = {
        id: "human-action-request-canonical-count",
        runRoomId: runRoom.id,
        sourceContextType: "run_room",
        sourceContextId: runRoom.id,
        responseIntent: "decision_required",
        approvalRequestId: approval.id,
        status: "pending",
        title: "Decision needed",
        bodyMarkdown: "Approve the canonical request.",
        createdAt: contractNow,
        updatedAt: contractNow
      };
      await store.appendHumanActionRequest(request);
      await expect(store.listCompanies()).resolves.toMatchObject({
        companies: expect.arrayContaining([
          expect.objectContaining({ id: companyId, activeApprovalCount: 2 })
        ])
      });
      await expect(store.listHumanActionRequests({ approvalRequestId: approval.id })).resolves.toEqual([
        expect.objectContaining({ id: request.id, approvalRequestId: approval.id })
      ]);

      await store.upsertApprovalRequest({
        ...approval,
        status: "approved",
        capabilities: resolveClosedCapabilities(),
        updatedAt: contractNow
      });
      await expect(store.listCompanies()).resolves.toMatchObject({
        companies: expect.arrayContaining([
          expect.objectContaining({ id: companyId, activeApprovalCount: 1 })
        ])
      });

      await store.updateHumanActionRequest({
        id: request.id,
        status: "closed",
        updatedAt: contractNow
      });
      await expect(store.listCompanies()).resolves.toMatchObject({
        companies: expect.arrayContaining([
          expect.objectContaining({ id: companyId, activeApprovalCount: 0 })
        ])
      });
    } finally {
      close?.();
    }
  });

  it("projects request-backed pending approvals from approval facts instead of legacy node output", async () => {
    const { store, close } = await createHarness();
    try {
      const companyState = await store.createCompany({ name: "Projection Company" });
      const companyId = companyState.selectedCompanyId;
      if (!companyId) throw new Error("Expected selected company.");

      const blueprint = await store.saveBlueprint(createContractBlueprint(companyId));
      const run = await store.createBlueprintRun(blueprint, "projection-user");
      const waitingNodeRun = {
        ...createContractNodeRun(run, undefined, "waiting_approval"),
        input: { upstream: [] },
        output: {
          approvalType: "agent",
          reviewOutput: "legacy node output must not project",
          replies: [{
            id: "legacy-node-reply",
            role: "assistant",
            purpose: "message",
            body: "legacy node reply must not project",
            createdAt: contractNow
          }]
        }
      };
      await store.upsertNodeRun(waitingNodeRun);
      const approval = await store.upsertApprovalRequest({
        ...createContractApproval(run.id, waitingNodeRun.id),
        body: "request body is the projection source"
      });
      await store.appendApprovalReply({
        id: "approval-fact-message",
        threadId: approval.threadId ?? approval.id,
        approvalRequestId: approval.id,
        actor: "agent",
        purpose: "message",
        body: "approval fact message",
        createdAt: contractNow
      });

      await expect(store.listPendingApprovals()).resolves.toEqual([
        expect.objectContaining({
          approvalRequestId: approval.id,
          reviewOutput: "request body is the projection source",
          canReturnForRevision: true,
          replies: [
            expect.objectContaining({
              id: "approval-fact-message",
              purpose: "message",
              body: "approval fact message"
            })
          ]
        })
      ]);
    } finally {
      close?.();
    }
  });

  it("applies approval decisions once and does not expose inbox decision actions", async () => {
    const { store, close } = await createHarness();
    try {
      const blueprint = await store.saveBlueprint(createContractBlueprint());
      const run = await store.createBlueprintRun(blueprint, "contract-user");
      const approval = await store.upsertApprovalRequest(createContractApproval(run.id, "node-run-contract-agent"));
      const approvedRequest = {
        ...approval,
        status: "approved" as const,
        capabilities: resolveClosedCapabilities(),
        updatedAt: contractNow
      };
      const decision = createDecision("decision-approval-once", approval.id, "approve", "approved");
      await expect(store.applyApprovalDecision({
        approvalRequestId: approval.id,
        expectedStatus: "pending",
        nextRequest: approvedRequest,
        decision,
        timelineItem: createDecisionTimeline("timeline-approval-once", run.id, decision)
      })).resolves.toMatchObject({ status: "applied" });
      await expect(store.applyApprovalDecision({
        approvalRequestId: approval.id,
        expectedStatus: "pending",
        nextRequest: approvedRequest,
        decision: createDecision("decision-approval-duplicate", approval.id, "approve", "approved")
      })).resolves.toMatchObject({ status: "conflict" });
      await expect(store.listApprovalDecisions(approval.id)).resolves.toHaveLength(1);
      expect("applyInboxDecision" in store).toBe(false);
    } finally {
      close?.();
    }
  });

  it("rejects invalid human action approval ownership in direct store writes", async () => {
    const { store, close } = await createHarness();
    try {
      await store.upsertApprovalRequest({
        ...createContractApproval("run-human-action-owner", "node-run-human-action-owner"),
        id: "approval-human-action-owner",
        runId: undefined,
        nodeRunId: undefined
      });
      await store.upsertApprovalRequest({
        ...createContractApproval("run-human-action-terminal", "node-run-human-action-terminal", "approved"),
        id: "approval-human-action-terminal",
        runId: undefined,
        nodeRunId: undefined,
        capabilities: resolveClosedCapabilities()
      });

      await expect(store.appendHumanActionRequest(createHumanActionRequest({
        id: "human-action-decision-owned",
        responseIntent: "decision_required",
        approvalRequestId: "approval-human-action-owner"
      }))).resolves.toMatchObject({
        id: "human-action-decision-owned",
        approvalRequestId: "approval-human-action-owner"
      });

      await expect(store.appendHumanActionRequest(createHumanActionRequest({
        id: "human-action-decision-missing-owner",
        responseIntent: "decision_required",
        approvalRequestId: undefined
      }))).rejects.toThrow(/HumanActionRequest\.approvalRequestId/);
      await expect(store.appendHumanActionRequest(createHumanActionRequest({
        id: "human-action-decision-orphan-owner",
        responseIntent: "decision_required",
        approvalRequestId: "approval-missing"
      }))).rejects.toThrow(/ApprovalRequest not found/);
      await expect(store.appendHumanActionRequest(createHumanActionRequest({
        id: "human-action-decision-terminal-owner",
        responseIntent: "decision_required",
        approvalRequestId: "approval-human-action-terminal"
      }))).rejects.toThrow(/ApprovalRequest is not pending/);
      await expect(store.appendHumanActionRequest(createHumanActionRequest({
        id: "human-action-reply-claims-owner",
        responseIntent: "reply_required",
        approvalRequestId: "approval-human-action-owner"
      }))).rejects.toThrow(/can only bind decision_required/);
      await expect(store.appendHumanActionRequest(createHumanActionRequest({
        id: "human-action-review-claims-owner",
        responseIntent: "review_required",
        approvalRequestId: "approval-human-action-owner"
      }))).rejects.toThrow(/can only bind decision_required/);
      await expect(store.appendHumanActionRequest(createHumanActionRequest({
        id: "human-action-reply-normal",
        responseIntent: "reply_required"
      }))).resolves.toMatchObject({
        responseIntent: "reply_required"
      });
      await expect(store.appendHumanActionRequest(createHumanActionRequest({
        id: "human-action-review-normal",
        responseIntent: "review_required"
      }))).resolves.toMatchObject({
        responseIntent: "review_required"
      });
    } finally {
      close?.();
    }
  });

  it("atomically responds to reply and review human actions and rejects later responses", async () => {
    const { store, close } = await createHarness();
    try {
      await store.appendHumanActionRequest(createHumanActionRequest({
        id: "human-action-reply-atomic",
        responseIntent: "reply_required"
      }));
      await expect(store.appendHumanActionResponse(createHumanActionResponse({
        id: "human-action-response-reply-atomic",
        requestId: "human-action-reply-atomic"
      }))).resolves.toMatchObject({
        requestId: "human-action-reply-atomic"
      });
      await expect(store.getHumanActionRequest("human-action-reply-atomic")).resolves.toMatchObject({
        status: "responded",
        updatedAt: contractNow
      });
      await expect(store.appendHumanActionResponse(createHumanActionResponse({
        id: "human-action-response-reply-late",
        requestId: "human-action-reply-atomic"
      }))).rejects.toThrow(/not pending/);

      await store.appendHumanActionRequest(createHumanActionRequest({
        id: "human-action-review-atomic",
        responseIntent: "review_required"
      }));
      const concurrentResponses = await Promise.allSettled([
        store.appendHumanActionResponse(createHumanActionResponse({
          id: "human-action-response-review-first",
          requestId: "human-action-review-atomic"
        })),
        store.appendHumanActionResponse(createHumanActionResponse({
          id: "human-action-response-review-second",
          requestId: "human-action-review-atomic"
        }))
      ]);
      expect(concurrentResponses.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(concurrentResponses.filter((result) => result.status === "rejected")).toHaveLength(1);
      await expect(store.getHumanActionRequest("human-action-review-atomic")).resolves.toMatchObject({ status: "responded" });
      await expect(store.listHumanActionResponses({ requestId: "human-action-review-atomic" })).resolves.toHaveLength(1);

      await store.appendHumanActionRequest(createHumanActionRequest({
        id: "human-action-closed-response",
        responseIntent: "reply_required"
      }));
      await store.updateHumanActionRequest({ id: "human-action-closed-response", status: "closed", updatedAt: contractNow });
      await expect(store.appendHumanActionResponse(createHumanActionResponse({
        id: "human-action-response-closed",
        requestId: "human-action-closed-response"
      }))).rejects.toThrow(/not pending/);

      await store.appendHumanActionRequest(createHumanActionRequest({
        id: "human-action-cancelled-response",
        responseIntent: "reply_required"
      }));
      await store.updateHumanActionRequest({ id: "human-action-cancelled-response", status: "cancelled", updatedAt: contractNow });
      await expect(store.appendHumanActionResponse(createHumanActionResponse({
        id: "human-action-response-cancelled",
        requestId: "human-action-cancelled-response"
      }))).rejects.toThrow(/not pending/);
    } finally {
      close?.();
    }
  });

  it("closes approval-bound decision human actions and repairs terminal conflicts without duplicate decisions", async () => {
    const { store, close } = await createHarness();
    try {
      const approval = await store.upsertApprovalRequest({
        ...createContractApproval("run-approval-owner", "node-run-approval-owner"),
        id: "approval-human-action-close",
        runId: undefined,
        nodeRunId: undefined
      });
      await store.appendHumanActionRequest(createHumanActionRequest({
        id: "human-action-decision-close",
        responseIntent: "decision_required",
        approvalRequestId: approval.id
      }));
      const approvedRequest = {
        ...approval,
        status: "approved" as const,
        capabilities: resolveClosedCapabilities(),
        updatedAt: contractNow
      };
      const decision = createDecision("decision-human-action-close", approval.id, "approve", "approved");
      await expect(store.applyApprovalDecision({
        approvalRequestId: approval.id,
        expectedStatus: "pending",
        nextRequest: approvedRequest,
        decision
      })).resolves.toMatchObject({ status: "applied" });
      await expect(store.getHumanActionRequest("human-action-decision-close")).resolves.toMatchObject({
        status: "closed",
        updatedAt: contractNow
      });

      await store.updateHumanActionRequest({
        id: "human-action-decision-close",
        status: "pending",
        updatedAt: "2026-05-29T00:01:00.000Z"
      });
      await expect(store.applyApprovalDecision({
        approvalRequestId: approval.id,
        expectedStatus: "pending",
        nextRequest: approvedRequest,
        decision: createDecision("decision-human-action-duplicate", approval.id, "approve", "approved")
      })).resolves.toMatchObject({ status: "conflict" });
      await expect(store.getHumanActionRequest("human-action-decision-close")).resolves.toMatchObject({
        status: "closed",
        updatedAt: contractNow
      });
      await expect(store.listApprovalDecisions(approval.id)).resolves.toHaveLength(1);

      const discussionApproval = await store.upsertApprovalRequest({
        ...createContractApproval("run-approval-discussion", "node-run-approval-discussion"),
        id: "approval-human-action-discussion",
        runId: undefined,
        nodeRunId: undefined
      });
      await store.appendHumanActionRequest(createHumanActionRequest({
        id: "human-action-decision-discussion",
        responseIntent: "decision_required",
        approvalRequestId: discussionApproval.id
      }));
      await store.appendHumanActionResponse(createHumanActionResponse({
        id: "human-action-response-decision-discussion",
        requestId: "human-action-decision-discussion"
      }));
      await expect(store.getHumanActionRequest("human-action-decision-discussion")).resolves.toMatchObject({
        status: "pending"
      });
    } finally {
      close?.();
    }
  });
});

describe("SqliteHivewardStore execution schema constraints", () => {
  it("rejects invalid execution enum values and dangling session references", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "hiveward-sqlite-execution-constraints-"));
    const sqlitePath = join(dataDir, "hiveward.sqlite");
    const store = new SqliteHivewardStore(sqlitePath);
    await store.init();
    let runId = "";
    let nodeRunId = "";
    let approvalRequestId = "";
    try {
      const blueprint = await store.saveBlueprint(createContractBlueprint());
      const run = await store.createBlueprintRun(blueprint, "constraint-user");
      runId = run.id;
      const nodeRun = createContractNodeRun(run, { result: { ok: true } });
      nodeRunId = nodeRun.id;
      await store.upsertNodeRun(nodeRun);
      const command: RunCommand = {
        id: "run-command-constraint",
        commandKey: `constraint:${run.id}:execute`,
        blueprintId: run.blueprintId,
        runId: run.id,
        kind: "regular_run",
        status: "running",
        currentRevision: 1,
        currentStep: "node_execution",
        createdAt: contractNow,
        updatedAt: contractNow
      };
      await store.createRunCommandIfAbsent(command);
      const approval = await store.upsertApprovalRequest(createContractApproval(run.id, nodeRun.id));
      approvalRequestId = approval.id;
    } finally {
      store.close();
    }

    const driver = new SqliteDriver(sqlitePath);
    try {
      expect(() => driver.db.prepare(
        `INSERT INTO run_command_steps (
          id, command_id, step_key, run_id, revision, mode, node_id, node_run_id, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        "run-command-step-invalid-mode",
        "run-command-constraint",
        "constraint:invalid-mode",
        runId,
        1,
        "old_preflight_guess",
        "contract-agent",
        nodeRunId,
        "queued",
        contractNow,
        contractNow
      )).toThrow(/CHECK constraint failed/);

      expect(() => driver.db.prepare(
        `INSERT INTO approval_discussion_bindings (
          approval_request_id, mode, route, executor_actor, executor_kind, executor_node_run_id,
          executor_session_id, runtime_id, can_stream_reply,
          resolver_version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        approvalRequestId,
        "executor",
        "agent_approval",
        "agent",
        "agent_approval",
        nodeRunId,
        "missing-executor-session",
        "codex",
        1,
        1,
        contractNow,
        contractNow
      )).toThrow(/FOREIGN KEY constraint failed/);
    } finally {
      driver.close();
    }
  });
});

describe("SqliteHivewardStore runtime storage", () => {
  it("creates new runs without writing data/runs JSON archives", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "hiveward-sqlite-no-run-json-"));
    const store = new SqliteHivewardStore(join(dataDir, "hiveward.sqlite"));
    await store.init();
    try {
      const blueprint = await store.saveBlueprint(createContractBlueprint());
      const run = await store.createBlueprintRun(blueprint, "contract-user");
      await store.upsertNodeRun(createContractNodeRun(run, { result: { ok: true } }));

      const runsDir = join(dataDir, "runs");
      const runFiles = existsSync(runsDir) ? await readdir(runsDir) : [];
      expect(runFiles.filter((file) => file.endsWith(".json") || file.endsWith(".tmp"))).toEqual([]);
      await expect(store.getRunView(run.id)).resolves.toMatchObject({
        nodeRuns: [expect.objectContaining({ id: "node-run-contract-agent" })]
      });
    } finally {
      store.close();
    }
  });

  it("atomically claims and completes node runs across SQLite connections", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "hiveward-sqlite-claim-"));
    const sqlitePath = join(dataDir, "hiveward.sqlite");
    const first = new SqliteHivewardStore(sqlitePath);
    const second = new SqliteHivewardStore(sqlitePath);
    await first.init();
    await second.init();
    try {
      const blueprint = await first.saveBlueprint(createContractBlueprint());
      const run = await first.createBlueprintRun(blueprint, "contract-user");
      const queued = createContractNodeRun(run, undefined, "queued");
      await first.upsertNodeRun(queued);

      const claims = await Promise.all([
        first.claimNodeRun({ nodeRunId: queued.id, owner: "worker-a", leaseMs: 30_000 }),
        second.claimNodeRun({ nodeRunId: queued.id, owner: "worker-b", leaseMs: 30_000 })
      ]);
      expect(claims.filter((claim) => claim.claimed)).toHaveLength(1);
      const winner = claims[0]?.claimed ? "worker-a" : "worker-b";
      const winnerClaim = claims[0]?.claimed ? claims[0] : claims[1]!;
      const winnerStore = winner === "worker-a" ? first : second;
      const loserStore = winner === "worker-a" ? second : first;

      const completed = {
        ...queued,
        status: "succeeded" as const,
        startedAt: contractNow,
        endedAt: contractNow,
        output: { result: { winner } }
      };
      await expect(winnerStore.completeNodeRun({
        nodeRunId: queued.id,
        owner: winner,
        workerEpoch: winnerClaim.workerEpoch ?? 0,
        nodeRun: completed
      })).resolves.toBe(true);
      await expect(loserStore.completeNodeRun({
        nodeRunId: queued.id,
        owner: winner === "worker-a" ? "worker-b" : "worker-a",
        workerEpoch: winnerClaim.workerEpoch ?? 0,
        nodeRun: { ...completed, output: { result: { winner: "loser" } } }
      })).resolves.toBe(false);

      const view = await first.getRunView(run.id);
      expect(view?.nodeRuns[0]).toMatchObject({ status: "succeeded", output: { result: { winner } } });
    } finally {
      first.close();
      second.close();
    }
  });

  it("rejects late terminal transitions and allows reclaim only after lease expiry", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "hiveward-sqlite-lease-"));
    const sqlitePath = join(dataDir, "hiveward.sqlite");
    const first = new SqliteHivewardStore(sqlitePath);
    const second = new SqliteHivewardStore(sqlitePath);
    await first.init();
    await second.init();
    try {
      const blueprint = await first.saveBlueprint(createContractBlueprint());
      const run = await first.createBlueprintRun(blueprint, "contract-user");
      const queued = createContractNodeRun(run, undefined, "queued");
      await first.createQueuedNodeRun(queued);

      const firstClaim = await first.claimNodeRun({ nodeRunId: queued.id, owner: "worker-a", leaseMs: 10 });
      expect(firstClaim.claimed).toBe(true);
      await expect(second.claimNodeRun({ nodeRunId: queued.id, owner: "worker-b", leaseMs: 10 })).resolves.toMatchObject({ claimed: false });
      await new Promise((resolve) => setTimeout(resolve, 25));
      const secondClaim = await second.claimNodeRun({ nodeRunId: queued.id, owner: "worker-b", leaseMs: 30_000 });
      expect(secondClaim.claimed).toBe(true);

      const completed = {
        ...queued,
        status: "succeeded" as const,
        startedAt: contractNow,
        endedAt: contractNow,
        output: { result: { owner: "worker-b" } }
      };
      await expect(first.completeNodeRun({
        nodeRunId: queued.id,
        owner: "worker-a",
        workerEpoch: firstClaim.workerEpoch ?? 0,
        nodeRun: { ...completed, output: { result: { owner: "stale" } } }
      })).resolves.toBe(false);
      await expect(second.completeNodeRun({
        nodeRunId: queued.id,
        owner: "worker-b",
        workerEpoch: secondClaim.workerEpoch ?? 0,
        nodeRun: completed
      })).resolves.toBe(true);
      await expect(first.failNodeRun({
        nodeRunId: queued.id,
        owner: "worker-a",
        workerEpoch: firstClaim.workerEpoch ?? 0,
        error: "late failure"
      })).resolves.toBe(false);
      await expect(second.cancelNodeRun({
        nodeRunId: queued.id,
        owner: "worker-b",
        workerEpoch: secondClaim.workerEpoch ?? 0,
        reason: "late cancel"
      })).resolves.toBe(false);

      const view = await first.getRunView(run.id);
      expect(view?.nodeRuns[0]).toMatchObject({ status: "succeeded", output: { result: { owner: "worker-b" } } });
    } finally {
      first.close();
      second.close();
    }
  });

  it("rolls back publishAgentOutput when a transactional side write fails", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "hiveward-sqlite-publish-rollback-"));
    const store = new SqliteHivewardStore(join(dataDir, "hiveward.sqlite"));
    await store.init();
    try {
      const blueprint = await store.saveBlueprint(createContractBlueprint());
      const run = await store.createBlueprintRun(blueprint, "contract-user");
      const queued = createContractNodeRun(run, undefined, "queued");
      await store.createQueuedNodeRun(queued);
      const claim = await store.claimNodeRun({ nodeRunId: queued.id, owner: "worker-a", leaseMs: 30_000 });
      if (!claim.claimed || claim.workerEpoch === undefined) throw new Error("Expected node claim.");
      const completed = {
        ...queued,
        status: "succeeded" as const,
        startedAt: contractNow,
        endedAt: contractNow,
        output: { result: { ok: true } }
      };

      await expect(store.publishAgentOutput({
        runId: run.id,
        nodeRunId: queued.id,
        owner: "worker-a",
        workerEpoch: claim.workerEpoch,
        nodeRun: completed,
        output: completed.output,
        rawResult: completed.output,
        artifacts: [],
        humanReport: {
          ...createContractHumanReport("missing-run", queued.id),
          id: "agent-human-report-invalid-run"
        },
        event: createContractEvent(run.id, queued.id, 99)
      })).rejects.toThrow();

      const view = await store.getRunView(run.id);
      expect(view?.nodeRuns[0]?.status).toBe("running");
      expect(view?.events.some((event) => event.id === "event-contract-99")).toBe(false);
      await expect(store.listAgentHumanReports(run.id)).resolves.toEqual([]);
    } finally {
      store.close();
    }
  });

  it("reopens a WAL-mode SQLite store on Windows paths without losing state", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "hiveward-sqlite-wal-reopen-"));
    const sqlitePath = join(dataDir, "hiveward.sqlite");
    const first = new SqliteHivewardStore(sqlitePath);
    await first.init();
    const blueprint = await first.saveBlueprint(createContractBlueprint());
    const run = await first.createBlueprintRun(blueprint, "contract-user");
    first.close();

    const second = new SqliteHivewardStore(sqlitePath);
    await second.init();
    try {
      await expect(second.getBlueprint(blueprint.id)).resolves.toMatchObject({ id: blueprint.id });
      await expect(second.getBlueprintRun(run.id)).resolves.toMatchObject({ id: run.id });
    } finally {
      second.close();
    }
  });

  it("keeps event sequences unique when multiple node completions append events", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "hiveward-sqlite-events-"));
    const sqlitePath = join(dataDir, "hiveward.sqlite");
    const first = new SqliteHivewardStore(sqlitePath);
    const second = new SqliteHivewardStore(sqlitePath);
    await first.init();
    await second.init();
    try {
      const blueprint = await first.saveBlueprint(createContractBlueprint());
      const run = await first.createBlueprintRun(blueprint, "contract-user");
      await Promise.all(Array.from({ length: 8 }, (_, index) => {
        const store = index % 2 === 0 ? first : second;
        return store.appendEvent({
          id: `event-concurrent-${index}`,
          blueprintRunId: run.id,
          type: "node.run.completed",
          message: `Node ${index} completed.`,
          createdAt: new Date(Date.parse(contractNow) + index).toISOString()
        });
      }));

      const view = await first.getRunView(run.id);
      expect(view?.events).toHaveLength(8);
      const ids = new Set(view?.events.map((event) => event.id));
      expect(ids.size).toBe(8);
      expect(view?.events.map((event) => event.id)).toEqual(Array.from({ length: 8 }, (_, index) => `event-concurrent-${index}`));
    } finally {
      first.close();
      second.close();
    }
  });

  it("publishes multiple claimed agent outputs across SQLite connections without duplicate terminal writes or sequences", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "hiveward-sqlite-publish-concurrent-"));
    const sqlitePath = join(dataDir, "hiveward.sqlite");
    const first = new SqliteHivewardStore(sqlitePath);
    const second = new SqliteHivewardStore(sqlitePath);
    await first.init();
    await second.init();
    try {
      const blueprint = await first.saveBlueprint(createContractBlueprint());
      const run = await first.createBlueprintRun(blueprint, "contract-user");
      const queuedRuns = await Promise.all(Array.from({ length: 6 }, async (_item, index) => {
        const nodeRun = {
          ...createContractNodeRun(run, undefined, "queued"),
          id: `node-run-concurrent-${index}`,
          nodeId: "contract-agent",
          nodeLabel: `Concurrent ${index}`
        };
        await first.createQueuedNodeRun(nodeRun);
        return nodeRun;
      }));
      const claims = await Promise.all(queuedRuns.map((nodeRun, index) =>
        (index % 2 === 0 ? first : second).claimNodeRun({
          nodeRunId: nodeRun.id,
          owner: `worker-${index}`,
          leaseMs: 30_000
        })
      ));
      expect(claims.every((claim) => claim.claimed && claim.workerEpoch !== undefined)).toBe(true);

      await Promise.all(queuedRuns.map((nodeRun, index) => {
        const store = index % 2 === 0 ? first : second;
        const claim = claims[index]!;
        const completed = {
          ...nodeRun,
          status: "succeeded" as const,
          startedAt: contractNow,
          endedAt: contractNow,
          output: {
            contractVersion: 2,
            humanReportMd: `## Report ${index}`,
            handoffJson: { index },
            result: { index }
          }
        };
        return store.publishAgentOutput({
          runId: run.id,
          nodeRunId: nodeRun.id,
          owner: `worker-${index}`,
          workerEpoch: claim.workerEpoch ?? 0,
          nodeRun: completed,
          output: completed.output,
          rawResult: completed.output,
          artifacts: [{
            id: `artifact-concurrent-${index}`,
            runId: run.id,
            nodeRunId: nodeRun.id,
            slot: "link",
            title: `Concurrent link ${index}`,
            kind: "link",
            downloadUrl: `https://example.invalid/${index}`,
            previewPolicy: "none",
            trusted: false,
            status: "current",
            createdAt: contractNow
          }],
          humanReport: {
            ...createContractHumanReport(run.id, nodeRun.id),
            id: `agent-human-report-concurrent-${index}`,
            nodeId: nodeRun.nodeId,
            nodeLabel: nodeRun.nodeLabel,
            title: `${nodeRun.nodeLabel} report`,
            bodyMd: `## Report ${index}`
          },
          handoff: {
            ...createContractHandoff(run.id, nodeRun.id),
            id: `agent-handoff-concurrent-${index}`,
            nodeId: nodeRun.nodeId,
            payload: { index }
          },
          event: {
            ...createContractEvent(run.id, nodeRun.id, index + 1),
            id: `event-publish-concurrent-${index}`,
            type: "node.run.completed"
          },
          timelineItems: [{
            id: `timeline-publish-concurrent-${index}`,
            runId: run.id,
            createdAt: contractNow,
            actorNodeId: nodeRun.nodeId,
            actorLabel: nodeRun.nodeLabel,
            kind: "node_output",
            title: `${nodeRun.nodeLabel} completed`
          }]
        });
      }));

      const view = await first.getRunView(run.id);
      expect(view?.nodeRuns.filter((nodeRun) => nodeRun.status === "succeeded")).toHaveLength(6);
      expect(view?.artifacts).toHaveLength(6);
      expect(view?.agentHumanReports).toHaveLength(6);
      expect(view?.agentHandoffs).toHaveLength(6);
      expect(view?.events.map((event) => event.id)).toEqual(Array.from({ length: 6 }, (_item, index) => `event-publish-concurrent-${index}`));
      expect(new Set(view?.runTimeline?.map((item) => item.sequence)).size).toBe(6);
    } finally {
      first.close();
      second.close();
    }
  });
});

function resolveClosedCapabilities() {
  return { approve: false, reject: false, reply: false, complete: false, terminate: false };
}

function createDecision(
  id: string,
  approvalRequestId: string,
  action: "approve" | "reject" | "reply",
  resultingStatus: "approved" | "rejected" | "pending",
  comment = "Decision comment."
) {
  return {
    id,
    approvalRequestId,
    action,
    actor: "user" as const,
    comment,
    resultingStatus,
    createdAt: contractNow
  };
}

function createDecisionTimeline(id: string, runId: string, decision: ReturnType<typeof createDecision>) {
  return {
    id,
    runId,
    createdAt: decision.createdAt,
    actorLabel: "user",
    kind: "decision_created" as const,
    title: `Decision ${decision.action}`,
    body: decision.comment,
    payloadRef: decision.approvalRequestId
  };
}

function createHumanActionRequest(overrides: Partial<HumanActionRequest> = {}): HumanActionRequest {
  return {
    id: "human-action-request-contract-test",
    sourceContextType: "run_room",
    sourceContextId: "run-room-contract-test",
    responseIntent: "reply_required",
    status: "pending",
    title: "Human action required",
    bodyMarkdown: "Please respond.",
    createdAt: contractNow,
    updatedAt: contractNow,
    ...overrides
  };
}

function createHumanActionResponse(overrides: Partial<HumanActionResponse> = {}): HumanActionResponse {
  return {
    id: "human-action-response-contract-test",
    requestId: "human-action-request-contract-test",
    messageMarkdown: "Human response.",
    createdAt: contractNow,
    ...overrides
  };
}
