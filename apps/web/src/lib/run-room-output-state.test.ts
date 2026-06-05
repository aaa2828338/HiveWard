import { describe, expect, it } from "vitest";
import type { AgentOutputEvent, BlueprintRunView, RunInterjection, RunRoomOutputSnapshot, RunRoomOutputStreamEvent } from "@hiveward/shared";
import {
  applyRunRoomOutputStreamEvent,
  applyRunRoomOutputStreamEventToRunView,
  buildRunRoomOutputMessagesForDisplay
} from "./run-room-output-state";

describe("run room output state", () => {
  it("projects the active node invocation while it is still running", () => {
    const runView = createRunView({
      runRoomOutput: createOutput([
        event({
          id: "started",
          kind: "message_started",
          sequence: 1,
          bodyMarkdown: "Agent started.",
          runtimeState: runtimeState({ status: "running" })
        }),
        event({
          id: "runtime-started",
          kind: "runtime_state",
          sequence: 2,
          runtimeState: runtimeState({
            phase: "tool",
            label: "repo.search",
            id: "activity-1",
            status: "running"
          })
        }),
        event({
          id: "delta",
          kind: "message_delta",
          sequence: 3,
          delta: "draft answer"
        })
      ])
    });

    const messages = buildRunRoomOutputMessagesForDisplay(runView);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      id: "run-room-output-node-run-1",
      runRoomId: "run-room-1",
      runRoomInvocationId: "node-run-1",
      role: "assistant",
      content: "draft answer",
      status: "streaming",
      runtimeStatus: {
        phase: "tool",
        label: "repo.search"
      }
    });
    expect(messages[0]?.runtimeActivities).toEqual([
      expect.objectContaining({
        id: "activity-1",
        label: "repo.search",
        status: "updated"
      })
    ]);
  });

  it("projects humanReportMd from active structured output envelopes", () => {
    const envelope = JSON.stringify({
      humanReportMd: "## PRD\n\nUse `best-practice-research` for upstream evidence.",
      handoffJson: null,
      result: null,
      artifacts: null
    });
    const messages = buildRunRoomOutputMessagesForDisplay(createRunView({
      runRoomOutput: createOutput([
        event({ id: "started", kind: "message_started", sequence: 1 }),
        event({
          id: "delta",
          kind: "message_delta",
          sequence: 2,
          delta: envelope
        })
      ])
    }));

    expect(messages).toHaveLength(1);
    expect(messages[0]?.content).toBe("## PRD\n\nUse `best-practice-research` for upstream evidence.");
    expect(messages[0]?.content).not.toContain("humanReportMd");
    expect(messages[0]?.content).not.toContain("handoffJson");
    expect(messages[0]?.progressText).toBe(envelope);
  });

  it("joins concatenated structured output envelopes without rendering machine fields", () => {
    const first = JSON.stringify({
      humanReportMd: "First readable update.",
      handoffJson: null,
      result: null,
      artifacts: null
    });
    const second = JSON.stringify({
      humanReportMd: "Second readable update.",
      handoffJson: null,
      result: null,
      artifacts: null
    });
    const messages = buildRunRoomOutputMessagesForDisplay(createRunView({
      runRoomOutput: createOutput([
        event({ id: "started", kind: "message_started", sequence: 1 }),
        event({
          id: "delta",
          kind: "message_delta",
          sequence: 2,
          delta: `${first}\n${second}`
        })
      ])
    }));

    expect(messages).toHaveLength(1);
    expect(messages[0]?.content).toBe("First readable update.\n\nSecond readable update.");
    expect(messages[0]?.content).not.toContain("humanReportMd");
    expect(messages[0]?.content).not.toContain("artifacts");
  });

  it("streams readable humanReportMd text from partial structured output envelopes", () => {
    const rawPartialEnvelope = "{\"humanReportMd\":\"Draft report\\ncontinues";
    const messages = buildRunRoomOutputMessagesForDisplay(createRunView({
      runRoomOutput: createOutput([
        event({ id: "started", kind: "message_started", sequence: 1 }),
        event({
          id: "delta",
          kind: "message_delta",
          sequence: 2,
          delta: rawPartialEnvelope
        })
      ])
    }));

    expect(messages).toHaveLength(1);
    expect(messages[0]?.content).toBe("Draft report\ncontinues");
    expect(messages[0]?.content).not.toContain("humanReportMd");
    expect(messages[0]?.progressText).toBe(rawPartialEnvelope);
  });

  it("updates runtime activity in place while active and removes it when completed", () => {
    const messages = buildRunRoomOutputMessagesForDisplay(createRunView({
      runRoomOutput: createOutput([
        event({ id: "started", kind: "message_started", sequence: 1 }),
        event({
          id: "runtime-started",
          kind: "runtime_state",
          sequence: 2,
          runtimeState: runtimeState({ phase: "command", label: "npm test", activityId: "cmd-1", activityStatus: "started" })
        }),
        event({
          id: "runtime-updated",
          kind: "runtime_state",
          sequence: 3,
          runtimeState: runtimeState({ phase: "command", label: "npm test", activityId: "cmd-1", activityStatus: "updated" })
        }),
        event({
          id: "runtime-completed",
          kind: "runtime_state",
          sequence: 4,
          runtimeState: runtimeState({ phase: "command", label: "npm test", activityId: "cmd-1", activityStatus: "completed" })
        })
      ])
    }));

    expect(messages).toHaveLength(1);
    expect(messages[0]?.status).toBe("streaming");
    expect(messages[0]?.runtimeStatus).toBeUndefined();
    expect(messages[0]?.runtimeActivities).toBeUndefined();
    expect(messages[0]?.runtimeRef?.activity).toBeUndefined();
  });

  it("keeps runtime commands in the activity list instead of the readable message body", () => {
    const command = "\"C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe\" -Command \"Get-Content -Encoding UTF8 | ConvertFrom-Json\"";
    const messages = buildRunRoomOutputMessagesForDisplay(createRunView({
      runRoomOutput: createOutput([
        event({ id: "started", kind: "message_started", sequence: 1 }),
        event({
          id: "runtime-command",
          kind: "runtime_state",
          sequence: 2,
          runtimeState: runtimeState({ phase: "command", label: command, activityId: "cmd-1", activityStatus: "started" })
        }),
        event({ id: "delta", kind: "message_delta", sequence: 3, delta: "Readable worker update." })
      ])
    }));

    expect(messages).toHaveLength(1);
    expect(messages[0]?.content).toBe("Readable worker update.");
    expect(messages[0]?.content).not.toContain("Get-Content");
    expect(messages[0]?.runtimeActivities).toEqual([
      expect.objectContaining({
        id: "cmd-1",
        phase: "command",
        label: command,
        status: "started"
      })
    ]);
  });

  it("keeps completed and failed readable output while clearing finished runtime activity", () => {
    const completedMessages = buildRunRoomOutputMessagesForDisplay(createRunView({
      runRoomOutput: createOutput([
        event({ id: "started", kind: "message_started", sequence: 1 }),
        event({
          id: "runtime-completed",
          kind: "runtime_state",
          sequence: 2,
          runtimeState: runtimeState({ phase: "tool", label: "web_search", activityId: "tool-1", activityStatus: "completed" })
        }),
        event({ id: "delta", kind: "message_delta", sequence: 3, delta: "stale draft" }),
        event({ id: "completed", kind: "message_completed", sequence: 4, bodyMarkdown: "final answer" })
      ])
    }));
    const failedMessages = buildRunRoomOutputMessagesForDisplay(createRunView({
      runRoomOutput: createOutput([
        event({ id: "started", kind: "message_started", sequence: 1 }),
        event({
          id: "runtime-failed",
          kind: "runtime_state",
          sequence: 2,
          runtimeState: runtimeState({ phase: "command", label: "npm test", activityId: "cmd-1", activityStatus: "failed" })
        }),
        event({ id: "failed", kind: "message_failed", sequence: 3, bodyMarkdown: "{\"humanReportMd\":\"readable failure\"}" })
      ])
    }));

    expect(completedMessages).toHaveLength(1);
    expect(completedMessages[0]?.status).toBe("sent");
    expect(completedMessages[0]?.content).toBe("final answer");
    expect(completedMessages[0]?.runtimeActivities).toBeUndefined();
    expect(completedMessages[0]?.runtimeRef?.activity).toBeUndefined();
    expect(failedMessages).toHaveLength(1);
    expect(failedMessages[0]?.status).toBe("failed");
    expect(failedMessages[0]?.content).toBe("readable failure");
    expect(failedMessages[0]?.runtimeActivities).toBeUndefined();
    expect(failedMessages[0]?.runtimeRef?.activity).toBeUndefined();
  });

  it("applies output snapshots, agent output events, and run interjections without row upserts", () => {
    const snapshotEvent = event({ id: "snapshot-started", kind: "message_started", sequence: 1 });
    const snapshot: RunRoomOutputStreamEvent = {
      type: "output_snapshot",
      runRoomId: "run-room-1",
      output: createOutput([snapshotEvent], [interjection("interjection-1", "Before")]),
      emittedAt: "2026-06-04T00:00:01.000Z"
    };
    const withSnapshot = applyRunRoomOutputStreamEvent(undefined, snapshot);
    const withDelta = applyRunRoomOutputStreamEvent(withSnapshot, {
      type: "agent_output_event",
      runRoomId: "run-room-1",
      event: event({ id: "delta", kind: "message_delta", sequence: 2, delta: "live" }),
      cursor: "cursor-1",
      emittedAt: "2026-06-04T00:00:02.000Z"
    });
    const withInterjection = applyRunRoomOutputStreamEvent(withDelta, {
      type: "run_interjection",
      runRoomId: "run-room-1",
      interjection: interjection("interjection-2", "After"),
      cursor: "cursor-2",
      emittedAt: "2026-06-04T00:00:03.000Z"
    });

    expect(withInterjection?.events.map((item) => item.id)).toEqual(["snapshot-started", "delta"]);
    expect(withInterjection?.interjections.map((item) => item.messageMarkdown)).toEqual(["Before", "After"]);
    expect(applyRunRoomOutputStreamEventToRunView(createRunView(), snapshot).runRoomOutput?.events).toHaveLength(1);
  });

  it("does not render runtime_state alone as a standalone message", () => {
    const messages = buildRunRoomOutputMessagesForDisplay(createRunView({
      runRoomOutput: createOutput([
        event({
          id: "runtime-only",
          kind: "runtime_state",
          sequence: 1,
          runtimeState: runtimeState({ phase: "thinking", label: "thinking" })
        })
      ])
    }));

    expect(messages).toEqual([]);
  });

  it("filters old owners, mismatched run rooms, missing source ids, and tool_state events", () => {
    const messages = buildRunRoomOutputMessagesForDisplay(createRunView({
      runRoomOutput: createOutput([
        event({
          id: "chat-bleed",
          ownerType: "chat_session",
          ownerId: "chat-1",
          kind: "message_completed",
          sequence: 1,
          bodyMarkdown: "chat bleed"
        }),
        event({
          id: "old-worker-owner",
          ownerType: "worker_task",
          ownerId: "worker-task-1",
          kind: "message_completed",
          sequence: 2,
          bodyMarkdown: "old worker owner"
        }),
        event({
          id: "missing-source",
          sourceId: undefined,
          kind: "message_completed",
          sequence: 3,
          bodyMarkdown: "missing source"
        }),
        event({
          id: "metadata-mismatch",
          kind: "message_completed",
          sequence: 4,
          bodyMarkdown: "metadata mismatch",
          metadata: { runRoomId: "run-room-other" }
        }),
        event({
          id: "tool-state",
          kind: "tool_state",
          sequence: 5,
          bodyMarkdown: "tool state"
        }),
        event({
          id: "valid",
          kind: "message_delta",
          sequence: 6,
          delta: "valid output"
        })
      ])
    }));

    expect(messages).toHaveLength(1);
    expect(messages[0]?.content).toBe("valid output");
  });

  it("hides raw invocation output after a release report exists while keeping user interjections", () => {
    const messages = buildRunRoomOutputMessagesForDisplay(createRunView({
      runRoomOutput: createOutput([
        event({ id: "completed", kind: "message_completed", bodyMarkdown: "{\"humanReportMd\":\"raw\"}" })
      ], [
        interjection("interjection-1", "Please continue.")
      ]),
      releaseReports: [{
        id: "release-report-1",
        runId: "run-1",
        roundId: "round-1",
        approvalRequestId: "approval-1",
        version: 1,
        title: "Report",
        summary: "Durable report summary.",
        artifactRefs: [],
        createdAt: "2026-06-04T00:00:04.000Z"
      }]
    }));

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      role: "user",
      content: "Please continue."
    });
    expect(messages.map((message) => message.content).join("\n")).not.toContain("humanReportMd");
  });
});

function createOutput(events: AgentOutputEvent[] = [], interjections: RunInterjection[] = []): RunRoomOutputSnapshot {
  return {
    runRoomId: "run-room-1",
    events,
    interjections
  };
}

function event(overrides: Partial<AgentOutputEvent>): AgentOutputEvent {
  return {
    id: "event-1",
    ownerType: "run_room",
    ownerId: "run-room-1",
    actorType: "worker",
    kind: "message_completed",
    sequence: 1,
    sourceType: "blueprint_node_run",
    sourceId: "node-run-1",
    bodyMarkdown: "Message.",
    metadata: { runRoomId: "run-room-1" },
    createdAt: "2026-06-04T00:00:00.000Z",
    ...overrides
  };
}

function runtimeState(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    taskId: "task-1",
    runId: "task-run-1",
    sessionKey: "native-1",
    source: "codex",
    status: "running",
    updatedAt: "2026-06-04T00:00:00.000Z",
    ...overrides
  };
}

function interjection(id: string, messageMarkdown: string): RunInterjection {
  return {
    id,
    runRoomId: "run-room-1",
    target: "manager",
    messageMarkdown,
    createdAt: "2026-06-04T00:00:00.000Z"
  };
}

function createRunView(overrides: Partial<BlueprintRunView> = {}): BlueprintRunView {
  return {
    run: {
      id: "run-1",
      companyId: "company-1",
      blueprintId: "blueprint-1",
      blueprintName: "Blueprint",
      blueprintVersion: 1,
      status: "running",
      startedBy: "user-1",
      startedAt: "2026-06-04T00:00:00.000Z",
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCostUsd: 0,
      runtimeRefs: []
    },
    nodeRuns: [],
    events: [],
    finalResult: null,
    ...overrides
  };
}
