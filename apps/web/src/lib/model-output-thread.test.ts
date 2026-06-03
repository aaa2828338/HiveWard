import { describe, expect, it } from "vitest";
import type { AgentOutputEvent } from "@hiveward/shared";
import {
  applyAgentOutputEventToThread,
  projectModelOutputThread,
  projectModelOutputThreadFromUnknown
} from "./model-output-thread";

describe("model output thread projection", () => {
  it("projects user and assistant AgentOutputEvent rows into render-only messages", () => {
    const messages = projectModelOutputThread([
      event({
        id: "user-1",
        sequence: 1,
        actorType: "user",
        kind: "message_completed",
        bodyMarkdown: "Start the analysis.",
        metadata: { role: "user", harnessId: "codex" }
      }),
      event({
        id: "assistant-started",
        sequence: 2,
        actorType: "worker",
        kind: "message_started",
        runtimeState: {
          taskId: "task-1",
          runId: "run-1",
          sessionKey: "native-1",
          source: "codex",
          status: "running",
          updatedAt: "2026-06-03T00:00:01.000Z"
        }
      }),
      event({
        id: "assistant-delta",
        sequence: 3,
        actorType: "worker",
        kind: "message_delta",
        delta: "partial"
      }),
      event({
        id: "assistant-runtime",
        sequence: 4,
        actorType: "worker",
        kind: "runtime_state",
        runtimeState: {
          source: "codex",
          phase: "tool",
          label: "repo.search",
          activityId: "tool-1",
          activityStatus: "completed",
          updatedAt: "2026-06-03T00:00:02.000Z"
        }
      }),
      event({
        id: "assistant-completed",
        sequence: 5,
        actorType: "worker",
        kind: "message_completed",
        bodyMarkdown: "final answer",
        runtimeState: {
          taskId: "task-1",
          runId: "run-1",
          sessionKey: "native-1",
          source: "codex",
          status: "succeeded",
          updatedAt: "2026-06-03T00:00:03.000Z",
          activity: [
            {
              id: "tool-1",
              source: "codex",
              phase: "tool",
              label: "repo.search",
              status: "completed",
              updatedAt: "2026-06-03T00:00:02.000Z"
            }
          ]
        }
      })
    ]);

    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({
      role: "user",
      content: "Start the analysis.",
      status: "sent",
      harnessId: "codex"
    });
    expect(messages[1]).toMatchObject({
      role: "assistant",
      content: "final answer",
      status: "sent",
      runtimeRef: {
        taskId: "task-1",
        sessionKey: "native-1",
        source: "codex",
        status: "succeeded"
      }
    });
    expect(messages[1]?.runtimeRef?.activity).toEqual([
      expect.objectContaining({
        id: "tool-1",
        label: "repo.search",
        status: "completed"
      })
    ]);
  });

  it("rejects old owner values before projection", () => {
    const projected = projectModelOutputThreadFromUnknown([
      {
        id: "old-inbox-event",
        ownerType: "inbox_item",
        ownerId: "inbox-1",
        actorType: "worker",
        kind: "message_completed",
        sequence: 1,
        bodyMarkdown: "old output path",
        createdAt: "2026-06-03T00:00:00.000Z"
      }
    ]);

    expect(projected).toEqual([]);
  });

  it("applies deltas and final replacement without deriving lifecycle from kind", () => {
    const started = projectModelOutputThread([
      event({
        id: "assistant-started",
        actorType: "worker",
        kind: "message_started"
      })
    ]);

    const withDelta = applyAgentOutputEventToThread(started, event({
      id: "assistant-delta",
      actorType: "worker",
      kind: "message_delta",
      sequence: 2,
      delta: "draft"
    }));
    const completed = applyAgentOutputEventToThread(withDelta, event({
      id: "assistant-completed",
      actorType: "worker",
      kind: "message_completed",
      sequence: 3,
      bodyMarkdown: "final"
    }));

    expect(completed[0]).toMatchObject({
      role: "assistant",
      content: "final",
      status: "sent"
    });
  });
});

function event(overrides: Partial<AgentOutputEvent>): AgentOutputEvent {
  return {
    id: "event-1",
    ownerType: "chat_session",
    ownerId: "session-1",
    actorType: "worker",
    kind: "message_completed",
    sequence: 1,
    createdAt: "2026-06-03T00:00:00.000Z",
    metadata: { role: "assistant" },
    ...overrides
  };
}
