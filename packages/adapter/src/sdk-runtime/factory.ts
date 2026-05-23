import type {
  AgentTaskResult,
  ChatStreamEvent,
  StartAgentTaskInput,
  StartedAgentTaskResult,
  WaitForAgentTaskInput
} from "@hiveward/shared";
import { ClaudeAgentSdkRuntime } from "./claude-runtime";
import { CodexAgentSdkRuntime } from "./codex-runtime";
import { AgentSdkTaskRegistry } from "./task-registry";
import type { AgentSdkChatStreamInput, AgentSdkRuntime, AgentSdkRuntimeOptions } from "./types";
import { isAgentSdkProvider } from "./types";

export class AgentSdkRuntimeRouter implements AgentSdkRuntime {
  constructor(private readonly runtimes: Record<"claude" | "codex", AgentSdkRuntime>) {}

  streamChatMessage(input: AgentSdkChatStreamInput, onEvent: (event: ChatStreamEvent) => void): Promise<void> {
    return this.runtimes[input.source].streamChatMessage(input, onEvent);
  }

  startTask(input: StartAgentTaskInput): Promise<StartedAgentTaskResult> {
    if (!isAgentSdkProvider(input.source)) {
      throw new Error("SDK runtime requires claude or codex source.");
    }
    return this.runtimes[input.source].startTask(input);
  }

  waitForTask(input: WaitForAgentTaskInput): Promise<AgentTaskResult> {
    if (input.source === "claude") {
      return this.runtimes.claude.waitForTask(input);
    }
    if (input.source === "codex") {
      return this.runtimes.codex.waitForTask(input);
    }
    throw new Error(`Unknown SDK task source: ${input.source}`);
  }

  cancelTask(input: WaitForAgentTaskInput): Promise<AgentTaskResult> {
    if (input.source === "claude") {
      return this.runtimes.claude.cancelTask(input);
    }
    if (input.source === "codex") {
      return this.runtimes.codex.cancelTask(input);
    }
    throw new Error(`Unknown SDK task source: ${input.source}`);
  }
}

export function createAgentSdkRuntime(
  options: AgentSdkRuntimeOptions,
  env: NodeJS.ProcessEnv = process.env
): AgentSdkRuntime {
  const registry = new AgentSdkTaskRegistry(options.maxConcurrency);
  return new AgentSdkRuntimeRouter({
    claude: new ClaudeAgentSdkRuntime(registry, options),
    codex: new CodexAgentSdkRuntime(registry, options, undefined, env)
  });
}
