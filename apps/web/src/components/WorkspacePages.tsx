import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Activity, BadgeCheck, BookOpenText, Bookmark, Clock3, Database, FolderKanban, Loader2, MessageSquareText, PanelsTopLeft, Tag, Trash2 } from "lucide-react";
import type {
  CatalogSnapshot,
  OpenClawConfigState,
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
          notes: "\u7B14\u8BB0",
          views: "\u89C6\u56FE",
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
          notes: "Notes",
          views: "Saved views",
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
                <CompanyDetailCard label={copy.views} value={selectedCompany.savedViewCount} />
                <CompanyDetailCard label={copy.notes} value={selectedCompany.noteCount} />
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
    return buildTraceIssues(activeRun, workflow, orderedNodes);
  }, [activeRun?.events, activeRun?.nodeRuns, orderedNodes, workflow?.nodes]);

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
            <h3>Flow Trace</h3>
            <p>Review issues in linear task order on the left, and read node output on the right.</p>
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
                <option value="">Select a run</option>
              ) : (
                workflowRuns.map((runView) => (
                  <option key={runView.run.id} value={runView.run.id}>
                    {`Run ${runView.run.id.slice(-6)} · ${formatDateTime(runView.run.startedAt, language)}`}
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
            <h3>Issue list</h3>
            {activeRun && <span className={`status-pill status-${activeRun.run.status}`}>{t.status[activeRun.run.status]}</span>}
          </div>
          <div className="trace-issue-list">
            {!workflow ? (
              <div className="empty-state page-empty">No workflow is selected.</div>
            ) : issues.length === 0 ? (
              <div className="empty-state page-empty">This workflow has no run history yet.</div>
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
                      <span className={`trace-status-chip trace-${issue.issueStatus}`}>{labelForIssueStatus(issue.issueStatus)}</span>
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
                  <h3>Model output</h3>
                  <p>{`Current issue: ${activeIssue.label}`}</p>
                </div>
              </div>
              <div className="trace-output-stream">
                <TraceBubble role="system" title="Flow started" body={activeRun ? formatDateTime(activeRun.run.startedAt, language) : "-"} />
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
                  <div className="empty-state compact-empty-state">This node has no output yet.</div>
                )}
                {activeRun?.run.endedAt && <TraceBubble role="system" title="Flow finished" body={formatDateTime(activeRun.run.endedAt, language)} />}
              </div>
            </>
          ) : (
            <div className="empty-state page-empty">This workflow has no run history yet.</div>
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
  const widgets = dashboard?.dashboardWidgets ?? [];
  const summary = [
    { icon: FolderKanban, label: t.metrics.workflows(workflows.length) },
    { icon: Activity, label: t.metrics.runs(runs.length) },
    { icon: Clock3, label: t.metrics.approvals(approvals.length) },
    { icon: BookOpenText, label: t.metrics.notes(dashboard?.notes.length ?? 0) }
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
            {(["recent_runs", "pending_approvals", "runtime_overview", "catalog_status", "notes"] as DashboardWidgetType[]).map((type) => (
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
            <h3>OpenClaw Quick Config</h3>
            <p>{openClawConfig ? openClawConfig.configPath : "Read and write OpenClaw config from ~/.openclaw/openclaw.json."}</p>
          </div>
        </div>

        <div className="card-grid quick-config-grid">
          <article className="feature-card">
            <div className="feature-card-header">
              <div>
                <strong>Default model</strong>
                <p>Writes to the active OpenClaw config and refreshes the catalog.</p>
              </div>
            </div>
            <div className="form-grid">
              <label className="field-span-full">
                <span>Primary model</span>
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
                <span>{openClawConfig?.defaultModelId ?? "No default model configured"}</span>
              </div>
              <div className="metric-chip">
                <Database size={16} />
                <span>{openClawConfig?.defaultWorkspace ?? "-"}</span>
              </div>
            </div>
            <div className="card-actions">
              <button type="button" className="primary-action" disabled={!selectedModelId || busy} onClick={() => onSaveDefaultModel(selectedModelId)}>
                {busy ? <Loader2 className="spin" size={16} /> : <Database size={16} />}
                Save model
              </button>
            </div>
          </article>

          <article className="feature-card">
            <div className="feature-card-header">
              <div>
                <strong>Add agent</strong>
                <p>Creates an OpenClaw agent entry using the same config fields as `openclaw agents add`.</p>
              </div>
            </div>
            <div className="form-grid">
              <label>
                <span>Agent name</span>
                <input value={agentName} onChange={(event) => setAgentName(event.target.value)} placeholder="researcher" />
              </label>
              <label>
                <span>Model</span>
                <select value={agentModelId} onChange={(event) => setAgentModelId(event.target.value)}>
                  <option value="">Use default model</option>
                  {(catalog?.models ?? []).map((model) => (
                    <option key={model.id} value={model.id}>
                      {`${model.label} (${model.id})`}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field-span-full">
                <span>Workspace</span>
                <input
                  value={agentWorkspace}
                  onChange={(event) => setAgentWorkspace(event.target.value)}
                  placeholder={openClawConfig?.defaultWorkspace ? `${openClawConfig.defaultWorkspace}\\<agent-id>` : "Leave blank to auto-generate"}
                />
              </label>
            </div>
            <div className="metric-strip compact-metric-strip">
              {(openClawConfig?.configuredAgents ?? []).slice(0, 3).map((agent) => (
                <div key={agent.id} className="metric-chip">
                  <FolderKanban size={16} />
                  <span>{`${agent.id} · ${agent.modelId ?? "default"}`}</span>
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
                Add agent
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
  orderedNodes: WorkflowNode[]
): TraceIssue[] {
  if (!activeRun?.nodeRuns.length) {
    return buildPendingTraceIssues(workflow, orderedNodes);
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
      issues.push(createNodeTraceIssue(activeRun, nodeRun, node, issueIndex, node?.parentId ? 1 : 0));
      issueIndex += 1;
      continue;
    }

    const slotLabel = nodeRun.nodeLabel || node.config.label || nodeRun.nodeId;
    const slotEvents = activeRun.events.filter((event) => event.nodeRunId === nodeRun.id);
    issues.push({
      key: `${nodeRun.id}:input`,
      index: issueIndex,
      label: `${slotLabel} input`,
      kind: "slot_input",
      depth: 0,
      node,
      nodeRun,
      issueStatus: nodeRun.startedAt ? "completed" : toIssueStatus(nodeRun.status),
      outputPreview: "Manager input entered this slot.",
      outputBody: "Manager handed work into this slot. The nested node outputs are shown between this input and the slot output.",
      events: slotEvents.filter((event) => event.type !== "node.run.completed")
    });
    issueIndex += 1;

    const childIds = childrenBySlotId.get(node.id) ?? new Set<string>();
    let childRunIndex = runIndex + 1;
    while (childRunIndex < activeRun.nodeRuns.length) {
      const childRun = activeRun.nodeRuns[childRunIndex]!;
      if (!childIds.has(childRun.nodeId)) break;
      const childNode = nodesById.get(childRun.nodeId);
      issues.push(createNodeTraceIssue(activeRun, childRun, childNode, issueIndex, 1));
      issueIndex += 1;
      childRunIndex += 1;
    }

    issues.push({
      key: `${nodeRun.id}:output`,
      index: issueIndex,
      label: `${slotLabel} output`,
      kind: "slot_output",
      depth: 0,
      node,
      nodeRun,
      issueStatus: toSlotOutputIssueStatus(nodeRun),
      outputPreview: nodeRun.output === undefined ? "Waiting for nested nodes to finish." : summarizeOutput(nodeRun.output),
      events: slotEvents
    });
    issueIndex += 1;
    runIndex = childRunIndex - 1;
  }

  return issues;
}

function buildPendingTraceIssues(workflow: WorkflowDefinition | undefined, orderedNodes: WorkflowNode[]): TraceIssue[] {
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
      issues.push(createPendingTraceIssue(node, issueIndex, 0));
      issueIndex += 1;
      continue;
    }

    issues.push(createPendingSlotBoundaryIssue(node, issueIndex, "slot_input"));
    issueIndex += 1;
    for (const child of childrenBySlotId.get(node.id) ?? []) {
      visited.add(child.id);
      issues.push(createPendingTraceIssue(child, issueIndex, 1));
      issueIndex += 1;
    }
    issues.push(createPendingSlotBoundaryIssue(node, issueIndex, "slot_output"));
    issueIndex += 1;
  }
  return issues;
}

function createNodeTraceIssue(
  activeRun: WorkflowRunView,
  nodeRun: WorkflowNodeRun,
  node: WorkflowNode | undefined,
  index: number,
  depth: number
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
    outputPreview: summarizeOutput(nodeRun.output),
    events: activeRun.events.filter((event) => event.nodeRunId === nodeRun.id)
  };
}

function createPendingTraceIssue(node: WorkflowNode, index: number, depth: number): TraceIssue {
  return {
    key: `node:${node.id}`,
    index,
    label: node.config.label,
    kind: "node",
    depth,
    node,
    issueStatus: "pending",
    outputPreview: summarizeOutput(undefined),
    events: []
  };
}

function createPendingSlotBoundaryIssue(node: WorkflowNode, index: number, kind: "slot_input" | "slot_output"): TraceIssue {
  const isInput = kind === "slot_input";
  return {
    key: `node:${node.id}:${kind}`,
    index,
    label: `${node.config.label} ${isInput ? "input" : "output"}`,
    kind,
    depth: 0,
    node,
    issueStatus: "pending",
    outputPreview: isInput ? "Waiting for manager input." : "Waiting for nested nodes to finish.",
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

function labelForIssueStatus(status: "completed" | "in_progress" | "pending"): string {
  if (status === "completed") return "Completed";
  if (status === "in_progress") return "In progress";
  return "Pending";
}

function summarizeOutput(output: unknown): string {
  const normalized = formatOutput(output ?? "");
  if (!normalized.trim()) return "No output yet";
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
