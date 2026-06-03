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
  NodeSessionTranscriptEvent,
  RunInterjection,
  RunRoom,
  RunCommand,
  RunCommandStep,
  WorkerTask
} from "@hiveward/shared";
import { assertRunRoomFeedRow } from "@hiveward/shared";
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
        kind: "self_iteration_execute_round",
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

      const transcriptEvent: NodeSessionTranscriptEvent = {
        id: "node-session-transcript-contract-1",
        sessionId: executionSession.id,
        sequence: 1,
        runId: run.id,
        nodeRunId: nodeRun.id,
        role: "user",
        kind: "user_message",
        content: "Run the contract task.",
        metadata: { source: "contract" },
        createdAt: contractNow
      };
      await expect(store.appendNodeSessionTranscriptEvent(transcriptEvent)).resolves.toMatchObject({ id: transcriptEvent.id });
      await expect(store.appendNodeSessionTranscriptEvent({ ...transcriptEvent, id: "node-session-transcript-duplicate" }))
        .rejects.toThrow(/Transcript sequence 1 already exists/);
      await expect(store.appendNodeSessionTranscriptEvent({
        id: "node-session-transcript-contract-2",
        sessionId: executionSession.id,
        runId: run.id,
        nodeRunId: nodeRun.id,
        role: "runtime",
        kind: "runtime_done",
        content: "Runtime completed.",
        createdAt: contractNow
      })).resolves.toMatchObject({ id: "node-session-transcript-contract-2", sequence: 2 });

      const approval = await store.upsertApprovalRequest(createContractApproval(run.id, nodeRun.id));
      await store.appendApprovalReply({
        id: "approval-reply-candidate-contract",
        threadId: approval.id,
        approvalRequestId: approval.id,
        actor: "agent",
        purpose: "candidate",
        body: "Candidate approval response.",
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
        canCreateCandidate: true,
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
        selectedReplyId: "approval-reply-candidate-contract",
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
        nodeSessionTranscriptEvents: expect.arrayContaining([
          expect.objectContaining({ id: transcriptEvent.id, sequence: 1 }),
          expect.objectContaining({ id: "node-session-transcript-contract-2", sequence: 2 })
        ]),
        approvalDiscussionBindings: [expect.objectContaining({ approvalRequestId: approval.id, mode: "executor" })],
        approvalRequestDiscussions: [expect.objectContaining({
          approvalRequestId: approval.id,
          discussion: expect.objectContaining({
            mode: "none",
            reason: "approval_not_pending"
          })
        })],
        approvalRequests: [expect.objectContaining({ id: approval.id, status: "replied", selectedReplyId: "approval-reply-candidate-contract" })],
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
            id: "approval-reply-candidate-contract",
            purpose: "candidate",
            body: "Candidate approval response."
          })
        ]),
        artifacts: [expect.objectContaining({ id: artifact.id, slot: "deliverable" })],
        agentHumanReports: [expect.objectContaining({ nodeRunId: nodeRun.id, bodyMd: expect.stringContaining("Contract Report") })],
        agentHandoffs: [expect.objectContaining({ nodeRunId: nodeRun.id, payload: { next: "manager", facts: ["contract complete"] } })],
        managerContextSnapshots: [expect.objectContaining({ id: "manager-context-contract" })],
        runTimeline: [expect.objectContaining({ id: "timeline-contract", sequence: 1 })]
      });
      expect(view?.events.map((event) => event.id)).toEqual(["event-contract-1", "event-contract-2"]);
      await expect(store.getRunArchive(run.id)).resolves.toMatchObject({
        runCommands: [expect.objectContaining({ id: command.id })],
        runCommandSteps: [expect.objectContaining({ id: commandStep.id })],
        nodeExecutionSessions: [expect.objectContaining({ id: executionSession.id })],
        nodeSessionTranscriptEvents: expect.arrayContaining([
          expect.objectContaining({ id: transcriptEvent.id }),
          expect.objectContaining({ id: "node-session-transcript-contract-2", sequence: 2 })
        ]),
        approvalDiscussionBindings: [expect.objectContaining({ approvalRequestId: approval.id })]
      });

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
          id: "approval-reply-candidate-contract",
          purpose: "candidate"
        })
      ]));
      await expect(store.getApprovalDiscussionBinding(approval.id)).resolves.toMatchObject({
        mode: "executor",
        executorSessionId: executionSession.id
      });

      const inbox = await store.createBlueprintProposal({
        title: "Import proposal",
        summary: "Import a portable blueprint.",
        blueprintPackage: createContractPortablePackage()
      });
      const replied = await store.replyToInboxItem(inbox.id, "Please narrow scope.");
      expect(replied.replies?.[0]?.body).toBe("Please narrow scope.");
      const approved = await store.approveInboxItem(inbox.id, undefined, "Approved.");
      expect(approved.item.status).toBe("approved");
      expect(approved.importedBlueprints?.[0]?.name).toBe("Portable Contract Blueprint");

      const rejectedProposal = await store.createBlueprintProposal({
        title: "Reject proposal",
        summary: "Reject a portable blueprint.",
        blueprintPackage: createContractPortablePackage()
      });
      await expect(store.rejectInboxItem(rejectedProposal.id, "No capacity.")).resolves.toMatchObject({ status: "rejected" });

      const sessionRecord = await store.createChatSession({ harnessId: "codex", title: "Contract chat" });
      await store.appendChatMessage({
        sessionId: sessionRecord.id,
        role: "user",
        content: "Hello",
        harnessId: "codex",
        status: "sent"
      });
      await expect(store.listChatMessages(sessionRecord.id)).resolves.toEqual([expect.objectContaining({ content: "Hello" })]);
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
        status: "pending",
        title: "Decision needed",
        bodyMarkdown: "Choose the next step.",
        createdByRoleId: "manager-contract",
        createdAt: contractNow,
        updatedAt: contractNow
      };
      await expect(store.appendHumanActionRequest(request)).resolves.toMatchObject({
        id: request.id,
        sourceContextType: "run_room",
        responseIntent: "decision_required"
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
      await expect(store.listBlueprintKanbanCards({ companyId })).resolves.toEqual([
        expect.objectContaining({
          id: `blueprint-kanban-${runRoom.id}`,
          runRoomId: runRoom.id,
          lane: "open"
        })
      ]);

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

      expect(() => assertRunRoomFeedRow({
        id: "run-room-feed-execution-output",
        runRoomId: runRoom.id,
        sourceType: "worker",
        displayMode: "execution_output",
        bodyMarkdown: "Worker output.",
        actions: { canReply: true },
        createdAt: contractNow
      })).toThrow(/execution_output/);
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
            purpose: "candidate",
            body: "legacy node candidate must not project",
            createdAt: contractNow
          }]
        }
      };
      await store.upsertNodeRun(waitingNodeRun);
      const approval = await store.upsertApprovalRequest({
        ...createContractApproval(run.id, waitingNodeRun.id),
        body: "request body is the projection source",
        selectedReplyId: null
      });
      await store.appendApprovalReply({
        id: "approval-fact-candidate",
        threadId: approval.threadId ?? approval.id,
        approvalRequestId: approval.id,
        actor: "agent",
        purpose: "candidate",
        body: "approval fact candidate",
        createdAt: contractNow
      });

      await expect(store.listPendingApprovals()).resolves.toEqual([
        expect.objectContaining({
          approvalRequestId: approval.id,
          reviewOutput: "request body is the projection source",
          selectedReplyId: null,
          canReturnForRevision: true,
          replies: [
            expect.objectContaining({
              id: "approval-fact-candidate",
              purpose: "candidate",
              body: "approval fact candidate"
            })
          ]
        })
      ]);
    } finally {
      close?.();
    }
  });

  it("applies approval and inbox decisions once with conflict on repeats", async () => {
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

      const inbox = await store.createBlueprintProposal({
        title: "Atomic inbox proposal",
        summary: "Import a portable blueprint.",
        blueprintPackage: createContractPortablePackage()
      });
      const inboxApproval = await store.upsertApprovalRequest({
        ...createContractApproval(inbox.id, "inbox-node"),
        id: `approval-${inbox.id}`,
        runId: inbox.id,
        kind: "blueprint_proposal",
        sourceRef: { type: "inbox_item", id: inbox.id },
        payloadRef: inbox.id
      });
      const inboxReplyDecision = createDecision("decision-inbox-reply", inboxApproval.id, "reply", "pending", "Need details.");
      await expect(store.applyInboxDecision({
        inboxItemId: inbox.id,
        approvalRequestId: inboxApproval.id,
        action: "reply",
        comment: "Need details.",
        approvalDecision: inboxReplyDecision
      })).resolves.toMatchObject({ status: "applied", item: expect.objectContaining({ status: "pending" }) });
      await expect(store.listApprovalReplies({ approvalRequestId: inboxApproval.id })).resolves.toEqual([
        expect.objectContaining({ id: "reply-decision-inbox-reply", body: "Need details.", threadId: inboxApproval.id })
      ]);
      await expect(store.listApprovalThreads({ runId: inbox.id, status: "open" })).resolves.toEqual([
        expect.objectContaining({ id: inboxApproval.id, currentRequestId: inboxApproval.id })
      ]);
      const inboxDecision = createDecision("decision-inbox-once", inboxApproval.id, "approve", "approved");
      await expect(store.applyInboxDecision({
        inboxItemId: inbox.id,
        approvalRequestId: inboxApproval.id,
        action: "approve",
        defaults: {},
        approvalDecision: inboxDecision
      })).resolves.toMatchObject({ status: "applied", item: expect.objectContaining({ status: "approved" }) });
      await expect(store.applyInboxDecision({
        inboxItemId: inbox.id,
        approvalRequestId: inboxApproval.id,
        action: "approve",
        approvalDecision: createDecision("decision-inbox-duplicate", inboxApproval.id, "approve", "approved")
      })).resolves.toMatchObject({ status: "conflict" });
      await expect(store.listApprovalDecisions(inboxApproval.id)).resolves.toEqual([
        expect.objectContaining({ id: "decision-inbox-reply" }),
        expect.objectContaining({ id: "decision-inbox-once" })
      ]);
      await expect(store.listApprovalThreads({ runId: inbox.id, status: "closed" })).resolves.toEqual([
        expect.objectContaining({ id: inboxApproval.id, currentRequestId: undefined })
      ]);
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
          executor_session_id, runtime_id, can_stream_reply, can_create_candidate,
          resolver_version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
