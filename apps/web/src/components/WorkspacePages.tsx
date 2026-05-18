import { useMemo, useState, type ReactNode } from "react";
import { Activity, BadgeCheck, BookOpenText, Clock3, Database, FolderKanban, MessageSquareText, PanelsTopLeft, Tag, Trash2 } from "lucide-react";
import type {
  CatalogSnapshot,
  DashboardWidget,
  DashboardWidgetType,
  PendingApprovalItem,
  RuntimeOverview,
  SavedView,
  WorkspaceDashboard,
  WorkspaceNote,
  WorkspaceTag,
  WorkflowDefinition,
  WorkflowRunStatus,
  WorkflowRunView
} from "@openclaw-cui/shared";
import { isCatalogStale } from "@openclaw-cui/shared";
import type { Language, Messages } from "../lib/i18n";
import { appSections, type AppSectionId } from "../lib/app-sections";

const runStatuses: WorkflowRunStatus[] = ["queued", "running", "succeeded", "failed", "cancelled", "waiting_approval"];

export function RunsPage({
  runs,
  workflows,
  selectedRunId,
  language,
  t,
  onSelectRun
}: {
  runs: WorkflowRunView[];
  workflows: WorkflowDefinition[];
  selectedRunId?: string;
  language: Language;
  t: Messages;
  onSelectRun: (runId: string) => void;
}) {
  const [workflowFilter, setWorkflowFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const filteredRuns = useMemo(() => {
    return runs.filter((runView) => {
      if (workflowFilter && runView.run.workflowId !== workflowFilter) return false;
      if (statusFilter && runView.run.status !== statusFilter) return false;
      return true;
    });
  }, [runs, statusFilter, workflowFilter]);

  const selectedRun = filteredRuns.find((runView) => runView.run.id === selectedRunId) ?? filteredRuns[0];

  return (
    <section className="page-grid page-grid-runs">
      <div className="content-card stack-card">
        <div className="card-toolbar">
          <div className="card-title-block">
            <h3>{t.pages.runs.title}</h3>
            <p>{t.metrics.runs(filteredRuns.length)}</p>
          </div>
          <div className="toolbar-cluster">
            <select value={workflowFilter} onChange={(event) => setWorkflowFilter(event.target.value)}>
              <option value="">{t.common.allWorkflows}</option>
              {workflows.map((workflow) => (
                <option key={workflow.id} value={workflow.id}>
                  {workflow.name}
                </option>
              ))}
            </select>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="">{t.common.allStatuses}</option>
              {runStatuses.map((status) => (
                <option key={status} value={status}>
                  {t.status[status]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="list-shell">
          {filteredRuns.length === 0 ? (
            <div className="empty-state page-empty">{t.empty.noRuns}</div>
          ) : (
            filteredRuns.map((runView) => (
              <button
                key={runView.run.id}
                type="button"
                className={`list-row card-list-row ${selectedRun?.run.id === runView.run.id ? "selected" : ""}`}
                onClick={() => onSelectRun(runView.run.id)}
              >
                <div className="list-row-main">
                  <strong>{workflowNameFor(workflows, runView.run.workflowId)}</strong>
                  <span>{runView.run.id}</span>
                </div>
                <div className="list-row-meta">
                  <span className={`status-pill status-${runView.run.status}`}>{t.status[runView.run.status]}</span>
                  <time>{formatDateTime(runView.run.startedAt, language)}</time>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      <div className="content-card stack-card">
        {selectedRun ? (
          <RunDetailCard runView={selectedRun} workflows={workflows} language={language} t={t} />
        ) : (
          <div className="empty-state page-empty">{t.empty.selectRun}</div>
        )}
      </div>
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
  return (
    <section className="page-grid">
      <div className="content-card stack-card">
        <div className="card-toolbar">
          <div className="card-title-block">
            <h3>{t.pages.approvals.title}</h3>
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
                  {t.navigation[item]}
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
            }}
          >
            <PanelsTopLeft size={16} />
            {t.actions.addSavedView}
          </button>
        </div>
      </div>

      <div className="content-card stack-card">
        <div className="list-shell">
          {(dashboard?.savedViews ?? []).length === 0 ? (
            <div className="empty-state page-empty">{t.empty.noSavedViews}</div>
          ) : (
            dashboard?.savedViews.map((view) => (
              <div key={view.id} className="feature-card">
                <div className="feature-card-header">
                  <div>
                    <strong>{view.name}</strong>
                    <p>{view.workflowId ? workflowNameFor(workflows, view.workflowId) : t.common.allWorkflows}</p>
                  </div>
                  <button type="button" className="icon-button" onClick={() => onRemoveView(view.id)}>
                    <Trash2 size={16} />
                  </button>
                </div>
                <div className="tag-row">
                  {Object.entries(view.filters).map(([key, value]) => (
                    <span key={key} className="tag-pill neutral">
                      {key === "section" ? `${t.fields.section}: ${t.navigation[value as AppSectionId] ?? value}` : `${key}: ${value}`}
                    </span>
                  ))}
                  {Object.keys(view.filters).length === 0 && <span className="tag-pill neutral">{t.common.allStatuses}</span>}
                </div>
                <p className="supporting-copy">{formatDateTime(view.updatedAt, language)}</p>
              </div>
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
  runtime,
  language,
  t
}: {
  catalog?: CatalogSnapshot;
  runtime?: RuntimeOverview;
  language: Language;
  t: Messages;
}) {
  const stale = catalog ? isCatalogStale(catalog) : false;

  return (
    <section className="page-grid">
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

function RunDetailCard({
  runView,
  workflows,
  language,
  t
}: {
  runView: WorkflowRunView;
  workflows: WorkflowDefinition[];
  language: Language;
  t: Messages;
}) {
  return (
    <div className="stack-card">
      <div className="feature-card-header detail-header">
        <div>
          <h3>{workflowNameFor(workflows, runView.run.workflowId)}</h3>
          <p>{runView.run.id}</p>
        </div>
        <span className={`status-pill status-${runView.run.status}`}>{t.status[runView.run.status]}</span>
      </div>
      <dl className="meta-grid">
        <dt>{t.fields.updatedAt}</dt>
        <dd>{formatDateTime(runView.run.startedAt, language)}</dd>
        <dt>{t.fields.status}</dt>
        <dd>{t.status[runView.run.status]}</dd>
        <dt>{t.fields.relatedWorkflow}</dt>
        <dd>{runView.run.workflowId}</dd>
      </dl>
      <div className="metric-strip">
        <div className="metric-chip">
          <Activity size={16} />
          <span>{t.metrics.nodes(runView.nodeRuns.length)}</span>
        </div>
        <div className="metric-chip">
          <Database size={16} />
          <span>{t.metrics.tokens(runView.run.totalInputTokens + runView.run.totalOutputTokens)}</span>
        </div>
        <div className="metric-chip">
          <Database size={16} />
          <span>{t.metrics.cost(`$${runView.run.totalCostUsd.toFixed(6)}`)}</span>
        </div>
      </div>
      <div className="subsection">
        <h4>Events</h4>
        <div className="event-list">
          {runView.events.slice().reverse().map((event) => (
            <div key={event.id} className="event-row">
              <time>{new Date(event.createdAt).toLocaleTimeString(language)}</time>
              <span>{event.message}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="subsection">
        <h4>Outputs</h4>
        <div className="node-output-list">
          {runView.nodeRuns.map((nodeRun) => (
            <div key={nodeRun.id} className="node-output-row">
              <div className="node-output-heading">
                <span>{nodeRun.nodeLabel}</span>
                <code>{t.status[nodeRun.status]}</code>
              </div>
              {nodeRun.output !== undefined && <pre>{formatOutput(nodeRun.output)}</pre>}
              {nodeRun.error && <pre className="node-output-error">{nodeRun.error}</pre>}
            </div>
          ))}
        </div>
      </div>
    </div>
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

function formatOutput(output: unknown): string {
  if (typeof output === "string") return output;
  return JSON.stringify(output, null, 2);
}

function formatDateTime(value: string, language: Language): string {
  return new Date(value).toLocaleString(language);
}
