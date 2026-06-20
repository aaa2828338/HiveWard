import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type {
  AgentOutputEvent,
  BlueprintDefinition,
  ChatAttachment,
  ChatMode,
  ChatPermissionMode,
  ChatRoleScope,
  ChatRuntimeActivity,
  ChatRuntimeRef,
  ChatThinkingEffort,
  CompanyRoleDirectory,
  HarnessId,
  HivewardChatSession,
  RuntimeOverview
} from "@hiveward/shared";
import { api } from "../lib/api";
import { shouldRefreshStreamingChatMessages, toChatRuntimeStatus, type ChatRuntimeStatusView } from "../lib/chat-state";
import { harnessLikeDisplayLabel } from "../lib/harness-labels";
import { projectModelOutputThread, type ModelOutputThreadMessage } from "../lib/model-output-thread";

export type ChatMessage = Omit<ModelOutputThreadMessage, "runtimeStatus"> & {
  status?: "sent" | "streaming" | "failed";
  runtimeRef?: ChatRuntimeRef;
  runtimeStatus?: ChatRuntimeStatusView;
  runtimeActivities?: ChatRuntimeActivity[];
  progressText?: string;
  speakerLabel?: string;
  agentId?: string;
};

export type HivewardSessionView = HivewardChatSession & {
  messages: ChatMessage[];
};

export type SelectOption = {
  value: string;
  label: string;
  badgeLabel?: string;
  meta?: string;
  disabled?: boolean;
  variant?: "create";
  thinkingLevels?: ChatThinkingEffort[];
};

type ChatRole = CompanyRoleDirectory["ceo"] | CompanyRoleDirectory["leaders"][number] | undefined;

type ChatControllerCopy = {
  newSessionViewTitle: string;
  historyLoadFailed: string;
  titleUpdateFailed: string;
  sessionEndFailed: string;
  permissionUpdateFailed: string;
  sessionCreateFailed: string;
  attachmentOnlyMessage: string;
  you: string;
  stopped: string;
  sendFailed: string;
  blueprintProposalSubmitFailed: string;
  blueprintProposalTitle: string;
  runtimeError: string;
  openClawGatewayNotConfigured: string;
  openClawGatewayUnreachable: string;
  openClawGatewayNotConnected: string;
  waiting: (harnessLabel: string) => string;
  acceptedWaiting: (harnessLabel: string) => string;
};

type SetSessionViews = Dispatch<SetStateAction<HivewardSessionView[]>>;
type SetMessages = Dispatch<SetStateAction<ChatMessage[]>>;

export type SessionSelectionPatch = {
  harnessId?: HarnessId;
  modelId?: string;
  agentId?: string;
  thinkingEffort?: ChatThinkingEffort;
  chatMode?: ChatMode;
  roleScope?: ChatRoleScope;
};

export async function loadChatSessions({
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
}: {
  preferredSessionId?: string;
  activeSessionViewId?: string;
  agentId: string;
  chatMode: ChatMode;
  copy: ChatControllerCopy;
  defaultModelId: string;
  harnessId: HarnessId;
  harnessPermissionModes?: Partial<Record<HarnessId, ChatPermissionMode>>;
  selectedCompanyId?: string;
  selectedBlueprintScopeId?: string;
  selectedRole: ChatRole;
  thinkingEffort: ChatThinkingEffort;
  setSessionsLoading: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string | undefined>>;
  setSessionViews: SetSessionViews;
  setActiveSessionViewId: Dispatch<SetStateAction<string | undefined>>;
  applySessionSelection: (patch: SessionSelectionPatch) => void;
}) {
  setSessionsLoading(true);
  setError(undefined);
  try {
    let sessions = await api.listChatSessions();
    if (sessions.length === 0) {
      const created = await api.createHivewardChatSession({
        harnessId,
        title: copy.newSessionViewTitle,
        modelId: defaultModelId || undefined,
        agentId: harnessId === "openclaw" ? agentId || undefined : undefined,
        thinkingEffort,
        permissionMode: resolveHarnessPermissionMode(harnessId, harnessPermissionModes),
        mode: chatMode,
        roleScope: buildChatRoleScope(selectedCompanyId, selectedRole, selectedBlueprintScopeId)
      });
      sessions = [created];
    }
    const nextActiveId =
      preferredSessionId && sessions.some((session) => session.id === preferredSessionId)
        ? preferredSessionId
        : activeSessionViewId && sessions.some((session) => session.id === activeSessionViewId)
          ? activeSessionViewId
          : sessions[0]?.id;
    const activeEvents = nextActiveId ? await api.getChatOutputEvents(nextActiveId) : [];
    const nextSessionViews = sessions.map((session) => ({
      ...session,
      messages: session.id === nextActiveId ? decorateAgentOutputMessages(activeEvents, copy) : []
    }));
    setSessionViews(nextSessionViews);
    setActiveSessionViewId(nextActiveId);
    const nextActiveSession = nextSessionViews.find((session) => session.id === nextActiveId);
    if (nextActiveSession) {
      applySessionSelection({
        harnessId: nextActiveSession.harnessId,
        modelId: nextActiveSession.modelId,
        agentId: nextActiveSession.agentId,
        thinkingEffort: nextActiveSession.thinkingEffort,
        chatMode: nextActiveSession.mode,
        roleScope: nextActiveSession.roleScope
      });
    }
  } catch (loadError) {
    setError(loadError instanceof Error ? loadError.message : copy.historyLoadFailed);
  } finally {
    setSessionsLoading(false);
  }
}

export async function saveSessionTitle({
  activeSessionView,
  copy,
  titleDraft,
  setTitleSaving,
  setError,
  setSessionViews,
  setTitleEditing
}: {
  activeSessionView?: HivewardSessionView;
  copy: ChatControllerCopy;
  titleDraft: string;
  setTitleSaving: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string | undefined>>;
  setSessionViews: SetSessionViews;
  setTitleEditing: Dispatch<SetStateAction<boolean>>;
}) {
  if (!activeSessionView) return;
  const nextTitle = titleDraft.trim();
  if (!nextTitle) return;
  setTitleSaving(true);
  setError(undefined);
  try {
    const titleResult = await api.updateHivewardChatSession(activeSessionView.id, { title: nextTitle });
    setSessionViews((current) =>
      current.map((sessionView) =>
        sessionView.id === activeSessionView.id
          ? {
              ...titleResult,
              messages: sessionView.messages,
              updatedAt: new Date().toISOString()
            }
          : sessionView
      )
    );
    setTitleEditing(false);
  } catch (titleError) {
    setError(titleError instanceof Error ? titleError.message : copy.titleUpdateFailed);
  } finally {
    setTitleSaving(false);
  }
}

export async function endActiveSession({
  activeSessionView,
  copy,
  setError,
  setSessionViews,
  setRebuildFromHivewardHistory
}: {
  activeSessionView?: HivewardSessionView;
  copy: ChatControllerCopy;
  setError: Dispatch<SetStateAction<string | undefined>>;
  setSessionViews: SetSessionViews;
  setRebuildFromHivewardHistory: Dispatch<SetStateAction<boolean>>;
}) {
  if (!activeSessionView || activeSessionView.status === "ended") return;
  setError(undefined);
  try {
    const ended = await api.endHivewardChatSession(activeSessionView.id);
    setSessionViews((current) =>
      current.map((sessionView) =>
        sessionView.id === ended.id
          ? {
              ...ended,
              messages: sessionView.messages
            }
          : sessionView
      )
    );
    setRebuildFromHivewardHistory(false);
  } catch (endError) {
    setError(endError instanceof Error ? endError.message : copy.sessionEndFailed);
  }
}

export async function updateActiveSessionPermissionMode({
  value,
  activePermissionMode,
  activeSessionView,
  copy,
  harnessId,
  setError,
  setSessionViews
}: {
  value: string;
  activePermissionMode?: ChatPermissionMode;
  activeSessionView?: HivewardSessionView;
  copy: ChatControllerCopy;
  harnessId: HarnessId;
  setError: Dispatch<SetStateAction<string | undefined>>;
  setSessionViews: SetSessionViews;
}) {
  if (!activeSessionView || activeSessionView.harnessId !== harnessId || !supportsChatPermissionMode(harnessId)) return;
  const permissionMode = value === "full_access" ? "full_access" : "safe";
  const previousPermissionMode = activeSessionView.permissionMode ?? activePermissionMode ?? "safe";
  setError(undefined);
  setSessionViews((current) =>
    current.map((sessionView) =>
      sessionView.id === activeSessionView.id
        ? {
            ...sessionView,
            permissionMode,
            updatedAt: new Date().toISOString()
          }
        : sessionView
    )
  );
  try {
    const updated = await api.updateHivewardChatSession(activeSessionView.id, { permissionMode });
    setSessionViews((current) =>
      current.map((sessionView) =>
        sessionView.id === updated.id
          ? {
              ...updated,
              messages: sessionView.messages
            }
          : sessionView
      )
    );
  } catch (permissionError) {
    setSessionViews((current) =>
      current.map((sessionView) =>
        sessionView.id === activeSessionView.id
          ? {
              ...sessionView,
              permissionMode: previousPermissionMode,
              updatedAt: new Date().toISOString()
            }
          : sessionView
      )
    );
    setError(permissionError instanceof Error ? permissionError.message : copy.permissionUpdateFailed);
  }
}

export async function createSessionView({
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
}: {
  agentId: string;
  chatMode: ChatMode;
  copy: ChatControllerCopy;
  harnessId: HarnessId;
  harnessPermissionModes?: Partial<Record<HarnessId, ChatPermissionMode>>;
  modelId: string;
  selectedBlueprintScopeId?: string;
  selectedCompanyId?: string;
  selectedRole: ChatRole;
  thinkingEffort: ChatThinkingEffort;
  setSessionViews: SetSessionViews;
  setActiveSessionViewId: Dispatch<SetStateAction<string | undefined>>;
  setRebuildFromHivewardHistory: Dispatch<SetStateAction<boolean>>;
  setDraft: Dispatch<SetStateAction<string>>;
  setAttachments: Dispatch<SetStateAction<ChatAttachment[]>>;
  setError: Dispatch<SetStateAction<string | undefined>>;
}) {
  try {
    const roleScope = buildChatRoleScope(selectedCompanyId, selectedRole, selectedBlueprintScopeId);
    const nextSession = await api.createHivewardChatSession({
      harnessId,
      title: copy.newSessionViewTitle,
      modelId: modelId || undefined,
      agentId: harnessId === "openclaw" ? agentId || undefined : undefined,
      thinkingEffort,
      permissionMode: resolveHarnessPermissionMode(harnessId, harnessPermissionModes),
      mode: chatMode,
      roleScope
    });
    const nextSessionView: HivewardSessionView = { ...nextSession, messages: [] };
    setSessionViews((current) => [nextSessionView, ...current]);
    setActiveSessionViewId(nextSessionView.id);
    setRebuildFromHivewardHistory(false);
    setDraft("");
    setAttachments([]);
    setError(undefined);
  } catch (sessionError) {
    setError(sessionError instanceof Error ? sessionError.message : copy.sessionCreateFailed);
  }
}

export async function loadSessionMessages({
  sessionViewId,
  copy,
  setHistoryLoadingSessionKey,
  setError,
  setSessionViews
}: {
  sessionViewId: string;
  copy: ChatControllerCopy;
  setHistoryLoadingSessionKey: Dispatch<SetStateAction<string | undefined>>;
  setError: Dispatch<SetStateAction<string | undefined>>;
  setSessionViews: SetSessionViews;
}) {
  setHistoryLoadingSessionKey(sessionViewId);
  try {
    const events = await api.getChatOutputEvents(sessionViewId);
    setSessionViews((current) =>
      current.map((sessionView) =>
        sessionView.id === sessionViewId
          ? {
              ...sessionView,
              messages: decorateAgentOutputMessages(events, copy),
              updatedAt: new Date().toISOString()
            }
          : sessionView
      )
    );
  } catch (historyError) {
    setError(historyError instanceof Error ? historyError.message : copy.historyLoadFailed);
  } finally {
    setHistoryLoadingSessionKey((current) => (current === sessionViewId ? undefined : current));
  }
}

export async function activateNativeSession({
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
}: {
  chatMode: ChatMode;
  copy: ChatControllerCopy;
  defaultAgentId: string;
  modelId: string;
  runtimeSessions: RuntimeOverview["sessions"];
  selectedBlueprintScopeId?: string;
  selectedCompanyId?: string;
  selectedRole: ChatRole;
  sessionKey: string;
  thinkingEffort: ChatThinkingEffort;
  setSessionViews: SetSessionViews;
  setActiveSessionViewId: Dispatch<SetStateAction<string | undefined>>;
  applySessionSelection: (patch: SessionSelectionPatch) => void;
  setRebuildFromHivewardHistory: Dispatch<SetStateAction<boolean>>;
  setDraft: Dispatch<SetStateAction<string>>;
  setAttachments: Dispatch<SetStateAction<ChatAttachment[]>>;
  setError: Dispatch<SetStateAction<string | undefined>>;
}) {
  const nativeSession = runtimeSessions.find((session) => session.id === sessionKey);
  try {
    const session = await api.createHivewardChatSession({
      harnessId: "openclaw",
      nativeSessionId: sessionKey,
      title: nativeSession ? formatNativeSessionLabel(nativeSession) : sessionKey,
      agentId: readAgentIdFromSessionKey(sessionKey) ?? defaultAgentId,
      modelId: modelId || undefined,
      thinkingEffort,
      mode: chatMode,
      roleScope: buildChatRoleScope(selectedCompanyId, selectedRole, selectedBlueprintScopeId)
    });
    setSessionViews((current) => [{ ...session, messages: [] }, ...current]);
    setActiveSessionViewId(session.id);
    applySessionSelection({ harnessId: "openclaw", agentId: session.agentId ?? defaultAgentId });
    setRebuildFromHivewardHistory(false);
    setDraft("");
    setAttachments([]);
    setError(undefined);
  } catch (sessionError) {
    setError(sessionError instanceof Error ? sessionError.message : copy.sessionCreateFailed);
  }
}

export async function refreshStreamingChatMessages({
  activeSessionView,
  copy,
  loadSessionMessages
}: {
  activeSessionView?: HivewardSessionView;
  copy: ChatControllerCopy;
  loadSessionMessages: (sessionViewId: string) => void | Promise<void>;
}) {
  if (!activeSessionView?.messages.some((message) => message.status === "streaming")) return;
  try {
    const serverEvents = await api.getChatOutputEvents(activeSessionView.id);
    const serverMessages = decorateAgentOutputMessages(serverEvents, copy);
    const shouldRefresh = shouldRefreshStreamingChatMessages({
      localMessages: activeSessionView.messages,
      serverMessages
    });
    if (shouldRefresh) {
      await loadSessionMessages(activeSessionView.id);
    }
  } catch {
    return;
  }
}

export async function selectHarness({
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
}: {
  nextHarnessId: HarnessId;
  agentId: string;
  chatMode: ChatMode;
  copy: ChatControllerCopy;
  harnessPermissionModes?: Partial<Record<HarnessId, ChatPermissionMode>>;
  modelId: string;
  selectedBlueprintScopeId?: string;
  selectedCompanyId?: string;
  selectedRole: ChatRole;
  sessionViews: HivewardSessionView[];
  thinkingEffort: ChatThinkingEffort;
  setSessionViews: SetSessionViews;
  setActiveSessionViewId: Dispatch<SetStateAction<string | undefined>>;
  applySessionSelection: (patch: SessionSelectionPatch) => void;
  setRebuildFromHivewardHistory: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string | undefined>>;
  loadSessionMessages: (sessionViewId: string) => void | Promise<void>;
}) {
  applySessionSelection({ harnessId: nextHarnessId });
  const existing = sessionViews.find((sessionView) => sessionView.harnessId === nextHarnessId && sessionView.status !== "ended");
  if (existing) {
    setActiveSessionViewId(existing.id);
    applySessionSelection({ roleScope: existing.roleScope });
    await loadSessionMessages(existing.id);
    return;
  }
  try {
    const session = await api.createHivewardChatSession({
      harnessId: nextHarnessId,
      title: copy.newSessionViewTitle,
      modelId: modelId || undefined,
      agentId: nextHarnessId === "openclaw" ? agentId || undefined : undefined,
      thinkingEffort,
      permissionMode: resolveHarnessPermissionMode(nextHarnessId, harnessPermissionModes),
      mode: chatMode,
      roleScope: buildChatRoleScope(selectedCompanyId, selectedRole, selectedBlueprintScopeId)
    });
    setSessionViews((current) => [{ ...session, messages: [] }, ...current]);
    setActiveSessionViewId(session.id);
    setRebuildFromHivewardHistory(false);
  } catch (sessionError) {
    setError(sessionError instanceof Error ? sessionError.message : copy.sessionCreateFailed);
  }
}

export async function selectAgent({
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
}: {
  nextAgentId: string;
  agentId: string;
  chatMode: ChatMode;
  copy: ChatControllerCopy;
  harnessId: HarnessId;
  modelId: string;
  selectedBlueprintScopeId?: string;
  selectedCompanyId?: string;
  selectedRole: ChatRole;
  thinkingEffort: ChatThinkingEffort;
  setSessionViews: SetSessionViews;
  setActiveSessionViewId: Dispatch<SetStateAction<string | undefined>>;
  applySessionSelection: (patch: SessionSelectionPatch) => void;
  setRebuildFromHivewardHistory: Dispatch<SetStateAction<boolean>>;
  setDraft: Dispatch<SetStateAction<string>>;
  setAttachments: Dispatch<SetStateAction<ChatAttachment[]>>;
  setError: Dispatch<SetStateAction<string | undefined>>;
}) {
  applySessionSelection({ agentId: nextAgentId });
  if (harnessId !== "openclaw" || nextAgentId === agentId) return;
  try {
    const session = await api.createHivewardChatSession({
      harnessId: "openclaw",
      title: copy.newSessionViewTitle,
      modelId: modelId || undefined,
      agentId: nextAgentId || undefined,
      thinkingEffort,
      mode: chatMode,
      roleScope: buildChatRoleScope(selectedCompanyId, selectedRole, selectedBlueprintScopeId)
    });
    const nextSessionView: HivewardSessionView = { ...session, messages: [] };
    setSessionViews((current) => [nextSessionView, ...current]);
    setActiveSessionViewId(nextSessionView.id);
    setRebuildFromHivewardHistory(false);
    setDraft("");
    setAttachments([]);
    setError(undefined);
  } catch (sessionError) {
    setError(sessionError instanceof Error ? sessionError.message : copy.sessionCreateFailed);
  }
}

export async function streamChatMessage({
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
  onStreamComplete
}: {
  activeSessionView: HivewardSessionView;
  agentId: string;
  attachments: ChatAttachment[];
  chatMode: ChatMode;
  copy: ChatControllerCopy;
  defaultModelId: string;
  draft: string;
  harnessId: HarnessId;
  harnessPermissionModes?: Partial<Record<HarnessId, ChatPermissionMode>>;
  messages: ChatMessage[];
  modelId: string;
  modelOptions: SelectOption[];
  onHumanActionQueueRefreshNeeded?: () => void | Promise<void>;
  rebuildFromHivewardHistory: boolean;
  selectedBlueprintScopeId?: string;
  selectedCompanyId?: string;
  selectedRole: ChatRole;
  selectedRoleLabel: string;
  thinkingEffort: ChatThinkingEffort;
  updateActiveSessionViewMessages: SetMessages;
  bindActiveSessionView: (event: AgentOutputEvent, eventHarnessId: HarnessId) => void;
  setDraft: Dispatch<SetStateAction<string>>;
  setAttachments: Dispatch<SetStateAction<ChatAttachment[]>>;
  setError: Dispatch<SetStateAction<string | undefined>>;
  setIsSending: Dispatch<SetStateAction<boolean>>;
  setRebuildFromHivewardHistory: Dispatch<SetStateAction<boolean>>;
  streamAbortRef: MutableRefObject<AbortController | null>;
  onStreamComplete: (sessionId: string) => void | Promise<void>;
}) {
  const controller = new AbortController();
  const content = draft.trim();
  const outgoingAttachments = attachments;
  const includePlatformContext = messages.length === 0;
  const roleScope = buildChatRoleScope(selectedCompanyId, selectedRole, selectedBlueprintScopeId);
  const sendHarnessId = harnessId;
  const sendHarnessLabel = formatHarnessLabel(sendHarnessId);
  const sendIsOpenClawHarness = sendHarnessId === "openclaw";
  const sendPermissionMode = resolveHarnessPermissionMode(sendHarnessId, harnessPermissionModes, activeSessionView);
  const sendModelId = modelOptions.some((option) => option.value === modelId) ? modelId : defaultModelId;
  const sendModelOption = modelOptions.find((option) => option.value === sendModelId);
  const sendThinkingEffort = resolveSupportedThinkingEffort(
    normalizeThinkingLevels(sendModelOption?.thinkingLevels),
    thinkingEffort
  );
  const now = new Date().toISOString();
  const userMessage: ChatMessage = {
    id: makeLocalId("chat-user"),
    sessionId: activeSessionView.id,
    role: "user",
    content: content || copy.attachmentOnlyMessage,
    createdAt: now,
    attachments: outgoingAttachments,
    status: "sent",
    speakerLabel: copy.you,
    harnessId: sendHarnessId
  };
  const assistantId = makeLocalId("chat-assistant");
  const assistantMessage: ChatMessage = {
    id: assistantId,
    sessionId: activeSessionView.id,
    role: "assistant",
    content: "",
    createdAt: now,
    status: "streaming",
    speakerLabel: `${selectedRoleLabel} / ${formatHarnessSpeaker(
      sendHarnessId,
      sendIsOpenClawHarness ? agentId : undefined
    )}`,
    harnessId: sendHarnessId,
    agentId: sendIsOpenClawHarness ? agentId : undefined,
    modelId: sendModelId
  };

  updateActiveSessionViewMessages((current) => [...current, userMessage, assistantMessage]);
  setDraft("");
  setAttachments([]);
  setError(undefined);
  setIsSending(true);
  streamAbortRef.current = controller;

  let progressTimer: number | undefined;
  try {
    const progressStartedAt = Date.now();
    progressTimer = window.setInterval(() => {
      const elapsedSeconds = Math.max(1, Math.floor((Date.now() - progressStartedAt) / 1000));
      updateActiveSessionViewMessages((current) =>
        current.map((item) =>
          item.id === assistantId && item.status === "streaming" && !item.content
            ? {
                ...item,
                progressText: formatWaitingProgress(copy, elapsedSeconds, Boolean(item.runtimeRef), sendHarnessLabel)
              }
            : item
        )
      );
    }, 10_000);

    if (controller.signal.aborted) throw new DOMException(copy.stopped, "AbortError");

    await api.streamSessionChat(
      activeSessionView.id,
      {
        message: content,
        attachments: outgoingAttachments,
        modelId: sendModelId || undefined,
        agentId: sendIsOpenClawHarness ? agentId || undefined : undefined,
        thinkingEffort: sendThinkingEffort,
        permissionMode: sendPermissionMode,
        includePlatformContext,
        mode: chatMode,
        roleScope,
        rebuildFromHivewardHistory
      },
      {
        onEvent: (event) => {
          applyAgentOutputEvent(assistantId, event, updateActiveSessionViewMessages, copy, sendHarnessId);
          if (event.kind === "message_started" || event.kind === "message_completed" || event.kind === "message_failed") {
            bindActiveSessionView(event, sendHarnessId);
          }
        }
      },
      controller.signal
    );
    setRebuildFromHivewardHistory(false);
    await onStreamComplete(activeSessionView.id);
  } catch (streamError) {
    if (controller.signal.aborted) {
      updateActiveSessionViewMessages((current) =>
        current.map((item) =>
          item.id === assistantId
            ? { ...item, progressText: undefined, runtimeStatus: undefined, content: item.content || copy.stopped, status: "sent" }
            : item
        )
      );
      return;
    }
    const message = streamError instanceof Error ? streamError.message : copy.sendFailed;
    setError(message);
    updateActiveSessionViewMessages((current) =>
      current.map((item) =>
        item.id === assistantId
          ? { ...item, progressText: undefined, runtimeStatus: undefined, content: item.content || message, status: "failed" }
          : item
      )
    );
  } finally {
    if (progressTimer !== undefined) window.clearInterval(progressTimer);
    if (streamAbortRef.current === controller) streamAbortRef.current = null;
    await onHumanActionQueueRefreshNeeded?.();
    setIsSending(false);
  }
}

export async function submitBlueprintProposal({
  activeSessionView,
  copy,
  message,
  selectedBlueprintScopeId,
  titleBlueprint,
  setError,
  setProposalSubmittingMessageId,
  setSubmittedBlueprintProposalMessageIds,
  onHumanActionQueueRefreshNeeded
}: {
  activeSessionView?: HivewardSessionView;
  copy: ChatControllerCopy;
  message: ChatMessage;
  selectedBlueprintScopeId?: string;
  titleBlueprint?: BlueprintDefinition;
  setError: Dispatch<SetStateAction<string | undefined>>;
  setProposalSubmittingMessageId: Dispatch<SetStateAction<string | undefined>>;
  setSubmittedBlueprintProposalMessageIds: Dispatch<SetStateAction<Set<string>>>;
  onHumanActionQueueRefreshNeeded?: () => void | Promise<void>;
}) {
  if (!activeSessionView || !canSubmitBlueprintProposalMessage(message, activeSessionView)) return;
  const sourceRole = executiveSourceRoleForSession(activeSessionView);
  if (!sourceRole) return;
  const blueprintId = activeSessionView.roleScope?.blueprintId ?? selectedBlueprintScopeId;
  if (sourceRole === "leader" && !blueprintId) {
    setError(copy.blueprintProposalSubmitFailed);
    return;
  }

  setProposalSubmittingMessageId(message.id);
  setError(undefined);
  try {
    await api.executeExecutiveCommand(activeSessionView.id, {
      action: "submit_blueprint_proposal",
      sourceRole,
      payload: {
        title: deriveBlueprintProposalTitle(message.content, titleBlueprint, copy),
        bodyMarkdown: message.content,
        ...(blueprintId ? { blueprintId } : {}),
        sourceMessageId: message.id
      }
    });
    setSubmittedBlueprintProposalMessageIds((current) => new Set(current).add(message.id));
    await onHumanActionQueueRefreshNeeded?.();
  } catch (submitError) {
    setError(submitError instanceof Error ? submitError.message : copy.blueprintProposalSubmitFailed);
  } finally {
    setProposalSubmittingMessageId((current) => (current === message.id ? undefined : current));
  }
}

export async function refreshCompletedStreamSession({
  sessionId,
  getActiveSessionViewId,
  loadChatSessions,
  loadSessionMessages
}: {
  sessionId: string;
  getActiveSessionViewId: () => string | undefined;
  loadChatSessions: (preferredSessionId?: string) => void | Promise<void>;
  loadSessionMessages: (sessionViewId: string) => void | Promise<void>;
}) {
  if (getActiveSessionViewId() === sessionId) {
    await loadChatSessions(sessionId);
    return;
  }
  await loadSessionMessages(sessionId);
}

export function canSubmitBlueprintProposalMessage(message: ChatMessage, sessionView: HivewardSessionView | undefined): boolean {
  if (!sessionView || sessionView.mode !== "blueprint") return false;
  if (message.role !== "assistant") return false;
  if (message.status === "streaming" || message.status === "failed") return false;
  if (!message.content.trim()) return false;
  const sourceRole = executiveSourceRoleForSession(sessionView);
  return sourceRole === "ceo" || sourceRole === "leader";
}

export function resolveHarnessPermissionMode(
  harnessId: HarnessId,
  harnessPermissionModes: Partial<Record<HarnessId, ChatPermissionMode>> | undefined,
  session?: HivewardChatSession
): ChatPermissionMode | undefined {
  if (!supportsChatPermissionMode(harnessId)) return undefined;
  return session?.permissionMode ?? harnessPermissionModes?.[harnessId] ?? "safe";
}

export function supportsChatPermissionMode(harnessId: HarnessId): boolean {
  return harnessId === "codex" || harnessId === "claudeCode" || harnessId === "google" || harnessId === "cursor" || harnessId === "opencode" || harnessId === "hermes";
}

function buildChatRoleScope(
  selectedCompanyId: string | undefined,
  selectedRole: ChatRole,
  selectedBlueprintScopeId: string | undefined
): ChatRoleScope | undefined {
  if (!selectedCompanyId || !selectedRole) return undefined;
  if (selectedRole.kind === "ceo") {
    return { role: "ceo", companyId: selectedCompanyId };
  }
  return {
    role: "leader",
    companyId: selectedCompanyId,
    leaderId: selectedRole.id,
    blueprintId: selectedBlueprintScopeId ?? selectedRole.blueprintId
  };
}

function applyAgentOutputEvent(
  assistantId: string,
  event: AgentOutputEvent,
  setMessages: SetMessages,
  copy: ChatControllerCopy,
  fallbackHarnessId: HarnessId
) {
  if (event.kind === "message_delta") {
    setMessages((current) =>
      current.map((message) =>
        message.id === assistantId
          ? {
              ...message,
              content: event.metadata?.replace === true ? event.delta ?? "" : `${message.content}${event.delta ?? ""}`,
              progressText: undefined
            }
          : message
      )
    );
    return;
  }

  if (event.kind === "runtime_state") {
    setMessages((current) =>
      current.map((message) =>
        message.id === assistantId
          ? updateMessageRuntimeActivity(message, event)
          : message
      )
    );
    return;
  }

  if (event.kind === "message_started") {
    const harnessLabel = formatHarnessLabel(readOutputRuntimeString(event, "source") ?? fallbackHarnessId);
    setMessages((current) =>
      current.map((message) =>
        message.id === assistantId
          ? {
              ...message,
              progressText: message.content ? undefined : copy.acceptedWaiting(harnessLabel),
              runtimeStatus: undefined,
              runtimeRef: toRuntimeRef(event, message.runtimeActivities ?? message.runtimeRef?.activity),
              runtimeActivities: message.runtimeActivities ?? message.runtimeRef?.activity
            }
          : message
      )
    );
    return;
  }

  if (event.kind === "message_completed" || event.kind === "message_failed") {
    setMessages((current) =>
      current.map((message) =>
        message.id === assistantId
          ? {
              ...message,
              progressText: undefined,
              runtimeStatus: undefined,
              content: message.content || event.bodyMarkdown || readOutputRuntimeString(event, "error") || "",
              status: event.kind === "message_failed" || readOutputRuntimeString(event, "status") === "failed" || readOutputRuntimeString(event, "status") === "cancelled" ? "failed" : "sent",
              runtimeRef: toRuntimeRef(event, message.runtimeActivities ?? message.runtimeRef?.activity),
              runtimeActivities: message.runtimeActivities ?? message.runtimeRef?.activity
            }
          : message
      )
    );
    return;
  }

  const errorMessage = formatAgentOutputError(event, copy);
  setMessages((current) =>
    current.map((message) =>
      message.id === assistantId
        ? { ...message, progressText: undefined, runtimeStatus: undefined, content: message.content || errorMessage, status: "failed" }
        : message
    )
  );
}

function updateMessageRuntimeActivity(message: ChatMessage, event: AgentOutputEvent): ChatMessage {
  const runtimeStatus = toChatRuntimeStatus(event);
  const activity = toRuntimeActivity(event);
  if (!activity || !runtimeStatus) return message;
  const runtimeActivities = upsertRuntimeActivity(message.runtimeActivities ?? message.runtimeRef?.activity ?? [], activity);
  return {
    ...message,
    runtimeStatus,
    runtimeActivities,
    runtimeRef: message.runtimeRef
      ? {
          ...message.runtimeRef,
          activity: runtimeActivities,
          updatedAt: activity.updatedAt
        }
      : message.runtimeRef
  };
}

function toRuntimeActivity(event: AgentOutputEvent): ChatRuntimeActivity | undefined {
  const phase = event.runtimeState?.phase;
  const label = event.runtimeState?.label;
  const source = event.runtimeState?.source;
  if ((phase !== "thinking" && phase !== "tool" && phase !== "command") || typeof label !== "string" || !isRuntimeObjectSource(source)) {
    return undefined;
  }
  const activityStatus = event.runtimeState?.activityStatus;
  return {
    id: readOutputRuntimeString(event, "activityId") ?? `${source}:${phase}:${label}`,
    source,
    phase,
    label,
    status: activityStatus === "started" || activityStatus === "completed" ? activityStatus : "updated",
    updatedAt: readOutputRuntimeString(event, "updatedAt") ?? event.createdAt
  };
}

function upsertRuntimeActivity(current: ChatRuntimeActivity[], activity: ChatRuntimeActivity): ChatRuntimeActivity[] {
  const index = current.findIndex((item) => item.id === activity.id);
  if (index < 0) return [...current, activity];
  return current.map((item, itemIndex) => itemIndex === index ? { ...item, ...activity } : item);
}

function formatAgentOutputError(event: AgentOutputEvent, copy: ChatControllerCopy): string {
  const code = readOutputRuntimeString(event, "code");
  if (code === "openclaw_gateway_not_configured") return copy.openClawGatewayNotConfigured;
  if (code === "openclaw_gateway_unreachable") return copy.openClawGatewayUnreachable;
  if (code === "openclaw_gateway_not_connected") return copy.openClawGatewayNotConnected;
  return event.bodyMarkdown ?? readOutputRuntimeString(event, "error") ?? copy.runtimeError;
}

function formatWaitingProgress(copy: ChatControllerCopy, elapsedSeconds: number, accepted: boolean, harnessLabel: string): string {
  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  const elapsed = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
  return `${accepted ? copy.acceptedWaiting(harnessLabel) : copy.waiting(harnessLabel)} ${elapsed}`;
}

function toRuntimeRef(event: AgentOutputEvent, activity?: ChatRuntimeActivity[]): ChatRuntimeRef | undefined {
  const taskId = readOutputRuntimeString(event, "taskId");
  const runId = readOutputRuntimeString(event, "runId");
  const sessionKey = readOutputRuntimeString(event, "sessionKey");
  const source = event.runtimeState?.source;
  const status = readOutputRuntimeString(event, "status");
  if (!taskId || !runId || !sessionKey || !isRuntimeObjectSource(source) || !status) return undefined;
  return {
    taskId,
    runId,
    sessionKey,
    source,
    status,
    updatedAt: readOutputRuntimeString(event, "updatedAt") ?? event.createdAt,
    error: readOutputRuntimeString(event, "error"),
    usage: readOutputRuntimeRecord(event, "usage") as ChatRuntimeRef["usage"],
    timings: readOutputRuntimeRecord(event, "timings") as ChatRuntimeRef["timings"],
    activity: activity?.length ? activity : undefined
  };
}

function decorateAgentOutputMessages(events: readonly AgentOutputEvent[], copy: ChatControllerCopy): ChatMessage[] {
  return projectModelOutputThread(events).map((message) => ({
    ...message,
    runtimeStatus: message.runtimeStatus,
    speakerLabel: message.role === "user" ? copy.you : formatHarnessLabel(message.harnessId ?? "openclaw")
  }));
}

function readOutputRuntimeString(event: AgentOutputEvent, key: string): string | undefined {
  const value = event.runtimeState?.[key];
  return typeof value === "string" && value ? value : undefined;
}

function readOutputRuntimeRecord(event: AgentOutputEvent, key: string): Record<string, unknown> | undefined {
  const value = event.runtimeState?.[key];
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function isRuntimeObjectSource(value: unknown): value is ChatRuntimeRef["source"] {
  return value === "openclaw" ||
    value === "claude" ||
    value === "codex" ||
    value === "google" ||
    value === "cursor" ||
    value === "opencode" ||
    value === "hermes";
}

function readAgentIdFromSessionKey(sessionKey: string): string | undefined {
  const parsed = parseAgentSessionKey(sessionKey);
  return parsed?.agentId;
}

function parseAgentSessionKey(sessionKey: string): { agentId: string; rest: string } | undefined {
  const [agentId, ...restParts] = sessionKey.split(":");
  if (!agentId || restParts.length === 0) return undefined;
  return { agentId: normalizeSessionAgentId(agentId), rest: restParts.join(":") };
}

function normalizeSessionAgentId(agentId: string | undefined): string {
  return agentId?.trim().toLowerCase() || "";
}

function formatNativeSessionLabel(session: { id: string; title: string }): string {
  return session.title || session.id;
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

function deriveSessionViewTitle(sessionView: HivewardSessionView, messages: ChatMessage[], copy: ChatControllerCopy): string {
  if (sessionView.messages.length > 0 && sessionView.title !== copy.newSessionViewTitle) return sessionView.title;
  const firstUserMessage = messages.find((message) => message.role === "user")?.content.trim();
  if (!firstUserMessage) return sessionView.title || copy.newSessionViewTitle;
  return firstUserMessage.length > 24 ? `${firstUserMessage.slice(0, 24)}...` : firstUserMessage;
}

export function updateSessionViewMessages({
  copy,
  sessionView,
  nextMessagesAction
}: {
  copy: ChatControllerCopy;
  sessionView: HivewardSessionView;
  nextMessagesAction: SetStateAction<ChatMessage[]>;
}): HivewardSessionView {
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
}

export function bindSessionViewToOutputEvent({
  event,
  eventHarnessId,
  sessionView
}: {
  event: AgentOutputEvent;
  eventHarnessId: HarnessId;
  sessionView: HivewardSessionView;
}): HivewardSessionView {
  const sessionKey = readOutputRuntimeString(event, "sessionKey");
  return {
    ...sessionView,
    harnessId: eventHarnessId,
    nativeSessionId: sessionKey || undefined,
    nativeSessionState: sessionKey ? "resumable" : sessionView.nativeSessionState,
    updatedAt: readOutputRuntimeString(event, "updatedAt") ?? event.createdAt
  };
}

function executiveSourceRoleForSession(sessionView: HivewardSessionView | undefined): "ceo" | "leader" | undefined {
  const role = sessionView?.roleScope?.role;
  return role === "ceo" || role === "leader" ? role : undefined;
}

function deriveBlueprintProposalTitle(
  content: string,
  blueprint: BlueprintDefinition | undefined,
  copy: ChatControllerCopy
): string {
  const line = content
    .split(/\r?\n/)
    .map((item) => item.replace(/^#+\s*/, "").replace(/\*\*/g, "").trim())
    .find((item) => item && item !== "```json" && item !== "```" && !item.startsWith("{") && !item.startsWith("["));
  const fallback = blueprint ? `${blueprint.name} ${copy.blueprintProposalTitle}` : copy.blueprintProposalTitle;
  const title = line ?? fallback;
  return title.length > 80 ? `${title.slice(0, 77)}...` : title;
}

function formatHarnessSpeaker(harnessId: string, agentId?: string): string {
  const harnessLabel = formatHarnessLabel(harnessId);
  return agentId ? `${harnessLabel} / ${agentId}` : harnessLabel;
}

function formatHarnessLabel(harnessId: string): string {
  return harnessLikeDisplayLabel(harnessId);
}

function makeLocalId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}
