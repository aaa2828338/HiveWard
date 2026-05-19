import { nanoid } from "nanoid";
import { Codex, type ThreadOptions, type TurnOptions, type Usage } from "@openai/codex-sdk";
import type {
  AgentTaskResult,
  OpenClawUsageFact,
  StartAgentTaskInput,
  StartedAgentTaskResult,
  WaitForAgentTaskInput
} from "@openclaw-cui/shared";
import { formatAgentSdkError, formatAgentSdkProviderError, getErrorMessage, isAbortLikeError } from "./errors";
import { mapCodexSandbox, normalizePermissionProfile } from "./permissions";
import { buildPromptEnvelope, toCodexOutputSchema, validateOutputSchema } from "./prompt-envelope";
import { createTerminalTaskResult, AgentSdkTaskRegistry } from "./task-registry";
import type { AgentSdkRuntime } from "./types";
import { assertGitWorkspace, resolveSdkWorkingDirectory } from "./workspace";

export interface CodexThreadLike {
  readonly id: string | null;
  run(input: string, turnOptions?: TurnOptions): Promise<{ finalResponse: string; usage: Usage | null }>;
}

export interface CodexClientLike {
  startThread(options?: ThreadOptions): CodexThreadLike;
}

export type CreateCodexClient = () => CodexClientLike;

export class CodexAgentSdkRuntime implements AgentSdkRuntime {
  private readonly createCodexClient: CreateCodexClient;

  constructor(
    private readonly registry: AgentSdkTaskRegistry,
    private readonly options: { defaultTimeoutMs: number; workspaceRoot: string },
    createCodexClient?: CreateCodexClient,
    private readonly env: NodeJS.ProcessEnv = process.env
  ) {
    this.createCodexClient = createCodexClient ?? (() => new Codex({ apiKey: this.env.CODEX_API_KEY }));
  }

  async startTask(input: StartAgentTaskInput): Promise<StartedAgentTaskResult> {
    const now = new Date().toISOString();
    const taskId = `codex-task-${nanoid(10)}`;
    const runId = `codex-run-${nanoid(10)}`;
    const sessionKey = `codex-session-${input.nodeRunId}`;

    let workingDirectory: string;
    try {
      requireConfiguredModel(input.modelId);
      workingDirectory = resolveSdkWorkingDirectory(input.workingDirectory, this.options.workspaceRoot);
      assertGitWorkspace(workingDirectory, this.options.workspaceRoot);
    } catch (error) {
      return this.failedStart(taskId, runId, sessionKey, getErrorMessage(error), now);
    }

    const timeoutMs = normalizeTimeout(input.timeoutMs, this.options.defaultTimeoutMs);
    const abortController = new AbortController();
    let timedOut = false;
    const final = this.registry.runWithConcurrency(() =>
      this.runCodexTask({
        input,
        taskId,
        runId,
        initialSessionKey: sessionKey,
        workingDirectory,
        abortController,
        isTimedOut: () => timedOut
      })
    );
    const timeout = setTimeout(() => {
      timedOut = true;
      abortController.abort("timeout");
    }, timeoutMs);

    this.registry.register({
      taskId,
      runId,
      provider: "codex",
      nodeRunId: input.nodeRunId,
      workflowRunId: input.workflowRunId,
      sessionKey,
      startedAt: now,
      abortController,
      timeout,
      final
    });

    return {
      taskId,
      runId,
      sessionKey,
      source: "codex",
      status: "running",
      updatedAt: now
    };
  }

  waitForTask(input: WaitForAgentTaskInput): Promise<AgentTaskResult> {
    return this.registry.waitForTask(input);
  }

  cancelTask(input: WaitForAgentTaskInput): Promise<AgentTaskResult> {
    return this.registry.cancelTask(input);
  }

  private async runCodexTask({
    input,
    taskId,
    runId,
    initialSessionKey,
    workingDirectory,
    abortController,
    isTimedOut
  }: {
    input: StartAgentTaskInput;
    taskId: string;
    runId: string;
    initialSessionKey: string;
    workingDirectory: string;
    abortController: AbortController;
    isTimedOut: () => boolean;
  }): Promise<AgentTaskResult> {
    const permissionProfile = normalizePermissionProfile(input.permissionProfile);
    let sessionKey = initialSessionKey;

    try {
      if (abortController.signal.aborted) {
        return this.cancelledResult(taskId, runId, sessionKey, isTimedOut());
      }

      const outputSchema = toCodexOutputSchema(input.outputSchema);
      const codex = this.createCodexClient();
      const thread = codex.startThread({
        model: input.modelId,
        workingDirectory,
        sandboxMode: mapCodexSandbox(permissionProfile),
        approvalPolicy: "never",
        networkAccessEnabled: false,
        webSearchMode: "disabled"
      });
      const turn = await thread.run(buildPromptEnvelope({ ...input, outputSchema }), {
        outputSchema,
        signal: abortController.signal
      });
      sessionKey = thread.id ?? sessionKey;

      if (!validateOutputSchema(turn.finalResponse, input.outputSchema)) {
        return createTerminalTaskResult({
          taskId,
          runId,
          sessionKey,
          source: "codex",
          status: "failed",
          error: formatAgentSdkError("invalid_output", "SDK output does not match outputSchema."),
          usage: mapCodexUsage(input, turn.usage)
        });
      }

      return {
        taskId,
        runId,
        sessionKey,
        source: "codex",
        status: "succeeded",
        output: turn.finalResponse,
        usage: mapCodexUsage(input, turn.usage),
        updatedAt: new Date().toISOString()
      };
    } catch (error) {
      if (isAbortLikeError(error) || abortController.signal.aborted) {
        return this.cancelledResult(taskId, runId, sessionKey, isTimedOut());
      }
      return createTerminalTaskResult({
        taskId,
        runId,
        sessionKey,
        source: "codex",
        status: "failed",
        error: formatAgentSdkProviderError("Codex", error)
      });
    }
  }

  private failedStart(taskId: string, runId: string, sessionKey: string, error: string, updatedAt: string): StartedAgentTaskResult {
    return {
      taskId,
      runId,
      sessionKey,
      source: "codex",
      status: "failed",
      error,
      updatedAt
    };
  }

  private cancelledResult(taskId: string, runId: string, sessionKey: string, timedOut: boolean): AgentTaskResult {
    return createTerminalTaskResult({
      taskId,
      runId,
      sessionKey,
      source: "codex",
      status: "cancelled",
      error: timedOut ? formatAgentSdkError("timeout", "Task exceeded timeoutMs.") : formatAgentSdkError("cancelled", "Task was cancelled.")
    });
  }
}

function requireConfiguredModel(modelId: string | undefined): void {
  if (!modelId?.trim()) {
    throw new Error(formatAgentSdkError("model_not_configured", "Codex agent node requires an explicit modelId."));
  }
}

function mapCodexUsage(input: StartAgentTaskInput, usage: Usage | null): OpenClawUsageFact {
  return {
    id: `usage-${nanoid(10)}`,
    modelId: input.modelId ?? "codex",
    inputTokens: usage ? usage.input_tokens + usage.cached_input_tokens : 0,
    outputTokens: usage ? usage.output_tokens + usage.reasoning_output_tokens : 0,
    costUsd: 0,
    recordedAt: new Date().toISOString()
  };
}

function normalizeTimeout(value: number | undefined, defaultValue: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : defaultValue;
}
