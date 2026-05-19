import type {
  AgentSdkProvider,
  AgentTaskResult,
  StartAgentTaskInput,
  StartedAgentTaskResult,
  WaitForAgentTaskInput
} from "@openclaw-cui/shared";
import { resolve } from "node:path";

export interface AgentSdkRuntime {
  startTask(input: StartAgentTaskInput): Promise<StartedAgentTaskResult>;
  waitForTask(input: WaitForAgentTaskInput): Promise<AgentTaskResult>;
  cancelTask(input: WaitForAgentTaskInput): Promise<AgentTaskResult>;
}

export interface AgentSdkTaskRecord {
  taskId: string;
  runId: string;
  provider: AgentSdkProvider;
  nodeRunId: string;
  workflowRunId: string;
  sessionKey: string;
  startedAt: string;
  abortController: AbortController;
  timeout?: ReturnType<typeof setTimeout>;
  final: Promise<AgentTaskResult>;
}

export interface AgentSdkRuntimeOptions {
  defaultTimeoutMs: number;
  maxConcurrency: number;
  workspaceRoot: string;
}

export function isAgentSdkProvider(value: unknown): value is AgentSdkProvider {
  return value === "claude" || value === "codex";
}

export function readAgentSdkRuntimeOptions(workspaceRoot: string, env: NodeJS.ProcessEnv = process.env): AgentSdkRuntimeOptions {
  return {
    defaultTimeoutMs: readPositiveInteger(env.CUI_AGENT_SDK_TASK_TIMEOUT_MS, 600_000),
    maxConcurrency: readPositiveInteger(env.CUI_AGENT_SDK_MAX_CONCURRENCY, 2),
    workspaceRoot: resolve(workspaceRoot)
  };
}

function readPositiveInteger(value: string | undefined, defaultValue: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
}
