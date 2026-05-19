import type {
  OpenClawAgent,
  OpenClawChannel,
  OpenClawModel,
  OpenClawSessionSummary,
  OpenClawTaskSummary,
  OpenClawTool,
  OpenClawUsageFact,
  RuntimeOverview,
  SendChannelInput,
  SendChannelResult,
  AgentTaskResult,
  StartAgentTaskInput,
  StartedAgentTaskResult,
  WaitForAgentTaskInput,
} from "@openclaw-cui/shared";
import type { OpenClawAdapter } from "./index";
import type { GatewayAdapterConfig } from "./gateway-config";
import { GatewaySession } from "./gateway-client";
import { createGatewayId } from "./gateway-device";

export class GatewayOpenClawAdapter implements OpenClawAdapter {
  private sharedSession: GatewaySession | undefined;
  private sharedSessionPromise: Promise<GatewaySession> | undefined;
  private readonly inflightAgentTasks = new Map<string, Promise<Record<string, unknown>>>();

  constructor(private readonly config: GatewayAdapterConfig) {}

  async listModels(): Promise<OpenClawModel[]> {
    return this.withSession(async (session) => {
      const result = await session.request<{ models?: unknown[] }>("models.list", {});
      return (Array.isArray(result.models) ? result.models : []).map(mapModel).filter(isPresent);
    });
  }

  async listAgents(): Promise<OpenClawAgent[]> {
    return this.withSession(async (session) => {
      const result = await session.request<{ agents?: unknown[]; defaultId?: unknown }>("agents.list", {});
      return (Array.isArray(result.agents) ? result.agents : []).map((agent) => mapAgent(agent, result.defaultId)).filter(isPresent);
    });
  }

  async listTools(): Promise<OpenClawTool[]> {
    return this.withSession(async (session) => {
      const result = await session.request<{ groups?: unknown[] }>("tools.catalog", {});
      return (Array.isArray(result.groups) ? result.groups : []).flatMap((group) => mapToolGroup(group));
    });
  }

  async listChannels(): Promise<OpenClawChannel[]> {
    return this.withSession(async (session) => {
      const result = await session.request<Record<string, unknown>>("channels.status", {});
      const meta = Array.isArray(result.channelMeta) ? result.channelMeta : [];
      const order = Array.isArray(result.channelOrder) ? result.channelOrder : [];
      const labels = isRecord(result.channelLabels) ? result.channelLabels : {};
      const fromMeta = meta.map(mapChannelMeta).filter(isPresent);
      if (fromMeta.length > 0) return fromMeta;
      return order
        .filter((id): id is string => typeof id === "string")
        .map((id) => ({
          id,
          label: typeof labels[id] === "string" ? labels[id] : id,
          status: "available" as const,
        }));
    });
  }

  async listSessions(): Promise<OpenClawSessionSummary[]> {
    const sessions = await this.listSessionRecords();
    return sessions.map(mapSession).filter(isPresent);
  }

  async listTasks(): Promise<OpenClawTaskSummary[]> {
    const sessions = await this.listSessionRecords();
    return sessions.map(mapSessionTask).filter(isPresent);
  }

  async getRuntimeOverview(): Promise<RuntimeOverview> {
    const sessions = await this.listSessionRecords();
    return {
      sessions: sessions.map(mapSession).filter(isPresent),
      tasks: sessions.map(mapSessionTask).filter(isPresent),
    };
  }

  private async listSessionRecords(): Promise<unknown[]> {
    return this.withSession(async (session) => {
      const result = await session.request<{ sessions?: unknown[] }>("sessions.list", {
        limit: 20,
        includeGlobal: true,
        includeUnknown: true,
      });
      return Array.isArray(result.sessions) ? result.sessions : [];
    });
  }

  async startAgentTask(input: StartAgentTaskInput): Promise<StartedAgentTaskResult> {
    const session = await this.getSession();
    try {
      const idempotencyKey = createGatewayId(input.nodeRunId);
      const modelRef = await this.resolveModelRef(session, input.modelId);
      const lifecycle = session.requestLifecycle<Record<string, unknown>>(
        "agent",
        {
          message: formatAgentMessage(input),
          agentId: input.agentId ?? "main",
          provider: modelRef?.provider,
          model: modelRef?.model,
          deliver: false,
          bestEffortDeliver: true,
          label: input.agentName,
          idempotencyKey,
        },
        { acceptedTimeoutMs: this.config.agentStartTimeoutMs, finalTimeoutMs: null },
      );
      const accepted = await lifecycle.accepted;
      const runId = readString(accepted.runId) ?? idempotencyKey;
      const sessionKey = readString(accepted.sessionKey) ?? buildAgentMainSessionKey(input.agentId);
      const taskId = runId;
      const status = mapAcceptedExecutionStatus(readString(accepted.status));

      this.inflightAgentTasks.set(taskId, lifecycle.final.finally(() => {
        this.inflightAgentTasks.delete(taskId);
      }));

      return {
        taskId,
        runId,
        sessionKey,
        source: "openclaw",
        status,
        error: status === "failed" ? summarizeAgentResult(accepted) : undefined,
        updatedAt: new Date().toISOString(),
      };
    } catch (error) {
      if (isRecoverableGatewaySessionError(error)) {
        this.resetSharedSession(session);
      }
      throw error;
    }
  }

  async waitForAgentTask(input: WaitForAgentTaskInput): Promise<AgentTaskResult> {
    const finalResult = this.inflightAgentTasks.get(input.taskId);
    if (!finalResult) {
      throw new Error(`OpenClaw agent task tracker not found for ${input.taskId}.`);
    }

    const result = await finalResult;
    const session = await this.getSession();
    const runId = readString(result.runId) ?? input.runId;
    const sessionKey = readString(result.sessionKey) ?? input.sessionKey;
    const ok = readString(result.status) !== "error";
    const fallbackModelId = readModelId(result) ?? input.modelId;
    const transcriptResult = ok ? await readAgentTranscriptResult(session, sessionKey, input.nodeRunId, fallbackModelId) : undefined;
    const transcriptError = transcriptResult?.error;
    const status = ok && !transcriptError ? "succeeded" : "failed";
    const usage = readUsageFact(result, fallbackModelId, runId) ?? transcriptResult?.usage;

    return {
      taskId: input.taskId,
      runId,
      sessionKey,
      source: "openclaw",
      status,
      output: status === "succeeded" ? transcriptResult?.output ?? summarizeAgentResult(result) : undefined,
      error: transcriptError ?? (ok ? undefined : summarizeAgentResult(result)),
      usage,
      updatedAt: new Date().toISOString(),
    };
  }

  async sendChannelMessage(input: SendChannelInput): Promise<SendChannelResult> {
    return this.withSession(async (session) => {
      const result = await session.request<Record<string, unknown>>("send", {
        channel: input.channelId,
        to: input.target,
        message: input.body,
        idempotencyKey: createGatewayId(input.nodeRunId),
      });
      return {
        deliveryId: readString(result.id) ?? readString(result.messageId) ?? createGatewayId("delivery"),
        status: "sent",
        updatedAt: new Date().toISOString(),
      };
    });
  }

  private async withSession<T>(operation: (session: GatewaySession) => Promise<T>): Promise<T> {
    const session = await this.getSession();
    try {
      return await operation(session);
    } catch (error) {
      if (isRecoverableGatewaySessionError(error)) {
        this.resetSharedSession(session);
      }
      throw error;
    }
  }

  private async getSession(): Promise<GatewaySession> {
    if (this.sharedSession) {
      return this.sharedSession;
    }
    if (this.sharedSessionPromise) {
      return this.sharedSessionPromise;
    }

    const session = new GatewaySession(this.config);
    const promise = session.connect().then(() => {
      this.sharedSession = session;
      return session;
    }).catch((error) => {
      session.close();
      throw error;
    }).finally(() => {
      this.sharedSessionPromise = undefined;
    });

    this.sharedSessionPromise = promise;
    return promise;
  }

  private resetSharedSession(session?: GatewaySession): void {
    if (session && this.sharedSession && session !== this.sharedSession) {
      return;
    }
    this.sharedSession?.close();
    this.sharedSession = undefined;
    this.sharedSessionPromise = undefined;
  }

  private async resolveModelRef(
    session: GatewaySession,
    modelId: string | undefined,
  ): Promise<{ provider: string; model: string } | undefined> {
    if (!modelId) return undefined;
    if (modelId.includes("/")) {
      const [provider, model] = modelId.split("/", 2);
      return provider && model ? { provider, model } : undefined;
    }
    const result = await session.request<{ models?: unknown[] }>("models.list", {});
    const model = (Array.isArray(result.models) ? result.models : []).find((item) => {
      if (!isRecord(item)) return false;
      return item.id === modelId || `${item.provider}/${item.id}` === modelId;
    });
    if (!isRecord(model)) return undefined;
    const provider = readString(model.provider);
    const id = readString(model.id);
    return provider && id ? { provider, model: id } : undefined;
  }
}

function formatAgentMessage(input: StartAgentTaskInput): string {
  return [
    `CUI workflow run: ${input.workflowRunId}`,
    `CUI node run: ${input.nodeRunId}`,
    "",
    input.prompt,
    "",
    "Input:",
    JSON.stringify(input.input ?? {}, null, 2),
  ].join("\n");
}

function mapModel(value: unknown): OpenClawModel | undefined {
  if (!isRecord(value)) return undefined;
  const id = readString(value.id);
  const provider = readString(value.provider);
  if (!id || !provider) return undefined;
  return {
    id: `${provider}/${id}`,
    label: readString(value.name) ?? readString(value.alias) ?? id,
    provider,
    supportsTools: true,
    contextWindow: readNumber(value.contextWindow),
  };
}

function mapAgent(value: unknown, defaultId: unknown): OpenClawAgent | undefined {
  if (!isRecord(value)) return undefined;
  const id = readString(value.id);
  if (!id) return undefined;
  const defaultAgentId = readString(defaultId);
  const runtime = isRecord(value.agentRuntime) ? value.agentRuntime : undefined;
  const model = isRecord(value.model) ? value.model : undefined;
  const modelId = readString(model?.primary);
  return {
    id,
    label: id === defaultAgentId ? `${id} (default)` : id,
    workspace: readString(value.workspace),
    runtimeId: readString(runtime?.id),
    modelId,
  };
}

function mapToolGroup(value: unknown): OpenClawTool[] {
  if (!isRecord(value)) return [];
  const category = readString(value.label) ?? readString(value.id) ?? "tools";
  const tools = Array.isArray(value.tools) ? value.tools : [];
  return tools.map((tool) => mapTool(tool, category)).filter(isPresent);
}

function mapTool(value: unknown, category: string): OpenClawTool | undefined {
  if (!isRecord(value)) return undefined;
  const id = readString(value.id);
  if (!id) return undefined;
  return {
    id,
    label: readString(value.label) ?? id,
    description: readString(value.description) ?? "",
    category,
  };
}

function mapChannelMeta(value: unknown): OpenClawChannel | undefined {
  if (!isRecord(value)) return undefined;
  const id = readString(value.id);
  if (!id) return undefined;
  return {
    id,
    label: readString(value.label) ?? id,
    status: "available",
  };
}

function mapSession(value: unknown): OpenClawSessionSummary | undefined {
  if (!isRecord(value)) return undefined;
  const id = readString(value.key) ?? readString(value.sessionId);
  if (!id) return undefined;
  return {
    id,
    title: readString(value.displayName) ?? readString(value.label) ?? id,
    updatedAt: dateFromMs(value.updatedAt),
  };
}

function mapSessionTask(value: unknown): OpenClawTaskSummary | undefined {
  if (!isRecord(value)) return undefined;
  const id = readString(value.key) ?? readString(value.sessionId);
  if (!id) return undefined;
  return {
    id,
    title: readString(value.displayName) ?? readString(value.label) ?? id,
    status: mapExecutionStatus(readString(value.status)),
    updatedAt: dateFromMs(value.updatedAt),
  };
}

function summarizeAgentResult(result: Record<string, unknown>): string {
  const status = readString(result.status) ?? "ok";
  const summary = readString(result.summary);
  const inner = isRecord(result.result) ? result.result : undefined;
  const text = readString(inner?.text) ?? readString(inner?.message) ?? readString(result.text);
  const richOutput = [summary, text].filter(Boolean).join("\n\n");
  if (richOutput && richOutput !== "completed") return richOutput;
  const runId = readString(result.runId);
  return [`OpenClaw agent run ${status}.`, runId ? `runId: ${runId}` : undefined].filter(Boolean).join("\n");
}

async function readAgentTranscriptResult(
  session: GatewaySession,
  sessionKey: string,
  nodeRunId: string,
  fallbackModelId?: string,
): Promise<{ output?: string; error?: string; usage?: OpenClawUsageFact } | undefined> {
  try {
    const history = await session.request<{ messages?: unknown[] }>("chat.history", {
      sessionKey,
      limit: 50,
      maxChars: 24_000,
    });
    const messages = Array.isArray(history.messages) ? history.messages : [];
    const userIndex = findLastMessageIndex(messages, (message) => {
      if (!isRecord(message)) return false;
      const role = readString(message.role);
      return role === "user" && extractMessageText(message).includes(`CUI node run: ${nodeRunId}`);
    });
    if (userIndex < 0) return undefined;

    for (const message of messages.slice(userIndex + 1)) {
      if (!isRecord(message) || readString(message.role) !== "assistant") continue;
      const usage = readUsageFact(message, fallbackModelId);
      const errorMessage = readString(message.errorMessage);
      if (errorMessage) return { error: errorMessage, usage };
      const text = extractMessageText(message).trim();
      if (text && text !== "completed") return { output: text, usage };
      if (readString(message.stopReason) === "error") {
        return { error: "OpenClaw assistant stopped with an error before returning visible output.", usage };
      }
      if (usage) return { usage };
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function findLastMessageIndex<T>(items: T[], predicate: (item: T) => boolean): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (predicate(items[index]!)) return index;
  }
  return -1;
}

function extractMessageText(value: unknown): string {
  if (!isRecord(value)) return "";
  if (typeof value.text === "string") return value.text;
  if (typeof value.content === "string") return value.content;
  if (!Array.isArray(value.content)) return "";
  return value.content
    .map((block) => {
      if (!isRecord(block)) return "";
      return readString(block.text) ?? readString(block.content) ?? "";
    })
    .filter(Boolean)
    .join("\n");
}

function readUsageFact(value: unknown, fallbackModelId?: string, fallbackId?: string): OpenClawUsageFact | undefined {
  const candidate = findUsageRecord(value);
  if (!candidate) return undefined;

  const baseInputTokens =
    readNumberFromRecord(candidate, ["inputTokens", "input_tokens", "promptTokens", "prompt_tokens", "tokensIn", "tokens_in"]) ?? 0;
  const cachedInputTokens =
    readNumberFromRecord(candidate, [
      "cachedInputTokens",
      "cached_input_tokens",
      "cacheReadInputTokens",
      "cache_read_input_tokens",
      "cacheCreationInputTokens",
      "cache_creation_input_tokens",
    ]) ?? 0;
  const inputTokens = baseInputTokens + cachedInputTokens;
  const outputTokens =
    readNumberFromRecord(candidate, ["outputTokens", "output_tokens", "completionTokens", "completion_tokens", "tokensOut", "tokens_out"]) ?? 0;
  const totalTokens = readNumberFromRecord(candidate, ["totalTokens", "total_tokens", "tokens", "tokenCount", "token_count"]);
  const normalizedOutputTokens = outputTokens || Math.max(0, (totalTokens ?? 0) - inputTokens);
  const modelId = readModelId(candidate) ?? readModelId(value) ?? fallbackModelId;

  if (!modelId || inputTokens + normalizedOutputTokens <= 0) return undefined;

  return {
    id: readString(candidate.id) ?? readString(candidate.usageId) ?? (fallbackId ? `usage-${fallbackId}` : createGatewayId("usage")),
    modelId,
    inputTokens,
    outputTokens: normalizedOutputTokens,
    costUsd: readNumberFromRecord(candidate, ["costUsd", "cost_usd", "costUSD", "usd", "cost", "totalCostUsd", "total_cost_usd"]) ?? 0,
    recordedAt: readUsageRecordedAt(candidate) ?? new Date().toISOString(),
  };
}

function findUsageRecord(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;

  for (const key of ["usage", "tokenUsage", "usageMetadata", "usageStats", "metrics"]) {
    const candidate = value[key];
    if (looksLikeUsageRecord(candidate)) return candidate;
  }

  for (const key of ["result", "response", "message", "assistant", "metadata", "metrics"]) {
    const nested = findUsageRecord(value[key]);
    if (nested) return nested;
  }

  return looksLikeUsageRecord(value) ? value : undefined;
}

function looksLikeUsageRecord(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  return (
    readNumberFromRecord(value, [
      "inputTokens",
      "input_tokens",
      "promptTokens",
      "prompt_tokens",
      "outputTokens",
      "output_tokens",
      "completionTokens",
      "completion_tokens",
      "totalTokens",
      "total_tokens",
      "tokens",
      "tokenCount",
      "token_count",
    ]) !== undefined
  );
}

function readModelId(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  const direct =
    readString(value.modelId) ??
    readString(value.model_id) ??
    readString(value.model) ??
    readString(value.primaryModel) ??
    readString(value.primary_model);
  if (direct) return direct;

  const provider = readString(value.provider);
  const model = isRecord(value.model) ? readString(value.model.id) ?? readString(value.model.name) : undefined;
  return provider && model ? `${provider}/${model}` : undefined;
}

function readUsageRecordedAt(value: Record<string, unknown>): string | undefined {
  const direct = readString(value.recordedAt) ?? readString(value.recorded_at) ?? readString(value.createdAt) ?? readString(value.created_at);
  if (direct) return direct;
  const timestampMs = readNumber(value.timestampMs) ?? readNumber(value.timestamp_ms) ?? readNumber(value.createdAtMs);
  return timestampMs ? new Date(timestampMs).toISOString() : undefined;
}

function readNumberFromRecord(value: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const direct = readNumber(value[key]);
    if (direct !== undefined) return direct;
    if (typeof value[key] === "string") {
      const parsed = Number(value[key]);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function mapExecutionStatus(status: string | undefined): OpenClawTaskSummary["status"] {
  if (status === "running" || status === "queued" || status === "failed" || status === "cancelled") {
    return status;
  }
  return "succeeded";
}

function mapAcceptedExecutionStatus(status: string | undefined): StartedAgentTaskResult["status"] {
  if (status === "running" || status === "queued" || status === "succeeded" || status === "failed" || status === "cancelled") {
    return status;
  }
  if (status === "accepted") {
    return "running";
  }
  return "running";
}

function buildAgentMainSessionKey(agentId: string | undefined): string {
  const normalizedAgentId = normalizeAgentId(agentId ?? "main");
  return `agent:${normalizedAgentId}:main`;
}

function normalizeAgentId(value: string): string {
  const trimmed = value.trim().toLowerCase();
  return trimmed.replace(/[^a-z0-9_-]+/g, "-").replace(/^-+/g, "").replace(/-+$/g, "").slice(0, 64) || "main";
}

function dateFromMs(value: unknown): string {
  const ms = readNumber(value);
  return new Date(ms ?? Date.now()).toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isPresent<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function isRecoverableGatewaySessionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.message.includes("Gateway is not connected") ||
    error.message.includes("Gateway connection closed") ||
    error.message.includes("Gateway connect timeout")
  );
}
