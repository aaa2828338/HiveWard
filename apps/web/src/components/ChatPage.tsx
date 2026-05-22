import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import {
  Bot,
  Brain,
  ChevronLeft,
  ChevronRight,
  FileUp,
  Image as ImageIcon,
  Loader2,
  MessageSquareText,
  Paperclip,
  Send,
  Settings2,
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
};

const maxReadableFileChars = 24_000;
const maxUploadFiles = 6;

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

  const [messages, setMessages] = useState<ChatMessage[]>([]);
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

  useEffect(() => {
    if (!modelId && defaultModelId) setModelId(defaultModelId);
  }, [defaultModelId, modelId]);

  useEffect(() => {
    if (!agentId && defaultAgentId) setAgentId(defaultAgentId);
  }, [agentId, defaultAgentId]);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight });
  }, [messages]);

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

    setMessages((current) => [...current, userMessage, assistantMessage]);
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
          onEvent: (event) => applyChatEvent(assistantId, event, setMessages)
        }
      );
    } catch (streamError) {
      const message = streamError instanceof Error ? streamError.message : copy.sendFailed;
      setError(message);
      setMessages((current) =>
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
              <div className="chat-control-group">
                <span className="chat-control-label">{copy.harness}</span>
                <div className="chat-harness-options">
                  {[
                    { id: "openclaw" as const, label: "OpenClaw", disabled: false },
                    { id: "codex" as const, label: "Codex", disabled: true },
                    { id: "claudeCode" as const, label: "Claude Code", disabled: true }
                  ].map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={`chat-harness-option ${harnessId === item.id ? "selected" : ""}`}
                      disabled={item.disabled}
                      onClick={() => setHarnessId(item.id)}
                    >
                      <Bot size={15} />
                      <span>{item.label}</span>
                      {item.disabled && <small>{copy.soon}</small>}
                    </button>
                  ))}
                </div>
              </div>

              <label className="chat-control-field">
                <span>
                  <Bot size={14} />
                  {copy.agent}
                </span>
                <select value={agentId} onChange={(event) => setAgentId(event.target.value)}>
                  {agentOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="chat-control-field">
                <span>
                  <Sparkles size={14} />
                  {copy.model}
                </span>
                <select value={modelId} onChange={(event) => setModelId(event.target.value)}>
                  {modelOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.meta ? `${option.label} - ${option.meta}` : option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="chat-control-field">
                <span>
                  <Brain size={14} />
                  {copy.thinking}
                </span>
                <select value={thinkingEffort} onChange={(event) => setThinkingEffort(event.target.value as ChatThinkingEffort)}>
                  <option value="low">{copy.thinkingLow}</option>
                  <option value="medium">{copy.thinkingMedium}</option>
                  <option value="high">{copy.thinkingHigh}</option>
                  <option value="xhigh">{copy.thinkingXHigh}</option>
                </select>
              </label>

              <div className="chat-control-group">
                <span className="chat-control-label">{copy.mode}</span>
                <div className="chat-mode-options">
                  {[
                    { id: "chat" as const, label: copy.modeChat, icon: MessageSquareText },
                    { id: "build_blueprint" as const, label: copy.modeBlueprint, icon: Settings2 },
                    { id: "drawing" as const, label: copy.modeDrawing, icon: ImageIcon }
                  ].map((item) => {
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        className={mode === item.id ? "selected" : ""}
                        onClick={() => setMode(item.id)}
                      >
                        <Icon size={15} />
                        {item.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <label className="chat-toggle-field">
                <input
                  type="checkbox"
                  checked={showToolCalls}
                  onChange={(event) => setShowToolCalls(event.target.checked)}
                />
                <span>
                  <Wrench size={14} />
                  {copy.showTools}
                </span>
              </label>
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
                <article key={message.id} className={`chat-message chat-message-${message.role} ${message.status ?? ""}`}>
                  <div className="chat-message-meta">
                    <strong>{message.role === "user" ? copy.you : copy.assistant}</strong>
                    {message.status === "streaming" && <span>{copy.streaming}</span>}
                    {message.status === "failed" && <span>{copy.failed}</span>}
                  </div>
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
                  {showToolCalls && message.runtimeRef && <RuntimeRefBlock runtimeRef={message.runtimeRef} copy={copy} />}
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

function RuntimeRefBlock({ runtimeRef, copy }: { runtimeRef: ChatRuntimeRef; copy: ReturnType<typeof chatCopy> }) {
  return (
    <div className="chat-runtime-ref">
      <span>{copy.runtime}</span>
      <code>taskId={runtimeRef.taskId}</code>
      <code>runId={runtimeRef.runId}</code>
      <code>sessionKey={runtimeRef.sessionKey}</code>
      {runtimeRef.usage && (
        <code>
          {runtimeRef.usage.modelId} / {runtimeRef.usage.inputTokens + runtimeRef.usage.outputTokens} tokens
        </code>
      )}
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

function formatBytes(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)} MB`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)} KB`;
  return `${value} B`;
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
      showTools: "\u663e\u793a\u5de5\u5177\u8c03\u7528\u548c\u8fd0\u884c\u5f15\u7528",
      emptyTitle: "\u65b0\u5bf9\u8bdd",
      emptyBody: "\u9009\u62e9 Agent\u3001\u6a21\u578b\u548c\u6a21\u5f0f\uff0c\u7136\u540e\u76f4\u63a5\u53d1\u9001\u3002",
      you: "\u4f60",
      assistant: "OpenClaw",
      streaming: "\u8f93\u51fa\u4e2d",
      failed: "\u5931\u8d25",
      waiting: "\u7b49\u5f85 OpenClaw \u8fd4\u56de...",
      runtime: "\u8fd0\u884c\u5f15\u7528",
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
    showTools: "Show tool calls and runtime refs",
    emptyTitle: "New conversation",
    emptyBody: "Choose an agent, model, and mode, then send a message.",
    you: "You",
    assistant: "OpenClaw",
    streaming: "Streaming",
    failed: "Failed",
    waiting: "Waiting for OpenClaw...",
    runtime: "Runtime refs",
    attachmentOnlyMessage: "Uploaded files",
    removeAttachment: "Remove attachment",
    upload: "Upload files",
    placeholder: "Type a message, Shift+Enter for a new line...",
    send: "Send",
    sendFailed: "Failed to send message."
  };
}
