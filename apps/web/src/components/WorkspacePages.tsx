import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Activity,
  ArrowLeft,
  BadgeCheck,
  BookOpenText,
  Bookmark,
  ChevronRight,
  Clock3,
  Database,
  FolderKanban,
  KeyRound,
  Loader2,
  MessageSquareText,
  PanelsTopLeft,
  Search,
  Tag,
  Trash2
} from "lucide-react";
import type {
  CatalogSnapshot,
  ConfigureOpenClawChannelRequest,
  ConfigureOpenClawModelAuthRequest,
  OpenClawChannelSetupOption,
  OpenClawConfigWizardMetadata,
  OpenClawConfigState,
  OpenClawWizardField,
  OpenClawWizardValue,
  CompanyOverview,
  DashboardWidget,
  DashboardWidgetType,
  PendingApprovalItem,
  RuntimeOverview,
  SavedView,
  WorkspaceDashboard,
  WorkspaceNote,
  WorkspaceTag,
  WorkflowDefinition,
  WorkflowNode,
  WorkflowNodeEvent,
  WorkflowNodeRun,
  WorkflowNodeRunStatus,
  WorkflowRunStatus,
  WorkflowRunView
} from "@openclaw-cui/shared";
import { isCatalogStale } from "@openclaw-cui/shared";
import type { Language, Messages } from "../lib/i18n";
import { appSections, type AppSectionId } from "../lib/app-sections";

const runStatuses: WorkflowRunStatus[] = ["queued", "running", "succeeded", "failed", "cancelled", "waiting_approval"];

type TraceIssue = {
  key: string;
  index: number;
  label: string;
  kind: "node" | "slot_input" | "slot_output";
  depth: number;
  node?: WorkflowNode;
  nodeRun?: WorkflowNodeRun;
  issueStatus: "completed" | "in_progress" | "pending";
  outputPreview: string;
  outputBody?: string;
  events: WorkflowNodeEvent[];
};

export function CompanyPage({
  companies,
  selectedCompanyId,
  language,
  onSelectCompany
}: {
  companies: CompanyOverview[];
  selectedCompanyId?: string;
  language: Language;
  onSelectCompany: (companyId?: string) => void;
}) {
  const copy =
    language === "zh-CN"
      ? {
          choose: "\u9009\u62E9\u516C\u53F8",
          noSelection: "\u5F53\u524D\u8FD8\u6CA1\u6709\u9009\u4E2D\u516C\u53F8\u3002\u8BF7\u4ECE\u4E0B\u65B9\u5217\u8868\u4E2D\u5207\u6362\u3002",
          noCompanies: "\u5F53\u524D\u6CA1\u6709\u53EF\u7528\u516C\u53F8\u3002",
          goal: "\u4E1A\u52A1\u76EE\u6807",
          workflows: "\u5DE5\u4F5C\u6D41",
          runs: "\u8FD0\u884C\u6B21\u6570",
          tokens: "Token \u6D88\u8017",
          approvals: "\u5F85\u5BA1\u6279",
          widgets: "\u603B\u89C8\u5361\u7247",
          cost: "\u6210\u672C",
          latest: "\u6700\u8FD1\u8FD0\u884C",
          active: "\u5F53\u524D\u516C\u53F8",
          switchTitle: "\u516C\u53F8\u5217\u8868",
          switchSubtitle: "\u5728\u8FD9\u91CC\u5207\u6362\u540E\uff0c\u5176\u4ED6\u5DE5\u4F5C\u533A\u90FD\u4F1A\u5207\u5230\u8BE5\u516C\u53F8\u7684\u6570\u636E\u8303\u56F4\u3002",
          clear: "\u6E05\u7A7A\u5F53\u524D\u9009\u62E9",
          select: "\u5207\u6362\u5230\u8BE5\u516C\u53F8"
        }
      : {
          choose: "Choose company",
          noSelection: "No company is selected yet. Choose one from the list below.",
          noCompanies: "No companies are available.",
          goal: "Business goal",
          workflows: "Workflows",
          runs: "Runs",
          tokens: "Tokens",
          approvals: "Pending approvals",
          widgets: "Overview widgets",
          cost: "Cost",
          latest: "Latest run",
          active: "Current company",
          switchTitle: "Companies",
          switchSubtitle: "Switching here updates the scope for the rest of the workspace.",
          clear: "Clear selection",
          select: "Switch to company"
        };

  const selectedCompany = companies.find((company) => company.id === selectedCompanyId);

  return (
    <section className="page-grid company-page-grid">
      <div className="content-card stack-card company-hero-card">
        {selectedCompany ? (
          <div className="company-hero-layout">
            <div className="company-hero-main">
              <div className="company-brand-block">
                <div className="company-logo-large">
                  {selectedCompany.logoUrl ? <img src={selectedCompany.logoUrl} alt={selectedCompany.name} /> : companyMonogram(selectedCompany)}
                </div>
                <div className="company-brand-copy">
                  <span className="hero-eyebrow">{copy.active}</span>
                  <h3>{selectedCompany.name}</h3>
                  <p>{selectedCompany.businessGoal}</p>
                </div>
              </div>

              <div className="company-detail-grid">
                <CompanyDetailCard label={copy.goal} value={selectedCompany.businessGoal} />
                <CompanyDetailCard label={copy.cost} value={`$${selectedCompany.totalCostUsd.toFixed(4)}`} />
                <CompanyDetailCard label={copy.latest} value={selectedCompany.latestRunAt ? formatDateTime(selectedCompany.latestRunAt, language) : "-"} />
                <CompanyDetailCard label={copy.widgets} value={selectedCompany.dashboardWidgetCount} />
              </div>
            </div>

            <div className="company-stat-grid">
              <CompanyStatCard label={copy.workflows} value={selectedCompany.workflowCount.toLocaleString(language)} />
              <CompanyStatCard label={copy.runs} value={selectedCompany.runCount.toLocaleString(language)} />
              <CompanyStatCard label={copy.tokens} value={selectedCompany.totalTokens.toLocaleString(language)} />
              <CompanyStatCard label={copy.approvals} value={selectedCompany.activeApprovalCount.toLocaleString(language)} />
            </div>
          </div>
        ) : (
          <div className="empty-state company-empty-state">
            <strong>{copy.choose}</strong>
            <span>{companies.length === 0 ? copy.noCompanies : copy.noSelection}</span>
          </div>
        )}
      </div>

      <div className="content-card stack-card">
        <div className="card-toolbar">
          <div className="card-title-block">
            <h3>{copy.switchTitle}</h3>
            <p>{copy.switchSubtitle}</p>
          </div>
        </div>

        {companies.length === 0 ? (
          <div className="empty-state page-empty">{copy.noCompanies}</div>
        ) : (
          <div className="company-list-grid">
            {companies.map((company) => (
              <button
                key={company.id}
                type="button"
                className={`company-list-card ${company.id === selectedCompanyId ? "selected" : ""}`}
                onClick={() => onSelectCompany(company.id)}
              >
                <div className="company-list-card-top">
                  <div className="company-logo-small">
                    {company.logoUrl ? <img src={company.logoUrl} alt={company.name} /> : companyMonogram(company)}
                  </div>
                  <div className="company-list-card-copy">
                    <strong>{company.name}</strong>
                    <span>{company.businessGoal}</span>
                  </div>
                </div>
                <div className="company-list-card-metrics">
                  <span>{`${copy.workflows}: ${company.workflowCount}`}</span>
                  <span>{`${copy.tokens}: ${company.totalTokens}`}</span>
                  <span>{`${copy.approvals}: ${company.activeApprovalCount}`}</span>
                </div>
                <span className="company-list-card-action">{company.id === selectedCompanyId ? copy.active : copy.select}</span>
              </button>
            ))}
          </div>
        )}

        <div className="card-actions">
          <button type="button" onClick={() => onSelectCompany(undefined)}>
            {copy.clear}
          </button>
        </div>
      </div>
    </section>
  );
}

export function RunsPage({
  runs,
  workflows,
  workflow,
  selectedRunId,
  language,
  t,
  onSelectWorkflow,
  onSelectRun
}: {
  runs: WorkflowRunView[];
  workflows: WorkflowDefinition[];
  workflow?: WorkflowDefinition;
  selectedRunId?: string;
  language: Language;
  t: Messages;
  onSelectWorkflow: (workflowId: string) => void;
  onSelectRun: (runId: string) => void;
}) {
  const workflowRuns = useMemo(
    () => (workflow ? runs.filter((runView) => runView.run.workflowId === workflow.id) : []),
    [runs, workflow]
  );
  const activeRun = workflowRuns.find((runView) => runView.run.id === selectedRunId) ?? workflowRuns[0];
  const [activeIssueKey, setActiveIssueKey] = useState<string | undefined>();
  const orderedNodes = useMemo(() => getWorkflowNodeOrder(workflow), [workflow]);

  const issues = useMemo<TraceIssue[]>(() => {
    return buildTraceIssues(activeRun, workflow, orderedNodes, t);
  }, [activeRun?.events, activeRun?.nodeRuns, orderedNodes, t, workflow?.nodes]);

  const activeIssue =
    issues.find((issue) => issue.key === activeIssueKey) ??
    selectPreferredTraceIssue(issues) ??
    issues[0];

  useEffect(() => {
    if (!activeIssueKey || issues.some((issue) => issue.key === activeIssueKey)) return;
    setActiveIssueKey(undefined);
  }, [activeIssueKey, issues]);

  return (
    <section className="page-grid trace-page-grid">
      <div className="content-card stack-card trace-page-header">
        <div className="card-toolbar">
          <div className="card-title-block">
            <h3>{t.trace.title}</h3>
            <p>{t.trace.description}</p>
          </div>
          <div className="toolbar-cluster trace-toolbar">
            <select value={workflow?.id ?? ""} onChange={(event) => onSelectWorkflow(event.target.value)}>
              {workflows.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <select value={activeRun?.run.id ?? ""} onChange={(event) => onSelectRun(event.target.value)} disabled={workflowRuns.length === 0}>
              {workflowRuns.length === 0 ? (
                <option value="">{t.empty.selectRun}</option>
              ) : (
                workflowRuns.map((runView) => (
                  <option key={runView.run.id} value={runView.run.id}>
                    {t.trace.runOption(runView.run.id, formatDateTime(runView.run.startedAt, language))}
                  </option>
                ))
              )}
            </select>
          </div>
        </div>
      </div>

      <section className="trace-layout">
        <div className="content-card stack-card trace-issue-column">
          <div className="trace-column-header">
            <h3>{t.trace.issueList}</h3>
            {activeRun && <span className={`status-pill status-${activeRun.run.status}`}>{t.status[activeRun.run.status]}</span>}
          </div>
          <div className="trace-issue-list">
            {!workflow ? (
              <div className="empty-state page-empty">{t.empty.selectWorkflow}</div>
            ) : issues.length === 0 ? (
              <div className="empty-state page-empty">{t.empty.noRunHistory}</div>
            ) : (
              issues.map((issue) => (
                <button
                  key={issue.key}
                  type="button"
                  className={`trace-issue-card trace-issue-${issue.kind} trace-issue-depth-${issue.depth} ${activeIssue?.key === issue.key ? "selected" : ""}`}
                  onClick={() => setActiveIssueKey(issue.key)}
                >
                  <div className="trace-issue-index">{issue.index}</div>
                  <div className="trace-issue-main">
                    <div className="trace-issue-topline">
                      <strong>{issue.label}</strong>
                      <span className={`trace-status-chip trace-${issue.issueStatus}`}>{labelForIssueStatus(issue.issueStatus, t)}</span>
                    </div>
                    <span>{issue.outputPreview}</span>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="content-card stack-card trace-output-column">
          {activeIssue ? (
            <>
              <div className="trace-column-header">
                <div>
                  <h3>{t.trace.modelOutput}</h3>
                  <p>{t.trace.currentIssue(activeIssue.label)}</p>
                </div>
              </div>
              <div className="trace-output-stream">
                <TraceBubble role="system" title={t.trace.flowStarted} body={activeRun ? formatDateTime(activeRun.run.startedAt, language) : "-"} />
                {activeIssue.nodeRun?.startedAt && (
                  <TraceBubble role="system" title={t.status[activeIssue.nodeRun.status]} body={formatDateTime(activeIssue.nodeRun.startedAt, language)} />
                )}
                {activeIssue.events.map((event) => (
                  <TraceBubble key={event.id} role="system" title={t.events[event.type]} body={event.message} />
                ))}
                {activeIssue.outputBody !== undefined ? (
                  <TraceBubble
                    role={activeIssue.kind === "slot_input" ? "system" : "assistant"}
                    title={activeIssue.label}
                    body={activeIssue.outputBody}
                  />
                ) : activeIssue.nodeRun?.output !== undefined ? (
                  <TraceBubble role="assistant" title={activeIssue.label} body={formatOutput(activeIssue.nodeRun.output)} />
                ) : activeIssue.nodeRun?.error ? (
                  <TraceBubble role="error" title={t.status.failed} body={activeIssue.nodeRun.error} />
                ) : (
                  <div className="empty-state compact-empty-state">{t.empty.noNodeOutput}</div>
                )}
                {activeRun?.run.endedAt && <TraceBubble role="system" title={t.trace.flowFinished} body={formatDateTime(activeRun.run.endedAt, language)} />}
              </div>
            </>
          ) : (
            <div className="empty-state page-empty">{t.empty.noRunHistory}</div>
          )}
        </div>
      </section>
    </section>
  );
}

export function ApprovalsPage({
  approvals,
  language,
  t,
  onApprove
}: {
  approvals: PendingApprovalItem[];
  language: Language;
  t: Messages;
  onApprove: (workflowRunId: string) => void;
}) {
  const approvalsPage = t.pages.approvals ?? { title: "Approvals", description: "" };

  return (
    <section className="page-grid">
      <div className="content-card stack-card">
        <div className="card-toolbar">
          <div className="card-title-block">
            <h3>{approvalsPage.title}</h3>
            <p>{t.metrics.approvals(approvals.length)}</p>
          </div>
        </div>
        <div className="card-grid approval-grid">
          {approvals.length === 0 ? (
            <div className="empty-state page-empty">{t.empty.noApprovals}</div>
          ) : (
            approvals.map((approval) => (
              <article key={approval.nodeRunId} className="feature-card approval-card">
                <div className="feature-card-header">
                  <div>
                    <strong>{approval.nodeLabel}</strong>
                    <p>{approval.workflowName}</p>
                  </div>
                  <span className="status-pill status-waiting_approval">{t.status.waiting_approval}</span>
                </div>
                <dl className="meta-grid">
                  <dt>{t.fields.relatedWorkflow}</dt>
                  <dd>{approval.workflowName}</dd>
                  <dt>{t.fields.relatedRun}</dt>
                  <dd>{approval.workflowRunId}</dd>
                  <dt>{t.fields.updatedAt}</dt>
                  <dd>{formatDateTime(approval.requestedAt, language)}</dd>
                </dl>
                {approval.approverHint && <p className="supporting-copy">{approval.approverHint}</p>}
                {approval.instructions && <pre className="inline-note">{approval.instructions}</pre>}
                <div className="card-actions">
                  <button type="button" className="primary-action" onClick={() => onApprove(approval.workflowRunId)}>
                    <BadgeCheck size={16} />
                    {t.actions.approve}
                  </button>
                </div>
              </article>
            ))
          )}
        </div>
      </div>
    </section>
  );
}

export function DashboardPage({
  dashboard,
  workflows,
  runs,
  approvals,
  catalog,
  runtime,
  language,
  t,
  onAddWidget,
  onRemoveWidget
}: {
  dashboard?: WorkspaceDashboard;
  workflows: WorkflowDefinition[];
  runs: WorkflowRunView[];
  approvals: PendingApprovalItem[];
  catalog?: CatalogSnapshot;
  runtime?: RuntimeOverview;
  language: Language;
  t: Messages;
  onAddWidget: (type: DashboardWidgetType) => void;
  onRemoveWidget: (widgetId: string) => void;
}) {
  const widgets = (dashboard?.dashboardWidgets ?? []).filter((widget) => widget.type !== "notes");
  const summary = [
    { icon: FolderKanban, label: t.metrics.workflows(workflows.length) },
    { icon: Activity, label: t.metrics.runs(runs.length) },
    { icon: Clock3, label: t.metrics.approvals(approvals.length) },
    { icon: Database, label: t.metrics.models(catalog?.models.length ?? 0) }
  ];

  return (
    <section className="page-grid">
      <div className="content-card stack-card">
        <div className="metric-strip">
          {summary.map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.label} className="metric-chip">
                <Icon size={16} />
                <span>{item.label}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="content-card stack-card">
        <div className="card-toolbar">
          <div className="card-title-block">
            <h3>{t.tables.widgets}</h3>
            <p>{t.metrics.widgets(widgets.length)}</p>
          </div>
          <div className="toolbar-cluster wrap">
            {(["recent_runs", "pending_approvals", "runtime_overview", "catalog_status"] as DashboardWidgetType[]).map((type) => (
              <button key={type} type="button" onClick={() => onAddWidget(type)}>
                <PanelsTopLeft size={16} />
                {widgetTypeLabel(type, t)}
              </button>
            ))}
          </div>
        </div>
        <div className="card-grid widget-grid">
          {widgets.length === 0 ? (
            <div className="empty-state page-empty">{t.empty.noWidgets}</div>
          ) : (
            widgets.map((widget) => (
              <WidgetCard
                key={widget.id}
                widget={widget}
                dashboard={dashboard}
                runs={runs}
                approvals={approvals}
                catalog={catalog}
                runtime={runtime}
                language={language}
                t={t}
                onRemove={() => onRemoveWidget(widget.id)}
              />
            ))
          )}
        </div>
      </div>
    </section>
  );
}

export function ViewsPage({
  dashboard,
  workflows,
  language,
  t,
  onAddView,
  onRemoveView
}: {
  dashboard?: WorkspaceDashboard;
  workflows: WorkflowDefinition[];
  language: Language;
  t: Messages;
  onAddView: (view: Omit<SavedView, "id" | "createdAt" | "updatedAt">) => void;
  onRemoveView: (viewId: string) => void;
}) {
  const [name, setName] = useState(t.defaults.savedViewName);
  const [section, setSection] = useState<AppSectionId>("runs");
  const [workflowId, setWorkflowId] = useState("");
  const [status, setStatus] = useState("");

  return (
    <section className="page-grid">
      <div className="content-card stack-card">
        <div className="card-toolbar">
          <div className="card-title-block">
            <h3>{t.tables.savedViews}</h3>
            <p>{t.metrics.savedViews(dashboard?.savedViews.length ?? 0)}</p>
          </div>
        </div>
        <div className="form-grid form-grid-wide">
          <label>
            <span>{t.fields.title}</span>
            <input value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label>
            <span>{t.fields.section}</span>
            <select value={section} onChange={(event) => setSection(event.target.value as AppSectionId)}>
              {appSections.map((item) => (
                <option key={item} value={item}>
                  {t.navigation[item] ?? item}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>{t.fields.workflow}</span>
            <select value={workflowId} onChange={(event) => setWorkflowId(event.target.value)}>
              <option value="">{t.common.allWorkflows}</option>
              {workflows.map((workflow) => (
                <option key={workflow.id} value={workflow.id}>
                  {workflow.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>{t.fields.status}</span>
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">{t.common.allStatuses}</option>
              {runStatuses.map((item) => (
                <option key={item} value={item}>
                  {t.status[item]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="card-actions">
          <button
            type="button"
            className="primary-action"
            onClick={() => {
              if (!name.trim()) return;
              onAddView({
                name: name.trim(),
                workflowId: workflowId || undefined,
                filters: {
                  section,
                  ...(status ? { status } : {})
                }
              });
              setName(t.defaults.savedViewName);
              setWorkflowId("");
              setStatus("");
              setSection("runs");
            }}
          >
            <Bookmark size={16} />
            {t.actions.addSavedView}
          </button>
        </div>
        <div className="card-grid">
          {(dashboard?.savedViews ?? []).length === 0 ? (
            <div className="empty-state page-empty">{t.empty.noSavedViews}</div>
          ) : (
            (dashboard?.savedViews ?? []).map((view) => (
              <article key={view.id} className="feature-card">
                <div className="feature-card-header">
                  <div>
                    <strong>{view.name}</strong>
                    <p>{formatDateTime(view.updatedAt, language)}</p>
                  </div>
                  <button type="button" className="icon-button" onClick={() => onRemoveView(view.id)}>
                    <Trash2 size={16} />
                  </button>
                </div>
                <div className="widget-list">
                  {Object.entries(view.filters).map(([key, value]) => (
                    <div key={key} className="mini-row">
                      <span>{key === "section" ? t.fields.section : key}</span>
                      <code>{key === "section" ? t.navigation[value as AppSectionId] ?? value : value}</code>
                    </div>
                  ))}
                  <div className="mini-row">
                    <span>{t.fields.workflow}</span>
                    <code>{view.workflowId ? workflowNameFor(workflows, view.workflowId) : t.common.allWorkflows}</code>
                  </div>
                </div>
              </article>
            ))
          )}
        </div>
      </div>
    </section>
  );
}

export function NotesPage({
  dashboard,
  workflows,
  runs,
  language,
  t,
  onAddTag,
  onRemoveTag,
  onAddNote,
  onRemoveNote
}: {
  dashboard?: WorkspaceDashboard;
  workflows: WorkflowDefinition[];
  runs: WorkflowRunView[];
  language: Language;
  t: Messages;
  onAddTag: (tag: Omit<WorkspaceTag, "id" | "createdAt" | "updatedAt">) => void;
  onRemoveTag: (tagId: string) => void;
  onAddNote: (note: Omit<WorkspaceNote, "id" | "createdAt" | "updatedAt">) => void;
  onRemoveNote: (noteId: string) => void;
}) {
  const [tagLabel, setTagLabel] = useState(t.defaults.tagLabel);
  const [tagColor, setTagColor] = useState(t.defaults.tagColor);
  const [title, setTitle] = useState(t.defaults.noteLabel);
  const [body, setBody] = useState(t.defaults.noteBody);
  const [relatedWorkflowId, setRelatedWorkflowId] = useState("");
  const [relatedRunId, setRelatedRunId] = useState("");
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);

  const tags = dashboard?.tags ?? [];
  const notes = dashboard?.notes ?? [];

  return (
    <section className="page-grid">
      <div className="content-card stack-card">
        <div className="card-toolbar">
          <div className="card-title-block">
            <h3>{t.tables.tags}</h3>
            <p>{t.metrics.tags(tags.length)}</p>
          </div>
        </div>
        <div className="form-grid form-grid-wide">
          <label>
            <span>{t.fields.tagLabel}</span>
            <input value={tagLabel} onChange={(event) => setTagLabel(event.target.value)} />
          </label>
          <label>
            <span>{t.fields.tagColor}</span>
            <input value={tagColor} onChange={(event) => setTagColor(event.target.value)} />
          </label>
        </div>
        <div className="card-actions">
          <button
            type="button"
            onClick={() => {
              if (!tagLabel.trim()) return;
              onAddTag({ label: tagLabel.trim(), color: tagColor.trim() || undefined });
              setTagLabel(t.defaults.tagLabel);
              setTagColor(t.defaults.tagColor);
            }}
          >
            <Tag size={16} />
            {t.actions.addTag}
          </button>
        </div>
        <div className="tag-row spacious">
          {tags.length === 0 ? (
            <div className="empty-state page-empty">{t.empty.noTags}</div>
          ) : (
            tags.map((tag) => (
              <span key={tag.id} className="tag-pill" style={{ ["--tag-accent" as string]: tag.color ?? "#0f766e" }}>
                {tag.label}
                <button type="button" className="pill-action" onClick={() => onRemoveTag(tag.id)}>
                  <Trash2 size={12} />
                </button>
              </span>
            ))
          )}
        </div>
      </div>

      <div className="content-card stack-card">
        <div className="card-toolbar">
          <div className="card-title-block">
            <h3>{t.tables.notes}</h3>
            <p>{t.metrics.notes(notes.length)}</p>
          </div>
        </div>
        <div className="form-grid">
          <label>
            <span>{t.fields.title}</span>
            <input value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <label>
            <span>{t.fields.relatedWorkflow}</span>
            <select
              value={relatedWorkflowId}
              onChange={(event) => {
                setRelatedWorkflowId(event.target.value);
                setRelatedRunId("");
              }}
            >
              <option value="">{t.common.notLinked}</option>
              {workflows.map((workflow) => (
                <option key={workflow.id} value={workflow.id}>
                  {workflow.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>{t.fields.relatedRun}</span>
            <select value={relatedRunId} onChange={(event) => setRelatedRunId(event.target.value)}>
              <option value="">{t.common.notLinked}</option>
              {runs
                .filter((runView) => !relatedWorkflowId || runView.run.workflowId === relatedWorkflowId)
                .map((runView) => (
                  <option key={runView.run.id} value={runView.run.id}>
                    {runView.run.id}
                  </option>
                ))}
            </select>
          </label>
          <label className="field-span-full">
            <span>{t.fields.body}</span>
            <textarea rows={5} value={body} onChange={(event) => setBody(event.target.value)} />
          </label>
        </div>
        <div className="tag-row spacious">
          {tags.map((tag) => {
            const active = selectedTagIds.includes(tag.id);
            return (
              <button
                key={tag.id}
                type="button"
                className={`tag-pill toggle-pill ${active ? "active" : ""}`}
                style={{ ["--tag-accent" as string]: tag.color ?? "#0f766e" }}
                onClick={() =>
                  setSelectedTagIds((current) =>
                    current.includes(tag.id) ? current.filter((item) => item !== tag.id) : [...current, tag.id]
                  )
                }
              >
                {tag.label}
              </button>
            );
          })}
        </div>
        <div className="card-actions">
          <button
            type="button"
            className="primary-action"
            onClick={() => {
              if (!title.trim() || !body.trim()) return;
              onAddNote({
                title: title.trim(),
                body: body.trim(),
                relatedWorkflowId: relatedWorkflowId || undefined,
                relatedRunId: relatedRunId || undefined,
                tagIds: selectedTagIds
              });
              setTitle(t.defaults.noteLabel);
              setBody(t.defaults.noteBody);
              setRelatedWorkflowId("");
              setRelatedRunId("");
              setSelectedTagIds([]);
            }}
          >
            <MessageSquareText size={16} />
            {t.actions.addNote}
          </button>
        </div>
        <div className="card-grid note-grid">
          {notes.length === 0 ? (
            <div className="empty-state page-empty">{t.empty.noNotes}</div>
          ) : (
            notes.map((note) => (
              <article key={note.id} className="feature-card">
                <div className="feature-card-header">
                  <div>
                    <strong>{note.title}</strong>
                    <p>{formatDateTime(note.updatedAt, language)}</p>
                  </div>
                  <button type="button" className="icon-button" onClick={() => onRemoveNote(note.id)}>
                    <Trash2 size={16} />
                  </button>
                </div>
                <p className="supporting-copy">{note.body}</p>
                <div className="tag-row">
                  {note.tagIds.map((tagId) => {
                    const match = tags.find((item) => item.id === tagId);
                    return match ? (
                      <span key={tagId} className="tag-pill" style={{ ["--tag-accent" as string]: match.color ?? "#0f766e" }}>
                        {match.label}
                      </span>
                    ) : null;
                  })}
                </div>
                {(note.relatedWorkflowId || note.relatedRunId) && (
                  <dl className="meta-grid">
                    {note.relatedWorkflowId && (
                      <>
                        <dt>{t.fields.relatedWorkflow}</dt>
                        <dd>{workflowNameFor(workflows, note.relatedWorkflowId)}</dd>
                      </>
                    )}
                    {note.relatedRunId && (
                      <>
                        <dt>{t.fields.relatedRun}</dt>
                        <dd>{note.relatedRunId}</dd>
                      </>
                    )}
                  </dl>
                )}
              </article>
            ))
          )}
        </div>
      </div>
    </section>
  );
}

export function ModelsPage({
  catalog,
  openClawConfig,
  wizard,
  language,
  t,
  busy,
  onSaveDefaultModel,
  onConfigureModelAuth
}: {
  catalog?: CatalogSnapshot;
  openClawConfig?: OpenClawConfigState;
  wizard?: OpenClawConfigWizardMetadata;
  language: Language;
  t: Messages;
  busy: boolean;
  onSaveDefaultModel: (modelId: string) => void;
  onConfigureModelAuth: (input: ConfigureOpenClawModelAuthRequest) => void;
}) {
  const stale = catalog ? isCatalogStale(catalog) : false;
  const [selectedModelId, setSelectedModelId] = useState("");
  const [modelStep, setModelStep] = useState<"provider" | "method" | "details">("provider");
  const [providerSearch, setProviderSearch] = useState("");
  const [selectedProviderId, setSelectedProviderId] = useState("");
  const [selectedMethodId, setSelectedMethodId] = useState("");
  const [modelValues, setModelValues] = useState<Record<string, OpenClawWizardValue>>({});
  const copy =
    language === "zh-CN"
      ? {
          configuredModels: "已配置模型",
          contextWindow: "上下文窗口",
          catalogHealth: "配置状态"
        }
      : {
          configuredModels: "Configured models",
          contextWindow: "Context window",
          catalogHealth: "Catalog health"
        };
  const configCopy =
    language === "zh-CN"
      ? {
          addModel: "添加模型配置",
          modelId: "模型 ID",
          alias: "别名",
          apiAdapter: "API 适配器",
          baseUrl: "Base URL",
          credentialSource: "凭据来源",
          envSecret: "环境变量 SecretRef",
          directSecret: "直接写入",
          noSecret: "不写入凭据",
          apiKeyEnv: "API Key 环境变量",
          apiKey: "API Key",
          maxTokens: "最大输出",
          setDefault: "设为默认模型",
          addDescription: "通过 openclaw config set 写入 models.providers，并按需调用 openclaw models aliases/set。"
        }
      : {
          addModel: "Add model config",
          modelId: "Model ID",
          alias: "Alias",
          apiAdapter: "API adapter",
          baseUrl: "Base URL",
          credentialSource: "Credential source",
          envSecret: "Env SecretRef",
          directSecret: "Direct value",
          noSecret: "No credential",
          apiKeyEnv: "API key env var",
          apiKey: "API key",
          maxTokens: "Max output",
          setDefault: "Set as default model",
          addDescription: "Writes models.providers through openclaw config set, then optionally calls openclaw models aliases/set."
        };

  const modelCopy =
    language === "zh-CN"
      ? {
          configuredModels: "\u5df2\u914d\u7f6e\u6a21\u578b",
          contextWindow: "\u4e0a\u4e0b\u6587\u7a97\u53e3",
          catalogHealth: "\u914d\u7f6e\u72b6\u6001"
        }
      : copy;

  useEffect(() => {
    setSelectedModelId(openClawConfig?.defaultModelId ?? catalog?.models[0]?.id ?? "");
  }, [catalog?.models, openClawConfig?.defaultModelId]);

  const configuredModels = openClawConfig?.configuredModels ?? [];
  const wizardCopy =
    language === "zh-CN"
      ? {
          title: "\u6309 CLI \u8def\u5f84\u6dfb\u52a0\u6a21\u578b\u8ba4\u8bc1",
          description:
            "\u5148\u9009 Model/auth provider\uff0c\u518d\u8fdb\u5165\u8be5 provider \u7684 auth method\uff0c\u6700\u540e\u6309 OpenClaw \u914d\u7f6e\u5f62\u72b6\u5199\u5165 models.providers \u548c\u9ed8\u8ba4\u6a21\u578b\u3002",
          providerStep: "Model/auth provider",
          methodStep: "auth method",
          detailsStep: "\u586b\u5199\u914d\u7f6e",
          search: "\u641c\u7d22",
          chooseMethod: "\u9009\u62e9\u8ba4\u8bc1\u65b9\u5f0f",
          configure: "\u5199\u5165\u914d\u7f6e",
          back: "\u8fd4\u56de",
          empty: "\u672a\u52a0\u8f7d OpenClaw \u5411\u5bfc\u5143\u6570\u636e",
          interactiveHint:
            "OAuth / Device Pairing \u65b9\u5f0f\u4f1a\u7ed1\u5b9a\u4e3b\u673a\u4e0a\u5df2\u5b58\u5728\u7684 OpenClaw \u767b\u5f55\u8bb0\u5f55\uff1b\u771f\u6b63\u767b\u5f55\u4ecd\u7531 openclaw models auth login \u5728\u4ea4\u4e92\u7ec8\u7aef\u4e2d\u5b8c\u6210\u3002"
        }
      : {
          title: "Add model auth through the CLI path",
          description:
            "Choose Model/auth provider first, enter that provider's auth method screen, then write the matching OpenClaw models.providers/default-model config.",
          providerStep: "Model/auth provider",
          methodStep: "auth method",
          detailsStep: "Configuration",
          search: "Search",
          chooseMethod: "Choose auth method",
          configure: "Write config",
          back: "Back",
          empty: "OpenClaw wizard metadata is not loaded.",
          interactiveHint:
            "OAuth / Device Pairing methods bind to an existing OpenClaw login on this host; the actual sign-in still runs through openclaw models auth login in an interactive terminal."
        };
  const modelProviders = wizard?.modelProviders ?? [];
  const selectedProvider = modelProviders.find((provider) => provider.id === selectedProviderId) ?? modelProviders[0];
  const selectedMethod = selectedProvider?.methods.find((method) => method.id === selectedMethodId);
  const selectedModelFields = useMemo(
    () => mergeModelCatalogOptions(selectedMethod?.fields ?? [], selectedProvider?.id, catalog),
    [catalog, selectedMethod?.fields, selectedProvider?.id]
  );
  const filteredProviders = useMemo(
    () => filterWizardOptions(modelProviders, providerSearch),
    [modelProviders, providerSearch]
  );

  useEffect(() => {
    if (selectedProviderId || !modelProviders[0]) return;
    setSelectedProviderId(modelProviders[0].id);
  }, [modelProviders, selectedProviderId]);

  useEffect(() => {
    if (!selectedMethod) {
      setModelValues({});
      return;
    }
    setModelValues(defaultWizardValues(selectedModelFields));
  }, [selectedMethod?.id, selectedProvider?.id, selectedModelFields]);

  const submitModelConfig = () => {
    if (!selectedProvider || !selectedMethod) return;
    onConfigureModelAuth({
      providerId: selectedProvider.id,
      methodId: selectedMethod.id,
      values: modelValues
    });
  };

  return (
    <section className="page-grid">
      <div className="content-card stack-card">
        <div className="card-toolbar">
          <div className="card-title-block">
            <h3>{t.common.defaultModel}</h3>
            <p>{openClawConfig ? openClawConfig.configPath : t.catalogConfig.configFallback}</p>
          </div>
        </div>
        <div className="form-grid form-grid-wide">
          <label className="field-span-full">
            <span>{t.fields.primaryModel}</span>
            <select value={selectedModelId} onChange={(event) => setSelectedModelId(event.target.value)}>
              {(catalog?.models ?? []).map((model) => (
                <option key={model.id} value={model.id}>
                  {`${model.label} (${model.id})`}
                </option>
              ))}
              {configuredModels
                .filter((model) => !(catalog?.models ?? []).some((item) => item.id === model.id))
                .map((model) => (
                  <option key={model.id} value={model.id}>
                    {`${model.label} (${model.id})`}
                  </option>
                ))}
            </select>
          </label>
        </div>
        <div className="metric-strip compact-metric-strip">
          <div className="metric-chip">
            <Database size={16} />
            <span>{openClawConfig?.defaultModelId ?? t.common.noDefaultModel}</span>
          </div>
          <div className="metric-chip">
            <Database size={16} />
            <span>{modelCopy.catalogHealth}: {stale ? t.common.stale : t.common.fresh}</span>
          </div>
          {catalog && (
            <div className="metric-chip">
              <Database size={16} />
              <span>{`${t.fields.updatedAt}: ${formatDateTime(catalog.refreshedAt, language)}`}</span>
            </div>
          )}
        </div>
        <div className="card-actions">
          <button type="button" className="primary-action" disabled={!selectedModelId || busy} onClick={() => onSaveDefaultModel(selectedModelId)}>
            {busy ? <Loader2 className="spin" size={16} /> : <Database size={16} />}
            {t.actions.saveModel}
          </button>
        </div>
      </div>

      <div className="content-card stack-card">
        <div className="card-toolbar">
          <div className="card-title-block">
            <h3>{wizardCopy.title}</h3>
            <p>{wizardCopy.description}</p>
          </div>
        </div>

        <div className="wizard-shell">
          <WizardPath
            items={[
              wizardCopy.providerStep,
              selectedProvider?.label,
              selectedMethod ? `${selectedProvider?.label} ${wizardCopy.methodStep}` : undefined,
              selectedMethod?.label
            ]}
          />

          {modelProviders.length === 0 ? (
            <div className="empty-state page-empty">{wizardCopy.empty}</div>
          ) : modelStep === "provider" ? (
            <>
              <label className="wizard-search">
                <Search size={16} />
                <input value={providerSearch} onChange={(event) => setProviderSearch(event.target.value)} placeholder={wizardCopy.search} />
              </label>
              <WizardChoiceList
                options={filteredProviders}
                selectedId={selectedProvider?.id}
                emptyText={wizardCopy.empty}
                onSelect={(provider) => {
                  setSelectedProviderId(provider.id);
                  setSelectedMethodId("");
                  setModelStep("method");
                }}
              />
            </>
          ) : modelStep === "method" && selectedProvider ? (
            <>
              <div className="wizard-stage-toolbar">
                <button type="button" onClick={() => setModelStep("provider")}>
                  <ArrowLeft size={16} />
                  {wizardCopy.back}
                </button>
                <div>
                  <strong>{selectedProvider.label}</strong>
                  <span>{wizardCopy.chooseMethod}</span>
                </div>
              </div>
              <WizardChoiceList
                options={selectedProvider.methods}
                selectedId={selectedMethodId}
                emptyText={wizardCopy.empty}
                onSelect={(method) => {
                  setSelectedMethodId(method.id);
                  setModelStep("details");
                }}
              />
            </>
          ) : selectedProvider && selectedMethod ? (
            <>
              <div className="wizard-stage-toolbar">
                <button type="button" onClick={() => setModelStep("method")}>
                  <ArrowLeft size={16} />
                  {wizardCopy.back}
                </button>
                <div>
                  <strong>{selectedMethod.label}</strong>
                  <span>{selectedMethod.hint ?? wizardCopy.detailsStep}</span>
                </div>
              </div>
              {["oauth", "device_code", "custom", "local"].includes(selectedMethod.kind) && <p className="wizard-note">{wizardCopy.interactiveHint}</p>}
              <WizardFieldList fields={selectedModelFields} values={modelValues} onChange={setModelValues} />
              <div className="card-actions">
                <button
                  type="button"
                  className="primary-action"
                  disabled={busy || !wizardFieldsReady(selectedModelFields, modelValues)}
                  onClick={submitModelConfig}
                >
                  {busy ? <Loader2 className="spin" size={16} /> : <KeyRound size={16} />}
                  {selectedMethod.submitLabel ?? wizardCopy.configure}
                </button>
              </div>
            </>
          ) : null}
        </div>
      </div>

      <section className="card-grid data-card-grid">
        <TableCard title={t.tables.models} rows={catalog?.models.length ?? 0}>
          {catalog?.models.length ? (
            catalog.models.map((model) => (
              <div key={model.id} className="table-row">
                <div>
                  <strong>{model.label}</strong>
                  <p>{model.id}</p>
                </div>
                <div className="table-meta">
                  <span>{model.provider}</span>
                  <span>{`${t.fields.supportsTools}: ${model.supportsTools ? t.common.yes : t.common.no}`}</span>
                  <span>{`${modelCopy.contextWindow}: ${model.contextWindow?.toLocaleString(language) ?? t.common.unknown}`}</span>
                </div>
              </div>
            ))
          ) : (
            <div className="empty-state page-empty">{t.empty.noCatalog}</div>
          )}
        </TableCard>

        <TableCard title={modelCopy.configuredModels} rows={configuredModels.length}>
          {configuredModels.length ? (
            configuredModels.map((model) => (
              <div key={model.id} className="table-row">
                <div>
                  <strong>{model.label}</strong>
                  <p>{model.id}</p>
                </div>
                <div className="table-meta">
                  <span>{model.provider}</span>
                  <span>{model.alias ?? t.common.defaultOption}</span>
                </div>
              </div>
            ))
          ) : (
            <div className="empty-state page-empty">{t.empty.noCatalog}</div>
          )}
        </TableCard>
      </section>
    </section>
  );
}

export function AgentsPage({
  catalog,
  openClawConfig,
  language,
  t,
  busy,
  onAddAgent
}: {
  catalog?: CatalogSnapshot;
  openClawConfig?: OpenClawConfigState;
  language: Language;
  t: Messages;
  busy: boolean;
  onAddAgent: (input: { name: string; workspace?: string; modelId?: string }) => void;
}) {
  const [agentName, setAgentName] = useState("");
  const [agentWorkspace, setAgentWorkspace] = useState("");
  const [agentModelId, setAgentModelId] = useState("");
  const copy =
    language === "zh-CN"
      ? {
          configuredAgents: "已配置 Agent",
          catalogAgents: "可用 Agent",
          defaultAgent: "默认 Agent"
        }
      : {
          configuredAgents: "Configured agents",
          catalogAgents: "Available agents",
          defaultAgent: "Default agent"
        };

  useEffect(() => {
    setAgentModelId(openClawConfig?.defaultModelId ?? catalog?.models[0]?.id ?? "");
  }, [catalog?.models, openClawConfig?.defaultModelId]);

  useEffect(() => {
    if (!agentName.trim()) {
      setAgentWorkspace("");
      return;
    }
    if (agentWorkspace.trim()) return;
    if (openClawConfig?.defaultWorkspace) {
      setAgentWorkspace(joinPath(openClawConfig.defaultWorkspace, normalizeAgentId(agentName)));
    }
  }, [agentName, agentWorkspace, openClawConfig?.defaultWorkspace]);

  const configuredAgents = openClawConfig?.configuredAgents ?? [];

  return (
    <section className="page-grid">
      <div className="content-card stack-card">
        <div className="card-toolbar">
          <div className="card-title-block">
            <h3>{t.actions.addAgent}</h3>
            <p>{t.catalogConfig.addAgentDescription}</p>
          </div>
        </div>
        <div className="form-grid">
          <label>
            <span>{t.fields.agentName}</span>
            <input value={agentName} onChange={(event) => setAgentName(event.target.value)} placeholder="researcher" />
          </label>
          <label>
            <span>{t.fields.model}</span>
            <select value={agentModelId} onChange={(event) => setAgentModelId(event.target.value)}>
              <option value="">{t.common.defaultModel}</option>
              {(catalog?.models ?? []).map((model) => (
                <option key={model.id} value={model.id}>
                  {`${model.label} (${model.id})`}
                </option>
              ))}
            </select>
          </label>
          <label className="field-span-full">
            <span>{t.fields.workspace}</span>
            <input
              value={agentWorkspace}
              onChange={(event) => setAgentWorkspace(event.target.value)}
              placeholder={openClawConfig?.defaultWorkspace ? `${openClawConfig.defaultWorkspace}\\<agent-id>` : t.catalogConfig.workspacePlaceholder}
            />
          </label>
        </div>
        <div className="metric-strip compact-metric-strip">
          <div className="metric-chip">
            <FolderKanban size={16} />
            <span>{t.metrics.agents(configuredAgents.length)}</span>
          </div>
          <div className="metric-chip">
            <Database size={16} />
            <span>{openClawConfig?.defaultWorkspace ?? "-"}</span>
          </div>
          {configuredAgents.find((agent) => agent.isDefault) && (
            <div className="metric-chip">
              <FolderKanban size={16} />
              <span>{`${copy.defaultAgent}: ${configuredAgents.find((agent) => agent.isDefault)?.id}`}</span>
            </div>
          )}
        </div>
        <div className="card-actions">
          <button
            type="button"
            className="primary-action"
            disabled={!agentName.trim() || busy}
            onClick={() => {
              onAddAgent({
                name: agentName.trim(),
                workspace: agentWorkspace.trim() || undefined,
                modelId: agentModelId || undefined
              });
              setAgentName("");
              setAgentWorkspace("");
              setAgentModelId(openClawConfig?.defaultModelId ?? catalog?.models[0]?.id ?? "");
            }}
          >
            {busy ? <Loader2 className="spin" size={16} /> : <FolderKanban size={16} />}
            {t.actions.addAgent}
          </button>
        </div>
      </div>

      <section className="card-grid data-card-grid">
        <TableCard title={copy.configuredAgents} rows={configuredAgents.length}>
          {configuredAgents.length ? (
            configuredAgents.map((agent) => (
              <div key={agent.id} className="table-row">
                <div>
                  <strong>{agent.name ?? agent.id}</strong>
                  <p>{agent.id}</p>
                </div>
                <div className="table-meta">
                  <span>{agent.modelId ?? t.common.defaultModel}</span>
                  <span>{agent.workspace}</span>
                  <span>{agent.isDefault ? t.common.defaultOption : agent.agentDir}</span>
                </div>
              </div>
            ))
          ) : (
            <div className="empty-state page-empty">{t.empty.noCatalog}</div>
          )}
        </TableCard>

        <TableCard title={copy.catalogAgents} rows={catalog?.agents.length ?? 0}>
          {catalog?.agents.length ? (
            catalog.agents.map((agent) => (
              <div key={agent.id} className="table-row">
                <div>
                  <strong>{agent.label}</strong>
                  <p>{agent.id}</p>
                </div>
                <div className="table-meta">
                  <span>{agent.runtimeId ?? t.common.unknown}</span>
                  <span>{agent.modelId ?? t.common.defaultModel}</span>
                  <span>{agent.workspace ?? t.common.notLinked}</span>
                </div>
              </div>
            ))
          ) : (
            <div className="empty-state page-empty">{t.empty.noCatalog}</div>
          )}
        </TableCard>
      </section>
    </section>
  );
}

export function SchedulePage({ runtime, language, t }: { runtime?: RuntimeOverview; language: Language; t: Messages }) {
  const copy =
    language === "zh-CN"
      ? {
          runtimeSummary: "运行时排期",
          queuedOrRunning: "排队/运行中"
        }
      : {
          runtimeSummary: "Runtime schedule",
          queuedOrRunning: "Queued/running"
        };
  const activeTasks = runtime?.tasks.filter((task) => task.status === "queued" || task.status === "running").length ?? 0;

  return (
    <section className="page-grid">
      <div className="content-card stack-card">
        <div className="card-toolbar">
          <div className="card-title-block">
            <h3>{copy.runtimeSummary}</h3>
            <p>{t.metrics.runs((runtime?.sessions.length ?? 0) + (runtime?.tasks.length ?? 0))}</p>
          </div>
        </div>
        <div className="metric-strip">
          <div className="metric-chip">
            <Clock3 size={16} />
            <span>{`${t.tables.sessions}: ${runtime?.sessions.length ?? 0}`}</span>
          </div>
          <div className="metric-chip">
            <Clock3 size={16} />
            <span>{`${t.tables.tasks}: ${runtime?.tasks.length ?? 0}`}</span>
          </div>
          <div className="metric-chip">
            <Activity size={16} />
            <span>{`${copy.queuedOrRunning}: ${activeTasks}`}</span>
          </div>
        </div>
      </div>

      <section className="card-grid data-card-grid">
        <TableCard title={t.tables.sessions} rows={runtime?.sessions.length ?? 0}>
          {runtime?.sessions.length ? (
            runtime.sessions.map((session) => (
              <div key={session.id} className="table-row">
                <div>
                  <strong>{session.title}</strong>
                  <p>{session.id}</p>
                </div>
                <div className="table-meta">
                  <span>{formatDateTime(session.updatedAt, language)}</span>
                </div>
              </div>
            ))
          ) : (
            <div className="empty-state page-empty">{t.empty.noSessions}</div>
          )}
        </TableCard>

        <TableCard title={t.tables.tasks} rows={runtime?.tasks.length ?? 0}>
          {runtime?.tasks.length ? (
            runtime.tasks.map((task) => (
              <div key={task.id} className="table-row">
                <div>
                  <strong>{task.title}</strong>
                  <p>{task.id}</p>
                </div>
                <div className="table-meta">
                  <span className={`status-pill status-${task.status}`}>{t.status[task.status]}</span>
                  <span>{formatDateTime(task.updatedAt, language)}</span>
                </div>
              </div>
            ))
          ) : (
            <div className="empty-state page-empty">{t.empty.noTasks}</div>
          )}
        </TableCard>
      </section>
    </section>
  );
}

export function ChannelsPage({
  catalog,
  openClawConfig,
  wizard,
  language,
  t,
  busy,
  onConfigureChannel
}: {
  catalog?: CatalogSnapshot;
  openClawConfig?: OpenClawConfigState;
  wizard?: OpenClawConfigWizardMetadata;
  language: Language;
  t: Messages;
  busy: boolean;
  onConfigureChannel: (input: ConfigureOpenClawChannelRequest) => void;
}) {
  const copy =
    language === "zh-CN"
      ? {
          deliverySurface: "交付通道",
          available: "可用",
          notConfigured: "未配置",
          disabled: "已停用"
        }
      : {
          deliverySurface: "Delivery channels",
          available: "available",
          notConfigured: "not configured",
          disabled: "disabled"
        };
  const configCopy =
    language === "zh-CN"
      ? {
          addChannel: "添加频道配置",
          configuredChannels: "已配置频道",
          channel: "频道",
          account: "账号 ID",
          accountName: "显示名称",
          credentialKind: "凭据字段",
          credentialValue: "凭据值",
          useEnv: "使用环境变量",
          noCredential: "不写入凭据",
          defaultAccount: "默认账号",
          credentialKeys: "凭据字段",
          addDescription: "调用 openclaw channels add，让 OpenClaw 执行插件安装、账号配置迁移和配置校验。"
        }
      : {
          addChannel: "Add channel config",
          configuredChannels: "Configured channels",
          channel: "Channel",
          account: "Account ID",
          accountName: "Display name",
          credentialKind: "Credential field",
          credentialValue: "Credential value",
          useEnv: "Use environment",
          noCredential: "No credential",
          defaultAccount: "Default account",
          credentialKeys: "Credential keys",
          addDescription: "Calls openclaw channels add so OpenClaw handles plugin installation, account migration, and validation."
        };
  const wizardCopy =
    language === "zh-CN"
      ? {
          title: "\u6309 CLI \u8def\u5f84\u6dfb\u52a0 Channel",
          description:
            "\u5148\u9009 Channel\uff0c\u518d\u8fdb\u5165\u8be5 Channel \u7684\u914d\u7f6e\u754c\u9762\uff1b\u63d0\u4ea4\u65f6\u4ecd\u8c03\u7528 openclaw channels add\uff0c\u8ba9 OpenClaw \u6267\u884c\u63d2\u4ef6\u5b89\u88c5\u3001\u8d26\u53f7\u8fc1\u79fb\u548c\u6821\u9a8c\u3002",
          channelStep: "Channel",
          detailsStep: "\u914d\u7f6e\u9009\u9879",
          search: "\u641c\u7d22",
          configure: "\u5199\u5165\u914d\u7f6e",
          back: "\u8fd4\u56de",
          empty: "\u672a\u52a0\u8f7d OpenClaw Channel \u5411\u5bfc\u5143\u6570\u636e"
        }
      : {
          title: "Add channel through the CLI path",
          description:
            "Choose the channel first, then enter its channel-specific setup screen. Submit still calls openclaw channels add so OpenClaw handles plugins, account migration, and validation.",
          channelStep: "Channel",
          detailsStep: "Setup options",
          search: "Search",
          configure: "Write config",
          back: "Back",
          empty: "OpenClaw channel wizard metadata is not loaded."
        };
  const channelOptions = useMemo(() => {
    const byId = new Map<string, OpenClawChannelSetupOption>();
    for (const option of wizard?.channels ?? []) byId.set(option.id, option);
    for (const channel of catalog?.channels ?? []) {
      if (!byId.has(channel.id)) byId.set(channel.id, { id: channel.id, label: channel.label, fields: [] });
    }
    return [...byId.values()].sort((left, right) => left.label.localeCompare(right.label));
  }, [catalog?.channels, wizard?.channels]);
  const [channelStep, setChannelStep] = useState<"channel" | "details">("channel");
  const [channelSearch, setChannelSearch] = useState("");
  const [selectedChannelId, setSelectedChannelId] = useState("");
  const [channelValues, setChannelValues] = useState<Record<string, OpenClawWizardValue>>({});
  const selectedChannel = channelOptions.find((channel) => channel.id === selectedChannelId) ?? channelOptions[0];
  const filteredChannels = useMemo(() => filterWizardOptions(channelOptions, channelSearch), [channelOptions, channelSearch]);
  const configuredChannels = openClawConfig?.configuredChannels ?? [];

  useEffect(() => {
    if (selectedChannelId || !channelOptions[0]) return;
    setSelectedChannelId(channelOptions[0].id);
  }, [channelOptions, selectedChannelId]);

  useEffect(() => {
    if (!selectedChannel) {
      setChannelValues({});
      return;
    }
    setChannelValues(defaultWizardValues(selectedChannel.fields));
  }, [selectedChannel?.id]);

  const submitChannelConfig = () => {
    if (!selectedChannel) return;
    onConfigureChannel({
      channelId: selectedChannel.id,
      values: channelValues
    });
  };

  return (
    <section className="page-grid">
      <div className="content-card stack-card">
        <div className="card-toolbar">
          <div className="card-title-block">
            <h3>{copy.deliverySurface}</h3>
            <p>{catalog ? `${t.fields.updatedAt}: ${formatDateTime(catalog.refreshedAt, language)}` : t.empty.noCatalog}</p>
          </div>
        </div>
        <div className="metric-strip">
          <div className="metric-chip">
            <Database size={16} />
            <span>{t.metrics.channels(catalog?.channels.length ?? 0)}</span>
          </div>
          <div className="metric-chip">
            <Database size={16} />
            <span>{t.metrics.tools(catalog?.tools.length ?? 0)}</span>
          </div>
          <div className="metric-chip">
            <Database size={16} />
            <span>{`${configCopy.configuredChannels}: ${configuredChannels.length}`}</span>
          </div>
        </div>
      </div>

      <div className="content-card stack-card">
        <div className="card-toolbar">
          <div className="card-title-block">
            <h3>{wizardCopy.title}</h3>
            <p>{wizardCopy.description}</p>
          </div>
        </div>

        <div className="wizard-shell">
          <WizardPath items={[wizardCopy.channelStep, selectedChannel?.label, selectedChannel ? wizardCopy.detailsStep : undefined]} />

          {channelOptions.length === 0 ? (
            <div className="empty-state page-empty">{wizardCopy.empty}</div>
          ) : channelStep === "channel" ? (
            <>
              <label className="wizard-search">
                <Search size={16} />
                <input value={channelSearch} onChange={(event) => setChannelSearch(event.target.value)} placeholder={wizardCopy.search} />
              </label>
              <WizardChoiceList
                options={filteredChannels}
                selectedId={selectedChannel?.id}
                emptyText={wizardCopy.empty}
                onSelect={(channel) => {
                  setSelectedChannelId(channel.id);
                  setChannelStep("details");
                }}
              />
            </>
          ) : selectedChannel ? (
            <>
              <div className="wizard-stage-toolbar">
                <button type="button" onClick={() => setChannelStep("channel")}>
                  <ArrowLeft size={16} />
                  {wizardCopy.back}
                </button>
                <div>
                  <strong>{selectedChannel.label}</strong>
                  <span>{selectedChannel.hint ?? wizardCopy.detailsStep}</span>
                </div>
              </div>
              <WizardFieldList fields={selectedChannel.fields} values={channelValues} onChange={setChannelValues} />
              <div className="card-actions">
                <button
                  type="button"
                  className="primary-action"
                  disabled={busy || !wizardFieldsReady(selectedChannel.fields, channelValues)}
                  onClick={submitChannelConfig}
                >
                  {busy ? <Loader2 className="spin" size={16} /> : <MessageSquareText size={16} />}
                  {wizardCopy.configure}
                </button>
              </div>
            </>
          ) : null}
        </div>
      </div>

      <section className="card-grid data-card-grid">
        <TableCard title={configCopy.configuredChannels} rows={configuredChannels.length}>
          {configuredChannels.length ? (
            configuredChannels.flatMap((channel) =>
              channel.accounts.map((account) => (
                <div key={`${channel.id}:${account.id}`} className="table-row">
                  <div>
                    <strong>{account.name ?? `${channel.label} / ${account.id}`}</strong>
                    <p>{`${channel.id}:${account.id}`}</p>
                  </div>
                  <div className="table-meta">
                    <span>{account.enabled && channel.enabled ? copy.available : copy.disabled}</span>
                    <span>{account.isDefault ? configCopy.defaultAccount : account.id}</span>
                    <span>{`${configCopy.credentialKeys}: ${account.credentialKeys.length ? account.credentialKeys.join(", ") : "-"}`}</span>
                  </div>
                </div>
              ))
            )
          ) : (
            <div className="empty-state page-empty">{t.empty.noCatalog}</div>
          )}
        </TableCard>

        <TableCard title={t.tables.channels} rows={catalog?.channels.length ?? 0}>
          {catalog?.channels.length ? (
            catalog.channels.map((channel) => (
              <div key={channel.id} className="table-row">
                <div>
                  <strong>{channel.label}</strong>
                  <p>{channel.id}</p>
                </div>
                <div className="table-meta">
                  <span>{channelStatusLabel(channel.status, copy)}</span>
                </div>
              </div>
            ))
          ) : (
            <div className="empty-state page-empty">{t.empty.noCatalog}</div>
          )}
        </TableCard>

        <TableCard title={t.tables.tools} rows={catalog?.tools.length ?? 0}>
          {catalog?.tools.length ? (
            catalog.tools.map((tool) => (
              <div key={tool.id} className="table-row">
                <div>
                  <strong>{tool.label}</strong>
                  <p>{tool.description}</p>
                </div>
                <div className="table-meta">
                  <span>{tool.category}</span>
                </div>
              </div>
            ))
          ) : (
            <div className="empty-state page-empty">{t.empty.noCatalog}</div>
          )}
        </TableCard>
      </section>
    </section>
  );
}

export function CatalogPage({
  catalog,
  openClawConfig,
  runtime,
  language,
  t,
  busy,
  onSaveDefaultModel,
  onAddAgent
}: {
  catalog?: CatalogSnapshot;
  openClawConfig?: OpenClawConfigState;
  runtime?: RuntimeOverview;
  language: Language;
  t: Messages;
  busy: boolean;
  onSaveDefaultModel: (modelId: string) => void;
  onAddAgent: (input: { name: string; workspace?: string; modelId?: string }) => void;
}) {
  const stale = catalog ? isCatalogStale(catalog) : false;
  const [selectedModelId, setSelectedModelId] = useState("");
  const [agentName, setAgentName] = useState("");
  const [agentWorkspace, setAgentWorkspace] = useState("");
  const [agentModelId, setAgentModelId] = useState("");

  useEffect(() => {
    setSelectedModelId(openClawConfig?.defaultModelId ?? catalog?.models[0]?.id ?? "");
  }, [catalog?.models, openClawConfig?.defaultModelId]);

  useEffect(() => {
    setAgentModelId(openClawConfig?.defaultModelId ?? catalog?.models[0]?.id ?? "");
  }, [catalog?.models, openClawConfig?.defaultModelId]);

  useEffect(() => {
    if (!agentName.trim()) {
      setAgentWorkspace("");
      return;
    }
    if (agentWorkspace.trim()) return;
    if (openClawConfig?.defaultWorkspace) {
      setAgentWorkspace(joinPath(openClawConfig.defaultWorkspace, normalizeAgentId(agentName)));
    }
  }, [agentName, agentWorkspace, openClawConfig?.defaultWorkspace]);

  return (
    <section className="page-grid">
      <div className="content-card stack-card">
        <div className="card-toolbar">
          <div className="card-title-block">
            <h3>{t.catalogConfig.quickConfig}</h3>
            <p>{openClawConfig ? openClawConfig.configPath : t.catalogConfig.configFallback}</p>
          </div>
        </div>

        <div className="card-grid quick-config-grid">
          <article className="feature-card">
            <div className="feature-card-header">
              <div>
                <strong>{t.common.defaultModel}</strong>
                <p>{t.catalogConfig.defaultModelDescription}</p>
              </div>
            </div>
            <div className="form-grid">
              <label className="field-span-full">
                <span>{t.fields.primaryModel}</span>
                <select value={selectedModelId} onChange={(event) => setSelectedModelId(event.target.value)}>
                  {(catalog?.models ?? []).map((model) => (
                    <option key={model.id} value={model.id}>
                      {`${model.label} (${model.id})`}
                    </option>
                  ))}
                  {(openClawConfig?.configuredModels ?? [])
                    .filter((model) => !(catalog?.models ?? []).some((item) => item.id === model.id))
                    .map((model) => (
                      <option key={model.id} value={model.id}>
                        {`${model.label} (${model.id})`}
                      </option>
                    ))}
                </select>
              </label>
            </div>
            <div className="metric-strip compact-metric-strip">
              <div className="metric-chip">
                <Database size={16} />
                <span>{openClawConfig?.defaultModelId ?? t.common.noDefaultModel}</span>
              </div>
              <div className="metric-chip">
                <Database size={16} />
                <span>{openClawConfig?.defaultWorkspace ?? "-"}</span>
              </div>
            </div>
            <div className="card-actions">
              <button type="button" className="primary-action" disabled={!selectedModelId || busy} onClick={() => onSaveDefaultModel(selectedModelId)}>
                {busy ? <Loader2 className="spin" size={16} /> : <Database size={16} />}
                {t.actions.saveModel}
              </button>
            </div>
          </article>

          <article className="feature-card">
            <div className="feature-card-header">
              <div>
                <strong>{t.actions.addAgent}</strong>
                <p>{t.catalogConfig.addAgentDescription}</p>
              </div>
            </div>
            <div className="form-grid">
              <label>
                <span>{t.fields.agentName}</span>
                <input value={agentName} onChange={(event) => setAgentName(event.target.value)} placeholder="researcher" />
              </label>
              <label>
                <span>{t.fields.model}</span>
                <select value={agentModelId} onChange={(event) => setAgentModelId(event.target.value)}>
                  <option value="">{t.common.defaultModel}</option>
                  {(catalog?.models ?? []).map((model) => (
                    <option key={model.id} value={model.id}>
                      {`${model.label} (${model.id})`}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field-span-full">
                <span>{t.fields.workspace}</span>
                <input
                  value={agentWorkspace}
                  onChange={(event) => setAgentWorkspace(event.target.value)}
                  placeholder={openClawConfig?.defaultWorkspace ? `${openClawConfig.defaultWorkspace}\\<agent-id>` : t.catalogConfig.workspacePlaceholder}
                />
              </label>
            </div>
            <div className="metric-strip compact-metric-strip">
              {(openClawConfig?.configuredAgents ?? []).slice(0, 3).map((agent) => (
                <div key={agent.id} className="metric-chip">
                  <FolderKanban size={16} />
                  <span>{`${agent.id} · ${agent.modelId ?? t.common.defaultOption}`}</span>
                </div>
              ))}
            </div>
            <div className="card-actions">
              <button
                type="button"
                className="primary-action"
                disabled={!agentName.trim() || busy}
                onClick={() => {
                  onAddAgent({
                    name: agentName.trim(),
                    workspace: agentWorkspace.trim() || undefined,
                    modelId: agentModelId || undefined
                  });
                  setAgentName("");
                  setAgentWorkspace("");
                  setAgentModelId(openClawConfig?.defaultModelId ?? catalog?.models[0]?.id ?? "");
                }}
              >
                {busy ? <Loader2 className="spin" size={16} /> : <FolderKanban size={16} />}
                {t.actions.addAgent}
              </button>
            </div>
          </article>
        </div>
      </div>

      <div className="content-card stack-card">
        <div className="metric-strip">
          <div className="metric-chip">
            <Database size={16} />
            <span>{t.metrics.models(catalog?.models.length ?? 0)}</span>
          </div>
          <div className="metric-chip">
            <Database size={16} />
            <span>{t.metrics.agents(catalog?.agents.length ?? 0)}</span>
          </div>
          <div className="metric-chip">
            <Database size={16} />
            <span>{t.metrics.tools(catalog?.tools.length ?? 0)}</span>
          </div>
          <div className="metric-chip">
            <Database size={16} />
            <span>{stale ? t.common.stale : t.common.fresh}</span>
          </div>
        </div>
        {catalog && (
          <p className="supporting-copy">
            {t.fields.updatedAt}: {formatDateTime(catalog.refreshedAt, language)}
          </p>
        )}
      </div>

      <section className="card-grid data-card-grid">
        <TableCard title={t.tables.models} rows={catalog?.models.length ?? 0}>
          {catalog?.models.length ? (
            catalog.models.map((model) => (
              <div key={model.id} className="table-row">
                <div>
                  <strong>{model.label}</strong>
                  <p>{model.id}</p>
                </div>
                <div className="table-meta">
                  <span>{model.provider}</span>
                  <span>{model.supportsTools ? t.common.yes : t.common.no}</span>
                </div>
              </div>
            ))
          ) : (
            <div className="empty-state page-empty">{t.empty.noCatalog}</div>
          )}
        </TableCard>

        <TableCard title={t.tables.agents} rows={catalog?.agents.length ?? 0}>
          {catalog?.agents.map((agent) => (
            <div key={agent.id} className="table-row">
              <div>
                <strong>{agent.label}</strong>
                <p>{agent.id}</p>
              </div>
              <div className="table-meta">
                <span>{agent.runtimeId ?? t.common.unknown}</span>
                <span>{agent.modelId ?? t.common.defaultModel}</span>
              </div>
            </div>
          ))}
        </TableCard>

        <TableCard title={t.tables.tools} rows={catalog?.tools.length ?? 0}>
          {catalog?.tools.map((tool) => (
            <div key={tool.id} className="table-row">
              <div>
                <strong>{tool.label}</strong>
                <p>{tool.description}</p>
              </div>
              <div className="table-meta">
                <span>{tool.category}</span>
              </div>
            </div>
          ))}
        </TableCard>

        <TableCard title={t.tables.channels} rows={catalog?.channels.length ?? 0}>
          {catalog?.channels.map((channel) => (
            <div key={channel.id} className="table-row">
              <div>
                <strong>{channel.label}</strong>
                <p>{channel.id}</p>
              </div>
              <div className="table-meta">
                <span>{channel.status}</span>
              </div>
            </div>
          ))}
        </TableCard>

        <TableCard title={t.tables.sessions} rows={runtime?.sessions.length ?? 0}>
          {runtime?.sessions.length ? (
            runtime.sessions.map((session) => (
              <div key={session.id} className="table-row">
                <div>
                  <strong>{session.title}</strong>
                  <p>{session.id}</p>
                </div>
                <div className="table-meta">
                  <span>{formatDateTime(session.updatedAt, language)}</span>
                </div>
              </div>
            ))
          ) : (
            <div className="empty-state page-empty">{t.empty.noSessions}</div>
          )}
        </TableCard>

        <TableCard title={t.tables.tasks} rows={runtime?.tasks.length ?? 0}>
          {runtime?.tasks.length ? (
            runtime.tasks.map((task) => (
              <div key={task.id} className="table-row">
                <div>
                  <strong>{task.title}</strong>
                  <p>{task.id}</p>
                </div>
                <div className="table-meta">
                  <span className={`status-pill status-${task.status}`}>{t.status[task.status]}</span>
                  <span>{formatDateTime(task.updatedAt, language)}</span>
                </div>
              </div>
            ))
          ) : (
            <div className="empty-state page-empty">{t.empty.noTasks}</div>
          )}
        </TableCard>
      </section>
    </section>
  );
}

function WidgetCard({
  widget,
  dashboard,
  runs,
  approvals,
  catalog,
  runtime,
  language,
  t,
  onRemove
}: {
  widget: DashboardWidget;
  dashboard?: WorkspaceDashboard;
  runs: WorkflowRunView[];
  approvals: PendingApprovalItem[];
  catalog?: CatalogSnapshot;
  runtime?: RuntimeOverview;
  language: Language;
  t: Messages;
  onRemove: () => void;
}) {
  return (
    <article className="feature-card widget-card">
      <div className="feature-card-header">
        <div>
          <strong>{widget.title}</strong>
          <p>{widgetTypeLabel(widget.type, t)}</p>
        </div>
        <button type="button" className="icon-button" onClick={onRemove}>
          <Trash2 size={16} />
        </button>
      </div>
      {widget.type === "recent_runs" && (
        <div className="widget-list">
          {runs.slice(0, 3).map((run) => (
            <div key={run.run.id} className="mini-row">
              <span>{run.run.id}</span>
              <code>{t.status[run.run.status]}</code>
            </div>
          ))}
        </div>
      )}
      {widget.type === "pending_approvals" && (
        <div className="widget-list">
          <div className="metric-chip emphasize">
            <Clock3 size={16} />
            <span>{t.metrics.approvals(approvals.length)}</span>
          </div>
          {approvals.slice(0, 3).map((approval) => (
            <div key={approval.nodeRunId} className="mini-row">
              <span>{approval.workflowName}</span>
              <code>{approval.nodeLabel}</code>
            </div>
          ))}
        </div>
      )}
      {widget.type === "runtime_overview" && (
        <div className="widget-list">
          <div className="mini-row">
            <span>{t.tables.sessions}</span>
            <code>{runtime?.sessions.length ?? 0}</code>
          </div>
          <div className="mini-row">
            <span>{t.tables.tasks}</span>
            <code>{runtime?.tasks.length ?? 0}</code>
          </div>
        </div>
      )}
      {widget.type === "catalog_status" && (
        <div className="widget-list">
          <div className="mini-row">
            <span>{t.tables.models}</span>
            <code>{catalog?.models.length ?? 0}</code>
          </div>
          <div className="mini-row">
            <span>{t.tables.agents}</span>
            <code>{catalog?.agents.length ?? 0}</code>
          </div>
          <div className="mini-row">
            <span>{t.fields.updatedAt}</span>
            <code>{catalog ? formatDateTime(catalog.refreshedAt, language) : t.common.unknown}</code>
          </div>
        </div>
      )}
      {widget.type === "notes" && (
        <div className="widget-list">
          {(dashboard?.notes ?? []).slice(0, 3).map((note) => (
            <div key={note.id} className="mini-column">
              <strong>{note.title}</strong>
              <p>{note.body}</p>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

function channelStatusLabel(
  status: "available" | "not_configured" | "disabled",
  copy: { available: string; notConfigured: string; disabled: string }
): string {
  if (status === "available") return copy.available;
  if (status === "not_configured") return copy.notConfigured;
  return copy.disabled;
}

function mergeModelCatalogOptions(fields: OpenClawWizardField[], providerId: string | undefined, catalog: CatalogSnapshot | undefined): OpenClawWizardField[] {
  if (!providerId) return fields;
  const catalogOptions =
    catalog?.models
      .filter((model) => model.provider === providerId || model.id.startsWith(`${providerId}/`))
      .map((model) => {
        const value = model.id.startsWith(`${providerId}/`) ? model.id.slice(providerId.length + 1) : model.id;
        return { value, label: model.label === model.id ? value : `${model.label} (${value})` };
      }) ?? [];

  return fields.map((field) => {
    if (field.id !== "modelId") return field;
    const optionsByValue = new Map<string, { value: string; label: string; hint?: string }>();
    for (const option of field.options ?? []) optionsByValue.set(option.value, option);
    for (const option of catalogOptions) optionsByValue.set(option.value, option);
    const options = [...optionsByValue.values()];
    return {
      ...field,
      options,
      defaultValue: options.some((option) => option.value === field.defaultValue) ? field.defaultValue : options[0]?.value ?? field.defaultValue
    };
  });
}

function WizardPath({ items }: { items: Array<string | undefined> }) {
  const visibleItems = items.filter((item): item is string => Boolean(item?.trim()));
  return (
    <div className="wizard-path">
      {visibleItems.map((item, index) => (
        <span key={`${item}:${index}`} className="wizard-path-item">
          {index > 0 && <ChevronRight size={14} />}
          <span>{item}</span>
        </span>
      ))}
    </div>
  );
}

function WizardChoiceList<T extends { id: string; label: string; hint?: string }>({
  options,
  selectedId,
  emptyText,
  onSelect
}: {
  options: T[];
  selectedId?: string;
  emptyText: string;
  onSelect: (option: T) => void;
}) {
  if (options.length === 0) return <div className="empty-state page-empty">{emptyText}</div>;

  return (
    <div className="wizard-option-list">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          className={`wizard-option ${option.id === selectedId ? "selected" : ""}`}
          onClick={() => onSelect(option)}
        >
          <span className="wizard-option-main">
            <strong>{option.label}</strong>
            <span>{option.hint ?? option.id}</span>
          </span>
          <ChevronRight size={16} />
        </button>
      ))}
    </div>
  );
}

function WizardFieldList({
  fields,
  values,
  onChange
}: {
  fields: OpenClawWizardField[];
  values: Record<string, OpenClawWizardValue>;
  onChange: (values: Record<string, OpenClawWizardValue>) => void;
}) {
  const visibleFields = fields.filter((field) => isWizardFieldVisible(field, values));
  if (visibleFields.length === 0) return <div className="empty-state compact-empty-state">No additional options.</div>;

  return (
    <div className="form-grid form-grid-wide wizard-field-grid">
      {visibleFields.map((field) => {
        const value = values[field.id] ?? field.defaultValue ?? (field.type === "checkbox" ? false : "");
        return (
          <label key={field.id} className={field.type === "checkbox" ? "checkbox-field" : undefined}>
            {field.type !== "checkbox" && <span>{field.label}</span>}
            {field.type === "select" ? (
              <select value={String(value ?? "")} onChange={(event) => onChange({ ...values, [field.id]: event.target.value })}>
                {(field.options ?? []).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : field.type === "checkbox" ? (
              <>
                <input type="checkbox" checked={value === true} onChange={(event) => onChange({ ...values, [field.id]: event.target.checked })} />
                <span>{field.label}</span>
              </>
            ) : (
              <input
                type={field.type === "password" ? "password" : field.type === "number" ? "number" : "text"}
                inputMode={field.type === "number" ? "numeric" : undefined}
                value={String(value ?? "")}
                onChange={(event) => onChange({ ...values, [field.id]: event.target.value })}
                placeholder={field.placeholder}
              />
            )}
            {field.hint && <small className="field-hint">{field.hint}</small>}
          </label>
        );
      })}
    </div>
  );
}

function filterWizardOptions<T extends { label: string; id: string; hint?: string }>(options: T[], search: string): T[] {
  const normalized = search.trim().toLowerCase();
  if (!normalized) return options;
  return options.filter((option) => [option.label, option.id, option.hint].some((value) => value?.toLowerCase().includes(normalized)));
}

function defaultWizardValues(fields: OpenClawWizardField[]): Record<string, OpenClawWizardValue> {
  return Object.fromEntries(
    fields.map((field) => [field.id, field.defaultValue ?? (field.type === "checkbox" ? false : "")])
  );
}

function wizardFieldsReady(fields: OpenClawWizardField[], values: Record<string, OpenClawWizardValue>): boolean {
  return fields.every((field) => {
    if (!isWizardFieldVisible(field, values) || !field.required) return true;
    const value = values[field.id] ?? field.defaultValue;
    if (field.type === "checkbox") return value === true;
    if (typeof value === "string") return value.trim().length > 0;
    if (typeof value === "number") return Number.isFinite(value);
    return value !== undefined;
  });
}

function isWizardFieldVisible(field: OpenClawWizardField, values: Record<string, OpenClawWizardValue>): boolean {
  if (!field.visibleWhen) return true;
  const actual = values[field.visibleWhen.fieldId];
  return actual === field.visibleWhen.equals;
}

function TableCard({ title, rows, children }: { title: string; rows: number; children: ReactNode }) {
  return (
    <div className="content-card stack-card">
      <div className="card-toolbar">
        <div className="card-title-block">
          <h3>{title}</h3>
          <p>{rows}</p>
        </div>
      </div>
      <div className="table-stack">{children}</div>
    </div>
  );
}

function CompanyDetailCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="company-detail-card">
      <span>{label}</span>
      <strong>{String(value)}</strong>
    </div>
  );
}

function CompanyStatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="company-stat-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function TraceBubble({
  role,
  title,
  body
}: {
  role: "system" | "assistant" | "error";
  title: string;
  body: string;
}) {
  return (
    <article className={`trace-bubble trace-bubble-${role}`}>
      <div className="trace-bubble-title">{title}</div>
      <pre className="trace-bubble-body">{body}</pre>
    </article>
  );
}

function buildTraceIssues(
  activeRun: WorkflowRunView | undefined,
  workflow: WorkflowDefinition | undefined,
  orderedNodes: WorkflowNode[],
  t: Messages
): TraceIssue[] {
  if (!activeRun?.nodeRuns.length) {
    return buildPendingTraceIssues(workflow, orderedNodes, t);
  }

  const nodesById = new Map((workflow?.nodes ?? []).map((node) => [node.id, node]));
  const childrenBySlotId = new Map<string, Set<string>>();
  for (const node of workflow?.nodes ?? []) {
    if (!node.parentId) continue;
    const parent = nodesById.get(node.parentId);
    if (parent?.type !== "manager_slot") continue;
    childrenBySlotId.set(node.parentId, new Set([...(childrenBySlotId.get(node.parentId) ?? []), node.id]));
  }

  const issues: TraceIssue[] = [];
  let issueIndex = 1;
  for (let runIndex = 0; runIndex < activeRun.nodeRuns.length; runIndex += 1) {
    const nodeRun = activeRun.nodeRuns[runIndex]!;
    const node = nodesById.get(nodeRun.nodeId);
    if (node?.type !== "manager_slot") {
      issues.push(createNodeTraceIssue(activeRun, nodeRun, node, issueIndex, node?.parentId ? 1 : 0, t));
      issueIndex += 1;
      continue;
    }

    const slotLabel = nodeRun.nodeLabel || node.config.label || nodeRun.nodeId;
    const slotEvents = activeRun.events.filter((event) => event.nodeRunId === nodeRun.id);
    issues.push({
      key: `${nodeRun.id}:input`,
      index: issueIndex,
      label: `${slotLabel} ${t.trace.slotInputSuffix}`,
      kind: "slot_input",
      depth: 0,
      node,
      nodeRun,
      issueStatus: nodeRun.startedAt ? "completed" : toIssueStatus(nodeRun.status),
      outputPreview: t.trace.managerInputPreview,
      outputBody: t.trace.managerInputBody,
      events: slotEvents.filter((event) => event.type !== "node.run.completed")
    });
    issueIndex += 1;

    const childIds = childrenBySlotId.get(node.id) ?? new Set<string>();
    let childRunIndex = runIndex + 1;
    while (childRunIndex < activeRun.nodeRuns.length) {
      const childRun = activeRun.nodeRuns[childRunIndex]!;
      if (!childIds.has(childRun.nodeId)) break;
      const childNode = nodesById.get(childRun.nodeId);
      issues.push(createNodeTraceIssue(activeRun, childRun, childNode, issueIndex, 1, t));
      issueIndex += 1;
      childRunIndex += 1;
    }

    issues.push({
      key: `${nodeRun.id}:output`,
      index: issueIndex,
      label: `${slotLabel} ${t.trace.slotOutputSuffix}`,
      kind: "slot_output",
      depth: 0,
      node,
      nodeRun,
      issueStatus: toSlotOutputIssueStatus(nodeRun),
      outputPreview: nodeRun.output === undefined ? t.trace.waitingNestedNodes : summarizeOutput(nodeRun.output, t),
      events: slotEvents
    });
    issueIndex += 1;
    runIndex = childRunIndex - 1;
  }

  return issues;
}

function buildPendingTraceIssues(workflow: WorkflowDefinition | undefined, orderedNodes: WorkflowNode[], t: Messages): TraceIssue[] {
  if (!workflow) return [];

  const childrenBySlotId = new Map<string, WorkflowNode[]>();
  for (const node of workflow.nodes) {
    if (!node.parentId) continue;
    const parent = workflow.nodes.find((candidate) => candidate.id === node.parentId);
    if (parent?.type !== "manager_slot") continue;
    childrenBySlotId.set(node.parentId, [...(childrenBySlotId.get(node.parentId) ?? []), node]);
  }

  const visited = new Set<string>();
  const issues: TraceIssue[] = [];
  let issueIndex = 1;
  for (const node of orderedNodes) {
    if (visited.has(node.id) || node.parentId) continue;
    visited.add(node.id);
    if (node.type !== "manager_slot") {
      issues.push(createPendingTraceIssue(node, issueIndex, 0, t));
      issueIndex += 1;
      continue;
    }

    issues.push(createPendingSlotBoundaryIssue(node, issueIndex, "slot_input", t));
    issueIndex += 1;
    for (const child of childrenBySlotId.get(node.id) ?? []) {
      visited.add(child.id);
      issues.push(createPendingTraceIssue(child, issueIndex, 1, t));
      issueIndex += 1;
    }
    issues.push(createPendingSlotBoundaryIssue(node, issueIndex, "slot_output", t));
    issueIndex += 1;
  }
  return issues;
}

function createNodeTraceIssue(
  activeRun: WorkflowRunView,
  nodeRun: WorkflowNodeRun,
  node: WorkflowNode | undefined,
  index: number,
  depth: number,
  t: Messages
): TraceIssue {
  const label = nodeRun.nodeLabel || node?.config.label || nodeRun.nodeId;
  return {
    key: nodeRun.id,
    index,
    label,
    kind: "node",
    depth,
    node,
    nodeRun,
    issueStatus: toIssueStatus(nodeRun.status),
    outputPreview: summarizeOutput(nodeRun.output, t),
    events: activeRun.events.filter((event) => event.nodeRunId === nodeRun.id)
  };
}

function createPendingTraceIssue(node: WorkflowNode, index: number, depth: number, t: Messages): TraceIssue {
  return {
    key: `node:${node.id}`,
    index,
    label: node.config.label,
    kind: "node",
    depth,
    node,
    issueStatus: "pending",
    outputPreview: summarizeOutput(undefined, t),
    events: []
  };
}

function createPendingSlotBoundaryIssue(node: WorkflowNode, index: number, kind: "slot_input" | "slot_output", t: Messages): TraceIssue {
  const isInput = kind === "slot_input";
  return {
    key: `node:${node.id}:${kind}`,
    index,
    label: `${node.config.label} ${isInput ? t.trace.slotInputSuffix : t.trace.slotOutputSuffix}`,
    kind,
    depth: 0,
    node,
    issueStatus: "pending",
    outputPreview: isInput ? t.trace.managerInputWaiting : t.trace.waitingNestedNodes,
    events: []
  };
}

function toIssueStatus(status?: WorkflowNodeRunStatus): "completed" | "in_progress" | "pending" {
  if (status === "running" || status === "waiting_approval") return "in_progress";
  if (status === "succeeded" || status === "skipped") return "completed";
  return "pending";
}

function toSlotOutputIssueStatus(nodeRun: WorkflowNodeRun): "completed" | "pending" {
  if (nodeRun.output !== undefined || nodeRun.status === "succeeded" || nodeRun.status === "skipped") return "completed";
  return "pending";
}

function selectPreferredTraceIssue(issues: TraceIssue[]): TraceIssue | undefined {
  return (
    issues.find((issue) => issue.issueStatus === "in_progress" && issue.kind === "node" && issue.node?.type !== "manager") ??
    issues.find((issue) => issue.issueStatus === "in_progress" && issue.kind === "node") ??
    issues.find((issue) => issue.issueStatus === "in_progress") ??
    issues.find((issue) => issue.nodeRun) ??
    issues[0]
  );
}

function labelForIssueStatus(status: "completed" | "in_progress" | "pending", t: Messages): string {
  if (status === "completed") return t.trace.completed;
  if (status === "in_progress") return t.trace.inProgress;
  return t.trace.pending;
}

function summarizeOutput(output: unknown, t: Messages): string {
  const normalized = formatOutput(output ?? "");
  if (!normalized.trim()) return t.trace.noOutput;
  const flattened = normalized.replace(/\s+/g, " ").trim();
  return flattened.length > 88 ? `${flattened.slice(0, 85)}...` : flattened;
}

function getWorkflowNodeOrder(workflow?: WorkflowDefinition): WorkflowNode[] {
  if (!workflow) return [];

  const nodesById = new Map(workflow.nodes.map((node) => [node.id, node]));
  const indegree = new Map<string, number>(workflow.nodes.map((node) => [node.id, 0]));
  const outgoing = new Map<string, string[]>();

  for (const edge of workflow.edges) {
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
  }

  const queue = workflow.nodes.filter((node) => (indegree.get(node.id) ?? 0) === 0).map((node) => node.id);
  const ordered: WorkflowNode[] = [];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const currentId = queue.shift();
    if (!currentId || visited.has(currentId)) continue;
    visited.add(currentId);
    const node = nodesById.get(currentId);
    if (node) ordered.push(node);

    for (const targetId of outgoing.get(currentId) ?? []) {
      const nextDegree = (indegree.get(targetId) ?? 1) - 1;
      indegree.set(targetId, nextDegree);
      if (nextDegree === 0) queue.push(targetId);
    }
  }

  for (const node of workflow.nodes) {
    if (!visited.has(node.id)) ordered.push(node);
  }

  return ordered;
}

function widgetTypeLabel(type: DashboardWidgetType, t: Messages): string {
  if (type === "recent_runs") return t.widgetTypes.runs;
  if (type === "pending_approvals") return t.widgetTypes.approvals;
  if (type === "runtime_overview") return t.common.realTime;
  if (type === "catalog_status") return t.widgetTypes.catalog;
  return t.widgetTypes.notes;
}

function workflowNameFor(workflows: WorkflowDefinition[], workflowId: string): string {
  return workflows.find((workflow) => workflow.id === workflowId)?.name ?? workflowId;
}

function companyMonogram(company: Pick<CompanyOverview, "logoLabel" | "name">): string {
  if (company.logoLabel?.trim()) return company.logoLabel.trim().slice(0, 2).toUpperCase();
  const parts = company.name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return parts
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase();
}

function formatOutput(output: unknown): string {
  if (typeof output === "string") return output;
  return JSON.stringify(output, null, 2);
}

function formatDateTime(value: string, language: Language): string {
  return new Date(value).toLocaleString(language);
}

function normalizeAgentId(value: string): string {
  const trimmed = value.trim().toLowerCase();
  return trimmed.replace(/[^a-z0-9_-]+/g, "-").replace(/^-+/g, "").replace(/-+$/g, "").slice(0, 64) || "main";
}

function joinPath(root: string, leaf: string): string {
  return `${root.replace(/[\\/]+$/, "")}\\${leaf.replace(/^[\\/]+/, "")}`;
}
