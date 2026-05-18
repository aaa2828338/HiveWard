import type {
  OpenClawAgent,
  OpenClawChannel,
  OpenClawModel,
  OpenClawSessionSummary,
  OpenClawTaskSummary,
  OpenClawTool,
  SendChannelInput,
  SendChannelResult,
  StartAgentTaskInput,
  StartAgentTaskResult,
} from "@openclaw-cui/shared";
import type { OpenClawAdapter } from "./index";
import type { GatewayAdapterConfig } from "./gateway-config";
import { GatewaySession } from "./gateway-client";
import { createGatewayId } from "./gateway-device";

export class GatewayOpenClawAdapter implements OpenClawAdapter {
  private sharedSession: GatewaySession | undefined;
  private sharedSessionPromise: Promise<GatewaySession> | undefined;

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
    return this.withSession(async (session) => {
      const result = await session.request<{ sessions?: unknown[] }>("sessions.list", {
        limit: 20,
        includeGlobal: true,
        includeUnknown: true,
      });
      return (Array.isArray(result.sessions) ? result.sessions : []).map(mapSession).filter(isPresent);
    });
  }

  async listTasks(): Promise<OpenClawTaskSummary[]> {
    return this.withSession(async (session) => {
      const result = await session.request<{ sessions?: unknown[] }>("sessions.list", {
        limit: 20,
        includeGlobal: true,
        includeUnknown: true,
      });
      return (Array.isArray(result.sessions) ? result.sessions : []).map(mapSessionTask).filter(isPresent);
    });
  }

  async startAgentTask(input: StartAgentTaskInput): Promise<StartAgentTaskResult> {
    return this.withSession(async (session) => {
      const idempotencyKey = createGatewayId(input.nodeRunId);
      const modelRef = await this.resolveModelRef(session, input.modelId);
      const result = await session.request<Record<string, unknown>>(
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
        { expectFinal: true, timeoutMs: this.config.agentTimeoutMs },
      );
      const runId = readString(result.runId) ?? idempotencyKey;
      const sessionKey = readString(result.sessionKey) ?? buildAgentMainSessionKey(input.agentId);
      const ok = readString(result.status) !== "error";
      const transcriptResult = ok ? await readAgentTranscriptResult(session, sessionKey, input.nodeRunId) : undefined;
      const transcriptError = transcriptResult?.error;
      const status = ok && !transcriptError ? "succeeded" : "failed";
      return {
        taskId: runId,
        runId,
        sessionKey,
        status,
        output: status === "succeeded" ? transcriptResult?.output ?? summarizeAgentResult(result) : undefined,
        error: transcriptError ?? (ok ? undefined : summarizeAgentResult(result)),
        usage: undefined,
        updatedAt: new Date().toISOString(),
      };
    });
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
): Promise<{ output?: string; error?: string } | undefined> {
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
      const errorMessage = readString(message.errorMessage);
      if (errorMessage) return { error: errorMessage };
      const text = extractMessageText(message).trim();
      if (text && text !== "completed") return { output: text };
      if (readString(message.stopReason) === "error") {
        return { error: "OpenClaw assistant stopped with an error before returning visible output." };
      }
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

function mapExecutionStatus(status: string | undefined): OpenClawTaskSummary["status"] {
  if (status === "running" || status === "queued" || status === "failed" || status === "cancelled") {
    return status;
  }
  return "succeeded";
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
    error.message.includes("Gateway connect timeout") ||
    error.message.includes("Gateway request timeout")
  );
}
