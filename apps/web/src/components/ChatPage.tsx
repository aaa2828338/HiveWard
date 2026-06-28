import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type ReactNode,
  type SetStateAction
} from "react";
import { createPortal } from "react-dom";
import {
  Bot,
  Brain,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileUp,
  LayoutTemplate,
  Loader2,
  MessageSquareText,
  Paperclip,
  Pencil,
  Plus,
  Send,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
  Wrench,
  X
} from "lucide-react";
import type {
  BlueprintDefinition,
  CatalogSnapshot,
  ChatAttachment,
  ChatMode,
  ChatPermissionMode,
  ChatRoleScope,
  ChatStreamTimings,
  ChatThinkingEffort,
  CompanyOverview,
  CompanyRoleDirectory,
  HarnessId,
  HarnessStatus,
  AgentOutputEvent,
  OpenClawConfigState,
  RuntimeOverview
} from "@hiveward/shared";
import type { Language } from "../lib/i18n";
import { shouldShowRuntimeStatus, type ChatRuntimeStatusView } from "../lib/chat-state";
import * as chatController from "../controllers/chat-controller";
import { harnessDisplayParts, harnessLikeDisplayLabel, harnessLikeDisplayParts } from "../lib/harness-labels";
import { HarnessLabel } from "./HarnessLabel";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { Button, EmptyState, IconButton, PageActions, PageHeader, PageShell, PanelHeader } from "../shared/ui";

type ChatMessage = chatController.ChatMessage;

type SelectOption = {
  value: string;
  label: string;
  badgeLabel?: string;
  meta?: string;
  disabled?: boolean;
  variant?: "create";
  thinkingLevels?: ChatThinkingEffort[];
  nativeSessionId?: string;
};

type HivewardSessionView = chatController.HivewardSessionView;

const maxReadableFileChars = 24_000;
const maxUploadFiles = 6;
const composerMinHeightPx = 42;
const composerMaxHeightPx = 132;
const newSessionViewOptionValue = "__new_session_view__";
const newBlueprintOptionValue = "__new_blueprint__";

export function ChatPage({
  catalog,
  openClawConfig,
  harnessStatuses,
  runtime,
  company,
  selectedCompanyId,
  blueprints,
  roleDirectory,
  language,
  harnessPermissionModes,
  onHumanActionQueueRefreshNeeded
}: {
  catalog?: CatalogSnapshot;
  openClawConfig?: OpenClawConfigState;
  harnessStatuses: HarnessStatus[];
  runtime?: RuntimeOverview;
  company?: CompanyOverview;
  selectedCompanyId?: string;
  blueprints: BlueprintDefinition[];
  roleDirectory?: CompanyRoleDirectory;
  language: Language;
  harnessPermissionModes?: Partial<Record<HarnessId, ChatPermissionMode>>;
  onHumanActionQueueRefreshNeeded?: () => void | Promise<void>;
}) {
  const copy = chatCopy(language);
  const openClawModelOptions = useMemo(() => buildOpenClawModelOptions(catalog, openClawConfig), [catalog, openClawConfig]);
  const agentOptions = useMemo(() => buildAgentOptions(catalog, openClawConfig), [catalog, openClawConfig]);
  const initialModelId = openClawConfig?.defaultModelId ?? openClawModelOptions[0]?.value ?? "";
  const defaultAgentId =
    openClawConfig?.configuredAgents.find((agent) => agent.isDefault)?.id ?? agentOptions[0]?.value ?? "main";

  const [sessionViews, setSessionViews] = useState<HivewardSessionView[]>([]);
  const [activeSessionViewId, setActiveSessionViewId] = useState<string | undefined>();
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [harnessId, setHarnessId] = useState<HarnessId>("openclaw");
  const [modelId, setModelId] = useState(initialModelId);
  const [agentId, setAgentId] = useState(defaultAgentId);
  const [thinkingEffort, setThinkingEffort] = useState<ChatThinkingEffort>("minimal");
  const [chatMode, setChatMode] = useState<ChatMode>("chat");
  const [selectedRoleId, setSelectedRoleId] = useState("ceo");
  const [selectedBlueprintId, setSelectedBlueprintId] = useState(newBlueprintOptionValue);
  const [settingsCollapsed, setSettingsCollapsed] = useState(false);
  const [titleEditing, setTitleEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [titleSaving, setTitleSaving] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [historyLoadingSessionKey, setHistoryLoadingSessionKey] = useState<string | undefined>();
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [rebuildFromHivewardHistory, setRebuildFromHivewardHistory] = useState(false);
  const [proposalSubmittingMessageId, setProposalSubmittingMessageId] = useState<string | undefined>();
  const [submittedBlueprintProposalMessageIds, setSubmittedBlueprintProposalMessageIds] = useState<Set<string>>(() => new Set());
  const threadRef = useRef<HTMLDivElement | null>(null);
  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const streamAbortRef = useRef<AbortController | null>(null);
  const activeSessionView = sessionViews.find((sessionView) => sessionView.id === activeSessionViewId) ?? sessionViews[0];
  const messages = activeSessionView?.messages ?? [];
  const runtimeSessions = runtime?.sessions ?? [];
  const isOpenClawHarness = harnessId === "openclaw";
  const selectedHarnessStatus = harnessStatuses.find((status) => status.id === harnessId);
  const selectedHarnessLabel = formatHarnessLabel(harnessId);
  const modelOptions = useMemo(
    () => buildHarnessModelOptions(harnessId, selectedHarnessStatus, openClawModelOptions, copy),
    [copy, harnessId, openClawModelOptions, selectedHarnessStatus]
  );
  const defaultModelId = modelOptions[0]?.value ?? "";
  const selectedModelOption = modelOptions.find((option) => option.value === modelId);
  const selectedHarnessAvailable =
    (!selectedHarnessStatus ||
      selectedHarnessStatus.connectionState === "connected" ||
      selectedHarnessStatus.connectionState === "available");
  const roleOptions = useMemo<SelectOption[]>(() => buildRoleOptions(roleDirectory, blueprints, copy), [blueprints, copy, roleDirectory]);
  const selectedRole =
    roleDirectory?.ceo.id === selectedRoleId
      ? roleDirectory.ceo
      : roleDirectory?.leaders.find((role) => role.id === selectedRoleId) ?? roleDirectory?.ceo;
  const selectedRoleBlueprint = selectedRole?.blueprintId
    ? blueprints.find((blueprint) => blueprint.id === selectedRole.blueprintId)
    : undefined;
  const blueprintOptions = useMemo<SelectOption[]>(
    () => buildBlueprintOptions(selectedRole, blueprints, copy),
    [blueprints, copy, selectedRole]
  );
  const selectedBlueprintOptionValue = resolveBlueprintSelection(selectedRole, selectedBlueprintId, blueprints);
  const selectedBlueprintScopeId =
    chatMode === "blueprint" ? readSelectedBlueprintScopeId(selectedBlueprintOptionValue) : undefined;
  const selectedChatBlueprint = selectedBlueprintScopeId
    ? blueprints.find((blueprint) => blueprint.id === selectedBlueprintScopeId)
    : undefined;
  const titleBlueprint = chatMode === "blueprint" ? selectedChatBlueprint : selectedRoleBlueprint;
  const selectedRoleLabel = selectedRole?.label ?? copy.ceoRole;
  const activePermissionMode = chatController.resolveHarnessPermissionMode(harnessId, harnessPermissionModes, activeSessionView);
  const canConfigurePermission =
    Boolean(activeSessionView) && activeSessionView?.harnessId === harnessId && chatController.supportsChatPermissionMode(harnessId);

  const applySessionRoleScope = useCallback(
    (roleScope: ChatRoleScope | undefined) => {
      if (!roleScope) return;
      if (roleScope.role === "ceo") {
        setSelectedRoleId(roleDirectory?.ceo.id ?? "ceo");
      } else if (roleScope.leaderId) {
        setSelectedRoleId(roleScope.leaderId);
      }
      setSelectedBlueprintId(roleScope.blueprintId ?? newBlueprintOptionValue);
    },
    [roleDirectory?.ceo.id]
  );

  const activeSessionViewIdRef = useRef(activeSessionViewId);
  useEffect(() => {
    activeSessionViewIdRef.current = activeSessionViewId;
  }, [activeSessionViewId]);

  const applySessionSelection = useCallback(
    (patch: chatController.SessionSelectionPatch) => {
      if (patch.harnessId) setHarnessId(patch.harnessId);
      if (patch.modelId) setModelId(patch.modelId);
      if (patch.agentId) setAgentId(patch.agentId);
      if (patch.thinkingEffort) setThinkingEffort(patch.thinkingEffort);
      if (patch.chatMode) setChatMode(patch.chatMode);
      applySessionRoleScope(patch.roleScope);
    },
    [applySessionRoleScope]
  );

  const loadChatSessions = useCallback(
    async (preferredSessionId?: string) => {
      await chatController.loadChatSessions({
        preferredSessionId,
        activeSessionViewId,
        agentId,
        chatMode,
        copy,
        defaultModelId,
        harnessId,
        harnessPermissionModes,
        selectedCompanyId,
        selectedBlueprintScopeId,
        selectedRole,
        thinkingEffort,
        setSessionsLoading,
        setError,
        setSessionViews,
        setActiveSessionViewId,
        applySessionSelection
      });
    },
    [
      activeSessionViewId,
      agentId,
      chatMode,
      copy,
      defaultModelId,
      harnessId,
      harnessPermissionModes,
      applySessionSelection,
      selectedCompanyId,
      selectedBlueprintScopeId,
      selectedRole,
      thinkingEffort
    ]
  );

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
        return chatController.updateSessionViewMessages({ copy, sessionView, nextMessagesAction });
      });
    },
    [copy, updateActiveSessionView]
  );

  useEffect(() => {
    if (!titleEditing) setTitleDraft(activeSessionView?.title ?? "");
  }, [activeSessionView?.title, titleEditing]);

  const startEditingTitle = useCallback(() => {
    setTitleDraft(activeSessionView?.title ?? "");
    setTitleEditing(true);
  }, [activeSessionView?.title]);

  const cancelEditingTitle = useCallback(() => {
    setTitleDraft(activeSessionView?.title ?? "");
    setTitleEditing(false);
  }, [activeSessionView?.title]);

  const saveSessionTitle = useCallback(async () => {
    await chatController.saveSessionTitle({
      activeSessionView,
      copy,
      titleDraft,
      setTitleSaving,
      setError,
      setSessionViews,
      setTitleEditing
    });
  }, [activeSessionView, copy.titleUpdateFailed, titleDraft]);

  const endActiveSession = useCallback(async () => {
    await chatController.endActiveSession({
      activeSessionView,
      copy,
      setError,
      setSessionViews,
      setRebuildFromHivewardHistory
    });
  }, [activeSessionView, copy.sessionEndFailed]);

  const updateActiveSessionPermissionMode = useCallback(
    async (value: string) => {
      await chatController.updateActiveSessionPermissionMode({
        value,
        activePermissionMode,
        activeSessionView,
        copy,
        harnessId,
        setError,
        setSessionViews
      });
    },
    [activePermissionMode, activeSessionView, copy.permissionUpdateFailed, harnessId]
  );

  const bindActiveSessionView = useCallback(
    (event: AgentOutputEvent, eventHarnessId: HarnessId) => {
      updateActiveSessionView((sessionView) => chatController.bindSessionViewToOutputEvent({
        event,
        eventHarnessId,
        sessionView
      }));
    },
    [updateActiveSessionView]
  );

  const createSessionView = useCallback(async () => {
    await chatController.createSessionView({
      agentId,
      chatMode,
      copy,
      harnessId,
      harnessPermissionModes,
      modelId,
      selectedBlueprintScopeId,
      selectedCompanyId,
      selectedRole,
      thinkingEffort,
      setSessionViews,
      setActiveSessionViewId,
      setRebuildFromHivewardHistory,
      setDraft,
      setAttachments,
      setError
    });
  }, [agentId, chatMode, copy, harnessId, harnessPermissionModes, modelId, selectedBlueprintScopeId, selectedCompanyId, selectedRole, thinkingEffort]);

  const loadSessionMessages = useCallback(
    async (sessionViewId: string) => {
      await chatController.loadSessionMessages({
        sessionViewId,
        copy,
        setHistoryLoadingSessionKey,
        setError,
        setSessionViews
      });
    },
    [copy]
  );

  const activateNativeSession = useCallback(
    async (sessionKey: string) => {
      await chatController.activateNativeSession({
        chatMode,
        copy,
        defaultAgentId,
        modelId,
        runtimeSessions,
        selectedBlueprintScopeId,
        selectedCompanyId,
        selectedRole,
        sessionKey,
        thinkingEffort,
        setSessionViews,
        setActiveSessionViewId,
        applySessionSelection,
        setRebuildFromHivewardHistory,
        setDraft,
        setAttachments,
        setError
      });
    },
    [applySessionSelection, chatMode, copy, defaultAgentId, modelId, runtimeSessions, selectedBlueprintScopeId, selectedCompanyId, selectedRole, thinkingEffort]
  );

  useEffect(() => {
    if (modelOptions.some((option) => option.value === modelId)) return;
    setModelId(defaultModelId);
  }, [defaultModelId, modelId, modelOptions]);

  useEffect(() => {
    if (!agentId && defaultAgentId) setAgentId(defaultAgentId);
  }, [agentId, defaultAgentId]);

  useEffect(() => {
    if (roleOptions.some((option) => option.value === selectedRoleId)) return;
    setSelectedRoleId(roleOptions[0]?.value ?? "ceo");
  }, [roleOptions, selectedRoleId]);

  useEffect(() => {
    if (selectedBlueprintId === selectedBlueprintOptionValue) return;
    setSelectedBlueprintId(selectedBlueprintOptionValue);
  }, [selectedBlueprintId, selectedBlueprintOptionValue]);

  useEffect(() => {
    void loadChatSessions();
  }, [selectedCompanyId]);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight });
  }, [messages]);

  useEffect(() => {
    if (!activeSessionView?.messages.some((message) => message.status === "streaming")) return;

    const interval = window.setInterval(() => {
      void chatController.refreshStreamingChatMessages({
        activeSessionView,
        copy,
        loadSessionMessages
      });
    }, 8_000);

    return () => window.clearInterval(interval);
  }, [activeSessionView?.id, activeSessionView?.messages, copy, loadSessionMessages]);

  useEffect(() => {
    const textarea = composerTextareaRef.current;
    if (!textarea) return;
    textarea.style.height = `${composerMinHeightPx}px`;
    const nextHeight = Math.min(textarea.scrollHeight, composerMaxHeightPx);
    textarea.style.height = `${Math.max(composerMinHeightPx, nextHeight)}px`;
    textarea.style.overflowY = textarea.scrollHeight > composerMaxHeightPx ? "auto" : "hidden";
  }, [draft]);

  useEffect(
    () => () => {
      streamAbortRef.current?.abort();
    },
    []
  );

  const sessionViewOptions = useMemo<SelectOption[]>(
    () => {
      const knownNativeSessionIds = new Set(sessionViews.flatMap((sessionView) => sessionView.nativeSessionId ? [sessionView.nativeSessionId] : []));
        return [
          {
            value: newSessionViewOptionValue,
            label: copy.newSessionView,
            variant: "create"
          },
        ...sessionViews
          .filter((sessionView) => sessionView.harnessId === harnessId)
          .filter((sessionView) => isVisibleSessionView(sessionView, agentId))
          .map((sessionView) => ({
            value: sessionView.id,
            label: sessionView.status === "ended" ? `${sessionView.title} / ${copy.ended}` : sessionView.title,
            meta: sessionView.status === "native_missing" ? copy.nativeSessionMissing : undefined
          })),
        ...(harnessId === "openclaw"
          ? runtimeSessions
              .filter((session) => isVisibleNativeChatSessionKey(session.id, agentId))
              .filter((session) => !knownNativeSessionIds.has(session.id))
              .map((session, index) => ({
                value: `native-session-option-${index}`,
                label: formatNativeSessionLabel(session),
                nativeSessionId: session.id
              }))
          : [])
      ];
    },
    [agentId, copy, harnessId, runtimeSessions, sessionViews]
  );
  const harnessOptions = useMemo<SelectOption[]>(
    () =>
      ([
        "codex",
        "claudeCode",
        "openclaw",
        "hermes",
        "google",
        "cursor",
        "opencode"
      ] as const).map((value) => {
        const status = harnessStatuses.find((item) => item.id === value);
        return {
          value,
          ...harnessDisplayParts(value),
          meta: formatHarnessStatusMeta(status, copy),
          disabled: status?.connectionState === "needs_config" || status?.connectionState === "unavailable"
        };
      }),
    [copy, harnessStatuses]
  );
  const thinkingOptions = useMemo<SelectOption[]>(
    () => buildThinkingOptions(selectedModelOption?.thinkingLevels, copy),
    [copy, selectedModelOption?.thinkingLevels]
  );
  const permissionOptions = useMemo<SelectOption[]>(
    () => [
      { value: "safe", label: copy.permissionSafe },
      { value: "full_access", label: copy.permissionFull }
    ],
    [copy]
  );
  const modeOptions = useMemo<SelectOption[]>(
    () => [
      { value: "chat", label: copy.modeChat },
      { value: "blueprint", label: copy.modeBlueprint },
      { value: "skill_split", label: copy.modeSkillSplit }
    ],
    [copy]
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
      const selectedOption = sessionViewOptions.find((option) => option.value === sessionViewId);
      if (selectedOption?.nativeSessionId) {
        void activateNativeSession(selectedOption.nativeSessionId);
        return;
      }
      const nextSessionView = sessionViews.find((sessionView) => sessionView.id === sessionViewId);
      setActiveSessionViewId(sessionViewId);
      if (nextSessionView) setHarnessId(nextSessionView.harnessId);
      if (nextSessionView?.agentId) setAgentId(nextSessionView.agentId);
      if (nextSessionView?.modelId) setModelId(nextSessionView.modelId);
      if (nextSessionView?.thinkingEffort) setThinkingEffort(nextSessionView.thinkingEffort);
      if (nextSessionView?.mode) setChatMode(nextSessionView.mode);
      applySessionRoleScope(nextSessionView?.roleScope);
      void loadSessionMessages(sessionViewId);
      setRebuildFromHivewardHistory(false);
      setDraft("");
      setAttachments([]);
      setError(undefined);
    },
    [activateNativeSession, applySessionRoleScope, createSessionView, loadSessionMessages, sessionViewOptions, sessionViews]
  );

  const selectHarness = useCallback(
    async (nextHarnessId: HarnessId) => {
      await chatController.selectHarness({
        nextHarnessId,
        agentId,
        chatMode,
        copy,
        harnessPermissionModes,
        modelId,
        selectedBlueprintScopeId,
        selectedCompanyId,
        selectedRole,
        sessionViews,
        thinkingEffort,
        setSessionViews,
        setActiveSessionViewId,
        applySessionSelection,
        setRebuildFromHivewardHistory,
        setError,
        loadSessionMessages
      });
    },
    [agentId, applySessionSelection, chatMode, copy, harnessPermissionModes, loadSessionMessages, modelId, selectedBlueprintScopeId, selectedCompanyId, selectedRole, sessionViews, thinkingEffort]
  );

  const selectAgent = useCallback(
    async (nextAgentId: string) => {
      await chatController.selectAgent({
        nextAgentId,
        agentId,
        chatMode,
        copy,
        harnessId,
        modelId,
        selectedBlueprintScopeId,
        selectedCompanyId,
        selectedRole,
        thinkingEffort,
        setSessionViews,
        setActiveSessionViewId,
        applySessionSelection,
        setRebuildFromHivewardHistory,
        setDraft,
        setAttachments,
        setError
      });
    },
    [agentId, applySessionSelection, chatMode, copy, harnessId, modelId, selectedBlueprintScopeId, selectedCompanyId, selectedRole, thinkingEffort]
  );

  const canSend =
    !isSending &&
    selectedHarnessAvailable &&
    (draft.trim().length > 0 || attachments.length > 0) &&
    Boolean(activeSessionView) &&
    activeSessionView?.status !== "ended" &&
    (activeSessionView?.status !== "native_missing" || rebuildFromHivewardHistory);

  const sendMessage = async () => {
    if (!canSend || !activeSessionView) return;
    await chatController.streamChatMessage({
      activeSessionView,
      agentId,
      attachments,
      chatMode,
      copy,
      defaultModelId,
      draft,
      harnessId,
      harnessPermissionModes,
      messages,
      modelId,
      modelOptions,
      onHumanActionQueueRefreshNeeded,
      rebuildFromHivewardHistory,
      selectedBlueprintScopeId,
      selectedCompanyId,
      selectedRole,
      selectedRoleLabel,
      thinkingEffort,
      updateActiveSessionViewMessages,
      bindActiveSessionView,
      setDraft,
      setAttachments,
      setError,
      setIsSending,
      setRebuildFromHivewardHistory,
      streamAbortRef,
      onStreamComplete: (sessionId) => chatController.refreshCompletedStreamSession({
        sessionId,
        getActiveSessionViewId: () => activeSessionViewIdRef.current,
        loadChatSessions,
        loadSessionMessages
      })
    });
  };

  const submitBlueprintProposal = async (message: ChatMessage) => {
    await chatController.submitBlueprintProposal({
      activeSessionView,
      copy,
      message,
      selectedBlueprintScopeId,
      titleBlueprint,
      setError,
      setProposalSubmittingMessageId,
      setSubmittedBlueprintProposalMessageIds,
      onHumanActionQueueRefreshNeeded
    });
  };

  const stopMessage = () => {
    streamAbortRef.current?.abort();
  };

  const addFiles = async (fileList: FileList | null) => {
    if (!fileList) return;
    const remainingSlots = Math.max(0, maxUploadFiles - attachments.length);
    const files = Array.from(fileList).slice(0, remainingSlots);
    const nextAttachments = await Promise.all(files.map(readChatAttachment));
    setAttachments((current) => [...current, ...nextAttachments]);
  };

  return (
    <PageShell className={`chat-page-grid ${settingsCollapsed ? "chat-settings-collapsed" : ""}`}>
      <PageHeader
        title={copy.title}
        description={`${selectedRoleLabel}${titleBlueprint ? ` / ${titleBlueprint.name}` : company?.name ? ` / ${company.name}` : ""}`}
        actions={
          <span
            className={`openclaw-panel-state ${
              selectedHarnessStatus?.connectionState === "connected" || selectedHarnessStatus?.connectionState === "available"
                ? "online"
                : "offline"
            }`}
          >
            <HarnessLabel {...harnessLikeDisplayParts(harnessId)} />
          </span>
        }
      />

      <div className="chat-workspace">
        <div className={`chat-settings-column ${settingsCollapsed ? "collapsed" : ""}`}>
          <PanelHeader
            className="chat-settings-column-header"
            title={settingsCollapsed ? copy.settings : copy.settings}
            actions={
              <Button
                className="chat-settings-collapse-button"
                icon={settingsCollapsed ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
                title={settingsCollapsed ? copy.expandSettings : copy.collapseSettings}
                aria-label={settingsCollapsed ? copy.expandSettings : copy.collapseSettings}
                onClick={() => setSettingsCollapsed((current) => !current)}
              >
                {settingsCollapsed ? copy.expandSettings : copy.collapseSettings}
              </Button>
            }
          />

          <aside className={`content-card stack-card chat-settings-panel ${settingsCollapsed ? "collapsed" : ""}`} aria-label={copy.settings}>
            {settingsCollapsed ? (
              <div className="chat-settings-icon-rail" aria-label={copy.settings}>
                <button type="button" title={copy.harness} aria-label={copy.harness} onClick={() => setSettingsCollapsed(false)}>
                  <Wrench size={16} />
                </button>
                <button type="button" title={copy.role} aria-label={copy.role} onClick={() => setSettingsCollapsed(false)}>
                  <Bot size={16} />
                </button>
                {chatMode === "blueprint" && (
                  <button type="button" title={copy.blueprint} aria-label={copy.blueprint} onClick={() => setSettingsCollapsed(false)}>
                    <LayoutTemplate size={16} />
                  </button>
                )}
                {isOpenClawHarness && (
                  <button type="button" title={copy.agent} aria-label={copy.agent} onClick={() => setSettingsCollapsed(false)}>
                    <Bot size={16} />
                  </button>
                )}
                <button type="button" title={copy.sessionView} aria-label={copy.sessionView} onClick={() => setSettingsCollapsed(false)}>
                  <MessageSquareText size={16} />
                </button>
                <button type="button" title={copy.model} aria-label={copy.model} onClick={() => setSettingsCollapsed(false)}>
                  <Sparkles size={16} />
                </button>
                <button type="button" title={copy.thinking} aria-label={copy.thinking} onClick={() => setSettingsCollapsed(false)}>
                  <Brain size={16} />
                </button>
                <button type="button" title={copy.mode} aria-label={copy.mode} onClick={() => setSettingsCollapsed(false)}>
                  <LayoutTemplate size={16} />
                </button>
                {canConfigurePermission && (
                  <button type="button" title={copy.permission} aria-label={copy.permission} onClick={() => setSettingsCollapsed(false)}>
                    <ShieldCheck size={16} />
                  </button>
                )}
              </div>
            ) : (
              <div className="chat-settings-body">
                <ChatSelect
                  label={copy.harness}
                  icon={<Wrench size={14} />}
                  value={harnessId}
                  options={harnessOptions}
                  onChange={(value) => void selectHarness(value as HarnessId)}
                />

                <ChatSelect
                  label={copy.role}
                  icon={<Bot size={14} />}
                  value={selectedRole?.id ?? selectedRoleId}
                  options={roleOptions}
                  onChange={setSelectedRoleId}
                />

                {chatMode === "blueprint" && (
                  <ChatSelect
                    label={copy.blueprint}
                    icon={<LayoutTemplate size={14} />}
                    value={selectedBlueprintOptionValue}
                    options={blueprintOptions}
                    onChange={setSelectedBlueprintId}
                  />
                )}

                {isOpenClawHarness && (
                  <ChatSelect
                    label={copy.agent}
                    icon={<Bot size={14} />}
                    value={agentId}
                    options={agentOptions}
                    onChange={(value) => void selectAgent(value)}
                  />
                )}

                <ChatSelect
                  label={copy.sessionView}
                  icon={<MessageSquareText size={14} />}
                  value={activeSessionView?.id ?? ""}
                  options={sessionViewOptions}
                  onChange={selectSessionView}
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

                <ChatSelect
                  label={copy.mode}
                  icon={<LayoutTemplate size={14} />}
                  value={chatMode}
                  options={modeOptions}
                  onChange={(value) => setChatMode(value as ChatMode)}
                />

                {canConfigurePermission && (
                  <div className={`chat-permission-field ${activePermissionMode === "full_access" ? "enabled" : ""}`}>
                    <ChatSelect
                      label={copy.permission}
                      icon={<ShieldCheck size={14} />}
                      value={activePermissionMode ?? "safe"}
                      options={permissionOptions}
                      onChange={(value) => void updateActiveSessionPermissionMode(value)}
                    />
                  </div>
                )}
              </div>
            )}
          </aside>
        </div>

        <div className="chat-window-column">
          <PanelHeader
            className="chat-window-column-header"
            title={titleEditing ? copy.editSessionTitle : activeSessionView?.title || copy.noSessionView}
            actions={
              titleEditing ? (
                <form
                  className="chat-title-edit-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void saveSessionTitle();
                  }}
                >
                  <input
                    value={titleDraft}
                    aria-label={copy.editSessionTitle}
                    autoFocus
                    maxLength={120}
                    onChange={(event) => setTitleDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") cancelEditingTitle();
                    }}
                  />
                  <IconButton
                    type="submit"
                    icon={titleSaving ? <Loader2 className="spin" size={14} /> : <Check size={14} />}
                    label={copy.saveSessionTitle}
                    disabled={titleSaving || !titleDraft.trim()}
                  />
                  <IconButton icon={<X size={14} />} label={copy.cancelEditSessionTitle} onClick={cancelEditingTitle} />
                </form>
              ) : (
                <PageActions>
                  <IconButton icon={<Plus size={14} />} label={copy.newSessionView} onClick={() => void createSessionView()} />
                  <IconButton icon={<Pencil size={14} />} label={copy.editSessionTitle} onClick={startEditingTitle} />
                  <IconButton
                    icon={<Square size={14} />}
                    label={copy.endSession}
                    disabled={!activeSessionView || activeSessionView.status === "ended"}
                    onClick={() => void endActiveSession()}
                  />
                </PageActions>
              )
            }
          />
          <section className="content-card chat-window-card" aria-label={activeSessionView?.title || copy.noSessionView}>
            <div className="chat-thread" ref={threadRef}>
              {messages.length === 0 ? (
                <EmptyState className="chat-placeholder-state" icon={<MessageSquareText size={22} />} title={copy.emptyTitle} description={copy.emptyBody} />
              ) : (
                messages.map((message) => {
                  const runtimeActivities = message.runtimeActivities ?? message.runtimeRef?.activity ?? [];
                  const canSubmitProposal = chatController.canSubmitBlueprintProposalMessage(message, activeSessionView);
                  const proposalSubmitted = submittedBlueprintProposalMessageIds.has(message.id);
                  const proposalSubmitting = proposalSubmittingMessageId === message.id;
                  return (
                    <article
                      key={message.id}
                      className={`chat-message-row chat-message-row-${message.role} ${message.status ?? ""}`}
                    >
                      <div
                        className={`chat-avatar chat-avatar-${message.role}`}
                        aria-label={message.role === "user" ? copy.you : message.speakerLabel ?? copy.assistant}
                      >
                        {message.role === "user" ? copy.youAvatar : <Bot size={16} />}
                      </div>
                      <div className={`chat-message chat-message-${message.role} ${message.status ?? ""}`}>
                        {message.content ? <MarkdownRenderer value={message.content} className="chat-message-body" /> : null}
                        {shouldShowRuntimeStatus(message) && message.runtimeStatus ? (
                          <div className="chat-message-runtime-status">
                            <Loader2 className="spin" size={15} />
                            <span className="chat-runtime-status">
                              <span>{formatChatRuntimeStatusTitle(message.runtimeStatus, copy)}</span>
                              <span className="chat-runtime-label">{message.runtimeStatus.label}</span>
                            </span>
                          </div>
                        ) : null}
                        {runtimeActivities.length > 0 ? (
                          <div className="chat-runtime-activity-list" aria-label={copy.runtimeActivity}>
                            {runtimeActivities.map((activity) => (
                              <div key={activity.id} className={`chat-runtime-activity chat-runtime-activity-${activity.phase}`}>
                                {activity.phase === "command" ? <Square size={12} /> : activity.phase === "tool" ? <Wrench size={12} /> : <Brain size={12} />}
                                <span className="chat-runtime-activity-time">{formatRuntimeActivityTime(activity.updatedAt)}</span>
                                <span className="chat-runtime-activity-title">{formatChatRuntimeStatusTitle(activity, copy)}</span>
                                <span className="chat-runtime-activity-label">{activity.label}</span>
                              </div>
                            ))}
                          </div>
                        ) : null}
                        {!message.content && !shouldShowRuntimeStatus(message) ? (
                          <div className="chat-message-pending">
                            <Loader2 className="spin" size={15} />
                            {message.progressText ?? copy.waiting(formatHarnessLabel(message.harnessId ?? harnessId))}
                          </div>
                        ) : null}
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
                        {canSubmitProposal ? (
                          <div className="chat-message-actions">
                            <button
                              type="button"
                              className="chat-message-action"
                              disabled={proposalSubmitted || proposalSubmitting}
                              onClick={() => void submitBlueprintProposal(message)}
                            >
                              {proposalSubmitting ? <Loader2 className="spin" size={14} /> : proposalSubmitted ? <Check size={14} /> : <ShieldCheck size={14} />}
                              {proposalSubmitted ? copy.blueprintProposalSubmitted : proposalSubmitting ? copy.submittingBlueprintProposal : copy.submitBlueprintProposal}
                            </button>
                          </div>
                        ) : null}
                        {message.status === "failed" && <span className="chat-message-status">{copy.failed}</span>}
                        {message.runtimeRef?.timings ? (
                          <span className="chat-message-runtime">
                            {formatRuntimeTimings(message.runtimeRef.timings, message.runtimeRef.source, copy)}
                          </span>
                        ) : null}
                      </div>
                    </article>
                  );
                })
              )}
            </div>

            <div className="chat-composer">
              {sessionsLoading && <div className="chat-inline-error">{copy.sessionsLoading}</div>}
              {activeSessionView?.status === "native_missing" && (
                <div className="chat-inline-error">
                  {copy.nativeSessionMissing}
                  <button type="button" className="secondary-action" onClick={() => setRebuildFromHivewardHistory(true)}>
                    {rebuildFromHivewardHistory ? copy.rebuildFromHistoryEnabled : copy.rebuildFromHistory}
                  </button>
                </div>
              )}
              {activeSessionView?.status === "ended" && <div className="chat-inline-error">{copy.sessionEnded}</div>}
              {error && (
                <div className="chat-inline-error">
                  <span>{error}</span>
                  <button type="button" onClick={() => setError(undefined)} title="关闭">
                    <X size={14} />
                  </button>
                </div>
              )}
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
                  ref={composerTextareaRef}
                  value={draft}
                  placeholder={copy.placeholder(selectedHarnessLabel)}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      if (!isSending) void sendMessage();
                    }
                  }}
                />
                <button
                  type="button"
                  className={`${isSending ? "danger-action chat-stop-button" : "primary-action"} chat-send-button`}
                  disabled={isSending ? false : !canSend}
                  onClick={() => {
                    if (isSending) {
                      stopMessage();
                      return;
                    }
                    void sendMessage();
                  }}
                >
                  {isSending ? <Square size={15} /> : <Send size={16} />}
                  {isSending ? copy.stop : copy.send}
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>
    </PageShell>
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
  const [menuStyle, setMenuStyle] = useState<CSSProperties>();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const selectedOption = options.find((option) => option.value === value && option.variant !== "create");
  const selectedLabel = selectedOption?.label ?? options.find((option) => option.value === value)?.label ?? "";

  useEffect(() => {
    if (!open) return;

    const updateMenuPosition = () => {
      const button = buttonRef.current;
      if (!button) return;
      const rect = button.getBoundingClientRect();
      const gutter = 8;
      const viewportPadding = 10;
      const menuWidth = Math.min(320, Math.max(190, rect.width));
      const optionHeight = 38;
      const menuHeight = Math.min(280, options.length * optionHeight + 12);
      const spaceBelow = window.innerHeight - rect.top - viewportPadding;
      const spaceAbove = rect.bottom - viewportPadding;
      const openDown = spaceBelow >= menuHeight || spaceBelow >= spaceAbove;
      const top = openDown
        ? Math.min(rect.top, window.innerHeight - menuHeight - viewportPadding)
        : Math.max(viewportPadding, rect.bottom - menuHeight);
      const preferredLeft = rect.right + gutter;
      const left = Math.min(Math.max(viewportPadding, preferredLeft), window.innerWidth - menuWidth - viewportPadding);
      setMenuStyle({
        left,
        top,
        width: menuWidth,
        maxHeight: Math.min(menuHeight, window.innerHeight - viewportPadding * 2)
      });
    };

    updateMenuPosition();
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    return () => {
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [open, options.length]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && (rootRef.current?.contains(target) || menuRef.current?.contains(target))) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [open]);

  return (
    <div
      ref={rootRef}
      className="chat-select-field"
    >
      <span className="chat-control-label">
        {icon}
        {label}
      </span>
      <div className="chat-select-shell">
        <button
          ref={buttonRef}
          type="button"
          className={`chat-select-button ${open ? "open" : ""}`}
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          <span className="chat-select-value">
            <strong>
              <HarnessLabel label={selectedLabel} badgeLabel={selectedOption?.badgeLabel} />
            </strong>
          </span>
          <ChevronDown className="chat-select-arrow" size={15} />
        </button>
        {open && typeof document !== "undefined" && createPortal(
          <div ref={menuRef} className="chat-select-menu" role="listbox" aria-label={label} style={menuStyle}>
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
                    <HarnessLabel label={option.label} badgeLabel={option.badgeLabel} />
                    {option.meta && <small>{option.meta}</small>}
                  </span>
                  {selected && <Check size={14} />}
                </button>
              );
            })}
          </div>,
          document.body
        )}
      </div>
    </div>
  );
}

function formatChatRuntimeStatusTitle(status: ChatRuntimeStatusView, copy: ReturnType<typeof chatCopy>): string {
  if (status.phase === "command") return copy.runtimeCommand;
  if (status.phase === "tool") return copy.runtimeTool;
  return copy.runtimeThinking;
}

function formatRuntimeActivityTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatRuntimeTimings(timings: ChatStreamTimings, source: string, copy: ReturnType<typeof chatCopy>): string {
  const hivewardMs = timings.hivewardPreprocessMs + timings.hivewardPostprocessMs;
  const runtimeMs = timings.runtimeMs ?? timings.openclawMs ?? 0;
  const runtimeAcceptedMs = timings.runtimeAcceptedMs ?? timings.openclawAcceptedMs;
  const runtimeFirstDeltaMs = timings.runtimeFirstDeltaMs ?? timings.openclawFirstDeltaMs;
  const harnessDetails = [
    `${formatHarnessLabel(source)} ${formatDurationMs(runtimeMs)}`,
    runtimeAcceptedMs === undefined ? undefined : `${copy.timingAccepted} ${formatDurationMs(runtimeAcceptedMs)}`,
    runtimeFirstDeltaMs === undefined ? undefined : `${copy.timingFirstToken} ${formatDurationMs(runtimeFirstDeltaMs)}`
  ].filter((item): item is string => Boolean(item));
  return `${copy.timingTotal} ${formatDurationMs(timings.totalMs)} 路 ${harnessDetails.join(" / ")} 路 ${copy.timingHiveward} ${formatDurationMs(hivewardMs)}`;
}

function formatDurationMs(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}s`;
  return `${Math.max(0, Math.round(value))}ms`;
}

function isVisibleSessionView(sessionView: HivewardSessionView, agentId: string): boolean {
  if (sessionView.harnessId !== "openclaw") return true;
  const selectedAgentId = normalizeSessionAgentId(agentId);
  if (sessionView.agentId) return normalizeSessionAgentId(sessionView.agentId) === selectedAgentId;
  if (!sessionView.nativeSessionId) return true;
  const parsed = parseAgentSessionKey(sessionView.nativeSessionId);
  return parsed ? normalizeSessionAgentId(parsed.agentId) === selectedAgentId : selectedAgentId === "main";
}

function isVisibleNativeChatSessionKey(sessionKey: string, agentId: string): boolean {
  const selectedAgentId = normalizeSessionAgentId(agentId);
  if (sessionKey === "main") return selectedAgentId === "main";
  const parsed = parseAgentSessionKey(sessionKey);
  if (!parsed) return false;
  if (normalizeSessionAgentId(parsed.agentId) !== selectedAgentId) return false;
  return isPrimaryChatSessionRest(parsed.rest);
}

function parseAgentSessionKey(sessionKey: string): { agentId: string; rest: string } | undefined {
  const match = /^agent:([^:]+):(.+)$/.exec(sessionKey);
  return match ? { agentId: match[1]!, rest: match[2]! } : undefined;
}

function isPrimaryChatSessionRest(rest: string): boolean {
  const [section] = rest.split(":");
  return rest === "main" || section === "dashboard";
}

function normalizeSessionAgentId(agentId: string | undefined): string {
  return (agentId || "main").trim().toLowerCase() || "main";
}

function formatNativeSessionLabel(session: { id: string; title: string }): string {
  if (session.title && session.title !== session.id) return session.title;
  const parsed = parseAgentSessionKey(session.id);
  if (parsed) return parsed.rest;
  return session.title || session.id;
}

function buildRoleOptions(
  roleDirectory: CompanyRoleDirectory | undefined,
  blueprints: BlueprintDefinition[],
  copy: ReturnType<typeof chatCopy>
): SelectOption[] {
  if (!roleDirectory) {
    return [{ value: "ceo", label: copy.ceoRole, meta: copy.companyRole }];
  }
  const blueprintNames = new Map(blueprints.map((blueprint) => [blueprint.id, blueprint.name]));
  return [
    {
      value: roleDirectory.ceo.id,
      label: roleDirectory.ceo.label || copy.ceoRole,
      meta: copy.companyRole
    },
    ...roleDirectory.leaders.map((leader) => ({
      value: leader.id,
      label: leader.label,
      meta: leader.blueprintId ? blueprintNames.get(leader.blueprintId) ?? leader.blueprintId : copy.blueprintRole
    }))
  ];
}

function buildBlueprintOptions(
  role: CompanyRoleDirectory["ceo"] | CompanyRoleDirectory["leaders"][number] | undefined,
  blueprints: BlueprintDefinition[],
  copy: ReturnType<typeof chatCopy>
): SelectOption[] {
  if (role?.kind === "leader") {
    if (!role.blueprintId) {
      return [{ value: newBlueprintOptionValue, label: copy.noBlueprint, disabled: true }];
    }
    const blueprint = blueprints.find((item) => item.id === role.blueprintId);
    return [{
      value: role.blueprintId,
      label: blueprint?.name ?? role.blueprintId,
      meta: copy.blueprintRole
    }];
  }
  return [
    { value: newBlueprintOptionValue, label: copy.newBlueprint, variant: "create" },
    ...blueprints.map((blueprint) => ({
      value: blueprint.id,
      label: blueprint.name,
      meta: blueprint.description || copy.blueprintRole
    }))
  ];
}

function resolveBlueprintSelection(
  role: CompanyRoleDirectory["ceo"] | CompanyRoleDirectory["leaders"][number] | undefined,
  selectedBlueprintId: string,
  blueprints: BlueprintDefinition[]
): string {
  if (role?.kind === "leader") return role.blueprintId ?? newBlueprintOptionValue;
  if (
    selectedBlueprintId !== newBlueprintOptionValue &&
    blueprints.length > 0 &&
    !blueprints.some((blueprint) => blueprint.id === selectedBlueprintId)
  ) {
    return newBlueprintOptionValue;
  }
  return selectedBlueprintId || newBlueprintOptionValue;
}

function readSelectedBlueprintScopeId(selectedBlueprintId: string): string | undefined {
  return selectedBlueprintId === newBlueprintOptionValue ? undefined : selectedBlueprintId;
}

function buildHarnessModelOptions(
  harnessId: HarnessId,
  harnessStatus: HarnessStatus | undefined,
  openClawModelOptions: SelectOption[],
  copy: ReturnType<typeof chatCopy>
): SelectOption[] {
  if (harnessId === "openclaw") return openClawModelOptions;
  const defaultModelId = harnessStatus?.defaultModelId;
  const scannedOptions = harnessStatus?.models?.length
    ? harnessStatus.models.map((model) => ({
        value: model.id,
        label: model.id === "inherit" ? `${formatHarnessLabel(harnessId)} ${copy.defaultModel}` : model.label || model.id,
        meta: model.provider ?? harnessStatus.label,
        thinkingLevels: model.thinkingLevels?.length ? model.thinkingLevels : getSdkHarnessThinkingLevels(harnessId)
      }))
    : [];
  if (scannedOptions.length) return mergeOptions(scannedOptions);
  if (!defaultModelId) return [];
  return mergeOptions([
    {
      value: defaultModelId,
      label: defaultModelId === "inherit" ? `${formatHarnessLabel(harnessId)} ${copy.defaultModel}` : defaultModelId,
      meta: harnessStatus.label,
      thinkingLevels: getSdkHarnessThinkingLevels(harnessId)
    }
  ]);
}

function getSdkHarnessThinkingLevels(harnessId: HarnessId): ChatThinkingEffort[] {
  if (harnessId === "codex") return ["low", "medium", "high", "xhigh"];
  if (harnessId === "claudeCode") return ["off", "low", "medium", "high", "xhigh", "max", "adaptive"];
  if (harnessId === "google" || harnessId === "cursor" || harnessId === "opencode" || harnessId === "hermes") return ["off", "minimal", "low", "medium", "high", "xhigh"];
  return fallbackThinkingLevels;
}

function buildOpenClawModelOptions(catalog?: CatalogSnapshot, openClawConfig?: OpenClawConfigState): SelectOption[] {
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
      label: agent.name || agent.id
    })) ?? []),
    ...(catalog?.agents.map((agent) => ({
      value: agent.id,
      label: agent.label || agent.id
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
  const rankedAscending = levels.filter((level) => level !== "off").sort((left, right) => thinkingEffortRank[left] - thinkingEffortRank[right]);
  return [...rankedAscending].reverse().find((level) => thinkingEffortRank[level] <= requestedRank)
    ?? rankedAscending[0]
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

function formatHarnessSpeaker(harnessId: string, agentId?: string): string {
  const harnessLabel = formatHarnessLabel(harnessId);
  return agentId ? `${harnessLabel} / ${agentId}` : harnessLabel;
}

function formatHarnessLabel(harnessId: string): string {
  return harnessLikeDisplayLabel(harnessId);
}

function formatHarnessStatusMeta(status: HarnessStatus | undefined, copy: ReturnType<typeof chatCopy>): string {
  if (!status) return copy.harnessUnknown;
  if (status.connectionState === "connected") return copy.harnessConnected;
  if (status.connectionState === "available") return copy.harnessAvailable;
  if (status.connectionState === "needs_config") return copy.harnessNeedsConfig;
  return copy.harnessUnavailable;
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
      settings: "\u8bbe\u7f6e\u9762\u677f",
      collapseSettings: "\u6536\u8d77",
      expandSettings: "\u5c55\u5f00",
      sessionView: "\u4f1a\u8bdd",
      noSessionView: "\u6682\u65e0\u4f1a\u8bdd",
      sessionsLoading: "\u6b63\u5728\u8bfb\u53d6\u4f1a\u8bdd",
      editSessionTitle: "\u4fee\u6539\u4f1a\u8bdd\u540d\u79f0",
      saveSessionTitle: "\u4fdd\u5b58\u4f1a\u8bdd\u540d\u79f0",
      cancelEditSessionTitle: "\u53d6\u6d88\u4fee\u6539",
      titleUpdateFailed: "\u4fee\u6539\u4f1a\u8bdd\u540d\u79f0\u5931\u8d25\u3002",
      endSession: "\u7ed3\u675f\u4f1a\u8bdd",
      ended: "\u5df2\u7ed3\u675f",
      sessionEnded: "\u8fd9\u4e2a\u4f1a\u8bdd\u5df2\u7ed3\u675f\uff0c\u9700\u8981\u65b0\u5efa\u4f1a\u8bdd\u540e\u7ee7\u7eed\u3002",
      sessionEndFailed: "\u7ed3\u675f\u4f1a\u8bdd\u5931\u8d25\u3002",
      newSessionView: "\u65b0\u4f1a\u8bdd",
      newSessionViewTitle: "\u65b0\u804a\u5929",
      messagesUnit: "\u6761\u6d88\u606f",
      nativeSessionBound: "\u5df2\u7ed1\u5b9a\u539f\u751f\u4f1a\u8bdd",
      nativeSessionDraft: "\u8349\u7a3f\u89c6\u56fe",
      nativeSessionMissing: "\u539f\u751f\u4f1a\u8bdd\u4e0d\u53ef\u6062\u590d\uff0c\u53ea\u80fd\u67e5\u770b HiveWard \u5386\u53f2\u6216\u660e\u786e\u7528\u5386\u53f2\u91cd\u5efa\u4e0a\u4e0b\u6587\u3002",
      rebuildFromHistory: "\u7528 HiveWard \u5386\u53f2\u91cd\u5efa",
      rebuildFromHistoryEnabled: "\u4e0b\u6b21\u53d1\u9001\u5c06\u91cd\u5efa",
      historyLoading: "\u6b63\u5728\u8bfb\u53d6\u539f\u751f\u5386\u53f2",
      historyLoadFailed: "\u8bfb\u53d6\u539f\u751f\u5386\u53f2\u5931\u8d25\u3002",
      sessionCreateFailed: "\u65b0\u5efa\u4f1a\u8bdd\u5931\u8d25\u3002",
      contextSummary: "\u4e0a\u4e0b\u6587\u6982\u89c8",
      noAgent: "\u672a\u9009 Agent",
      noModel: "\u672a\u9009\u6a21\u578b",
      defaultModel: "\u9ed8\u8ba4\u6a21\u578b",
      harness: "Harness",
      harnessConnected: "\u5df2\u8fde\u63a5",
      harnessAvailable: "\u53ef\u7528",
      harnessNeedsConfig: "\u9700\u8981\u914d\u7f6e",
      harnessUnavailable: "\u4e0d\u53ef\u7528",
      harnessUnknown: "\u72b6\u6001\u672a\u77e5",
      soon: "\u7a0d\u540e",
      role: "\u89d2\u8272",
      ceoRole: "CEO",
      companyRole: "\u516c\u53f8\u7ea7",
      blueprintRole: "\u4e1a\u52a1\u84dd\u56fe",
      blueprint: "\u84dd\u56fe",
      newBlueprint: "\u65b0\u84dd\u56fe",
      noBlueprint: "\u672a\u7ed1\u5b9a\u84dd\u56fe",
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
      permission: "\u6743\u9650",
      permissionSafe: "\u5b89\u5168\u6a21\u5f0f",
      permissionFull: "\u5168\u6743\u9650",
      permissionUpdateFailed: "\u4f1a\u8bdd\u6743\u9650\u66f4\u65b0\u5931\u8d25\u3002",
      mode: "\u6a21\u5f0f",
      modeChat: "\u804a\u5929",
      modeBlueprint: "\u6784\u5efa\u84dd\u56fe",
      modeSkillSplit: "\u62c6\u5206 Skill",
      blueprintProposalTitle: "\u84dd\u56fe\u63d0\u6848",
      submitBlueprintProposal: "\u63d0\u4ea4\u5ba1\u6279",
      submittingBlueprintProposal: "\u6b63\u5728\u63d0\u4ea4...",
      blueprintProposalSubmitted: "\u5df2\u63d0\u4ea4\u5ba1\u6279",
      blueprintProposalSubmitFailed: "\u63d0\u4ea4\u84dd\u56fe\u63d0\u6848\u5ba1\u6279\u5931\u8d25\u3002",
      emptyTitle: "\u7b49\u5f85\u6d88\u606f",
      emptyBody: "\u5f53\u524d\u89c6\u56fe\u8fd8\u6ca1\u6709\u6d88\u606f\u3002",
      you: "\u4f60",
      youAvatar: "\u4f60",
      assistant: "Harness",
      streaming: "\u8f93\u51fa\u4e2d",
      failed: "\u5931\u8d25",
      waiting: (harnessLabel: string) => `\u7b49\u5f85 ${harnessLabel} \u8fd4\u56de...`,
      acceptedWaiting: (harnessLabel: string) => `\u5df2\u53d1\u7ed9 ${harnessLabel}\uff0c\u7b49\u5f85\u6a21\u578b\u6216\u5de5\u5177\u5b8c\u6210...`,
      runtimeThinking: "\u6b63\u5728\u5904\u7406...",
      runtimeTool: "\u6b63\u5728\u4f7f\u7528\u5de5\u5177...",
      runtimeCommand: "\u6b63\u5728\u6267\u884c\u547d\u4ee4...",
      runtimeActivity: "\u8fd0\u884c\u6d3b\u52a8",
      usageSummary: "\u6a21\u578b\u548c Token \u6d88\u8017",
      usageModel: "\u6a21\u578b",
      usageTokens: "Token \u6d88\u8017",
      tokensUnit: "tokens",
      runtimeError: "\u8fd0\u884c\u9519\u8bef",
      openClawGatewayNotConfigured:
        "OpenClaw Gateway \u672a\u914d\u7f6e\uff0cHiveWard \u6ca1\u6709\u628a\u8fd9\u6b21\u8bf7\u6c42\u53d1\u5230 OpenClaw\u3002\u8bf7\u914d\u7f6e OPENCLAW_GATEWAY_URL \u6216 ~/.openclaw/openclaw.json\uff1b\u5982\u679c\u53ea\u662f\u6f14\u793a\uff0c\u8bf7\u663e\u5f0f\u8bbe\u7f6e OPENCLAW_ADAPTER=mock\u3002",
      openClawGatewayUnreachable:
        "OpenClaw Gateway \u8fde\u63a5\u4e0d\u4e0a\uff0cHiveWard \u6ca1\u6709\u628a\u8fd9\u6b21\u8bf7\u6c42\u53d1\u5230 OpenClaw\u3002\u8bf7\u542f\u52a8 Gateway \u6216\u68c0\u67e5 OPENCLAW_GATEWAY_URL\u3002",
      openClawGatewayNotConnected:
        "OpenClaw Gateway \u5df2\u65ad\u5f00\uff0cHiveWard \u6ca1\u6709\u5b8c\u6210\u8fd9\u6b21 OpenClaw \u8bf7\u6c42\u3002\u8bf7\u91cd\u542f Gateway \u540e\u91cd\u8bd5\u3002",
      runtimeSucceeded: "\u6210\u529f",
      runtimeFailed: "\u5931\u8d25",
      runtimeCancelled: "\u5df2\u53d6\u6d88",
      runtimeQueued: "\u6392\u961f\u4e2d",
      runtimeRunning: "\u8fd0\u884c\u4e2d",
      timingTotal: "\u603b\u8017\u65f6",
      timingHiveward: "Hiveward",
      timingAccepted: "\u63a5\u53d7",
      timingFirstToken: "\u9996\u6bb5",
      attachmentOnlyMessage: "\u5df2\u4e0a\u4f20\u6587\u4ef6",
      removeAttachment: "\u79fb\u9664\u9644\u4ef6",
      upload: "\u4e0a\u4f20\u6587\u4ef6",
      placeholder: (harnessLabel: string) => `\u53d1\u9001\u7ed9 ${harnessLabel}\uff0cShift+Enter \u6362\u884c...`,
      stop: "\u505c\u6b62",
      stopped: "\u5df2\u505c\u6b62",
      send: "\u53d1\u9001",
      sendFailed: "\u53d1\u9001\u5931\u8d25\u3002"
    };
  }

  return {
    title: "Chat",
    settings: "Settings panel",
    collapseSettings: "Collapse",
    expandSettings: "Expand",
    sessionView: "Chat session",
    noSessionView: "No session",
    sessionsLoading: "Loading sessions",
    editSessionTitle: "Edit session title",
    saveSessionTitle: "Save session title",
    cancelEditSessionTitle: "Cancel title edit",
    titleUpdateFailed: "Failed to update session title.",
    endSession: "End session",
    ended: "ended",
    sessionEnded: "This session has ended. Create a new session to continue.",
    sessionEndFailed: "Failed to end session.",
    newSessionView: "New session",
    newSessionViewTitle: "New chat",
    messagesUnit: "messages",
    nativeSessionBound: "Native session bound",
    nativeSessionDraft: "Draft view",
    nativeSessionMissing: "The native session is not recoverable. HiveWard history remains available.",
    rebuildFromHistory: "Use HiveWard history",
    rebuildFromHistoryEnabled: "History rebuild enabled",
    historyLoading: "Loading native history",
    historyLoadFailed: "Failed to load native history.",
    sessionCreateFailed: "Failed to create a chat session.",
    contextSummary: "Context summary",
    noAgent: "No agent",
    noModel: "No model",
    defaultModel: "default model",
    harness: "Harness",
    harnessConnected: "connected",
    harnessAvailable: "available",
    harnessNeedsConfig: "needs config",
    harnessUnavailable: "unavailable",
    harnessUnknown: "unknown",
    soon: "soon",
    role: "Role",
    ceoRole: "CEO",
    companyRole: "Company",
    blueprintRole: "Business blueprint",
    blueprint: "Blueprint",
    newBlueprint: "New blueprint",
    noBlueprint: "No blueprint",
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
    permission: "Permission",
    permissionSafe: "Safe mode",
    permissionFull: "Full access",
    permissionUpdateFailed: "Failed to update session permission.",
    mode: "Mode",
    modeChat: "Chat",
    modeBlueprint: "Build blueprint",
    modeSkillSplit: "Split skill",
    blueprintProposalTitle: "Blueprint proposal",
    submitBlueprintProposal: "Submit for approval",
    submittingBlueprintProposal: "Submitting...",
    blueprintProposalSubmitted: "Submitted for approval",
    blueprintProposalSubmitFailed: "Failed to submit blueprint proposal for approval.",
    emptyTitle: "Waiting for messages",
    emptyBody: "This session has no messages yet.",
    you: "You",
    youAvatar: "You",
    assistant: "Harness",
    streaming: "Streaming",
    failed: "Failed",
    waiting: (harnessLabel: string) => `Waiting for ${harnessLabel}...`,
    acceptedWaiting: (harnessLabel: string) => `Sent to ${harnessLabel}. Waiting for the model or tools to finish...`,
    runtimeThinking: "Working...",
    runtimeTool: "Using tools...",
    runtimeCommand: "Running command...",
    runtimeActivity: "Runtime activity",
    usageSummary: "Model and token usage",
    usageModel: "Model",
    usageTokens: "Token usage",
    tokensUnit: "tokens",
    runtimeError: "Runtime error",
    openClawGatewayNotConfigured:
      "OpenClaw Gateway is not configured, so HiveWard did not send this request to OpenClaw. Configure OPENCLAW_GATEWAY_URL or ~/.openclaw/openclaw.json; for demos, explicitly set OPENCLAW_ADAPTER=mock.",
    openClawGatewayUnreachable:
      "OpenClaw Gateway is unreachable, so HiveWard did not send this request to OpenClaw. Start the Gateway or check OPENCLAW_GATEWAY_URL.",
    openClawGatewayNotConnected:
      "OpenClaw Gateway is disconnected, so HiveWard could not complete this OpenClaw request. Restart the Gateway and retry.",
    runtimeSucceeded: "succeeded",
    runtimeFailed: "failed",
    runtimeCancelled: "cancelled",
    runtimeQueued: "queued",
    runtimeRunning: "running",
    timingTotal: "Total",
    timingHiveward: "Hiveward",
    timingAccepted: "accepted",
    timingFirstToken: "first chunk",
    attachmentOnlyMessage: "Uploaded files",
    removeAttachment: "Remove attachment",
    upload: "Upload files",
    placeholder: (harnessLabel: string) => `Send to ${harnessLabel}, Shift+Enter for a new line...`,
    stop: "Stop",
    stopped: "Stopped",
    send: "Send",
    sendFailed: "Failed to send message."
  };
}
