import { mkdirSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { SDKMessage, Query } from "@anthropic-ai/claude-agent-sdk";
import type { ThreadOptions, TurnOptions, Usage } from "@openai/codex-sdk";
import { ClaudeAgentSdkRuntime, type ClaudeQueryFn } from "./claude-runtime";
import { CodexAgentSdkRuntime, type CodexClientLike, type CodexThreadLike } from "./codex-runtime";
import { mapClaudePermission, mapClaudeTools, mapCodexSandbox } from "./permissions";
import { buildPromptEnvelope } from "./prompt-envelope";
import { AgentSdkTaskRegistry } from "./task-registry";

describe("agent SDK runtime", () => {
  it("builds a stable prompt envelope without secret values", () => {
    const envelope = buildPromptEnvelope({
      blueprintRunId: "run-1",
      nodeRunId: "node-run-1",
      source: "claude",
      agentName: "reviewer",
      prompt: "Review the change.",
      input: {
        z: 1,
        a: {
          token: "secret-token",
          value: "visible"
        }
      },
      tools: []
    });

    expect(envelope).toContain("Blueprint run: run-1");
    expect(envelope).toContain('"a"');
    expect(envelope).toContain('"z"');
    expect(envelope).toContain("<redacted>");
    expect(envelope).not.toContain("secret-token");
    expect(envelope.indexOf('"a"')).toBeLessThan(envelope.indexOf('"z"'));
  });

  it("maps permission profiles to provider SDK settings", () => {
    expect(mapClaudePermission("read_only")).toBe("dontAsk");
    expect(mapClaudeTools("read_only", ["repo.test"])).not.toContain("Bash(npm test:*)");
    expect(mapClaudeTools("workspace_write", ["repo.test"])).toContain("Bash(npm test:*)");
    expect(mapCodexSandbox("read_only")).toBe("read-only");
    expect(mapCodexSandbox("workspace_write")).toBe("workspace-write");
  });

  it("starts Claude through the SDK without a platform auth precheck", async () => {
    const workspace = createWorkspace();
    const runtime = new ClaudeAgentSdkRuntime(
      new AgentSdkTaskRegistry(2),
      { defaultTimeoutMs: 60_000, workspaceRoot: workspace },
      fakeClaudeQuery([
        {
          type: "result",
          subtype: "success",
          duration_ms: 1,
          duration_api_ms: 1,
          is_error: false,
          num_turns: 1,
          result: "ok",
          stop_reason: null,
          total_cost_usd: 0,
          usage: {},
          modelUsage: {},
          permission_denials: [],
          uuid: "uuid-auth-owned-by-sdk",
          session_id: "claude-session-auth-owned-by-sdk"
        } as unknown as SDKMessage
      ])
    );

    const started = await runtime.startTask(createStartInput({ source: "claude", workingDirectory: workspace }));
    const result = await runtime.waitForTask({
      nodeRunId: "node-run-1",
      taskId: started.taskId,
      runId: started.runId,
      sessionKey: started.sessionKey,
      source: "claude"
    });

    expect(started.status).toBe("running");
    expect(started.source).toBe("claude");
    expect(result.status).toBe("succeeded");
  });

  it("fails SDK nodes before provider calls when modelId is missing", async () => {
    const workspace = createWorkspace({ git: true });
    let claudeCalled = false;
    let codexCalled = false;
    const claudeRuntime = new ClaudeAgentSdkRuntime(
      new AgentSdkTaskRegistry(2),
      { defaultTimeoutMs: 60_000, workspaceRoot: workspace },
      () => {
        claudeCalled = true;
        return fakeClaudeQuery([])({ prompt: "" });
      }
    );
    const codexRuntime = new CodexAgentSdkRuntime(
      new AgentSdkTaskRegistry(2),
      { defaultTimeoutMs: 60_000, workspaceRoot: workspace },
      () => {
        codexCalled = true;
        return fakeCodexClient({ threadId: "unused", finalResponse: "unused", usage: null });
      }
    );

    const claudeStarted = await claudeRuntime.startTask(
      createStartInput({ source: "claude", workingDirectory: workspace, modelId: undefined })
    );
    const codexStarted = await codexRuntime.startTask(
      createStartInput({ source: "codex", workingDirectory: workspace, modelId: undefined })
    );

    expect(claudeStarted.status).toBe("failed");
    expect(claudeStarted.error).toContain("model_not_configured");
    expect(codexStarted.status).toBe("failed");
    expect(codexStarted.error).toContain("model_not_configured");
    expect(claudeCalled).toBe(false);
    expect(codexCalled).toBe(false);
  });

  it("normalizes a Claude SDK success result", async () => {
    const workspace = createWorkspace();
    const runtime = new ClaudeAgentSdkRuntime(
      new AgentSdkTaskRegistry(2),
      { defaultTimeoutMs: 60_000, workspaceRoot: workspace },
      fakeClaudeQuery([
        {
          type: "result",
          subtype: "success",
          duration_ms: 1,
          duration_api_ms: 1,
          is_error: false,
          num_turns: 1,
          result: "{\"ok\":true}",
          stop_reason: null,
          total_cost_usd: 0.001234,
          usage: {},
          modelUsage: {
            "claude-test": {
              inputTokens: 10,
              outputTokens: 5,
              cacheReadInputTokens: 2,
              cacheCreationInputTokens: 3,
              webSearchRequests: 0,
              costUSD: 0.001234,
              contextWindow: 200000,
              maxOutputTokens: 4096
            }
          },
          permission_denials: [],
          uuid: "uuid-1",
          session_id: "claude-session-1"
        } as unknown as SDKMessage
      ])
    );

    const started = await runtime.startTask(
      createStartInput({
        source: "claude",
        workingDirectory: workspace,
        outputSchema: { type: "object", required: ["ok"], properties: { ok: { type: "boolean" } } }
      })
    );
    const result = await runtime.waitForTask({
      nodeRunId: "node-run-1",
      taskId: started.taskId,
      runId: started.runId,
      sessionKey: started.sessionKey,
      source: "claude"
    });

    expect(result.status).toBe("succeeded");
    expect(result.source).toBe("claude");
    expect(result.sessionKey).toBe("claude-session-1");
    expect(result.output).toBe("{\"ok\":true}");
    expect(result.usage?.inputTokens).toBe(15);
    expect(result.usage?.outputTokens).toBe(5);
  });

  it("normalizes a Codex SDK success result", async () => {
    const workspace = createWorkspace({ git: true });
    let threadOptions: ThreadOptions | undefined;
    let turnOptions: TurnOptions | undefined;
    const runtime = new CodexAgentSdkRuntime(
      new AgentSdkTaskRegistry(2),
      { defaultTimeoutMs: 60_000, workspaceRoot: workspace },
      () => fakeCodexClient({
        threadId: "codex-thread-1",
        onStartThread: (options) => {
          threadOptions = options;
        },
        onRun: (_prompt, options) => {
          turnOptions = options;
        },
        finalResponse: "{\"ok\":true}",
        usage: {
          input_tokens: 11,
          cached_input_tokens: 7,
          output_tokens: 13,
          reasoning_output_tokens: 17
        }
      })
    );

    const started = await runtime.startTask(
      createStartInput({
        source: "codex",
        permissionProfile: "workspace_write",
        workingDirectory: workspace,
        outputSchema: { type: "object", required: ["ok"], properties: { ok: { type: "boolean" } } }
      })
    );
    const result = await runtime.waitForTask({
      nodeRunId: "node-run-1",
      taskId: started.taskId,
      runId: started.runId,
      sessionKey: started.sessionKey,
      source: "codex"
    });

    expect(threadOptions?.workingDirectory).toBe(workspace);
    expect(threadOptions?.model).toBe("test-model");
    expect(threadOptions?.sandboxMode).toBe("workspace-write");
    expect(threadOptions?.approvalPolicy).toBe("never");
    expect(turnOptions?.outputSchema).toEqual({
      type: "object",
      required: ["ok"],
      additionalProperties: false,
      properties: { ok: { type: "boolean" } }
    });
    expect(result.status).toBe("succeeded");
    expect(result.source).toBe("codex");
    expect(result.sessionKey).toBe("codex-thread-1");
    expect(result.usage?.inputTokens).toBe(18);
    expect(result.usage?.outputTokens).toBe(30);
  });

  it("rejects Codex output that does not match outputSchema", async () => {
    const workspace = createWorkspace({ git: true });
    const runtime = new CodexAgentSdkRuntime(
      new AgentSdkTaskRegistry(2),
      { defaultTimeoutMs: 60_000, workspaceRoot: workspace },
      () => fakeCodexClient({
        threadId: "codex-thread-2",
        finalResponse: "{\"ok\":\"no\"}",
        usage: null
      })
    );

    const started = await runtime.startTask(
      createStartInput({
        source: "codex",
        workingDirectory: workspace,
        outputSchema: { type: "object", required: ["ok"], properties: { ok: { type: "boolean" } } }
      })
    );
    const result = await runtime.waitForTask({
      nodeRunId: "node-run-1",
      taskId: started.taskId,
      runId: started.runId,
      sessionKey: started.sessionKey,
      source: "codex"
    });

    expect(result.status).toBe("failed");
    expect(result.error).toContain("invalid_output");
  });
});

function createStartInput(
  overrides: Partial<Parameters<ClaudeAgentSdkRuntime["startTask"]>[0]> = {}
): Parameters<ClaudeAgentSdkRuntime["startTask"]>[0] {
  return {
    blueprintRunId: "blueprint-run-1",
    nodeRunId: "node-run-1",
    source: "claude",
    agentName: "agent",
    prompt: "Return a result.",
    modelId: "test-model",
    permissionProfile: "read_only",
    workingDirectory: createWorkspace(),
    timeoutMs: 60_000,
    input: { upstream: [] },
    tools: [],
    ...overrides
  };
}

function createWorkspace(options: { git?: boolean } = {}): string {
  const workspace = mkdtempSync(path.join(os.tmpdir(), "hiveward-sdk-"));
  if (options.git) {
    mkdirSync(path.join(workspace, ".git"));
  }
  return workspace;
}

function fakeClaudeQuery(messages: SDKMessage[]): ClaudeQueryFn {
  return () => (async function* () {
    for (const message of messages) {
      yield message;
    }
  })() as unknown as Query;
}

function fakeCodexClient({
  threadId,
  finalResponse,
  usage,
  onStartThread,
  onRun
}: {
  threadId: string;
  finalResponse: string;
  usage: Usage | null;
  onStartThread?: (options?: ThreadOptions) => void;
  onRun?: (prompt: string, options?: TurnOptions) => void;
}): CodexClientLike {
  const thread: CodexThreadLike = {
    id: threadId,
    async run(prompt: string, options?: TurnOptions) {
      onRun?.(prompt, options);
      return {
        finalResponse,
        usage
      };
    }
  };

  return {
    startThread(options?: ThreadOptions) {
      onStartThread?.(options);
      return thread;
    }
  };
}
