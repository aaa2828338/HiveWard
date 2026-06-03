import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { RunRoomFeedRow } from "@hiveward/shared";
import { SharedMessageView } from "./SharedMessageView";
import type { ModelOutputThreadMessage } from "../lib/model-output-thread";

describe("SharedMessageView", () => {
  it("renders an AgentOutputEvent projection without owning chat actions", () => {
    const message: ModelOutputThreadMessage = {
      id: "message-1",
      sessionId: "session-1",
      role: "assistant",
      content: "Visible assistant answer.",
      status: "streaming",
      runtimeStatus: { phase: "tool", label: "repo.search" },
      runtimeActivities: [
        {
          id: "activity-1",
          source: "codex",
          phase: "tool",
          label: "repo.search",
          status: "started",
          updatedAt: "2026-06-03T00:00:00.000Z"
        }
      ],
      createdAt: "2026-06-03T00:00:00.000Z"
    };

    const html = renderToStaticMarkup(
      <SharedMessageView
        message={message}
        runtimeActivityLabel="Runtime activity"
        pendingLabel="Working"
        failedLabel="Failed"
      />
    );

    expect(html).toContain("Visible assistant answer.");
    expect(html).toContain("repo.search");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("Approve");
    expect(html).not.toContain("Reject");
    expect(html).not.toContain("Reply");
  });

  it("renders worker execution output as display-only even if action flags are present", () => {
    const row: RunRoomFeedRow = {
      id: "feed-row-1",
      runRoomId: "run-room-1",
      sourceType: "worker",
      displayMode: "execution_output",
      bodyMarkdown: "Worker log line.",
      runtimeState: { phase: "command", label: "npm test" },
      actions: {
        canReply: true,
        canApprove: true,
        canReject: true,
        canOpenInbox: true
      },
      createdAt: "2026-06-03T00:00:00.000Z"
    };

    const html = renderToStaticMarkup(<SharedMessageView message={row} speakerLabel="Worker" />);

    expect(html).toContain("Worker log line.");
    expect(html).toContain("Worker");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("Approve");
    expect(html).not.toContain("Reject");
    expect(html).not.toContain("Reply");
  });
});
