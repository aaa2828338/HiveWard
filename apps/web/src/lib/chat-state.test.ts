import { describe, expect, it } from "vitest";
import { shouldRefreshStreamingChatMessages, shouldShowRuntimeStatus, toChatRuntimeStatus } from "./chat-state";

describe("chat state reconciliation", () => {
  it("refreshes when a local streaming assistant has completed on the server", () => {
    expect(
      shouldRefreshStreamingChatMessages({
        localMessages: [
          { id: "local-user", role: "user", status: "sent" },
          { id: "local-assistant", role: "assistant", status: "streaming" }
        ],
        serverMessages: [
          { id: "server-user", role: "user", status: "sent" },
          { id: "server-assistant", role: "assistant", status: "sent" }
        ]
      })
    ).toBe(true);
  });

  it("does not refresh over an active server-side stream", () => {
    expect(
      shouldRefreshStreamingChatMessages({
        localMessages: [
          { id: "local-user", role: "user", status: "sent" },
          { id: "local-assistant", role: "assistant", status: "streaming" }
        ],
        serverMessages: [
          { id: "server-user", role: "user", status: "sent" },
          { id: "server-assistant", role: "assistant", status: "streaming" }
        ]
      })
    ).toBe(false);
  });

  it("shows runtime status while an assistant message is streaming with visible content", () => {
    expect(
      shouldShowRuntimeStatus({
        role: "assistant",
        status: "streaming",
        runtimeStatus: { phase: "command", label: "command_execution" }
      })
    ).toBe(true);
  });

  it("does not show runtime status after the assistant message is sent", () => {
    expect(
      shouldShowRuntimeStatus({
        role: "assistant",
        status: "sent",
        runtimeStatus: { phase: "command", label: "command_execution" }
      })
    ).toBe(false);
  });

  it("maps command runtime events to a simple command status", () => {
    expect(
      toChatRuntimeStatus({
        runtimeState: {
          source: "codex",
          phase: "command",
          label: "command_execution"
        }
      })
    ).toEqual({
      phase: "command",
      label: "command_execution"
    });
  });

  it("maps tool runtime events to a simple tool status", () => {
    expect(
      toChatRuntimeStatus({
        runtimeState: {
          source: "codex",
          phase: "tool",
          label: "mcp_tool_call"
        }
      })
    ).toEqual({
      phase: "tool",
      label: "mcp_tool_call"
    });
  });

  it("maps reasoning runtime events to a simple thinking status", () => {
    expect(
      toChatRuntimeStatus({
        runtimeState: {
          source: "codex",
          phase: "thinking",
          label: "reasoning"
        }
      })
    ).toEqual({
      phase: "thinking",
      label: "reasoning"
    });
  });
});
