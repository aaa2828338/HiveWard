import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Bot,
  CalendarDays,
  ChevronDown,
  Cloud,
  Database,
  Inbox,
  Languages,
  LayoutTemplate,
  ListChecks,
  Moon,
  Radio,
  RefreshCw,
  Settings,
  Sun
} from "lucide-react";
import type {
  CatalogSnapshot,
  CompanyOverview,
  ConfigureOpenClawChannelRequest,
  ConfigureOpenClawModelAuthRequest,
  DashboardWidgetType,
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
import { appSections, type AppSectionId } from "./lib/app-sections";
import { getInitialLanguage, messages, type Language, type Messages } from "./lib/i18n";
import { syncApprovalsForRun, syncRunDetails, upsertRunSummary } from "./lib/run-state";
import { BlueprintStudioPage } from "./components/BlueprintStudioPage";
import { AgentsPage, ApprovalsPage, ChannelsPage, CompanyPage, DashboardPage, ModelsPage, RunsPage, SchedulePage } from "./components/WorkspacePages";

const sidebarIcons = {
  blueprint: LayoutTemplate,
  runs: ListChecks,
  approvals: Inbox,
  models: Database,
  agents: Bot,
  schedule: CalendarDays,
  channels: Radio
};

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
  const [runtime, setRuntime] = useState<RuntimeOverview | undefined>();
  const [runSummaries, setRunSummaries] = useState<BlueprintRunSummary[]>([]);
  const [runDetailsById, setRunDetailsById] = useState<Record<string, BlueprintRunView>>({});
  const [approvals, setApprovals] = useState<PendingApprovalItem[]>([]);
  const [dashboard, setDashboard] = useState<WorkspaceDashboard | undefined>();
  const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>();
  const [selectedRunId, setSelectedRunId] = useState<string | undefined>();
  const [busyAction, setBusyAction] = useState<string | undefined>();
  const [dashboardDirty, setDashboardDirty] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [companyMenuOpen, setCompanyMenuOpen] = useState(false);
  const [systemMenuOpen, setSystemMenuOpen] = useState(false);
  const t = messages[language];
  const messageRef = useRef(t);
  const selectedBlueprintIdRef = useRef<string | undefined>(undefined);
  const selectedRunIdRef = useRef<string | undefined>(undefined);
  const companySwitcherRef = useRef<HTMLDivElement | null>(null);
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
    if (selectedCompanyId || section === "openclaw") return;
    setSection("company");
  }, [section, selectedCompanyId]);

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
        nextRunSummaries,
        nextApprovals,
        nextDashboard,
        nextRuntime
      ] = await Promise.all([
        api.listCompanies(),
        api.listBlueprints(),
        api.getCatalogSnapshot(),
        api.getOpenClawConfig(),
        api.getOpenClawConfigWizard(),
        api.getOpenClawModelUsage().catch(() => []),
        api.listBlueprintRuns(),
        api.listPendingApprovals(),
        api.getDashboardState(),
        api.getRuntimeOverview().catch(() => emptyRuntimeOverview())
      ]);

      const preferredRunId = options?.runId ?? selectedRunIdRef.current ?? nextRunSummaries[0]?.id;
      const nextRunId = nextRunSummaries.some((item) => item.id === preferredRunId) ? preferredRunId : nextRunSummaries[0]?.id;
      const nextRunView = nextRunId ? await api.getBlueprintRun(nextRunId).catch(() => undefined) : undefined;

      setCompanies(companyDirectory.companies);
      setSelectedCompanyId(companyDirectory.selectedCompanyId);
      setBlueprints(nextBlueprints);
      setCatalog(nextCatalog);
      setOpenClawConfig(nextOpenClawConfig);
      setOpenClawWizard(nextOpenClawWizard);
      setOpenClawModelUsage(nextOpenClawModelUsage);
      setRunSummaries(nextRunSummaries);
      setRunDetailsById((current) => syncRunDetails(current, nextRunSummaries, nextRunView));
      setApprovals(nextApprovals);
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
            theme: "\u989c\u8272",
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
            agentStartTimeout: "\u4ee3\u7406\u542f\u52a8\u8d85\u65f6",
            configPath: "\u914d\u7f6e\u6587\u4ef6",
            workspace: "\u9ed8\u8ba4\u5de5\u4f5c\u533a",
            defaultModel: "\u9ed8\u8ba4\u6a21\u578b",
            models: "\u6a21\u578b",
            agents: "\u4ee3\u7406",
            channels: "\u6e20\u9053",
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
  const openClawVersionStatusLabel = openClawVersionHealthy
    ? language === "zh-CN" ? "OpenClaw \u53ef\u7528" : "OpenClaw available"
    : language === "zh-CN" ? "OpenClaw \u4e0d\u53ef\u7528" : "OpenClaw unavailable";
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
  const themeToggleTitle = theme === "dark" ? systemUi.switchToDay : systemUi.switchToNight;
  const themeToggleLabel = theme === "dark" ? systemUi.day : systemUi.night;
  const companyUi = useMemo(
    () =>
      language === "zh-CN"
        ? {
            placeholder: "\u9009\u62E9\u516C\u53F8",
            menuTitle: "\u5207\u6362\u516C\u53F8",
            noCompanies: "\u5F53\u524D\u6CA1\u6709\u53EF\u9009\u516C\u53F8",
            clear: "\u6E05\u7A7A\u5F53\u524D\u9009\u62E9",
            blueprintCount: (count: number) => `${count} \u4E2A Blueprint`
          }
        : {
            placeholder: "Choose company",
            menuTitle: "Switch company",
            noCompanies: "No companies available",
            clear: "Clear selection",
            blueprintCount: (count: number) => `${count} blueprints`
          },
    [language]
  );

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
  const activeTaskCount = useMemo(
    () => runs.filter((runView) => ["queued", "running", "waiting_approval"].includes(runView.run.status)).length,
    [runs]
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

  const sidebarMeta = useMemo(
    () => ({
      blueprint: blueprints.length,
      runs: activeTaskCount,
      approvals: approvals.length,
      models: openClawConfig?.configuredModels.length ?? 0,
      agents: openClawConfig?.configuredAgents.length ?? 0,
      schedule: runtime?.tasks.length ?? 0,
      channels: openClawConfig?.configuredChannels.length ?? 0
    }),
    [
      approvals.length,
      activeTaskCount,
      openClawConfig?.configuredModels.length,
      openClawConfig?.configuredAgents.length,
      openClawConfig?.configuredChannels.length,
      runtime?.tasks.length,
      runs.length,
      blueprints.length
    ]
  );

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

  const selectCompany = useCallback(
    (companyId?: string) => {
      void withBusy("selectCompany", async () => {
        await api.selectCompany(companyId);
        setCompanyMenuOpen(false);
        await hydrateWorkspace();
      });
    },
    [hydrateWorkspace, withBusy]
  );

  const refreshCatalog = useCallback(
    () =>
      withBusy("refreshCatalog", async () => {
        const [nextCatalog, nextOpenClawConfig, nextOpenClawModelUsage, nextRuntime] = await Promise.all([
          api.refreshCatalog(),
          api.getOpenClawConfig(),
          api.getOpenClawModelUsage().catch(() => []),
          api.getRuntimeOverview().catch(() => emptyRuntimeOverview())
        ]);
        setCatalog(nextCatalog);
        setOpenClawConfig(nextOpenClawConfig);
        setOpenClawModelUsage(nextOpenClawModelUsage);
        setRuntime(nextRuntime);
      }),
    [withBusy]
  );

  const checkOpenClawUpdates = useCallback(
    () =>
      withBusy("checkOpenClawUpdates", async () => {
        const [nextOpenClawVersion, nextCatalog, nextOpenClawConfig, nextOpenClawModelUsage, nextRuntime] = await Promise.all([
          api.getOpenClawVersion(),
          api.refreshCatalog(),
          api.getOpenClawConfig(),
          api.getOpenClawModelUsage().catch(() => []),
          api.getRuntimeOverview().catch(() => emptyRuntimeOverview())
        ]);
        setOpenClawVersion(nextOpenClawVersion);
        setCatalog(nextCatalog);
        setOpenClawConfig(nextOpenClawConfig);
        setOpenClawModelUsage(nextOpenClawModelUsage);
        setRuntime(nextRuntime);
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

  const exportBlueprint = useCallback(() => {
    if (!blueprint) return;
    void withBusy("exportBlueprint", async () => {
      const blueprintPackage = await api.exportBlueprint(blueprint.id);
      downloadBlueprintPackage(blueprintPackage, blueprint.name);
    });
  }, [withBusy, blueprint]);

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
      const runView = await api.startBlueprintRun(saved.id);
      applyRunView(runView);
      await hydrateWorkspace({ blueprintId: saved.id, runId: runView.run.id });
      setSection("runs");
    });
  }, [applyRunView, hydrateWorkspace, withBusy, blueprint]);

  const approveRun = useCallback(
    (blueprintRunId?: string) => {
      const targetRunId = blueprintRunId ?? latestRunForBlueprint?.run.id;
      if (!targetRunId) return;
      void withBusy("approveRun", async () => {
        const updated = await api.approveBlueprintRun(targetRunId);
        applyRunView(updated);
        await hydrateWorkspace({ blueprintId: updated.run.blueprintId, runId: updated.run.id });
      });
    },
    [applyRunView, hydrateWorkspace, latestRunForBlueprint?.run.id, withBusy]
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
    if (!companyMenuOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (companySwitcherRef.current?.contains(event.target as Node)) return;
      setCompanyMenuOpen(false);
    };

    window.addEventListener("mousedown", handlePointerDown);
    return () => window.removeEventListener("mousedown", handlePointerDown);
  }, [companyMenuOpen]);

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
    const activeRun =
      section === "runs"
        ? runs.find((runView) => runView.run.id === selectedRunId)
        : latestRunForBlueprint;

    if (!activeRun || !["queued", "running"].includes(activeRun.run.status)) {
      return;
    }

    const activeRunId = activeRun.run.id;
    const timer = window.setTimeout(() => {
      void api.getBlueprintRun(activeRunId)
        .then(applyRunView)
        .catch(() => undefined);
    }, 2500);

    return () => window.clearTimeout(timer);
  }, [applyRunView, latestRunForBlueprint, runs, section, selectedRunId]);

  const renderSection = () => {
    if (section === "company") {
      return (
        <>
          <CompanyPage
            companies={companies}
            selectedCompanyId={selectedCompanyId}
            language={language}
            onSelectCompany={selectCompany}
          />
          <DashboardPage
            dashboard={dashboard}
            blueprints={blueprints}
            runs={runs}
            approvals={approvals}
            catalog={catalog}
            runtime={runtime}
            language={language}
            t={t}
            onAddWidget={addWidget}
            onRemoveWidget={removeWidget}
          />
        </>
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
          catalog={catalog}
          configuredAgents={openClawConfig?.configuredAgents}
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
          onSaveBlueprint={saveBlueprint}
          onRunBlueprint={runBlueprint}
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
          blueprint={blueprint}
          selectedRunId={selectedRunId}
          language={language}
          t={t}
          onSelectBlueprint={selectBlueprint}
          onSelectRun={setSelectedRunId}
        />
      );
    }
    if (section === "approvals") {
      return <ApprovalsPage approvals={approvals} language={language} t={t} onApprove={approveRun} />;
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
    if (section === "schedule") {
      return <SchedulePage runtime={runtime} runs={runs} approvals={approvals} blueprints={blueprints} language={language} t={t} />;
    }
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
          {appSections.map((item) => {
            const Icon = sidebarIcons[item];
            return (
              <button
                key={item}
                type="button"
                className={`nav-item ${section === item ? "active" : ""}`}
                onClick={() => setSection(item)}
              >
                <span className="nav-item-main">
                  <Icon size={16} />
                  {t.navigation[item] ?? messages.en.navigation[item] ?? item}
                </span>
                <span className="nav-count">{sidebarMeta[item]}</span>
              </button>
            );
          })}
        </nav>
        <div className="sidebar-status">
          {dashboardDirty && <span className="status-badge">{t.common.dirtyWorkspace}</span>}
          <div className="sidebar-system" ref={systemMenuRef}>
            <div className="sidebar-company" ref={companySwitcherRef}>
              <button
                type="button"
                className={`company-switcher sidebar-company-switcher ${section === "company" ? "active" : ""}`}
                title={selectedCompany?.name ?? companyUi.placeholder}
                onClick={() => {
                  setSection("company");
                  setSystemMenuOpen(false);
                  setCompanyMenuOpen((current) => !current);
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
                  <strong>{selectedCompany?.name ?? companyUi.placeholder}</strong>
                </span>
                <ChevronDown size={16} />
              </button>

              {companyMenuOpen && (
                <div className="company-menu sidebar-company-menu">
                  <div className="company-menu-title">{companyUi.menuTitle}</div>
                  {companies.length === 0 ? (
                    <div className="company-menu-empty">{companyUi.noCompanies}</div>
                  ) : (
                    companies.map((company) => (
                      <button
                        key={company.id}
                        type="button"
                        className={`company-menu-item ${company.id === selectedCompanyId ? "active" : ""}`}
                        onClick={() => selectCompany(company.id)}
                      >
                        <span className="company-switcher-avatar small">
                          {company.logoUrl ? <img src={company.logoUrl} alt={company.name} /> : <span>{companyMonogram(company)}</span>}
                        </span>
                        <span className="company-menu-copy">
                          <strong>{company.name}</strong>
                          <span>{companyUi.blueprintCount(company.blueprintCount)}</span>
                        </span>
                      </button>
                    ))
                  )}
                  <button type="button" className="company-menu-clear" onClick={() => selectCompany(undefined)}>
                    {companyUi.clear}
                  </button>
                </div>
              )}
            </div>
            <div className="sidebar-system-control">
              <button
                type="button"
                className={`sidebar-system-version ${openClawVersionHealthy ? "online" : "offline"} ${section === "openclaw" ? "active" : ""}`}
                aria-label={`${openClawPanelUi.openPanel}: ${openClawVersionLabel} ${openClawVersionStatusLabel}`}
                title={`${openClawVersionLabel} ${openClawVersionStatusLabel}`}
                onClick={() => {
                  setCompanyMenuOpen(false);
                  setSystemMenuOpen(false);
                  setSection("openclaw");
                }}
              >
                <span className="sidebar-system-dot" aria-hidden="true" />
                <strong>{openClawVersionLabel}</strong>
              </button>
              <button
                type="button"
                className={`sidebar-system-settings ${systemMenuOpen ? "active" : ""}`}
                title={systemUi.settings}
                aria-label={systemUi.settings}
                aria-expanded={systemMenuOpen}
                onClick={() => {
                  setCompanyMenuOpen(false);
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
  busy: boolean;
  onCheckUpdates: () => void;
}) {
  return (
    <section id="openclaw-control-panel" className="page-grid openclaw-control-page">
      <div className="content-card stack-card openclaw-control-hero">
        <div className="openclaw-page-head">
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

        <div className="openclaw-panel-metrics">
          <OpenClawPanelMetric label={ui.version} value={openClawVersionLabel} />
          <OpenClawPanelMetric label={ui.gateway} value={gatewayStatusLabel} tone={gatewaySettings?.url ? "online" : "offline"} />
          <OpenClawPanelMetric label={ui.config} value={(openClawConfig?.configuredModels.length ?? 0) + (openClawConfig?.configuredAgents.length ?? 0)} />
          <OpenClawPanelMetric label={ui.activity} value={runtime?.tasks.length ?? 0} />
        </div>
      </div>

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

function defaultNewBlueprintName(index: number, language: Language): string {
  return language === "zh-CN" ? `新建 Blueprint ${index}` : `New blueprint ${index}`;
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
  if (action === "approveRun") return t.errors.approve;
  if (action === "configureOpenClawModelAuth") return t.errors.catalog;
  if (action.startsWith("setOpenClawDefaultModel:")) return t.errors.catalog;
  if (action === "addOpenClawAgent") return t.errors.catalog;
  if (action === "configureOpenClawChannel") return t.errors.catalog;
  if (action === "refreshCatalog") return t.errors.catalog;
  return t.errors.load;
}
