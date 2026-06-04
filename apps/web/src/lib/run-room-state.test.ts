import { describe, expect, it } from "vitest";
import type { BlueprintRunView, RunRoomFeedRow } from "@hiveward/shared";
import {
  buildRunRoomFeedRowsForDisplay,
  canOpenRunRoomFeedWorkerDetails,
  formatRunRoomFeedRuntimeState
} from "./run-room-state";

describe("run-room-state", () => {
  it("projects RunRoomFeed rows in stable display order", () => {
    const runView = createRunView({
      runRoomFeed: {
        runRoomId: "run-room-1",
        rows: [
          createFeedRow({
            id: "worker-row",
            sourceType: "worker",
            displayMode: "execution_output",
            bodyMarkdown: "Worker completed **step one**.",
            createdAt: "2026-06-03T00:02:00.000Z",
            runtimeState: { phase: "tool", status: "running", label: "npm test" }
          }),
          createFeedRow({
            id: "manager-row",
            sourceType: "manager",
            displayMode: "formal_message",
            bodyMarkdown: "Manager is coordinating the run.",
            createdAt: "2026-06-03T00:01:00.000Z"
          }),
          createFeedRow({
            id: "system-row",
            sourceType: "system",
            displayMode: "formal_message",
            bodyMarkdown: "RunRoom opened.",
            createdAt: "2026-06-03T00:03:00.000Z"
          })
        ]
      }
    });

    const rows = buildRunRoomFeedRowsForDisplay(runView);

    expect(rows.map((row) => row.id)).toEqual(["manager-row", "worker-row", "system-row"]);
    expect(rows[1]?.displayMode).toBe("execution_output");
    expect(canOpenRunRoomFeedWorkerDetails(rows[1]!)).toBe(true);
    expect(formatRunRoomFeedRuntimeState(rows[1]!)).toBe("Runtime state: tool / running / npm test");
  });

  it("forbids worker execution output from carrying normal message actions", () => {
    const runView = createRunView({
      runRoomFeed: {
        runRoomId: "run-room-1",
        rows: [
          createFeedRow({
            id: "worker-with-actions",
            sourceType: "worker",
            displayMode: "execution_output",
            bodyMarkdown: "Worker visible output only.",
            actions: {
              canReply: true,
              canMention: true,
              canDirectMessage: true,
              canSelectSendTarget: true,
              canApprove: true,
              canReject: true,
              canOpenInbox: true
            }
          })
        ]
      }
    });

    const [row] = buildRunRoomFeedRowsForDisplay(runView);

    expect(row?.sourceType).toBe("worker");
    expect(row?.displayMode).toBe("execution_output");
    expect(row?.actions).toBeUndefined();
    expect(canOpenRunRoomFeedWorkerDetails(row!)).toBe(true);
  });

  it("does not project residual historical run records as normal feed rows", () => {
    const outputListKey = ["node", "Session", "Transcript", "Events"].join("");
    const historyKey = ["run", "Timeline"].join("");
    const executionListKey = ["node", "Runs"].join("");
    const runView = createRunView() as BlueprintRunView & Record<string, unknown>;
    runView[outputListKey] = [{ content: "Residual transcript content" }];
    runView[historyKey] = [{ body: "Residual timeline content" }];
    runView[executionListKey] = [{ output: "Residual node output" }];

    const rows = buildRunRoomFeedRowsForDisplay(runView);

    expect(rows).toEqual([]);
    expect(rows.some(canOpenRunRoomFeedWorkerDetails)).toBe(false);
  });

  it("keeps missing or empty canonical feed separate from feed rows", () => {
    expect(buildRunRoomFeedRowsForDisplay(createRunView())).toEqual([]);
    expect(buildRunRoomFeedRowsForDisplay(createRunView({
      runRoomFeed: {
        runRoomId: "run-room-empty",
        rows: []
      }
    }))).toEqual([]);
  });
});

function createFeedRow(overrides: Partial<RunRoomFeedRow>): RunRoomFeedRow {
  return {
    id: "feed-row",
    runRoomId: "run-room-1",
    sourceType: "manager",
    displayMode: "formal_message",
    bodyMarkdown: "Message.",
    createdAt: "2026-06-03T00:00:00.000Z",
    ...overrides
  };
}

function createRunView(overrides: Partial<BlueprintRunView> = {}): BlueprintRunView {
  const executionListKey = ["node", "Runs"].join("");
  const runView = {
    run: {
      id: "run-1",
      companyId: "company-1",
      blueprintId: "blueprint-1",
      blueprintName: "Blueprint",
      blueprintVersion: 1,
      status: "running",
      startedBy: "user-1",
      startedAt: "2026-06-03T00:00:00.000Z",
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCostUsd: 0,
      runtimeRefs: []
    },
    [executionListKey]: [],
    events: [],
    finalResult: null,
    ...overrides
  };
  return runView as BlueprintRunView;
}
