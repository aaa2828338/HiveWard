import { describe, expect, it, vi } from "vitest";
import { refreshCompletedStreamSession } from "./chat-controller";

describe("chat controller stream completion", () => {
  it("refreshes the active session list only when the completed stream is still active", async () => {
    const loadChatSessions = vi.fn();
    const loadSessionMessages = vi.fn();

    await refreshCompletedStreamSession({
      sessionId: "session-active",
      getActiveSessionViewId: () => "session-active",
      loadChatSessions,
      loadSessionMessages
    });

    expect(loadChatSessions).toHaveBeenCalledWith("session-active");
    expect(loadSessionMessages).not.toHaveBeenCalled();
  });

  it("keeps a stale completed stream from selecting over the newer active session", async () => {
    const loadChatSessions = vi.fn();
    const loadSessionMessages = vi.fn();

    await refreshCompletedStreamSession({
      sessionId: "session-old",
      getActiveSessionViewId: () => "session-new",
      loadChatSessions,
      loadSessionMessages
    });

    expect(loadChatSessions).not.toHaveBeenCalled();
    expect(loadSessionMessages).toHaveBeenCalledWith("session-old");
  });
});
