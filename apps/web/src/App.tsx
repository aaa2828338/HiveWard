import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Bot,
  Building2,
  ChevronDown,
  ChevronRight,
  Cloud,
  Database,
  History,
  Inbox,
  Languages,
  LayoutTemplate,
  ListChecks,
  MessageSquareText,
  Moon,
  Puzzle,
  Radio,
  RefreshCw,
  Settings,
  Sun
} from "lucide-react";
import type {
  CatalogSnapshot,
  CompanyOverview,
  CreateCompanyRequest,
  ConfigureOpenClawChannelRequest,
  ConfigureOpenClawModelAuthRequest,
  DashboardWidgetType,
  HarnessStatus,
  ArchitectureBlueprintView,
  CompanyRoleDirectory,
  InboxItem,
  OpenClawConfigWizardMetadata,
  OpenClawConfigState,
  OpenClawModelUsageSummary,
  OpenClawVersionInfo,
  PendingApprovalItem,
  PortableBlueprintPackage,
  RuntimeOverview,
  WorkspaceDashboard,
  BlueprintDefinition,
  BlueprintRunSummary,
  BlueprintRunView
} from "@hiveward/shared";
import { api } from "./lib/api";
import { appSectionGroups, type AppNavSectionId, type AppSectionId, type AppSystemId } from "./lib/app-sections";
import { getInitialLanguage, messages, type Language, type Messages } from "./lib/i18n";
import { isActiveRunView, selectRunPollingTarget, syncApprovalsForRun, syncRunDetails, upsertRunSummary } from "./lib/run-state";
import { BlueprintStudioPage } from "./components/BlueprintStudioPage";
import hivewardPackage from "../../../package.json";
import {
  AgentsPage,
  ApprovalsPage,
  ChannelsPage,
  CompanyDirectoryPage,
  CompanyPage,
  HistoryPage,
  ModelsPage,
  RunsPage,
  SkillsPage
} from "./components/WorkspacePages";
import { ChatPage } from "./components/ChatPage";

const sidebarIcons = {
  company: Building2,
  chat: MessageSquareText,
  blueprint: LayoutTemplate,
  runs: ListChecks,
  approvals: Inbox,
  models: Database,
  agents: Bot,
  openclaw: Settings,
  skills: Puzzle,
  schedule: History,
  channels: Radio,
  claudeCodeConfig: Settings,
  codexConfig: Settings
};

const systemLabels: Record<AppSystemId, string> = {
  hiveward: "Hiveward",
  openclaw: "OpenClaw",
  claudeCode: "Claude code",
  codex: "Codex"
};

const RUN_POLL_INTERVAL_MS = 2500;
const companyScopedSections = new Set<AppSectionId>(["company", "chat", "blueprint", "runs", "approvals", "schedule"]);
const hivewardVersionLabel = `v${hivewardPackage.version}`;

type AppTheme = "light" | "dark";

type OpenClawPanelCopy = {
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
};

export function App() {
  const [language, setLanguage] = useState<Language>(() => getInitialLanguage());
  const [theme, setTheme] = useState<AppTheme>(() => getInitialTheme());
  const [section, setSection] = useState<AppSectionId>("blueprint");
  const [companies, setCompanies] = useState<CompanyOverview[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | undefined>();
  const [blueprints, setBlueprints] = useState<BlueprintDefinition[]>([]);
  const [blueprint, setBlueprint] = useState<BlueprintDefinition | undefined>();
  const [catalog, setCatalog] = useState<CatalogSnapshot | undefined>();
  const [openClawConfig, setOpenClawConfig] = useState<OpenClawConfigState | undefined>();
  const [openClawWizard, setOpenClawWizard] = useState<OpenClawConfigWizardMetadata | undefined>();
  const [openClawModelUsage, setOpenClawModelUsage] = useState<OpenClawModelUsageSummary[]>([]);
  const [openClawVersion, setOpenClawVersion] = useState<OpenClawVersionInfo | undefined>();
  const [harnessStatuses, setHarnessStatuses] = useState<HarnessStatus[]>([]);
  const [runtime, setRuntime] = useState<RuntimeOverview | undefined>();
  const [runSummaries, setRunSummaries] = useState<BlueprintRunSummary[]>([]);
  const [runDetailsById, setRunDetailsById] = useState<Record<string, BlueprintRunView>>({});
  const [approvals, setApprovals] = useState<PendingApprovalItem[]>([]);
  const [roleDirectory, setRoleDirectory] = useState<CompanyRoleDirectory | undefined>();
  const [architecture, setArchitecture] = useState<ArchitectureBlueprintView | undefined>();
  const [inboxItems, setInboxItems] = useState<InboxItem[]>([]);
  const [dashboard, setDashboard] = useState<WorkspaceDashboard | undefined>();
  const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>();
  const [selectedRunId, setSelectedRunId] = useState<string | undefined>();
  const [runPageBlueprintId, setRunPageBlueprintId] = useState<string | undefined>();
  const [busyAction, setBusyAction] = useState<string | undefined>();
  const [dashboardDirty, setDashboardDirty] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [systemMenuOpen, setSystemMenuOpen] = useState(false);
  const [expandedSystems, setExpandedSystems] = useState<Record<AppSystemId, boolean>>({
    hiveward: true,
    openclaw: true,
    claudeCode: false,
    codex: false
  });
  const t = messages[language];
  const messageRef = useRef(t);
  const selectedBlueprintIdRef = useRef<string | undefined>(undefined);
  const selectedRunIdRef = useRef<string | undefined>(undefined);
  const systemMenuRef = useRef<HTMLDivElement | null>(null);
  const blueprintImportInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    messageRef.current = t;
  }, [t]);

  useEffect(() => {
    selectedBlueprintIdRef.current = blueprint?.id;
  }, [blueprint?.id]);

  useEffect(() => {
    selectedRunIdRef.current = selectedRunId;
  }, [selectedRunId]);

  useEffect(() => {
    localStorage.setItem("hiveward-language", language);
  }, [language]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("hiveward-theme", theme);
  }, [theme]);

  useEffect(() => {
    if (selectedCompanyId || !companyScopedSections.has(section)) return;
    setSection("companyDirectory");
  }, [section, selectedCompanyId]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [section]);

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

  const runs = useMemo<BlueprintRunView[]>(
    () =>
      runSummaries.map((summary) => {
        const detail = runDetailsById[summary.id];
        return detail ? { ...detail, run: summary } : { run: summary, nodeRuns: [], events: [], finalResult: null };
      }),
    [runSummaries, runDetailsById]
  );

  const hydrateWorkspace = useCallback(
    async (options?: { blueprintId?: string; runId?: string }) => {
      const [
        companyDirectory,
        nextBlueprints,
        nextCatalog,
        nextOpenClawConfig,
        nextOpenClawWizard,
        nextOpenClawModelUsage,
        nextHarnessStatuses,
        nextRunSummaries,
        nextApprovals,
        nextRoles,
        nextInboxItems,
        nextDashboard,
        nextRuntime
      ] = await Promise.all([
        api.listCompanies(),
        api.listBlueprints(),
        api.getCatalogSnapshot(),
        api.getOpenClawConfig(),
        api.getOpenClawConfigWizard(),
        api.getOpenClawModelUsage().catch(() => []),
        api.getHarnessStatus().catch(() => []),
        api.listBlueprintRuns(),
        api.listPendingApprovals(),
        api.getRoleDirectory().catch(() => undefined),
        api.listInboxItems().catch(() => []),
        api.getDashboardState(),
        api.getRuntimeOverview().catch(() => emptyRuntimeOverview())
      ]);

      const preferredRunId = options?.runId ?? selectedRunIdRef.current;
      const nextRunId = preferredRunId && nextRunSummaries.some((item) => item.id === preferredRunId) ? preferredRunId : undefined;
      const nextRunView = nextRunId ? await api.getBlueprintRun(nextRunId).catch(() => undefined) : undefined;

      setCompanies(companyDirectory.companies);
      setSelectedCompanyId(companyDirectory.selectedCompanyId);
      setBlueprints(nextBlueprints);
      setCatalog(nextCatalog);
      setOpenClawConfig(nextOpenClawConfig);
      setOpenClawWizard(nextOpenClawWizard);
      setOpenClawModelUsage(nextOpenClawModelUsage);
      setHarnessStatuses(nextHarnessStatuses);
      setRunSummaries(nextRunSummaries);
      setRunDetailsById((current) => syncRunDetails(current, nextRunSummaries, nextRunView));
      setApprovals(nextApprovals);
      setRoleDirectory(nextRoles?.roles);
      setArchitecture(nextRoles?.architecture);
      setInboxItems(nextInboxItems);
      setDashboard(nextDashboard);
      setRuntime(nextRuntime);
      setDashboardDirty(false);

      const preferredBlueprintId = options?.blueprintId ?? selectedBlueprintIdRef.current ?? nextBlueprints[0]?.id;
      const nextBlueprint = nextBlueprints.find((item) => item.id === preferredBlueprintId) ?? nextBlueprints[0];
      setBlueprint(nextBlueprint);
      setSelectedNodeId(undefined);
      setSelectedRunId(nextRunId);
    },
    []
  );

  const selectedCompany = useMemo(
    () => companies.find((company) => company.id === selectedCompanyId),
    [companies, selectedCompanyId]
  );
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
            checking: "\u68c0\u67e5\u4e2d"
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
            checking: "Checking"
          },
    [language]
  );
  const openClawVersionLabel = openClawVersion?.version
    ? `${systemUi.versionPrefix}${openClawVersion.version}`
    : `${systemUi.versionPrefix}--`;
  const openClawVersionHealthy = Boolean(openClawVersion?.version && !openClawVersion.error);
  const hivewardVersionTitle = `Hiveward ${hivewardVersionLabel}`;
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
  const openClawHarnessStatus = harnessStatuses.find((status) => status.id === "openclaw");
  const claudeCodeHarnessStatus = harnessStatuses.find((status) => status.id === "claudeCode");
  const codexHarnessStatus = harnessStatuses.find((status) => status.id === "codex");
  const themeToggleTitle = theme === "dark" ? systemUi.switchToDay : systemUi.switchToNight;
  const themeToggleLabel = theme === "dark" ? systemUi.day : systemUi.night;
  const companySwitcherLabel = language === "zh-CN" ? "\u9009\u62E9\u516C\u53F8" : "Choose company";

  useEffect(() => {
    setBusyAction("load");
    setError(undefined);
    void hydrateWorkspace()
      .catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : messageRef.current.errors.load);
      })
      .finally(() => {
        setBusyAction(undefined);
      });
  }, [hydrateWorkspace]);

  const latestRunForBlueprint = useMemo(
    () => (blueprint ? runs.find((runView) => runView.run.blueprintId === blueprint.id) : undefined),
    [runs, blueprint]
  );
  const runPageBlueprint = useMemo(
    () => blueprints.find((item) => item.id === runPageBlueprintId),
    [blueprints, runPageBlueprintId]
  );

  useEffect(() => {
    if (!runPageBlueprintId || runPageBlueprint) return;
    setRunPageBlueprintId(undefined);
    setSelectedRunId(undefined);
  }, [runPageBlueprint, runPageBlueprintId]);

  useEffect(() => {
    if (section !== "runs" || runPageBlueprintId || runs.length === 0) return;
    const preferredRun =
      runs.find(isActiveRunView) ??
      (blueprint ? runs.find((runView) => runView.run.blueprintId === blueprint.id) : undefined) ??
      runs[0];
    if (!preferredRun) return;
    setRunPageBlueprintId(preferredRun.run.blueprintId);
    setSelectedRunId(preferredRun.run.id);
  }, [blueprint, runPageBlueprintId, runs, section]);

  const activeTaskCount = useMemo(
    () => runs.filter(isActiveRunView).length,
    [runs]
  );
  const pendingInboxCount = useMemo(() => inboxItems.filter((item) => item.status === "pending").length, [inboxItems]);
  const pollingRunId = useMemo(
    () =>
      selectRunPollingTarget({
        runs,
        selectedBlueprintId: section === "runs" ? runPageBlueprint?.id : blueprint?.id,
        selectedRunId,
        view: section === "runs" ? "runs" : "blueprint"
      }),
    [blueprint?.id, runPageBlueprint?.id, runs, section, selectedRunId]
  );

  const selectBlueprint = useCallback(
    (blueprintId: string) => {
      const next = blueprints.find((item) => item.id === blueprintId);
      if (!next) return;
      setBlueprint(next);
      setSelectedNodeId(undefined);
      const latestRunForNextBlueprint = runs.find((runView) => runView.run.blueprintId === next.id);
      setSelectedRunId(latestRunForNextBlueprint?.run.id);
    },
    [runs, blueprints]
  );

  const selectRunPageBlueprint = useCallback(
    (blueprintId: string) => {
      setRunPageBlueprintId(blueprintId);
      selectBlueprint(blueprintId);
    },
    [selectBlueprint]
  );

  const sidebarMeta = useMemo<Partial<Record<AppNavSectionId, number>>>(
    () => ({
      company: companies.length,
      blueprint: blueprints.length,
      runs: activeTaskCount,
      approvals: approvals.length + pendingInboxCount,
      models: openClawConfig?.configuredModels.length ?? 0,
      agents: openClawConfig?.configuredAgents.length ?? 0,
      skills: catalog?.tools.length ?? 0,
      schedule: runs.length + approvals.length + pendingInboxCount,
      channels: openClawConfig?.configuredChannels.length ?? 0
    }),
    [
      companies.length,
      approvals.length,
      pendingInboxCount,
      activeTaskCount,
      openClawConfig?.configuredModels.length,
      openClawConfig?.configuredAgents.length,
      openClawConfig?.configuredChannels.length,
      catalog?.tools.length,
      runs.length,
      blueprints.length
    ]
  );

  const toggleSystemGroup = useCallback((systemId: AppSystemId) => {
    setExpandedSystems((current) => ({ ...current, [systemId]: !current[systemId] }));
  }, []);

  const withBusy = useCallback(async (action: string, work: () => Promise<void>) => {
    setBusyAction(action);
    setError(undefined);
    try {
      await work();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : errorMessageForAction(action, messageRef.current));
    } finally {
      setBusyAction(undefined);
    }
  }, []);

  const applyRunView = useCallback((runView: BlueprintRunView) => {
    setRunDetailsById((current) => ({ ...current, [runView.run.id]: runView }));
    setRunSummaries((current) => upsertRunSummary(current, runView.run));
    setApprovals((current) => syncApprovalsForRun(current, runView));
  }, []);

  const loadOpenClawVersion = useCallback(async () => {
    try {
      setOpenClawVersion(await api.getOpenClawVersion());
    } catch (versionError) {
      setOpenClawVersion({
        resolvedAt: new Date().toISOString(),
        error: versionError instanceof Error ? versionError.message : String(versionError)
      });
    }
  }, []);

  useEffect(() => {
    void loadOpenClawVersion();
  }, [loadOpenClawVersion]);

  const updateBlueprint = useCallback((updater: (current: BlueprintDefinition) => BlueprintDefinition) => {
    setBlueprint((current) => (current ? updater(current) : current));
  }, []);

  const mutateDashboard = useCallback((updater: (current: WorkspaceDashboard) => WorkspaceDashboard) => {
    setDashboard((current) => {
      if (!current) return current;
      return updater(current);
    });
    setDashboardDirty(true);
  }, []);

  const refreshWorkspace = useCallback(() => withBusy("refreshWorkspace", () => hydrateWorkspace()), [hydrateWorkspace, withBusy]);

  const enterCompany = useCallback(
    (companyId: string) => {
      void withBusy("enterCompany", async () => {
        await api.selectCompany(companyId);
        setSection("company");
        await hydrateWorkspace();
      });
    },
    [hydrateWorkspace, withBusy]
  );

  const createCompany = useCallback(
    (input: CreateCompanyRequest) =>
      withBusy("createCompany", async () => {
        await api.createCompany(input);
        await hydrateWorkspace();
      }),
    [hydrateWorkspace, withBusy]
  );

  const deleteCompany = useCallback(
    (companyId: string) => {
      void withBusy("deleteCompany", async () => {
        await api.deleteCompany(companyId);
        await hydrateWorkspace();
      });
    },
    [hydrateWorkspace, withBusy]
  );

  const refreshCatalog = useCallback(
    () =>
      withBusy("refreshCatalog", async () => {
        const [nextCatalog, nextOpenClawConfig, nextOpenClawModelUsage, nextHarnessStatuses, nextRuntime] = await Promise.all([
          api.refreshCatalog(),
          api.getOpenClawConfig(),
          api.getOpenClawModelUsage().catch(() => []),
          api.getHarnessStatus().catch(() => []),
          api.getRuntimeOverview().catch(() => emptyRuntimeOverview())
        ]);
        setCatalog(nextCatalog);
        setOpenClawConfig(nextOpenClawConfig);
        setOpenClawModelUsage(nextOpenClawModelUsage);
        setHarnessStatuses(nextHarnessStatuses);
        setRuntime(nextRuntime);
      }),
    [withBusy]
  );

  const checkOpenClawUpdates = useCallback(
    () =>
      withBusy("checkOpenClawUpdates", async () => {
        const [nextOpenClawVersion, nextCatalog, nextOpenClawConfig, nextOpenClawModelUsage, nextHarnessStatuses, nextRuntime] = await Promise.all([
          api.getOpenClawVersion(),
          api.refreshCatalog(),
          api.getOpenClawConfig(),
          api.getOpenClawModelUsage().catch(() => []),
          api.getHarnessStatus().catch(() => []),
          api.getRuntimeOverview().catch(() => emptyRuntimeOverview())
        ]);
        setOpenClawVersion(nextOpenClawVersion);
        setCatalog(nextCatalog);
        setOpenClawConfig(nextOpenClawConfig);
        setOpenClawModelUsage(nextOpenClawModelUsage);
        setHarnessStatuses(nextHarnessStatuses);
        setRuntime(nextRuntime);
      }),
    [withBusy]
  );

  const refreshHarnessStatus = useCallback(
    () =>
      withBusy("refreshHarnessStatus", async () => {
        setHarnessStatuses(await api.getHarnessStatus());
      }),
    [withBusy]
  );

  const addOpenClawAgent = useCallback(
    (input: { name: string; workspace?: string; modelId?: string }) => {
      void withBusy("addOpenClawAgent", async () => {
        const nextOpenClawConfig = await api.addOpenClawAgent(input);
        setOpenClawConfig(nextOpenClawConfig);
      });
    },
    [withBusy]
  );

  const configureOpenClawModelAuth = useCallback(
    (input: ConfigureOpenClawModelAuthRequest) => {
      void withBusy("configureOpenClawModelAuth", async () => {
        const nextOpenClawConfig = await api.configureOpenClawModelAuth(input);
        setOpenClawConfig(nextOpenClawConfig);
      });
    },
    [withBusy]
  );

  const setOpenClawDefaultModel = useCallback(
    (modelId: string) => {
      void withBusy(`setOpenClawDefaultModel:${modelId}`, async () => {
        const nextOpenClawConfig = await api.updateOpenClawDefaultModel(modelId);
        setOpenClawConfig(nextOpenClawConfig);
      });
    },
    [withBusy]
  );

  const configureOpenClawChannel = useCallback(
    (input: ConfigureOpenClawChannelRequest) => {
      void withBusy("configureOpenClawChannel", async () => {
        const nextOpenClawConfig = await api.configureOpenClawChannel(input);
        setOpenClawConfig(nextOpenClawConfig);
      });
    },
    [withBusy]
  );

  const saveBlueprint = useCallback(() => {
    if (!blueprint) return;
    void withBusy("saveBlueprint", async () => {
      const saved = await api.saveBlueprint(blueprint);
      await hydrateWorkspace({ blueprintId: saved.id });
    });
  }, [hydrateWorkspace, withBusy, blueprint]);

  const exportBlueprint = useCallback((blueprintId?: string) => {
    const targetBlueprint = blueprintId ? blueprints.find((item) => item.id === blueprintId) : blueprint;
    if (!targetBlueprint) return;
    void withBusy("exportBlueprint", async () => {
      const blueprintPackage = await api.exportBlueprint(targetBlueprint.id);
      downloadBlueprintPackage(blueprintPackage, targetBlueprint.name);
    });
  }, [blueprint, blueprints, withBusy]);

  const deleteBlueprint = useCallback((blueprintId: string) => {
    void withBusy("deleteBlueprint", async () => {
      await api.deleteBlueprint(blueprintId);
      const remainingBlueprints = blueprints.filter((item) => item.id !== blueprintId);
      const nextBlueprintId = blueprint?.id === blueprintId ? remainingBlueprints[0]?.id : blueprint?.id;
      await hydrateWorkspace({ blueprintId: nextBlueprintId });
    });
  }, [blueprint?.id, blueprints, hydrateWorkspace, withBusy]);

  const openBlueprintImport = useCallback(() => {
    blueprintImportInputRef.current?.click();
  }, []);

  const importBlueprintFile = useCallback(
    (file?: File) => {
      if (!file) return;
      void withBusy("importBlueprint", async () => {
        const blueprintPackage = JSON.parse(await file.text());
        const imported = await api.importBlueprintPackage(blueprintPackage);
        await hydrateWorkspace({ blueprintId: imported[0]?.id });
        setSection("blueprint");
      });
    },
    [hydrateWorkspace, withBusy]
  );

  const createBlueprint = useCallback(() => {
    void withBusy("createBlueprint", async () => {
      const created = await api.createBlueprint({
        name: defaultNewBlueprintName(blueprints.length + 1, language)
      });
      await hydrateWorkspace({ blueprintId: created.id });
      setSection("blueprint");
    });
  }, [hydrateWorkspace, language, withBusy, blueprints.length]);

  const runBlueprint = useCallback(() => {
    if (!blueprint) return;
    void withBusy("runBlueprint", async () => {
      const saved = await api.saveBlueprint(blueprint);
      setBlueprint(saved);
      setBlueprints((current) => replaceBlueprint(current, saved));
      const runView = await api.startBlueprintRun(saved.id);
      applyRunView(runView);
      setRunPageBlueprintId(saved.id);
      setSelectedRunId(runView.run.id);
    });
  }, [applyRunView, withBusy, blueprint]);

  const cancelBlueprintRun = useCallback(() => {
    const targetRunId = latestRunForBlueprint?.run.id;
    if (!targetRunId) return;
    void withBusy("cancelBlueprintRun", async () => {
      const updated = await api.cancelBlueprintRun(targetRunId);
      applyRunView(updated);
      setSelectedRunId(updated.run.id);
    });
  }, [applyRunView, latestRunForBlueprint?.run.id, withBusy]);

  const approveRun = useCallback(
    (blueprintRunId?: string, nodeRunId?: string) => {
      const targetRunId = blueprintRunId ?? latestRunForBlueprint?.run.id;
      if (!targetRunId) return;
      void withBusy("approveRun", async () => {
        const updated = await api.approveBlueprintRun(targetRunId, nodeRunId);
        applyRunView(updated);
        setSelectedRunId(updated.run.id);
      });
    },
    [applyRunView, latestRunForBlueprint?.run.id, withBusy]
  );

  const approveInboxItem = useCallback(
    (itemId: string) => {
      void withBusy("approveInboxItem", async () => {
        const result = await api.approveInboxItem(itemId);
        await hydrateWorkspace({ blueprintId: result.importedBlueprints?.[0]?.id ?? blueprint?.id });
      });
    },
    [blueprint?.id, hydrateWorkspace, withBusy]
  );

  const rejectInboxItem = useCallback(
    (itemId: string) => {
      void withBusy("rejectInboxItem", async () => {
        await api.rejectInboxItem(itemId);
        await hydrateWorkspace({ blueprintId: blueprint?.id });
      });
    },
    [blueprint?.id, hydrateWorkspace, withBusy]
  );

  const handleChatInboxItemCreated = useCallback(
    (item: InboxItem) => {
      setInboxItems((current) => [item, ...current.filter((candidate) => candidate.id !== item.id)]);
      void hydrateWorkspace({ blueprintId: item.blueprintId ?? blueprint?.id }).catch((refreshError) => {
        setError(refreshError instanceof Error ? refreshError.message : messageRef.current.errors.load);
      });
    },
    [blueprint?.id, hydrateWorkspace]
  );

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

  useEffect(() => {
    if (!systemMenuOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (systemMenuRef.current?.contains(event.target as Node)) return;
      setSystemMenuOpen(false);
    };

    window.addEventListener("mousedown", handlePointerDown);
    return () => window.removeEventListener("mousedown", handlePointerDown);
  }, [systemMenuOpen]);

  useEffect(() => {
    if (!selectedRunId || runDetailsById[selectedRunId]) return;

    let cancelled = false;
    void api.getBlueprintRun(selectedRunId)
      .then((runView) => {
        if (!cancelled) applyRunView(runView);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [applyRunView, runDetailsById, selectedRunId]);

  useEffect(() => {
    if (!pollingRunId) {
      return;
    }

    let cancelled = false;
    let timer: number | undefined;

    const scheduleNextPoll = () => {
      timer = window.setTimeout(() => {
        void api.getBlueprintRun(pollingRunId)
          .then((runView) => {
            if (!cancelled) applyRunView(runView);
          })
          .catch(() => undefined)
          .finally(() => {
            if (!cancelled) scheduleNextPoll();
          });
      }, RUN_POLL_INTERVAL_MS);
    };

    scheduleNextPoll();

    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [applyRunView, pollingRunId]);

  const renderSection = () => {
    if (section === "hivewardHome") {
      return <HivewardHomePage />;
    }
    if (section === "companyDirectory") {
      return (
        <CompanyDirectoryPage
          companies={companies}
          selectedCompanyId={selectedCompanyId}
          language={language}
          busy={Boolean(busyAction)}
          onEnterCompany={enterCompany}
          onCreateCompany={createCompany}
          onDeleteCompany={deleteCompany}
        />
      );
    }
    if (section === "company") {
      return <CompanyPage companies={companies} selectedCompanyId={selectedCompanyId} language={language} />;
    }
    if (section === "chat") {
      return (
        <ChatPage
          catalog={catalog}
          openClawConfig={openClawConfig}
          harnessStatuses={harnessStatuses}
          runtime={runtime}
          company={selectedCompany}
          selectedCompanyId={selectedCompanyId}
          blueprints={blueprints}
          roleDirectory={roleDirectory}
          language={language}
          onInboxItemCreated={handleChatInboxItemCreated}
        />
      );
    }
    if (section === "openclaw") {
      return (
        <OpenClawControlPanelPage
          ui={openClawPanelUi}
          language={language}
          openClawVersionLabel={openClawVersionLabel}
          openClawVersionHealthy={openClawVersionHealthy}
          openClawVersion={openClawVersion}
          openClawConfig={openClawConfig}
          catalog={catalog}
          runtime={runtime}
          gatewaySettings={gatewaySettings}
          gatewayStatusLabel={gatewayStatusLabel}
          gatewaySourceLabel={gatewaySourceLabel}
          gatewayAuthLabel={gatewayAuthLabel}
          harnessStatus={openClawHarnessStatus}
          busy={openClawPanelBusy}
          onCheckUpdates={checkOpenClawUpdates}
        />
      );
    }
    if (section === "blueprint") {
      return (
        <BlueprintStudioPage
          blueprint={blueprint}
          blueprints={blueprints}
          architecture={architecture}
          roleDirectory={roleDirectory}
          catalog={catalog}
          configuredAgents={openClawConfig?.configuredAgents}
          runSummaries={runSummaries}
          runView={latestRunForBlueprint}
          selectedNodeId={selectedNodeId}
          selectedCompanyId={selectedCompanyId}
          busy={Boolean(busyAction)}
          busyAction={busyAction}
          onSelectBlueprint={selectBlueprint}
          onCreateBlueprint={createBlueprint}
          onRefreshWorkspace={refreshWorkspace}
          onOpenBlueprintImport={openBlueprintImport}
          onExportBlueprint={exportBlueprint}
          onDeleteBlueprint={deleteBlueprint}
          onSaveBlueprint={saveBlueprint}
          onRunBlueprint={runBlueprint}
          onCancelBlueprintRun={cancelBlueprintRun}
          onSelectNode={setSelectedNodeId}
          onUpdateBlueprint={updateBlueprint}
          onApproveRun={() => approveRun()}
          t={t}
        />
      );
    }
    if (section === "runs") {
      return (
        <RunsPage
          runs={runs}
          blueprints={blueprints}
          blueprint={runPageBlueprint}
          selectedRunId={selectedRunId}
          language={language}
          t={t}
          onSelectBlueprint={selectRunPageBlueprint}
          onSelectRun={setSelectedRunId}
        />
      );
    }
    if (section === "approvals") {
      return (
        <ApprovalsPage
          approvals={approvals}
          inboxItems={inboxItems}
          language={language}
          t={t}
          onApprove={approveRun}
          onApproveInboxItem={approveInboxItem}
          onRejectInboxItem={rejectInboxItem}
        />
      );
    }
    if (section === "models") {
      return (
        <ModelsPage
          catalog={catalog}
          openClawConfig={openClawConfig}
          wizard={openClawWizard}
          language={language}
          t={t}
          busy={Boolean(busyAction)}
          busyAction={busyAction}
          runs={runs}
          openClawModelUsage={openClawModelUsage}
          onRefreshCatalog={refreshCatalog}
          onConfigureModelAuth={configureOpenClawModelAuth}
          onSetDefaultModel={setOpenClawDefaultModel}
        />
      );
    }
    if (section === "agents") {
      return (
        <AgentsPage
          catalog={catalog}
          openClawConfig={openClawConfig}
          language={language}
          t={t}
          busy={Boolean(busyAction)}
          onAddAgent={addOpenClawAgent}
        />
      );
    }
    if (section === "skills") {
      return <SkillsPage catalog={catalog} language={language} t={t} />;
    }
    if (section === "claudeCodeConfig") {
      return (
        <HarnessConfigPage
          title={t.pages.claudeCodeConfig?.title ?? "Claude code Config"}
          description={t.pages.claudeCodeConfig?.description ?? ""}
          status={claudeCodeHarnessStatus}
          fallbackLabel="Claude code"
          language={language}
          busy={busyAction === "refreshHarnessStatus"}
          onRefresh={refreshHarnessStatus}
        />
      );
    }
    if (section === "codexConfig") {
      return (
        <HarnessConfigPage
          title={t.pages.codexConfig?.title ?? "Codex Config"}
          description={t.pages.codexConfig?.description ?? ""}
          status={codexHarnessStatus}
          fallbackLabel="Codex"
          language={language}
          busy={busyAction === "refreshHarnessStatus"}
          onRefresh={refreshHarnessStatus}
        />
      );
    }
    if (section === "schedule") {
      return <HistoryPage runs={runs} approvals={approvals} blueprints={blueprints} language={language} t={t} />;
    }
    if (section === "channels") {
      return (
      <ChannelsPage
        catalog={catalog}
        openClawConfig={openClawConfig}
        wizard={openClawWizard}
        language={language}
        t={t}
        busy={Boolean(busyAction)}
        onConfigureChannel={configureOpenClawChannel}
      />
      );
    }
    return null;
  };

  return (
    <main className="app-shell">
      <aside className="sidebar-shell">
        <div className="sidebar-brand">
          <div className="brand-mark">
            <img src="/brand/hiveward-hive.png" alt="" />
          </div>
          <div>
            <img
              className="brand-wordmark"
              src={theme === "dark" ? "/brand/hiveward-wordmark-on-dark.png" : "/brand/hiveward-wordmark.png"}
              alt="Hiveward"
            />
          </div>
        </div>
        <nav className="sidebar-nav">
          {appSectionGroups.map((group) => {
            const expanded = expandedSystems[group.id];
            const groupActive = group.sections.some((item) => item === section);
            const systemChildrenId = `sidebar-system-${group.id}`;
            const SystemChevron = expanded ? ChevronDown : ChevronRight;
            return (
              <section key={group.id} className={`nav-system-group ${groupActive ? "active" : ""}`}>
                <button
                  type="button"
                  className={`nav-system-toggle ${groupActive ? "active" : ""}`}
                  aria-expanded={expanded}
                  aria-controls={group.sections.length > 0 ? systemChildrenId : undefined}
                  onClick={() => toggleSystemGroup(group.id)}
                >
                  <span className="nav-system-main">
                    <SystemChevron size={14} />
                    <span className="nav-system-label">{systemLabels[group.id]}</span>
                  </span>
                </button>
                {expanded && group.sections.length > 0 && (
                  <div id={systemChildrenId} className="nav-system-children">
                    {group.sections.map((item) => {
                      const Icon = sidebarIcons[item];
                      return (
                        <button
                          key={item}
                          type="button"
                          className={`nav-item ${section === item ? "active" : ""}`}
                          onClick={() => {
                            setSection(item);
                            setSystemMenuOpen(false);
                          }}
                        >
                          <span className="nav-item-main">
                            <Icon size={16} />
                            <span className="nav-item-label">{t.navigation[item] ?? fallbackNavigationLabel(item, language)}</span>
                          </span>
                          {sidebarMeta[item] !== undefined && <span className="nav-count">{sidebarMeta[item]}</span>}
                        </button>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
        </nav>
        <div className="sidebar-status">
          {dashboardDirty && <span className="status-badge">{t.common.dirtyWorkspace}</span>}
          <div className="sidebar-system" ref={systemMenuRef}>
            <div className="sidebar-company">
              <button
                type="button"
                className={`company-switcher sidebar-company-switcher ${section === "companyDirectory" ? "active" : ""}`}
                title={selectedCompany?.name ?? companySwitcherLabel}
                onClick={() => {
                  setSection("companyDirectory");
                  setSystemMenuOpen(false);
                }}
              >
                <span className="company-switcher-avatar">
                  {selectedCompany?.logoUrl ? (
                    <img src={selectedCompany.logoUrl} alt={selectedCompany.name} />
                  ) : (
                    <span>{companyMonogram(selectedCompany)}</span>
                  )}
                </span>
                <span className="company-switcher-copy">
                  <strong>{selectedCompany?.name ?? companySwitcherLabel}</strong>
                </span>
                <ChevronRight size={16} />
              </button>
            </div>
            <div className="sidebar-system-control">
              <button
                type="button"
                className={`sidebar-system-version online ${section === "hivewardHome" ? "active" : ""}`}
                aria-label={hivewardVersionTitle}
                title={hivewardVersionTitle}
                onClick={() => {
                  setSystemMenuOpen(false);
                  setSection("hivewardHome");
                }}
              >
                <span className="sidebar-system-dot" aria-hidden="true" />
                <strong>{hivewardVersionLabel}</strong>
              </button>
              <button
                type="button"
                className={`sidebar-system-settings ${systemMenuOpen ? "active" : ""}`}
                title={systemUi.settings}
                aria-label={systemUi.settings}
                aria-expanded={systemMenuOpen}
                onClick={() => {
                  setSystemMenuOpen((current) => !current);
                }}
              >
                <Settings size={14} />
              </button>
              {systemMenuOpen && (
                <div className="sidebar-system-menu" aria-label={systemUi.title}>
                  <button type="button" title={themeToggleTitle} aria-label={themeToggleTitle} onClick={toggleTheme}>
                    {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
                    <span>{systemUi.theme}</span>
                    <strong>{themeToggleLabel}</strong>
                  </button>
                  <button type="button" title={t.actions.switchLanguage} aria-label={t.actions.switchLanguage} onClick={toggleLanguage}>
                    <Languages size={14} />
                    <span>{systemUi.language}</span>
                    <strong>{language === "zh-CN" ? "ZH" : "EN"}</strong>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </aside>

      <section className="main-shell">
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
        <section className="page-shell">
          {error && <div className="error-banner">{error}</div>}
          {renderSection()}
        </section>
      </section>
    </main>
  );
}

function HivewardHomePage() {
  return (
    <section className="hiveward-home-page" aria-label="Hiveward">
      <img className="hiveward-home-logo" src="/brand/hiveward-hive.png" alt="Hiveward" />
    </section>
  );
}

function OpenClawControlPanelPage({
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
  onCheckUpdates
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
  onCheckUpdates: () => void;
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

      <HarnessStatusBlock status={harnessStatus} language={language} fallbackLabel="OpenClaw" />

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

function HarnessConfigPage({
  title,
  description,
  status,
  fallbackLabel,
  language,
  busy,
  onRefresh
}: {
  title: string;
  description: string;
  status?: HarnessStatus;
  fallbackLabel: string;
  language: Language;
  busy: boolean;
  onRefresh: () => void;
}) {
  const copy = harnessStatusCopy(language);
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

      <HarnessStatusBlock status={status} language={language} fallbackLabel={fallbackLabel} />
    </section>
  );
}

function HarnessStatusBlock({
  status,
  language,
  fallbackLabel
}: {
  status?: HarnessStatus;
  language: Language;
  fallbackLabel: string;
}) {
  const copy = harnessStatusCopy(language);
  const label = status?.label ?? fallbackLabel;
  const connectionState = status?.connectionState ?? "unavailable";
  return (
    <div className="harness-status-block">
      <div className="openclaw-panel-metrics">
        <OpenClawPanelMetric label={copy.harness} value={label} />
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

function companyMonogram(company?: Pick<CompanyOverview, "logoLabel" | "name">): string {
  if (company?.logoLabel?.trim()) return company.logoLabel.trim().slice(0, 2).toUpperCase();
  if (company?.name?.trim()) {
    const parts = company.name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
    return parts
      .slice(0, 2)
      .map((part) => part[0] ?? "")
      .join("")
      .toUpperCase();
  }
  return "CO";
}

function getInitialTheme(): AppTheme {
  const stored = localStorage.getItem("hiveward-theme");
  if (stored === "light" || stored === "dark") return stored;
  if (typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: light)").matches) return "light";
  return "dark";
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

function emptyRuntimeOverview(): RuntimeOverview {
  return {
    sessions: [],
    tasks: []
  };
}

function defaultWidgetTitle(type: DashboardWidgetType, t: Messages): string {
  if (type === "recent_runs") return t.widgetTypes.runs;
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

function replaceBlueprint(blueprints: BlueprintDefinition[], blueprint: BlueprintDefinition): BlueprintDefinition[] {
  let replaced = false;
  const next = blueprints.map((candidate) => {
    if (candidate.id !== blueprint.id) return candidate;
    replaced = true;
    return blueprint;
  });
  return replaced ? next : [blueprint, ...next];
}

function defaultNewBlueprintName(index: number, language: Language): string {
  return language === "zh-CN" ? `\u65b0\u5efa\u84dd\u56fe ${index}` : `New blueprint ${index}`;
}

function downloadBlueprintPackage(blueprintPackage: PortableBlueprintPackage, blueprintName: string): void {
  const blob = new Blob([`${JSON.stringify(blueprintPackage, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${safeBlueprintFileName(blueprintName)}.blueprint.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function safeBlueprintFileName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "blueprint";
}

function fallbackNavigationLabel(sectionId: AppNavSectionId, language: Language): string {
  if (language === "zh-CN" && sectionId === "chat") return "\u804a\u5929";
  return messages.en.navigation[sectionId] ?? sectionId;
}

function makeClientId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function errorMessageForAction(action: string, t: Messages): string {
  if (action === "createBlueprint") return t.errors.save;
  if (action === "saveBlueprint") return t.errors.save;
  if (action === "exportBlueprint") return t.errors.save;
  if (action === "importBlueprint") return t.errors.save;
  if (action === "runBlueprint") return t.errors.run;
  if (action === "cancelBlueprintRun") return t.errors.run;
  if (action === "approveRun") return t.errors.approve;
  if (action === "configureOpenClawModelAuth") return t.errors.catalog;
  if (action.startsWith("setOpenClawDefaultModel:")) return t.errors.catalog;
  if (action === "addOpenClawAgent") return t.errors.catalog;
  if (action === "configureOpenClawChannel") return t.errors.catalog;
  if (action === "refreshCatalog") return t.errors.catalog;
  return t.errors.load;
}
