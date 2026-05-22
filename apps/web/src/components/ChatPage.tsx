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
  ChatStreamEvent,
  ChatThinkingEffort,
  HarnessId,
  HarnessStatus,
  OpenClawConfigState,
  RuntimeOverview
} from "@hiveward/shared";
import type { Language } from "../lib/i18n";
import { api } from "../lib/api";
import { MarkdownRenderer } from "./MarkdownRenderer";

type ChatMessage = ChatHistoryMessage & {
  status?: "sent" | "streaming" | "failed";
  runtimeRef?: ChatRuntimeRef;
  speakerLabel?: string;
  harnessId?: HarnessId;
  agentId?: string;
  modelId?: string;
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
  thinkingLevels?: ChatThinkingEffort[];
};

type HivewardSessionView = {
  id: string;
  title: string;
  harnessId: HarnessId;
  nativeSessionId?: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
};

const maxReadableFileChars = 24_000;
const maxUploadFiles = 6;
const sessionViewsStorageKey = "hiveward.chat.sessionViews.v2";
const activeSessionViewStorageKey = "hiveward.chat.activeSessionView.v1";
const legacySessionViewsStorageKey = "hiveward.chat.sessionViews.v1";
const legacyChatSessionsStorageKey = "hiveward.chat.sessions.v1";
const legacyChatActiveSessionStorageKey = "hiveward.chat.activeSession.v1";
const newSessionViewOptionValue = "__new_session_view__";
const nativeSessionOptionPrefix = "__native_openclaw_session__:";

export function ChatPage({
  catalog,
  openClawConfig,
  harnessStatuses,
  runtime,
  language
}: {
  catalog?: CatalogSnapshot;
  openClawConfig?: OpenClawConfigState;
  harnessStatuses: HarnessStatus[];
  runtime?: RuntimeOverview;
  language: Language;
}) {
  const copy = chatCopy(language);
  const openClawStatus = harnessStatuses.find((status) => status.id === "openclaw");
  const modelOptions = useMemo(() => buildModelOptions(catalog, openClawConfig), [catalog, openClawConfig]);
  const agentOptions = useMemo(() => buildAgentOptions(catalog, openClawConfig), [catalog, openClawConfig]);
  const defaultModelId = openClawConfig?.defaultModelId ?? modelOptions[0]?.value ?? "";
  const defaultAgentId =
    openClawConfig?.configuredAgents.find((agent) => agent.isDefault)?.id ?? agentOptions[0]?.value ?? "main";

  const [sessionViews, setSessionViews] = useState<HivewardSessionView[]>(() => loadSessionViews(copy));
  const [activeSessionViewId, setActiveSessionViewId] = useState(() => loadActiveSessionViewId());
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [harnessId, setHarnessId] = useState<HarnessId>("openclaw");
  const [modelId, setModelId] = useState(defaultModelId);
  const [agentId, setAgentId] = useState(defaultAgentId);
  const [thinkingEffort, setThinkingEffort] = useState<ChatThinkingEffort>("medium");
  const [settingsCollapsed, setSettingsCollapsed] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [historyLoadingSessionKey, setHistoryLoadingSessionKey] = useState<string | undefined>();
  const threadRef = useRef<HTMLDivElement | null>(null);
  const loadedNativeHistoryRef = useRef(new Set<string>());
  const activeSessionView = sessionViews.find((sessionView) => sessionView.id === activeSessionViewId) ?? sessionViews[0];
  const messages = activeSessionView?.messages ?? [];
  const runtimeSessions = runtime?.sessions ?? [];
  const selectedHarnessStatus = harnessStatuses.find((status) => status.id === harnessId);
  const selectedHarnessLabel = formatHarnessLabel(harnessId);
  const selectedModelOption = modelOptions.find((option) => option.value === modelId);
  const selectedModelLabel = selectedModelOption?.label ?? modelId;
  const selectedHarnessAvailable =
    harnessId === "openclaw" &&
    (!selectedHarnessStatus ||
      selectedHarnessStatus.connectionState === "connected" ||
      selectedHarnessStatus.connectionState === "available");

  const updateActiveSessionView = useCallback(
    (update: (sessionView: HivewardSessionView) => HivewardSessionView) => {
      setSessionViews((current) =>
        current.map((sessionView) => (sessionView.id === activeSessionView?.id ? update(sessionView) : sessionView))
      );
    },
    [activeSessionView?.id]
  );

  const updateActiveSessionViewMessages = useCallback<Dispatch<SetStateAction<ChatMessage[]>>>(
    (nextMessagesAction) => {
      updateActiveSessionView((sessionView) => {
        const nextMessages =
          typeof nextMessagesAction === "function"
            ? nextMessagesAction(sessionView.messages)
            : nextMessagesAction;
        return {
          ...sessionView,
          title: deriveSessionViewTitle(sessionView, nextMessages, copy),
          messages: nextMessages,
          updatedAt: new Date().toISOString()
        };
      });
    },
    [copy, updateActiveSessionView]
  );

  const bindActiveSessionView = useCallback(
    (event: Extract<ChatStreamEvent, { type: "started" | "done" }>) => {
      updateActiveSessionView((sessionView) => ({
        ...sessionView,
        harnessId,
        nativeSessionId: event.sessionKey,
        updatedAt: event.updatedAt
      }));
    },
    [harnessId, updateActiveSessionView]
  );

  const createSessionView = useCallback(async () => {
    if (harnessId === "openclaw") {
      try {
        const nativeSession = await api.createChatSession({
          agentId: agentId || undefined,
          parentSessionKey: activeSessionView?.nativeSessionId
        });
        const nextSessionView = createHivewardSessionView(
          copy,
          harnessId,
          nativeSession.sessionKey,
          nativeSession.title || nativeSession.sessionKey
        );
        setSessionViews((current) => [nextSessionView, ...current]);
        setActiveSessionViewId(nextSessionView.id);
        loadedNativeHistoryRef.current.add(nativeSession.sessionKey);
        setDraft("");
        setAttachments([]);
        setError(undefined);
        return;
      } catch (sessionError) {
        setError(sessionError instanceof Error ? sessionError.message : copy.sessionCreateFailed);
        return;
      }
    }

    const nextSessionView = createHivewardSessionView(copy, harnessId);
    setSessionViews((current) => [nextSessionView, ...current]);
    setActiveSessionViewId(nextSessionView.id);
    setDraft("");
    setAttachments([]);
    setError(undefined);
  }, [activeSessionView?.nativeSessionId, agentId, copy, harnessId]);

  const loadNativeSessionHistory = useCallback(
    async (sessionViewId: string, sessionKey: string, force = false) => {
      if (!force && loadedNativeHistoryRef.current.has(sessionKey)) return;
      loadedNativeHistoryRef.current.add(sessionKey);
      setHistoryLoadingSessionKey(sessionKey);
      try {
        const nativeMessages = await api.getChatSessionHistory(sessionKey);
        setSessionViews((current) =>
          current.map((sessionView) =>
            sessionView.id === sessionViewId
              ? {
                  ...sessionView,
                  messages: nativeMessages.map((message) => decorateNativeHistoryMessage(message, copy)),
                  updatedAt: new Date().toISOString()
                }
              : sessionView
          )
        );
      } catch (historyError) {
        setError(historyError instanceof Error ? historyError.message : copy.historyLoadFailed);
      } finally {
        setHistoryLoadingSessionKey((current) => (current === sessionKey ? undefined : current));
      }
    },
    [copy]
  );

  const activateNativeSession = useCallback(
    (sessionKey: string) => {
      const nativeSession = runtimeSessions.find((session) => session.id === sessionKey);
      const now = new Date().toISOString();
      const sessionViewId = makeNativeSessionViewId(sessionKey);
      setSessionViews((current) => {
        const existing = current.find((sessionView) => sessionView.id === sessionViewId);
        if (existing) return current;
        return [
          {
            id: sessionViewId,
            title: nativeSession ? formatNativeSessionLabel(nativeSession) : sessionKey,
            harnessId: "openclaw",
            nativeSessionId: sessionKey,
            messages: [],
            createdAt: nativeSession?.updatedAt ?? now,
            updatedAt: nativeSession?.updatedAt ?? now
          },
          ...current
        ];
      });
      setActiveSessionViewId(sessionViewId);
      setHarnessId("openclaw");
      setAgentId(readAgentIdFromSessionKey(sessionKey) ?? defaultAgentId);
      setDraft("");
      setAttachments([]);
      setError(undefined);
      void loadNativeSessionHistory(sessionViewId, sessionKey, true);
    },
    [defaultAgentId, loadNativeSessionHistory, runtimeSessions]
  );

  useEffect(() => {
    if (!modelId && defaultModelId) setModelId(defaultModelId);
  }, [defaultModelId, modelId]);

  useEffect(() => {
    if (!agentId && defaultAgentId) setAgentId(defaultAgentId);
  }, [agentId, defaultAgentId]);

  useEffect(() => {
    if (activeSessionView) return;
    const nextSessionView = createHivewardSessionView(copy, harnessId, harnessId === "openclaw" ? "main" : undefined, "main");
    setSessionViews([nextSessionView]);
    setActiveSessionViewId(nextSessionView.id);
  }, [activeSessionView, copy, harnessId]);

  useEffect(() => {
    persistSessionViews(sessionViews, activeSessionView?.id);
  }, [activeSessionView?.id, sessionViews]);

  useEffect(() => {
    if (!activeSessionView?.nativeSessionId || activeSessionView.messages.length > 0) return;
    void loadNativeSessionHistory(activeSessionView.id, activeSessionView.nativeSessionId);
  }, [activeSessionView?.id, activeSessionView?.messages.length, activeSessionView?.nativeSessionId, loadNativeSessionHistory]);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight });
  }, [messages]);

  const sessionViewOptions = useMemo<SelectOption[]>(
    () => {
      const knownNativeSessionIds = new Set(sessionViews.flatMap((sessionView) => sessionView.nativeSessionId ? [sessionView.nativeSessionId] : []));
        return [
          {
            value: newSessionViewOptionValue,
            label: copy.newSessionView,
            meta: copy.newSessionViewMeta,
            variant: "create"
          },
        ...sessionViews
          .filter((sessionView) => isVisibleSessionView(sessionView, agentId))
          .map((sessionView) => ({
            value: sessionView.id,
            label: sessionView.title,
            meta: formatSessionViewMeta(sessionView, copy)
          })),
        ...runtimeSessions
          .filter((session) => isVisibleNativeChatSessionKey(session.id, agentId))
          .filter((session) => !knownNativeSessionIds.has(session.id))
          .map((session) => ({
            value: `${nativeSessionOptionPrefix}${session.id}`,
            label: formatNativeSessionLabel(session),
            meta: copy.nativeHistoryMeta
          }))
      ];
    },
    [agentId, copy, runtimeSessions, sessionViews]
  );
  const harnessOptions = useMemo<SelectOption[]>(
    () => [
      {
        value: "openclaw",
        label: "OpenClaw",
        meta: formatHarnessStatusMeta(openClawStatus, copy),
        disabled: openClawStatus?.connectionState === "needs_config" || openClawStatus?.connectionState === "unavailable"
      },
      { value: "codex", label: "Codex", meta: copy.soon, disabled: true },
      { value: "claudeCode", label: "Claude Code", meta: copy.soon, disabled: true }
    ],
    [copy, openClawStatus]
  );
  const thinkingOptions = useMemo<SelectOption[]>(
    () => buildThinkingOptions(selectedModelOption?.thinkingLevels, copy),
    [copy, selectedModelOption?.thinkingLevels]
  );
  const thinkingOptionLevels = useMemo(
    () => thinkingOptions.map((option) => option.value as ChatThinkingEffort),
    [thinkingOptions]
  );
  const effectiveThinkingEffort = useMemo(
    () => resolveSupportedThinkingEffort(thinkingOptionLevels, thinkingEffort),
    [thinkingEffort, thinkingOptionLevels]
  );

  useEffect(() => {
    if (effectiveThinkingEffort !== thinkingEffort) {
      setThinkingEffort(effectiveThinkingEffort);
    }
  }, [effectiveThinkingEffort, thinkingEffort]);

  const selectSessionView = useCallback(
    (sessionViewId: string) => {
      if (sessionViewId === newSessionViewOptionValue) {
        void createSessionView();
        return;
      }
      const nativeSessionKey = readNativeSessionOptionValue(sessionViewId);
      if (nativeSessionKey) {
        activateNativeSession(nativeSessionKey);
        return;
      }
      const nextSessionView = sessionViews.find((sessionView) => sessionView.id === sessionViewId);
      setActiveSessionViewId(sessionViewId);
      if (nextSessionView) setHarnessId(nextSessionView.harnessId);
      if (nextSessionView?.nativeSessionId) {
        setAgentId(readAgentIdFromSessionKey(nextSessionView.nativeSessionId) ?? defaultAgentId);
      }
      if (nextSessionView?.nativeSessionId) {
        void loadNativeSessionHistory(nextSessionView.id, nextSessionView.nativeSessionId, true);
      }
      setDraft("");
      setAttachments([]);
      setError(undefined);
    },
    [activateNativeSession, createSessionView, defaultAgentId, loadNativeSessionHistory, sessionViews]
  );

  const selectHarness = useCallback(
    (nextHarnessId: HarnessId) => {
      setHarnessId(nextHarnessId);
      updateActiveSessionView((sessionView) => ({
        ...sessionView,
        harnessId: nextHarnessId,
        nativeSessionId: sessionView.harnessId === nextHarnessId ? sessionView.nativeSessionId : undefined,
        updatedAt: new Date().toISOString()
      }));
    },
    [updateActiveSessionView]
  );

  const selectAgent = useCallback(
    async (nextAgentId: string) => {
      setAgentId(nextAgentId);
      if (harnessId !== "openclaw" || nextAgentId === agentId) return;
      try {
        const nativeSession = await api.createChatSession({
          agentId: nextAgentId || undefined,
          parentSessionKey: activeSessionView?.nativeSessionId
        });
        const nextSessionView = createHivewardSessionView(
          copy,
          "openclaw",
          nativeSession.sessionKey,
          nativeSession.title || nativeSession.sessionKey
        );
        setSessionViews((current) => [nextSessionView, ...current]);
        setActiveSessionViewId(nextSessionView.id);
        loadedNativeHistoryRef.current.add(nativeSession.sessionKey);
        setDraft("");
        setAttachments([]);
        setError(undefined);
      } catch (sessionError) {
        setError(sessionError instanceof Error ? sessionError.message : copy.sessionCreateFailed);
      }
    },
    [activeSessionView?.nativeSessionId, agentId, copy, harnessId]
  );

  const canSend =
    !isSending &&
    selectedHarnessAvailable &&
    (draft.trim().length > 0 || attachments.length > 0) &&
    Boolean(activeSessionView);

  const sendMessage = async () => {
    if (!canSend) return;

    const content = draft.trim();
    const outgoingAttachments = attachments;
    const includePlatformContext = messages.length === 0;
    const now = new Date().toISOString();
    const userMessage: ChatMessage = {
      id: makeLocalId("chat-user"),
      role: "user",
      content: content || copy.attachmentOnlyMessage,
      createdAt: now,
      attachments: outgoingAttachments,
      status: "sent",
      speakerLabel: copy.you,
      harnessId
    };
    const assistantId = makeLocalId("chat-assistant");
    const assistantMessage: ChatMessage = {
      id: assistantId,
      role: "assistant",
      content: "",
      createdAt: now,
      status: "streaming",
      speakerLabel: formatHarnessSpeaker(harnessId, agentId),
      harnessId,
      agentId,
      modelId
    };

    updateActiveSessionViewMessages((current) => [...current, userMessage, assistantMessage]);
    setDraft("");
    setAttachments([]);
    setError(undefined);
    setIsSending(true);

    try {
      let nativeSessionKey = activeSessionView?.nativeSessionId;
      if (harnessId === "openclaw" && !nativeSessionKey) {
        const nativeSession = await api.createChatSession({ agentId: agentId || undefined });
        nativeSessionKey = nativeSession.sessionKey;
        loadedNativeHistoryRef.current.add(nativeSession.sessionKey);
        updateActiveSessionView((sessionView) => ({
          ...sessionView,
          nativeSessionId: nativeSession.sessionKey,
          title: sessionView.title === copy.newSessionViewTitle
            ? nativeSession.title || sessionView.title
            : sessionView.title,
          updatedAt: new Date().toISOString()
        }));
      }

      await api.streamChat(
        {
          harnessId,
          message: content,
          attachments: outgoingAttachments,
          modelId: modelId || undefined,
          agentId: agentId || undefined,
          nativeSessionKey,
          thinkingEffort: effectiveThinkingEffort,
          includePlatformContext
        },
        {
          onEvent: (event) => {
            applyChatEvent(assistantId, event, updateActiveSessionViewMessages);
            if (event.type === "started" || event.type === "done") bindActiveSessionView(event);
          }
        }
      );
    } catch (streamError) {
      const message = streamError instanceof Error ? streamError.message : copy.sendFailed;
      setError(message);
      updateActiveSessionViewMessages((current) =>
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
          {selectedHarnessLabel}
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
                label={copy.sessionView}
                icon={<MessageSquareText size={14} />}
                value={activeSessionView?.id ?? ""}
                options={sessionViewOptions}
                onChange={selectSessionView}
              />

              <ChatSelect
                label={copy.harness}
                icon={<Bot size={14} />}
                value={harnessId}
                options={harnessOptions}
                onChange={(value) => selectHarness(value as HarnessId)}
              />

              <ChatSelect
                label={copy.agent}
                icon={<Bot size={14} />}
                value={agentId}
                options={agentOptions}
                onChange={(value) => void selectAgent(value)}
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
                value={effectiveThinkingEffort}
                options={thinkingOptions}
                onChange={(value) => setThinkingEffort(value as ChatThinkingEffort)}
              />

            </div>
          )}
        </aside>

        <section className="content-card chat-window-card" aria-label={copy.title}>
          <div className="chat-window-header">
            <div className="chat-session-view-heading">
              <span>{copy.sessionView}</span>
              <strong>{activeSessionView?.title ?? copy.newSessionViewTitle}</strong>
            </div>
            <div className="chat-context-strip" aria-label={copy.contextSummary}>
              <span>
                <Bot size={13} />
                {selectedHarnessLabel}
              </span>
              <span>{agentId || copy.noAgent}</span>
              <span>{selectedModelLabel || copy.noModel}</span>
              <span className={activeSessionView?.nativeSessionId ? "bound" : "draft"}>
                {historyLoadingSessionKey === activeSessionView?.nativeSessionId
                  ? copy.historyLoading
                  : activeSessionView?.nativeSessionId
                    ? copy.nativeSessionBound
                    : copy.nativeSessionDraft}
              </span>
            </div>
          </div>
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
                    <div className="chat-message-speaker">
                      <strong>{getMessageSpeakerLabel(message, copy)}</strong>
                      {message.role === "assistant" && message.modelId ? <span>{message.modelId}</span> : null}
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
                    {message.status === "failed" && <span className="chat-message-status">{copy.failed}</span>}
                    {message.runtimeRef && <RuntimeRefBlock runtimeRef={message.runtimeRef} copy={copy} />}
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
                placeholder={copy.placeholder(selectedHarnessLabel)}
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
  const totalTokens = runtimeRef.usage
    ? runtimeRef.usage.inputTokens + runtimeRef.usage.outputTokens
    : undefined;

  return (
    <div className="chat-runtime-ref" aria-label={copy.usageSummary}>
      <span className={`chat-runtime-pill ${runtimeRef.error ? "error" : ""}`}>
        <Bot size={13} />
        <span>{formatHarnessLabel(runtimeRef.source)}</span>
        <strong>{formatRuntimeStatusLabel(runtimeRef.status, copy)}</strong>
      </span>
      {runtimeRef.error && (
        <span className="chat-runtime-pill error">
          <Wrench size={13} />
          <span>{copy.runtimeError}</span>
          <strong>{runtimeRef.error}</strong>
        </span>
      )}
      {runtimeRef.usage && (
      <span className="chat-runtime-pill">
        <Sparkles size={13} />
        <span>{copy.usageModel}</span>
        <strong>{runtimeRef.usage.modelId}</strong>
      </span>
      )}
      {totalTokens !== undefined && (
      <span className="chat-runtime-pill">
        <Brain size={13} />
        <span>{copy.usageTokens}</span>
        <strong>
          {formatTokenCount(totalTokens)} {copy.tokensUnit}
        </strong>
      </span>
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
        message.id === assistantId
          ? { ...message, content: event.replace ? event.text : `${message.content}${event.text}` }
          : message
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

function decorateNativeHistoryMessage(message: ChatHistoryMessage, copy: ReturnType<typeof chatCopy>): ChatMessage {
  return {
    ...message,
    status: "sent",
    harnessId: "openclaw",
    speakerLabel: message.role === "user" ? copy.you : "OpenClaw"
  };
}

function makeNativeSessionViewId(sessionKey: string): string {
  return `openclaw-session-view:${sessionKey}`;
}

function readNativeSessionOptionValue(value: string): string | undefined {
  return value.startsWith(nativeSessionOptionPrefix) ? value.slice(nativeSessionOptionPrefix.length) : undefined;
}

function readAgentIdFromSessionKey(sessionKey: string): string | undefined {
  if (sessionKey === "main") return "main";
  const match = /^agent:([^:]+):/.exec(sessionKey);
  return match?.[1];
}

function isVisibleSessionView(sessionView: HivewardSessionView, agentId: string): boolean {
  if (!sessionView.nativeSessionId) return true;
  return isVisibleNativeChatSessionKey(sessionView.nativeSessionId, agentId);
}

function isVisibleNativeChatSessionKey(sessionKey: string, agentId: string): boolean {
  const selectedAgentId = normalizeSessionAgentId(agentId);
  if (sessionKey === "main") return selectedAgentId === "main";
  const parsed = parseAgentSessionKey(sessionKey);
  if (!parsed) return false;
  if (normalizeSessionAgentId(parsed.agentId) !== selectedAgentId) return false;
  return isPrimaryChatSessionRest(parsed.rest);
}

function isPersistableNativeChatSessionKey(sessionKey: string): boolean {
  if (sessionKey === "main") return true;
  const parsed = parseAgentSessionKey(sessionKey);
  return parsed ? isPrimaryChatSessionRest(parsed.rest) : false;
}

function parseAgentSessionKey(sessionKey: string): { agentId: string; rest: string } | undefined {
  const match = /^agent:([^:]+):(.+)$/.exec(sessionKey);
  return match ? { agentId: match[1]!, rest: match[2]! } : undefined;
}

function isPrimaryChatSessionRest(rest: string): boolean {
  return rest === "main" || rest.startsWith("dashboard:");
}

function normalizeSessionAgentId(agentId: string | undefined): string {
  return (agentId || "main").trim().toLowerCase() || "main";
}

function formatNativeSessionLabel(session: { id: string; title: string }): string {
  const parsed = parseAgentSessionKey(session.id);
  if (parsed) return parsed.rest;
  return session.title || session.id;
}

function buildModelOptions(catalog?: CatalogSnapshot, openClawConfig?: OpenClawConfigState): SelectOption[] {
  const catalogModelsById = new Map((catalog?.models ?? []).map((model) => [model.id, model]));
  const options = [
    ...(openClawConfig?.configuredModels.map((model) => ({
      value: model.id,
      label: model.label || model.id,
      meta: model.provider,
      thinkingLevels: model.thinkingLevels ?? catalogModelsById.get(model.id)?.thinkingLevels
    })) ?? []),
    ...(catalog?.models.map((model) => ({
      value: model.id,
      label: model.label || model.id,
      meta: model.provider,
      thinkingLevels: model.thinkingLevels
    })) ?? [])
  ];
  const defaultModel = openClawConfig?.defaultModelId ? catalogModelsById.get(openClawConfig.defaultModelId) : undefined;
  return mergeOptions(
    options,
    openClawConfig?.defaultModelId
      ? [{
          value: openClawConfig.defaultModelId,
          label: defaultModel?.label ?? openClawConfig.defaultModelId,
          meta: defaultModel?.provider,
          thinkingLevels: defaultModel?.thinkingLevels
        }]
      : []
  );
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
  const merged: SelectOption[] = [];
  const indexesByValue = new Map<string, number>();
  for (const option of [...primary, ...fallbacks]) {
    if (!option.value) continue;
    const existingIndex = indexesByValue.get(option.value);
    if (existingIndex === undefined) {
      indexesByValue.set(option.value, merged.length);
      merged.push(option);
      continue;
    }
    const existing = merged[existingIndex]!;
    merged[existingIndex] = {
      ...existing,
      meta: existing.meta ?? option.meta,
      thinkingLevels: existing.thinkingLevels ?? option.thinkingLevels
    };
  }
  return merged;
}

const fallbackThinkingLevels: ChatThinkingEffort[] = ["off", "minimal", "low", "medium", "high"];
const thinkingEffortRank: Record<ChatThinkingEffort, number> = {
  off: 0,
  minimal: 10,
  low: 20,
  medium: 30,
  high: 40,
  adaptive: 50,
  xhigh: 60,
  max: 70
};

function buildThinkingOptions(
  thinkingLevels: ChatThinkingEffort[] | undefined,
  copy: ReturnType<typeof chatCopy>
): SelectOption[] {
  return normalizeThinkingLevels(thinkingLevels).map((level) => ({
    value: level,
    label: formatThinkingEffortLabel(level, copy)
  }));
}

function normalizeThinkingLevels(thinkingLevels: ChatThinkingEffort[] | undefined): ChatThinkingEffort[] {
  const levels = thinkingLevels?.length ? thinkingLevels : fallbackThinkingLevels;
  return [...new Set(levels)].sort((left, right) => thinkingEffortRank[left] - thinkingEffortRank[right]);
}

function resolveSupportedThinkingEffort(
  availableLevels: ChatThinkingEffort[],
  requestedLevel: ChatThinkingEffort
): ChatThinkingEffort {
  const levels = normalizeThinkingLevels(availableLevels);
  if (levels.includes(requestedLevel)) return requestedLevel;
  const requestedRank = thinkingEffortRank[requestedLevel];
  const rankedDescending = [...levels].sort((left, right) => thinkingEffortRank[right] - thinkingEffortRank[left]);
  return rankedDescending.find((level) => level !== "off" && thinkingEffortRank[level] <= requestedRank)
    ?? rankedDescending.find((level) => level !== "off")
    ?? "off";
}

function formatThinkingEffortLabel(level: ChatThinkingEffort, copy: ReturnType<typeof chatCopy>): string {
  if (level === "off") return copy.thinkingOff;
  if (level === "minimal") return copy.thinkingMinimal;
  if (level === "low") return copy.thinkingLow;
  if (level === "medium") return copy.thinkingMedium;
  if (level === "high") return copy.thinkingHigh;
  if (level === "adaptive") return copy.thinkingAdaptive;
  if (level === "max") return copy.thinkingMax;
  return copy.thinkingXHigh;
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

function createHivewardSessionView(
  copy: ReturnType<typeof chatCopy>,
  harnessId: HarnessId,
  nativeSessionId?: string,
  title?: string
): HivewardSessionView {
  const now = new Date().toISOString();
  return {
    id: makeLocalId("hiveward-session-view"),
    title: title || copy.newSessionViewTitle,
    harnessId,
    nativeSessionId,
    messages: [],
    createdAt: now,
    updatedAt: now
  };
}

function loadSessionViews(copy: ReturnType<typeof chatCopy>): HivewardSessionView[] {
  if (typeof window === "undefined") return [createHivewardSessionView(copy, "openclaw", "main", "main")];
  try {
    const raw =
      window.localStorage.getItem(sessionViewsStorageKey) ??
      window.localStorage.getItem(legacySessionViewsStorageKey) ??
      window.localStorage.getItem(legacyChatSessionsStorageKey);
    if (!raw) return [createHivewardSessionView(copy, "openclaw", "main", "main")];
    const parsed = JSON.parse(raw) as Array<Partial<HivewardSessionView>>;
    const sessionViews = parsed.flatMap((sessionView) => normalizeSessionView(sessionView, copy));
    return sessionViews.length > 0 ? sessionViews : [createHivewardSessionView(copy, "openclaw", "main", "main")];
  } catch {
    return [createHivewardSessionView(copy, "openclaw", "main", "main")];
  }
}

function loadActiveSessionViewId(): string | undefined {
  if (typeof window === "undefined") return undefined;
  return window.localStorage.getItem(activeSessionViewStorageKey) ?? window.localStorage.getItem(legacyChatActiveSessionStorageKey) ?? undefined;
}

function persistSessionViews(sessionViews: HivewardSessionView[], activeSessionViewId?: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(sessionViewsStorageKey, JSON.stringify(sessionViews.map(toPersistedSessionView)));
    if (activeSessionViewId) {
      window.localStorage.setItem(activeSessionViewStorageKey, activeSessionViewId);
    }
  } catch {
    // Session view persistence should not block chat if browser storage is unavailable.
  }
}

function normalizeSessionView(sessionView: Partial<HivewardSessionView>, copy: ReturnType<typeof chatCopy>): HivewardSessionView[] {
  if (!sessionView.id) return [];
  const harnessId = sessionView.harnessId === "codex" || sessionView.harnessId === "claudeCode"
    ? sessionView.harnessId
    : "openclaw";
  const nativeSessionId = typeof sessionView.nativeSessionId === "string" ? sessionView.nativeSessionId : undefined;
  if (nativeSessionId && !isPersistableNativeChatSessionKey(nativeSessionId)) return [];
  return [{
    id: sessionView.id,
    title: sessionView.title || copy.newSessionViewTitle,
    harnessId,
    nativeSessionId,
    messages: [],
    createdAt: sessionView.createdAt || new Date().toISOString(),
    updatedAt: sessionView.updatedAt || sessionView.createdAt || new Date().toISOString()
  }];
}

function toPersistedSessionView(sessionView: HivewardSessionView): Omit<HivewardSessionView, "messages"> {
  return {
    id: sessionView.id,
    title: sessionView.title,
    harnessId: sessionView.harnessId,
    nativeSessionId: sessionView.nativeSessionId,
    createdAt: sessionView.createdAt,
    updatedAt: sessionView.updatedAt
  };
}

function deriveSessionViewTitle(sessionView: HivewardSessionView, messages: ChatMessage[], copy: ReturnType<typeof chatCopy>): string {
  if (sessionView.messages.length > 0 && sessionView.title !== copy.newSessionViewTitle) return sessionView.title;
  const firstUserMessage = messages.find((message) => message.role === "user")?.content.trim();
  if (!firstUserMessage) return sessionView.title || copy.newSessionViewTitle;
  return firstUserMessage.length > 24 ? `${firstUserMessage.slice(0, 24)}...` : firstUserMessage;
}

function formatSessionViewMeta(sessionView: HivewardSessionView, copy: ReturnType<typeof chatCopy>): string {
  const binding = sessionView.nativeSessionId ? copy.nativeSessionBound : copy.nativeSessionDraft;
  if (sessionView.messages.length === 0) return `${formatHarnessLabel(sessionView.harnessId)} / ${binding}`;
  return `${formatHarnessLabel(sessionView.harnessId)} / ${binding} / ${sessionView.messages.length} ${copy.messagesUnit}`;
}

function getMessageSpeakerLabel(message: ChatMessage, copy: ReturnType<typeof chatCopy>): string {
  if (message.speakerLabel) return message.speakerLabel;
  if (message.role === "user") return copy.you;
  return formatHarnessSpeaker(message.harnessId ?? "openclaw", message.agentId);
}

function formatHarnessSpeaker(harnessId: string, agentId?: string): string {
  const harnessLabel = formatHarnessLabel(harnessId);
  return agentId ? `${harnessLabel} / ${agentId}` : harnessLabel;
}

function formatHarnessLabel(harnessId: string): string {
  if (harnessId === "codex") return "Codex";
  if (harnessId === "claudeCode" || harnessId === "claude") return "Claude Code";
  return "OpenClaw";
}

function formatHarnessStatusMeta(status: HarnessStatus | undefined, copy: ReturnType<typeof chatCopy>): string {
  if (!status) return copy.harnessUnknown;
  if (status.connectionState === "connected") return copy.harnessConnected;
  if (status.connectionState === "available") return copy.harnessAvailable;
  if (status.connectionState === "needs_config") return copy.harnessNeedsConfig;
  return copy.harnessUnavailable;
}

function formatRuntimeStatusLabel(status: string, copy: ReturnType<typeof chatCopy>): string {
  if (status === "succeeded") return copy.runtimeSucceeded;
  if (status === "failed") return copy.runtimeFailed;
  if (status === "cancelled") return copy.runtimeCancelled;
  if (status === "queued") return copy.runtimeQueued;
  return copy.runtimeRunning;
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
      title: "\u8fd0\u884c\u65b9\u4f1a\u8bdd\u63a7\u5236\u53f0",
      settings: "\u8fd0\u884c\u65b9\u63a7\u5236",
      collapseSettings: "\u6536\u8d77",
      expandSettings: "\u5c55\u5f00",
      sessionView: "\u804a\u5929\u4f1a\u8bdd",
      newSessionView: "\u65b0\u4f1a\u8bdd",
      newSessionViewMeta: "\u7531 OpenClaw \u521b\u5efa\u539f\u751f\u4f1a\u8bdd",
      newSessionViewTitle: "\u65b0\u804a\u5929",
      messagesUnit: "\u6761\u6d88\u606f",
      nativeSessionBound: "\u5df2\u7ed1\u5b9a\u539f\u751f\u4f1a\u8bdd",
      nativeSessionDraft: "\u8349\u7a3f\u89c6\u56fe",
      nativeHistoryMeta: "OpenClaw \u539f\u751f\u5386\u53f2",
      historyLoading: "\u6b63\u5728\u8bfb\u53d6\u539f\u751f\u5386\u53f2",
      historyLoadFailed: "\u8bfb\u53d6\u539f\u751f\u5386\u53f2\u5931\u8d25\u3002",
      sessionCreateFailed: "\u65b0\u5efa OpenClaw \u4f1a\u8bdd\u5931\u8d25\u3002",
      contextSummary: "\u4e0a\u4e0b\u6587\u6982\u89c8",
      noAgent: "\u672a\u9009 Agent",
      noModel: "\u672a\u9009\u6a21\u578b",
      harness: "Harness",
      harnessConnected: "\u5df2\u8fde\u63a5",
      harnessAvailable: "\u53ef\u7528",
      harnessNeedsConfig: "\u9700\u8981\u914d\u7f6e",
      harnessUnavailable: "\u4e0d\u53ef\u7528",
      harnessUnknown: "\u72b6\u6001\u672a\u77e5",
      soon: "\u7a0d\u540e",
      agent: "Agent",
      model: "\u6a21\u578b",
      thinking: "\u601d\u8003\u5f3a\u5ea6",
      thinkingOff: "\u5173\u95ed",
      thinkingMinimal: "\u6700\u5c0f",
      thinkingLow: "\u4f4e",
      thinkingMedium: "\u4e2d",
      thinkingHigh: "\u9ad8",
      thinkingAdaptive: "\u81ea\u9002\u5e94",
      thinkingXHigh: "\u6781\u9ad8",
      thinkingMax: "\u6700\u5927",
      emptyTitle: "\u7b49\u5f85\u6d88\u606f",
      emptyBody: "\u5f53\u524d\u89c6\u56fe\u8fd8\u6ca1\u6709\u6d88\u606f\u3002",
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
      runtimeError: "\u8fd0\u884c\u9519\u8bef",
      runtimeSucceeded: "\u6210\u529f",
      runtimeFailed: "\u5931\u8d25",
      runtimeCancelled: "\u5df2\u53d6\u6d88",
      runtimeQueued: "\u6392\u961f\u4e2d",
      runtimeRunning: "\u8fd0\u884c\u4e2d",
      attachmentOnlyMessage: "\u5df2\u4e0a\u4f20\u6587\u4ef6",
      removeAttachment: "\u79fb\u9664\u9644\u4ef6",
      upload: "\u4e0a\u4f20\u6587\u4ef6",
      placeholder: (harnessLabel: string) => `\u53d1\u9001\u7ed9 ${harnessLabel}\uff0cShift+Enter \u6362\u884c...`,
      send: "\u53d1\u9001",
      sendFailed: "\u53d1\u9001\u5931\u8d25\u3002"
    };
  }

  return {
    title: "Harness Session Console",
    settings: "Harness controls",
    collapseSettings: "Collapse",
    expandSettings: "Expand",
    sessionView: "Chat session",
    newSessionView: "New session",
    newSessionViewMeta: "Created by OpenClaw",
    newSessionViewTitle: "New chat",
    messagesUnit: "messages",
    nativeSessionBound: "Native session bound",
    nativeSessionDraft: "Draft view",
    nativeHistoryMeta: "OpenClaw native history",
    historyLoading: "Loading native history",
    historyLoadFailed: "Failed to load native history.",
    sessionCreateFailed: "Failed to create an OpenClaw session.",
    contextSummary: "Context summary",
    noAgent: "No agent",
    noModel: "No model",
    harness: "Harness",
    harnessConnected: "connected",
    harnessAvailable: "available",
    harnessNeedsConfig: "needs config",
    harnessUnavailable: "unavailable",
    harnessUnknown: "unknown",
    soon: "soon",
    agent: "Agent",
    model: "Model",
    thinking: "Thinking",
    thinkingOff: "Off",
    thinkingMinimal: "Minimal",
    thinkingLow: "Low",
    thinkingMedium: "Medium",
    thinkingHigh: "High",
    thinkingAdaptive: "Adaptive",
    thinkingXHigh: "Extra high",
    thinkingMax: "Max",
    emptyTitle: "Waiting for messages",
    emptyBody: "This session view has no messages yet.",
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
    runtimeError: "Runtime error",
    runtimeSucceeded: "succeeded",
    runtimeFailed: "failed",
    runtimeCancelled: "cancelled",
    runtimeQueued: "queued",
    runtimeRunning: "running",
    attachmentOnlyMessage: "Uploaded files",
    removeAttachment: "Remove attachment",
    upload: "Upload files",
    placeholder: (harnessLabel: string) => `Send to ${harnessLabel}, Shift+Enter for a new line...`,
    send: "Send",
    sendFailed: "Failed to send message."
  };
}
