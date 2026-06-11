import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  CheckCircle2,
  CircleAlert,
  Cloud,
  Download,
  ExternalLink,
  Github,
  Plus,
  Puzzle,
  RefreshCw,
  Save,
  Settings,
  Trash2,
  X
} from "lucide-react";
import type {
  ApplyHivewardUpdateResponse,
  CatalogSnapshot,
  ChatPermissionMode,
  ClaudeCodeModelConfig,
  ClaudeCodeModelPreset,
  ClaudeCodeSavedModelProfile,
  ConfigureOpenClawChannelRequest,
  CreateHermesChannelRequest,
  CreateHermesProfileRequest,
  HarnessId,
  HarnessSkillInstallStatus,
  HarnessSkillStatusResponse,
  HarnessStatus,
  HermesConfigResponse,
  HivewardUpdateStatus,
  OpenClawConfigState,
  OpenClawVersionInfo,
  RuntimeOverview,
  UpdateClaudeCodeModelConfigRequest
} from "@hiveward/shared";
import { getVisibleClaudeCodeSavedProfiles, isClaudeCodeSavedProfileActiveProvider } from "../../lib/claude-code-saved-profiles";
import { harnessDisplayLabel, harnessDisplayParts } from "../../lib/harness-labels";
import type { Language } from "../../lib/i18n";
import { HarnessLabel } from "../../components/HarnessLabel";
import { ConfiguredModelCard, IdentityTitle } from "../workspace/WorkspacePages";

const hivewardRepositoryUrl = "https://github.com/Chaunyzhang/HiveWard";

export type OpenClawPanelCopy = {
  title: string;
  subtitle: string;
  openPanel: string;
  version: string;
  gateway: string;
  config: string;
  activity: string;
  available: string;
  unavailable: string;
  configured: string;
  notConfigured: string;
  environment: string;
  configFile: string;
  none: string;
  url: string;
  origin: string;
  locale: string;
  source: string;
  auth: string;
  requestTimeout: string;
  agentStartTimeout: string;
  configPath: string;
  workspace: string;
  defaultModel: string;
  models: string;
  agents: string;
  channels: string;
  catalogRefreshed: string;
  lastChecked: string;
  checkUpdates: string;
  checking: string;
  skills: string;
  skillsReady: string;
  skillsMissing: string;
  skillsUnsupported: string;
  installSkills: string;
  installingSkills: string;
  skillStatus: Record<HarnessSkillInstallStatus, string>;
};

export function HivewardHomePage({
  ui,
  language,
  versionLabel,
  update,
  updateResult,
  checking,
  updating,
  onCheckUpdate,
  onApplyUpdate,
  onForceUpdate
}: {
  ui: HivewardHomeCopy;
  language: Language;
  versionLabel: string;
  update?: HivewardUpdateStatus;
  updateResult?: ApplyHivewardUpdateResponse;
  checking: boolean;
  updating: boolean;
  onCheckUpdate: () => void;
  onApplyUpdate: () => void;
  onForceUpdate: () => void;
}) {
  const updateAvailable = Boolean(update?.updateAvailable);
  const updateStatusLabel = update?.error
    ? ui.updateUnknown
    : updateAvailable
      ? ui.updateAvailable
      : update
        ? ui.upToDate
        : ui.updateUnknown;
  const updateTone = update?.error ? "offline" : updateAvailable ? "update" : "online";
  const latestLabel = update?.latestVersion
    ? `v${update.latestVersion}`
    : update?.latestCommit
      ? shortCommit(update.latestCommit)
      : ui.none;
  const sourceLabel = update?.source === "npm" ? "npm" : "GitHub";
  const canApply = Boolean(update?.updateAvailable && update.canApply && !updating);
  const canForceApply = Boolean(
    update?.updateAvailable && update.source === "git" && !update.canApply && update.canForceApply !== false && !updating
  );

  return (
    <section className="hiveward-home-page" aria-label="Hiveward">
      <div className="hiveward-home-hero">
        <img className="hiveward-home-logo" src="/brand/hiveward-hive.png" alt="Hiveward" />
        <div className="hiveward-home-title">
          <span>{versionLabel}</span>
          <h2>{ui.title}</h2>
          <p>{ui.subtitle}</p>
        </div>
        <div className="hiveward-home-actions">
          <a className="primary-link-button" href={hivewardRepositoryUrl} target="_blank" rel="noreferrer">
            <Github size={16} />
            {ui.github}
            <ExternalLink size={13} />
          </a>
          <button type="button" onClick={onCheckUpdate} disabled={checking || updating}>
            <RefreshCw size={14} className={checking ? "spin" : undefined} />
            {checking ? ui.checking : ui.checkUpdate}
          </button>
        </div>
      </div>

      <div className="hiveward-update-panel">
        <div className="hiveward-update-head">
          <div>
            <span className={`openclaw-panel-state ${updateTone}`}>{updateStatusLabel}</span>
            <h3>{ui.updateTitle}</h3>
          </div>
          <div className="hiveward-update-actions">
            {canForceApply && (
              <button type="button" className="danger-action" onClick={onForceUpdate} disabled={updating}>
                <CircleAlert size={14} />
                {ui.forceUpdate}
              </button>
            )}
            <button type="button" onClick={onApplyUpdate} disabled={!canApply}>
              <Download size={14} className={updating ? "spin" : undefined} />
              {updating ? ui.updating : ui.applyUpdate}
            </button>
          </div>
        </div>
        <div className="openclaw-panel-metrics">
          <OpenClawPanelMetric label={ui.current} value={versionLabel} />
          <OpenClawPanelMetric label={ui.latest} value={latestLabel} tone={updateAvailable ? "offline" : "online"} />
          <OpenClawPanelMetric label={ui.source} value={sourceLabel} />
          <OpenClawPanelMetric label={ui.lastChecked} value={formatDateTimeLabel(update?.checkedAt, language, ui.none)} />
        </div>
        {update?.error && <p className="hiveward-update-note">{update.error}</p>}
        {update && !update.canApply && update.updateAvailable && <p className="hiveward-update-note">{ui.cannotAutoApply}</p>}
        {updateResult && (
          <p className="hiveward-update-note">
            {updateResult.applied ? ui.updateApplied : updateResult.output || ui.updateSkipped}
          </p>
        )}
      </div>

      <div className="hiveward-readme-layout">
        <div className="hiveward-readme-left">
          <article className="hiveward-readme-main">
            {ui.readmeSections.map((section) => (
              <section key={section.title} className="hiveward-readme-section">
                <h3>{section.title}</h3>
                {section.paragraphs.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
                {section.items && (
                  <ul>
                    {section.items.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </article>
        </div>
        <aside className="hiveward-community-panel">
          <div className="hiveward-community-qr">
            <img src="/community/wechat-group.jpg" alt={ui.communityTitle} />
          </div>
          <h3>{ui.communityTitle}</h3>
          <p>{ui.communityPlaceholder}</p>
        </aside>
      </div>
    </section>
  );
}

export function OpenClawControlPanelPage({
  ui,
  language,
  openClawVersionLabel,
  openClawVersionHealthy,
  openClawVersion,
  openClawConfig,
  catalog,
  runtime,
  gatewaySettings,
  gatewayStatusLabel,
  gatewaySourceLabel,
  gatewayAuthLabel,
  harnessStatus,
  busy,
  skillStatus,
  skillBusy,
  onCheckUpdates,
  onInstallSkills
}: {
  ui: OpenClawPanelCopy;
  language: Language;
  openClawVersionLabel: string;
  openClawVersionHealthy: boolean;
  openClawVersion?: OpenClawVersionInfo;
  openClawConfig?: OpenClawConfigState;
  catalog?: CatalogSnapshot;
  runtime?: RuntimeOverview;
  gatewaySettings?: OpenClawConfigState["gateway"];
  gatewayStatusLabel: string;
  gatewaySourceLabel: string;
  gatewayAuthLabel: string;
  harnessStatus?: HarnessStatus;
  busy: boolean;
  skillStatus?: HarnessSkillStatusResponse;
  skillBusy: boolean;
  onCheckUpdates: () => void;
  onInstallSkills: () => void;
}) {
  return (
    <section id="openclaw-control-panel" className="page-grid openclaw-control-page">
      <div className="trace-page-title openclaw-page-title">
        <div className="openclaw-panel-title">
          <Cloud size={18} />
          <div>
            <strong>{ui.title}</strong>
            <span>{ui.subtitle}</span>
          </div>
        </div>
        <div className="openclaw-page-actions">
          <span className={`openclaw-panel-state ${openClawVersionHealthy ? "online" : "offline"}`}>
            {openClawVersionHealthy ? ui.available : ui.unavailable}
          </span>
          <button type="button" onClick={onCheckUpdates} disabled={busy}>
            <RefreshCw size={14} className={busy ? "spin" : undefined} />
            {busy ? ui.checking : ui.checkUpdates}
          </button>
        </div>
      </div>

      <div className="content-card stack-card openclaw-status-card">
        <div className="openclaw-panel-metrics">
          <OpenClawPanelMetric label={ui.version} value={openClawVersionLabel} />
          <OpenClawPanelMetric label={ui.gateway} value={gatewayStatusLabel} tone={gatewaySettings?.url ? "online" : "offline"} />
          <OpenClawPanelMetric label={ui.config} value={(openClawConfig?.configuredModels.length ?? 0) + (openClawConfig?.configuredAgents.length ?? 0)} />
          <OpenClawPanelMetric label={ui.activity} value={runtime?.tasks.length ?? 0} />
        </div>
      </div>

      <HarnessStatusBlock
        status={harnessStatus}
        language={language}
        fallbackLabel={harnessDisplayLabel("openclaw")}
        fallbackHarnessId="openclaw"
        skillsCard={
          <HarnessSkillsCard
            variant="summary"
            ui={ui}
            skillStatus={skillStatus}
            language={language}
            busy={skillBusy}
            onInstallSkills={onInstallSkills}
          />
        }
      />

      <div className="openclaw-control-grid">
        <div className="content-card stack-card openclaw-control-section">
          <div className="card-title-block">
            <h3>{ui.gateway}</h3>
          </div>
          <OpenClawPanelRow label={ui.url} value={gatewaySettings?.url ?? ui.none} />
          <OpenClawPanelRow label={ui.origin} value={gatewaySettings?.origin ?? ui.none} />
          <OpenClawPanelRow label={ui.source} value={gatewaySourceLabel} />
          <OpenClawPanelRow label={ui.auth} value={gatewayAuthLabel} />
          <OpenClawPanelRow label={ui.locale} value={gatewaySettings?.locale ?? ui.none} />
          <OpenClawPanelRow label={ui.requestTimeout} value={formatDurationMs(gatewaySettings?.requestTimeoutMs, ui.none)} />
          <OpenClawPanelRow label={ui.agentStartTimeout} value={formatDurationMs(gatewaySettings?.agentStartTimeoutMs, ui.none)} />
        </div>

        <div className="content-card stack-card openclaw-control-section">
          <div className="card-title-block">
            <h3>{ui.config}</h3>
          </div>
          <OpenClawPanelRow label={ui.configPath} value={openClawConfig?.configPath ?? ui.none} />
          <OpenClawPanelRow label={ui.workspace} value={openClawConfig?.defaultWorkspace ?? ui.none} />
          <OpenClawPanelRow label={ui.defaultModel} value={openClawConfig?.defaultModelId ?? ui.none} />
          <OpenClawPanelRow label={ui.models} value={(openClawConfig?.configuredModels.length ?? catalog?.models.length ?? 0).toLocaleString(language)} />
          <OpenClawPanelRow label={ui.agents} value={(openClawConfig?.configuredAgents.length ?? catalog?.agents.length ?? 0).toLocaleString(language)} />
          <OpenClawPanelRow label={ui.channels} value={(openClawConfig?.configuredChannels.length ?? catalog?.channels.length ?? 0).toLocaleString(language)} />
          <OpenClawPanelRow label={ui.catalogRefreshed} value={formatDateTimeLabel(catalog?.refreshedAt, language, ui.none)} />
          <OpenClawPanelRow label={ui.lastChecked} value={formatDateTimeLabel(openClawVersion?.resolvedAt, language, ui.none)} />
        </div>
      </div>
    </section>
  );
}

export function HarnessConfigPage({
  title,
  description,
  status,
  fallbackLabel,
  fallbackHarnessId,
  language,
  busy,
  skillStatus,
  skillBusy,
  permissionMode,
  onPermissionModeChange,
  onRefresh,
  onInstallSkills,
  children
}: {
  title: string;
  description: string;
  status?: HarnessStatus;
  fallbackLabel: string;
  fallbackHarnessId?: HarnessId;
  language: Language;
  busy: boolean;
  skillStatus?: HarnessSkillStatusResponse;
  skillBusy: boolean;
  permissionMode?: ChatPermissionMode;
  onPermissionModeChange?: (permissionMode: ChatPermissionMode) => void;
  onRefresh: () => void;
  onInstallSkills: () => void;
  children?: ReactNode;
}) {
  const copy = harnessStatusCopy(language);
  const skillUi = openClawPanelSkillCopy(language);
  const permissionCopy = harnessPermissionCopy(language);
  const connectionState = status?.connectionState ?? "unavailable";
  const healthy = connectionState === "connected" || connectionState === "available";
  return (
    <section className="page-grid openclaw-control-page">
      <div className="trace-page-title openclaw-page-title">
        <div className="openclaw-panel-title">
          <Settings size={18} />
          <div>
            <strong>{title}</strong>
            <span>{description}</span>
          </div>
        </div>
        <div className="openclaw-page-actions">
          <span className={`openclaw-panel-state ${healthy ? "online" : "offline"}`}>{copy.states[connectionState]}</span>
          <button type="button" onClick={onRefresh} disabled={busy}>
            <RefreshCw size={14} className={busy ? "spin" : undefined} />
            {busy ? copy.checking : copy.check}
          </button>
        </div>
      </div>

      <HarnessStatusBlock
        status={status}
        language={language}
        fallbackLabel={fallbackLabel}
        fallbackHarnessId={fallbackHarnessId}
        skillsCard={
          <HarnessSkillsCard
            variant="summary"
            ui={skillUi}
            skillStatus={skillStatus}
            language={language}
            busy={skillBusy}
            onInstallSkills={onInstallSkills}
          />
        }
      />

      {permissionMode && onPermissionModeChange ? (
        <div className="content-card stack-card harness-permission-card">
          <div className="card-title-block harness-permission-title">
            <h3>{permissionCopy.title}</h3>
            <span className="harness-permission-help" tabIndex={0} aria-label={permissionCopy.helpAria}>
              <CircleAlert size={14} />
              <span className="harness-permission-tooltip" role="tooltip">
                <strong>{permissionMode === "full_access" ? permissionCopy.fullLabel : permissionCopy.safeLabel}</strong>
                <span>{permissionMode === "full_access" ? permissionCopy.fullBody : permissionCopy.safeBody}</span>
                <span>{permissionMode === "full_access" ? permissionCopy.fullWarning : permissionCopy.safeWarning}</span>
              </span>
            </span>
          </div>
          <label className={`harness-permission-toggle ${permissionMode === "full_access" ? "enabled" : ""}`}>
            <input
              type="checkbox"
              checked={permissionMode === "full_access"}
              onChange={(event) => onPermissionModeChange(event.target.checked ? "full_access" : "safe")}
            />
            <span className="harness-permission-switch" aria-hidden="true" />
            <span className="harness-permission-copy">
              <strong>{permissionMode === "full_access" ? permissionCopy.fullLabel : permissionCopy.safeLabel}</strong>
            </span>
          </label>
        </div>
      ) : null}

      {children}
    </section>
  );
}

type ClaudeCodeModelSlotField = "fallbackModelId" | "haikuModelId" | "sonnetModelId" | "opusModelId";

export function ClaudeCodeModelsPage({
  config,
  presets,
  savedProfiles,
  status,
  language,
  busy,
  busyAction,
  refreshBusy,
  onRefresh,
  onUpdate,
  onSaveProfile,
  onApplyProfile,
  onDeleteProfile
}: {
  config?: ClaudeCodeModelConfig;
  presets: ClaudeCodeModelPreset[];
  savedProfiles: ClaudeCodeSavedModelProfile[];
  status?: HarnessStatus;
  language: Language;
  busy: boolean;
  busyAction?: string;
  refreshBusy: boolean;
  onRefresh: () => void;
  onUpdate: (input: UpdateClaudeCodeModelConfigRequest) => void;
  onSaveProfile: () => void;
  onApplyProfile: (profileId: string) => void;
  onDeleteProfile: (profileId: string) => void;
}) {
  const copy =
    language === "zh-CN"
      ? {
          configuredModels: "\u5df2\u914d\u7f6e\u6a21\u578b",
          savedModels: "\u5df2\u4fdd\u5b58\u6a21\u578b",
          configureModels: "\u6a21\u578b\u914d\u7f6e",
          refresh: "\u91cd\u65b0\u68c0\u67e5",
          refreshing: "\u68c0\u67e5\u4e2d",
          empty: "\u914d\u7f6e\u6570\u636e\u5c1a\u672a\u52a0\u8f7d",
          noSavedProfiles: "\u5c1a\u672a\u4fdd\u5b58\u6a21\u578b\u914d\u7f6e",
          saveCurrent: "\u4fdd\u5b58\u5f53\u524d\u914d\u7f6e",
          savingCurrent: "\u4fdd\u5b58\u4e2d",
          applyProfile: "\u542f\u7528",
          activeProfile: "\u5df2\u542f\u7528",
          applyingProfile: "\u542f\u7528\u4e2d",
          deleteProfile: "\u5220\u9664",
          switchModel: "\u5207\u6362",
          saveSwitch: "\u4fdd\u5b58",
          cancel: "\u53d6\u6d88",
          provider: "\u5e73\u53f0",
          defaultModel: "\u9ed8\u8ba4",
          lightModel: "\u8f7b\u91cf",
          primaryModel: "\u4e3b\u529b",
          advancedModel: "\u9ad8\u9636"
        }
      : {
          configuredModels: "Configured models",
          savedModels: "Saved models",
          configureModels: "Model config",
          refresh: "Refresh",
          refreshing: "Checking",
          empty: "Config data not loaded",
          noSavedProfiles: "No saved model configs yet",
          saveCurrent: "Save current config",
          savingCurrent: "Saving",
          applyProfile: "Use",
          activeProfile: "Enabled",
          applyingProfile: "Using",
          deleteProfile: "Delete",
          switchModel: "Switch",
          saveSwitch: "Save",
          cancel: "Cancel",
          provider: "Provider",
          defaultModel: "Default",
          lightModel: "Light",
          primaryModel: "Primary",
          advancedModel: "Advanced"
        };
  const modelCardCopy =
    language === "zh-CN"
      ? {
          usage: "\u7528\u91cf",
          calls: "\u8c03\u7528",
          tokens: "Token",
          cost: "\u8d39\u7528",
          recent7d: "\u6700\u8fd1 7 \u5929",
          defaultOption: "\u9ed8\u8ba4"
        }
      : {
          usage: "Usage",
          calls: "Calls",
          tokens: "Tokens",
          cost: "Cost",
          recent7d: "Last 7 days",
          defaultOption: "Default"
        };
  const configuredModels = useMemo(() => buildConfiguredClaudeCodeModels(config, presets, language), [config, language, presets]);
  const modelOptions = useMemo(() => buildClaudeCodeModelOptions(status, presets), [presets, status?.models]);
  const activeProviderModelOptions = useMemo(
    () => buildClaudeCodeModelOptions(status, presets, config?.providerPresetId),
    [config?.providerPresetId, presets, status?.models]
  );
  const [visibleSavedProfiles, setVisibleSavedProfiles] = useState<ClaudeCodeSavedModelProfile[]>(() => getVisibleClaudeCodeSavedProfiles(savedProfiles));
  const [slotDrafts, setSlotDrafts] = useState<Partial<Record<ClaudeCodeModelSlotField, string>>>({});
  const [editingSlot, setEditingSlot] = useState<ClaudeCodeModelSlotField | undefined>();

  useEffect(() => {
    setVisibleSavedProfiles((current) => getVisibleClaudeCodeSavedProfiles(savedProfiles, current));
  }, [savedProfiles]);

  useEffect(() => {
    setSlotDrafts(Object.fromEntries(configuredModels.map((model) => [model.modelField, model.id])) as Partial<Record<ClaudeCodeModelSlotField, string>>);
  }, [configuredModels]);

  const startSwitchModelSlot = (modelField: ClaudeCodeModelSlotField) => {
    setEditingSlot(modelField);
  };

  const updateSlotDraft = (modelField: ClaudeCodeModelSlotField, value: string) => {
    setSlotDrafts((current) => ({ ...current, [modelField]: value }));
  };

  const switchModelSlot = (modelField: ClaudeCodeModelSlotField) => {
    const nextModelId = String(slotDrafts[modelField] ?? "").trim();
    if (!nextModelId) return;
    onUpdate({ [modelField]: nextModelId } as UpdateClaudeCodeModelConfigRequest);
    setEditingSlot(undefined);
  };

  return (
    <>
      <section className="page-grid">
        <div className="content-card stack-card">
          <div className="card-toolbar">
            <div className="card-title-block">
              <h3>{copy.configuredModels}</h3>
            </div>
            <div className="card-actions">
              <button type="button" disabled={busyAction === "saveClaudeCodeModelProfile" || configuredModels.length === 0} onClick={onSaveProfile}>
                {busyAction === "saveClaudeCodeModelProfile" ? <RefreshCw size={16} className="spin" /> : <Save size={16} />}
                {busyAction === "saveClaudeCodeModelProfile" ? copy.savingCurrent : copy.saveCurrent}
              </button>
              <button type="button" title={copy.refresh} disabled={refreshBusy} onClick={onRefresh}>
                <RefreshCw size={16} className={refreshBusy ? "spin" : undefined} />
                {refreshBusy ? copy.refreshing : copy.refresh}
              </button>
            </div>
          </div>
          <div className="model-card-grid claude-code-model-list">
            {configuredModels.length ? (
              configuredModels.map((model) => (
                <ConfiguredModelCard
                  key={`${model.modelField}:${model.id}`}
                  model={{ id: model.id, provider: model.providerId, label: model.id }}
                  badgeLabel={model.label}
                  copy={modelCardCopy}
                  language={language}
                  className="claude-code-model-card"
                  actions={
                    editingSlot === model.modelField ? undefined : (
                      <button type="button" disabled={busy} onClick={() => startSwitchModelSlot(model.modelField)}>
                        <Settings size={14} />
                        {copy.switchModel}
                      </button>
                    )
                  }
                >
                  {editingSlot === model.modelField ? (
                    <div className="claude-code-model-switch-panel">
                      <select
                        autoFocus
                        value={String(slotDrafts[model.modelField] ?? model.id)}
                        onChange={(event) => updateSlotDraft(model.modelField, event.target.value)}
                      >
                        {modelOptionsWithCurrent(activeProviderModelOptions, model.id).map(([id, label]) => (
                          <option key={id} value={id}>
                            {label}
                          </option>
                        ))}
                      </select>
                      <div className="model-card-actions claude-code-model-actions">
                        <button
                          type="button"
                          disabled={busy || !String(slotDrafts[model.modelField] ?? "").trim() || String(slotDrafts[model.modelField] ?? "").trim() === model.id}
                          onClick={() => switchModelSlot(model.modelField)}
                        >
                          <Save size={14} />
                          {copy.saveSwitch}
                        </button>
                        <button type="button" onClick={() => setEditingSlot(undefined)}>
                          <X size={14} />
                          {copy.cancel}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </ConfiguredModelCard>
              ))
            ) : (
              <div className="empty-state page-empty">{copy.empty}</div>
            )}
          </div>
        </div>

        <div className="content-card stack-card">
          <div className="card-toolbar">
            <div className="card-title-block">
              <h3>{copy.savedModels}</h3>
            </div>
          </div>
          <div className="model-card-grid claude-code-model-list">
            {visibleSavedProfiles.length ? (
              visibleSavedProfiles.map((profile) => {
                const applying = busyAction === `applyClaudeCodeModelProfile:${profile.id}`;
                const deleting = busyAction === `deleteClaudeCodeModelProfile:${profile.id}`;
                const active = isClaudeCodeSavedProfileActiveProvider(profile, config);
                return (
                  <ConfiguredModelCard
                    key={profile.id}
                    model={{
                      id: profile.fallbackModelId ?? profile.name,
                      provider: profile.providerPresetId ?? profile.providerPresetName ?? profile.baseUrl ?? profile.name,
                      label: profile.name
                    }}
                    badgeLabel={profile.providerPresetName}
                    copy={modelCardCopy}
                    language={language}
                    className={`claude-code-model-card${active ? " selected" : ""}`}
                    actions={
                      <>
                        <button type="button" disabled={Boolean(busyAction) || active} onClick={() => onApplyProfile(profile.id)}>
                          {applying ? <RefreshCw size={14} className="spin" /> : active ? <CheckCircle2 size={14} /> : <Settings size={14} />}
                          {applying ? copy.applyingProfile : active ? copy.activeProfile : copy.applyProfile}
                        </button>
                        <button type="button" disabled={Boolean(busyAction)} onClick={() => onDeleteProfile(profile.id)}>
                          {deleting ? <RefreshCw size={14} className="spin" /> : <Trash2 size={14} />}
                          {copy.deleteProfile}
                        </button>
                      </>
                    }
                  >
                    <div className="model-card-meta claude-code-profile-meta">
                      {profile.providerPresetName && <span>{`${copy.provider}: ${profile.providerPresetName}`}</span>}
                      {profile.fallbackModelId && <span>{`${copy.defaultModel}: ${profile.fallbackModelId}`}</span>}
                      {profile.haikuModelId && <span>{`${copy.lightModel}: ${profile.haikuModelId}`}</span>}
                      {profile.sonnetModelId && <span>{`${copy.primaryModel}: ${profile.sonnetModelId}`}</span>}
                      {profile.opusModelId && <span>{`${copy.advancedModel}: ${profile.opusModelId}`}</span>}
                    </div>
                  </ConfiguredModelCard>
                );
              })
            ) : (
              <div className="empty-state page-empty">{copy.noSavedProfiles}</div>
            )}
          </div>
        </div>

        <div>
          <ClaudeCodeModelConfigCard
            title={copy.configureModels}
            config={config}
            presets={presets}
            modelOptions={modelOptions}
            language={language}
            busy={busy}
            onUpdate={onUpdate}
          />
        </div>
      </section>
    </>
  );
}

export function HermesModelsPage({
  title,
  description,
  status,
  language,
  busy,
  onRefresh
}: {
  title: string;
  description: string;
  status?: HarnessStatus;
  language: Language;
  busy: boolean;
  onRefresh: () => void;
}) {
  const copy = language === "zh-CN"
    ? { refresh: "\u91cd\u65b0\u68c0\u67e5", refreshing: "\u68c0\u67e5\u4e2d", empty: "\u5c1a\u672a\u89e3\u6790\u5230 Hermes \u6a21\u578b\u3002", usage: "\u7528\u91cf", calls: "\u8c03\u7528", tokens: "Token", cost: "\u8d39\u7528", recent7d: "\u6700\u8fd1 7 \u5929", defaultOption: "\u9ed8\u8ba4" }
    : { refresh: "Refresh", refreshing: "Checking", empty: "No Hermes models have been resolved.", usage: "Usage", calls: "Calls", tokens: "Tokens", cost: "Cost", recent7d: "Last 7 days", defaultOption: "Default" };
  const models = status?.models ?? [];
  return (
    <section className="page-grid">
      <div className="content-card stack-card">
        <div className="card-toolbar">
          <div className="card-title-block">
            <h3>{title}</h3>
            <p>{description}</p>
          </div>
          <button type="button" title={copy.refresh} disabled={busy} onClick={onRefresh}>
            <RefreshCw size={16} className={busy ? "spin" : undefined} />
            {busy ? copy.refreshing : copy.refresh}
          </button>
        </div>
        <div className="model-card-grid">
          {models.length ? models.map((model) => (
            <ConfiguredModelCard
              key={model.id}
              model={{ id: model.id, label: model.label, provider: model.provider ?? "hermes" }}
              badgeLabel={model.isDefault ? copy.defaultOption : model.provider}
              copy={copy}
              language={language}
            />
          )) : <div className="empty-state page-empty">{copy.empty}</div>}
        </div>
      </div>
    </section>
  );
}

export function HermesAgentsPage({
  title,
  description,
  config,
  status,
  language,
  busy,
  refreshBusy,
  onRefresh,
  onAddProfile
}: {
  title: string;
  description: string;
  config?: HermesConfigResponse;
  status?: HarnessStatus;
  language: Language;
  busy: boolean;
  refreshBusy: boolean;
  onRefresh: () => void;
  onAddProfile: (input: CreateHermesProfileRequest) => void;
}) {
  const copy = language === "zh-CN"
    ? { configured: "已配置 Agent", add: "添加 Agent", adding: "添加中", refresh: "重新检查", refreshing: "检查中", name: "Profile ID", description: "描述", cloneFrom: "从 Profile 复制", noClone: "不复制", defaultBadge: "默认", defaultModel: "默认模型", provider: "提供方", alias: "Alias", path: "Agent 路径", workspace: "工作区", empty: "尚未解析到 Hermes Profile。", hint: "这里的每个 Agent 对应到 Hermes 里面的每个 Profile。" }
    : { configured: "Configured agents", add: "Add Agent", adding: "Adding", refresh: "Refresh", refreshing: "Checking", name: "Profile ID", description: "Description", cloneFrom: "Clone from profile", noClone: "Do not clone", defaultBadge: "Default", defaultModel: "Default model", provider: "Provider", alias: "Alias", path: "Agent path", workspace: "Workspace", empty: "No Hermes profiles have been resolved.", hint: "Each Agent here maps to one Hermes profile." };
  const profiles = config?.profiles ?? status?.profiles ?? [];
  const [name, setName] = useState("");
  const [profileDescription, setProfileDescription] = useState("");
  const [cloneFrom, setCloneFrom] = useState("");
  const submit = () => {
    const nextName = name.trim();
    if (!nextName || busy) return;
    onAddProfile({ name: nextName, description: profileDescription.trim() || undefined, cloneFrom: cloneFrom || undefined });
    setName("");
    setProfileDescription("");
  };
  return (
    <section className="page-grid">
      <div className="content-card stack-card">
        <div className="card-toolbar">
          <div className="card-title-block">
            <h3>{copy.configured}</h3>
            <p>{copy.hint}</p>
          </div>
          <button type="button" title={copy.refresh} disabled={refreshBusy} onClick={onRefresh}>
            <RefreshCw size={16} className={refreshBusy ? "spin" : undefined} />
            {refreshBusy ? copy.refreshing : copy.refresh}
          </button>
        </div>
        <div className="model-card-grid">
          {profiles.length ? (
            profiles.map((profile) => (
              <article key={profile.id} className="model-card">
                <div className="model-card-head">
                  <IdentityTitle kind="agent" id={profile.id} label={profile.label} />
                  {profile.isDefault && <span className="status-pill status-default">{copy.defaultBadge}</span>}
                </div>
                <div className="model-card-main">
                  <code>{profile.path ?? profile.id}</code>
                </div>
                <div className="model-card-meta">
                  <span>{`${copy.defaultModel}: ${profile.modelId ?? "-"}`}</span>
                  <span>{`${copy.provider}: ${profile.provider ?? "-"}`}</span>
                  <span>{`${copy.workspace}: ${profile.workspace ?? "-"}`}</span>
                  <span>{`${copy.alias}: ${profile.alias ?? "-"}`}</span>
                </div>
              </article>
            ))
          ) : (
            <div className="empty-state page-empty">{copy.empty}</div>
          )}
        </div>
      </div>
      <div className="content-card stack-card">
        <div className="card-toolbar">
          <div className="card-title-block">
            <h3>{copy.add}</h3>
            <p>{description}</p>
          </div>
        </div>
        <div className="form-grid">
          <label>
            <span>{copy.name}</span>
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="researcher" />
          </label>
          <label>
            <span>{copy.cloneFrom}</span>
            <select value={cloneFrom} onChange={(event) => setCloneFrom(event.target.value)}>
              <option value="">{copy.noClone}</option>
              {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.label}</option>)}
            </select>
          </label>
          <label className="field-span-full">
            <span>{copy.description}</span>
            <input value={profileDescription} onChange={(event) => setProfileDescription(event.target.value)} />
          </label>
        </div>
        <div className="card-actions">
          <button type="button" className="primary-action" disabled={busy || !name.trim()} onClick={submit}>
            {busy ? <RefreshCw size={16} className="spin" /> : <Plus size={16} />}
            {busy ? copy.adding : copy.add}
          </button>
        </div>
      </div>
    </section>
  );
}

export function HarnessSkillsPage({
  title,
  description,
  language,
  skillStatus,
  hermesSkills,
  busy,
  onInstallSkills
}: {
  title: string;
  description: string;
  language: Language;
  skillStatus?: HarnessSkillStatusResponse;
  hermesSkills?: HermesConfigResponse["skills"];
  busy: boolean;
  onInstallSkills: () => void;
}) {
  const copy = language === "zh-CN"
    ? { installed: "已安装 Hermes Skill", profile: "Profile", path: "路径", source: "数据源", count: (value: number) => `${value.toLocaleString(language)} Skills`, empty: "尚未扫描到 Hermes 已安装 Skill。" }
    : { installed: "Installed Hermes Skills", profile: "Profile", path: "Path", source: "Source", count: (value: number) => `${value.toLocaleString(language)} Skills`, empty: "No installed Hermes skills were scanned." };
  return (
    <section className="page-grid">
      <div className="content-card stack-card">
        <div className="card-toolbar">
          <div className="card-title-block">
            <h3>{title}</h3>
            <p>{description}</p>
          </div>
          <span className="status-pill status-running">{copy.count(hermesSkills?.length ?? 0)}</span>
        </div>
        <div className="model-card-grid">
          {hermesSkills?.length ? (
            hermesSkills.map((skill) => (
              <article key={`${skill.profileId ?? "default"}:${skill.id}:${skill.path}`} className="model-card">
                <div className="model-card-head">
                  <div className="model-card-main">
                    <strong>{skill.label}</strong>
                    <code>{skill.id}</code>
                  </div>
                  <span className="status-pill status-succeeded">{skill.profileId ?? "default"}</span>
                </div>
                <div className="model-card-main">
                  <code>{skill.path}</code>
                </div>
                <div className="model-card-meta">
                  <span>{`${copy.source}: Hermes`}</span>
                  <span>{`${copy.profile}: ${skill.profileId ?? "default"}`}</span>
                </div>
              </article>
            ))
          ) : (
            <div className="empty-state page-empty">{copy.empty}</div>
          )}
        </div>
      </div>
      <HarnessSkillsCard ui={openClawPanelSkillCopy(language)} skillStatus={skillStatus} language={language} busy={busy} onInstallSkills={onInstallSkills} />
    </section>
  );
}

export function HermesChannelsPage({
  title,
  description,
  config,
  language,
  busy,
  refreshBusy,
  onRefresh,
  onAddChannel
}: {
  title: string;
  description: string;
  config?: HermesConfigResponse;
  language: Language;
  busy: boolean;
  refreshBusy: boolean;
  onRefresh: () => void;
  onAddChannel: (input: CreateHermesChannelRequest) => void;
}) {
  const copy = language === "zh-CN"
    ? { configured: "已配置频道", add: "添加频道配置", adding: "添加中", refresh: "重新检查", refreshing: "检查中", enabled: "已启用", platform: "平台", profile: "Profile", id: "频道 ID", name: "名称", type: "类型", threadId: "Thread ID", source: "目录", empty: "尚未解析到 Hermes 频道。" }
    : { configured: "Configured channels", add: "Add channel config", adding: "Adding", refresh: "Refresh", refreshing: "Checking", enabled: "Enabled", platform: "Platform", profile: "Profile", id: "Channel ID", name: "Name", type: "Type", threadId: "Thread ID", source: "Directory", empty: "No Hermes channels have been resolved." };
  const channels = config?.channels ?? [];
  const [draft, setDraft] = useState<CreateHermesChannelRequest>({ platform: "feishu", id: "", name: "", type: "group" });
  const updateDraft = (field: keyof CreateHermesChannelRequest, value: string) => setDraft((current) => ({ ...current, [field]: value }));
  const submit = () => {
    if (!draft.platform.trim() || !draft.id.trim() || busy) return;
    onAddChannel(draft);
    setDraft({ platform: draft.platform, id: "", name: "", type: draft.type });
  };
  return (
    <section className="page-grid">
      <div className="content-card stack-card">
        <div className="card-toolbar">
          <div className="card-title-block">
            <h3>{copy.configured}</h3>
            <p>{description}</p>
          </div>
          <button type="button" title={copy.refresh} disabled={refreshBusy} onClick={onRefresh}>
            <RefreshCw size={16} className={refreshBusy ? "spin" : undefined} />
            {refreshBusy ? copy.refreshing : copy.refresh}
          </button>
        </div>
        <div className="model-card-grid">
          {channels.length ? channels.map((channel) => (
            <article key={`${channel.profileId ?? "default"}:${channel.platform}:${channel.id}:${channel.threadId ?? ""}`} className="model-card">
              <div className="model-card-head">
                <IdentityTitle kind="channel" id={channel.platform} label={channel.name} />
                <span className="status-pill status-succeeded">{copy.enabled}</span>
              </div>
              <div className="model-card-main">
                <code>{`${channel.platform}:${channel.id}`}</code>
              </div>
              <div className="model-card-meta">
                <span>{`${copy.profile}: ${channel.profileId ?? "default"}`}</span>
                <span>{`${copy.type}: ${channel.type ?? "-"}`}</span>
                <span>{`${copy.threadId}: ${channel.threadId ?? "-"}`}</span>
              </div>
            </article>
          )) : <div className="empty-state page-empty">{copy.empty}</div>}
        </div>
      </div>
      <div className="content-card stack-card">
        <div className="card-toolbar">
          <div className="card-title-block">
            <h3>{copy.add}</h3>
            <p>{config?.channelDirectoryPath ?? copy.source}</p>
          </div>
        </div>
        <div className="form-grid">
          <label><span>{copy.platform}</span><input value={draft.platform} onChange={(event) => updateDraft("platform", event.target.value)} /></label>
          <label><span>{copy.id}</span><input value={draft.id} onChange={(event) => updateDraft("id", event.target.value)} /></label>
          <label><span>{copy.name}</span><input value={draft.name ?? ""} onChange={(event) => updateDraft("name", event.target.value)} /></label>
          <label><span>{copy.type}</span><input value={draft.type ?? ""} onChange={(event) => updateDraft("type", event.target.value)} /></label>
          <label className="field-span-full"><span>{copy.threadId}</span><input value={draft.threadId ?? ""} onChange={(event) => updateDraft("threadId", event.target.value)} /></label>
        </div>
        <div className="card-actions">
          <button type="button" className="primary-action" disabled={busy || !draft.platform.trim() || !draft.id.trim()} onClick={submit}>
            {busy ? <RefreshCw size={16} className="spin" /> : <Plus size={16} />}
            {busy ? copy.adding : copy.add}
          </button>
        </div>
      </div>
    </section>
  );
}

function ClaudeCodeModelConfigCard({
  title,
  config,
  presets,
  modelOptions,
  language,
  busy,
  onUpdate
}: {
  title?: string;
  config?: ClaudeCodeModelConfig;
  presets: ClaudeCodeModelPreset[];
  modelOptions: ClaudeCodeModelOptionEntry[];
  language: Language;
  busy: boolean;
  onUpdate: (input: UpdateClaudeCodeModelConfigRequest) => void;
}) {
  const copy =
    language === "zh-CN"
      ? {
          title: "Claude Code \u6a21\u578b",
          preset: "\u9884\u8bbe",
          authToken: "API Key / Token",
          authRequired: "\u8bf7\u8f93\u5165\u8be5\u5e73\u53f0\u7684 API Key / Token\u3002",
          authPlaceholder: "API Key / Token",
          slotRequired: "\u8bf7\u9009\u62e9\u9884\u8bbe\u6216\u9ed8\u8ba4\u6a21\u578b\u3002",
          selectModel: "\u9009\u62e9\u6a21\u578b",
          fallbackModel: "\u9ed8\u8ba4\u6a21\u578b",
          save: "\u5199\u5165 Claude Code",
          saving: "\u5199\u5165\u4e2d"
        }
      : {
          title: "Claude Code models",
          preset: "Preset",
          authToken: "API Key / Token",
          authRequired: "Enter this provider's API Key / Token.",
          authPlaceholder: "API Key / Token",
          slotRequired: "Choose a preset or default model.",
          selectModel: "Select model",
          fallbackModel: "Default model",
          save: "Write to Claude Code",
          saving: "Writing"
        };
  const [draft, setDraft] = useState<UpdateClaudeCodeModelConfigRequest>({});
  const [localError, setLocalError] = useState<string | undefined>();
  const applyPresetToDraft = useCallback((presetId: string) => {
    const preset = presets.find((item) => item.id === presetId);
    setLocalError(undefined);
    if (!preset) {
      setDraft((current) => ({ ...current, presetId, authValue: "" }));
      return;
    }
    setDraft((current) => ({
      ...current,
      presetId,
      baseUrl: preset.baseUrl ?? "",
      authEnvKey: preset.authEnvKey ?? "ANTHROPIC_AUTH_TOKEN",
      authValue: "",
      extraEnv: preset.extraEnv,
      fallbackModelId: preset.fallbackModelId ?? "",
      haikuModelId: undefined,
      haikuModelName: undefined,
      sonnetModelId: undefined,
      sonnetModelName: undefined,
      opusModelId: undefined,
      opusModelName: undefined
    }));
  }, [presets]);

  useEffect(() => {
    const preset = presets.find((item) => item.id === config?.providerPresetId);
    setDraft({
      presetId: config?.providerPresetId ?? "",
      baseUrl: preset?.baseUrl ?? config?.baseUrl ?? "",
      authEnvKey: preset?.authEnvKey ?? config?.authEnvKey ?? "ANTHROPIC_AUTH_TOKEN",
      authValue: "",
      extraEnv: preset?.extraEnv ?? config?.extraEnv,
      fallbackModelId: preset?.fallbackModelId ?? config?.fallbackModelId ?? "",
      haikuModelId: undefined,
      haikuModelName: undefined,
      sonnetModelId: undefined,
      sonnetModelName: undefined,
      opusModelId: undefined,
      opusModelName: undefined
    });
    setLocalError(undefined);
  }, [config, presets]);

  const updateField = (field: keyof UpdateClaudeCodeModelConfigRequest, value: string) => {
    setLocalError(undefined);
    setDraft((current) => ({ ...current, [field]: value }));
  };
  const selectedPreset = presets.find((item) => item.id === draft.presetId);
  const scopedModelOptions = selectedPreset ? buildClaudeCodeModelOptions(undefined, presets, selectedPreset.id) : modelOptions;
  const visibleModelOptions = selectedPreset ? scopedModelOptions : modelOptionsWithCurrent(modelOptions, String(draft.fallbackModelId ?? ""));
  const requiresAuth = Boolean(draft.presetId || draft.baseUrl);
  const presetChanged = Boolean(draft.presetId && draft.presetId !== config?.providerPresetId);
  const baseUrlChanged = Boolean(draft.baseUrl && draft.baseUrl !== config?.baseUrl);
  const selectedAuthEnvKey = selectedPreset?.authEnvKey ?? draft.authEnvKey ?? "ANTHROPIC_AUTH_TOKEN";
  const authEnvChanged = Boolean(config?.authEnvKey && selectedAuthEnvKey !== config.authEnvKey);
  const canReuseAuth = Boolean(config?.authConfigured && !presetChanged && !baseUrlChanged && !authEnvChanged);
  const hasAuthInput = Boolean(String(draft.authValue ?? "").trim());
  const hasModelSlotInput = Boolean(String(draft.fallbackModelId ?? "").trim());
  const submitDraft = () => {
    if (requiresAuth && !canReuseAuth && !hasAuthInput) {
      setLocalError(copy.authRequired);
      return;
    }
    if (!selectedPreset && !hasModelSlotInput) {
      setLocalError(copy.slotRequired);
      return;
    }
    onUpdate({
      presetId: draft.presetId,
      baseUrl: draft.baseUrl,
      authValue: draft.authValue,
      extraEnv: draft.extraEnv,
      fallbackModelId: draft.fallbackModelId,
      authEnvKey: selectedAuthEnvKey
    });
  };

  return (
    <div className="content-card stack-card openclaw-control-section claude-code-config-card">
      <div className="card-toolbar">
        <div className="card-title-block">
          <h3>{title ?? copy.title}</h3>
        </div>
        <button type="button" disabled={busy} onClick={submitDraft}>
          {busy ? <RefreshCw size={14} className="spin" /> : <Save size={14} />}
          {busy ? copy.saving : copy.save}
        </button>
      </div>
      <div className="form-grid form-grid-wide wizard-field-grid claude-code-config-grid">
        <div className="wizard-field claude-code-provider-field">
          <label>
            <span>{copy.preset}</span>
            <select value={draft.presetId ?? ""} onChange={(event) => applyPresetToDraft(event.target.value)}>
              <option value="">-</option>
              {presets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>{copy.fallbackModel}</span>
            <select
              value={String(draft.fallbackModelId ?? "")}
              onChange={(event) => updateField("fallbackModelId", event.target.value)}
            >
              <option value="">{copy.selectModel}</option>
              {visibleModelOptions.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>{copy.authToken}</span>
            <input
              type="password"
              autoComplete="off"
              value={String(draft.authValue ?? "")}
              placeholder={copy.authPlaceholder}
              onChange={(event) => updateField("authValue", event.target.value)}
            />
          </label>
        </div>
        {localError && <div className="error-banner field-span-full">{localError}</div>}
      </div>
    </div>
  );
}

type ClaudeCodeModelOptionEntry = readonly [string, string];

function buildClaudeCodeModelOptions(status: HarnessStatus | undefined, presets: ClaudeCodeModelPreset[], presetId?: string): ClaudeCodeModelOptionEntry[] {
  const selectedPreset = presetId ? presets.find((preset) => preset.id === presetId) : undefined;
  if (presetId) return selectedPreset ? buildClaudeCodePresetModelOptions(selectedPreset) : [];

  return [
    ...new Map(
      [
        ...(status?.models ?? [])
          .filter((model) => model.id && model.id !== "inherit")
          .map((model) => [model.id, model.label === model.id ? model.id : `${model.label} (${model.id})`] as const),
        ...presets.flatMap((preset) =>
          claudeCodePresetModelIds(preset)
            .map((modelId) => [modelId, `${preset.name} (${modelId})`] as const)
        )
      ]
    ).entries()
  ];
}

function buildClaudeCodePresetModelOptions(preset: ClaudeCodeModelPreset): ClaudeCodeModelOptionEntry[] {
  return [
    ...new Map(
      claudeCodePresetModelIds(preset)
        .map((modelId) => [modelId, preset.name ? `${preset.name} (${modelId})` : modelId] as const)
    ).entries()
  ];
}

function claudeCodePresetModelIds(preset: ClaudeCodeModelPreset): string[] {
  return [
    ...new Set(
      [
        ...(preset.modelOptions ?? []),
        preset.fallbackModelId,
        preset.haikuModelId,
        preset.sonnetModelId,
        preset.opusModelId
      ].filter((modelId): modelId is string => Boolean(modelId))
    )
  ];
}

function modelOptionsWithCurrent(options: ClaudeCodeModelOptionEntry[], currentModelId: string | undefined): ClaudeCodeModelOptionEntry[] {
  const current = String(currentModelId ?? "").trim();
  if (!current || options.some(([id]) => id === current)) return options;
  return [[current, current], ...options];
}

function activeCountOrUndefined(count: number): number | undefined {
  return count > 0 ? count : undefined;
}

function countHarnessStatusActivity(status: HarnessStatus | undefined): number {
  if (!status) return 0;
  const checkIssues = status.checks.filter((check) => check.status === "warning" || check.status === "fail").length;
  if (checkIssues > 0) return checkIssues;
  let count = 0;
  if (!status.installed) count += 1;
  if (!status.environmentOk) count += 1;
  if (status.connectionState !== "connected" && status.connectionState !== "available") count += 1;
  return count;
}

function countHarnessSkillActivity(status: HarnessSkillStatusResponse | undefined): number {
  if (!status?.supported) return 0;
  return status.skills.filter((skill) => skill.status === "missing" || skill.status === "stale" || skill.status === "error").length;
}

function buildConfiguredClaudeCodeModels(config: ClaudeCodeModelConfig | undefined, presets: ClaudeCodeModelPreset[], language: Language): Array<{
  id: string;
  label: string;
  modelField: ClaudeCodeModelSlotField;
  providerId: string;
  providerName: string;
}> {
  const preset = presets.find((item) => item.id === config?.providerPresetId);
  const providerId = config?.providerPresetId ?? preset?.id ?? config?.providerPresetName ?? config?.baseUrl ?? config?.fallbackModelId ?? "anthropic";
  const providerName = config?.providerPresetName ?? preset?.name ?? "Claude Code";
  const labels =
    language === "zh-CN"
      ? {
          sonnet: "\u4e3b\u529b\u6a21\u578b",
          opus: "\u9ad8\u9636\u6a21\u578b",
          haiku: "\u8f7b\u91cf\u6a21\u578b",
          fallback: "\u9ed8\u8ba4\u6a21\u578b"
        }
      : {
          sonnet: "Primary model",
          opus: "Advanced model",
          haiku: "Light model",
          fallback: "Default model"
        };
  return [
    { id: config?.fallbackModelId, label: labels.fallback, modelField: "fallbackModelId", providerId, providerName },
    { id: config?.haikuModelId, label: labels.haiku, modelField: "haikuModelId", providerId, providerName },
    { id: config?.sonnetModelId, label: labels.sonnet, modelField: "sonnetModelId", providerId, providerName },
    { id: config?.opusModelId, label: labels.opus, modelField: "opusModelId", providerId, providerName }
  ].filter((model): model is { id: string; label: string; modelField: ClaudeCodeModelSlotField; providerId: string; providerName: string } => Boolean(model.id));
}

type HarnessSkillsCardCopy = Pick<
  OpenClawPanelCopy,
  "skills" | "skillsReady" | "skillsMissing" | "skillsUnsupported" | "installSkills" | "installingSkills" | "skillStatus"
>;

type HarnessSkillsCardVariant = "card" | "summary";

function HarnessSkillsCard({
  ui,
  skillStatus,
  language,
  busy,
  onInstallSkills,
  variant = "card"
}: {
  ui: HarnessSkillsCardCopy;
  skillStatus?: HarnessSkillStatusResponse;
  language: Language;
  busy: boolean;
  onInstallSkills: () => void;
  variant?: HarnessSkillsCardVariant;
}) {
  const supported = Boolean(skillStatus?.supported);
  const skills = skillStatus?.skills ?? [];
  const installed = supported && skills.length > 0 && skills.every((skill) => skill.status === "installed");
  const description = !supported ? ui.skillsUnsupported : installed ? ui.skillsReady : ui.skillsMissing;
  const className =
    variant === "summary"
      ? "harness-skills-card harness-skills-card-summary"
      : "content-card stack-card openclaw-control-section harness-skills-card";
  return (
    <div className={className}>
      <div className="card-title-block harness-skills-card-head">
        <div>
          <h3>{ui.skills}</h3>
          <p>{description}</p>
        </div>
        <button type="button" onClick={onInstallSkills} disabled={busy || !supported} title={ui.installSkills}>
          <Puzzle size={14} className={busy ? "spin" : undefined} />
          {busy ? ui.installingSkills : ui.installSkills}
        </button>
      </div>

      {skills.length ? (
        skills.map((skill) => (
          <OpenClawPanelRow
            key={skill.id}
            label={skill.label}
            value={
              <span className="harness-check-value">
                <span className={`status-pill ${statusClassForHarnessSkill(skill.status)}`}>{ui.skillStatus[skill.status]}</span>
                <span>{skill.targetPath ?? skill.sourcePath}</span>
              </span>
            }
          />
        ))
      ) : (
        <div className="empty-state page-empty">{language === "zh-CN" ? "\u5c1a\u672a\u83b7\u53d6 skill \u72b6\u6001\u3002" : "Skill status has not been loaded."}</div>
      )}
    </div>
  );
}

function shortCommit(commit: string): string {
  return commit.slice(0, 7);
}

function formatDurationMs(value: number | undefined, fallback: string): string {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toLocaleString()} ms` : fallback;
}

function formatDateTimeLabel(value: string | undefined, language: Language, fallback: string): string {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(language, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

export interface HivewardHomeCopy {
  title: string;
  subtitle: string;
  github: string;
  updateTitle: string;
  updateAvailable: string;
  upToDate: string;
  updateUnknown: string;
  checkUpdate: string;
  checking: string;
  applyUpdate: string;
  forceUpdate: string;
  forceUpdateConfirm: string;
  updating: string;
  updateApplied: string;
  updateSkipped: string;
  cannotAutoApply: string;
  newBadge: string;
  current: string;
  latest: string;
  source: string;
  lastChecked: string;
  none: string;
  communityTitle: string;
  communityPlaceholder: string;
  readmeSections: Array<{
    title: string;
    paragraphs: string[];
    items?: string[];
  }>;
}

export function hivewardHomeCopy(language: Language): HivewardHomeCopy {
  if (language === "zh-CN") {
    return {
      title: "HiveWard",
      subtitle: "开源 Agent Company 工作区，把模型、Agent、蓝图、审批、运行和历史组织成一个可管理的操作系统。",
      github: "GitHub 仓库",
      updateTitle: "版本更新",
      updateAvailable: "发现更新",
      upToDate: "已是最新",
      updateUnknown: "状态未知",
      checkUpdate: "检查更新",
      checking: "检查中",
      applyUpdate: "自动更新",
      forceUpdate: "\u5f3a\u5236\u66f4\u65b0",
      forceUpdateConfirm: "\u5f3a\u5236\u66f4\u65b0\u4f1a\u4e22\u5f03\u672c\u5730 checkout \u91cc\u672a\u63d0\u4ea4\u7684\u4ee3\u7801\u4fee\u6539\uff0c\u4f46\u4f1a\u5907\u4efd\u5e76\u6062\u590d HiveWard \u5e73\u53f0\u6570\u636e\u548c\u4ea7\u7269\u3002\u786e\u5b9a\u7ee7\u7eed\u5417\uff1f",
      updating: "更新中",
      updateApplied: "更新已执行，重启 HiveWard 后生效。",
      updateSkipped: "未执行更新。",
      cannotAutoApply: "当前 checkout 无法自动更新；通常需要在 main 分支且工作区干净。",
      newBadge: "更新",
      current: "当前",
      latest: "远端",
      source: "来源",
      lastChecked: "最后检查",
      none: "-",
      communityTitle: "交流群",
      communityPlaceholder: "扫码加入 HiveWard 交流群，获取更新、反馈问题和交流蓝图玩法。",
      readmeSections: [
        {
          title: "什么是 HiveWard？",
          paragraphs: [
            "HiveWard 是面向 Agent Company 的开源工作区。它不试图成为另一个模型，也不把所有工作藏进聊天框，而是给 Agent 团队一个可见、可治理、可审查的运行结构。",
            "可以把它理解成下一代 AI 组织的运营台：公司是边界，蓝图是组织图，模型是资源池，收件箱是治理层，历史记录是执行账本。"
          ]
        },
        {
          title: "什么是蓝图？",
          paragraphs: [
            "蓝图不是静态图，而是一份可运行的 Agent 工作定义，描述谁做什么、按什么顺序做、何时汇总或审批，以及如何交付结果。"
          ],
          items: [
            "节点：Agent、Manager、并行 Slot、汇总、审批和交付步骤。",
            "连线：成功路径、失败路径、执行顺序和回滚路线。",
            "运行记录：每个执行步骤的状态、输入、输出、运行时引用、成本和时间证据。"
          ]
        },
        {
          title: "为什么选择 HiveWard？",
          paragraphs: [
            "现代 Agent 工具已经能写代码、研究和执行任务，但复杂工作一多，聊天窗口加重复复制提示词的体验很快会到达上限。",
            "HiveWard 从另一个假设出发：Agent 不应该只是更聪明的聊天伙伴，而应该成为被组织、被管理、可审计的工作单元。"
          ]
        },
        {
          title: "它如何工作？",
          paragraphs: [
            "选择公司，设计蓝图，配置模型，启动运行，然后在收件箱里审批和复盘。HiveWard 负责产品层的组织、监控和治理，OpenClaw 等运行时负责真实执行。"
          ]
        },
        {
          title: "核心能力",
          paragraphs: [],
          items: [
            "公司上下文：按公司组织目标、蓝图、运行和审批。",
            "蓝图编排：用可视化节点描述 Agent 团队结构。",
            "Manager 调度：让 Manager 节点选择 Slot、分派 Agent、要求返工或结束流程。",
            "人类治理：把需要判断的步骤集中到收件箱。",
            "运行账本：让每次执行都能被审查和复盘。"
          ]
        },
        {
          title: "注意事项",
          paragraphs: [
            "为了更好地使用 HiveWard，初次进入页面后，建议先打开你计划使用的 Harness 配置页，把 HiveWard Skill 安装 / 配置到对应 Harness。这样 CEO、Leader 和技能拆解等执行手册会进入原生 harness 的 Skill 目录，后续聊天和蓝图运行才能更稳定地调用正确的操作方式。"
          ]
        },
        {
          title: "当前状态",
          paragraphs: ["当前版本面向本地演示和早期使用。核心产品界面已经可用，API 和交互细节仍会继续演进。"]
        }
      ]
    };
  }

  return {
    title: "HiveWard",
    subtitle: "An open-source Agent Company workspace that organizes models, agents, blueprints, approvals, runs, and history into one managed operating system.",
    github: "GitHub repo",
    updateTitle: "Version updates",
    updateAvailable: "Update available",
    upToDate: "Up to date",
    updateUnknown: "Unknown",
    checkUpdate: "Check updates",
    checking: "Checking",
    applyUpdate: "Auto update",
    forceUpdate: "Force update",
    forceUpdateConfirm: "Force update will discard uncommitted checkout changes. HiveWard data and artifacts are backed up and restored. Continue?",
    updating: "Updating",
    updateApplied: "Update applied. Restart HiveWard to use the new version.",
    updateSkipped: "Update was not applied.",
    cannotAutoApply: "Automatic update needs a clean checkout on the main branch.",
    newBadge: "New",
    current: "Current",
    latest: "Remote",
    source: "Source",
    lastChecked: "Last checked",
    none: "-",
    communityTitle: "Community",
    communityPlaceholder: "Scan to join the HiveWard community group for updates, feedback, and blueprint workflow discussion.",
    readmeSections: [
      {
        title: "What is HiveWard?",
        paragraphs: [
          "HiveWard is an open-source workspace for Agent Companies. It gives agent teams a visible, governable, reviewable operating structure instead of hiding all work inside a chat box.",
          "Think of it as an operations desk for the next generation of AI organizations: company as scope, blueprint as organization chart, models as resource pool, inbox as governance layer, and history as execution ledger."
        ]
      },
      {
        title: "What is a blueprint?",
        paragraphs: [
          "A blueprint is a runnable agent work definition that describes who does what, in which order, when work must be summarized or approved, and how results are delivered."
        ],
        items: [
          "Nodes: agents, managers, parallel lanes, summaries, approvals, and delivery steps.",
          "Edges: success paths, failure paths, sequencing, and rollback routes.",
          "Run records: node status, inputs, outputs, runtime references, cost, and timing evidence."
        ]
      },
      {
        title: "Why HiveWard?",
        paragraphs: [
          "Modern agent tools can write code, research, and execute tasks, but complex work quickly outgrows a chat window and repeated prompt copying.",
          "HiveWard starts from a different assumption: agents should become organized, managed, and auditable work units."
        ]
      },
      {
        title: "How it works",
        paragraphs: [
          "Choose a company, design a blueprint, configure models, start a run, then approve and review through the inbox. HiveWard owns the product layer while OpenClaw and other runtimes own real execution."
        ]
      },
      {
        title: "Core capabilities",
        paragraphs: [],
        items: [
          "Company context for goals, blueprints, runs, and approvals.",
          "Blueprint orchestration with visual nodes.",
          "Manager dispatch across Slots and agents.",
          "Human governance through the inbox.",
          "Blueprint Kanban that turns execution state into reviewable entry points."
        ]
      },
      {
        title: "Notes",
        paragraphs: [
          "For the best first-run experience, open the configuration page for each harness you plan to use and install / configure the HiveWard Skills into that harness. This places the CEO, Leader, and skill-decomposer operating manuals in the native harness Skill directory so later chats and blueprint runs can call the right operating instructions more reliably."
        ]
      },
      {
        title: "Current status",
        paragraphs: [
          "The current version is ready for local demos and early use. Core product surfaces are in place while APIs and interaction details continue to evolve."
        ]
      }
    ]
  };
}

function openClawPanelSkillCopy(language: Language): HarnessSkillsCardCopy {
  return language === "zh-CN"
    ? {
        skills: "HiveWard Skill",
        skillsReady: "CEO / Leader \u6267\u884c\u624b\u518c\u5df2\u5b89\u88c5\uff0c\u804a\u5929\u65f6\u53ea\u9700\u77ed\u8eab\u4efd\u63d0\u793a\u5e76\u8c03\u7528 Harness \u539f\u751f skill\u3002",
        skillsMissing: "\u9700\u8981\u5b89\u88c5 HiveWard CEO / Leader skill\uff0c\u624d\u80fd\u8ba9 Harness \u539f\u751f\u8bfb\u53d6\u5e73\u53f0\u6267\u884c\u624b\u518c\u3002",
        skillsUnsupported: "\u8be5 Harness \u6682\u672a\u63a5\u5165\u539f\u751f skill \u5b89\u88c5\u3002",
        installSkills: "\u4e00\u952e\u5b89\u88c5",
        installingSkills: "\u5b89\u88c5\u4e2d",
        skillStatus: {
          installed: "\u5df2\u5b89\u88c5",
          missing: "\u672a\u5b89\u88c5",
          stale: "\u9700\u66f4\u65b0",
          unsupported: "\u672a\u652f\u6301",
          error: "\u5f02\u5e38"
        }
      }
    : {
        skills: "HiveWard Skills",
        skillsReady: "CEO / Leader operating skills are installed, so chat can send a short role prompt and let the harness load native skills.",
        skillsMissing: "Install HiveWard CEO / Leader skills so the harness can natively read the platform operating manual.",
        skillsUnsupported: "This harness does not have native skill installation wired yet.",
        installSkills: "Install skills",
        installingSkills: "Installing",
        skillStatus: {
          installed: "Installed",
          missing: "Missing",
          stale: "Update needed",
          unsupported: "Unsupported",
          error: "Error"
        }
      };
}

function harnessPermissionCopy(language: Language) {
  return language === "zh-CN"
    ? {
        title: "全部权限",
        helpAria: "查看全部权限说明",
        safeLabel: "安全模式",
        safeBody: "当前 Harness 的聊天会话和蓝图 Agent / Manager 节点会使用只读或受限权限。",
        safeWarning: "不会默认授予文件写入、命令执行、联网或实时网页搜索等完整本地能力。",
        fullLabel: "完全访问模式",
        fullBody: "聊天会话会开启完整本地权限；蓝图中引用该 Harness 的 Agent / Manager 节点会使用工作区写权限。",
        fullWarning: "只在你信任的本地仓库里开启。模型可能修改文件、运行脚本或访问网络。"
      }
    : {
        title: "All permissions",
        helpAria: "View all-permissions details",
        safeLabel: "Safe mode",
        safeBody: "Chat sessions and blueprint Agent / Manager nodes for this harness use read-only or limited permissions.",
        safeWarning: "File writes, command execution, network access, and live web search are not granted by default.",
        fullLabel: "Full access mode",
        fullBody: "Chat sessions get full local access. Blueprint Agent / Manager nodes that reference this harness use workspace-write permissions.",
        fullWarning: "Enable only in local repositories you trust. The model may modify files, run scripts, or access the network."
      };
}

function statusClassForHarnessSkill(status: HarnessSkillInstallStatus): string {
  if (status === "installed") return "status-succeeded";
  if (status === "stale" || status === "missing") return "status-running";
  return "status-failed";
}

function HarnessStatusBlock({
  status,
  language,
  fallbackLabel,
  fallbackHarnessId,
  skillsCard
}: {
  status?: HarnessStatus;
  language: Language;
  fallbackLabel: string;
  fallbackHarnessId?: HarnessId;
  skillsCard?: ReactNode;
}) {
  const copy = harnessStatusCopy(language);
  const labelParts = status ? harnessDisplayParts(status.id) : fallbackHarnessId ? harnessDisplayParts(fallbackHarnessId) : { label: fallbackLabel };
  const connectionState = status?.connectionState ?? "unavailable";
  return (
    <div className="harness-status-block">
      <div className="openclaw-panel-metrics">
        <OpenClawPanelMetric label={copy.harness} value={<HarnessLabel {...labelParts} />} />
        <OpenClawPanelMetric label={copy.defaultModel} value={status?.defaultModelId ?? copy.none} />
        <OpenClawPanelMetric label={copy.installed} value={status?.installed ? copy.yes : copy.no} tone={status?.installed ? "online" : "offline"} />
        <OpenClawPanelMetric
          label={copy.environment}
          value={status?.environmentOk ? copy.matched : copy.needsAttention}
          tone={status?.environmentOk ? "online" : "offline"}
        />
        <OpenClawPanelMetric label={copy.connection} value={copy.states[connectionState]} />
      </div>

      <div className="openclaw-control-grid">
        <div className="content-card stack-card openclaw-control-section">
          <div className="card-title-block">
            <h3>{copy.summary}</h3>
            <p>{status?.summary ?? copy.notChecked}</p>
          </div>
          <OpenClawPanelRow label={copy.checkedAt} value={formatDateTimeLabel(status?.checkedAt, language, "-")} />
          {skillsCard}
        </div>

        <div className="content-card stack-card openclaw-control-section">
          <div className="card-title-block">
            <h3>{copy.checks}</h3>
          </div>
          {status?.checks.length ? (
            status.checks.map((check) => (
              <OpenClawPanelRow
                key={check.id}
                label={check.label}
                value={
                  <span className="harness-check-value">
                    <span className={`status-pill ${statusClassForHarnessCheck(check.status)}`}>{copy.checkStatus[check.status]}</span>
                    <span>{check.detail}</span>
                  </span>
                }
              />
            ))
          ) : (
            <div className="empty-state page-empty">{copy.notChecked}</div>
          )}
        </div>
      </div>
    </div>
  );
}

function statusClassForHarnessCheck(status: HarnessStatus["checks"][number]["status"]): string {
  if (status === "pass") return "status-succeeded";
  if (status === "warning") return "status-running";
  return "status-failed";
}

function harnessStatusCopy(language: Language) {
  return language === "zh-CN"
    ? {
        harness: "Harness",
        defaultModel: "\u9ed8\u8ba4\u6a21\u578b",
        installed: "\u5b89\u88c5",
        environment: "\u73af\u5883",
        connection: "\u8fde\u63a5\u72b6\u6001",
        matched: "\u5339\u914d",
        needsAttention: "\u9700\u5904\u7406",
        yes: "\u5df2\u5b89\u88c5",
        no: "\u672a\u5b89\u88c5",
        none: "-",
        summary: "\u72b6\u6001\u6458\u8981",
        checks: "\u68c0\u67e5\u9879",
        checkedAt: "\u68c0\u67e5\u65f6\u95f4",
        notChecked: "\u5c1a\u672a\u83b7\u53d6\u72b6\u6001\u3002",
        check: "\u91cd\u65b0\u68c0\u67e5",
        checking: "\u68c0\u67e5\u4e2d",
        states: {
          connected: "\u5df2\u8fde\u63a5",
          available: "\u53ef\u7528",
          needs_config: "\u9700\u8981\u914d\u7f6e",
          unavailable: "\u4e0d\u53ef\u7528"
        },
        checkStatus: {
          pass: "\u901a\u8fc7",
          warning: "\u6ce8\u610f",
          fail: "\u5931\u8d25"
        }
      }
    : {
        harness: "Harness",
        defaultModel: "Default model",
        installed: "Installed",
        environment: "Environment",
        connection: "Connection",
        matched: "Matched",
        needsAttention: "Needs attention",
        yes: "Installed",
        no: "Not installed",
        none: "-",
        summary: "Status summary",
        checks: "Checks",
        checkedAt: "Checked at",
        notChecked: "Status has not been loaded.",
        check: "Check again",
        checking: "Checking",
        states: {
          connected: "Connected",
          available: "Available",
          needs_config: "Needs config",
          unavailable: "Unavailable"
        },
        checkStatus: {
          pass: "Pass",
          warning: "Warning",
          fail: "Fail"
        }
      };
}

function OpenClawPanelMetric({
  label,
  value,
  tone
}: {
  label: string;
  value: ReactNode;
  tone?: "online" | "offline";
}) {
  return (
    <div className={`openclaw-panel-metric ${tone ?? ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function OpenClawPanelRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="openclaw-panel-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
