import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  CalendarClock,
  Check,
  ChevronDown,
  Database,
  FolderKanban,
  Languages,
  LayoutTemplate,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Radio,
  Save,
  ShieldAlert
} from "lucide-react";
import type {
  CatalogSnapshot,
  CompanyOverview,
  ConfigureOpenClawChannelRequest,
  ConfigureOpenClawModelAuthRequest,
  CreateOpenClawChannelRequest,
  CreateOpenClawModelRequest,
  DashboardWidgetType,
  OpenClawConfigWizardMetadata,
  OpenClawConfigState,
  PendingApprovalItem,
  RuntimeOverview,
  WorkspaceDashboard,
  WorkflowDefinition,
  WorkflowRunView
} from "@openclaw-cui/shared";
import { api } from "./lib/api";
import { appSections, type AppSectionId } from "./lib/app-sections";
import { getInitialLanguage, messages, type Language, type Messages } from "./lib/i18n";
import { WorkflowStudioPage } from "./components/WorkflowStudioPage";
import { AgentsPage, ApprovalsPage, ChannelsPage, CompanyPage, DashboardPage, ModelsPage, RunsPage, SchedulePage } from "./components/WorkspacePages";

const sidebarIcons = {
  workflow: LayoutTemplate,
  runs: FolderKanban,
  approvals: ShieldAlert,
  models: Database,
  agents: Bot,
  schedule: CalendarClock,
  channels: Radio
};

export function App() {
  const [language, setLanguage] = useState<Language>(() => getInitialLanguage());
  const [section, setSection] = useState<AppSectionId>("workflow");
  const [companies, setCompanies] = useState<CompanyOverview[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | undefined>();
  const [workflows, setWorkflows] = useState<WorkflowDefinition[]>([]);
  const [workflow, setWorkflow] = useState<WorkflowDefinition | undefined>();
  const [catalog, setCatalog] = useState<CatalogSnapshot | undefined>();
  const [openClawConfig, setOpenClawConfig] = useState<OpenClawConfigState | undefined>();
  const [openClawWizard, setOpenClawWizard] = useState<OpenClawConfigWizardMetadata | undefined>();
  const [runtime, setRuntime] = useState<RuntimeOverview | undefined>();
  const [runs, setRuns] = useState<WorkflowRunView[]>([]);
  const [approvals, setApprovals] = useState<PendingApprovalItem[]>([]);
  const [dashboard, setDashboard] = useState<WorkspaceDashboard | undefined>();
  const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>();
  const [selectedRunId, setSelectedRunId] = useState<string | undefined>();
  const [busyAction, setBusyAction] = useState<string | undefined>();
  const [dashboardDirty, setDashboardDirty] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [companyMenuOpen, setCompanyMenuOpen] = useState(false);
  const t = messages[language];
  const messageRef = useRef(t);
  const selectedWorkflowIdRef = useRef<string | undefined>(undefined);
  const selectedRunIdRef = useRef<string | undefined>(undefined);
  const companySwitcherRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    messageRef.current = t;
  }, [t]);

  useEffect(() => {
    selectedWorkflowIdRef.current = workflow?.id;
  }, [workflow?.id]);

  useEffect(() => {
    selectedRunIdRef.current = selectedRunId;
  }, [selectedRunId]);

  useEffect(() => {
    localStorage.setItem("openclaw-cui-language", language);
  }, [language]);

  useEffect(() => {
    if (selectedCompanyId) return;
    setSection("company");
  }, [selectedCompanyId]);

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

  const hydrateWorkspace = useCallback(
    async (options?: { workflowId?: string; runId?: string }) => {
      const [
        companyDirectory,
        nextWorkflows,
        nextCatalog,
        nextOpenClawConfig,
        nextOpenClawWizard,
        nextRuns,
        nextApprovals,
        nextDashboard,
        nextRuntime
      ] = await Promise.all([
        api.listCompanies(),
        api.listWorkflows(),
        api.getCatalogSnapshot(),
        api.getOpenClawConfig(),
        api.getOpenClawConfigWizard(),
        api.listWorkflowRuns(),
        api.listPendingApprovals(),
        api.getDashboardState(),
        api.getRuntimeOverview()
      ]);

      setCompanies(companyDirectory.companies);
      setSelectedCompanyId(companyDirectory.selectedCompanyId);
      setWorkflows(nextWorkflows);
      setCatalog(nextCatalog);
      setOpenClawConfig(nextOpenClawConfig);
      setOpenClawWizard(nextOpenClawWizard);
      setRuns(nextRuns);
      setApprovals(nextApprovals);
      setDashboard(nextDashboard);
      setRuntime(nextRuntime);
      setDashboardDirty(false);

      const preferredWorkflowId = options?.workflowId ?? selectedWorkflowIdRef.current ?? nextWorkflows[0]?.id;
      const nextWorkflow = nextWorkflows.find((item) => item.id === preferredWorkflowId) ?? nextWorkflows[0];
      setWorkflow(nextWorkflow);
      setSelectedNodeId(undefined);

      const preferredRunId = options?.runId ?? selectedRunIdRef.current ?? nextRuns[0]?.run.id;
      const nextRunId = nextRuns.some((item) => item.run.id === preferredRunId) ? preferredRunId : nextRuns[0]?.run.id;
      setSelectedRunId(nextRunId);
    },
    []
  );

  const selectedCompany = useMemo(
    () => companies.find((company) => company.id === selectedCompanyId),
    [companies, selectedCompanyId]
  );
  const sectionLabel = t.navigation[section] ?? messages.en.navigation[section] ?? section;
  const pageCopy = t.pages[section] ?? messages.en.pages[section] ?? { title: section, description: "" };
  const companyUi = useMemo(
    () =>
      language === "zh-CN"
        ? {
            placeholder: "\u70B9\u51FB\u9009\u62E9\u516C\u53F8",
            hintSelected: "\u67E5\u770B\u516C\u53F8\u72B6\u6001\u5E76\u5207\u6362",
            hintEmpty: "\u6240\u6709\u5DE5\u4F5C\u533A\u6570\u636E\u90FD\u5F52\u5C5E\u4E8E\u4E00\u4E2A\u516C\u53F8",
            menuTitle: "\u5207\u6362\u516C\u53F8",
            noCompanies: "\u5F53\u524D\u6CA1\u6709\u53EF\u9009\u516C\u53F8",
            clear: "\u6E05\u7A7A\u5F53\u524D\u9009\u62E9",
            workflowCount: (count: number) => `${count} \u4E2A\u5DE5\u4F5C\u6D41`
          }
        : {
            placeholder: "Click to choose company",
            hintSelected: "View company status and switch",
            hintEmpty: "All workspace data is scoped to a company",
            menuTitle: "Switch company",
            noCompanies: "No companies available",
            clear: "Clear selection",
            workflowCount: (count: number) => `${count} workflows`
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

  const latestRunForWorkflow = useMemo(
    () => (workflow ? runs.find((runView) => runView.run.workflowId === workflow.id) : undefined),
    [runs, workflow]
  );

  const selectWorkflow = useCallback(
    (workflowId: string) => {
      const next = workflows.find((item) => item.id === workflowId);
      if (!next) return;
      setWorkflow(next);
      setSelectedNodeId(undefined);
      const latestRunForNextWorkflow = runs.find((runView) => runView.run.workflowId === next.id);
      setSelectedRunId(latestRunForNextWorkflow?.run.id);
    },
    [runs, workflows]
  );

  const sidebarMeta = useMemo(
    () => ({
      workflow: workflows.length,
      runs: runs.length,
      approvals: approvals.length,
      models: catalog?.models.length ?? 0,
      agents: openClawConfig?.configuredAgents.length ?? catalog?.agents.length ?? 0,
      schedule: runtime?.tasks.length ?? 0,
      channels: openClawConfig?.configuredChannels.length ?? catalog?.channels.length ?? 0
    }),
    [
      approvals.length,
      catalog?.agents.length,
      catalog?.channels.length,
      catalog?.models.length,
      openClawConfig?.configuredAgents.length,
      openClawConfig?.configuredChannels.length,
      runtime?.tasks.length,
      runs.length,
      workflows.length
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

  const updateWorkflow = useCallback((updater: (current: WorkflowDefinition) => WorkflowDefinition) => {
    setWorkflow((current) => (current ? updater(current) : current));
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
        const [nextCatalog, nextOpenClawConfig, nextRuntime] = await Promise.all([
          api.refreshCatalog(),
          api.getOpenClawConfig(),
          api.getRuntimeOverview()
        ]);
        setCatalog(nextCatalog);
        setOpenClawConfig(nextOpenClawConfig);
        setRuntime(nextRuntime);
      }),
    [withBusy]
  );

  const saveOpenClawDefaultModel = useCallback(
    (modelId: string) => {
      void withBusy("saveOpenClawDefaultModel", async () => {
        const [nextOpenClawConfig, nextCatalog] = await Promise.all([
          api.updateOpenClawDefaultModel(modelId),
          api.refreshCatalog()
        ]);
        setOpenClawConfig(nextOpenClawConfig);
        setCatalog(nextCatalog);
      });
    },
    [withBusy]
  );

  const addOpenClawAgent = useCallback(
    (input: { name: string; workspace?: string; modelId?: string }) => {
      void withBusy("addOpenClawAgent", async () => {
        const [nextOpenClawConfig, nextCatalog] = await Promise.all([
          api.addOpenClawAgent(input),
          api.refreshCatalog()
        ]);
        setOpenClawConfig(nextOpenClawConfig);
        setCatalog(nextCatalog);
      });
    },
    [withBusy]
  );

  const addOpenClawModel = useCallback(
    (input: CreateOpenClawModelRequest) => {
      void withBusy("addOpenClawModel", async () => {
        const nextOpenClawConfig = await api.addOpenClawModel(input);
        const nextCatalog = await api.refreshCatalog();
        setOpenClawConfig(nextOpenClawConfig);
        setCatalog(nextCatalog);
      });
    },
    [withBusy]
  );

  const configureOpenClawModelAuth = useCallback(
    (input: ConfigureOpenClawModelAuthRequest) => {
      void withBusy("configureOpenClawModelAuth", async () => {
        const nextOpenClawConfig = await api.configureOpenClawModelAuth(input);
        const nextCatalog = await api.refreshCatalog();
        setOpenClawConfig(nextOpenClawConfig);
        setCatalog(nextCatalog);
      });
    },
    [withBusy]
  );

  const addOpenClawChannel = useCallback(
    (input: CreateOpenClawChannelRequest) => {
      void withBusy("addOpenClawChannel", async () => {
        const nextOpenClawConfig = await api.addOpenClawChannel(input);
        const nextCatalog = await api.refreshCatalog();
        setOpenClawConfig(nextOpenClawConfig);
        setCatalog(nextCatalog);
      });
    },
    [withBusy]
  );

  const configureOpenClawChannel = useCallback(
    (input: ConfigureOpenClawChannelRequest) => {
      void withBusy("configureOpenClawChannel", async () => {
        const nextOpenClawConfig = await api.configureOpenClawChannel(input);
        const nextCatalog = await api.refreshCatalog();
        setOpenClawConfig(nextOpenClawConfig);
        setCatalog(nextCatalog);
      });
    },
    [withBusy]
  );

  const saveWorkflow = useCallback(() => {
    if (!workflow) return;
    void withBusy("saveWorkflow", async () => {
      const saved = await api.saveWorkflow(workflow);
      await hydrateWorkspace({ workflowId: saved.id });
    });
  }, [hydrateWorkspace, withBusy, workflow]);

  const createWorkflow = useCallback(() => {
    void withBusy("createWorkflow", async () => {
      const created = await api.createWorkflow({
        name: defaultNewWorkflowName(workflows.length + 1, language)
      });
      await hydrateWorkspace({ workflowId: created.id });
      setSection("workflow");
    });
  }, [hydrateWorkspace, language, withBusy, workflows.length]);

  const runWorkflow = useCallback(() => {
    if (!workflow) return;
    void withBusy("runWorkflow", async () => {
      const saved = await api.saveWorkflow(workflow);
      const runView = await api.startWorkflowRun(saved.id);
      await hydrateWorkspace({ workflowId: saved.id, runId: runView.run.id });
      setSection("runs");
    });
  }, [hydrateWorkspace, withBusy, workflow]);

  const approveRun = useCallback(
    (workflowRunId?: string) => {
      const targetRunId = workflowRunId ?? latestRunForWorkflow?.run.id;
      if (!targetRunId) return;
      void withBusy("approveRun", async () => {
        const updated = await api.approveWorkflowRun(targetRunId);
        await hydrateWorkspace({ workflowId: updated.run.workflowId, runId: updated.run.id });
      });
    },
    [hydrateWorkspace, latestRunForWorkflow?.run.id, withBusy]
  );

  const saveWorkspace = useCallback(() => {
    if (!dashboard) return;
    void withBusy("saveWorkspace", async () => {
      const saved = await api.saveDashboardState(dashboard);
      setDashboard(saved);
      setDashboardDirty(false);
    });
  }, [dashboard, withBusy]);

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
    const activeRun =
      section === "runs"
        ? runs.find((runView) => runView.run.id === selectedRunId)
        : latestRunForWorkflow;

    if (!activeRun || !["queued", "running", "waiting_approval"].includes(activeRun.run.status)) {
      return;
    }

    const timer = window.setTimeout(() => {
      void hydrateWorkspace({
        workflowId: selectedWorkflowIdRef.current,
        runId: section === "runs" ? selectedRunIdRef.current : activeRun.run.id
      }).catch(() => undefined);
    }, 2500);

    return () => window.clearTimeout(timer);
  }, [hydrateWorkspace, latestRunForWorkflow, runs, section, selectedRunId]);

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
            workflows={workflows}
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
    if (section === "workflow") {
      return (
        <WorkflowStudioPage
          workflow={workflow}
          catalog={catalog}
          configuredAgents={openClawConfig?.configuredAgents}
          runView={latestRunForWorkflow}
          selectedNodeId={selectedNodeId}
          language={language}
          busy={Boolean(busyAction)}
          onSelectNode={setSelectedNodeId}
          onUpdateWorkflow={updateWorkflow}
          onApproveRun={() => approveRun()}
          t={t}
        />
      );
    }
    if (section === "runs") {
      return (
        <RunsPage
          runs={runs}
          workflows={workflows}
          workflow={workflow}
          selectedRunId={selectedRunId}
          language={language}
          t={t}
          onSelectWorkflow={selectWorkflow}
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
          onSaveDefaultModel={saveOpenClawDefaultModel}
          onConfigureModelAuth={configureOpenClawModelAuth}
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
      return <SchedulePage runtime={runtime} language={language} t={t} />;
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
          <div className="brand-mark">OC</div>
          <div>
            <h1>openclaw-cui</h1>
            <p>{t.common.brandTagline}</p>
          </div>
        </div>
        <div className="sidebar-company" ref={companySwitcherRef}>
          <button
            type="button"
            className={`company-switcher sidebar-company-switcher ${section === "company" ? "active" : ""}`}
            title={selectedCompany?.name ?? companyUi.placeholder}
            onClick={() => {
              setSection("company");
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
              <span>{selectedCompany ? companyUi.hintSelected : companyUi.hintEmpty}</span>
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
                      <span>{companyUi.workflowCount(company.workflowCount)}</span>
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
        </div>
      </aside>

      <section className="main-shell">
        <header className="topbar">
          <div className="hero-copy">
            <span className="hero-eyebrow">{sectionLabel}</span>
            <h2>{pageCopy.title}</h2>
            <p>{pageCopy.description}</p>
          </div>
          <div className="toolbar">
            {section === "workflow" && (
              <select
                value={workflow?.id ?? ""}
                onChange={(event) => {
                  selectWorkflow(event.target.value);
                }}
              >
                {workflows.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            )}
            {section === "workflow" && (
              <button type="button" title={t.actions.createWorkflow} onClick={createWorkflow} disabled={!selectedCompanyId || Boolean(busyAction)}>
                {busyAction === "createWorkflow" ? <Loader2 className="spin" size={16} /> : <Plus size={16} />}
                {t.actions.createWorkflow}
              </button>
            )}
            <button type="button" title={t.actions.refreshWorkspace} onClick={refreshWorkspace} disabled={Boolean(busyAction)}>
              {busyAction === "refreshWorkspace" || busyAction === "load" ? <Loader2 className="spin" size={16} /> : <RefreshCw size={16} />}
              {t.actions.refreshWorkspace}
            </button>
            {(["models", "agents", "schedule", "channels"] as AppSectionId[]).includes(section) && (
              <button type="button" title={t.actions.refreshCatalog} onClick={refreshCatalog} disabled={Boolean(busyAction)}>
                {busyAction === "refreshCatalog" ? <Loader2 className="spin" size={16} /> : <Database size={16} />}
                {t.actions.refreshCatalog}
              </button>
            )}
            {section === "company" && (
              <button type="button" title={t.actions.saveWorkspace} onClick={saveWorkspace} disabled={!dashboardDirty || !dashboard || Boolean(busyAction)}>
                {busyAction === "saveWorkspace" ? <Loader2 className="spin" size={16} /> : <Save size={16} />}
                {t.actions.saveWorkspace}
              </button>
            )}
            {section === "workflow" && (
              <>
                {latestRunForWorkflow?.run.status === "waiting_approval" && (
                  <button type="button" title={t.actions.approve} onClick={() => approveRun()} disabled={Boolean(busyAction)}>
                    {busyAction === "approveRun" ? <Loader2 className="spin" size={16} /> : <Check size={16} />}
                    {t.actions.approve}
                  </button>
                )}
                <button type="button" title={t.actions.saveWorkflow} onClick={saveWorkflow} disabled={!workflow || Boolean(busyAction)}>
                  {busyAction === "saveWorkflow" ? <Loader2 className="spin" size={16} /> : <Save size={16} />}
                  {t.actions.save}
                </button>
                <button className="primary-action" type="button" title={t.actions.runWorkflow} onClick={runWorkflow} disabled={!workflow || Boolean(busyAction)}>
                  {busyAction === "runWorkflow" ? <Loader2 className="spin" size={16} /> : <Play size={16} />}
                  {t.actions.run}
                </button>
              </>
            )}
            <button type="button" title={t.actions.switchLanguage} aria-label={t.actions.switchLanguage} onClick={toggleLanguage}>
              <Languages size={16} />
              {language === "zh-CN" ? "ZH" : "EN"}
            </button>
          </div>
        </header>

        <section className="page-shell">
          {error && <div className="error-banner">{error}</div>}
          {renderSection()}
        </section>
      </section>
    </main>
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
  return "??";
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

function defaultNewWorkflowName(index: number, language: Language): string {
  return language === "zh-CN" ? `新建工作流 ${index}` : `New workflow ${index}`;
}

function makeClientId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function errorMessageForAction(action: string, t: Messages): string {
  if (action === "createWorkflow") return t.errors.save;
  if (action === "saveWorkflow") return t.errors.save;
  if (action === "runWorkflow") return t.errors.run;
  if (action === "approveRun") return t.errors.approve;
  if (action === "saveWorkspace") return t.errors.workspace;
  if (action === "saveOpenClawDefaultModel") return t.errors.catalog;
  if (action === "addOpenClawModel") return t.errors.catalog;
  if (action === "configureOpenClawModelAuth") return t.errors.catalog;
  if (action === "addOpenClawAgent") return t.errors.catalog;
  if (action === "addOpenClawChannel") return t.errors.catalog;
  if (action === "configureOpenClawChannel") return t.errors.catalog;
  if (action === "refreshCatalog") return t.errors.catalog;
  return t.errors.load;
}
