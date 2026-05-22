import { describe, expect, it } from "vitest";
import { formatAgentMessage, readAgentTranscriptMessages } from "./gateway-adapter";

describe("gateway adapter transcript extraction", () => {
  it("returns the final visible assistant output instead of an intermediate message", () => {
    const result = readAgentTranscriptMessages([
      { role: "user", content: "Hiveward node run: node-run-1\nDo the work." },
      { role: "assistant", content: "I will check the source material first." },
      { role: "tool", content: [{ type: "tool_result", content: [{ type: "text", text: "{\"raw\":true}" }] }] },
      { role: "assistant", content: "# Final brief\n\nUse this complete result downstream." }
    ], "node-run-1");

    expect(result?.output).toBe("# Final brief\n\nUse this complete result downstream.");
  });

  it("does not use tool output when the assistant has no final text", () => {
    const result = readAgentTranscriptMessages([
      { role: "user", content: "Hiveward node run: node-run-2\nResearch this." },
      { role: "assistant", content: "I will search first." },
      { role: "tool", content: [{ type: "tool_result", content: [{ type: "text", text: "{\"headline\":\"first\"}" }] }] },
      { role: "tool", result: { file: "D:/HiveWard/tmp/page.html", kind: "html" } },
      { role: "assistant", content: "completed" }
    ], "node-run-2");

    expect(result?.output).toBeUndefined();
  });

  it("does not invent a status summary when no visible output exists", () => {
    const result = readAgentTranscriptMessages([
      { role: "user", content: "Hiveward node run: node-run-3\nRun." },
      { role: "assistant", content: "completed" }
    ], "node-run-3");

    expect(result?.output).toBeUndefined();
  });

  it("keeps the assistant output when a later compaction message follows it", () => {
    const result = readAgentTranscriptMessages([
      { role: "user", content: "Hiveward node run: node-run-4\nBuild the page." },
      { role: "assistant", content: "Final page written to workspace." },
      { role: "system", content: "Compaction" }
    ], "node-run-4");

    expect(result?.output).toBe("Final page written to workspace.");
  });

  it("does not treat an unrelated terminal session as the current node output", () => {
    const result = readAgentTranscriptMessages([
      { role: "user", content: "Hiveward node run: node-run-previous\nBuild the page." },
      { role: "assistant", content: "Previous node result." },
      { role: "system", content: "Compaction" }
    ], "node-run-current");

    expect(result).toBeUndefined();
  });

  it("formats upstream output as readable handoff text for the next agent", () => {
    const message = formatAgentMessage({
      blueprintRunId: "run-1",
      nodeRunId: "node-run-2",
      source: "openclaw",
      agentName: "writer",
      prompt: "Write from upstream.",
      input: {
        upstream: [
          {
            nodeId: "brief",
            nodeLabel: "1. News Research",
            nodeRunId: "node-run-1",
            status: "succeeded",
            output: "# Brief\n\nFull upstream content.",
            openclawRef: {
              source: "openclaw",
              sourceId: "task-1",
              sourceUpdatedAt: "2026-05-21T00:00:00.000Z",
              taskId: "task-1",
              runId: "run-oc-1",
              sessionKey: "agent:main:main"
            }
          }
        ]
      },
      tools: []
    });

    expect(message).toContain("上游最终输出（完整原文）");
    expect(message).toContain("### 1. 1. News Research");
    expect(message).toContain("# Brief\n\nFull upstream content.");
    expect(message).toContain("runId=run-oc-1");
    expect(message).not.toContain("\"upstream\"");
  });

  it("omits run markers and input context when no task input is provided", () => {
    const message = formatAgentMessage({
      blueprintRunId: "chat-1",
      nodeRunId: "chat-node-1",
      source: "openclaw",
      agentName: "main",
      prompt: "Current user message:\nhi",
      input: undefined,
      tools: []
    });

    expect(message).toBe("Current user message:\nhi");
    expect(message).not.toContain("Hiveward blueprint run");
    expect(message).not.toContain("Hiveward node run");
    expect(message).not.toContain("\u8f93\u5165\u4e0a\u4e0b\u6587");
    expect(message).not.toContain("\u5176\u4ed6\u4e0a\u4e0b\u6587");
  });
});
