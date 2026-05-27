import { readFile } from "node:fs/promises";
import { nanoid } from "nanoid";
import type {
  ChatAttachment,
  ChatMessageStatus,
  ChatMode,
  ChatNativeSessionState,
  ChatRoleScope,
  ChatRuntimeRef,
  ChatSessionStatus,
  ChatThinkingEffort,
  CompanyProfile,
  CreateHivewardChatSessionRequest,
  HarnessId,
  HivewardChatMessage,
  HivewardChatSession,
  UpdateHivewardChatSessionRequest
} from "@hiveward/shared";
import { isFileNotFoundError, safeWriteJson } from "./jsonFile";

const chatStoreSchema = "hiveward.chat-store/v1";
const defaultMaxMessagesPerSession = 60;

interface HivewardChatStoreState {
  schema: typeof chatStoreSchema;
  chatSessions: HivewardChatSession[];
  chatMessages: Record<string, HivewardChatMessage[]>;
}

type RawHivewardChatStoreState = Partial<HivewardChatStoreState> & {
  chatSessions?: unknown;
  chatMessages?: unknown;
};

export interface LegacyHivewardChatState {
  chatSessions?: unknown;
  chatMessages?: unknown;
}

export class FileHivewardChatStore {
  private operationQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly maxMessagesPerSession = defaultMaxMessagesPerSession
  ) {}

  async init(companies: CompanyProfile[], legacyChat?: LegacyHivewardChatState): Promise<void> {
    return this.enqueue(async () => {
      const state = await this.readStateUnlocked(companies);
      const merged = legacyChat ? mergeChatStates(state, normalizeChatState(legacyChat, companies, new Date().toISOString(), this.maxMessagesPerSession)) : state;
      for (const session of merged.chatSessions) {
        enforceMessageRetention(merged, session.id, this.maxMessagesPerSession);
      }
      await this.writeStateUnlocked(merged);
    });
  }

  async listChatSessions(companyId: string): Promise<HivewardChatSession[]> {
    return this.enqueue(async () => {
      const state = await this.readStateUnlocked();
      return state.chatSessions
        .filter((session) => session.companyId === companyId)
        .slice()
        .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
    });
  }

  async getChatSession(companyId: string, id: string): Promise<HivewardChatSession | undefined> {
    return this.enqueue(async () => {
      const state = await this.readStateUnlocked();
      return state.chatSessions.find((session) => session.id === id && session.companyId === companyId);
    });
  }

  async findChatSessionByNative(input: { companyId: string; harnessId: HarnessId; nativeSessionId: string }): Promise<HivewardChatSession | undefined> {
    return this.enqueue(async () => {
      const state = await this.readStateUnlocked();
      return state.chatSessions.find(
        (session) =>
          session.companyId === input.companyId &&
          session.harnessId === input.harnessId &&
          session.nativeSessionId === input.nativeSessionId
      );
    });
  }

  async createChatSession(
    companyId: string,
    input: CreateHivewardChatSessionRequest & { roleScope?: ChatRoleScope }
  ): Promise<HivewardChatSession> {
    return this.enqueue(async () => {
      const state = await this.readStateUnlocked();
      const now = new Date().toISOString();
      const session: HivewardChatSession = {
        id: nextChatSessionId(state.chatSessions),
        companyId,
        harnessId: normalizeHarnessId(input.harnessId),
        roleScope: input.roleScope,
        title: readOptionalString(input.title) ?? "New chat",
        nativeSessionId: readOptionalString(input.nativeSessionId),
        nativeSessionState: readOptionalString(input.nativeSessionId) ? "resumable" : "unknown",
        modelId: readOptionalString(input.modelId),
        agentId: readOptionalString(input.agentId),
        thinkingEffort: normalizeChatThinkingEffort(input.thinkingEffort),
        permissionMode: normalizeChatPermissionMode(input.permissionMode) ?? "safe",
        mode: normalizeChatMode(input.mode),
        status: "active",
        createdAt: now,
        updatedAt: now
      };
      state.chatSessions.unshift(session);
      state.chatMessages[session.id] = [];
      await this.writeStateUnlocked(state);
      return session;
    });
  }

  async updateChatSession(
    companyId: string,
    id: string,
    patch: UpdateHivewardChatSessionRequest & { roleScope?: ChatRoleScope }
  ): Promise<HivewardChatSession | undefined> {
    return this.enqueue(async () => {
      const state = await this.readStateUnlocked();
      const sessionIndex = state.chatSessions.findIndex((session) => session.id === id && session.companyId === companyId);
      if (sessionIndex < 0) return undefined;
      const current = state.chatSessions[sessionIndex]!;
      const now = new Date().toISOString();
      const nextStatus = normalizeChatSessionStatus(patch.status) ?? current.status;
      const endedAt = nextStatus === "ended" ? current.endedAt ?? now : current.endedAt;
      const next: HivewardChatSession = {
        ...current,
        title: readOptionalString(patch.title) ?? current.title,
        nativeSessionId: Object.hasOwn(patch, "nativeSessionId") ? readOptionalString(patch.nativeSessionId) : current.nativeSessionId,
        nativeSessionState: normalizeNativeSessionState(patch.nativeSessionState) ?? current.nativeSessionState,
        modelId: readOptionalString(patch.modelId) ?? current.modelId,
        agentId: readOptionalString(patch.agentId) ?? current.agentId,
        thinkingEffort: normalizeChatThinkingEffort(patch.thinkingEffort) ?? current.thinkingEffort,
        permissionMode: normalizeChatPermissionMode(patch.permissionMode) ?? current.permissionMode ?? "safe",
        mode: patch.mode ? normalizeChatMode(patch.mode) : current.mode,
        roleScope: patch.roleScope ?? current.roleScope,
        status: nextStatus,
        endedAt,
        updatedAt: now
      };
      state.chatSessions[sessionIndex] = next;
      await this.writeStateUnlocked(state);
      return next;
    });
  }

  async endChatSession(companyId: string, id: string): Promise<HivewardChatSession | undefined> {
    return this.updateChatSession(companyId, id, { status: "ended" });
  }

  async listChatMessages(companyId: string, sessionId: string): Promise<HivewardChatMessage[]> {
    return this.enqueue(async () => {
      const state = await this.readStateUnlocked();
      if (!state.chatSessions.some((session) => session.id === sessionId && session.companyId === companyId)) {
        return [];
      }
      return (state.chatMessages[sessionId] ?? []).slice().sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());
    });
  }

  async appendChatMessage(
    companyId: string | undefined,
    input: Omit<HivewardChatMessage, "id" | "createdAt" | "updatedAt"> & {
      id?: string;
      createdAt?: string;
      updatedAt?: string;
    }
  ): Promise<HivewardChatMessage> {
    return this.enqueue(async () => {
      const state = await this.readStateUnlocked();
      const sessionIndex = state.chatSessions.findIndex((session) => session.id === input.sessionId && session.companyId === companyId);
      if (sessionIndex < 0) {
        throw new Error(`Chat session not found: ${input.sessionId}`);
      }
      const now = new Date().toISOString();
      const message: HivewardChatMessage = {
        id: input.id ?? nextChatMessageId(state.chatMessages[input.sessionId] ?? []),
        sessionId: input.sessionId,
        role: normalizeChatMessageRole(input.role) ?? "user",
        content: input.content,
        attachments: normalizeStoredChatAttachments(input.attachments),
        harnessId: normalizeHarnessId(input.harnessId),
        modelId: readOptionalString(input.modelId),
        nativeMessageId: readOptionalString(input.nativeMessageId),
        status: normalizeChatMessageStatus(input.status) ?? "sent",
        runtimeRef: normalizeChatRuntimeRef(input.runtimeRef),
        createdAt: input.createdAt ?? now,
        updatedAt: input.updatedAt
      };
      state.chatMessages[input.sessionId] = [...(state.chatMessages[input.sessionId] ?? []), message];
      enforceMessageRetention(state, input.sessionId, this.maxMessagesPerSession);
      state.chatSessions[sessionIndex] = {
        ...state.chatSessions[sessionIndex]!,
        title: deriveChatSessionTitle(state.chatSessions[sessionIndex]!, message),
        updatedAt: now
      };
      await this.writeStateUnlocked(state);
      return message;
    });
  }

  async updateChatMessage(
    companyId: string | undefined,
    sessionId: string,
    messageId: string,
    patch: Partial<Pick<HivewardChatMessage, "content" | "status" | "runtimeRef" | "nativeMessageId" | "modelId">>
  ): Promise<HivewardChatMessage | undefined> {
    return this.enqueue(async () => {
      const state = await this.readStateUnlocked();
      const sessionIndex = state.chatSessions.findIndex((session) => session.id === sessionId && session.companyId === companyId);
      if (sessionIndex < 0) return undefined;
      const messages = state.chatMessages[sessionId] ?? [];
      const messageIndex = messages.findIndex((message) => message.id === messageId);
      if (messageIndex < 0) return undefined;
      const now = new Date().toISOString();
      const current = messages[messageIndex]!;
      const next: HivewardChatMessage = {
        ...current,
        content: patch.content ?? current.content,
        status: normalizeChatMessageStatus(patch.status) ?? current.status,
        runtimeRef: patch.runtimeRef === undefined ? current.runtimeRef : normalizeChatRuntimeRef(patch.runtimeRef),
        nativeMessageId: readOptionalString(patch.nativeMessageId) ?? current.nativeMessageId,
        modelId: readOptionalString(patch.modelId) ?? current.modelId,
        updatedAt: now
      };
      messages[messageIndex] = next;
      state.chatMessages[sessionId] = messages;
      state.chatSessions[sessionIndex] = {
        ...state.chatSessions[sessionIndex]!,
        updatedAt: now
      };
      await this.writeStateUnlocked(state);
      return next;
    });
  }

  async deleteCompanyChats(companyId: string): Promise<void> {
    await this.enqueue(async () => {
      const state = await this.readStateUnlocked();
      const chatSessionIds = state.chatSessions.filter((session) => session.companyId === companyId).map((session) => session.id);
      state.chatSessions = state.chatSessions.filter((session) => session.companyId !== companyId);
      for (const sessionId of chatSessionIds) {
        delete state.chatMessages[sessionId];
      }
      await this.writeStateUnlocked(state);
    });
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.operationQueue.then(operation, operation);
    this.operationQueue = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }

  private async readStateUnlocked(companies?: CompanyProfile[]): Promise<HivewardChatStoreState> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8")) as RawHivewardChatStoreState;
      return normalizeChatState(parsed, companies, new Date().toISOString(), this.maxMessagesPerSession);
    } catch (error) {
      if (!isFileNotFoundError(error)) throw error;
      return {
        schema: chatStoreSchema,
        chatSessions: [],
        chatMessages: {}
      };
    }
  }

  private async writeStateUnlocked(state: HivewardChatStoreState): Promise<void> {
    await safeWriteJson(this.filePath, state);
  }
}

function normalizeChatState(
  rawState: LegacyHivewardChatState,
  companies: CompanyProfile[] | undefined,
  now: string,
  maxMessagesPerSession: number
): HivewardChatStoreState {
  const chatSessions = normalizeChatSessions(rawState.chatSessions, companies, now);
  const state: HivewardChatStoreState = {
    schema: chatStoreSchema,
    chatSessions,
    chatMessages: normalizeChatMessages(rawState.chatMessages, chatSessions, now)
  };
  for (const session of chatSessions) {
    enforceMessageRetention(state, session.id, maxMessagesPerSession);
  }
  return state;
}

function mergeChatStates(left: HivewardChatStoreState, right: HivewardChatStoreState): HivewardChatStoreState {
  const sessionsById = new Map(left.chatSessions.map((session) => [session.id, session]));
  for (const session of right.chatSessions) {
    if (!sessionsById.has(session.id)) {
      sessionsById.set(session.id, session);
    }
  }

  const sessionIds = new Set(sessionsById.keys());
  const chatMessages: Record<string, HivewardChatMessage[]> = {};
  for (const sessionId of sessionIds) {
    const messagesById = new Map<string, HivewardChatMessage>();
    for (const message of left.chatMessages[sessionId] ?? []) {
      messagesById.set(message.id, message);
    }
    for (const message of right.chatMessages[sessionId] ?? []) {
      if (!messagesById.has(message.id)) {
        messagesById.set(message.id, message);
      }
    }
    chatMessages[sessionId] = [...messagesById.values()].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }

  return {
    schema: chatStoreSchema,
    chatSessions: [...sessionsById.values()],
    chatMessages
  };
}

function enforceMessageRetention(state: HivewardChatStoreState, sessionId: string, maxMessagesPerSession: number): void {
  const messages = state.chatMessages[sessionId] ?? [];
  state.chatMessages[sessionId] = messages
    .slice()
    .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime())
    .slice(-maxMessagesPerSession);
}

function normalizeChatSessions(value: unknown, companies: CompanyProfile[] | undefined, now: string): HivewardChatSession[] {
  const companyIds = new Set((companies ?? []).map((company) => company.id));
  return Array.isArray(value)
    ? value.flatMap((item) => {
        if (!isRecord(item)) return [];
        const id = readString(item.id) ?? `chat-session-${nanoid(8)}`;
        const companyId = readString(item.companyId);
        if (companyIds.size > 0 && (!companyId || !companyIds.has(companyId))) return [];
        if (!companyId) return [];
        return [{
          id,
          companyId,
          harnessId: normalizeHarnessId(item.harnessId),
          roleScope: normalizeChatRoleScopeForCompany(item.roleScope, companyId),
          title: readString(item.title) ?? "New chat",
          nativeSessionId: readString(item.nativeSessionId),
          nativeSessionState: normalizeNativeSessionState(item.nativeSessionState) ?? "unknown",
          modelId: readString(item.modelId),
          agentId: readString(item.agentId),
          thinkingEffort: normalizeChatThinkingEffort(item.thinkingEffort),
          permissionMode: normalizeChatPermissionMode(item.permissionMode) ?? "safe",
          mode: normalizeChatMode(item.mode),
          status: normalizeChatSessionStatus(item.status) ?? "active",
          createdAt: readString(item.createdAt) ?? now,
          updatedAt: readString(item.updatedAt) ?? readString(item.createdAt) ?? now,
          endedAt: readString(item.endedAt)
        }];
      })
    : [];
}

function normalizeChatMessages(value: unknown, sessions: HivewardChatSession[], now: string): Record<string, HivewardChatMessage[]> {
  const sessionIds = new Set(sessions.map((session) => session.id));
  const messagesBySession: Record<string, HivewardChatMessage[]> = {};
  for (const session of sessions) {
    messagesBySession[session.id] = [];
  }

  if (!isRecord(value)) return messagesBySession;
  for (const [sessionId, messages] of Object.entries(value)) {
    if (!sessionIds.has(sessionId) || !Array.isArray(messages)) continue;
    const session = sessions.find((candidate) => candidate.id === sessionId);
    messagesBySession[sessionId] = messages.flatMap((item) => normalizeChatMessage(item, sessionId, session?.harnessId ?? "openclaw", now));
  }
  return messagesBySession;
}

function normalizeChatMessage(value: unknown, sessionId: string, fallbackHarnessId: HarnessId, now: string): HivewardChatMessage[] {
  if (!isRecord(value)) return [];
  const role = normalizeChatMessageRole(value.role);
  if (!role) return [];
  return [{
    id: readString(value.id) ?? `chat-message-${nanoid(8)}`,
    sessionId,
    role,
    content: readString(value.content) ?? "",
    attachments: normalizeStoredChatAttachments(value.attachments),
    harnessId: normalizeHarnessId(value.harnessId, fallbackHarnessId),
    modelId: readString(value.modelId),
    nativeMessageId: readString(value.nativeMessageId),
    status: normalizeChatMessageStatus(value.status) ?? "sent",
    runtimeRef: normalizeChatRuntimeRef(value.runtimeRef),
    createdAt: readString(value.createdAt) ?? now,
    updatedAt: readString(value.updatedAt)
  }];
}

function normalizeChatRoleScope(value: unknown): ChatRoleScope | undefined {
  if (!isRecord(value)) return undefined;
  const role = value.role === "leader" ? "leader" : value.role === "ceo" ? "ceo" : undefined;
  if (!role) return undefined;
  return {
    companyId: readString(value.companyId),
    role,
    leaderId: readString(value.leaderId),
    blueprintId: readString(value.blueprintId)
  };
}

function normalizeChatRoleScopeForCompany(value: unknown, companyId: string): ChatRoleScope | undefined {
  const scope = normalizeChatRoleScope(value);
  return scope ? { ...scope, companyId } : undefined;
}

function normalizeHarnessId(value: unknown, fallback: HarnessId = "openclaw"): HarnessId {
  if (value === "codex" || value === "claudeCode" || value === "openclaw") return value;
  return fallback;
}

function normalizeChatMode(value: unknown): ChatMode {
  return value === "blueprint" || value === "skill_split" ? value : "chat";
}

function normalizeChatThinkingEffort(value: unknown): ChatThinkingEffort | undefined {
  return value === "off" ||
    value === "minimal" ||
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "adaptive" ||
    value === "xhigh" ||
    value === "max"
    ? value
    : undefined;
}

function normalizeChatPermissionMode(value: unknown): HivewardChatSession["permissionMode"] | undefined {
  return value === "safe" || value === "full_access" ? value : undefined;
}

function normalizeChatSessionStatus(value: unknown): ChatSessionStatus | undefined {
  return value === "active" || value === "ended" || value === "native_missing" || value === "failed" ? value : undefined;
}

function normalizeNativeSessionState(value: unknown): ChatNativeSessionState | undefined {
  return value === "unknown" || value === "resumable" || value === "missing" ? value : undefined;
}

function normalizeChatMessageRole(value: unknown): HivewardChatMessage["role"] | undefined {
  if (value === "user" || value === "assistant" || value === "system") return value;
  return undefined;
}

function normalizeChatMessageStatus(value: unknown): ChatMessageStatus | undefined {
  return value === "sent" || value === "streaming" || value === "failed" ? value : undefined;
}

function normalizeStoredChatAttachments(value: unknown): ChatAttachment[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const attachments = value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const id = readString(item.id);
    const name = readString(item.name);
    const mediaType = readString(item.mediaType);
    const size = typeof item.size === "number" && Number.isFinite(item.size) ? item.size : undefined;
    if (!id || !name || !mediaType || size === undefined) return [];
    return [{
      id,
      name,
      mediaType,
      size,
      text: readString(item.text),
      truncated: item.truncated === true
    }];
  });
  return attachments.length ? attachments : undefined;
}

function normalizeChatRuntimeRef(value: unknown): ChatRuntimeRef | undefined {
  if (!isRecord(value)) return undefined;
  const taskId = readString(value.taskId);
  const runId = readString(value.runId);
  const sessionKey = readString(value.sessionKey);
  const source = value.source === "openclaw" || value.source === "codex" || value.source === "claude" ? value.source : undefined;
  const status = readString(value.status);
  const updatedAt = readString(value.updatedAt);
  if (!taskId || !runId || !sessionKey || !source || !status || !updatedAt) return undefined;
  return {
    taskId,
    runId,
    sessionKey,
    source,
    status,
    updatedAt,
    error: readString(value.error),
    usage: isRecord(value.usage) ? value.usage as unknown as ChatRuntimeRef["usage"] : undefined,
    timings: isRecord(value.timings) ? value.timings as unknown as ChatRuntimeRef["timings"] : undefined
  };
}

function deriveChatSessionTitle(session: HivewardChatSession, message: HivewardChatMessage): string {
  if (session.title && session.title !== "New chat") return session.title;
  if (message.role !== "user") return session.title || "New chat";
  const content = message.content.trim();
  if (!content) return session.title || "New chat";
  return content.length > 42 ? `${content.slice(0, 42)}...` : content;
}

function nextChatSessionId(sessions: Array<{ id: string }>): string {
  const used = new Set(sessions.map((session) => session.id));
  let id = `chat-session-${nanoid(10)}`;
  while (used.has(id)) {
    id = `chat-session-${nanoid(10)}`;
  }
  return id;
}

function nextChatMessageId(messages: Array<{ id: string }>): string {
  const used = new Set(messages.map((message) => message.id));
  let id = `chat-message-${nanoid(10)}`;
  while (used.has(id)) {
    id = `chat-message-${nanoid(10)}`;
  }
  return id;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function readOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}
