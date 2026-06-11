import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router";
import type {
  CatalogSnapshot,
  DashboardWidgetType,
  HarnessId,
  HarnessSkillStatusResponse,
  HarnessStatus,
  OpenClawConfigState,
  PendingApprovalItem,
  WorkspaceDashboard,
  ChatPermissionMode
} from "@hiveward/shared";
import { getInitialLanguage, messages, type Language, type Messages } from "./lib/i18n";
import { isActiveRunView } from "./lib/run-state";
import hivewardPackage from "../../../package.json";
import { useWorkspaceController } from "./app/useWorkspaceController";
import { AppLayout } from "./layouts/AppLayout";
import { Sidebar } from "./layouts/Sidebar";
import { AppRoutes } from "./routes/AppRoutes";
import { getRouteByPathname, type RouteId, type RouteSystemId } from "./routes/route-registry";
import { WorkspaceRouteRenderer } from "./pages/WorkspaceRouteRenderer";
import { hivewardHomeCopy, type OpenClawPanelCopy } from "./pages/system/SystemPages";

const hivewardVersionLabel = `v${hivewardPackage.version}`;
const hivewardRepositoryUrl = "https://github.com/Chaunyzhang/HiveWard";

type AppTheme = "light" | "dark";
type SdkChatHarnessId = Extract<HarnessId, "claudeCode" | "codex" | "google" | "cursor" | "opencode" | "hermes">;
const CHAT_PERMISSION_MODES_STORAGE_KEY = "hiveward-chat-permission-modes";
const CHAT_PERMISSION_MODES_STORAGE_VERSION = 2;

export function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const [language, setLanguage] = useState<Language>(() => getInitialLanguage());
  const [theme, setTheme] = useState<AppTheme>(() => getInitialTheme());
  const [chatPermissionModes, setChatPermissionModes] = useState<Record<SdkChatHarnessId, ChatPermissionMode>>(() =>
    getInitialChatPermissionModes()
  );
  const [systemMenuOpen, setSystemMenuOpen] = useState(false);
  const [expandedSystems, setExpandedSystems] = useState<Record<RouteSystemId, boolean>>({
    hiveward: true,
    openclaw: true,
    claudeCode: false,
    codex: false,
    google: false,
    cursor: false,
    opencode: false,
    hermes: false
  });
  const t = messages[language];
  const systemMenuRef = useRef<HTMLDivElement | null>(null);
  const blueprintImportInputRef = useRef<HTMLInputElement | null>(null);
  const activeRouteId = getRouteByPathname(location.pathname)?.id;
  const hivewardHomeUi = useMemo(() => hivewardHomeCopy(language), [language]);

  const workspace = useWorkspaceController({
    activeRouteId,
    chatPermissionModes,
    forceHivewardUpdateConfirm: hivewardHomeUi.forceUpdateConfirm,
    language,
    navigate,
    t
  });
  const {
    selectedCompanyId,
    selectedCompany,
    dirtyBlueprintIds,
    openClawConfig,
    openClawVersion,
    hivewardUpdate,
    harnessStatuses,
    harnessSkillStatuses,
    runs,
    approvals,
    blueprintKanbanBoard,
    busyAction,
    dashboardDirty,
    error,
    mutateDashboard,
    checkHivewardUpdate,
    importBlueprintFile
  } = workspace;

  useEffect(() => {
    localStorage.setItem("hiveward-language", language);
  }, [language]);

  useEffect(() => {
    localStorage.setItem(
      CHAT_PERMISSION_MODES_STORAGE_KEY,
      JSON.stringify({
        version: CHAT_PERMISSION_MODES_STORAGE_VERSION,
        modes: chatPermissionModes
      })
    );
  }, [chatPermissionModes]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("hiveward-theme", theme);
  }, [theme]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  useEffect(() => {
    const preventGesture = (event: Event) => {
      event.preventDefault();
    };

    const preventZoomGesture = (event: WheelEvent) => {
      if (event.ctrlKey) {
        event.preventDefault();
      }
    };

    document.addEventListener("gesturestart", preventGesture, { passive: false });
    document.addEventListener("gesturechange", preventGesture, { passive: false });
    document.addEventListener("gestureend", preventGesture, { passive: false });
    document.addEventListener("wheel", preventZoomGesture, { passive: false });

    return () => {
      document.removeEventListener("gesturestart", preventGesture);
      document.removeEventListener("gesturechange", preventGesture);
      document.removeEventListener("gestureend", preventGesture);
      document.removeEventListener("wheel", preventZoomGesture);
    };
  }, []);

  const systemUi = useMemo(
    () =>
      language === "zh-CN"
        ? {
            title: "\u7cfb\u7edf",
            settings: "\u8bbe\u7f6e",
            theme: "\u4e3b\u9898",
            language: "\u8bed\u8a00",
            switchToDay: "\u5207\u6362\u5230\u65e5\u95f4\u6a21\u5f0f",
            switchToNight: "\u5207\u6362\u5230\u591c\u95f4\u6a21\u5f0f",
            day: "\u65e5\u95f4",
            night: "\u591c\u95f4",
            versionPrefix: "v"
          }
        : {
            title: "System",
            settings: "Settings",
            theme: "Theme",
            language: "Language",
            switchToDay: "Switch to day mode",
            switchToNight: "Switch to night mode",
            day: "Day",
            night: "Night",
            versionPrefix: "v"
          },
    [language]
  );
  const openClawPanelUi = useMemo<OpenClawPanelCopy>(
    () =>
      language === "zh-CN"
        ? {
            title: "OpenClaw \u63a7\u5236\u9762\u677f",
            subtitle: "\u7f51\u5173\u3001\u914d\u7f6e\u548c\u7248\u672c\u68c0\u67e5",
            openPanel: "\u6253\u5f00 OpenClaw \u63a7\u5236\u9762\u677f",
            version: "\u7248\u672c",
            gateway: "\u7f51\u5173",
            config: "\u914d\u7f6e",
            activity: "\u8fd0\u884c",
            available: "\u53ef\u7528",
            unavailable: "\u4e0d\u53ef\u7528",
            configured: "\u5df2\u914d\u7f6e",
            notConfigured: "\u672a\u914d\u7f6e",
            environment: "\u73af\u5883\u53d8\u91cf",
            configFile: "\u914d\u7f6e\u6587\u4ef6",
            none: "-",
            url: "URL",
            origin: "Origin",
            locale: "Locale",
            source: "\u6765\u6e90",
            auth: "\u8ba4\u8bc1",
            requestTimeout: "\u8bf7\u6c42\u8d85\u65f6",
            agentStartTimeout: "Agent \u542f\u52a8\u8d85\u65f6",
            configPath: "\u914d\u7f6e\u6587\u4ef6",
            workspace: "\u9ed8\u8ba4\u5de5\u4f5c\u533a",
            defaultModel: "\u9ed8\u8ba4\u6a21\u578b",
            models: "\u6a21\u578b",
            agents: "Agent",
            channels: "\u9891\u9053",
            catalogRefreshed: "\u76ee\u5f55\u5237\u65b0",
            lastChecked: "\u6700\u540e\u68c0\u67e5",
            checkUpdates: "\u68c0\u67e5\u66f4\u65b0",
            checking: "\u68c0\u67e5\u4e2d",
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
            title: "OpenClaw Control Panel",
            subtitle: "Gateway, configuration, and version checks",
            openPanel: "Open OpenClaw control panel",
            version: "Version",
            gateway: "Gateway",
            config: "Config",
            activity: "Activity",
            available: "Available",
            unavailable: "Unavailable",
            configured: "Configured",
            notConfigured: "Not configured",
            environment: "Environment",
            configFile: "Config file",
            none: "-",
            url: "URL",
            origin: "Origin",
            locale: "Locale",
            source: "Source",
            auth: "Auth",
            requestTimeout: "Request timeout",
            agentStartTimeout: "Agent start timeout",
            configPath: "Config file",
            workspace: "Default workspace",
            defaultModel: "Default model",
            models: "Models",
            agents: "Agents",
            channels: "Channels",
            catalogRefreshed: "Catalog refreshed",
            lastChecked: "Last checked",
            checkUpdates: "Check updates",
            checking: "Checking",
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
          },
    [language]
  );
  const openClawVersionLabel = openClawVersion?.version
    ? `${systemUi.versionPrefix}${openClawVersion.version}`
    : `${systemUi.versionPrefix}--`;
  const openClawVersionHealthy = Boolean(openClawVersion?.version && !openClawVersion.error);
  const hivewardVersionTitle = hivewardUpdate?.updateAvailable
    ? `${hivewardHomeUi.updateAvailable}: ${hivewardVersionLabel}`
    : `Hiveward ${hivewardVersionLabel}`;
  const gatewaySettings = openClawConfig?.gateway;
  const gatewayStatusLabel = gatewaySettings?.url ? openClawPanelUi.configured : openClawPanelUi.notConfigured;
  const gatewaySourceLabel =
    gatewaySettings?.source === "environment"
      ? openClawPanelUi.environment
      : gatewaySettings?.source === "config"
        ? openClawPanelUi.configFile
        : openClawPanelUi.none;
  const gatewayAuthLabel = [
    gatewaySettings?.tokenConfigured ? "Token" : undefined,
    gatewaySettings?.passwordConfigured ? "Password" : undefined
  ]
    .filter(Boolean)
    .join(" / ") || openClawPanelUi.notConfigured;
  const openClawPanelBusy = busyAction === "checkOpenClawUpdates";
  const installingOpenClawSkills = busyAction === "installHarnessSkills:openclaw";
  const installingClaudeCodeSkills = busyAction === "installHarnessSkills:claudeCode";
  const installingCodexSkills = busyAction === "installHarnessSkills:codex";
  const installingGoogleSkills = busyAction === "installHarnessSkills:google";
  const installingCursorSkills = busyAction === "installHarnessSkills:cursor";
  const installingOpenCodeSkills = busyAction === "installHarnessSkills:opencode";
  const installingHermesSkills = busyAction === "installHarnessSkills:hermes";
  const openClawHarnessStatus = harnessStatuses.find((status) => status.id === "openclaw");
  const claudeCodeHarnessStatus = harnessStatuses.find((status) => status.id === "claudeCode");
  const codexHarnessStatus = harnessStatuses.find((status) => status.id === "codex");
  const googleHarnessStatus = harnessStatuses.find((status) => status.id === "google");
  const cursorHarnessStatus = harnessStatuses.find((status) => status.id === "cursor");
  const opencodeHarnessStatus = harnessStatuses.find((status) => status.id === "opencode");
  const hermesHarnessStatus = harnessStatuses.find((status) => status.id === "hermes");
  const themeToggleTitle = theme === "dark" ? systemUi.switchToDay : systemUi.switchToNight;
  const themeToggleLabel = theme === "dark" ? systemUi.day : systemUi.night;
  const companySwitcherLabel = language === "zh-CN" ? "\u9009\u62E9\u516C\u53F8" : "Choose company";
  const activeTaskCount = useMemo(
    () => runs.filter(isActiveRunView).length,
    [runs]
  );
  const pendingApprovalCount = useMemo(
    () => approvals.filter(isActionableApproval).length,
    [approvals]
  );
  const waitingUserKanbanCount = blueprintKanbanBoard.lanes.waiting_user.length;

  const sidebarActivityMeta = useMemo<Partial<Record<RouteId, number>>>(
    () => ({
      blueprint: activeCountOrUndefined(dirtyBlueprintIds.size),
      runs: activeCountOrUndefined(activeTaskCount),
      approvals: activeCountOrUndefined(pendingApprovalCount + waitingUserKanbanCount),
      schedule: activeCountOrUndefined(activeTaskCount + pendingApprovalCount + waitingUserKanbanCount),
      openclaw: activeCountOrUndefined(countHarnessStatusActivity(openClawHarnessStatus) + countHarnessSkillActivity(harnessSkillStatuses.openclaw)),
      claudeCodeConfig: activeCountOrUndefined(countHarnessStatusActivity(claudeCodeHarnessStatus) + countHarnessSkillActivity(harnessSkillStatuses.claudeCode)),
      codexConfig: activeCountOrUndefined(countHarnessStatusActivity(codexHarnessStatus) + countHarnessSkillActivity(harnessSkillStatuses.codex)),
      googleConfig: activeCountOrUndefined(countHarnessStatusActivity(googleHarnessStatus) + countHarnessSkillActivity(harnessSkillStatuses.google)),
      cursorConfig: activeCountOrUndefined(countHarnessStatusActivity(cursorHarnessStatus) + countHarnessSkillActivity(harnessSkillStatuses.cursor)),
      opencodeConfig: activeCountOrUndefined(countHarnessStatusActivity(opencodeHarnessStatus) + countHarnessSkillActivity(harnessSkillStatuses.opencode)),
      hermesConfig: activeCountOrUndefined(countHarnessStatusActivity(hermesHarnessStatus) + countHarnessSkillActivity(harnessSkillStatuses.hermes)),
      skills: activeCountOrUndefined(countHarnessSkillActivity(harnessSkillStatuses.openclaw)),
      hermesSkills: activeCountOrUndefined(countHarnessSkillActivity(harnessSkillStatuses.hermes))
    }),
    [
      dirtyBlueprintIds.size,
      pendingApprovalCount,
      waitingUserKanbanCount,
      activeTaskCount,
      openClawHarnessStatus,
      claudeCodeHarnessStatus,
      codexHarnessStatus,
      googleHarnessStatus,
      cursorHarnessStatus,
      opencodeHarnessStatus,
      hermesHarnessStatus,
      harnessSkillStatuses.openclaw,
      harnessSkillStatuses.claudeCode,
      harnessSkillStatuses.codex,
      harnessSkillStatuses.google,
      harnessSkillStatuses.cursor,
      harnessSkillStatuses.opencode,
      harnessSkillStatuses.hermes
    ]
  );

  const toggleSystemGroup = useCallback((systemId: RouteSystemId) => {
    setExpandedSystems((current) => ({ ...current, [systemId]: !current[systemId] }));
  }, []);

  const openBlueprintImport = useCallback(() => {
    blueprintImportInputRef.current?.click();
  }, []);

  const addWidget = useCallback(
    (type: DashboardWidgetType) => {
      mutateDashboard((current) => ({
        ...current,
        dashboardWidgets: [
          ...current.dashboardWidgets,
          {
            id: makeClientId("widget"),
            type,
            title: defaultWidgetTitle(type, t),
            layout: defaultWidgetLayout(current.dashboardWidgets.length),
            config: {}
          }
        ],
        updatedAt: new Date().toISOString()
      }));
    },
    [mutateDashboard, t]
  );

  const removeWidget = useCallback(
    (widgetId: string) => {
      mutateDashboard((current) => ({
        ...current,
        dashboardWidgets: current.dashboardWidgets.filter((widget) => widget.id !== widgetId),
        updatedAt: new Date().toISOString()
      }));
    },
    [mutateDashboard]
  );

  const toggleLanguage = useCallback(() => {
    setLanguage((current) => (current === "zh-CN" ? "en" : "zh-CN"));
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((current) => (current === "dark" ? "light" : "dark"));
  }, []);

  const setSdkChatPermissionMode = useCallback((harnessId: SdkChatHarnessId, permissionMode: ChatPermissionMode) => {
    setChatPermissionModes((current) => ({ ...current, [harnessId]: permissionMode }));
  }, []);

  useEffect(() => {
    if (!systemMenuOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (systemMenuRef.current?.contains(event.target as Node)) return;
      setSystemMenuOpen(false);
    };

    window.addEventListener("mousedown", handlePointerDown);
    return () => window.removeEventListener("mousedown", handlePointerDown);
  }, [systemMenuOpen]);

  const renderRoute = (routeId: RouteId): ReactNode => (
    <WorkspaceRouteRenderer
      routeId={routeId}
      workspace={workspace}
      language={language}
      t={t}
      chatPermissionModes={chatPermissionModes}
      hivewardHomeUi={hivewardHomeUi}
      hivewardVersionLabel={hivewardVersionLabel}
      openClawPanelUi={openClawPanelUi}
      openClawVersionLabel={openClawVersionLabel}
      openClawVersionHealthy={openClawVersionHealthy}
      gatewaySettings={gatewaySettings}
      gatewayStatusLabel={gatewayStatusLabel}
      gatewaySourceLabel={gatewaySourceLabel}
      gatewayAuthLabel={gatewayAuthLabel}
      openClawPanelBusy={openClawPanelBusy}
      openClawHarnessStatus={openClawHarnessStatus}
      claudeCodeHarnessStatus={claudeCodeHarnessStatus}
      codexHarnessStatus={codexHarnessStatus}
      googleHarnessStatus={googleHarnessStatus}
      cursorHarnessStatus={cursorHarnessStatus}
      opencodeHarnessStatus={opencodeHarnessStatus}
      hermesHarnessStatus={hermesHarnessStatus}
      installingOpenClawSkills={installingOpenClawSkills}
      installingClaudeCodeSkills={installingClaudeCodeSkills}
      installingCodexSkills={installingCodexSkills}
      installingGoogleSkills={installingGoogleSkills}
      installingCursorSkills={installingCursorSkills}
      installingOpenCodeSkills={installingOpenCodeSkills}
      installingHermesSkills={installingHermesSkills}
      openBlueprintImport={openBlueprintImport}
      setSdkChatPermissionMode={setSdkChatPermissionMode}
    />
  );

  return (
    <AppLayout
      error={error}
      importControl={
        <input
          ref={blueprintImportInputRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(event) => {
            importBlueprintFile(event.target.files?.[0]);
            event.currentTarget.value = "";
          }}
        />
      }
      sidebar={
        <Sidebar
          activityMeta={sidebarActivityMeta}
          companySwitcherLabel={companySwitcherLabel}
          dashboardDirty={dashboardDirty}
          dirtyWorkspaceLabel={t.common.dirtyWorkspace}
          expandedSystems={expandedSystems}
          hivewardHomeNewBadge={hivewardHomeUi.newBadge}
          hivewardUpdateAvailable={Boolean(hivewardUpdate?.updateAvailable)}
          hivewardVersionLabel={hivewardVersionLabel}
          hivewardVersionTitle={hivewardVersionTitle}
          language={language}
          languageSwitchTitle={t.actions.switchLanguage}
          navigationLabels={t.navigation}
          selectedCompanyLogoLabel={selectedCompany?.logoLabel}
          selectedCompanyLogoUrl={selectedCompany?.logoUrl}
          selectedCompanyName={selectedCompany?.name}
          systemMenuOpen={systemMenuOpen}
          systemMenuRef={systemMenuRef}
          systemUi={systemUi}
          theme={theme}
          themeToggleLabel={themeToggleLabel}
          themeToggleTitle={themeToggleTitle}
          onCheckHivewardUpdate={() => {
            void checkHivewardUpdate();
          }}
          onCloseSystemMenu={() => setSystemMenuOpen(false)}
          onToggleLanguage={toggleLanguage}
          onToggleSystemGroup={toggleSystemGroup}
          onToggleSystemMenu={() => setSystemMenuOpen((current) => !current)}
          onToggleTheme={toggleTheme}
        />
      }
    >
      <AppRoutes renderRoute={renderRoute} selectedCompanyId={selectedCompanyId} />
    </AppLayout>
  );
}

function getInitialTheme(): AppTheme {
  const stored = localStorage.getItem("hiveward-theme");
  if (stored === "light" || stored === "dark") return stored;
  if (typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: light)").matches) return "light";
  return "dark";
}

function getInitialChatPermissionModes(): Record<SdkChatHarnessId, ChatPermissionMode> {
  const defaultMode: ChatPermissionMode = "full_access";
  const fallback: Record<SdkChatHarnessId, ChatPermissionMode> = {
    claudeCode: defaultMode,
    codex: defaultMode,
    google: defaultMode,
    cursor: defaultMode,
    opencode: defaultMode,
    hermes: defaultMode
  };
  const readMode = (value: unknown): ChatPermissionMode => (value === "safe" || value === "full_access" ? value : defaultMode);
  const stored = localStorage.getItem(CHAT_PERMISSION_MODES_STORAGE_KEY);
  if (!stored) return fallback;
  try {
    const parsed = JSON.parse(stored) as unknown;
    if (!parsed || typeof parsed !== "object") return fallback;
    const storedModes = parsed as {
      version?: number;
      modes?: Partial<Record<SdkChatHarnessId, ChatPermissionMode>>;
    };
    if (storedModes.version !== CHAT_PERMISSION_MODES_STORAGE_VERSION || !storedModes.modes) return fallback;
    const modes = storedModes.modes;
    return {
      claudeCode: readMode(modes.claudeCode),
      codex: readMode(modes.codex),
      google: readMode(modes.google),
      cursor: readMode(modes.cursor),
      opencode: readMode(modes.opencode),
      hermes: readMode(modes.hermes)
    };
  } catch {
    return fallback;
  }
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

function isActionableApproval(approval: PendingApprovalItem): boolean {
  return approval.status !== "approved" && approval.status !== "rejected" && approval.status !== "replying";
}

function defaultWidgetTitle(type: DashboardWidgetType, t: Messages): string {
  if (type === "pending_approvals") return t.widgetTypes.approvals;
  if (type === "runtime_overview") return t.common.realTime;
  if (type === "catalog_status") return t.widgetTypes.catalog;
  return t.widgetTypes.notes;
}

function defaultWidgetLayout(index: number) {
  return {
    x: index % 2 === 0 ? 0 : 6,
    y: Math.floor(index / 2) * 4,
    w: 6,
    h: 4
  };
}

function makeClientId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
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

function isApprovalInboxActionBusy(action: string | undefined): boolean {
  return Boolean(action && (
    action === "approveApprovalRequest" ||
    action === "rejectApprovalRequest" ||
    action === "replyApprovalRequest" ||
    action === "returnForRevisionApprovalRequest" ||
    action === "completeRunApproval" ||
    action === "sendHumanActionResponse"
  ));
}
