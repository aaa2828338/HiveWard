import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bookmark, Check, Database, FolderKanban, Languages, LayoutTemplate, Loader2, NotebookText, PanelsTopLeft, Play, RefreshCw, Save, ShieldAlert } from "lucide-react";
import type {
  CatalogSnapshot,
  DashboardWidgetType,
  PendingApprovalItem,
  RuntimeOverview,
  SavedView,
  WorkspaceDashboard,
  WorkspaceNote,
  WorkspaceTag,
  WorkflowDefinition,
  WorkflowRunView
} from "@openclaw-cui/shared";
import { api } from "./lib/api";
import { appSections, type AppSectionId } from "./lib/app-sections";
import { getInitialLanguage, messages, type Language, type Messages } from "./lib/i18n";
import { WorkflowStudioPage } from "./components/WorkflowStudioPage";
import { ApprovalsPage, CatalogPage, DashboardPage, NotesPage, RunsPage, ViewsPage } from "./components/WorkspacePages";

const sidebarIcons = {
  workflow: LayoutTemplate,
  runs: FolderKanban,
  approvals: ShieldAlert,
  dashboard: PanelsTopLeft,
  views: Bookmark,
  notes: NotebookText,
  catalog: Database
};

export function App() {
  const [language, setLanguage] = useState<Language>(() => getInitialLanguage());
  const [section, setSection] = useState<AppSectionId>("workflow");
  const [workflows, setWorkflows] = useState<WorkflowDefinition[]>([]);
  const [workflow, setWorkflow] = useState<WorkflowDefinition | undefined>();
  const [catalog, setCatalog] = useState<CatalogSnapshot | undefined>();
  const [runtime, setRuntime] = useState<RuntimeOverview | undefined>();
  const [runs, setRuns] = useState<WorkflowRunView[]>([]);
  const [approvals, setApprovals] = useState<PendingApprovalItem[]>([]);
  const [dashboard, setDashboard] = useState<WorkspaceDashboard | undefined>();
  const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>();
  const [selectedRunId, setSelectedRunId] = useState<string | undefined>();
  const [busyAction, setBusyAction] = useState<string | undefined>();
  const [dashboardDirty, setDashboardDirty] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const t = messages[language];
  const messageRef = useRef(t);
  const selectedWorkflowIdRef = useRef<string | undefined>(undefined);
  const selectedRunIdRef = useRef<string | undefined>(undefined);

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
      const [nextWorkflows, nextCatalog, nextRuns, nextApprovals, nextDashboard, nextRuntime] = await Promise.all([
        api.listWorkflows(),
        api.getCatalogSnapshot(),
        api.listWorkflowRuns(),
        api.listPendingApprovals(),
        api.getDashboardState(),
        api.getRuntimeOverview()
      ]);

      setWorkflows(nextWorkflows);
      setCatalog(nextCatalog);
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
      dashboard: dashboard?.dashboardWidgets.length ?? 0,
      views: dashboard?.savedViews.length ?? 0,
      notes: dashboard?.notes.length ?? 0,
      catalog: catalog?.models.length ?? 0
    }),
    [approvals.length, catalog?.models.length, dashboard?.dashboardWidgets.length, dashboard?.notes.length, dashboard?.savedViews.length, runs.length, workflows.length]
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

  const refreshCatalog = useCallback(
    () =>
      withBusy("refreshCatalog", async () => {
        const [nextCatalog, nextRuntime] = await Promise.all([api.refreshCatalog(), api.getRuntimeOverview()]);
        setCatalog(nextCatalog);
        setRuntime(nextRuntime);
      }),
    [withBusy]
  );

  const saveWorkflow = useCallback(() => {
    if (!workflow) return;
    void withBusy("saveWorkflow", async () => {
      const saved = await api.saveWorkflow(workflow);
      await hydrateWorkspace({ workflowId: saved.id });
    });
  }, [hydrateWorkspace, withBusy, workflow]);

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

  const addSavedView = useCallback(
    (view: Omit<SavedView, "id" | "createdAt" | "updatedAt">) => {
      const now = new Date().toISOString();
      mutateDashboard((current) => ({
        ...current,
        savedViews: [
          ...current.savedViews,
          {
            id: makeClientId("view"),
            createdAt: now,
            updatedAt: now,
            ...view
          }
        ],
        updatedAt: now
      }));
    },
    [mutateDashboard]
  );

  const removeSavedView = useCallback(
    (viewId: string) => {
      mutateDashboard((current) => ({
        ...current,
        savedViews: current.savedViews.filter((view) => view.id !== viewId),
        updatedAt: new Date().toISOString()
      }));
    },
    [mutateDashboard]
  );

  const addTag = useCallback(
    (tag: Omit<WorkspaceTag, "id" | "createdAt" | "updatedAt">) => {
      const now = new Date().toISOString();
      mutateDashboard((current) => ({
        ...current,
        tags: [
          ...current.tags,
          {
            id: makeClientId("tag"),
            createdAt: now,
            updatedAt: now,
            ...tag
          }
        ],
        updatedAt: now
      }));
    },
    [mutateDashboard]
  );

  const removeTag = useCallback(
    (tagId: string) => {
      const now = new Date().toISOString();
      mutateDashboard((current) => ({
        ...current,
        tags: current.tags.filter((tag) => tag.id !== tagId),
        notes: current.notes.map((note) => ({
          ...note,
          tagIds: note.tagIds.filter((item) => item !== tagId),
          updatedAt: now
        })),
        updatedAt: now
      }));
    },
    [mutateDashboard]
  );

  const addNote = useCallback(
    (note: Omit<WorkspaceNote, "id" | "createdAt" | "updatedAt">) => {
      const now = new Date().toISOString();
      mutateDashboard((current) => ({
        ...current,
        notes: [
          ...current.notes,
          {
            id: makeClientId("note"),
            createdAt: now,
            updatedAt: now,
            ...note
          }
        ],
        updatedAt: now
      }));
    },
    [mutateDashboard]
  );

  const removeNote = useCallback(
    (noteId: string) => {
      mutateDashboard((current) => ({
        ...current,
        notes: current.notes.filter((note) => note.id !== noteId),
        updatedAt: new Date().toISOString()
      }));
    },
    [mutateDashboard]
  );

  const toggleLanguage = useCallback(() => {
    setLanguage((current) => (current === "zh-CN" ? "en" : "zh-CN"));
  }, []);

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
    if (section === "workflow") {
      return (
        <WorkflowStudioPage
          workflow={workflow}
          catalog={catalog}
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
    if (section === "dashboard") {
      return (
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
      );
    }
    if (section === "views") {
      return (
        <ViewsPage
          dashboard={dashboard}
          workflows={workflows}
          language={language}
          t={t}
          onAddView={addSavedView}
          onRemoveView={removeSavedView}
        />
      );
    }
    if (section === "notes") {
      return (
        <NotesPage
          dashboard={dashboard}
          workflows={workflows}
          runs={runs}
          language={language}
          t={t}
          onAddTag={addTag}
          onRemoveTag={removeTag}
          onAddNote={addNote}
          onRemoveNote={removeNote}
        />
      );
    }
    return <CatalogPage catalog={catalog} runtime={runtime} language={language} t={t} />;
  };

  return (
    <main className="app-shell">
      <aside className="sidebar-shell">
        <div className="sidebar-brand">
          <div className="brand-mark">OC</div>
          <div>
            <h1>openclaw-cui</h1>
            <p>CUI-owned orchestration surface</p>
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
                  {t.navigation[item]}
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
            <span className="hero-eyebrow">{t.navigation[section]}</span>
            <h2>{t.pages[section].title}</h2>
            <p>{t.pages[section].description}</p>
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
            <button type="button" title={t.actions.refreshWorkspace} onClick={refreshWorkspace} disabled={Boolean(busyAction)}>
              {busyAction === "refreshWorkspace" || busyAction === "load" ? <Loader2 className="spin" size={16} /> : <RefreshCw size={16} />}
              {t.actions.refreshWorkspace}
            </button>
            {section === "catalog" && (
              <button type="button" title={t.actions.refreshCatalog} onClick={refreshCatalog} disabled={Boolean(busyAction)}>
                {busyAction === "refreshCatalog" ? <Loader2 className="spin" size={16} /> : <Database size={16} />}
                {t.actions.catalog}
              </button>
            )}
            {(section === "dashboard" || section === "views" || section === "notes") && (
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
              {language === "zh-CN" ? "中文" : "EN"}
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

function makeClientId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function errorMessageForAction(action: string, t: Messages): string {
  if (action === "saveWorkflow") return t.errors.save;
  if (action === "runWorkflow") return t.errors.run;
  if (action === "approveRun") return t.errors.approve;
  if (action === "saveWorkspace") return t.errors.workspace;
  if (action === "refreshCatalog") return t.errors.catalog;
  return t.errors.load;
}
