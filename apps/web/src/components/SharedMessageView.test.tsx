import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
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

  it("renders RunRoom output projections as display-only messages", () => {
    const message: ModelOutputThreadMessage = {
      id: "run-room-output-node-run-1",
      role: "assistant",
      content: "Worker log line.",
      status: "streaming",
      runtimeStatus: { phase: "command", label: "npm test" },
      createdAt: "2026-06-03T00:00:00.000Z"
    };

    const html = renderToStaticMarkup(<SharedMessageView message={message} speakerLabel="Worker" />);

    expect(html).toContain("Worker log line.");
    expect(html).toContain("npm test");
    expect(html).toContain("Worker");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("Approve");
    expect(html).not.toContain("Reject");
    expect(html).not.toContain("Reply");
  });

  it("hides completed runtime activity from the realtime activity slot", () => {
    const message: ModelOutputThreadMessage = {
      id: "run-room-output-node-run-1",
      role: "assistant",
      content: "Completed answer.",
      status: "sent",
      runtimeStatus: { phase: "tool", label: "repo.search" },
      runtimeActivities: [
        {
          id: "activity-1",
          source: "codex",
          phase: "tool",
          label: "repo.search",
          status: "completed",
          updatedAt: "2026-06-03T00:00:00.000Z"
        }
      ],
      createdAt: "2026-06-03T00:00:00.000Z"
    };

    const html = renderToStaticMarkup(
      <SharedMessageView
        message={message}
        speakerLabel="Worker"
        runtimeActivityLabel="Runtime activity"
      />
    );

    expect(html).toContain("Completed answer.");
    expect(html).not.toContain("repo.search");
    expect(html).not.toContain("Runtime activity");
  });
});
