import { nanoid } from "nanoid";
import type {
  OpenClawAgent,
  OpenClawChannel,
  OpenClawModel,
  OpenClawSessionSummary,
  OpenClawTaskSummary,
  OpenClawTool,
  RuntimeOverview,
  SendChannelInput,
  SendChannelResult,
  AgentTaskResult,
  StartAgentTaskInput,
  StartedAgentTaskResult,
  WaitForAgentTaskInput
} from "@hiveward/shared";
import { GatewayOpenClawAdapter } from "./gateway-adapter";
import { resolveGatewayAdapterConfig } from "./gateway-config";
import { createAgentSdkRuntime, isAgentSdkProvider, readAgentSdkRuntimeOptions, type AgentSdkRuntime } from "./sdk-runtime";

export interface OpenClawAdapter {
  listModels(): Promise<OpenClawModel[]>;
  listAgents(): Promise<OpenClawAgent[]>;
  listTools(): Promise<OpenClawTool[]>;
  listChannels(): Promise<OpenClawChannel[]>;
  listSessions(): Promise<OpenClawSessionSummary[]>;
  listTasks(): Promise<OpenClawTaskSummary[]>;
  getRuntimeOverview(): Promise<RuntimeOverview>;
  startAgentTask(input: StartAgentTaskInput): Promise<StartedAgentTaskResult>;
  waitForAgentTask(input: WaitForAgentTaskInput): Promise<AgentTaskResult>;
  sendChannelMessage(input: SendChannelInput): Promise<SendChannelResult>;
}

export class MockOpenClawAdapter implements OpenClawAdapter {
  private readonly agentResults = new Map<string, AgentTaskResult>();

  async listModels(): Promise<OpenClawModel[]> {
    return [
      {
        id: "gpt-5.4",
        label: "GPT-5.4",
        provider: "OpenAI",
        supportsTools: true,
        contextWindow: 256000
      },
      {
        id: "gpt-5.3-codex-spark",
        label: "GPT-5.3 Codex Spark",
        provider: "OpenAI",
        supportsTools: true,
        contextWindow: 128000
      },
      {
        id: "local-reviewer",
        label: "Local Reviewer",
        provider: "OpenClaw Local",
        supportsTools: false,
        contextWindow: 64000
      }
    ];
  }

  async listAgents(): Promise<OpenClawAgent[]> {
    return [
      {
        id: "main",
        label: "main",
        runtimeId: "mock",
        modelId: "gpt-5.4"
      }
    ];
  }

  async listTools(): Promise<OpenClawTool[]> {
    return [
      {
        id: "repo.search",
        label: "Repo Search",
        description: "Search files, symbols, and references in the connected workspace.",
        category: "code"
      },
      {
        id: "repo.test",
        label: "Repo Test",
        description: "Run scoped verification commands through OpenClaw runtime.",
        category: "verification"
      },
      {
        id: "channel.send",
        label: "Channel Send",
        description: "Send delivery messages through configured OpenClaw channels.",
        category: "communication"
      }
    ];
  }

  async listChannels(): Promise<OpenClawChannel[]> {
    return [
      { id: "slack", label: "Slack", status: "available" },
      { id: "discord", label: "Discord", status: "not_configured" },
      { id: "telegram", label: "Telegram", status: "disabled" }
    ];
  }

  async listSessions(): Promise<OpenClawSessionSummary[]> {
    const now = new Date().toISOString();
    return [
      { id: "session-demo-1", title: "Delivery planning console", updatedAt: now },
      { id: "session-demo-2", title: "Usage investigation", updatedAt: now }
    ];
  }

  async listTasks(): Promise<OpenClawTaskSummary[]> {
    const now = new Date().toISOString();
    return [
      { id: "task-demo-1", title: "Requirements Agent", status: "succeeded", updatedAt: now },
      { id: "task-demo-2", title: "Architecture Agent", status: "running", updatedAt: now }
    ];
  }

  async getRuntimeOverview(): Promise<RuntimeOverview> {
    const [sessions, tasks] = await Promise.all([this.listSessions(), this.listTasks()]);
    return { sessions, tasks };
  }

  async startAgentTask(input: StartAgentTaskInput): Promise<StartedAgentTaskResult> {
    const now = new Date().toISOString();
    const taskId = `oc-task-${nanoid(8)}`;
    const runId = `oc-run-${nanoid(8)}`;
    const inputSize = JSON.stringify(input.input ?? {}).length;
    const outputTokens = Math.max(80, Math.round((input.prompt.length + inputSize) / 3));
    const inputTokens = Math.max(60, Math.round(input.prompt.length / 2));

    this.agentResults.set(taskId, {
      taskId,
      runId,
      sessionKey: `oc-session-${input.missionRunId}`,
      source: "openclaw",
      status: "succeeded",
      output: `${input.agentName} completed through OpenClaw adapter. Prompt boundary stayed outside Hiveward runtime.`,
      error: undefined,
      usage: {
        id: `usage-${nanoid(8)}`,
        modelId: input.modelId ?? "gpt-5.4",
        inputTokens,
        outputTokens,
        costUsd: Number(((inputTokens + outputTokens) * 0.000002).toFixed(6)),
        recordedAt: now
      },
      updatedAt: now
    });

    return {
      taskId,
      runId,
      sessionKey: `oc-session-${input.missionRunId}`,
      source: "openclaw",
      status: "running",
      updatedAt: now
    };
  }

  async waitForAgentTask(input: WaitForAgentTaskInput): Promise<AgentTaskResult> {
    const result = this.agentResults.get(input.taskId);
    if (!result) {
      throw new Error(`Mock OpenClaw task not found: ${input.taskId}`);
    }
    return result;
  }

  async sendChannelMessage(input: SendChannelInput): Promise<SendChannelResult> {
    return {
      deliveryId: `delivery-${input.channelId}-${nanoid(8)}`,
      status: "sent",
      updatedAt: new Date().toISOString()
    };
  }
}

export interface CreateOpenClawAdapterOptions {
  sdkWorkspaceRoot: string;
}

export class SdkRoutingOpenClawAdapter implements OpenClawAdapter {
  constructor(
    private readonly baseAdapter: OpenClawAdapter,
    private readonly sdkRuntime: AgentSdkRuntime
  ) {}

  listModels(): Promise<OpenClawModel[]> {
    return this.baseAdapter.listModels();
  }

  listAgents(): Promise<OpenClawAgent[]> {
    return this.baseAdapter.listAgents();
  }

  listTools(): Promise<OpenClawTool[]> {
    return this.baseAdapter.listTools();
  }

  listChannels(): Promise<OpenClawChannel[]> {
    return this.baseAdapter.listChannels();
  }

  listSessions(): Promise<OpenClawSessionSummary[]> {
    return this.baseAdapter.listSessions();
  }

  listTasks(): Promise<OpenClawTaskSummary[]> {
    return this.baseAdapter.listTasks();
  }

  getRuntimeOverview(): Promise<RuntimeOverview> {
    return this.baseAdapter.getRuntimeOverview();
  }

  startAgentTask(input: StartAgentTaskInput): Promise<StartedAgentTaskResult> {
    return isAgentSdkProvider(input.source) ? this.sdkRuntime.startTask(input) : this.baseAdapter.startAgentTask(input);
  }

  waitForAgentTask(input: WaitForAgentTaskInput): Promise<AgentTaskResult> {
    return input.source === "claude" || input.source === "codex"
      ? this.sdkRuntime.waitForTask(input)
      : this.baseAdapter.waitForAgentTask(input);
  }

  sendChannelMessage(input: SendChannelInput): Promise<SendChannelResult> {
    return this.baseAdapter.sendChannelMessage(input);
  }
}

export function createOpenClawAdapter(options: CreateOpenClawAdapterOptions): OpenClawAdapter {
  const mode = (process.env.OPENCLAW_ADAPTER ?? "auto").trim().toLowerCase();
  const sdkRuntime = createAgentSdkRuntime(readAgentSdkRuntimeOptions(options.sdkWorkspaceRoot));
  if (mode === "mock") {
    return new SdkRoutingOpenClawAdapter(new MockOpenClawAdapter(), sdkRuntime);
  }

  const gatewayConfig = resolveGatewayAdapterConfig();
  if (gatewayConfig) {
    return new SdkRoutingOpenClawAdapter(new GatewayOpenClawAdapter(gatewayConfig), sdkRuntime);
  }

  if (mode === "real" || mode === "gateway") {
    throw new Error(
      "OpenClaw Gateway configuration was not found. Set OPENCLAW_GATEWAY_URL or provide ~/.openclaw/openclaw.json."
    );
  }

  return new SdkRoutingOpenClawAdapter(new MockOpenClawAdapter(), sdkRuntime);
}

export { GatewayOpenClawAdapter } from "./gateway-adapter";
export { GatewayRequestError, GatewaySession } from "./gateway-client";
export { resolveGatewayAdapterConfig, type GatewayAdapterConfig } from "./gateway-config";
export { createAgentSdkRuntime, isAgentSdkProvider } from "./sdk-runtime";
