import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction
} from "react";
import {
  Bot,
  Brain,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileUp,
  Loader2,
  MessageSquareText,
  Paperclip,
  Plus,
  Send,
  Sparkles,
  Trash2,
  Wrench
} from "lucide-react";
import type {
  CatalogSnapshot,
  ChatAttachment,
  ChatHistoryMessage,
  ChatMode,
  ChatStreamEvent,
  ChatThinkingEffort,
  HarnessId,
  HarnessStatus,
  OpenClawConfigState
} from "@hiveward/shared";
import type { Language } from "../lib/i18n";
import { api } from "../lib/api";
import { MarkdownRenderer } from "./MarkdownRenderer";

type ChatMessage = ChatHistoryMessage & {
  status?: "sent" | "streaming" | "failed";
  runtimeRef?: ChatRuntimeRef;
};

type ChatRuntimeRef = {
  taskId: string;
  runId: string;
  sessionKey: string;
  source: string;
  status: string;
  updatedAt: string;
  error?: string;
  usage?: {
    modelId: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  };
};

type SelectOption = {
  value: string;
  label: string;
  meta?: string;
  disabled?: boolean;
  variant?: "create";
};

type ChatSession = {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
};

const maxReadableFileChars = 24_000;
const maxUploadFiles = 6;
const chatSessionsStorageKey = "hiveward.chat.sessions.v1";
const chatActiveSessionStorageKey = "hiveward.chat.activeSession.v1";
const newSessionOptionValue = "__new_session__";

export function ChatPage({
  catalog,
  openClawConfig,
  harnessStatuses,
  language
}: {
  catalog?: CatalogSnapshot;
  openClawConfig?: OpenClawConfigState;
  harnessStatuses: HarnessStatus[];
  language: Language;
}) {
  const copy = chatCopy(language);
  const openClawStatus = harnessStatuses.find((status) => status.id === "openclaw");
  const modelOptions = useMemo(() => buildModelOptions(catalog, openClawConfig), [catalog, openClawConfig]);
  const agentOptions = useMemo(() => buildAgentOptions(catalog, openClawConfig), [catalog, openClawConfig]);
  const defaultModelId = openClawConfig?.defaultModelId ?? modelOptions[0]?.value ?? "";
  const defaultAgentId =
    openClawConfig?.configuredAgents.find((agent) => agent.isDefault)?.id ?? agentOptions[0]?.value ?? "main";

  const [sessions, setSessions] = useState<ChatSession[]>(() => loadChatSessions(copy));
  const [activeSessionId, setActiveSessionId] = useState(() => loadActiveChatSessionId());
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [harnessId, setHarnessId] = useState<HarnessId>("openclaw");
  const [modelId, setModelId] = useState(defaultModelId);
  const [agentId, setAgentId] = useState(defaultAgentId);
  const [thinkingEffort, setThinkingEffort] = useState<ChatThinkingEffort>("medium");
  const [mode, setMode] = useState<ChatMode>("chat");
  const [showToolCalls, setShowToolCalls] = useState(true);
  const [settingsCollapsed, setSettingsCollapsed] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const threadRef = useRef<HTMLDivElement | null>(null);
  const activeSession = sessions.find((session) => session.id === activeSessionId) ?? sessions[0];
  const messages = activeSession?.messages ?? [];

  const updateActiveSessionMessages = useCallback<Dispatch<SetStateAction<ChatMessage[]>>>(
    (nextMessagesAction) => {
      setSessions((current) =>
        current.map((session) => {
          if (session.id !== activeSession?.id) return session;

          const nextMessages =
            typeof nextMessagesAction === "function"
              ? nextMessagesAction(session.messages)
              : nextMessagesAction;
          return {
            ...session,
            title: deriveSessionTitle(session, nextMessages, copy),
            messages: nextMessages,
            updatedAt: new Date().toISOString()
          };
        })
      );
    },
    [activeSession?.id, copy]
  );

  const createSession = useCallback(() => {
    const nextSession = createChatSession(copy);
    setSessions((current) => [nextSession, ...current]);
    setActiveSessionId(nextSession.id);
    setDraft("");
    setAttachments([]);
    setError(undefined);
  }, [copy]);

  useEffect(() => {
    if (!modelId && defaultModelId) setModelId(defaultModelId);
  }, [defaultModelId, modelId]);

  useEffect(() => {
    if (!agentId && defaultAgentId) setAgentId(defaultAgentId);
  }, [agentId, defaultAgentId]);

  useEffect(() => {
    if (activeSession) return;
    const nextSession = createChatSession(copy);
    setSessions([nextSession]);
    setActiveSessionId(nextSession.id);
  }, [activeSession, copy]);

  useEffect(() => {
    persistChatSessions(sessions, activeSession?.id);
  }, [activeSession?.id, sessions]);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight });
  }, [messages]);

  const sessionOptions = useMemo<SelectOption[]>(
    () => [
      {
        value: newSessionOptionValue,
        label: copy.newSession,
        meta: copy.newSessionMeta,
        variant: "create"
      },
      ...sessions.map((session) => ({
        value: session.id,
        label: session.title,
        meta: formatSessionMeta(session, copy)
      }))
    ],
    [copy, sessions]
  );
  const harnessOptions = useMemo<SelectOption[]>(
    () => [
      { value: "openclaw", label: "OpenClaw" },
      { value: "codex", label: "Codex", meta: copy.soon, disabled: true },
      { value: "claudeCode", label: "Claude Code", meta: copy.soon, disabled: true }
    ],
    [copy.soon]
  );
  const thinkingOptions = useMemo<SelectOption[]>(
    () => [
      { value: "low", label: copy.thinkingLow },
      { value: "medium", label: copy.thinkingMedium },
      { value: "high", label: copy.thinkingHigh },
      { value: "xhigh", label: copy.thinkingXHigh }
    ],
    [copy.thinkingHigh, copy.thinkingLow, copy.thinkingMedium, copy.thinkingXHigh]
  );
  const modeOptions = useMemo<SelectOption[]>(
    () => [
      { value: "chat", label: copy.modeChat },
      { value: "build_blueprint", label: copy.modeBlueprint },
      { value: "drawing", label: copy.modeDrawing }
    ],
    [copy.modeBlueprint, copy.modeChat, copy.modeDrawing]
  );
  const usageOptions = useMemo<SelectOption[]>(
    () => [
      { value: "show", label: copy.showUsage },
      { value: "hide", label: copy.hideUsage }
    ],
    [copy.hideUsage, copy.showUsage]
  );

  const selectSession = useCallback(
    (sessionId: string) => {
      if (sessionId === newSessionOptionValue) {
        createSession();
        return;
      }
      setActiveSessionId(sessionId);
      setDraft("");
      setAttachments([]);
      setError(undefined);
    },
    [createSession]
  );

  const canSend = !isSending && (draft.trim().length > 0 || attachments.length > 0) && harnessId === "openclaw";

  const sendMessage = async () => {
    if (!canSend) return;

    const content = draft.trim();
    const outgoingAttachments = attachments;
    const now = new Date().toISOString();
    const userMessage: ChatMessage = {
      id: makeLocalId("chat-user"),
      role: "user",
      content: content || copy.attachmentOnlyMessage,
      createdAt: now,
      attachments: outgoingAttachments,
      status: "sent"
    };
    const assistantId = makeLocalId("chat-assistant");
    const assistantMessage: ChatMessage = {
      id: assistantId,
      role: "assistant",
      content: "",
      createdAt: now,
      status: "streaming"
    };

    updateActiveSessionMessages((current) => [...current, userMessage, assistantMessage]);
    setDraft("");
    setAttachments([]);
    setError(undefined);
    setIsSending(true);

    try {
      await api.streamChat(
        {
          harnessId,
          mode,
          message: content,
          history: messages.slice(-12).map(toChatHistoryMessage),
          attachments: outgoingAttachments,
          modelId: modelId || undefined,
          agentId: agentId || undefined,
          thinkingEffort,
          showToolCalls
        },
        {
          onEvent: (event) => applyChatEvent(assistantId, event, updateActiveSessionMessages)
        }
      );
    } catch (streamError) {
      const message = streamError instanceof Error ? streamError.message : copy.sendFailed;
      setError(message);
      updateActiveSessionMessages((current) =>
        current.map((item) =>
          item.id === assistantId
            ? { ...item, content: item.content || message, status: "failed" }
            : item
        )
      );
    } finally {
      setIsSending(false);
    }
  };

  const addFiles = async (fileList: FileList | null) => {
    if (!fileList) return;
    const remainingSlots = Math.max(0, maxUploadFiles - attachments.length);
    const files = Array.from(fileList).slice(0, remainingSlots);
    const nextAttachments = await Promise.all(files.map(readChatAttachment));
    setAttachments((current) => [...current, ...nextAttachments]);
  };

  return (
    <section className={`page-grid chat-page-grid ${settingsCollapsed ? "chat-settings-collapsed" : ""}`}>
      <div className="trace-page-title chat-page-title">
        <div className="chat-page-title-copy">
          <h2>{copy.title}</h2>
        </div>
        <span className={`openclaw-panel-state ${openClawStatus?.connectionState === "connected" ? "online" : "offline"}`}>
          OpenClaw
        </span>
      </div>

      <div className="chat-workspace">
        <aside className={`content-card stack-card chat-settings-panel ${settingsCollapsed ? "collapsed" : ""}`} aria-label={copy.settings}>
          <div className="chat-settings-header">
            <div className="card-title-block">
              <h3>{copy.settings}</h3>
            </div>
            <button
              type="button"
              className="chat-settings-collapse-button"
              title={settingsCollapsed ? copy.expandSettings : copy.collapseSettings}
              aria-label={settingsCollapsed ? copy.expandSettings : copy.collapseSettings}
              onClick={() => setSettingsCollapsed((current) => !current)}
            >
              {settingsCollapsed ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
              <span>{settingsCollapsed ? copy.expandSettings : copy.collapseSettings}</span>
            </button>
          </div>

          {!settingsCollapsed && (
            <div className="chat-settings-body">
              <ChatSelect
                label={copy.session}
                icon={<MessageSquareText size={14} />}
                value={activeSession?.id ?? ""}
                options={sessionOptions}
                onChange={selectSession}
              />

              <ChatSelect
                label={copy.harness}
                icon={<Bot size={14} />}
                value={harnessId}
                options={harnessOptions}
                onChange={(value) => setHarnessId(value as HarnessId)}
              />

              <ChatSelect
                label={copy.agent}
                icon={<Bot size={14} />}
                value={agentId}
                options={agentOptions}
                onChange={setAgentId}
              />

              <ChatSelect
                label={copy.model}
                icon={<Sparkles size={14} />}
                value={modelId}
                options={modelOptions}
                onChange={setModelId}
              />

              <ChatSelect
                label={copy.thinking}
                icon={<Brain size={14} />}
                value={thinkingEffort}
                options={thinkingOptions}
                onChange={(value) => setThinkingEffort(value as ChatThinkingEffort)}
              />

              <ChatSelect
                label={copy.mode}
                icon={<MessageSquareText size={14} />}
                value={mode}
                options={modeOptions}
                onChange={(value) => setMode(value as ChatMode)}
              />

              <ChatSelect
                label={copy.usage}
                icon={<Wrench size={14} />}
                value={showToolCalls ? "show" : "hide"}
                options={usageOptions}
                onChange={(value) => setShowToolCalls(value === "show")}
              />
            </div>
          )}
        </aside>

        <section className="content-card chat-window-card" aria-label={copy.title}>
          <div className="chat-thread" ref={threadRef}>
            {messages.length === 0 ? (
              <div className="chat-empty-state">
                <MessageSquareText size={22} />
                <strong>{copy.emptyTitle}</strong>
                <span>{copy.emptyBody}</span>
              </div>
            ) : (
              messages.map((message) => (
                <article
                  key={message.id}
                  className={`chat-message-row chat-message-row-${message.role} ${message.status ?? ""}`}
                >
                  <div className={`chat-avatar chat-avatar-${message.role}`} aria-label={message.role === "user" ? copy.you : copy.assistant}>
                    {message.role === "user" ? copy.youAvatar : <Bot size={16} />}
                  </div>
                  <div className={`chat-message chat-message-${message.role} ${message.status ?? ""}`}>
                    {message.content ? (
                      <MarkdownRenderer value={message.content} className="chat-message-body" />
                    ) : (
                      <div className="chat-message-pending">
                        <Loader2 className="spin" size={15} />
                        {copy.waiting}
                      </div>
                    )}
                    {message.attachments?.length ? (
                      <div className="chat-message-attachments">
                        {message.attachments.map((attachment) => (
                          <span key={attachment.id}>
                            <FileUp size={13} />
                            {attachment.name}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    {message.status === "failed" && <span className="chat-message-status">{copy.failed}</span>}
                    {showToolCalls && message.runtimeRef && <RuntimeRefBlock runtimeRef={message.runtimeRef} copy={copy} />}
                  </div>
                </article>
              ))
            )}
          </div>

          <div className="chat-composer">
            {error && <div className="chat-inline-error">{error}</div>}
            {attachments.length > 0 && (
              <div className="chat-attachment-list">
                {attachments.map((attachment) => (
                  <span key={attachment.id} className="chat-attachment-chip">
                    <Paperclip size={13} />
                    {attachment.name}
                    <small>{formatBytes(attachment.size)}</small>
                    <button
                      type="button"
                      title={copy.removeAttachment}
                      aria-label={copy.removeAttachment}
                      onClick={() => setAttachments((current) => current.filter((item) => item.id !== attachment.id))}
                    >
                      <Trash2 size={12} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="chat-composer-row">
              <label className="chat-file-button" title={copy.upload}>
                <Paperclip size={16} />
                <input
                  type="file"
                  multiple
                  hidden
                  onChange={(event) => {
                    void addFiles(event.target.files);
                    event.currentTarget.value = "";
                  }}
                />
              </label>
              <textarea
                value={draft}
                placeholder={copy.placeholder}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void sendMessage();
                  }
                }}
              />
              <button type="button" className="primary-action chat-send-button" disabled={!canSend} onClick={() => void sendMessage()}>
                {isSending ? <Loader2 className="spin" size={16} /> : <Send size={16} />}
                {copy.send}
              </button>
            </div>
          </div>
        </section>
      </div>
    </section>
  );
}

function ChatSelect({
  label,
  icon,
  value,
  options,
  onChange
}: {
  label: string;
  icon: ReactNode;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selectedOption = options.find((option) => option.value === value && option.variant !== "create");
  const selectedLabel = selectedOption?.label ?? options.find((option) => option.value === value)?.label ?? "";

  return (
    <div
      className="chat-select-field"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <span className="chat-control-label">
        {icon}
        {label}
      </span>
      <div className="chat-select-shell">
        <button
          type="button"
          className={`chat-select-button ${open ? "open" : ""}`}
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          <span className="chat-select-value">
            <strong>{selectedLabel}</strong>
            {selectedOption?.meta && <small>{selectedOption.meta}</small>}
          </span>
          <ChevronDown size={15} />
        </button>
        {open && (
          <div className="chat-select-menu" role="listbox" aria-label={label}>
            {options.map((option) => {
              const selected = option.value === value && option.variant !== "create";
              return (
                <button
                  key={option.value}
                  type="button"
                  className={`chat-select-option ${selected ? "selected" : ""} ${option.variant === "create" ? "create" : ""}`}
                  role="option"
                  aria-selected={selected}
                  disabled={option.disabled}
                  onClick={() => {
                    if (option.disabled) return;
                    onChange(option.value);
                    setOpen(false);
                  }}
                >
                  <span className="chat-select-option-main">
                    {option.variant === "create" && <Plus size={14} />}
                    <span>{option.label}</span>
                    {option.meta && <small>{option.meta}</small>}
                  </span>
                  {selected && <Check size={14} />}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function RuntimeRefBlock({ runtimeRef, copy }: { runtimeRef: ChatRuntimeRef; copy: ReturnType<typeof chatCopy> }) {
  if (!runtimeRef.usage) return null;

  const totalTokens = runtimeRef.usage.inputTokens + runtimeRef.usage.outputTokens;

  return (
    <div className="chat-runtime-ref" aria-label={copy.usageSummary}>
      <span className="chat-runtime-pill">
        <Sparkles size={13} />
        <span>{copy.usageModel}</span>
        <strong>{runtimeRef.usage.modelId}</strong>
      </span>
      <span className="chat-runtime-pill">
        <Brain size={13} />
        <span>{copy.usageTokens}</span>
        <strong>
          {formatTokenCount(totalTokens)} {copy.tokensUnit}
        </strong>
      </span>
    </div>
  );
}

function applyChatEvent(
  assistantId: string,
  event: ChatStreamEvent,
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>
) {
  if (event.type === "delta") {
    setMessages((current) =>
      current.map((message) =>
        message.id === assistantId ? { ...message, content: `${message.content}${event.text}` } : message
      )
    );
    return;
  }

  if (event.type === "started") {
    setMessages((current) =>
      current.map((message) =>
        message.id === assistantId
          ? {
              ...message,
              runtimeRef: toRuntimeRef(event)
            }
          : message
      )
    );
    return;
  }

  if (event.type === "done") {
    setMessages((current) =>
      current.map((message) =>
        message.id === assistantId
          ? {
              ...message,
              content: message.content || event.output || event.error || "",
              status: event.status === "failed" || event.status === "cancelled" ? "failed" : "sent",
              runtimeRef: toRuntimeRef(event)
            }
          : message
      )
    );
    return;
  }

  setMessages((current) =>
    current.map((message) =>
      message.id === assistantId ? { ...message, content: message.content || event.message, status: "failed" } : message
    )
  );
}

function toRuntimeRef(event: Extract<ChatStreamEvent, { type: "started" | "done" }>): ChatRuntimeRef {
  return {
    taskId: event.taskId,
    runId: event.runId,
    sessionKey: event.sessionKey,
    source: event.source,
    status: event.status,
    updatedAt: event.updatedAt,
    error: "error" in event ? event.error : undefined,
    usage: "usage" in event ? event.usage : undefined
  };
}

function buildModelOptions(catalog?: CatalogSnapshot, openClawConfig?: OpenClawConfigState): SelectOption[] {
  const options = [
    ...(openClawConfig?.configuredModels.map((model) => ({
      value: model.id,
      label: model.label || model.id,
      meta: model.provider
    })) ?? []),
    ...(catalog?.models.map((model) => ({
      value: model.id,
      label: model.label || model.id,
      meta: model.provider
    })) ?? [])
  ];
  return mergeOptions(options, openClawConfig?.defaultModelId ? [{ value: openClawConfig.defaultModelId, label: openClawConfig.defaultModelId }] : []);
}

function buildAgentOptions(catalog?: CatalogSnapshot, openClawConfig?: OpenClawConfigState): SelectOption[] {
  const options = [
    ...(openClawConfig?.configuredAgents.map((agent) => ({
      value: agent.id,
      label: agent.name || agent.id,
      meta: agent.isDefault ? "default" : agent.workspace
    })) ?? []),
    ...(catalog?.agents.map((agent) => ({
      value: agent.id,
      label: agent.label || agent.id,
      meta: agent.modelId
    })) ?? [])
  ];
  return mergeOptions(options, [{ value: "main", label: "main" }]);
}

function mergeOptions(primary: SelectOption[], fallbacks: SelectOption[] = []): SelectOption[] {
  const seen = new Set<string>();
  return [...primary, ...fallbacks].filter((option) => {
    if (!option.value || seen.has(option.value)) return false;
    seen.add(option.value);
    return true;
  });
}

async function readChatAttachment(file: File): Promise<ChatAttachment> {
  const shouldReadText = isReadableTextFile(file);
  let text: string | undefined;
  let truncated = false;

  if (shouldReadText) {
    const raw = await file.text();
    text = raw.slice(0, maxReadableFileChars);
    truncated = raw.length > maxReadableFileChars;
  }

  return {
    id: makeLocalId("chat-file"),
    name: file.name,
    mediaType: file.type || "application/octet-stream",
    size: file.size,
    text,
    truncated
  };
}

function isReadableTextFile(file: File): boolean {
  return (
    file.type.startsWith("text/") ||
    /\.(css|csv|html?|json|log|md|mdx|ts|tsx|js|jsx|txt|xml|ya?ml)$/i.test(file.name)
  );
}

function toChatHistoryMessage(message: ChatMessage): ChatHistoryMessage {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    createdAt: message.createdAt,
    attachments: message.attachments?.map(({ id, name, mediaType, size, truncated }) => ({
      id,
      name,
      mediaType,
      size,
      truncated
    }))
  };
}

function createChatSession(copy: ReturnType<typeof chatCopy>): ChatSession {
  const now = new Date().toISOString();
  return {
    id: makeLocalId("chat-session"),
    title: copy.newSessionTitle,
    messages: [],
    createdAt: now,
    updatedAt: now
  };
}

function loadChatSessions(copy: ReturnType<typeof chatCopy>): ChatSession[] {
  if (typeof window === "undefined") return [createChatSession(copy)];
  try {
    const raw = window.localStorage.getItem(chatSessionsStorageKey);
    if (!raw) return [createChatSession(copy)];
    const parsed = JSON.parse(raw) as ChatSession[];
    const sessions = parsed
      .filter((session) => session.id && Array.isArray(session.messages))
      .map((session) => ({
        id: session.id,
        title: session.title || copy.newSessionTitle,
        messages: session.messages,
        createdAt: session.createdAt || new Date().toISOString(),
        updatedAt: session.updatedAt || session.createdAt || new Date().toISOString()
      }));
    return sessions.length > 0 ? sessions : [createChatSession(copy)];
  } catch {
    return [createChatSession(copy)];
  }
}

function loadActiveChatSessionId(): string | undefined {
  if (typeof window === "undefined") return undefined;
  return window.localStorage.getItem(chatActiveSessionStorageKey) ?? undefined;
}

function persistChatSessions(sessions: ChatSession[], activeSessionId?: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(chatSessionsStorageKey, JSON.stringify(sessions));
    if (activeSessionId) {
      window.localStorage.setItem(chatActiveSessionStorageKey, activeSessionId);
    }
  } catch {
    // Session persistence should not block chat if browser storage is unavailable.
  }
}

function deriveSessionTitle(session: ChatSession, messages: ChatMessage[], copy: ReturnType<typeof chatCopy>): string {
  if (session.messages.length > 0 && session.title !== copy.newSessionTitle) return session.title;
  const firstUserMessage = messages.find((message) => message.role === "user")?.content.trim();
  if (!firstUserMessage) return session.title || copy.newSessionTitle;
  return firstUserMessage.length > 24 ? `${firstUserMessage.slice(0, 24)}...` : firstUserMessage;
}

function formatSessionMeta(session: ChatSession, copy: ReturnType<typeof chatCopy>): string {
  if (session.messages.length === 0) return copy.emptySessionMeta;
  return `${session.messages.length} ${copy.messagesUnit}`;
}

function formatBytes(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)} MB`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)} KB`;
  return `${value} B`;
}

function formatTokenCount(value: number): string {
  return value.toLocaleString();
}

function makeLocalId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function chatCopy(language: Language) {
  if (language === "zh-CN") {
    return {
      title: "\u804a\u5929",
      settings: "\u5bf9\u8bdd\u914d\u7f6e",
      collapseSettings: "\u6536\u8d77",
      expandSettings: "\u5c55\u5f00",
      session: "\u4f1a\u8bdd",
      newSession: "\u65b0\u5efa\u4f1a\u8bdd",
      newSessionMeta: "\u521b\u5efa Hiveward \u5e73\u53f0\u4f1a\u8bdd",
      newSessionTitle: "\u65b0\u4f1a\u8bdd",
      emptySessionMeta: "\u672a\u5f00\u59cb",
      messagesUnit: "\u6761\u6d88\u606f",
      harness: "Harness",
      soon: "\u7a0d\u540e",
      agent: "Agent",
      model: "\u6a21\u578b",
      thinking: "\u601d\u8003\u5f3a\u5ea6",
      thinkingLow: "\u4f4e",
      thinkingMedium: "\u4e2d",
      thinkingHigh: "\u9ad8",
      thinkingXHigh: "\u6781\u9ad8",
      mode: "\u6a21\u5f0f",
      modeChat: "\u804a\u5929",
      modeBlueprint: "\u521b\u5efa\u84dd\u56fe",
      modeDrawing: "\u7ed8\u753b",
      showTools: "\u663e\u793a\u6a21\u578b\u548c Token \u6d88\u8017",
      usage: "\u6d88\u8017\u663e\u793a",
      showUsage: "\u663e\u793a",
      hideUsage: "\u9690\u85cf",
      emptyTitle: "\u65b0\u5bf9\u8bdd",
      emptyBody: "\u9009\u62e9 Agent\u3001\u6a21\u578b\u548c\u6a21\u5f0f\uff0c\u7136\u540e\u76f4\u63a5\u53d1\u9001\u3002",
      you: "\u4f60",
      youAvatar: "\u4f60",
      assistant: "OpenClaw",
      streaming: "\u8f93\u51fa\u4e2d",
      failed: "\u5931\u8d25",
      waiting: "\u7b49\u5f85 OpenClaw \u8fd4\u56de...",
      usageSummary: "\u6a21\u578b\u548c Token \u6d88\u8017",
      usageModel: "\u6a21\u578b",
      usageTokens: "Token \u6d88\u8017",
      tokensUnit: "tokens",
      attachmentOnlyMessage: "\u5df2\u4e0a\u4f20\u6587\u4ef6",
      removeAttachment: "\u79fb\u9664\u9644\u4ef6",
      upload: "\u4e0a\u4f20\u6587\u4ef6",
      placeholder: "\u8f93\u5165\u6d88\u606f\uff0cShift+Enter \u6362\u884c...",
      send: "\u53d1\u9001",
      sendFailed: "\u53d1\u9001\u5931\u8d25\u3002"
    };
  }

  return {
    title: "Chat",
    settings: "Chat settings",
    collapseSettings: "Collapse",
    expandSettings: "Expand",
    session: "Session",
    newSession: "New session",
    newSessionMeta: "Create a Hiveward platform session",
    newSessionTitle: "New session",
    emptySessionMeta: "Not started",
    messagesUnit: "messages",
    harness: "Harness",
    soon: "soon",
    agent: "Agent",
    model: "Model",
    thinking: "Thinking",
    thinkingLow: "Low",
    thinkingMedium: "Medium",
    thinkingHigh: "High",
    thinkingXHigh: "Extra high",
    mode: "Mode",
    modeChat: "Chat",
    modeBlueprint: "Build a blueprint",
    modeDrawing: "Drawing",
    showTools: "Show model and token usage",
    usage: "Usage display",
    showUsage: "Show",
    hideUsage: "Hide",
    emptyTitle: "New conversation",
    emptyBody: "Choose an agent, model, and mode, then send a message.",
    you: "You",
    youAvatar: "You",
    assistant: "OpenClaw",
    streaming: "Streaming",
    failed: "Failed",
    waiting: "Waiting for OpenClaw...",
    usageSummary: "Model and token usage",
    usageModel: "Model",
    usageTokens: "Token usage",
    tokensUnit: "tokens",
    attachmentOnlyMessage: "Uploaded files",
    removeAttachment: "Remove attachment",
    upload: "Upload files",
    placeholder: "Type a message, Shift+Enter for a new line...",
    send: "Send",
    sendFailed: "Failed to send message."
  };
}
