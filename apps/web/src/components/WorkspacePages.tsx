import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Activity,
  ArrowLeft,
  BadgeCheck,
  ChevronRight,
  Clock3,
  Database,
  FolderKanban,
  KeyRound,
  Loader2,
  MessageSquareText,
  PanelsTopLeft,
  RefreshCw,
  Search,
  Trash2
} from "lucide-react";
import type {
  CatalogSnapshot,
  ConfigureOpenClawChannelRequest,
  ConfigureOpenClawModelAuthRequest,
  OpenClawChannelSetupOption,
  OpenClawConfigWizardMetadata,
  OpenClawConfigState,
  OpenClawModelUsageSummary,
  OpenClawWizardField,
  OpenClawWizardValue,
  CompanyOverview,
  DashboardWidget,
  DashboardWidgetType,
  PendingApprovalItem,
  RuntimeOverview,
  WorkspaceDashboard,
  BlueprintDefinition,
  BlueprintNode,
  BlueprintNodeEvent,
  BlueprintNodeRun,
  BlueprintNodeRunStatus,
  BlueprintRunStatus,
  BlueprintRunView
} from "@hiveward/shared";
import type { Language, Messages } from "../lib/i18n";

type TraceIssueStatus = "completed" | "in_progress" | "pending" | "failed";
type IdentityKind = "model" | "agent" | "channel" | "provider";

type IdentitySpec = {
  key: string;
  label: string;
  initials: string;
  logoUrl?: string;
};

const OPENAI_PRODUCT_ICON =
  "https://images.ctfassets.net/j22is2dtoxu1/intercom-img-d177d076c9a5453052925143/49d5d812b0a6fcc20a14faa8c629d9fb/icon-ios-1024_401x.png";
const OPENCLAW_ICON = "/favicon.svg";

function lobeIcon(name: string): string {
  return `https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@latest/icons/${name}.svg`;
}

function simpleIcon(name: string): string {
  return `https://cdn.simpleicons.org/${name}`;
}

const KNOWN_IDENTITIES: Record<string, { label: string; initials: string; logoUrl?: string }> = {
  anthropic: { label: "Anthropic", initials: "A", logoUrl: lobeIcon("claude-color") },
  arcee: { label: "Arcee", initials: "AR", logoUrl: lobeIcon("arcee-color") },
  baidu: { label: "Baidu", initials: "BD", logoUrl: lobeIcon("baidu-color") },
  byteplus: { label: "BytePlus", initials: "BP", logoUrl: lobeIcon("bytedance-color") },
  cerebras: { label: "Cerebras", initials: "CB", logoUrl: lobeIcon("cerebras-color") },
  chutes: { label: "Chutes", initials: "CH", logoUrl: OPENCLAW_ICON },
  clickclack: { label: "ClickClack", initials: "CC", logoUrl: OPENCLAW_ICON },
  cloudflare: { label: "Cloudflare", initials: "CF", logoUrl: lobeIcon("cloudflare-color") },
  codex: { label: "Codex", initials: "CX", logoUrl: lobeIcon("codex-color") },
  deepseek: { label: "DeepSeek", initials: "DS", logoUrl: "https://cdn.deepseek.com/chat/icon.png" },
  deepinfra: { label: "DeepInfra", initials: "DI", logoUrl: lobeIcon("deepinfra-color") },
  discord: { label: "Discord", initials: "D", logoUrl: simpleIcon("discord") },
  feishu: { label: "Feishu", initials: "FS", logoUrl: "https://www.larksuite.com/favicon.ico" },
  fireworks: { label: "Fireworks", initials: "FW", logoUrl: lobeIcon("fireworks-color") },
  github: { label: "GitHub", initials: "GH", logoUrl: simpleIcon("github") },
  "github-copilot": { label: "GitHub Copilot", initials: "GC", logoUrl: lobeIcon("githubcopilot") },
  google: { label: "Google", initials: "G", logoUrl: lobeIcon("google-color") },
  "google-chat": {
    label: "Google Chat",
    initials: "GC",
    logoUrl: "https://fonts.gstatic.com/s/i/productlogos/chat_2020q4/v1/web-64dp/logo_chat_2020q4_color_2x_web_64dp.png"
  },
  "google-vertex": { label: "Google Vertex AI", initials: "GV", logoUrl: lobeIcon("vertexai-color") },
  groq: { label: "Groq", initials: "GQ", logoUrl: lobeIcon("groq") },
  huggingface: { label: "Hugging Face", initials: "HF", logoUrl: lobeIcon("huggingface-color") },
  imessage: { label: "iMessage", initials: "IM", logoUrl: simpleIcon("imessage") },
  irc: { label: "IRC", initials: "IR", logoUrl: simpleIcon("liberadotchat") },
  kilocode: { label: "Kilo Code", initials: "KC", logoUrl: lobeIcon("kilocode") },
  line: { label: "LINE", initials: "LN", logoUrl: "https://line.me/static/img/apple-touch-icon-180x180.png" },
  litellm: { label: "LiteLLM", initials: "LL", logoUrl: "https://docs.litellm.ai/img/favicon.ico" },
  lmstudio: { label: "LM Studio", initials: "LM", logoUrl: lobeIcon("lmstudio") },
  matrix: { label: "Matrix", initials: "MX", logoUrl: "https://matrix.org/assets/favicon.svg" },
  mattermost: { label: "Mattermost", initials: "MM", logoUrl: simpleIcon("mattermost") },
  "microsoft-teams": {
    label: "Microsoft Teams",
    initials: "MT",
    logoUrl: "https://static2.sharepointonline.com/files/fabric/assets/brand-icons/product/svg/teams_48x1.svg"
  },
  "microsoft-foundry": { label: "Microsoft Foundry", initials: "MF", logoUrl: lobeIcon("microsoft-color") },
  minimax: { label: "MiniMax", initials: "MM", logoUrl: "/brand/minimax.svg" },
  mistral: { label: "Mistral AI", initials: "MI", logoUrl: lobeIcon("mistral-color") },
  moonshot: { label: "Moonshot", initials: "MS", logoUrl: lobeIcon("moonshot") },
  "nextcloud-talk": { label: "Nextcloud Talk", initials: "NT", logoUrl: simpleIcon("nextcloud") },
  nostr: { label: "Nostr", initials: "NO", logoUrl: "https://nostr.com/favicon.ico" },
  nvidia: { label: "NVIDIA", initials: "NV", logoUrl: lobeIcon("nvidia-color") },
  ollama: { label: "Ollama", initials: "OL", logoUrl: "https://ollama.com/public/ollama.png" },
  openai: { label: "OpenAI", initials: "OA", logoUrl: OPENAI_PRODUCT_ICON },
  "openai-codex": { label: "OpenAI Codex", initials: "OC", logoUrl: OPENAI_PRODUCT_ICON },
  opencode: { label: "OpenCode", initials: "OC", logoUrl: lobeIcon("opencode") },
  openrouter: { label: "OpenRouter", initials: "OR", logoUrl: lobeIcon("openrouter") },
  "qa-channel": { label: "QA Channel", initials: "QA", logoUrl: OPENCLAW_ICON },
  qianfan: { label: "Qianfan", initials: "QF", logoUrl: lobeIcon("baiducloud-color") },
  qq: { label: "QQ", initials: "QQ", logoUrl: simpleIcon("qq") },
  qwen: { label: "Qwen", initials: "QW", logoUrl: lobeIcon("qwen-color") },
  signal: { label: "Signal", initials: "SG", logoUrl: "https://signal.org/assets/images/favicon/favicon.svg" },
  sglang: {
    label: "SGLang",
    initials: "SG",
    logoUrl: "https://mintcdn.com/lmsysorg/iZdDMbLWP1BLEIzC/favicon.png?fit=max&auto=format&n=iZdDMbLWP1BLEIzC&q=85&s=5524ba9694253eabf4da70fafa1db208"
  },
  slack: { label: "Slack", initials: "SL", logoUrl: "https://slack.com/img/icons/app-256.png" },
  stepfun: { label: "StepFun", initials: "SF", logoUrl: lobeIcon("stepfun-color") },
  synology: { label: "Synology Chat", initials: "SY", logoUrl: simpleIcon("synology") },
  synthetic: { label: "Synthetic", initials: "SY", logoUrl: OPENCLAW_ICON },
  telegram: { label: "Telegram", initials: "TG", logoUrl: "https://telegram.org/img/website_icon.svg" },
  tencent: { label: "Tencent", initials: "TE", logoUrl: lobeIcon("tencent-color") },
  tlon: { label: "Tlon", initials: "TL", logoUrl: "https://tlon.io/favicon.ico" },
  together: { label: "Together AI", initials: "TO", logoUrl: lobeIcon("together-color") },
  twitch: { label: "Twitch", initials: "TW", logoUrl: simpleIcon("twitch") },
  venice: { label: "Venice AI", initials: "VE", logoUrl: lobeIcon("venice-color") },
  vercel: { label: "Vercel", initials: "VC", logoUrl: lobeIcon("vercel") },
  vllm: { label: "vLLM", initials: "VL", logoUrl: lobeIcon("vllm-color") },
  volcengine: { label: "Volcengine", initials: "VE", logoUrl: lobeIcon("volcengine-color") },
  whatsapp: { label: "WhatsApp", initials: "WA", logoUrl: "https://static.whatsapp.net/rsrc.php/y1/r/FJbTMJqMap7.svg" },
  xai: { label: "xAI", initials: "XA", logoUrl: lobeIcon("xai") },
  xiaomi: { label: "Xiaomi", initials: "MI", logoUrl: simpleIcon("xiaomi") },
  zai: { label: "ZAI", initials: "ZA", logoUrl: lobeIcon("zai") },
  zalo: { label: "Zalo", initials: "ZA", logoUrl: "https://stc-zaloprofile.zdn.vn/favicon.ico" },
  "zalo-user": { label: "Zalo User", initials: "ZU", logoUrl: "https://stc-zaloprofile.zdn.vn/favicon.ico" }
};

type TraceIssue = {
  key: string;
  index: number;
  label: string;
  kind: "node" | "slot_input" | "slot_output";
  depth: number;
  node?: BlueprintNode;
  nodeRun?: BlueprintNodeRun;
  issueStatus: TraceIssueStatus;
  statusLabel: string;
  outputPreview: string;
  outputBody?: string;
  events: BlueprintNodeEvent[];
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
          blueprints: "\u84dd\u56fe",
          runs: "\u4EFB\u52A1",
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
          blueprints: "Blueprints",
          runs: "Tasks",
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
              <CompanyStatCard label={copy.blueprints} value={selectedCompany.blueprintCount.toLocaleString(language)} />
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
                  <span>{`${copy.blueprints}: ${company.blueprintCount}`}</span>
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
  blueprints,
  blueprint,
  selectedRunId,
  language,
  t,
  onSelectBlueprint,
  onSelectRun
}: {
  runs: BlueprintRunView[];
  blueprints: BlueprintDefinition[];
  blueprint?: BlueprintDefinition;
  selectedRunId?: string;
  language: Language;
  t: Messages;
  onSelectBlueprint: (blueprintId: string) => void;
  onSelectRun: (runId: string) => void;
}) {
  const blueprintRuns = useMemo(
    () => (blueprint ? runs.filter((runView) => runView.run.blueprintId === blueprint.id) : []),
    [runs, blueprint]
  );
  const currentTasks = useMemo(() => blueprintRuns.filter((runView) => isActiveRunStatus(runView.run.status)), [blueprintRuns]);
  const taskOptions = currentTasks.length > 0 ? currentTasks : blueprintRuns;
  const activeRun = taskOptions.find((runView) => runView.run.id === selectedRunId) ?? taskOptions[0];
  const [activeIssueKey, setActiveIssueKey] = useState<string | undefined>();
  const orderedNodes = useMemo(() => getBlueprintNodeOrder(blueprint), [blueprint]);

  const issues = useMemo<TraceIssue[]>(() => {
    return buildTraceIssues(activeRun, blueprint, orderedNodes, t);
  }, [activeRun?.events, activeRun?.nodeRuns, orderedNodes, t, blueprint?.nodes]);

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
            <p>{currentTasks.length > 0 ? t.metrics.runs(currentTasks.length) : t.trace.description}</p>
          </div>
          <div className="toolbar-cluster trace-toolbar">
            <select value={blueprint?.id ?? ""} onChange={(event) => onSelectBlueprint(event.target.value)}>
              {blueprints.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <select value={activeRun?.run.id ?? ""} onChange={(event) => onSelectRun(event.target.value)} disabled={taskOptions.length === 0}>
              {taskOptions.length === 0 ? (
                <option value="">{t.empty.selectRun}</option>
              ) : (
                taskOptions.map((runView) => (
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
            {!blueprint ? (
              <div className="empty-state page-empty">{t.empty.selectBlueprint}</div>
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
                      <span className={`trace-status-chip trace-${issue.issueStatus}`}>{issue.statusLabel}</span>
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
                <h3>{t.trace.modelOutput}</h3>
              </div>
              <div className="trace-output-stream">
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
  onApprove: (blueprintRunId: string) => void;
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
                    <p>{approval.blueprintName}</p>
                  </div>
                  <span className="status-pill status-waiting_approval">{t.status.waiting_approval}</span>
                </div>
                <dl className="meta-grid">
                  <dt>{t.fields.relatedBlueprint}</dt>
                  <dd>{approval.blueprintName}</dd>
                  <dt>{t.fields.relatedRun}</dt>
                  <dd>{approval.blueprintRunId}</dd>
                  <dt>{t.fields.updatedAt}</dt>
                  <dd>{formatDateTime(approval.requestedAt, language)}</dd>
                </dl>
                {approval.approverHint && <p className="supporting-copy">{approval.approverHint}</p>}
                {approval.instructions && <pre className="inline-note">{approval.instructions}</pre>}
                <div className="card-actions">
                  <button type="button" className="primary-action" onClick={() => onApprove(approval.blueprintRunId)}>
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
  blueprints,
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
  blueprints: BlueprintDefinition[];
  runs: BlueprintRunView[];
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
    { icon: FolderKanban, label: t.metrics.blueprints(blueprints.length) },
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

export function ModelsPage({
  catalog,
  openClawConfig,
  wizard,
  language,
  t,
  busy,
  busyAction,
  runs,
  openClawModelUsage,
  onRefreshCatalog,
  onConfigureModelAuth,
  onSetDefaultModel
}: {
  catalog?: CatalogSnapshot;
  openClawConfig?: OpenClawConfigState;
  wizard?: OpenClawConfigWizardMetadata;
  language: Language;
  t: Messages;
  busy: boolean;
  busyAction?: string;
  runs: BlueprintRunView[];
  openClawModelUsage: OpenClawModelUsageSummary[];
  onRefreshCatalog: () => void;
  onConfigureModelAuth: (input: ConfigureOpenClawModelAuthRequest) => void;
  onSetDefaultModel: (modelId: string) => void;
}) {
  const [modelStep, setModelStep] = useState<"provider" | "method" | "details">("provider");
  const [providerSearch, setProviderSearch] = useState("");
  const [selectedProviderId, setSelectedProviderId] = useState("");
  const [selectedMethodId, setSelectedMethodId] = useState("");
  const [modelValues, setModelValues] = useState<Record<string, OpenClawWizardValue>>({});
  const modelCopy =
    language === "zh-CN"
      ? {
          configuredModels: "\u5df2\u914d\u7f6e\u6a21\u578b",
          usage: "\u7528\u91cf",
          calls: "\u8c03\u7528",
          tokens: "Token",
          cost: "\u8d39\u7528",
          recent7d: "\u6700\u8fd1 7 \u5929",
          setDefault: "\u8bbe\u4e3a\u9ed8\u8ba4"
        }
      : {
          configuredModels: "Configured models",
          usage: "Usage",
          calls: "Calls",
          tokens: "Tokens",
          cost: "Cost",
          recent7d: "Last 7 days",
          setDefault: "Set default"
        };

  const configuredModels = openClawConfig?.configuredModels ?? [];
  const usageByModel = useMemo(
    () => buildModelUsageIndex(runs, openClawModelUsage, openClawConfig?.defaultModelId),
    [openClawModelUsage, runs, openClawConfig?.defaultModelId]
  );
  const orderedConfiguredModels = useMemo(
    () =>
      [...configuredModels].sort((left, right) => {
        if (left.id === openClawConfig?.defaultModelId) return -1;
        if (right.id === openClawConfig?.defaultModelId) return 1;
        return left.label.localeCompare(right.label);
      }),
    [configuredModels, openClawConfig?.defaultModelId]
  );
  const wizardCopy =
    language === "zh-CN"
      ? {
          title: "\u914d\u7f6e\u6a21\u578b",
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
          title: "Configure model",
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
            <h3>{modelCopy.configuredModels}</h3>
          </div>
          <button type="button" title={t.actions.refreshCatalog} disabled={busy} onClick={onRefreshCatalog}>
            {busyAction === "refreshCatalog" ? <Loader2 className="spin" size={16} /> : <RefreshCw size={16} />}
            {t.actions.refreshCatalog}
          </button>
        </div>
        <div className="model-card-grid">
          {orderedConfiguredModels.length ? (
            orderedConfiguredModels.map((model) => {
              const isDefault = model.id === openClawConfig?.defaultModelId;
              const usage = modelUsageFor(model.id, usageByModel);
              const recentDays = recentModelUsageDays(usage, language);
              const recentTotal = summarizeRecentModelUsage(recentDays);
              const maxDailyTokens = Math.max(1, ...recentDays.map((day) => day.totalTokens));

              return (
                <article key={model.id} className={`model-card ${isDefault ? "default" : ""}`}>
                  <div className="model-card-head">
                    <IdentityTitle kind="model" id={model.provider} label={model.label} />
                    {isDefault && <span className="status-pill status-running">{t.common.defaultOption}</span>}
                  </div>
                  <div className="model-card-usage" aria-label={modelCopy.usage}>
                    <div className="model-usage-head">
                      <span>{modelCopy.recent7d}</span>
                      <strong>{`${formatCompactTokenValue(recentTotal.totalTokens)} ${modelCopy.tokens}`}</strong>
                    </div>
                    <div className="model-usage-chart">
                      {recentDays.map((day) => (
                        <div
                          key={day.dateKey}
                          className="model-usage-day"
                          title={`${day.fullLabel}: ${day.totalTokens.toLocaleString(language)} ${modelCopy.tokens}, $${day.costUsd.toFixed(4)}`}
                        >
                          <div className="model-usage-bar-track">
                            <span
                              className={`model-usage-bar ${day.totalTokens === 0 ? "empty" : ""}`}
                              style={{ height: `${modelUsageBarHeight(day.totalTokens, maxDailyTokens)}%` }}
                            />
                          </div>
                          <span className="model-usage-value">{formatCompactTokenValue(day.totalTokens)}</span>
                          <span className="model-usage-label">{day.label}</span>
                        </div>
                      ))}
                    </div>
                    <div className="model-usage-foot">
                      <span>{`${modelCopy.calls}: ${recentTotal.calls.toLocaleString(language)}`}</span>
                      <span>{`${modelCopy.cost}: $${recentTotal.costUsd.toFixed(4)}`}</span>
                    </div>
                  </div>
                  <div className="model-card-actions">
                    <button type="button" disabled={busy || isDefault} onClick={() => onSetDefaultModel(model.id)}>
                      {busyAction === `setOpenClawDefaultModel:${model.id}` && !isDefault ? <Loader2 className="spin" size={16} /> : <BadgeCheck size={16} />}
                      {isDefault ? t.common.defaultOption : modelCopy.setDefault}
                    </button>
                  </div>
                </article>
              );
            })
          ) : (
            <div className="empty-state page-empty">{t.empty.noCatalog}</div>
          )}
        </div>
      </div>

      <div className="content-card stack-card">
        <div className="card-toolbar">
          <div className="card-title-block">
            <h3>{wizardCopy.title}</h3>
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
                identityKind="provider"
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
                identityKind="provider"
                getIdentityId={() => selectedProvider.id}
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
          configuredAgents: "已配置 Agent"
        }
      : {
          configuredAgents: "Configured agents"
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
            <h3>{copy.configuredAgents}</h3>
          </div>
        </div>
        <div className="model-card-grid">
          {configuredAgents.length ? (
            configuredAgents.map((agent) => (
              <article key={agent.id} className={`model-card ${agent.isDefault ? "default" : ""}`}>
                <div className="model-card-head">
                  <IdentityTitle kind="agent" id={agent.id} label={agent.name ?? agent.id} />
                  {agent.isDefault && <span className="status-pill status-running">{t.common.defaultOption}</span>}
                </div>
                <div className="model-card-main">
                  <code>{agent.agentDir}</code>
                </div>
                <div className="model-card-meta">
                  <span>{`${t.fields.model}: ${agent.modelId ?? t.common.defaultModel}`}</span>
                  <span>{`${t.fields.workspace}: ${agent.workspace}`}</span>
                </div>
              </article>
            ))
          ) : (
            <div className="empty-state page-empty">{t.empty.noCatalog}</div>
          )}
        </div>
      </div>

      <div className="content-card stack-card">
        <div className="card-toolbar">
          <div className="card-title-block">
            <h3>{t.actions.addAgent}</h3>
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
    </section>
  );
}

export function SkillsPage({
  catalog,
  language,
  t
}: {
  catalog?: CatalogSnapshot;
  language: Language;
  t: Messages;
}) {
  const copy =
    language === "zh-CN"
      ? {
          source: "\u6570\u636e\u6e90",
          openclawCatalog: "OpenClaw \u76ee\u5f55",
          count: (value: number) => `${value.toLocaleString(language)} Skills`
        }
      : {
          source: "Source",
          openclawCatalog: "OpenClaw catalog",
          count: (value: number) => `${value.toLocaleString(language)} Skills`
        };
  const skills = catalog?.tools ?? [];

  return (
    <section className="page-grid">
      <div className="content-card stack-card">
        <div className="card-toolbar">
          <div className="card-title-block">
            <h3>{t.pages.skills?.title ?? "Skills"}</h3>
            <p>{t.pages.skills?.description ?? copy.openclawCatalog}</p>
          </div>
          <span className="status-pill status-running">{copy.count(skills.length)}</span>
        </div>

        <div className="model-card-grid">
          {skills.length ? (
            skills.map((skill) => (
              <article key={skill.id} className="model-card">
                <div className="model-card-head">
                  <div className="model-card-main">
                    <strong>{skill.label}</strong>
                    <code>{skill.id}</code>
                  </div>
                  <span className="status-pill status-succeeded">{skill.category || "Skill"}</span>
                </div>
                <div className="model-card-main">
                  <p>{skill.description || "-"}</p>
                </div>
                <div className="model-card-meta">
                  <span>{`${copy.source}: ${copy.openclawCatalog}`}</span>
                  <span>{`${t.fields.category}: ${skill.category || "-"}`}</span>
                </div>
              </article>
            ))
          ) : (
            <div className="empty-state page-empty">{t.empty.noSkills}</div>
          )}
        </div>
      </div>
    </section>
  );
}

export function SchedulePage({
  runtime,
  runs,
  approvals,
  blueprints,
  language,
  t
}: {
  runtime?: RuntimeOverview;
  runs: BlueprintRunView[];
  approvals: PendingApprovalItem[];
  blueprints: BlueprintDefinition[];
  language: Language;
  t: Messages;
}) {
  const copy =
    language === "zh-CN"
      ? {
          calendar: "\u65e5\u5386",
          records: "\u5f53\u5929\u8bb0\u5f55",
          active: "\u8fdb\u884c\u4e2d",
          blueprintTasks: "\u84dd\u56fe\u4efb\u52a1",
          inbox: "\u6536\u4ef6\u7bb1",
          selectedDate: "\u9009\u62e9\u65e5\u671f",
          noRecords: "\u8be5\u65e5\u671f\u6ca1\u6709\u76f8\u5173\u8bb0\u5f55\u3002",
          startedAt: "\u542f\u52a8\u65f6\u95f4"
        }
      : {
          calendar: "Calendar",
          records: "Records for the day",
          active: "In progress",
          blueprintTasks: "Blueprint tasks",
          inbox: "Inbox",
          selectedDate: "Selected date",
          noRecords: "No records for this date.",
          startedAt: "Started"
        };
  const [selectedDate, setSelectedDate] = useState(() => toDateInputValue(new Date()));
  const runtimeTasksForDay = useMemo(
    () => (runtime?.tasks ?? []).filter((task) => isSameLocalDate(task.updatedAt, selectedDate)),
    [runtime?.tasks, selectedDate]
  );
  const sessionsForDay = useMemo(
    () => (runtime?.sessions ?? []).filter((session) => isSameLocalDate(session.updatedAt, selectedDate)),
    [runtime?.sessions, selectedDate]
  );
  const blueprintTasksForDay = useMemo(
    () =>
      runs.filter(
        (runView) =>
          isSameLocalDate(runView.run.startedAt, selectedDate) ||
          (runView.run.endedAt ? isSameLocalDate(runView.run.endedAt, selectedDate) : false)
      ),
    [runs, selectedDate]
  );
  const inboxForDay = useMemo(
    () => approvals.filter((approval) => isSameLocalDate(approval.requestedAt, selectedDate)),
    [approvals, selectedDate]
  );
  const activeTasks =
    runtimeTasksForDay.filter((task) => task.status === "queued" || task.status === "running").length +
    blueprintTasksForDay.filter((runView) => isActiveRunStatus(runView.run.status)).length;
  const totalRecords = runtimeTasksForDay.length + sessionsForDay.length + blueprintTasksForDay.length + inboxForDay.length;

  return (
    <section className="page-grid">
      <div className="content-card stack-card">
        <div className="card-toolbar">
          <div className="card-title-block">
            <h3>{copy.calendar}</h3>
            <p>{copy.records}</p>
          </div>
          <label className="date-picker-field">
            <span>{copy.selectedDate}</span>
            <input type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value || toDateInputValue(new Date()))} />
          </label>
        </div>
        <div className="metric-strip">
          <div className="metric-chip">
            <Clock3 size={16} />
            <span>{formatDateLabel(selectedDate, language)}</span>
          </div>
          <div className="metric-chip">
            <Clock3 size={16} />
            <span>{`${copy.records}: ${totalRecords}`}</span>
          </div>
          <div className="metric-chip">
            <Activity size={16} />
            <span>{`${copy.active}: ${activeTasks}`}</span>
          </div>
        </div>
      </div>

      <section className="card-grid data-card-grid">
        <TableCard title={copy.blueprintTasks} rows={blueprintTasksForDay.length}>
          {blueprintTasksForDay.length ? (
            blueprintTasksForDay.map((runView) => (
              <div key={runView.run.id} className="table-row">
                <div>
                  <strong>{blueprintNameFor(blueprints, runView.run.blueprintId)}</strong>
                  <p>{runView.run.id}</p>
                </div>
                <div className="table-meta">
                  <span className={`status-pill status-${runView.run.status}`}>{t.status[runView.run.status]}</span>
                  <span>{`${copy.startedAt}: ${formatDateTime(runView.run.startedAt, language)}`}</span>
                </div>
              </div>
            ))
          ) : (
            <div className="empty-state page-empty">{copy.noRecords}</div>
          )}
        </TableCard>

        <TableCard title={t.tables.tasks} rows={runtimeTasksForDay.length}>
          {runtimeTasksForDay.length ? (
            runtimeTasksForDay.map((task) => (
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
            <div className="empty-state page-empty">{copy.noRecords}</div>
          )}
        </TableCard>

        <TableCard title={copy.inbox} rows={inboxForDay.length}>
          {inboxForDay.length ? (
            inboxForDay.map((approval) => (
              <div key={approval.nodeRunId} className="table-row">
                <div>
                  <strong>{approval.nodeLabel}</strong>
                  <p>{approval.blueprintName}</p>
                </div>
                <div className="table-meta">
                  <span className="status-pill status-waiting_approval">{t.status.waiting_approval}</span>
                  <span>{formatDateTime(approval.requestedAt, language)}</span>
                </div>
              </div>
            ))
          ) : (
            <div className="empty-state page-empty">{t.empty.noApprovals}</div>
          )}
        </TableCard>

        <TableCard title={t.tables.sessions} rows={sessionsForDay.length}>
          {sessionsForDay.length ? (
            sessionsForDay.map((session) => (
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
            <div className="empty-state page-empty">{copy.noRecords}</div>
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
          enabled: "已启用",
          disabled: "已停用"
        }
      : {
          enabled: "Enabled",
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
          credentialKeys: "凭据字段"
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
          credentialKeys: "Credential keys"
        };
  const wizardCopy =
    language === "zh-CN"
      ? {
          title: "\u6309 CLI \u8def\u5f84\u6dfb\u52a0\u9891\u9053",
          channelStep: "\u9891\u9053",
          detailsStep: "\u914d\u7f6e\u9009\u9879",
          search: "\u641c\u7d22",
          configure: "\u5199\u5165\u914d\u7f6e",
          back: "\u8fd4\u56de",
          empty: "\u672a\u52a0\u8f7d OpenClaw \u9891\u9053\u5411\u5bfc\u5143\u6570\u636e"
        }
      : {
          title: "Add channel through the CLI path",
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
            <h3>{configCopy.configuredChannels}</h3>
          </div>
        </div>
        <div className="model-card-grid">
          {configuredChannels.length ? (
            configuredChannels.flatMap((channel) =>
              channel.accounts.map((account) => (
                <article key={`${channel.id}:${account.id}`} className={`model-card ${account.isDefault ? "default" : ""}`}>
                  <div className="model-card-head">
                    <IdentityTitle kind="channel" id={channel.id} label={account.name ?? `${channel.label} / ${account.id}`} />
                    <span className={`status-pill ${account.enabled && channel.enabled ? "status-succeeded" : "status-cancelled"}`}>
                      {account.enabled && channel.enabled ? copy.enabled : copy.disabled}
                    </span>
                  </div>
                  <div className="model-card-main">
                    <code>{`${channel.id}:${account.id}`}</code>
                  </div>
                  <div className="model-card-meta">
                    <span>{account.isDefault ? configCopy.defaultAccount : `${configCopy.account}: ${account.id}`}</span>
                    <span>{`${configCopy.credentialKeys}: ${account.credentialKeys.length ? account.credentialKeys.join(", ") : "-"}`}</span>
                  </div>
                </article>
              ))
            )
          ) : (
            <div className="empty-state page-empty">{t.empty.noCatalog}</div>
          )}
        </div>
      </div>

      <div className="content-card stack-card">
        <div className="card-toolbar">
          <div className="card-title-block">
            <h3>{wizardCopy.title}</h3>
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
                identityKind="channel"
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
  runs: BlueprintRunView[];
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
              <span>{approval.blueprintName}</span>
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

function IdentityTitle({ kind, id, label }: { kind: IdentityKind; id: string; label: string }) {
  return (
    <div className="identity-title">
      <IdentityMark kind={kind} id={id} label={label} />
      <strong>{label}</strong>
    </div>
  );
}

function IdentityMark({ kind, id, label }: { kind: IdentityKind; id: string; label: string }) {
  const identity = identitySpecFor(kind, id, label);
  const [logoFailed, setLogoFailed] = useState(false);
  useEffect(() => setLogoFailed(false), [identity.logoUrl]);
  const hasLogo = Boolean(identity.logoUrl && !logoFailed);
  return (
    <span
      className={`identity-mark identity-${kind} identity-${identity.key} ${hasLogo ? "identity-has-logo" : "identity-avatar"}`}
      title={identity.label}
      aria-label={identity.label}
    >
      {hasLogo ? (
        <img
          src={identity.logoUrl}
          alt=""
          aria-hidden="true"
          onError={(event) => {
            event.currentTarget.style.display = "none";
            setLogoFailed(true);
          }}
        />
      ) : (
        <span className="identity-initials" aria-hidden="true">
          {identity.initials}
        </span>
      )}
    </span>
  );
}

function identitySpecFor(kind: IdentityKind, id: string, label: string): IdentitySpec {
  if (kind === "agent") {
    return {
      key: sanitizeIdentityKey(id || label),
      label,
      initials: initialsFor(label || id, "AG")
    };
  }

  const normalized = normalizeIdentityKey(id || label);
  const known = KNOWN_IDENTITIES[normalized] ?? KNOWN_IDENTITIES[normalized.replace(/_/g, "-")];
  if (known) {
    return {
      key: sanitizeIdentityKey(normalized),
      label: known.label,
      initials: known.initials,
      logoUrl: known.logoUrl
    };
  }

  return {
    key: sanitizeIdentityKey(normalized || label),
    label: label || id,
    initials: initialsFor(label || id, kind === "channel" ? "CH" : "AI")
  };
}

function normalizeIdentityKey(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/\\/g, "/")
    .split("/")
    .find(Boolean) ?? value.trim().toLowerCase();

  const compact = normalized.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (compact.includes("openai")) return "openai";
  if (compact.includes("codex")) return "openai";
  if (compact.includes("deepseek")) return "deepseek";
  if (compact.includes("minimax")) return "minimax";
  if (compact.includes("claude") || compact.includes("anthropic")) return "anthropic";
  if (compact.includes("feishu") || compact.includes("lark")) return "feishu";
  if (compact.includes("google-chat") || compact.includes("googlechat")) return "google-chat";
  if (compact.includes("mattermost")) return "mattermost";
  if (compact.includes("nostr")) return "nostr";
  if (compact.includes("tlon")) return "tlon";
  if (compact.includes("whatsapp") || compact.includes("whats-app")) return "whatsapp";
  if (compact.includes("zalo-user") || compact.includes("zalouser")) return "zalo-user";
  if (compact.includes("zalo")) return "zalo";
  if (compact.includes("microsoft-teams") || compact.includes("teams")) return "microsoft-teams";
  if (compact.includes("nextcloud")) return "nextcloud-talk";
  if (compact.includes("qa-channel")) return "qa-channel";
  if (compact.includes("synology")) return "synology";
  if (compact.includes("qq")) return "qq";
  return compact;
}

function sanitizeIdentityKey(value: string): string {
  return normalizeIdentityKey(value).replace(/[^a-z0-9_-]/g, "-") || "generic";
}

function initialsFor(value: string, fallback: string): string {
  const clean = value.trim().replace(/[_/\\.-]+/g, " ");
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
  return (parts[0]?.slice(0, 2) || fallback).toUpperCase();
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
  identityKind,
  getIdentityId,
  onSelect
}: {
  options: T[];
  selectedId?: string;
  emptyText: string;
  identityKind?: IdentityKind;
  getIdentityId?: (option: T) => string;
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
          {identityKind && <IdentityMark kind={identityKind} id={getIdentityId?.(option) ?? option.id} label={option.label} />}
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
  activeRun: BlueprintRunView | undefined,
  blueprint: BlueprintDefinition | undefined,
  orderedNodes: BlueprintNode[],
  t: Messages
): TraceIssue[] {
  if (!activeRun?.nodeRuns.length) {
    return buildPendingTraceIssues(blueprint, orderedNodes, t);
  }

  const nodesById = new Map((blueprint?.nodes ?? []).map((node) => [node.id, node]));
  const childrenBySlotId = new Map<string, Set<string>>();
  for (const node of blueprint?.nodes ?? []) {
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
    const slotInputStatus = nodeRun.startedAt ? "completed" : toIssueStatus(nodeRun.status);
    issues.push({
      key: `${nodeRun.id}:input`,
      index: issueIndex,
      label: `${slotLabel} ${t.trace.slotInputSuffix}`,
      kind: "slot_input",
      depth: 0,
      node,
      nodeRun,
      issueStatus: slotInputStatus,
      statusLabel: nodeRun.startedAt ? t.trace.completed : statusLabelForNodeRun(nodeRun.status, t),
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

    const slotOutputStatus = toSlotOutputIssueStatus(nodeRun);
    issues.push({
      key: `${nodeRun.id}:output`,
      index: issueIndex,
      label: `${slotLabel} ${t.trace.slotOutputSuffix}`,
      kind: "slot_output",
      depth: 0,
      node,
      nodeRun,
      issueStatus: slotOutputStatus,
      statusLabel: labelForIssueStatus(slotOutputStatus, t),
      outputPreview: nodeRun.output === undefined ? t.trace.waitingNestedNodes : summarizeOutput(nodeRun.output, t),
      events: slotEvents
    });
    issueIndex += 1;
    runIndex = childRunIndex - 1;
  }

  return issues;
}

function buildPendingTraceIssues(blueprint: BlueprintDefinition | undefined, orderedNodes: BlueprintNode[], t: Messages): TraceIssue[] {
  if (!blueprint) return [];

  const childrenBySlotId = new Map<string, BlueprintNode[]>();
  for (const node of blueprint.nodes) {
    if (!node.parentId) continue;
    const parent = blueprint.nodes.find((candidate) => candidate.id === node.parentId);
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
  activeRun: BlueprintRunView,
  nodeRun: BlueprintNodeRun,
  node: BlueprintNode | undefined,
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
    statusLabel: statusLabelForNodeRun(nodeRun.status, t),
    outputPreview: summarizeOutput(nodeRun.output, t),
    events: activeRun.events.filter((event) => event.nodeRunId === nodeRun.id)
  };
}

function createPendingTraceIssue(node: BlueprintNode, index: number, depth: number, t: Messages): TraceIssue {
  return {
    key: `node:${node.id}`,
    index,
    label: node.config.label,
    kind: "node",
    depth,
    node,
    issueStatus: "pending",
    statusLabel: t.trace.pending,
    outputPreview: summarizeOutput(undefined, t),
    events: []
  };
}

function createPendingSlotBoundaryIssue(node: BlueprintNode, index: number, kind: "slot_input" | "slot_output", t: Messages): TraceIssue {
  const isInput = kind === "slot_input";
  return {
    key: `node:${node.id}:${kind}`,
    index,
    label: `${node.config.label} ${isInput ? t.trace.slotInputSuffix : t.trace.slotOutputSuffix}`,
    kind,
    depth: 0,
    node,
    issueStatus: "pending",
    statusLabel: t.trace.pending,
    outputPreview: isInput ? t.trace.managerInputWaiting : t.trace.waitingNestedNodes,
    events: []
  };
}

function toIssueStatus(status?: BlueprintNodeRunStatus): TraceIssueStatus {
  if (status === "queued" || status === "running" || status === "waiting_approval") return "in_progress";
  if (status === "succeeded" || status === "skipped") return "completed";
  if (status === "failed" || status === "cancelled") return "failed";
  return "pending";
}

function toSlotOutputIssueStatus(nodeRun: BlueprintNodeRun): TraceIssueStatus {
  if (nodeRun.status === "failed" || nodeRun.status === "cancelled") return "failed";
  if (nodeRun.output !== undefined || nodeRun.status === "succeeded" || nodeRun.status === "skipped") return "completed";
  if (nodeRun.status === "queued" || nodeRun.status === "running" || nodeRun.status === "waiting_approval") return "in_progress";
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

function labelForIssueStatus(status: TraceIssueStatus, t: Messages): string {
  if (status === "completed") return t.trace.completed;
  if (status === "in_progress") return t.trace.inProgress;
  if (status === "failed") return t.status.failed;
  return t.trace.pending;
}

function statusLabelForNodeRun(status: BlueprintNodeRunStatus | undefined, t: Messages): string {
  return status ? t.status[status] : t.trace.pending;
}

function summarizeOutput(output: unknown, t: Messages): string {
  const normalized = formatOutput(output ?? "");
  if (!normalized.trim()) return t.trace.noOutput;
  const flattened = normalized.replace(/\s+/g, " ").trim();
  return flattened.length > 88 ? `${flattened.slice(0, 85)}...` : flattened;
}

function getBlueprintNodeOrder(blueprint?: BlueprintDefinition): BlueprintNode[] {
  if (!blueprint) return [];

  const nodesById = new Map(blueprint.nodes.map((node) => [node.id, node]));
  const indegree = new Map<string, number>(blueprint.nodes.map((node) => [node.id, 0]));
  const outgoing = new Map<string, string[]>();

  for (const edge of blueprint.edges) {
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
  }

  const queue = blueprint.nodes.filter((node) => (indegree.get(node.id) ?? 0) === 0).map((node) => node.id);
  const ordered: BlueprintNode[] = [];
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

  for (const node of blueprint.nodes) {
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

function blueprintNameFor(blueprints: BlueprintDefinition[], blueprintId: string): string {
  return blueprints.find((blueprint) => blueprint.id === blueprintId)?.name ?? blueprintId;
}

type ModelUsageSummary = {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  days: Map<string, ModelUsageDay>;
};

type ModelUsageDay = {
  dateKey: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
};

type ModelUsageDayView = ModelUsageDay & {
  label: string;
  fullLabel: string;
};

function createEmptyModelUsageSummary(): ModelUsageSummary {
  return {
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    days: new Map<string, ModelUsageDay>()
  };
}

function buildModelUsageIndex(
  runs: BlueprintRunView[],
  openClawUsage: OpenClawModelUsageSummary[],
  fallbackModelId?: string
): Map<string, ModelUsageSummary> {
  const usageByModel = new Map<string, ModelUsageSummary>();

  for (const usage of openClawUsage) {
    if (!usage.modelId) continue;
    const current = usageByModel.get(usage.modelId) ?? createEmptyModelUsageSummary();
    for (const day of usage.days) {
      addUsageFactToModelSummary(
        current,
        day.date,
        day.inputTokens,
        day.outputTokens,
        day.costUsd,
        day.calls,
        day.totalTokens
      );
    }
    usageByModel.set(usage.modelId, current);
  }

  for (const runView of runs) {
    let hasNodeUsage = false;
    for (const nodeRun of runView.nodeRuns) {
      const usage = nodeRun.usage;
      if (!usage?.modelId) continue;
      hasNodeUsage = true;
      const current = usageByModel.get(usage.modelId) ?? createEmptyModelUsageSummary();
      addUsageFactToModelSummary(current, usage.recordedAt, usage.inputTokens, usage.outputTokens, usage.costUsd);
      usageByModel.set(usage.modelId, current);
    }

    const totalTokens = runView.run.totalInputTokens + runView.run.totalOutputTokens;
    if (!hasNodeUsage && fallbackModelId && totalTokens > 0) {
      const current = usageByModel.get(fallbackModelId) ?? createEmptyModelUsageSummary();
      addUsageFactToModelSummary(
        current,
        runView.run.endedAt ?? runView.run.startedAt,
        runView.run.totalInputTokens,
        runView.run.totalOutputTokens,
        runView.run.totalCostUsd
      );
      usageByModel.set(fallbackModelId, current);
    }
  }

  return usageByModel;
}

function modelUsageFor(modelId: string, usageByModel: Map<string, ModelUsageSummary>): ModelUsageSummary {
  const direct = usageByModel.get(modelId);
  if (direct) return direct;

  const modelName = lastModelPathSegment(modelId);
  let summary: ModelUsageSummary | undefined;
  for (const [usageModelId, usage] of usageByModel) {
    if (usageModelId !== modelName && lastModelPathSegment(usageModelId) !== modelName) continue;
    summary ??= createEmptyModelUsageSummary();
    mergeModelUsageSummary(summary, usage);
  }

  return summary ?? createEmptyModelUsageSummary();
}

function addUsageFactToModelSummary(
  summary: ModelUsageSummary,
  recordedAt: string,
  inputTokens: number,
  outputTokens: number,
  costUsd: number,
  calls = 1,
  totalTokens = inputTokens + outputTokens
): void {
  summary.calls += calls;
  summary.inputTokens += inputTokens;
  summary.outputTokens += outputTokens;
  summary.costUsd += costUsd;

  const dateKey = toUsageDateKey(recordedAt);
  if (!dateKey) return;

  const currentDay = summary.days.get(dateKey) ?? {
    dateKey,
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    costUsd: 0
  };
  currentDay.calls += calls;
  currentDay.inputTokens += inputTokens;
  currentDay.outputTokens += outputTokens;
  currentDay.totalTokens += totalTokens;
  currentDay.costUsd += costUsd;
  summary.days.set(dateKey, currentDay);
}

function toUsageDateKey(recordedAt: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(recordedAt)) return recordedAt;
  return toDateInputValue(recordedAt);
}

function mergeModelUsageSummary(target: ModelUsageSummary, source: ModelUsageSummary): void {
  target.calls += source.calls;
  target.inputTokens += source.inputTokens;
  target.outputTokens += source.outputTokens;
  target.costUsd += source.costUsd;

  for (const [dateKey, sourceDay] of source.days) {
    const targetDay = target.days.get(dateKey) ?? {
      dateKey,
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      costUsd: 0
    };
    targetDay.calls += sourceDay.calls;
    targetDay.inputTokens += sourceDay.inputTokens;
    targetDay.outputTokens += sourceDay.outputTokens;
    targetDay.totalTokens += sourceDay.totalTokens;
    targetDay.costUsd += sourceDay.costUsd;
    target.days.set(dateKey, targetDay);
  }
}

function recentModelUsageDays(usage: ModelUsageSummary, language: Language): ModelUsageDayView[] {
  const today = new Date();
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(today);
    day.setDate(today.getDate() - (6 - index));
    const dateKey = toDateInputValue(day);
    const usageDay = usage.days.get(dateKey) ?? {
      dateKey,
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      costUsd: 0
    };
    return {
      ...usageDay,
      label: formatCompactDayLabel(dateKey, language),
      fullLabel: formatDateLabel(dateKey, language)
    };
  });
}

function summarizeRecentModelUsage(days: ModelUsageDay[]): ModelUsageDay {
  return days.reduce<ModelUsageDay>(
    (summary, day) => ({
      dateKey: summary.dateKey,
      calls: summary.calls + day.calls,
      inputTokens: summary.inputTokens + day.inputTokens,
      outputTokens: summary.outputTokens + day.outputTokens,
      totalTokens: summary.totalTokens + day.totalTokens,
      costUsd: summary.costUsd + day.costUsd
    }),
    {
      dateKey: "recent",
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      costUsd: 0
    }
  );
}

function modelUsageBarHeight(totalTokens: number, maxDailyTokens: number): number {
  if (totalTokens <= 0) return 3;
  return Math.max(16, Math.round((totalTokens / maxDailyTokens) * 100));
}

function formatCompactTokenValue(value: number): string {
  if (value >= 1_000_000) return `${trimFixed(value / 1_000_000, value >= 10_000_000 ? 1 : 2)}M`;
  if (value >= 1_000) return `${trimFixed(value / 1_000, value >= 10_000 ? 1 : 2)}K`;
  return Math.round(value).toLocaleString();
}

function trimFixed(value: number, digits: number): string {
  return value.toFixed(digits).replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1");
}

function lastModelPathSegment(modelId: string): string {
  return modelId.split("/").pop() ?? modelId;
}

function isActiveRunStatus(status: BlueprintRunStatus): boolean {
  return status === "queued" || status === "running" || status === "waiting_approval";
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
  if (typeof output === "string") {
    const trimmed = output.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        return JSON.stringify(JSON.parse(trimmed), null, 2);
      } catch {
        return output;
      }
    }
    return output;
  }
  return JSON.stringify(output, null, 2);
}

function isSameLocalDate(value: string, selectedDate: string): boolean {
  return toDateInputValue(value) === selectedDate;
}

function toDateInputValue(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return localDate.toISOString().slice(0, 10);
}

function formatDateLabel(value: string, language: Language): string {
  if (!value) return "-";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(language, { year: "numeric", month: "short", day: "numeric" });
}

function formatCompactDayLabel(value: string, language: Language): string {
  if (!value) return "-";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  if (language === "zh-CN") return `${date.getMonth() + 1}/${date.getDate()}`;
  return date.toLocaleDateString(language, { month: "numeric", day: "numeric" });
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
