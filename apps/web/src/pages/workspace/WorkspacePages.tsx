import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  Activity,
  ArrowLeft,
  BadgeCheck,
  Bot,
  BotMessageSquare,
  Check,
  ChevronRight,
  Clock3,
  Database,
  FolderKanban,
  KeyRound,
  LayoutTemplate,
  Loader2,
  MessageSquareText,
  PanelsTopLeft,
  Pencil,
  RefreshCw,
  Search,
  Send,
  Trash2,
  UserRound,
  X
} from "lucide-react";
import type {
  CatalogSnapshot,
  ConfigureOpenClawChannelRequest,
  ConfigureOpenClawModelAuthRequest,
  CompanyDirectoryResponse,
  CreateCompanyRequest,
  OpenClawChannelSetupOption,
  OpenClawConfigWizardMetadata,
  OpenClawConfigState,
  OpenClawModelUsageSummary,
  OpenClawWizardField,
  OpenClawWizardValue,
  CompanyOverview,
  DashboardWidget,
  DashboardWidgetType,
  HumanActionResponse,
  HumanActionQueueItem,
  ApprovalRequest,
  ApprovalThread,
  PendingApprovalItem,
  RuntimeOverview,
  UpdateCompanyRequest,
  WorkspaceDashboard,
  BlueprintKanbanBoard,
  BlueprintKanbanCard,
  BlueprintKanbanCardLane,
  BlueprintDefinition,
  BlueprintNode,
  BlueprintNodeEvent,
  BlueprintNodeRun,
  BlueprintRunStatus,
  BlueprintRunView,
  HumanActionRequestResponseIntent,
  HumanActionRequestSourceContextType
} from "@hiveward/shared";
import { humanActionRequestResponseIntents, humanActionRequestSourceContextTypes } from "@hiveward/shared";
import type { Language, Messages } from "../../lib/i18n";
import {
  isTerminalBlueprintRunStatus,
  readAcknowledgedTerminalRunIds,
  resolveBlueprintActivityState,
  resolveRunViewDisplayStatus,
  writeAcknowledgedTerminalRunIds
} from "../../lib/run-state";
import { buildRunRoomOutputMessagesForDisplay } from "../../lib/run-room-output-state";
import type { RunRoomOutputStreamState } from "../../lib/run-room-output-state";
import {
  blueprintKanbanCardIsNavigationOnly,
  blueprintKanbanLaneOrder,
  groupBlueprintKanbanCards,
  type BlueprintKanbanFilters
} from "../../lib/blueprint-kanban-state";
import { resolveApiResourceUrl } from "../../lib/api";
import { harnessLikeDisplayLabel } from "../../lib/harness-labels";
import { formatWorkspacePathPlaceholder, joinWorkspacePath } from "../../lib/workspace-path";
import { MarkdownRenderer } from "../../components/MarkdownRenderer";
import { RunRoomOutputView } from "../../components/RunRoomOutputView";
import { PageBody, PageHeader, PageShell } from "../../shared/ui";

type TraceIssueStatus = "completed" | "in_progress" | "pending" | "failed";
type IdentityKind = "model" | "agent" | "channel" | "provider";
type RunCommandFact = NonNullable<BlueprintRunView["runCommands"]>[number];
type RunCommandStepFact = NonNullable<BlueprintRunView["runCommandSteps"]>[number];
type RunExecutionSession = NonNullable<BlueprintRunView["nodeExecutionSessions"]>[number];
type RunPreflightMode = "research_resolution" | "requirement_resolution" | "revise_plan" | "preflight_judgment" | "context_snapshot";
type RunOutputTabKey = "current" | "artifacts" | "release";
type TraceActorKind = "manager" | "agent" | "user" | "system";

type IdentitySpec = {
  key: string;
  label: string;
  initials: string;
  logoUrl?: string;
};

function AddIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      className="lucide lucide-plus local-add-icon"
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </svg>
  );
}

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
  kind: "node" | "report" | "timeline" | "round_research" | "execution";
  actorKind: TraceActorKind;
  depth: number;
  node?: BlueprintNode;
  nodeRun?: BlueprintNodeRun;
  executionRow?: RunExecutionTraceRow;
  issueStatus: TraceIssueStatus;
  statusLabel: string;
  roundLabel?: string;
  roundTone?: number;
  roleTag: string;
  workTags: string[];
  timestamp?: string;
  outputPreview: string;
  outputBody?: string;
  events: BlueprintNodeEvent[];
};

type RunExecutionTraceRow = {
  key: string;
  command?: RunCommandFact;
  step?: RunCommandStepFact;
  session?: RunExecutionSession;
  node?: BlueprintNode;
  mode?: RunCommandStepFact["mode"];
  actorLabel: string;
  actorKind: TraceActorKind;
  status: string;
  startedAt?: string;
  endedAt?: string;
  createdAt: string;
  order: number;
  runtimeRefs: Array<NonNullable<RunCommandStepFact["runtimeRef"]>>;
};

export function CompanyDirectoryPage({
  companies,
  selectedCompanyId,
  language,
  busy,
  onEnterCompany,
  onCreateCompany,
  onUpdateCompany,
  onDeleteCompany
}: {
  companies: CompanyOverview[];
  selectedCompanyId?: string;
  language: Language;
  busy: boolean;
  onEnterCompany: (companyId: string) => void;
  onCreateCompany: (input: CreateCompanyRequest) => Promise<CompanyDirectoryResponse | undefined>;
  onUpdateCompany: (companyId: string, input: UpdateCompanyRequest) => Promise<CompanyDirectoryResponse | undefined>;
  onDeleteCompany: (companyId: string) => void;
}) {
  const [editingCompanyId, setEditingCompanyId] = useState<string | undefined>();
  const [renameValue, setRenameValue] = useState("");
  const copy =
    language === "zh-CN"
      ? {
          noCompanies: "\u5F53\u524D\u6CA1\u6709\u53EF\u7528\u516C\u53F8\u3002",
          active: "\u5F53\u524D\u516C\u53F8",
          switchTitle: "\u516C\u53F8\u5217\u8868",
          switchSubtitle: "\u9009\u62E9\u516C\u53F8\u540E\uff0c\u5176\u4ED6\u5DE5\u4F5C\u533A\u4F1A\u5207\u5230\u8BE5\u516C\u53F8\u7684\u6570\u636E\u8303\u56F4\u3002",
          addCompany: "\u6DFB\u52A0\u516C\u53F8",
          draftCompanyName: "\u65B0\u516C\u53F8",
          companyName: "\u516C\u53F8\u540D\u79F0",
          namePlaceholder: "\u8F93\u5165\u516C\u53F8\u540D\u79F0",
          renameTitle: "\u91CD\u547D\u540D\u516C\u53F8",
          rename: "\u6539\u540D",
          save: "\u4FDD\u5B58",
          cancel: "\u53D6\u6D88",
          enter: "\u8FDB\u5165\u516C\u53F8",
          delete: "\u5220\u9664\u516C\u53F8",
          deleteConfirm: (name: string) => `\u5220\u9664\u516C\u53F8\u201C${name}\u201D\u4F1A\u79FB\u9664\u8BE5\u516C\u53F8\u4E0B\u7684\u84DD\u56FE\u548C\u8FD0\u884C\u8BB0\u5F55\u3002\u786E\u8BA4\u5220\u9664\uFF1F`
        }
      : {
          noCompanies: "No companies are available.",
          active: "Current company",
          switchTitle: "Companies",
          switchSubtitle: "Choosing a company updates the scope for the rest of the workspace.",
          addCompany: "Add company",
          draftCompanyName: "New Company",
          companyName: "Company name",
          namePlaceholder: "Enter company name",
          renameTitle: "Rename company",
          rename: "Rename",
          save: "Save",
          cancel: "Cancel",
          enter: "Enter company",
          delete: "Delete company",
          deleteConfirm: (name: string) => `Deleting "${name}" removes its blueprints and run history. Delete this company?`
        };

  const editingCompany = editingCompanyId ? companies.find((company) => company.id === editingCompanyId) : undefined;
  const canRenameCompany = Boolean(editingCompanyId && renameValue.trim()) && !busy;

  useEffect(() => {
    if (!editingCompany) return;
    setRenameValue(editingCompany.name);
  }, [editingCompany]);

  const openRenameDialog = useCallback(
    (companyId: string, initialName?: string) => {
      const company = companies.find((item) => item.id === companyId);
      setEditingCompanyId(companyId);
      setRenameValue(initialName ?? company?.name ?? "");
    },
    [companies]
  );

  const closeRenameDialog = () => {
    setEditingCompanyId(undefined);
    setRenameValue("");
  };

  const createCompany = () => {
    if (busy) return;
    void onCreateCompany({ name: nextDraftCompanyName(companies, copy.draftCompanyName) }).then((directory) => {
      const companyId = directory?.selectedCompanyId;
      const company = directory?.companies.find((item) => item.id === companyId);
      if (companyId) openRenameDialog(companyId, company?.name);
    });
  };

  const submitRename = () => {
    const companyId = editingCompanyId;
    const name = renameValue.trim();
    if (!companyId || !name || busy) return;

    void onUpdateCompany(companyId, { name }).then((directory) => {
      if (directory) closeRenameDialog();
    });
  };

  const deleteCompany = (company: CompanyOverview) => {
    if (busy || !window.confirm(copy.deleteConfirm(company.name))) return;
    onDeleteCompany(company.id);
  };

  return (
    <section className="page-grid company-page-grid">
      <div className="company-directory-header">
        <div className="card-title-block">
          <h3>{copy.switchTitle}</h3>
          <p>{copy.switchSubtitle}</p>
        </div>
        <button
          type="button"
          className="primary-action"
          disabled={busy}
          onClick={createCompany}
        >
          {busy ? <Loader2 className="spin" size={16} /> : <AddIcon size={16} />}
          {copy.addCompany}
        </button>
      </div>

      <div className="content-card stack-card company-selector-card">
        {companies.length === 0 ? (
          <div className="empty-state page-empty">{copy.noCompanies}</div>
        ) : (
          <div className="company-list-grid">
            {companies.map((company) => (
              <article
                key={company.id}
                className={`company-list-card ${company.id === selectedCompanyId ? "selected" : ""}`}
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
                {company.id === selectedCompanyId && <span className="company-list-card-status">{copy.active}</span>}
                <div className="company-list-card-actions">
                  <button type="button" className="primary-action" onClick={() => onEnterCompany(company.id)} disabled={busy}>
                    <ChevronRight size={16} />
                    {copy.enter}
                  </button>
                  <button type="button" onClick={() => openRenameDialog(company.id)} disabled={busy}>
                    <Pencil size={16} />
                    {copy.rename}
                  </button>
                  <button type="button" className="danger-action" onClick={() => deleteCompany(company)} disabled={busy}>
                    <Trash2 size={16} />
                    {copy.delete}
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      {editingCompanyId && (
        <div className="node-modal-backdrop company-rename-backdrop" role="presentation" onMouseDown={closeRenameDialog}>
          <section
            className="node-modal company-rename-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="company-rename-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="node-modal-header">
              <div>
                <h3 id="company-rename-title">{copy.renameTitle}</h3>
                <p>{editingCompany?.name ?? copy.draftCompanyName}</p>
              </div>
              <button type="button" className="node-modal-close" onClick={closeRenameDialog} disabled={busy} aria-label={copy.cancel}>
                <X size={18} />
              </button>
            </div>
            <form
              className="node-modal-form company-rename-form"
              onSubmit={(event) => {
                event.preventDefault();
                submitRename();
              }}
            >
              <label>
                <span>{copy.companyName}</span>
                <input
                  autoFocus
                  value={renameValue}
                  onChange={(event) => setRenameValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") closeRenameDialog();
                  }}
                  placeholder={copy.namePlaceholder}
                />
              </label>
              <div className="node-modal-actions">
                <button type="button" onClick={closeRenameDialog} disabled={busy}>
                  {copy.cancel}
                </button>
                <button type="submit" className="primary-action" disabled={!canRenameCompany}>
                  {busy ? <Loader2 className="spin" size={16} /> : <Check size={16} />}
                  {copy.save}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </section>
  );
}

function nextDraftCompanyName(companies: CompanyOverview[], baseName: string): string {
  const used = new Set(companies.map((company) => company.name.trim()).filter(Boolean));
  if (!used.has(baseName)) return baseName;

  let index = 2;
  let candidate = `${baseName} ${index}`;
  while (used.has(candidate)) {
    index += 1;
    candidate = `${baseName} ${index}`;
  }
  return candidate;
}

export function CompanyPage({
  companies,
  selectedCompanyId,
  language
}: {
  companies: CompanyOverview[];
  selectedCompanyId?: string;
  language: Language;
}) {
  const copy =
    language === "zh-CN"
      ? {
          choose: "\u9009\u62E9\u516C\u53F8",
          noSelection: "\u5F53\u524D\u8FD8\u6CA1\u6709\u9009\u4E2D\u516C\u53F8\u3002\u8BF7\u5148\u4ECE\u5DE6\u4E0B\u89D2\u7684\u516C\u53F8\u5165\u53E3\u5207\u6362\u3002",
          noCompanies: "\u5F53\u524D\u6CA1\u6709\u53EF\u7528\u516C\u53F8\u3002"
        }
      : {
          choose: "Choose company",
          noSelection: "No company is selected yet. Use the company entry at the lower left to choose one first.",
          noCompanies: "No companies are available."
        };

  const selectedCompany = companies.find((company) => company.id === selectedCompanyId);

  return (
    <section className="page-grid company-page-grid">
      <div className="content-card stack-card company-hero-card">
        {selectedCompany ? (
          <div className="company-brand-poster" aria-label={selectedCompany.name}>
            <div className="company-brand-block">
              <div className="company-logo-large">
                {selectedCompany.logoUrl ? <img src={selectedCompany.logoUrl} alt={selectedCompany.name} /> : companyMonogram(selectedCompany)}
              </div>
              <div className="company-brand-copy">
                <h3>{selectedCompany.name}</h3>
                <p>{selectedCompany.businessGoal}</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="empty-state company-empty-state">
            <strong>{copy.choose}</strong>
            <span>{companies.length === 0 ? copy.noCompanies : copy.noSelection}</span>
          </div>
        )}
      </div>
    </section>
  );
}

export function RunsPage({
  runs,
  blueprints,
  blueprint,
  selectedRunId,
  runRoomOutputStreamState = "idle",
  language,
  t,
  onSelectBlueprint,
  onSelectRun,
  onSendRunInterjection
}: {
  runs: BlueprintRunView[];
  blueprints: BlueprintDefinition[];
  blueprint?: BlueprintDefinition;
  selectedRunId?: string;
  runRoomOutputStreamState?: RunRoomOutputStreamState;
  language: Language;
  t: Messages;
  onSelectBlueprint: (blueprintId: string) => void;
  onSelectRun: (runId: string) => void;
  onSendRunInterjection?: (runRoomId: string, messageMarkdown: string) => void;
}) {
  const blueprintRuns = useMemo(
    () =>
      blueprint
        ? runs
            .filter((runView) => runView.run.blueprintId === blueprint.id)
            .sort((left, right) => new Date(right.run.startedAt).getTime() - new Date(left.run.startedAt).getTime())
        : [],
    [runs, blueprint]
  );
  const activeRun = selectedRunId ? blueprintRuns.find((runView) => runView.run.id === selectedRunId) : undefined;
  const [activeIssueKey, setActiveIssueKey] = useState<string | undefined>();
  const [activeOutputTab, setActiveOutputTab] = useState<RunOutputTabKey>("current");
  const [blueprintPickerOpen, setBlueprintPickerOpen] = useState(false);
  const [runHistoryOpen, setRunHistoryOpen] = useState(false);
  const [runInterjectionDraft, setRunInterjectionDraft] = useState("");
  const [acknowledgedTerminalRunIds, setAcknowledgedTerminalRunIds] = useState<Set<string>>(() =>
    readAcknowledgedTerminalRunIds(getBrowserStorage())
  );
  const blueprintRunStats = useMemo(() => {
    const stats = new Map<string, { latestRunId?: string; latestStatus?: BlueprintRunStatus; latestRawStatus?: BlueprintRunStatus; lastUsedAt: number }>();
    for (const runView of runs) {
      const startedAt = toSafeTimestamp(runView.run.startedAt);
      const current = stats.get(runView.run.blueprintId);
      if (!current || startedAt >= current.lastUsedAt) {
        stats.set(runView.run.blueprintId, {
          latestRunId: runView.run.id,
          latestStatus: resolveRunViewDisplayStatus(runView),
          latestRawStatus: runView.run.status,
          lastUsedAt: startedAt
        });
      }
    }
    return stats;
  }, [runs]);
  const currentBlueprintRunStats = blueprint ? blueprintRunStats.get(blueprint.id) : undefined;

  const issues = useMemo<TraceIssue[]>(() => {
    return buildTraceIssues(activeRun, blueprint, t, language);
  }, [
    activeRun?.run.id,
    activeRun?.run.startedAt,
    activeRun?.runCommands,
    activeRun?.runCommandSteps,
    activeRun?.nodeExecutionSessions,
    activeRun?.run.status,
    t,
    language,
    blueprint?.nodes
  ]);

  const defaultActiveIssue = issues.find((issue) => issue.issueStatus === "in_progress") ?? issues.find(
    (issue) => issue.outputBody !== undefined || issue.nodeRun?.error
  ) ?? issues[0];
  const activeIssue = activeIssueKey ? issues.find((issue) => issue.key === activeIssueKey) : defaultActiveIssue;
  const activeRunRoomId = activeRun?.runRoomOutput?.runRoomId;
  const runRoomOutputMessages = useMemo(
    () => buildRunRoomOutputMessagesForDisplay(activeRun),
    [activeRun?.run.id, activeRun?.runRoomOutput, activeRun?.releaseReports]
  );
  const runRecordButtonLabel = language === "zh-CN" ? "选择记录" : "Run records";
  const runFrameState = traceRunFrameState(resolveRunViewDisplayStatus(activeRun));
  const reportLayerCopy = getRunReportLayerCopy(language);
  const latestReleaseReport = activeRun?.releaseReports?.at(-1);
  const artifacts = activeRun?.artifacts ?? [];
  const outputTabAriaLabel = language === "zh-CN" ? "运行输出标签" : "Run output tabs";
  const outputTabs: Array<{ key: RunOutputTabKey; label: string; badge?: string }> = [
    { key: "current", label: t.trace.modelOutput },
    { key: "artifacts", label: reportLayerCopy.artifactsTitle, badge: reportLayerCopy.count(artifacts.length) },
    { key: "release", label: reportLayerCopy.releaseTitle, badge: latestReleaseReport ? `v${latestReleaseReport.version}` : undefined }
  ];

  useEffect(() => {
    if (!activeIssueKey || issues.some((issue) => issue.key === activeIssueKey)) return;
    setActiveIssueKey(undefined);
  }, [activeIssueKey, issues]);

  useEffect(() => {
    setActiveOutputTab("current");
    setRunInterjectionDraft("");
  }, [activeRun?.run.id]);

  const sendRunInterjection = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const messageMarkdown = runInterjectionDraft.trim();
    if (!activeRunRoomId || !messageMarkdown || !onSendRunInterjection) return;
    onSendRunInterjection(activeRunRoomId, messageMarkdown);
    setRunInterjectionDraft("");
  }, [activeRunRoomId, onSendRunInterjection, runInterjectionDraft]);

  useEffect(() => {
    if (!activeRun || activeIssueKey || issues.length === 0) return;
    const firstIssueWithDetail = issues.find(
      (issue) => issue.outputBody !== undefined || issue.nodeRun?.error
    );
    setActiveIssueKey((firstIssueWithDetail ?? issues[0])?.key);
  }, [activeIssueKey, activeRun?.run.id, issues]);

  const acknowledgeTerminalRun = useCallback(
    (blueprintId: string) => {
      const stats = blueprintRunStats.get(blueprintId);
      if (!stats?.latestRunId || !isTerminalBlueprintRunStatus(stats.latestRawStatus)) return;
      setAcknowledgedTerminalRunIds((current) => {
        if (current.has(stats.latestRunId!)) return current;
        const next = new Set(current);
        next.add(stats.latestRunId!);
        return next;
      });
    },
    [blueprintRunStats]
  );

  useEffect(() => {
    if (!blueprint?.id) return;
    acknowledgeTerminalRun(blueprint.id);
  }, [acknowledgeTerminalRun, blueprint?.id, currentBlueprintRunStats?.latestRunId, currentBlueprintRunStats?.latestRawStatus]);

  useEffect(() => {
    writeAcknowledgedTerminalRunIds(getBrowserStorage(), acknowledgedTerminalRunIds);
  }, [acknowledgedTerminalRunIds]);

  useEffect(() => {
    if (runs.length === 0) return;
    const runIds = new Set(runs.map((runView) => runView.run.id));
    setAcknowledgedTerminalRunIds((current) => {
      const next = new Set([...current].filter((runId) => runIds.has(runId)));
      return next.size === current.size ? current : next;
    });
  }, [runs]);

  const selectBlueprintForRunPage = (blueprintId: string) => {
    acknowledgeTerminalRun(blueprintId);
    onSelectBlueprint(blueprintId);
    const latestRun = runs
      .filter((runView) => runView.run.blueprintId === blueprintId)
      .sort((left, right) => toSafeTimestamp(right.run.startedAt) - toSafeTimestamp(left.run.startedAt))[0];
    if (latestRun) {
      onSelectRun(latestRun.run.id);
    }
    setBlueprintPickerOpen(false);
    setRunHistoryOpen(false);
    setActiveIssueKey(undefined);
  };

  const selectRunHistoryItem = (runId: string) => {
    onSelectRun(runId);
    setRunHistoryOpen(false);
    setActiveIssueKey(undefined);
  };

  return (
    <section className="page-grid trace-page-grid runs-page-grid">
      <div className="trace-page-title">
        <h2>{t.navigation.runs}</h2>
        <div className="run-top-actions">
          <div className="run-picker-wrap">
            <button
              type="button"
              className="run-record-selector blueprint-selector-button"
              title={activeRun ? t.trace.runOption(activeRun.run.id, formatDateTime(activeRun.run.startedAt, language)) : runRecordButtonLabel}
              onClick={() => {
                setRunHistoryOpen((current) => !current);
                setBlueprintPickerOpen(false);
              }}
              disabled={!blueprint || blueprintRuns.length === 0}
            >
              <Clock3 size={16} />
              <span>{runRecordButtonLabel}</span>
            </button>
            {runHistoryOpen && (
              <div className="run-selection-panel run-history-panel">
                <div className="run-history-list">
                  {blueprintRuns.map((runView) => {
                    const selected = runView.run.id === activeRun?.run.id;
                    return (
                      <button
                        key={runView.run.id}
                        type="button"
                        className={`blueprint-card-button run-history-button${selected ? " selected" : ""}`}
                        onClick={() => selectRunHistoryItem(runView.run.id)}
                      >
                        <span className="blueprint-card-icon">
                          <Clock3 size={17} />
                        </span>
                        <strong>{t.trace.runOption(runView.run.id, formatDateTime(runView.run.startedAt, language))}</strong>
                        {selected && <Check className="blueprint-card-check" size={14} />}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          <div className="run-picker-wrap">
            <button
              type="button"
              className="run-blueprint-selector blueprint-selector-button"
              title={t.fields.blueprint}
              onClick={() => {
                setBlueprintPickerOpen((current) => !current);
                setRunHistoryOpen(false);
              }}
              disabled={blueprints.length === 0}
            >
              <LayoutTemplate size={16} />
              <span>{blueprint?.name ?? t.empty.selectBlueprint}</span>
            </button>
            {blueprintPickerOpen && (
              <div className="run-selection-panel run-blueprint-panel">
                <div className="run-blueprint-card-list blueprint-card-list">
                  {blueprints.length === 0 ? (
                    <div className="empty-state compact-empty-state">{t.empty.selectBlueprint}</div>
                  ) : (
                    blueprints.map((item) => {
                      const selected = item.id === blueprint?.id;
                      const stats = blueprintRunStats.get(item.id);
                      const terminalStatusSeen =
                        item.id === blueprint?.id || (stats?.latestRunId ? acknowledgedTerminalRunIds.has(stats.latestRunId) : false);
                      const activity = resolveBlueprintActivityState(stats?.latestStatus, terminalStatusSeen);
                      return (
                        <button
                          key={item.id}
                          type="button"
                          className={`blueprint-card-button blueprint-run-state-${activity}${selected ? " selected" : ""}`}
                          onClick={() => selectBlueprintForRunPage(item.id)}
                        >
                          <span className="blueprint-card-icon">
                            <LayoutTemplate size={17} />
                          </span>
                          <strong>{item.name}</strong>
                          {selected && <Check className="blueprint-card-check" size={14} />}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <section className="trace-layout">
        <div className="trace-column-shell">
          <div className="trace-column-header">
            <h3>{t.trace.issueList}</h3>
          </div>
          <div className={`content-card stack-card trace-issue-column trace-run-frame-${runFrameState}`}>
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
                    className={`trace-issue-card trace-issue-${issue.kind} trace-issue-depth-${issue.depth} ${issue.roundLabel ? "has-round-ribbon" : ""} ${activeIssue?.key === issue.key ? "selected" : ""}`}
                    onClick={() => {
                      setActiveIssueKey(issue.key);
                      setActiveOutputTab("current");
                    }}
                  >
                    {issue.roundLabel && (
                      <div className={`trace-round-ribbon trace-round-tone-${issue.roundTone ?? 1}`}>
                        {issue.roundLabel}
                      </div>
                    )}
                    <div className="trace-issue-main">
                      <div className="trace-issue-topline">
                        <div className="trace-actor-title">
                          <span className={`trace-role-icon trace-role-${issue.actorKind}`}>
                            {traceIssueIcon(issue.actorKind)}
                          </span>
                          <strong>{issue.label}</strong>
                        </div>
                        <span className={`trace-status-chip trace-${issue.issueStatus}`}>{issue.statusLabel}</span>
                      </div>
                      <MarkdownRenderer value={issue.outputPreview} className="trace-issue-preview" />
                      <div className="trace-issue-footer">
                        <div className="trace-work-tags">
                          <span className={`trace-role-tag trace-role-tag-${issue.actorKind}`}>{issue.roleTag}</span>
                          {issue.workTags.map((tag) => (
                            <span className={`trace-work-tag trace-work-tag-${workTagTone(tag)}`} key={tag}>{tag}</span>
                          ))}
                        </div>
                        {issue.timestamp && (
                          <time className="trace-issue-time" dateTime={issue.timestamp}>
                            {formatTraceTime(issue.timestamp, language)}
                          </time>
                        )}
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="trace-column-shell">
          <div className="trace-column-header">
            <h3>{t.trace.modelOutput}</h3>
          </div>
          <div className="content-card stack-card trace-output-column run-output-column" style={{ gridTemplateRows: "auto minmax(0, 1fr)" }}>
            <div className="run-output-tabs" role="tablist" aria-label={outputTabAriaLabel}>
              {outputTabs.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  aria-selected={activeOutputTab === tab.key}
                  className={`run-output-tab${activeOutputTab === tab.key ? " selected" : ""}`}
                  onClick={() => setActiveOutputTab(tab.key)}
                  disabled={!activeRun && tab.key !== "current"}
                >
                  <span>{tab.label}</span>
                  {tab.badge && <small>{tab.badge}</small>}
                </button>
              ))}
            </div>

            <div className="run-output-panel-stack">
              <section className="run-output-panel" role="tabpanel" hidden={activeOutputTab !== "current"}>
                {!blueprint ? (
                  <div className="empty-state page-empty">{t.empty.selectBlueprint}</div>
                ) : activeRun ? (
                  <div className="run-output-current-layout">
                    <RunRoomOutputView
                      messages={runRoomOutputMessages}
                      language={language}
                      streamState={runRoomOutputStreamState}
                      reportAvailable={Boolean(latestReleaseReport)}
                    />
                    <form
                      aria-label={language === "zh-CN" ? "RunRoom 管理消息" : "RunRoom manager interjection"}
                      onSubmit={sendRunInterjection}
                      className="run-interjection-form"
                    >
                      <textarea
                        aria-label={language === "zh-CN" ? "给 Manager 的消息" : "Message to manager"}
                        className="run-interjection-input"
                        disabled={!activeRunRoomId}
                        rows={2}
                        value={runInterjectionDraft}
                        onChange={(event) => setRunInterjectionDraft(event.currentTarget.value)}
                      />
                      <button
                        type="submit"
                        className="run-interjection-submit"
                        disabled={!activeRunRoomId || !onSendRunInterjection || runInterjectionDraft.trim().length === 0}
                      >
                        <Send size={16} />
                        <span>{language === "zh-CN" ? "发送" : "Send"}</span>
                      </button>
                    </form>
                  </div>
                ) : (
                  <div className="empty-state page-empty">{t.empty.noRunHistory}</div>
                )}
              </section>

              <section className="run-output-panel" role="tabpanel" hidden={activeOutputTab !== "artifacts"}>
                <div className="run-output-section">
                  <div className="run-output-section-header">
                    <div>
                      <h4>{reportLayerCopy.artifactsTitle}</h4>
                      <p>{reportLayerCopy.artifactsHint}</p>
                    </div>
                    <span className="status-pill status-default">{reportLayerCopy.count(artifacts.length)}</span>
                  </div>
                  {!blueprint ? (
                    <div className="empty-state page-empty">{t.empty.selectBlueprint}</div>
                  ) : !activeRun ? (
                    <div className="empty-state page-empty">{t.empty.noRunHistory}</div>
                  ) : artifacts.length === 0 ? (
                    <div className="empty-state compact-empty-state">{reportLayerCopy.noArtifacts}</div>
                  ) : (
                    <div className="run-artifact-list">
                      {artifacts.map((artifact) => (
                        <div className="run-artifact-row" key={artifact.id}>
                          <div>
                            <strong>{artifact.title ?? artifact.kind}</strong>
                            <span>{artifact.kind}{artifact.format ? ` · ${artifact.format}` : ""}</span>
                          </div>
                          {artifact.downloadUrl ? (
                            <a href={resolveArtifactDownloadUrl(artifact.downloadUrl)} rel="noreferrer" target="_blank">
                              {reportLayerCopy.openArtifact}
                            </a>
                          ) : (
                            <span>{formatArtifactLocation(artifact)}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </section>

              <section className="run-output-panel" role="tabpanel" hidden={activeOutputTab !== "release"}>
                <div className="run-output-section">
                  <div className="run-output-section-header">
                    <div>
                      <h4>{reportLayerCopy.releaseTitle}</h4>
                      <p>{latestReleaseReport ? latestReleaseReport.title : reportLayerCopy.noReleaseHint}</p>
                    </div>
                    {latestReleaseReport && <span className="status-pill status-default">v{latestReleaseReport.version}</span>}
                  </div>
                  {!blueprint ? (
                    <div className="empty-state page-empty">{t.empty.selectBlueprint}</div>
                  ) : !activeRun ? (
                    <div className="empty-state page-empty">{t.empty.noRunHistory}</div>
                  ) : latestReleaseReport ? (
                    <MarkdownRenderer value={latestReleaseReport.summary} className="run-report-body" />
                  ) : (
                    <div className="empty-state compact-empty-state">{reportLayerCopy.noRelease}</div>
                  )}
                </div>
              </section>
            </div>
          </div>
        </div>
      </section>
    </section>
  );
}

type RunArtifact = NonNullable<BlueprintRunView["artifacts"]>[number];

function getRunReportLayerCopy(language: Language) {
  const zh = language === "zh-CN";
  return {
    releaseTitle: zh ? "本轮报告" : "Round Report",
    noReleaseHint: zh ? "等待 Manager 汇总本轮结果" : "Waiting for the manager's round summary",
    noRelease: zh ? "还没有发布报告。" : "No release report yet.",
    artifactsTitle: zh ? "产物" : "Artifacts",
    artifactsHint: zh ? "本轮发布的产物索引。" : "Published output index for this run.",
    noArtifacts: zh ? "还没有产物。" : "No artifacts yet.",
    openArtifact: zh ? "打开" : "Open",
    count: (value: number) => zh ? `${value} 条` : `${value}`
  };
}

function sortRunCommands(commands: RunCommandFact[]): RunCommandFact[] {
  return [...commands].sort((left, right) => compareByTimestampThenId(left.createdAt, right.createdAt, left.id, right.id));
}

function sortRunCommandSteps(steps: RunCommandStepFact[]): RunCommandStepFact[] {
  return [...steps].sort((left, right) => {
    const revisionOrder = left.revision - right.revision;
    if (revisionOrder !== 0) return revisionOrder;
    return compareByTimestampThenId(left.createdAt, right.createdAt, left.id, right.id);
  });
}

function groupRunCommandSteps(steps: RunCommandStepFact[]): Map<string, RunCommandStepFact[]> {
  const grouped = new Map<string, RunCommandStepFact[]>();
  for (const step of sortRunCommandSteps(steps)) {
    grouped.set(step.commandId, [...(grouped.get(step.commandId) ?? []), step]);
  }
  return grouped;
}

function runCommandKindLabel(_kind: RunCommandFact["kind"], language: Language): string {
  const zh = language === "zh-CN";
  return zh ? "\u5e38\u89c4\u8fd0\u884c" : "Regular run";
}

function runCommandStepModeLabel(mode: RunCommandStepFact["mode"], language: Language): string {
  const zh = language === "zh-CN";
  if (mode === "research_resolution") return zh ? "\u7814\u7a76\u68b3\u7406" : "Research resolution";
  if (mode === "requirement_resolution") return zh ? "\u9700\u6c42\u68b3\u7406" : "Requirement resolution";
  if (mode === "revise_plan") return zh ? "\u8ba1\u5212\u66f4\u65b0" : "Plan update";
  if (mode === "preflight_judgment") return zh ? "\u6267\u884c\u524d\u5224\u65ad" : "Preflight judgment";
  if (mode === "context_snapshot") return zh ? "\u4e0a\u4e0b\u6587\u5feb\u7167" : "Context snapshot";
  if (mode === "release_report") return zh ? "\u53d1\u5e03\u62a5\u544a" : "Release report";
  return zh ? "\u8282\u70b9\u6267\u884c" : "Node execution";
}

function runExecutionStatusLabel(status: string, language: Language): string {
  const zh = language === "zh-CN";
  if (status === "queued") return zh ? "\u6392\u961f\u4e2d" : "Queued";
  if (status === "running" || status === "active") return zh ? "\u8fd0\u884c\u4e2d" : "Running";
  if (status === "waiting_approval" || status === "paused") return zh ? "\u7b49\u5f85\u4e2d" : "Waiting";
  if (status === "succeeded" || status === "completed") return zh ? "\u5df2\u5b8c\u6210" : "Completed";
  if (status === "failed") return zh ? "\u5931\u8d25" : "Failed";
  if (status === "cancelled") return zh ? "\u5df2\u53d6\u6d88" : "Cancelled";
  if (status === "unavailable") return zh ? "\u4e0d\u53ef\u7528" : "Unavailable";
  if (status === "fallback") return zh ? "\u964d\u7ea7" : "Fallback";
  return status;
}

function compareByTimestampThenId(leftDate: string, rightDate: string, leftId: string, rightId: string): number {
  const timestampOrder = toSafeTimestamp(leftDate) - toSafeTimestamp(rightDate);
  if (timestampOrder !== 0) return timestampOrder;
  return leftId.localeCompare(rightId);
}

export function buildCurrentOutputDisplayBody({
  bodyMd,
  artifacts,
  language,
  actorKind,
  reason,
  timelineDetails = []
}: {
  bodyMd: string;
  artifacts: RunArtifact[];
  language: Language;
  actorKind: TraceIssue["actorKind"];
  reason?: string;
  timelineDetails?: string[];
}): string {
  const zh = language === "zh-CN";
  const body = localizeHumanReportBody(bodyMd.trim(), language);
  const summarySplit = splitSummarySection(body);
  const deliverySplit = splitDeliverySection(summarySplit.bodyWithoutSummary);
  const artifactSplit = splitArtifactSections(deliverySplit.bodyWithoutDelivery);
  const deliveryItems = collectDeliveryItems(artifacts, language);
  const deliveryBody = deliveryItems.length ? formatDeliveryItems(deliveryItems) : noneText(language);
  const artifactBody = artifacts.length ? formatArtifactSummaryItems(artifacts) : noneText(language);
  const managerReason = actorKind === "manager" ? conciseSectionBody(reason, language) : undefined;
  const freeOutputSplit = splitPromotedOutputSections(artifactSplit.bodyWithoutArtifacts);
  const freeOutputParts = [
    freeOutputSplit.freeBody.trim(),
    ...timelineDetails.filter((detail) => detail.trim())
  ]
    .map((part) => part.trim())
    .filter((part) => part && part !== managerReason);
  const freeOutput = conciseSectionBody(freeOutputParts.join("\n\n"), language);
  const summary = conciseSectionBody(summarySplit.summaryBody, language);
  const actorLabel = currentOutputActorLabel(actorKind, language);

  return [
    `## ${zh ? "🧾 摘要" : "🧾 Summary"}`,
    "",
    summary,
    "",
    `## ${zh ? "📍 交付位置" : "📍 Delivery location"}`,
    "",
    deliveryBody,
    "",
    `## ${zh ? "📦 产物" : "📦 Artifacts"}`,
    "",
    artifactBody,
    "",
    ...(managerReason
      ? [
          `## ${zh ? "🧭 调度原因" : "🧭 Dispatch reason"}`,
          "",
          managerReason,
          ""
        ]
      : []),
    ...freeOutputSplit.promotedSections.flatMap((section) => [section, ""]),
    `## ${zh ? `✍️ ${actorLabel} 自由输出` : `✍️ ${actorLabel} free output`}`,
    "",
    freeOutput
  ].join("\n").trim();
}

function buildCurrentOutputPreviewBody(bodyMd: string, language: Language): string {
  const body = localizeHumanReportBody(bodyMd.trim(), language);
  const summarySplit = splitSummarySection(body);
  const deliverySplit = splitDeliverySection(summarySplit.bodyWithoutSummary);
  const artifactSplit = splitArtifactSections(deliverySplit.bodyWithoutDelivery);
  return artifactSplit.bodyWithoutArtifacts.trim() || summarySplit.summaryBody?.trim() || body;
}

function splitSummarySection(markdown: string): { summaryBody?: string; bodyWithoutSummary: string } {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => isSummaryHeading(line));
  if (start < 0) return { bodyWithoutSummary: markdown.trim() };
  const endOffset = lines.slice(start + 1).findIndex((line) => /^#{1,6}\s+/.test(line.trim()));
  const end = endOffset < 0 ? lines.length : start + 1 + endOffset;
  return {
    summaryBody: lines.slice(start + 1, end).join("\n").trim(),
    bodyWithoutSummary: [...lines.slice(0, start), ...lines.slice(end)].join("\n").replace(/\n{3,}/g, "\n\n").trim()
  };
}

function splitDeliverySection(markdown: string): { deliveryBody?: string; bodyWithoutDelivery: string } {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => isDeliveryHeading(line));
  if (start < 0) return { bodyWithoutDelivery: markdown.trim() };
  const endOffset = lines.slice(start + 1).findIndex((line) => /^#{1,6}\s+/.test(line.trim()));
  const end = endOffset < 0 ? lines.length : start + 1 + endOffset;
  return {
    deliveryBody: lines.slice(start + 1, end).join("\n").trim(),
    bodyWithoutDelivery: [...lines.slice(0, start), ...lines.slice(end)].join("\n").replace(/\n{3,}/g, "\n\n").trim()
  };
}

function splitArtifactSections(markdown: string): { artifactBodies: string[]; bodyWithoutArtifacts: string } {
  const lines = markdown.split(/\r?\n/);
  const artifactBodies: string[] = [];
  const retainedLines: string[] = [];
  for (let index = 0; index < lines.length;) {
    const line = lines[index] ?? "";
    if (!isArtifactHeading(line)) {
      retainedLines.push(line);
      index += 1;
      continue;
    }
    const endOffset = lines.slice(index + 1).findIndex((candidate) => isMarkdownHeading(candidate));
    const end = endOffset < 0 ? lines.length : index + 1 + endOffset;
    const body = lines.slice(index + 1, end).join("\n").trim();
    if (body) artifactBodies.push(body);
    index = end;
  }
  return {
    artifactBodies,
    bodyWithoutArtifacts: retainedLines.join("\n").replace(/\n{3,}/g, "\n\n").trim()
  };
}

function splitPromotedOutputSections(markdown: string): { promotedSections: string[]; freeBody: string } {
  const lines = markdown.split(/\r?\n/);
  const promotedSections: string[] = [];
  const freeLines: string[] = [];
  for (let index = 0; index < lines.length;) {
    const line = lines[index] ?? "";
    if (!isMarkdownHeading(line)) {
      freeLines.push(line);
      index += 1;
      continue;
    }
    const endOffset = lines.slice(index + 1).findIndex((candidate) => isMarkdownHeading(candidate));
    const end = endOffset < 0 ? lines.length : index + 1 + endOffset;
    const section = lines.slice(index, end).join("\n").trim();
    if (section) promotedSections.push(section);
    index = end;
  }
  return {
    promotedSections,
    freeBody: freeLines.join("\n").replace(/\n{3,}/g, "\n\n").trim()
  };
}

function isMarkdownHeading(line: string): boolean {
  return /^#{1,6}\s+/.test(line.trim());
}

function isSummaryHeading(line: string): boolean {
  return /^#{1,6}\s*(?:🧾\s*)?(?:摘要|Summary)(?:\s|$)/i.test(line.trim());
}

function isDeliveryHeading(line: string): boolean {
  return /^#{1,6}\s*(?:📍\s*)?(?:交付位置|产物位置|产出位置|Delivery location|Delivery|Artifact locations?)(?:\s|$)/i.test(line.trim());
}

function isArtifactHeading(line: string): boolean {
  return /^#{1,6}\s*(?:📦\s*)?(?:产物|交付物|Artifacts?|Deliverables?)(?:\s|$)/i.test(line.trim());
}

function formatDeliveryItems(items: Array<{ label: string; location: string }>): string {
  return items.map((item) => `- ${item.label}: ${formatLocationAsLink(item.location)}`).join("\n");
}

function formatArtifactSummaryItems(artifacts: RunArtifact[]): string {
  return artifacts.map((artifact) => {
    const title = artifact.title ?? artifact.kind;
    const linkedLabel = artifact.downloadUrl
      ? `[${title}](${artifact.downloadUrl})`
      : title;
    const kind = [artifact.kind, artifact.format].filter(Boolean).join(" · ");
    const previewPolicy = artifact.previewPolicy && artifact.previewPolicy !== "none" ? ` · ${artifact.previewPolicy}` : "";
    return `- ${linkedLabel}${kind || previewPolicy ? ` (${kind}${previewPolicy})` : ""}`;
  }).join("\n");
}

function formatLocationAsLink(location: string): string {
  if (!isMarkdownLinkTarget(location)) return location;
  const label = location.replace(/]/g, "\\]");
  const href = location.replace(/\)/g, "%29");
  return `[${label}](${href})`;
}

function isMarkdownLinkTarget(location: string): boolean {
  return /^(?:https?:\/\/|\/|#|mailto:|localhost\b|127\.0\.0\.1\b)/i.test(location);
}

function noneText(language: Language): string {
  return language === "zh-CN" ? "无" : "None";
}

function conciseSectionBody(value: string | undefined, language: Language): string {
  const trimmed = value?.trim();
  if (!trimmed || isEmptySectionText(trimmed)) return noneText(language);
  return trimmed;
}

function isEmptySectionText(value: string): boolean {
  const normalized = value
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/\s+/g, " ")
    .replace(/[。.]$/u, "")
    .trim()
    .toLowerCase();
  return [
    "无",
    "none",
    "本步骤没有产生新的交付物",
    "本步骤没有额外说明",
    "无额外自由输出",
    "no new deliverable produced in this step",
    "this step did not include additional notes",
    "no additional free output"
  ].includes(normalized);
}

function currentOutputActorLabel(kind: TraceIssue["actorKind"], language: Language): string {
  if (kind === "manager") return "Manager";
  if (kind === "user") return language === "zh-CN" ? "用户" : "User";
  if (kind === "system") return language === "zh-CN" ? "系统" : "System";
  return "Agent";
}

function localizeHumanReportBody(markdown: string, language: Language): string {
  if (language !== "zh-CN") return markdown;
  return markdown
    .replace(/^(#{1,6})\s*Delivery location\b/im, "$1 \u4ea4\u4ed8\u4f4d\u7f6e")
    .replace(/^(#{1,6})\s*Manager Routing Decision\b/gim, "$1 Manager \u8def\u7531\u51b3\u7b56")
    .replace(/^(#{1,6})\s*Decision\b/gim, "$1 \u51b3\u7b56")
    .replace(/^(#{1,6})\s*Next slot\b/gim, "$1 \u4e0b\u4e00\u4e2a\u69fd\u4f4d")
    .replace(/^(#{1,6})\s*Summary\b/gim, "$1 \u6458\u8981")
    .replace(/^(#{1,6})\s*Validation\b/gim, "$1 \u9a8c\u8bc1")
    .replace(/^(#{1,6})\s*Artifacts?\b/gim, "$1 \u4ea7\u7269")
    .replace(/^(#{1,6})\s*Assumptions\b/gim, "$1 \u5047\u8bbe")
    .replace(/^(#{1,6})\s*Risks\b/gim, "$1 \u98ce\u9669")
    .replace(/^(#{1,6})\s*Next steps\b/gim, "$1 \u4e0b\u4e00\u6b65")
    .replace(/^Manager Routing Decision$/gim, "Manager \u8def\u7531\u51b3\u7b56")
    .replace(/^No filesystem file was created in this read-only node\./gim, "\u672c\u8282\u70b9\u4ee5\u53ea\u8bfb\u65b9\u5f0f\u8fd0\u884c\uff0c\u6ca1\u6709\u521b\u5efa\u672c\u5730\u6587\u4ef6\u3002")
    .replace(/\bNo new deliverable produced in this step\./g, "\u672c\u6b65\u9aa4\u6ca1\u6709\u4ea7\u751f\u65b0\u7684\u4ea4\u4ed8\u7269\u3002")
    .replace(/\bRoute to Slot\s+(\d+)\b/g, "\u8def\u7531\u5230 Slot $1");
}

function collectDeliveryItems(artifacts: RunArtifact[], language: Language): Array<{ label: string; location: string }> {
  const zh = language === "zh-CN";
  const items: Array<{ label: string; location: string }> = [];
  const seen = new Set<string>();
  const addItem = (label: string, location: unknown) => {
    if (typeof location !== "string") return;
    const trimmed = formatDeliveryLocationForDisplay(location.trim(), language);
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    items.push({ label, location: trimmed });
  };

  for (const artifact of artifacts) {
    const label = artifact.title ?? artifact.kind;
    if (artifact.storagePath) addItem(zh ? `${label} \u672c\u5730\u6587\u4ef6` : `${label} local file`, artifact.storagePath);
    if (artifact.downloadUrl) addItem(zh ? `${label} \u6d4f\u89c8\u5668\u94fe\u63a5` : `${label} browser link`, artifact.downloadUrl);
    if (!artifact.storagePath && !artifact.downloadUrl) addItem(label, formatArtifactLocation(artifact));
  }
  return items;
}

function formatDeliveryLocationForDisplay(location: string, language: Language): string {
  if (language !== "zh-CN") return location;
  if (/^(https?:\/\/|\/|#|mailto:|localhost\b|127\.0\.0\.1\b)/i.test(location)) return location;
  if (/^[A-Za-z]:[\\/]/.test(location)) return location.replace(/\//g, "\\");
  if (/^(?:runs|artifacts|blueprints|tmp)[\\/]/i.test(location)) return location.replace(/\//g, "\\");
  return location;
}

function formatArtifactLocation(artifact: RunArtifact): string {
  return artifact.downloadUrl ?? artifact.relativePath ?? artifact.storagePath ?? artifact.id;
}

function resolveArtifactDownloadUrl(downloadUrl: string): string {
  return resolveApiResourceUrl(downloadUrl);
}

export function ApprovalsPage({
  approvals,
  approvalRequests = [],
  approvalThreads = [],
  humanActionQueue,
  humanActionResponsesByRequestId = {},
  language,
  t,
  actionPending = false,
  focusedEntryId,
  onApproveApprovalRequest,
  onRejectApprovalRequest,
  onReplyApprovalRequest,
  onSendHumanActionResponse
}: {
  approvals: PendingApprovalItem[];
  approvalRequests?: ApprovalRequest[];
  approvalThreads?: ApprovalThread[];
  humanActionQueue: HumanActionQueueItem[];
  humanActionResponsesByRequestId?: Record<string, HumanActionResponse[]>;
  language: Language;
  t: Messages;
  actionPending?: boolean;
  focusedEntryId?: string;
  onApproveApprovalRequest: (approvalRequestId: string, comment?: string) => void;
  onRejectApprovalRequest: (approvalRequestId: string, comment?: string) => void;
  onReplyApprovalRequest: (approvalRequestId: string, message: string) => void;
  onSendHumanActionResponse: (requestId: string, messageMarkdown: string) => void;
}) {
  const approvalsPage = t.pages.approvals ?? { title: 'Approvals', description: '' };
  const copy = getHumanActionInboxCopy(language);
  const [sourceFilter, setSourceFilter] = useState<HumanActionSourceFilter>('all');
  const [timeFilter, setTimeFilter] = useState<HumanActionTimeFilter>('all');
  const [selectedEntryId, setSelectedEntryId] = useState<string | undefined>();
  const [draftsByEntryId, setDraftsByEntryId] = useState<Record<string, string>>({});
  const approvalThreadsById = useMemo(
    () => new Map(approvalThreads.map((thread) => [thread.id, thread])),
    [approvalThreads]
  );
  const approvalRequestsById = useMemo(
    () => new Map(approvalRequests.map((request) => [request.id, request])),
    [approvalRequests]
  );
  const allEntries = useMemo(
    () => buildHumanActionInboxEntries({
      approvals,
      approvalRequestsById,
      approvalThreadsById,
      queue: humanActionQueue,
      language,
      copy
    }),
    [approvalRequestsById, approvalThreadsById, approvals, copy, humanActionQueue, language]
  );
  const entries = useMemo(
    () => allEntries
      .filter((entry) => entry.id === focusedEntryId || sourceFilter === 'all' || entry.sourceContextType === sourceFilter)
      .filter((entry) => entry.id === focusedEntryId || isWithinHumanActionTimeFilter(entry.updatedAt, timeFilter)),
    [allEntries, focusedEntryId, sourceFilter, timeFilter]
  );
  const totalEntries = allEntries.length;
  const pendingEntries = entries.filter((entry) => entry.status === 'pending' || entry.status === 'replying').length;
  const selectedEntry = entries.find((entry) => entry.id === selectedEntryId) ??
    (focusedEntryId ? entries.find((entry) => entry.id === focusedEntryId) : undefined) ??
    entries[0];
  const selectedDraft = selectedEntry ? draftsByEntryId[selectedEntry.id] ?? '' : '';

  useEffect(() => {
    if (selectedEntryId && entries.some((entry) => entry.id === selectedEntryId)) return;
    setSelectedEntryId(entries[0]?.id);
  }, [entries, selectedEntryId]);

  useEffect(() => {
    if (!focusedEntryId || !entries.some((entry) => entry.id === focusedEntryId)) return;
    setSelectedEntryId(focusedEntryId);
  }, [entries, focusedEntryId]);

  const updateDraft = (entryId: string, value: string) => {
    setDraftsByEntryId((current) => ({ ...current, [entryId]: value }));
  };

  const clearDraft = (entryId: string) => {
    setDraftsByEntryId((current) => {
      const next = { ...current };
      delete next[entryId];
      return next;
    });
  };

  const sendApprovalReply = (approval: ApprovalInboxControl, entryId: string, body: string) => {
    if (dispatchApprovalInboxReplyAction(approval, body, actionPending, onReplyApprovalRequest)) {
      clearDraft(entryId);
    }
  };

  const sendHumanResponse = (queueItem: HumanActionQueueItem, entryId: string, body: string) => {
    if (dispatchHumanActionQueueResponse(queueItem, body, actionPending, onSendHumanActionResponse)) {
      clearDraft(entryId);
    }
  };

  return (
    <section className="page-grid approvals-page">
      <div className="content-card stack-card">
        <div className="card-toolbar">
          <div className="card-title-block">
            <h3>{approvalsPage.title}</h3>
            <p>{copy.metric(entries.length, totalEntries, pendingEntries)}</p>
          </div>
          <div className="toolbar-cluster wrap">
            <label className="filter-label">
              <span>{copy.sourceFilter}</span>
              <select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value as HumanActionSourceFilter)}>
                <option value="all">{copy.allSources}</option>
                <option value="run_room">{copy.runRoom}</option>
                <option value="executive_chat">{copy.executiveChat}</option>
                <option value="blueprint_governance">{copy.blueprintGovernance}</option>
              </select>
            </label>
            <label className="filter-label">
              <span>{copy.timeFilter}</span>
              <select value={timeFilter} onChange={(event) => setTimeFilter(event.target.value as HumanActionTimeFilter)}>
                <option value="all">{copy.allTime}</option>
                <option value="today">{copy.today}</option>
                <option value="week">{copy.week}</option>
              </select>
            </label>
          </div>
        </div>
      </div>

      <div className="inbox-shell">
        <div className="content-card stack-card inbox-list-card">
          <div className="inbox-list-header">
            <strong>{copy.queueTitle}</strong>
            <span>{copy.entryCount(entries.length)}</span>
          </div>
          {entries.length === 0 ? (
            <div className="empty-state page-empty">
              <strong>{totalEntries === 0 ? copy.emptyTitle : copy.emptyFilterTitle}</strong>
              <p>{totalEntries === 0 ? copy.emptyBody : copy.emptyFilterBody}</p>
            </div>
          ) : (
            <div className="inbox-thread-list" role="listbox" aria-label={copy.queueTitle}>
              {entries.map((entry) => {
                const selected = selectedEntry?.id === entry.id;
                return (
                  <button
                    key={entry.id}
                    type="button"
                    className={'inbox-thread-item ' + (selected ? 'selected' : '')}
                    onClick={() => setSelectedEntryId(entry.id)}
                    aria-pressed={selected}
                  >
                    <span className={'status-dot ' + humanActionStatusClassName(entry.status)} />
                    <span className="inbox-thread-main">
                      <strong>{entry.title}</strong>
                      <span>{entry.subtitle}</span>
                    </span>
                    <span className="inbox-thread-meta">
                      <span>{humanActionStatusLabel(entry.status, language)}</span>
                      <span>{formatDateTime(entry.updatedAt, language)}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="content-card stack-card inbox-detail-card">
          {selectedEntry ? (
            selectedEntry.kind === 'approval' || selectedEntry.kind === 'decision_queue_item' ? (
              <ApprovalRequestDetail
                entry={selectedEntry}
                draft={selectedDraft}
                language={language}
                t={t}
                copy={copy}
                actionPending={actionPending}
                onDraftChange={(value) => updateDraft(selectedEntry.id, value)}
                onSendReply={() => sendApprovalReply(selectedEntry.approval, selectedEntry.id, selectedDraft)}
                onApprove={() => {
                  if (dispatchApprovalInboxDecisionAction(selectedEntry.approval, 'approve', selectedDraft, actionPending, {
                    onApproveApprovalRequest,
                    onRejectApprovalRequest
                  })) {
                    clearDraft(selectedEntry.id);
                  }
                }}
                onReject={() => {
                  if (dispatchApprovalInboxDecisionAction(selectedEntry.approval, 'reject', selectedDraft, actionPending, {
                    onApproveApprovalRequest,
                    onRejectApprovalRequest
                  })) {
                    clearDraft(selectedEntry.id);
                  }
                }}
              />
            ) : selectedEntry.kind === 'queue_item' ? (
              <HumanActionQueueDetail
                entry={selectedEntry}
                responses={humanActionResponsesByRequestId[selectedEntry.queueItem.humanActionRequestId] ?? []}
                draft={selectedDraft}
                language={language}
                copy={copy}
                actionPending={actionPending}
                onDraftChange={(value) => updateDraft(selectedEntry.id, value)}
                onSend={() => sendHumanResponse(selectedEntry.queueItem, selectedEntry.id, selectedDraft)}
              />
            ) : (
              <UnavailableDecisionQueueDetail
                entry={selectedEntry}
                language={language}
                copy={copy}
              />
            )
          ) : (
            <div className="empty-state page-empty">
              <MessageSquareText size={22} />
              <strong>{copy.noSelectionTitle}</strong>
              <p>{copy.noSelectionBody}</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

type HumanActionInboxEntry =
  | {
      kind: 'approval';
      id: string;
      title: string;
      subtitle: string;
      status: string;
      updatedAt: string;
      sourceContextType: HumanActionQueueItem['sourceContextType'];
      approval: ApprovalInboxControl;
      sourceApproval: PendingApprovalItem;
      thread?: ApprovalThread;
    }
  | {
      kind: 'queue_item';
      id: string;
      title: string;
      subtitle: string;
      status: HumanActionQueueItem['status'];
      updatedAt: string;
      sourceContextType: HumanActionQueueItem['sourceContextType'];
      queueItem: HumanActionQueueItem;
    }
  | {
      kind: 'decision_queue_item';
      id: string;
      title: string;
      subtitle: string;
      status: string;
      updatedAt: string;
      sourceContextType: HumanActionQueueItem['sourceContextType'];
      queueItem: HumanActionQueueItem;
      approvalRequest: ApprovalRequest;
      approval: ApprovalInboxControl;
    }
  | {
      kind: 'unavailable_decision_queue_item';
      id: string;
      title: string;
      subtitle: string;
      status: HumanActionQueueItem['status'];
      updatedAt: string;
      sourceContextType: HumanActionQueueItem['sourceContextType'];
      queueItem: HumanActionQueueItem;
      unavailableReason: string;
    };

export type ApprovalInboxControl = {
  approvalRequestId?: string;
  status?: string;
  reviewOutput?: unknown;
  replies?: PendingApprovalItem['replies'];
  canApprove?: boolean;
  canReply?: boolean;
  canReject?: boolean;
  discussion?: PendingApprovalItem['discussion'];
};

type ApprovalInboxDecisionAction = 'approve' | 'reject';

type ApprovalInboxDecisionCallbacks = {
  onApproveApprovalRequest: (approvalRequestId: string, comment?: string) => void;
  onRejectApprovalRequest: (approvalRequestId: string, comment?: string) => void;
};

type HumanActionSourceFilter = 'all' | HumanActionQueueItem['sourceContextType'];
type HumanActionTimeFilter = 'all' | 'today' | 'week';

type HumanActionInboxCopy = {
  metric: (shown: number, total: number, pending: number) => string;
  entryCount: (count: number) => string;
  sourceFilter: string;
  timeFilter: string;
  allSources: string;
  allTime: string;
  today: string;
  week: string;
  runRoom: string;
  executiveChat: string;
  blueprintGovernance: string;
  queueTitle: string;
  emptyTitle: string;
  emptyBody: string;
  emptyFilterTitle: string;
  emptyFilterBody: string;
  noSelectionTitle: string;
  noSelectionBody: string;
  requestBody: string;
  replies: string;
  responseHistory: string;
  messagePlaceholder: string;
  sendMessage: string;
  sendResponse: string;
  approvalDetail: string;
  humanActionDetail: string;
  decisionUnavailableTitle: string;
  decisionUnavailableMissing: string;
  decisionUnavailableNotPending: string;
  context: string;
  intent: string;
  createdBy: string;
  acceptAction: string;
  rejectAction: string;
};

function ApprovalRequestDetail({
  entry,
  draft,
  language,
  t,
  copy,
  actionPending,
  onDraftChange,
  onSendReply,
  onApprove,
  onReject
}: {
  entry: Extract<HumanActionInboxEntry, { kind: 'approval' | 'decision_queue_item' }>;
  draft: string;
  language: Language;
  t: Messages;
  copy: HumanActionInboxCopy;
  actionPending: boolean;
  onDraftChange: (value: string) => void;
  onSendReply: () => void;
  onApprove: () => void;
  onReject: () => void;
}) {
  const approval = entry.approval;
  const canApprove = Boolean(approval.approvalRequestId && !actionPending && approval.canApprove !== false);
  const canReject = Boolean(approval.approvalRequestId && !actionPending && approval.canReject === true);
  const canReply = Boolean(approval.approvalRequestId && !actionPending && canSendApprovalReply(approval));
  const canEditDraft = (approval.status ?? 'pending') === 'pending' && !actionPending;
  void t;

  return (
    <div className="inbox-detail-stack">
      <div className="inbox-detail-header">
        <div>
          <span className="eyebrow">{copy.approvalDetail}</span>
          <h3>{entry.title}</h3>
          <p>{entry.subtitle}</p>
        </div>
        <span className={'status-pill ' + humanActionStatusClassName(entry.status)}>{humanActionStatusLabel(entry.status, language)}</span>
      </div>

      <div className="inbox-content-block">
        <span>{copy.requestBody}</span>
        <MarkdownRenderer value={formatHumanActionMarkdownValue(approval.reviewOutput)} />
      </div>

      {(approval.replies?.length ?? 0) > 0 && (
        <div className="inbox-message-list">
          <span>{copy.replies}</span>
          {approval.replies?.map((reply) => (
            <div key={reply.id} className={'inbox-message ' + (reply.role === 'user' ? 'from-user' : 'from-assistant')}>
              <div className="inbox-message-avatar">{reply.role === 'user' ? 'You' : <MessageSquareText size={15} />}</div>
              <div>
                <MarkdownRenderer value={reply.body} />
                <small>{formatDateTime(reply.createdAt, language)}</small>
              </div>
            </div>
          ))}
        </div>
      )}

      <textarea
        className="inbox-reply-textarea"
        value={draft}
        onChange={(event) => onDraftChange(event.target.value)}
        placeholder={copy.messagePlaceholder}
        disabled={!canEditDraft}
      />
      <div className="inbox-detail-actions">
        <button type="button" disabled={!canReply || !draft.trim()} onClick={onSendReply}>
          {actionPending ? <Loader2 className="spin" size={15} /> : <Send size={15} />}
          {copy.sendMessage}
        </button>
        <button type="button" className="primary-action" disabled={!canApprove} onClick={onApprove}>
          <BadgeCheck size={15} />
          {copy.acceptAction}
        </button>
        <button type="button" className="danger-action" disabled={!canReject} onClick={onReject}>
          <X size={15} />
          {copy.rejectAction}
        </button>
      </div>
    </div>
  );
}

function HumanActionQueueDetail({
  entry,
  responses,
  draft,
  language,
  copy,
  actionPending,
  onDraftChange,
  onSend
}: {
  entry: Extract<HumanActionInboxEntry, { kind: 'queue_item' }>;
  responses: HumanActionResponse[];
  draft: string;
  language: Language;
  copy: HumanActionInboxCopy;
  actionPending: boolean;
  onDraftChange: (value: string) => void;
  onSend: () => void;
}) {
  const queueItem = entry.queueItem;
  const canRespond = queueItem.status === 'pending' && !actionPending;
  return (
    <div className="inbox-detail-stack">
      <div className="inbox-detail-header">
        <div>
          <span className="eyebrow">{copy.humanActionDetail}</span>
          <h3>{entry.title}</h3>
          <p>{entry.subtitle}</p>
        </div>
        <span className={'status-pill ' + humanActionStatusClassName(entry.status)}>{humanActionStatusLabel(entry.status, language)}</span>
      </div>

      <div className="inbox-detail-facts">
        <span>{copy.context}: {humanActionContextLabel(queueItem.sourceContextType, language)}</span>
        <span>{copy.intent}: {humanActionIntentLabel(queueItem.responseIntent, language)}</span>
      </div>

      <div className="inbox-content-block">
        <span>{copy.requestBody}</span>
        <MarkdownRenderer value={queueItem.bodyMarkdown} />
      </div>

      {responses.length > 0 && (
        <div className="inbox-message-list">
          <span>{copy.responseHistory}</span>
          {responses.map((response) => (
            <div key={response.id} className="inbox-message from-user">
              <div className="inbox-message-avatar">You</div>
              <div>
                <MarkdownRenderer value={response.messageMarkdown} />
                <small>{formatDateTime(response.createdAt, language)}</small>
              </div>
            </div>
          ))}
        </div>
      )}

      <textarea
        className="inbox-reply-textarea"
        value={draft}
        onChange={(event) => onDraftChange(event.target.value)}
        placeholder={copy.messagePlaceholder}
        disabled={!canRespond}
      />
      <div className="inbox-detail-actions">
        <button type="button" className="primary-action" disabled={!canRespond || !draft.trim()} onClick={onSend}>
          {actionPending ? <Loader2 className="spin" size={15} /> : <Send size={15} />}
          {copy.sendResponse}
        </button>
      </div>
    </div>
  );
}

function UnavailableDecisionQueueDetail({
  entry,
  language,
  copy
}: {
  entry: Extract<HumanActionInboxEntry, { kind: 'unavailable_decision_queue_item' }>;
  language: Language;
  copy: HumanActionInboxCopy;
}) {
  const queueItem = entry.queueItem;
  return (
    <div className="inbox-detail-stack">
      <div className="inbox-detail-header">
        <div>
          <span className="eyebrow">{copy.decisionUnavailableTitle}</span>
          <h3>{entry.title}</h3>
          <p>{entry.subtitle}</p>
        </div>
        <span className={'status-pill ' + humanActionStatusClassName(entry.status)}>{humanActionStatusLabel(entry.status, language)}</span>
      </div>

      <div className="inbox-detail-facts">
        <span>{copy.context}: {humanActionContextLabel(queueItem.sourceContextType, language)}</span>
        <span>{copy.intent}: {humanActionIntentLabel(queueItem.responseIntent, language)}</span>
      </div>

      <div className="empty-state compact-empty-state">
        <strong>{copy.decisionUnavailableTitle}</strong>
        <p>{entry.unavailableReason}</p>
      </div>

      <div className="inbox-content-block">
        <span>{copy.requestBody}</span>
        <MarkdownRenderer value={queueItem.bodyMarkdown} />
      </div>
    </div>
  );
}

function getHumanActionInboxCopy(language: Language): HumanActionInboxCopy {
  if (language === "zh-CN") {
    return {
      metric: (shown, total, pending) => "\u5df2\u663e\u793a " + shown + " / " + total + "\uff0c" + pending + " \u6761\u5f85\u5904\u7406",
      entryCount: (count) => count + " \u6761",
      sourceFilter: "\u6765\u6e90",
      timeFilter: "\u65f6\u95f4",
      allSources: "\u5168\u90e8\u6765\u6e90",
      allTime: "\u5168\u90e8\u65f6\u95f4",
      today: "\u4eca\u5929",
      week: "7 \u5929",
      runRoom: "\u8fd0\u884c\u623f\u95f4",
      executiveChat: "Executive \u804a\u5929",
      blueprintGovernance: "\u84dd\u56fe\u6cbb\u7406",
      queueTitle: "\u5f85\u5904\u7406\u4e8b\u9879",
      emptyTitle: "\u6ca1\u6709\u5f85\u5904\u7406\u4e8b\u9879",
      emptyBody: "\u65b0\u7684\u4eba\u5de5\u5904\u7406\u8bf7\u6c42\u4f1a\u51fa\u73b0\u5728\u8fd9\u91cc\u3002",
      emptyFilterTitle: "\u6ca1\u6709\u5339\u914d\u7684\u4e8b\u9879",
      emptyFilterBody: "\u8c03\u6574\u6765\u6e90\u6216\u65f6\u95f4\u7b5b\u9009\u3002",
      noSelectionTitle: "\u672a\u9009\u62e9\u4e8b\u9879",
      noSelectionBody: "\u4ece\u5217\u8868\u9009\u62e9\u4e00\u6761\u5f85\u5904\u7406\u4e8b\u9879\u67e5\u770b\u8be6\u60c5\u3002",
      requestBody: "\u8bf7\u6c42\u5185\u5bb9",
      replies: "\u5bf9\u8bdd",
      responseHistory: "\u4eba\u5de5\u56de\u590d\u5386\u53f2",
      messagePlaceholder: "\u5199\u4e0b\u5904\u7406\u610f\u89c1...",
      sendMessage: "\u53d1\u9001\u6d88\u606f",
      sendResponse: "\u53d1\u9001\u5904\u7406\u7ed3\u679c",
      approvalDetail: "\u5ba1\u6279\u8bf7\u6c42",
      humanActionDetail: "\u4eba\u5de5\u5904\u7406\u8bf7\u6c42",
      decisionUnavailableTitle: "\u5ba1\u6279\u8bf7\u6c42\u4e0d\u53ef\u7528",
      decisionUnavailableMissing: "\u8be5\u51b3\u7b56\u8bf7\u6c42\u88ab\u963b\u585e\uff0c\u56e0\u4e3a\u5173\u8054\u7684\u5ba1\u6279\u8bf7\u6c42\u672a\u627e\u5230\u3002",
      decisionUnavailableNotPending: "\u8be5\u51b3\u7b56\u8bf7\u6c42\u5173\u8054\u7684\u5ba1\u6279\u5df2\u4e0d\u518d\u5f85\u5904\u7406\u3002",
      context: "\u4e0a\u4e0b\u6587",
      intent: "\u610f\u56fe",
      createdBy: "\u521b\u5efa\u8005",
      acceptAction: "\u901a\u8fc7",
      rejectAction: "\u62d2\u7edd"
    };
  }
  return {
    metric: (shown, total, pending) => shown + ' of ' + total + ' shown, ' + pending + ' pending',
    entryCount: (count) => count + ' items',
    sourceFilter: 'Source',
    timeFilter: 'Time',
    allSources: 'All sources',
    allTime: 'All time',
    today: 'Today',
    week: '7 days',
    runRoom: 'Run Room',
    executiveChat: 'Executive chat',
    blueprintGovernance: 'Blueprint governance',
    queueTitle: 'Human action queue',
    emptyTitle: 'No human action requests',
    emptyBody: 'New human requests will appear here.',
    emptyFilterTitle: 'No matching requests',
    emptyFilterBody: 'Adjust the source or time filter.',
    noSelectionTitle: 'No request selected',
    noSelectionBody: 'Select a human request from the list.',
    requestBody: 'Request body',
    replies: 'Conversation',
    responseHistory: 'Human responses',
    messagePlaceholder: 'Write a response...',
    sendMessage: 'Send message',
    sendResponse: 'Send response',
    approvalDetail: 'Approval request',
    humanActionDetail: 'Human action request',
    decisionUnavailableTitle: 'Approval request unavailable',
    decisionUnavailableMissing: 'This decision request is blocked because its bound approval request could not be found.',
    decisionUnavailableNotPending: 'This decision request is no longer pending on its bound approval request.',
    context: 'Context',
    intent: 'Intent',
    createdBy: 'Created by',
    acceptAction: 'Accept',
    rejectAction: 'Decline'
  };
}

function buildHumanActionInboxEntries({
  approvals,
  approvalRequestsById,
  approvalThreadsById,
  queue,
  language,
  copy
}: {
  approvals: PendingApprovalItem[];
  approvalRequestsById: Map<string, ApprovalRequest>;
  approvalThreadsById: Map<string, ApprovalThread>;
  queue: HumanActionQueueItem[];
  language: Language;
  copy: HumanActionInboxCopy;
}): HumanActionInboxEntry[] {
  const approvalEntriesByThreadId = new Map<string, Extract<HumanActionInboxEntry, { kind: 'approval' }>>();
  for (const approval of approvals) {
    const threadId = approval.approvalThreadId ?? approval.approvalRequestId ?? approval.nodeRunId;
    const thread = approvalThreadsById.get(threadId);
    const entry: Extract<HumanActionInboxEntry, { kind: 'approval' }> = {
      kind: 'approval',
      id: 'approval:' + (approval.approvalRequestId ?? threadId),
      title: approval.nodeLabel || 'Approval',
      subtitle: approval.blueprintName + ' / ' + approval.kind,
      status: approval.status ?? 'pending',
      updatedAt: thread?.updatedAt ?? approval.requestedAt,
      sourceContextType: 'run_room',
      approval: approvalControlFromPendingApproval(approval),
      sourceApproval: approval,
      thread
    };
    const existing = approvalEntriesByThreadId.get(threadId);
    const currentRequestId = thread?.currentRequestId;
    const entryIsCurrent = currentRequestId ? approval.approvalRequestId === currentRequestId : false;
    const existingApprovalRequestId = existing?.kind === 'approval' ? existing.approval.approvalRequestId : undefined;
    const existingIsCurrent = currentRequestId ? existingApprovalRequestId === currentRequestId : false;
    const entryTime = new Date(entry.updatedAt).getTime();
    const existingTime = existing ? new Date(existing.updatedAt).getTime() : Number.NEGATIVE_INFINITY;
    if (!existing || entryIsCurrent || (!existingIsCurrent && entryTime >= existingTime)) {
      approvalEntriesByThreadId.set(threadId, entry);
    }
  }
  const approvalEntries = [...approvalEntriesByThreadId.values()];
  const approvalEntriesByRequestId = new Map(
    approvalEntries
      .map((entry) => [entry.approval.approvalRequestId, entry] as const)
      .filter((entry): entry is [string, Extract<HumanActionInboxEntry, { kind: 'approval' }>] => typeof entry[0] === 'string')
  );
  const queueEntries: HumanActionInboxEntry[] = [];
  for (const queueItem of queue) {
    if (queueItem.responseIntent === 'decision_required') {
      const approvalRequestId = queueItem.approvalRequestId;
      if (approvalRequestId && approvalEntriesByRequestId.has(approvalRequestId)) {
        continue;
      }
      const approvalRequest = approvalRequestId ? approvalRequestsById.get(approvalRequestId) : undefined;
      if (approvalRequest?.status === 'pending') {
        queueEntries.push({
          kind: 'decision_queue_item',
          id: 'human:' + queueItem.humanActionRequestId,
          title: queueItem.title || approvalRequest.title,
          subtitle: humanActionContextLabel(queueItem.sourceContextType, language) + ' / ' + approvalRequest.kind,
          status: approvalRequest.status,
          updatedAt: approvalRequest.updatedAt ?? queueItem.updatedAt,
          sourceContextType: queueItem.sourceContextType,
          queueItem,
          approvalRequest,
          approval: approvalControlFromApprovalRequest(approvalRequest)
        });
        continue;
      }
      queueEntries.push({
        kind: 'unavailable_decision_queue_item',
        id: 'human:' + queueItem.humanActionRequestId,
        title: queueItem.title,
        subtitle: humanActionContextLabel(queueItem.sourceContextType, language) + ' / ' + humanActionIntentLabel(queueItem.responseIntent, language),
        status: queueItem.status,
        updatedAt: queueItem.updatedAt,
        sourceContextType: queueItem.sourceContextType,
        queueItem,
        unavailableReason: approvalRequest ? copy.decisionUnavailableNotPending : copy.decisionUnavailableMissing
      });
      continue;
    }

    queueEntries.push({
      kind: 'queue_item',
      id: 'human:' + queueItem.humanActionRequestId,
      title: queueItem.title,
      subtitle: humanActionContextLabel(queueItem.sourceContextType, language) + ' / ' + humanActionIntentLabel(queueItem.responseIntent, language),
      status: queueItem.status,
      updatedAt: queueItem.updatedAt,
      sourceContextType: queueItem.sourceContextType,
      queueItem
    });
  }

  return [...approvalEntries, ...queueEntries]
    .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
}

function approvalControlFromPendingApproval(approval: PendingApprovalItem): ApprovalInboxControl {
  return {
    approvalRequestId: approval.approvalRequestId,
    status: approval.status,
    reviewOutput: approval.reviewOutput,
    replies: approval.replies,
    canApprove: approval.canApprove,
    canReply: approval.canReply,
    canReject: approval.canReject,
    discussion: approval.discussion
  };
}

function approvalControlFromApprovalRequest(approvalRequest: ApprovalRequest): ApprovalInboxControl {
  return {
    approvalRequestId: approvalRequest.id,
    status: approvalRequest.status,
    reviewOutput: approvalRequest.body,
    canApprove: approvalRequest.capabilities.approve,
    canReply: approvalRequest.capabilities.reply,
    canReject: approvalRequest.capabilities.reject,
    discussion: {
      mode: approvalRequest.capabilities.reply ? 'message_only' : 'none',
      canStreamReply: false,
      reason: 'approval_request_capabilities'
    }
  };
}

export function dispatchApprovalInboxDecisionAction(
  approval: ApprovalInboxControl,
  action: ApprovalInboxDecisionAction,
  draft: string,
  actionPending: boolean,
  callbacks: ApprovalInboxDecisionCallbacks
): boolean {
  if (!approval.approvalRequestId || actionPending) return false;
  const comment = draft.trim() || undefined;
  if (action === 'approve') {
    if (approval.canApprove === false) return false;
    callbacks.onApproveApprovalRequest(approval.approvalRequestId, comment);
    return true;
  }
  if (approval.canReject !== true) return false;
  callbacks.onRejectApprovalRequest(approval.approvalRequestId, comment);
  return true;
}

export function dispatchApprovalInboxReplyAction(
  approval: ApprovalInboxControl,
  body: string,
  actionPending: boolean,
  onReplyApprovalRequest: (approvalRequestId: string, message: string) => void
): boolean {
  if (!approval.approvalRequestId || !canSendApprovalReply(approval) || actionPending) return false;
  const trimmed = body.trim();
  if (!trimmed) return false;
  onReplyApprovalRequest(approval.approvalRequestId, trimmed);
  return true;
}

export function dispatchHumanActionQueueResponse(
  queueItem: HumanActionQueueItem,
  body: string,
  actionPending: boolean,
  onSendHumanActionResponse: (requestId: string, messageMarkdown: string) => void
): boolean {
  const trimmed = body.trim();
  if (queueItem.responseIntent !== 'reply_required') return false;
  if (queueItem.status !== 'pending' || !trimmed || actionPending) return false;
  onSendHumanActionResponse(queueItem.humanActionRequestId, trimmed);
  return true;
}

function canSendApprovalReply(approval: ApprovalInboxControl): boolean {
  return (approval.status ?? 'pending') === 'pending' && approval.canReply === true && approval.discussion?.mode !== 'none';
}

function formatHumanActionMarkdownValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return '';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function isWithinHumanActionTimeFilter(value: string, filter: HumanActionTimeFilter): boolean {
  if (filter === 'all') return true;
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return true;
  const now = Date.now();
  if (filter === 'today') return new Date(value).toDateString() === new Date(now).toDateString();
  return now - timestamp <= 7 * 24 * 60 * 60 * 1000;
}

function humanActionStatusClassName(status: string): string {
  if (status === 'pending' || status === 'replying') return 'pending';
  if (status === 'responded' || status === 'completed' || status === 'approved') return 'approved';
  if (status === 'rejected' || status === 'terminated') return 'rejected';
  return 'neutral';
}

function humanActionStatusLabel(status: string, language: Language): string {
  if (language === "zh-CN") {
    if (status === 'pending') return "\u5f85\u5904\u7406";
    if (status === 'replying') return "\u56de\u590d\u4e2d";
    if (status === 'responded') return "\u5df2\u56de\u590d";
    if (status === 'completed') return "\u5df2\u5b8c\u6210";
    if (status === 'approved') return "\u5df2\u901a\u8fc7";
    if (status === 'rejected') return "\u5df2\u62d2\u7edd";
    if (status === 'terminated') return "\u5df2\u7ec8\u6b62";
    if (status === 'closed') return "\u5df2\u5173\u95ed";
    if (status === 'cancelled') return "\u5df2\u53d6\u6d88";
    return status.replaceAll('_', ' ');
  }
  if (status === 'pending') return 'pending';
  if (status === 'replying') return 'replying';
  if (status === 'responded') return 'responded';
  if (status === 'completed') return 'completed';
  if (status === 'approved') return 'approved';
  if (status === 'rejected') return 'rejected';
  if (status === 'terminated') return 'terminated';
  if (status === 'closed') return 'closed';
  if (status === 'cancelled') return 'cancelled';
  return status.replaceAll('_', ' ');
}

function humanActionContextLabel(value: HumanActionQueueItem['sourceContextType'], language: Language): string {
  if (language === "zh-CN") {
    if (value === 'run_room') return "\u8fd0\u884c\u623f\u95f4";
    if (value === 'executive_chat') return "Executive \u804a\u5929";
    return "\u84dd\u56fe\u6cbb\u7406";
  }
  if (value === 'run_room') return 'Run Room';
  if (value === 'executive_chat') return 'Executive chat';
  return 'Blueprint governance';
}

function humanActionIntentLabel(value: HumanActionQueueItem['responseIntent'], language: Language): string {
  if (language === "zh-CN") {
    if (value === 'decision_required') return "\u9700\u8981\u51b3\u7b56";
    return "\u9700\u8981\u56de\u590d";
  }
  if (value === 'decision_required') return 'decision required';
  return 'reply required';
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
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
  const widgets = (dashboard?.dashboardWidgets ?? []).filter(
    (widget): widget is DashboardWidget & { type: "pending_approvals" | "runtime_overview" | "catalog_status" } =>
      isRenderableDashboardWidgetType(widget.type)
  );
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
            {(["pending_approvals", "runtime_overview", "catalog_status"] as DashboardWidgetType[]).map((type) => (
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
  const modelCardCopy = { ...modelCopy, defaultOption: t.common.defaultOption };

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
  const selectedProvider = modelProviders.find((provider) => provider.id === selectedProviderId);
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

              return (
                <ConfiguredModelCard
                  key={model.id}
                  model={{ id: model.id, provider: model.provider, label: model.label }}
                  usage={usage}
                  isDefault={isDefault}
                  copy={modelCardCopy}
                  language={language}
                  actions={
                    <button type="button" className={isDefault ? "default-action" : undefined} disabled={busy || isDefault} onClick={() => onSetDefaultModel(model.id)}>
                      {busyAction === `setOpenClawDefaultModel:${model.id}` && !isDefault ? <Loader2 className="spin" size={16} /> : <BadgeCheck size={16} />}
                      {isDefault ? t.common.defaultOption : modelCopy.setDefault}
                    </button>
                  }
                />
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
                selectedId={selectedProviderId}
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
                <button
                  type="button"
                  onClick={() => {
                    setModelStep("provider");
                    setSelectedMethodId("");
                  }}
                >
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

export type ConfiguredModelCardModel = {
  id: string;
  provider: string;
  label: string;
};

export type ConfiguredModelCardCopy = {
  usage: string;
  calls: string;
  tokens: string;
  cost: string;
  recent7d: string;
  defaultOption: string;
};

export function ConfiguredModelCard({
  model,
  usage,
  isDefault = false,
  badgeLabel,
  copy,
  language,
  actions,
  children,
  className
}: {
  model: ConfiguredModelCardModel;
  usage?: ModelUsageSummary;
  isDefault?: boolean;
  badgeLabel?: string;
  copy: ConfiguredModelCardCopy;
  language: Language;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const usageSummary = usage ?? createEmptyModelUsageSummary();
  const recentDays = recentModelUsageDays(usageSummary, language);
  const recentTotal = summarizeRecentModelUsage(recentDays);
  const maxDailyTokens = Math.max(1, ...recentDays.map((day) => day.totalTokens));
  const visibleBadge = badgeLabel ?? (isDefault ? copy.defaultOption : undefined);

  return (
    <article className={`model-card${className ? ` ${className}` : ""}`}>
      <div className="model-card-head">
        <IdentityTitle kind="model" id={model.provider} label={model.label} />
        {visibleBadge && <span className="status-pill status-default">{visibleBadge}</span>}
      </div>
      <div className="model-card-usage" aria-label={copy.usage}>
        <div className="model-usage-head">
          <span>{copy.recent7d}</span>
          <strong>{`${formatCompactTokenValue(recentTotal.totalTokens)} ${copy.tokens}`}</strong>
        </div>
        <div className="model-usage-chart">
          {recentDays.map((day) => (
            <div
              key={day.dateKey}
              className="model-usage-day"
              title={`${day.fullLabel}: ${day.totalTokens.toLocaleString(language)} ${copy.tokens}, $${day.costUsd.toFixed(4)}`}
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
          <span>{`${copy.calls}: ${recentTotal.calls.toLocaleString(language)}`}</span>
          <span>{`${copy.cost}: $${recentTotal.costUsd.toFixed(4)}`}</span>
        </div>
      </div>
      {children}
      {actions && <div className="model-card-actions">{actions}</div>}
    </article>
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
      setAgentWorkspace(joinWorkspacePath(openClawConfig.defaultWorkspace, normalizeAgentId(agentName)));
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
              <article key={agent.id} className="model-card">
                <div className="model-card-head">
                  <IdentityTitle kind="agent" id={agent.id} label={agent.name ?? agent.id} />
                  {agent.isDefault && <span className="status-pill status-default">{t.common.defaultOption}</span>}
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
              placeholder={
                openClawConfig?.defaultWorkspace
                  ? formatWorkspacePathPlaceholder(openClawConfig.defaultWorkspace)
                  : t.catalogConfig.workspacePlaceholder
              }
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

function runResultTitle(runView: BlueprintRunView, blueprints: BlueprintDefinition[]): string {
  return (
    runView.finalResult?.candidates[0]?.nodeLabel ??
    runView.finalResult?.failedNode?.nodeLabel ??
    runView.finalResult?.waitingApprovalNode?.nodeLabel ??
    blueprintNameFor(blueprints, runView.run.blueprintId)
  );
}

function runResultPreview(runView: BlueprintRunView, t: Messages): string {
  const result = runView.finalResult;
  if (!result) return t.trace.noOutput;
  if (result.state === "available") {
    return summarizeOutput(result.candidates[0]?.output, t);
  }
  if (result.state === "failed") {
    return result.failedNode?.error || summarizeOutput(result.failedNode?.output, t);
  }
  if (result.state === "waiting_approval") {
    return result.waitingApprovalNode?.nodeLabel ?? t.status.waiting_approval;
  }
  return t.trace.noOutput;
}

function runResultStatusClassName(runView: BlueprintRunView): string {
  const state = runView.finalResult?.state;
  if (state === "available") return "status-succeeded";
  if (state === "failed") return "status-failed";
  if (state === "waiting_approval") return "status-waiting_approval";
  if (state === "empty") return "status-empty";
  return `status-${runView.run.status}`;
}

function runResultStatusLabel(runView: BlueprintRunView, t: Messages, language: Language): string {
  const state = runView.finalResult?.state;
  if (state === "available") return language === "zh-CN" ? "已生成" : "Available";
  if (state === "failed") return t.status.failed;
  if (state === "waiting_approval") return t.status.waiting_approval;
  if (state === "empty") return language === "zh-CN" ? "无输出" : "No output";
  return t.status[runView.run.status];
}

export function BlueprintKanbanPage({
  board,
  blueprints,
  language,
  onOpenCard
}: {
  board: BlueprintKanbanBoard;
  blueprints: BlueprintDefinition[];
  language: Language;
  onOpenCard: (card: BlueprintKanbanCard) => void;
}) {
  const copy =
    language === "zh-CN"
        ? {
            title: "\u84dd\u56fe\u770b\u677f",
            runHistory: "\u8fd0\u884c\u4e0e\u7b49\u5f85",
            runResults: "运行结果",
            fromDate: "\u6765\u6e90",
            toDate: "\u56de\u590d\u610f\u56fe",
            noRecords: "\u6ca1\u6709\u8be5\u72b6\u6001\u7684\u84dd\u56fe\u8fd0\u884c\u5165\u53e3\u3002",
            noResults: "该时间范围没有运行结果。",
            openRun: "\u6253\u5f00\u8be6\u60c5",
            startedAt: "\u66f4\u65b0\u65f6\u95f4"
          }
        : {
            title: "Blueprint Kanban",
            runHistory: "Active and waiting",
            runResults: "Completed and failed",
            fromDate: "Source",
            toDate: "Response intent",
            noRecords: "No blueprint run entries in this lane.",
            noResults: "No blueprint run entries in this lane.",
            openRun: "Open detail",
            startedAt: "Updated"
          };
  const [filters, setFilters] = useState<BlueprintKanbanFilters>({
    sourceContextType: "all",
    responseIntent: "all"
  });
  const lanes = useMemo(() => groupBlueprintKanbanCards(board, filters), [board, filters]);

  return (
    <PageShell className="blueprint-kanban-page">
      <PageHeader className="blueprint-kanban-title">
        <div>
          <h2>{copy.title}</h2>
          <p>{language === "zh-CN" ? "\u6309\u72b6\u6001\u67e5\u770b\u84dd\u56fe\u8fd0\u884c\u5165\u53e3" : "Track blueprint run entry points by current state."}</p>
        </div>
        <div className="toolbar-cluster wrap">
          <label className="field-control compact">
            <span>{copy.fromDate}</span>
            <select
              value={filters.sourceContextType}
              onChange={(event) => {
                const value = event.target.value;
                setFilters((current) => ({
                  ...current,
                  sourceContextType: isBlueprintKanbanSourceFilter(value) ? value : "all"
                }));
              }}
            >
              <option value="all">{language === "zh-CN" ? "\u5168\u90e8" : "All"}</option>
              {humanActionRequestSourceContextTypes.map((sourceContextType) => (
                <option key={sourceContextType} value={sourceContextType}>
                  {humanActionContextLabel(sourceContextType, language)}
                </option>
              ))}
            </select>
          </label>
          <label className="field-control compact">
            <span>{copy.toDate}</span>
            <select
              value={filters.responseIntent}
              onChange={(event) => {
                const value = event.target.value;
                setFilters((current) => ({
                  ...current,
                  responseIntent: isBlueprintKanbanIntentFilter(value) ? value : "all"
                }));
              }}
            >
              <option value="all">{language === "zh-CN" ? "\u5168\u90e8" : "All"}</option>
              {humanActionRequestResponseIntents.map((responseIntent) => (
                <option key={responseIntent} value={responseIntent}>
                  {humanActionIntentLabel(responseIntent, language)}
                </option>
              ))}
            </select>
          </label>
        </div>
      </PageHeader>

      <PageBody className="blueprint-kanban-layout">
        {blueprintKanbanLaneOrder.map((lane) => (
          <div key={lane} className="page-panel blueprint-kanban-lane" data-kanban-lane={lane}>
            <div className="page-panel-header blueprint-kanban-lane-header">
              <h3>{blueprintKanbanLaneLabel(lane, language)}</h3>
              <span className={`status-pill status-${lane}`}>{lanes[lane].length}</span>
            </div>
            <div className="page-scroll blueprint-kanban-card-list">
              {lanes[lane].length ? (
                lanes[lane].map((card) => (
                  <button
                    key={card.id}
                    type="button"
                    className="feature-card blueprint-kanban-card-button"
                    title={copy.openRun}
                    disabled={!blueprintKanbanCardIsNavigationOnly(card)}
                    onClick={() => onOpenCard(card)}
                  >
                    <div className="blueprint-kanban-card-main">
                      <div className="blueprint-kanban-card-title-row">
                        <strong>{card.title}</strong>
                        <span className={`status-pill status-${card.lane}`}>{blueprintKanbanLaneLabel(card.lane, language)}</span>
                      </div>
                      <p>{card.summary ?? card.runRoomId ?? card.id}</p>
                    </div>
                    <div className="blueprint-kanban-card-meta">
                      <span>
                        <strong>{language === "zh-CN" ? "\u84dd\u56fe" : "Blueprint"}</strong>
                        {blueprintNameForOptional(blueprints, card.blueprintId)}
                      </span>
                      {card.sourceContextType && (
                        <span>
                          <strong>{language === "zh-CN" ? "\u6765\u6e90" : "Source"}</strong>
                          {humanActionContextLabel(card.sourceContextType, language)}
                        </span>
                      )}
                      {card.responseIntent && (
                        <span>
                          <strong>{language === "zh-CN" ? "\u610f\u56fe" : "Intent"}</strong>
                          {humanActionIntentLabel(card.responseIntent, language)}
                        </span>
                      )}
                      <time dateTime={card.updatedAt}>
                        <strong>{language === "zh-CN" ? "\u66f4\u65b0" : "Updated"}</strong>
                        {formatDateTime(card.updatedAt, language)}
                      </time>
                      <ChevronRight size={15} aria-hidden="true" />
                    </div>
                  </button>
                ))
              ) : (
                <div className="empty-state page-empty">{copy.noRecords}</div>
              )}
            </div>
          </div>
        ))}
      </PageBody>
    </PageShell>
  );
}

function blueprintKanbanLaneLabel(lane: BlueprintKanbanCardLane, language: Language): string {
  const labels: Record<BlueprintKanbanCardLane, { en: string; zh: string }> = {
    running: { en: "Running", zh: "\u8fd0\u884c\u4e2d" },
    waiting_user: { en: "Waiting user", zh: "\u7b49\u5f85\u7528\u6237" },
    completed: { en: "Completed", zh: "\u5df2\u5b8c\u6210" },
    failed: { en: "Failed", zh: "\u5931\u8d25" }
  };
  return language === "zh-CN" ? labels[lane].zh : labels[lane].en;
}

function isBlueprintKanbanSourceFilter(value: string): value is "all" | HumanActionRequestSourceContextType {
  return value === "all" || (humanActionRequestSourceContextTypes as readonly string[]).includes(value);
}

function isBlueprintKanbanIntentFilter(value: string): value is "all" | HumanActionRequestResponseIntent {
  return value === "all" || (humanActionRequestResponseIntents as readonly string[]).includes(value);
}

function blueprintNameForOptional(blueprints: BlueprintDefinition[], blueprintId: string | undefined): string {
  if (!blueprintId) return "-";
  return blueprintNameFor(blueprints, blueprintId);
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
  const selectedChannel = channelOptions.find((channel) => channel.id === selectedChannelId);
  const filteredChannels = useMemo(() => filterWizardOptions(channelOptions, channelSearch), [channelOptions, channelSearch]);
  const configuredChannels = openClawConfig?.configuredChannels ?? [];

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
                <article key={`${channel.id}:${account.id}`} className="model-card">
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
                    <span className={account.isDefault ? "default-label" : undefined}>
                      {account.isDefault ? configCopy.defaultAccount : `${configCopy.account}: ${account.id}`}
                    </span>
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
                selectedId={selectedChannelId}
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
  approvals,
  catalog,
  runtime,
  language,
  t,
  onRemove
}: {
  widget: DashboardWidget;
  dashboard?: WorkspaceDashboard;
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

export function IdentityTitle({ kind, id, label }: { kind: IdentityKind; id: string; label: string }) {
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
  if (compact.includes("zhipu")) return "zai";
  if (compact.includes("kimi")) return "moonshot";
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

function buildTraceIssues(
  activeRun: BlueprintRunView | undefined,
  blueprint: BlueprintDefinition | undefined,
  t: Messages,
  language: Language
): TraceIssue[] {
  if (!activeRun) return [];
  const nodesById = new Map((blueprint?.nodes ?? []).map((node) => [node.id, node]));
  const allExecutionRows = buildRunExecutionTraceRows(activeRun, nodesById);
  const displayExecutionRows = filterDisplayedExecutionTraceRows(activeRun, allExecutionRows);
  const runRoomOutputByNodeRunId = buildRunRoomOutputPreviewByNodeRunId(activeRun);
  if (displayExecutionRows.length > 0) {
    return displayExecutionRows
      .sort(compareExecutionTraceRows)
      .map((row, index) => createExecutionTraceIssue(row, index + 1, t, language, runRoomOutputByNodeRunId));
  }

  return allExecutionRows.length === 0 ? [createMissingExecutionFactsTraceIssue(activeRun, 1, t, language)] : [];
}

function createMissingExecutionFactsTraceIssue(
  activeRun: BlueprintRunView,
  index: number,
  t: Messages,
  language: Language
): TraceIssue {
  const zh = language === "zh-CN";
  const title = zh ? "\u6267\u884c\u4e8b\u5b9e\u7f3a\u5931" : "Execution facts missing";
  const body = [
    `## ${title}`,
    "",
    zh
      ? "\u6ca1\u6709 command\u3001step \u6216 execution session facts\uff0c\u56e0\u6b64\u6b64 run \u4e0d\u80fd\u751f\u6210 canonical execution trace\u3002"
      : "No command, step, or execution session facts are available, so this run cannot produce a canonical execution trace.",
    "",
    zh
      ? "\u8fd0\u884c\u9875\u4e0d\u4f1a\u4ece timeline \u5386\u53f2\u3001node id \u524d\u7f00\u6216\u65e7 node output \u518d\u6784\u9020\u7b2c\u4e8c\u5957 trace\u3002"
      : "The run page does not reconstruct a second trace from timeline history, node id prefixes, or old node output."
  ].join("\n");
  return {
    key: `execution-facts-missing:${activeRun.run.id}`,
    index,
    label: title,
    kind: "execution",
    actorKind: "system",
    depth: 0,
    issueStatus: "failed",
    statusLabel: zh ? "\u7f3a\u5c11\u4e8b\u5b9e" : "Missing facts",
    roleTag: roleTagForActorKind("system", language),
    workTags: [zh ? "\u4e8b\u5b9e\u7f3a\u5931" : "Missing facts"],
    timestamp: activeRun.run.startedAt,
    outputPreview: summarizeOutput(body, t),
    outputBody: body,
    events: []
  };
}

function buildRunExecutionTraceRows(
  activeRun: BlueprintRunView,
  nodesById: Map<string, BlueprintNode>
): RunExecutionTraceRow[] {
  const rows: RunExecutionTraceRow[] = [];
  const commands = sortRunCommands(activeRun.runCommands ?? []);
  const stepsByCommandId = groupRunCommandSteps(activeRun.runCommandSteps ?? []);
  const allSteps = sortRunCommandStepsForTrace(activeRun);
  const sessions = sortRunSessionsForTrace(activeRun);
  const sessionsByNodeRunId = groupSessionsByNodeRunId(sessions);
  const consumedStepIds = new Set<string>();
  const consumedSessionIds = new Set<string>();
  let order = 0;

  for (const command of commands) {
    const steps = stepsByCommandId.get(command.id) ?? [];
    if (steps.length === 0) {
      rows.push(buildCommandOnlyTraceRow(activeRun, command, order++));
      continue;
    }

    for (const step of steps) {
      consumedStepIds.add(step.id);
      const stepSessions = sessionsForStep(step, sessionsByNodeRunId).filter((session) => !consumedSessionIds.has(session.id));
      if (stepSessions.length === 0) {
        rows.push(buildStepTraceRow({
          activeRun,
          nodesById,
          command,
          step,
          session: undefined,
          order: order++
        }));
        continue;
      }

      for (const session of stepSessions) {
        consumedSessionIds.add(session.id);
        rows.push(buildStepTraceRow({
          activeRun,
          nodesById,
          command,
          step,
          session,
          order: order++
        }));
      }
    }
  }

  const commandIds = new Set(commands.map((command) => command.id));
  for (const step of allSteps) {
    if (consumedStepIds.has(step.id) || commandIds.has(step.commandId)) continue;
    const stepSessions = sessionsForStep(step, sessionsByNodeRunId).filter((session) => !consumedSessionIds.has(session.id));
    if (stepSessions.length === 0) {
      rows.push(buildStepTraceRow({
        activeRun,
        nodesById,
        command: undefined,
        step,
        session: undefined,
        order: order++
      }));
      continue;
    }
    for (const session of stepSessions) {
      consumedSessionIds.add(session.id);
      rows.push(buildStepTraceRow({
        activeRun,
        nodesById,
        command: undefined,
        step,
        session,
        order: order++
      }));
    }
  }

  for (const session of sessions) {
    if (consumedSessionIds.has(session.id)) continue;
    rows.push(buildSessionOnlyTraceRow({
      activeRun,
      nodesById,
      session,
      order: order++
    }));
    consumedSessionIds.add(session.id);
  }

  return rows;
}

function filterDisplayedExecutionTraceRows(
  activeRun: BlueprintRunView,
  rows: RunExecutionTraceRow[]
): RunExecutionTraceRow[] {
  const outputSourceNodeRunIds = collectRunRoomOutputSourceNodeRunIds(activeRun);
  const managerSlotNodeRunIds = new Set(activeRun.nodeRuns
    .filter((nodeRun) => nodeRun.nodeType === "manager_slot")
    .map((nodeRun) => nodeRun.id));
  return rows.filter((row) => isDisplayedExecutionTraceRow(row, outputSourceNodeRunIds, managerSlotNodeRunIds));
}

function collectRunRoomOutputSourceNodeRunIds(activeRun: BlueprintRunView): Set<string> {
  const sourceIds = new Set<string>();
  for (const event of activeRun.runRoomOutput?.events ?? []) {
    if (event.sourceType !== "blueprint_node_run" || !event.sourceId) continue;
    if (
      event.kind === "message_started" ||
      event.kind === "message_delta" ||
      event.kind === "message_completed" ||
      event.kind === "message_failed"
    ) {
      sourceIds.add(event.sourceId);
    }
  }
  return sourceIds;
}

function buildRunRoomOutputPreviewByNodeRunId(activeRun: BlueprintRunView): Map<string, string> {
  const outputByNodeRunId = new Map<string, string>();
  for (const message of buildRunRoomOutputMessagesForDisplay(activeRun)) {
    const nodeRunId = message.runRoomInvocationId;
    const content = message.content.trim();
    if (!nodeRunId || !content) continue;
    outputByNodeRunId.set(nodeRunId, content);
  }
  return outputByNodeRunId;
}

function isDisplayedExecutionTraceRow(
  row: RunExecutionTraceRow,
  outputSourceNodeRunIds: Set<string>,
  managerSlotNodeRunIds: Set<string>
): boolean {
  const nodeRunId = row.step?.nodeRunId ?? row.session?.nodeRunId;
  if (row.node?.type === "manager_slot" || (nodeRunId && managerSlotNodeRunIds.has(nodeRunId))) return false;
  if (row.step?.mode && row.step.mode !== "node_execution") return true;
  if (row.session) return true;
  if (nodeRunId && outputSourceNodeRunIds.has(nodeRunId)) return true;
  return row.runtimeRefs.length > 0;
}

function buildCommandOnlyTraceRow(
  activeRun: BlueprintRunView,
  command: RunCommandFact,
  order: number
): RunExecutionTraceRow {
  return {
    key: `execution-command:${command.id}`,
    command,
    actorLabel: runCommandKindLabel(command.kind, "en"),
    actorKind: "system",
    status: command.status,
    startedAt: command.startedAt,
    endedAt: command.endedAt,
    createdAt: command.startedAt ?? command.createdAt ?? activeRun.run.startedAt,
    order,
    runtimeRefs: []
  };
}

function buildStepTraceRow({
  activeRun,
  nodesById,
  command,
  step,
  session,
  order
}: {
  activeRun: BlueprintRunView;
  nodesById: Map<string, BlueprintNode>;
  command?: RunCommandFact;
  step: RunCommandStepFact;
  session?: RunExecutionSession;
  order: number;
}): RunExecutionTraceRow {
  const node = nodesById.get(step.nodeId);
  const runtimeRefs = collectExecutionRuntimeRefs(step.runtimeRef, session?.runtimeRef);
  const actorLabel = node?.config.label ?? step.nodeId;
  return {
    key: `execution-step:${step.id}${session ? `:${session.id}` : ""}`,
    command,
    step,
    session,
    node,
    mode: step.mode,
    actorLabel,
    actorKind: traceActorKindForBlueprintNode(node),
    status: step.status,
    startedAt: step.startedAt ?? session?.createdAt,
    endedAt: step.endedAt,
    createdAt: step.startedAt ?? session?.createdAt ?? step.createdAt ?? activeRun.run.startedAt,
    order,
    runtimeRefs
  };
}

function buildSessionOnlyTraceRow({
  activeRun,
  nodesById,
  session,
  order
}: {
  activeRun: BlueprintRunView;
  nodesById: Map<string, BlueprintNode>;
  session: RunExecutionSession;
  order: number;
}): RunExecutionTraceRow {
  const node = nodesById.get(session.nodeId);
  return {
    key: `execution-session:${session.id}`,
    session,
    node,
    actorLabel: node?.config.label ?? session.nodeId,
    actorKind: traceActorKindForBlueprintNode(node),
    status: session.status,
    startedAt: session.createdAt,
    endedAt: session.status === "completed" || session.status === "failed" ? session.updatedAt : undefined,
    createdAt: session.createdAt ?? activeRun.run.startedAt,
    order,
    runtimeRefs: collectExecutionRuntimeRefs(session.runtimeRef, undefined)
  };
}

function sortRunCommandStepsForTrace(activeRun: BlueprintRunView): RunCommandStepFact[] {
  const commandOrderById = new Map(sortRunCommands(activeRun.runCommands ?? []).map((command, index) => [command.id, index]));
  return [...(activeRun.runCommandSteps ?? [])].sort((left, right) => {
    const commandOrder = (commandOrderById.get(left.commandId) ?? Number.MAX_SAFE_INTEGER) -
      (commandOrderById.get(right.commandId) ?? Number.MAX_SAFE_INTEGER);
    if (commandOrder !== 0) return commandOrder;
    const revisionOrder = left.revision - right.revision;
    if (revisionOrder !== 0) return revisionOrder;
    return compareByTimestampThenId(left.createdAt, right.createdAt, left.id, right.id);
  });
}

function sortRunSessionsForTrace(activeRun: BlueprintRunView): RunExecutionSession[] {
  const stepOrderByNodeRunId = new Map<string, number>();
  sortRunCommandStepsForTrace(activeRun).forEach((step, index) => {
    if (step.nodeRunId && !stepOrderByNodeRunId.has(step.nodeRunId)) {
      stepOrderByNodeRunId.set(step.nodeRunId, index);
    }
  });
  return [...(activeRun.nodeExecutionSessions ?? [])].sort((left, right) => {
    const stepOrder = (stepOrderByNodeRunId.get(left.nodeRunId) ?? Number.MAX_SAFE_INTEGER) -
      (stepOrderByNodeRunId.get(right.nodeRunId) ?? Number.MAX_SAFE_INTEGER);
    if (stepOrder !== 0) return stepOrder;
    const timestampOrder = toSafeTimestamp(left.createdAt ?? "") - toSafeTimestamp(right.createdAt ?? "");
    if (timestampOrder !== 0) return timestampOrder;
    return left.id.localeCompare(right.id);
  });
}

function groupSessionsByNodeRunId(sessions: RunExecutionSession[]): Map<string, RunExecutionSession[]> {
  const grouped = new Map<string, RunExecutionSession[]>();
  for (const session of sessions) {
    grouped.set(session.nodeRunId, [...(grouped.get(session.nodeRunId) ?? []), session]);
  }
  return grouped;
}

function sessionsForStep(
  step: RunCommandStepFact,
  sessionsByNodeRunId: Map<string, RunExecutionSession[]>
): RunExecutionSession[] {
  return step.nodeRunId ? sessionsByNodeRunId.get(step.nodeRunId) ?? [] : [];
}

function collectExecutionRuntimeRefs(
  stepRuntimeRef: RunCommandStepFact["runtimeRef"] | undefined,
  sessionRuntimeRef: RunExecutionSession["runtimeRef"] | undefined
): Array<NonNullable<RunCommandStepFact["runtimeRef"]>> {
  const refs = [stepRuntimeRef, sessionRuntimeRef]
    .filter((ref): ref is NonNullable<RunCommandStepFact["runtimeRef"]> => Boolean(ref));
  const seen = new Set<string>();
  return refs.filter((ref) => {
    const key = `${ref.source}:${ref.sourceId}:${ref.taskId ?? ""}:${ref.sessionKey ?? ""}:${ref.messageId ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function compareExecutionTraceRows(left: RunExecutionTraceRow, right: RunExecutionTraceRow): number {
  return left.order - right.order || toSafeTimestamp(left.createdAt) - toSafeTimestamp(right.createdAt) || left.key.localeCompare(right.key);
}

function createExecutionTraceIssue(
  row: RunExecutionTraceRow,
  index: number,
  t: Messages,
  language: Language,
  runRoomOutputByNodeRunId: Map<string, string>
): TraceIssue {
  const label = executionTraceRowLabel(row, language);
  const body = buildExecutionTraceIssueBody(row, language);
  const nodeRunId = row.step?.nodeRunId ?? row.session?.nodeRunId;
  const previewSource = row.step?.error ??
    row.command?.error ??
    (nodeRunId ? runRoomOutputByNodeRunId.get(nodeRunId) : undefined) ??
    executionTraceRowSummary(row, language);
  return {
    key: row.key,
    index,
    label,
    kind: "execution",
    actorKind: row.actorKind,
    depth: row.node?.parentId ? 1 : 0,
    node: row.node,
    executionRow: row,
    issueStatus: toExecutionTraceIssueStatus(row.status),
    statusLabel: runExecutionStatusLabel(row.status, language),
    roleTag: roleTagForActorKind(row.actorKind, language),
    workTags: workTagsForExecutionTraceRow(row, label, language),
    timestamp: row.startedAt ?? row.createdAt,
    outputPreview: summarizeOutput(buildCurrentOutputPreviewBody(previewSource, language), t),
    outputBody: body,
    events: []
  };
}

function executionTraceRowLabel(row: RunExecutionTraceRow, language: Language): string {
  const actor = cleanTraceActorLabel(row.actorLabel);
  const mode = row.mode ? runCommandStepModeLabel(row.mode, language) : undefined;
  return mode ? `${actor} / ${mode}` : actor;
}

function buildExecutionTraceIssueBody(row: RunExecutionTraceRow, language: Language): string {
  const zh = language === "zh-CN";
  const facts = [
    row.mode ? `${zh ? "\u6a21\u5f0f" : "Mode"}: ${runCommandStepModeLabel(row.mode, language)}` : undefined,
    row.command ? `${zh ? "\u547d\u4ee4" : "Command"}: ${runCommandKindLabel(row.command.kind, language)} (${row.command.commandKey})` : undefined,
    row.step ? `${zh ? "\u6b65\u9aa4" : "Step"}: ${row.step.stepKey}` : undefined,
    `${zh ? "\u72b6\u6001" : "Status"}: ${runExecutionStatusLabel(row.status, language)}`,
    row.startedAt ? `${zh ? "\u5f00\u59cb" : "Started"}: ${formatTraceTime(row.startedAt, language)}` : undefined,
    row.endedAt ? `${zh ? "\u7ed3\u675f" : "Ended"}: ${formatTraceTime(row.endedAt, language)}` : undefined,
    row.session ? `${zh ? "Session" : "Session"}: ${row.session.nativeSessionId ?? row.session.id}` : undefined,
    row.session ? `${zh ? "Harness" : "Harness"}: ${row.session.harnessId}` : undefined
  ].filter((line): line is string => Boolean(line));
  const runtimeRefs = row.runtimeRefs.map(formatRuntimeObjectRefForTrace);
  return [
    `## ${zh ? "\u6267\u884c\u4e8b\u5b9e" : "Execution facts"}`,
    "",
    executionTraceRowSummary(row, language),
    "",
    facts.join("\n"),
    runtimeRefs.length > 0 ? "" : undefined,
    runtimeRefs.length > 0 ? `## ${zh ? "\u8fd0\u884c\u65f6\u5f15\u7528" : "Runtime refs"}` : undefined,
    runtimeRefs.length > 0 ? "" : undefined,
    runtimeRefs.join("\n")
  ].filter((part): part is string => part !== undefined && part.trim().length > 0).join("\n");
}

function executionTraceRowSummary(row: RunExecutionTraceRow, language: Language): string {
  const zh = language === "zh-CN";
  const mode = row.mode ? runCommandStepModeLabel(row.mode, language) : undefined;
  const actor = cleanTraceActorLabel(row.actorLabel);
  if (mode) {
    return zh
      ? `${actor} \u7684 ${mode} \u6b65\u9aa4\u6765\u81ea command/step/session \u4e8b\u5b9e\u3002`
      : `${actor} ${mode} is projected from command, step, and session facts.`;
  }
  return zh
    ? `${actor} \u6765\u81ea execution fact \u6295\u5f71\u3002`
    : `${actor} is projected from execution facts.`;
}

function formatRuntimeObjectRefForTrace(ref: NonNullable<RunCommandStepFact["runtimeRef"]>): string {
  const parts = [
    `${ref.source}:${ref.sourceId}`,
    ref.taskId ? `task=${ref.taskId}` : undefined,
    ref.sessionKey ? `session=${ref.sessionKey}` : undefined,
    ref.messageId ? `message=${ref.messageId}` : undefined
  ].filter((part): part is string => Boolean(part));
  return `- ${parts.join(" / ")}`;
}

function toExecutionTraceIssueStatus(status: string): TraceIssueStatus {
  if (status === "queued" || status === "running" || status === "waiting_approval" || status === "active" || status === "paused") {
    return "in_progress";
  }
  if (status === "failed" || status === "cancelled" || status === "unavailable") return "failed";
  return "completed";
}

function workTagsForExecutionTraceRow(row: RunExecutionTraceRow, label: string, language: Language): string[] {
  if (row.mode) return [workTagForExecutionMode(row.mode, language)];
  return [workTagFromLabel(label, language)];
}

function workTagForExecutionMode(mode: RunCommandStepFact["mode"], language: Language): string {
  if (isRunPreflightMode(mode)) return preflightWorkTag(mode, language);
  if (mode === "release_report") return reportPublishWorkTag(language);
  return language === "zh-CN" ? "\u6267\u884c" : "Execution";
}

function isRunPreflightMode(mode: RunCommandStepFact["mode"]): mode is RunPreflightMode {
  return mode === "research_resolution" ||
    mode === "requirement_resolution" ||
    mode === "revise_plan" ||
    mode === "preflight_judgment" ||
    mode === "context_snapshot";
}

function cleanTraceActorLabel(label: string): string {
  return label
    .replace(/\s+dispatch\s+\d+$/i, "")
    .replace(/\s*[\u00b7-]\s*\u8c03\u5ea6\s*\d+$/i, "")
    .trim();
}

function traceActorKindForBlueprintNode(node: BlueprintNode | undefined): TraceIssue["actorKind"] {
  if (!node) return "agent";
  if (node.type === "manager" || node.type === "manager_slot") return "manager";
  return "agent";
}

function roleTagForActorKind(kind: TraceIssue["actorKind"], language: Language): string {
  const zh = language === "zh-CN";
  if (kind === "manager") return "Manager";
  if (kind === "agent") return "Agent";
  if (kind === "user") return zh ? "\u7528\u6237" : "User";
  return zh ? "\u7cfb\u7edf" : "System";
}

function preflightWorkTag(mode: RunPreflightMode, language: Language): string {
  const zh = language === "zh-CN";
  if (mode === "research_resolution") return zh ? "\u8c03\u7814" : "Research";
  if (mode === "requirement_resolution") return zh ? "\u63d0\u9700" : "Requirements";
  if (mode === "revise_plan" || mode === "preflight_judgment") return zh ? "\u8ba1\u5212" : "Planning";
  if (mode === "context_snapshot") return zh ? "\u590d\u76d8\u6c89\u6dc0" : "Review memory";
  return zh ? "\u51c6\u5907" : "Prep";
}

function dispatchWorkTag(language: Language): string {
  return language === "zh-CN" ? "\u8c03\u5ea6" : "Dispatch";
}

function reportPublishWorkTag(language: Language): string {
  return language === "zh-CN" ? "\u62a5\u544a\u53d1\u5e03" : "Report publish";
}

function workTagTone(tag: string): string {
  const normalized = tag.trim().toLowerCase();
  if (/\u62a5\u544a\u53d1\u5e03|report publish|publish report/.test(normalized)) return "review";
  if (/调研|research/.test(normalized)) return "research";
  if (/提需|需求|requirements?/.test(normalized)) return "requirements";
  if (/计划|planning|prep/.test(normalized)) return "planning";
  if (/调度|dispatch/.test(normalized)) return "dispatch";
  if (/页面|html|page/.test(normalized)) return "page";
  if (/qa|验收|quality/.test(normalized)) return "qa";
  if (/复盘|review|summary|汇总/.test(normalized)) return "review";
  if (/产物|artifact/.test(normalized)) return "artifact";
  if (/异常|issue|failed|error/.test(normalized)) return "issue";
  return "default";
}

function workTagFromLabel(label: string, language: Language, nodeType?: BlueprintNodeRun["nodeType"]): string {
  const zh = language === "zh-CN";
  if (nodeType === "manager" || /manager|dispatch|调度|经理/i.test(label)) return dispatchWorkTag(language);
  if (/需求分析|需求规划|提需|requirement/i.test(label)) return zh ? "提需" : "Requirements";
  if (/页面|HTML|page/i.test(label)) return zh ? "页面制作" : "Page build";
  if (/QA|验收|quality/i.test(label)) return zh ? "QA 验收" : "QA";
  if (/调研|research/i.test(label)) return zh ? "调研" : "Research";
  if (nodeType === "summary") return zh ? "汇总" : "Summary";
  return label
    .replace(/\s*(Agent|Manager|代理|智能体|经理)\s*$/i, "")
    .replace(/\s+dispatch\s+\d+$/i, "")
    .trim() || (zh ? "执行" : "Work");
}

function traceIssueStatusLabel(status: TraceIssueStatus, language: Language): string {
  const zh = language === "zh-CN";
  if (status === "completed") return zh ? "成功" : "Success";
  if (status === "failed") return zh ? "失败" : "Failed";
  if (status === "in_progress") return zh ? "运行中" : "Running";
  return zh ? "等待中" : "Waiting";
}

function traceIssueIcon(kind: TraceIssue["actorKind"]): ReactNode {
  if (kind === "manager") return <BotMessageSquare size={15} />;
  if (kind === "agent") return <Bot size={15} />;
  if (kind === "user") return <UserRound size={15} />;
  return <Activity size={15} />;
}

function formatTraceTime(value: string, language: Language): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString(language, { hour: "2-digit", minute: "2-digit" });
}

function traceRunFrameState(status?: BlueprintRunStatus): "static" | "running" | "succeeded" | "failed" {
  if (status === "queued" || status === "running" || status === "waiting_approval") return "running";
  if (status === "succeeded") return "succeeded";
  if (status === "failed" || status === "cancelled") return "failed";
  return "static";
}

function summarizeOutput(output: unknown, t: Messages): string {
  const normalized = formatOutput(output ?? "");
  if (!normalized.trim()) return t.trace.noOutput;
  const previewLines = normalized
    .split("\n")
    .map(toTracePreviewLine)
    .map(firstTraceSentence)
    .filter(Boolean)
    .slice(0, 1);
  if (!previewLines.length) return t.trace.noOutput;
  return previewLines.map((line) => (line.length > 120 ? `${line.slice(0, 117)}...` : line)).join("\n");
}

function firstTraceSentence(line: string): string {
  const trimmed = line.trim();
  const match = trimmed.match(/^(.+?[\u3002\uff01\uff1f!?]|.+?\.(?=\s|$))/);
  return (match?.[1] ?? trimmed).trim();
}

function toTracePreviewLine(line: string): string {
  const trimmed = line.trim();
  if (!trimmed) return "";
  if (/^#{1,6}\s+/.test(trimmed)) return "";
  if (trimmed.startsWith("```")) return "";
  if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) return "";
  if (isTracePreviewTableSeparator(trimmed)) return "";
  if (isTracePreviewBoilerplate(trimmed)) return "";

  const tableCells = parseTracePreviewTableCells(trimmed);
  if (tableCells.length > 1) return tableCells.filter(Boolean).join(" ");

  return trimmed
    .replace(/^>\s?/, "")
    .replace(/^\s{0,3}[-*+]\s+/, "")
    .replace(/^\s{0,3}\d+[.)]\s+/, "")
    .trim();
}

function isTracePreviewBoilerplate(line: string): boolean {
  const normalized = line
    .replace(/^>\s?/, "")
    .replace(/^\s{0,3}[-*+]\s+/, "")
    .replace(/^\s{0,3}\d+[.)]\s+/, "")
    .trim();
  return /^本步骤没有产生新的交付物[。.]?/.test(normalized) ||
    /^无新文件产物[；;，,。.]?/.test(normalized) ||
    /^Delivery location\s*\/\s*交付位置/i.test(normalized) ||
    /^交付位置[：:]?/.test(normalized);
}

function parseTracePreviewTableCells(line: string): string[] {
  if (!line.includes("|")) return [];
  let row = line.trim();
  if (row.startsWith("|")) row = row.slice(1);
  if (row.endsWith("|")) row = row.slice(0, -1);
  return row.split("|").map((cell) => cell.trim());
}

function isTracePreviewTableSeparator(line: string): boolean {
  const cells = parseTracePreviewTableCells(line);
  return cells.length > 1 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function widgetTypeLabel(type: DashboardWidgetType, t: Messages): string {
  if (type === "pending_approvals") return t.widgetTypes.approvals;
  if (type === "runtime_overview") return t.common.realTime;
  if (type === "catalog_status") return t.widgetTypes.catalog;
  return t.widgetTypes.notes;
}

function isRenderableDashboardWidgetType(type: string): type is "pending_approvals" | "runtime_overview" | "catalog_status" {
  return type === "pending_approvals" || type === "runtime_overview" || type === "catalog_status";
}

function blueprintNameFor(blueprints: BlueprintDefinition[], blueprintId: string): string {
  return blueprints.find((blueprint) => blueprint.id === blueprintId)?.name ?? blueprintId;
}

export type ModelUsageSummary = {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  days: Map<string, ModelUsageDay>;
};

export type ModelUsageDay = {
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

function addDays(value: Date, days: number): Date {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
}

function startOfLocalDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function normalizeDateRange(startDate: string, endDate: string): [string, string] {
  if (!startDate) return [endDate, endDate];
  if (!endDate) return [startDate, startDate];
  return startDate <= endDate ? [startDate, endDate] : [endDate, startDate];
}

function isRunInDateRange(runView: BlueprintRunView, startDate: string, endDate: string): boolean {
  const startedAt = toDateInputValue(runView.run.startedAt);
  const endedAt = toDateInputValue(runView.run.endedAt ?? runView.run.startedAt);
  if (!startedAt || !endedAt) return false;
  return endedAt >= startDate && startedAt <= endDate;
}

function isLocalDateInRange(value: string, startDate: string, endDate: string): boolean {
  const dateKey = toDateInputValue(value);
  return Boolean(dateKey && dateKey >= startDate && dateKey <= endDate);
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

function toSafeTimestamp(value: string): number {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function getBrowserStorage(): Storage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function normalizeAgentId(value: string): string {
  const trimmed = value.trim().toLowerCase();
  return trimmed.replace(/[^a-z0-9_-]+/g, "-").replace(/^-+/g, "").replace(/-+$/g, "").slice(0, 64) || "main";
}
