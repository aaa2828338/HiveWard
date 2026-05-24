import { Router, type Response } from "express";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { cp, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { nanoid } from "nanoid";
import type {
  AgentNodeConfig,
  ApproveInboxItemRequest,
  CatalogSnapshot,
  ChatRoleScope,
  CreateCompanyRequest,
  ConfigureOpenClawChannelRequest,
  ConfigureOpenClawModelAuthRequest,
  CreateOpenClawChannelRequest,
  CreateBlueprintRequest,
  CreateBlueprintProposalRequest,
  CreateOpenClawAgentRequest,
  CreateOpenClawModelRequest,
  CreateLeaderDelegationRequest,
  HarnessId,
  HarnessModelOption,
  HarnessSkillInstallCandidate,
  HarnessSkillInstallCandidateSource,
  HarnessSkillId,
  HarnessSkillStatusItem,
  HarnessSkillStatusResponse,
  HarnessStatus,
  ImportBlueprintPackageRequest,
  InstallHarnessSkillsResponse,
  RuntimeOverview,
  OpenClawConfiguredAgent,
  OpenClawConfiguredChannel,
  OpenClawConfigState,
  OpenClawObjectSource,
  OpenClawVersionInfo,
  ManagerNodeConfig,
  ParallelAgentsNodeConfig,
  SummaryNodeConfig,
  UpdateOpenClawDefaultModelRequest,
  SelectCompanyRequest,
  SaveDashboardStateRequest,
  SaveBlueprintRequest,
  ChatAttachment,
  ChatHistoryMessage,
  ChatMode,
  ChatRuntimeRef,
  ChatSessionStatus,
  ChatThinkingEffort,
  ApproveBlueprintRunRequest,
  CreateChatSessionRequest,
  CreateHivewardChatSessionRequest,
  InboxItem,
  RejectInboxItemRequest,
  SendChatSessionMessageRequest,
  UpdateChatSessionTitleRequest,
  UpdateHivewardChatSessionRequest,
  ChatStreamEvent,
  BlueprintDefinition,
  HivewardChatMessage,
  HivewardChatSession,
  StartBlueprintRunRequest
} from "@hiveward/shared";
import { createPortableBlueprintPackage, isAgentBlueprintNode, readPortableBlueprintPackage } from "@hiveward/shared";
import { buildHivewardRoleSkillPrompt, hivewardInboxSubmissionContract, hivewardInboxSubmissionSchema } from "@hiveward/shared";
import type { RuntimeAdapter } from "@hiveward/adapter";
import type { FileHivewardStore } from "../store/fileHivewardStore";
import type { OpenClawConfigStore } from "../store/openClawConfigStore";
import { listOpenClawModelUsage } from "../store/openClawUsageStore";
import type { BlueprintWorker } from "../worker/blueprintWorker";

interface ApiRouterDeps {
  store: FileHivewardStore;
  openClawConfigStore: OpenClawConfigStore;
  adapter: RuntimeAdapter;
  worker: BlueprintWorker;
}

interface RunModelDefaults {
  openclaw?: string;
  codex?: string;
  claude?: string;
}

interface HarnessModelDefaults extends Pick<RunModelDefaults, "codex" | "claude"> {
  codexModels: HarnessModelOption[];
  claudeModels: HarnessModelOption[];
}

type ChatDoneEvent = Extract<ChatStreamEvent, { type: "done" }>;

type ChatInboxSubmissionResult = {
  item: InboxItem;
  output: string;
};

type ChatInboxSubmissionBlock = {
  fullMatch: string;
  json: string;
};

type StreamHivewardChatSessionInput = {
  sessionId: string;
  body: SendChatSessionMessageRequest;
  requestStartedAtMs: number;
  store: FileHivewardStore;
  openClawConfigStore: OpenClawConfigStore;
  adapter: RuntimeAdapter;
  res: Response;
};

type ResolvedChatSessionMessage = {
  harnessId: HarnessId;
  message: string;
  attachments?: ChatAttachment[];
  modelId?: string;
  agentId?: string;
  nativeSessionKey?: string;
  thinkingEffort?: ChatThinkingEffort;
  includePlatformContext?: boolean;
  mode?: ChatMode;
  roleScope?: ChatRoleScope;
};

type HarnessSkillInstallCandidateInput = {
  root: string;
  source: HarnessSkillInstallCandidateSource;
  label: string;
};

type HarnessSkillInstallTarget = {
  root: string;
  candidates: HarnessSkillInstallCandidate[];
};

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const fallbackCodexDefaultModel = "gpt-5.4";
const fallbackClaudeCodeDefaultModel = "inherit";
const codexDefaultThinkingLevels: ChatThinkingEffort[] = ["low", "medium", "high", "xhigh"];
const claudeCodeDefaultThinkingLevels: ChatThinkingEffort[] = ["off", "low", "medium", "high", "xhigh", "max", "adaptive"];
const hivewardHarnessSkills: Array<{
  id: HarnessSkillId;
  label: string;
  sourceDir: string;
}> = [
  {
    id: "hiveward-ceo",
    label: "HiveWard CEO",
    sourceDir: join(repositoryRoot, "docs", "skills", "hiveward-ceo")
  },
  {
    id: "hiveward-leader",
    label: "HiveWard Leader",
    sourceDir: join(repositoryRoot, "docs", "skills", "hiveward-leader")
  }
];

export function createApiRouter({ store, openClawConfigStore, adapter, worker }: ApiRouterDeps): Router {
  const router = Router();

  router.get("/healthz", (_req, res) => {
    res.json({ ok: true });
  });

  router.get("/readyz", (_req, res) => {
    res.json({ ok: true, runtimeDiscovery: "not_on_readiness_path" });
  });

  router.get("/api/companies", async (_req, res, next) => {
    try {
      res.json(await store.listCompanies());
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/companies", async (req, res, next) => {
    try {
      const body = req.body as CreateCompanyRequest;
      res.status(201).json(await store.createCompany(body));
    } catch (error) {
      next(error);
    }
  });

  router.put("/api/companies/selected", async (req, res, next) => {
    try {
      const body = req.body as SelectCompanyRequest;
      res.json(await store.selectCompany(body.companyId));
    } catch (error) {
      next(error);
    }
  });

  router.delete("/api/companies/:companyId", async (req, res, next) => {
    try {
      res.json(await store.deleteCompany(req.params.companyId));
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/openclaw-config", async (_req, res, next) => {
    try {
      res.json({ config: await openClawConfigStore.getState() });
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/openclaw-version", async (_req, res, next) => {
    try {
      res.json({ version: await openClawConfigStore.getVersion() });
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/harness-status", async (_req, res, next) => {
    try {
      const [version, config] = await Promise.all([openClawConfigStore.getVersion(), openClawConfigStore.getState()]);
      res.json({ statuses: buildHarnessStatuses(version, config, resolveHarnessModelDefaults()) });
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/harness-skills/:harnessId", async (req, res, next) => {
    try {
      const harnessId = readHarnessId(req.params.harnessId);
      res.json(await buildHarnessSkillStatusResponse(harnessId, openClawConfigStore));
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/harness-skills/:harnessId/install", async (req, res, next) => {
    try {
      const harnessId = readHarnessId(req.params.harnessId);
      res.status(201).json(await installHarnessSkills(harnessId, openClawConfigStore));
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/openclaw-usage/models", async (_req, res, next) => {
    try {
      res.json({ usage: await listOpenClawModelUsage() });
    } catch (error) {
      next(error);
    }
  });

  router.put("/api/openclaw-config/default-model", async (req, res, next) => {
    try {
      const body = req.body as UpdateOpenClawDefaultModelRequest;
      res.json({ config: await openClawConfigStore.updateDefaultModel(body.modelId) });
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/openclaw-config/wizard", (_req, res, next) => {
    try {
      res.json({ wizard: openClawConfigStore.getWizardMetadata() });
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/openclaw-config/models", async (req, res, next) => {
    try {
      const body = req.body as CreateOpenClawModelRequest;
      res.status(201).json({ config: await openClawConfigStore.addModel(body) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/openclaw-config/model-auth", async (req, res, next) => {
    try {
      const body = req.body as ConfigureOpenClawModelAuthRequest;
      res.status(201).json({ config: await openClawConfigStore.configureModelAuth(body) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/openclaw-config/agents", async (req, res, next) => {
    try {
      const body = req.body as CreateOpenClawAgentRequest;
      res.status(201).json({ config: await openClawConfigStore.addAgent(body) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/openclaw-config/channels", async (req, res, next) => {
    try {
      const body = req.body as CreateOpenClawChannelRequest;
      res.status(201).json({ config: await openClawConfigStore.addChannel(body) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/openclaw-config/channel-setup", async (req, res, next) => {
    try {
      const body = req.body as ConfigureOpenClawChannelRequest;
      res.status(201).json({ config: await openClawConfigStore.configureChannel(body) });
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/blueprints", async (_req, res, next) => {
    try {
      res.json({ blueprints: await store.listBlueprints() });
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/blueprints", async (req, res, next) => {
    try {
      const body = req.body as CreateBlueprintRequest;
      const blueprint = await store.createBlueprint({
        name: body.name,
        description: body.description
      });
      res.status(201).json({ blueprint });
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/blueprints/import", async (req, res, next) => {
    try {
      const body = req.body as ImportBlueprintPackageRequest;
      const blueprintPackage = readPortableBlueprintPackage(body.blueprintPackage);
      const config = await openClawConfigStore.getState();
      const blueprints = await store.importBlueprintPackage(blueprintPackage, {
        openclawAgentId: selectDefaultAgentId(config.configuredAgents),
        modelId: config.defaultModelId,
        channelId: selectDefaultChannelId(config.configuredChannels)
      });
      res.status(201).json({ blueprints });
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/blueprints/:blueprintId", async (req, res, next) => {
    try {
      const blueprintId = readRouteParam(req.params.blueprintId, "blueprintId");
      const blueprint = await store.getBlueprint(blueprintId);
      if (!blueprint) {
        res.status(404).json({ error: { code: "blueprint_not_found", message: "Blueprint not found." } });
        return;
      }
      res.json({ blueprint });
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/blueprints/:blueprintId/export", async (req, res, next) => {
    try {
      const blueprintId = readRouteParam(req.params.blueprintId, "blueprintId");
      const blueprint = await store.getBlueprint(blueprintId);
      if (!blueprint) {
        res.status(404).json({ error: { code: "blueprint_not_found", message: "Blueprint not found." } });
        return;
      }
      res.json({ blueprintPackage: createPortableBlueprintPackage([blueprint], new Date().toISOString()) });
    } catch (error) {
      next(error);
    }
  });

  router.put("/api/blueprints/:blueprintId", async (req, res, next) => {
    try {
      const body = req.body as SaveBlueprintRequest;
      const saved = await store.saveBlueprint({
        ...body.blueprint,
        id: readRouteParam(req.params.blueprintId, "blueprintId")
      });
      res.json({ blueprint: saved });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/api/blueprints/:blueprintId", async (req, res, next) => {
    try {
      const blueprintId = readRouteParam(req.params.blueprintId, "blueprintId");
      const deleted = await store.deleteBlueprint(blueprintId);
      if (!deleted) {
        res.status(404).json({ error: { code: "blueprint_not_found", message: "Blueprint not found." } });
        return;
      }
      res.json({ blueprintId });
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/blueprints/:blueprintId/runs", async (req, res, next) => {
    try {
      const blueprintId = readRouteParam(req.params.blueprintId, "blueprintId");
      const blueprint = await store.getBlueprint(blueprintId);
      if (!blueprint) {
        res.status(404).json({ error: { code: "blueprint_not_found", message: "Blueprint not found." } });
        return;
      }
      const config = await openClawConfigStore.getState();
      const invalidAgentIds = collectInvalidAgentIds(blueprint, new Set(config.configuredAgents.map((agent) => agent.id)));
      if (invalidAgentIds.length > 0) {
        res.status(400).json({
          error: {
            code: "blueprint_agent_invalid",
            message: `Blueprint references agent ids that are not present in OpenClaw config: ${invalidAgentIds.join(", ")}`
          }
        });
        return;
      }
      const body = req.body as StartBlueprintRunRequest;
      const harnessDefaults = resolveHarnessModelDefaults();
      const run = await worker.startRun(
        withRunDefaults(blueprint, {
          openclaw: config.defaultModelId,
          codex: harnessDefaults.codex,
          claude: harnessDefaults.claude
        }),
        body.startedBy ?? "local-user"
      );
      const view = await store.getRunView(run.id);
      res.status(201).json({ run: view });
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/blueprints/:blueprintId/runs/latest", async (req, res, next) => {
    try {
      const blueprintId = readRouteParam(req.params.blueprintId, "blueprintId");
      const blueprint = await store.getBlueprint(blueprintId);
      if (!blueprint) {
        res.status(404).json({ error: { code: "blueprint_not_found", message: "Blueprint not found." } });
        return;
      }
      res.json({ run: (await store.getLatestRunViewForBlueprint(blueprintId)) ?? null });
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/blueprint-runs/:runId", async (req, res, next) => {
    try {
      const view = await store.getRunView(readRouteParam(req.params.runId, "runId"));
      if (!view) {
        res.status(404).json({ error: { code: "run_not_found", message: "Blueprint run not found." } });
        return;
      }
      res.json({ run: view });
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/blueprint-runs", async (_req, res, next) => {
    try {
      res.json({ runs: await store.listRunSummaries() });
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/blueprint-runs/:runId/cancel", async (req, res, next) => {
    try {
      const run = await store.getBlueprintRun(readRouteParam(req.params.runId, "runId"));
      if (!run) {
        res.status(404).json({ error: { code: "run_not_found", message: "Blueprint run not found." } });
        return;
      }
      const updated = await worker.cancelRun(run);
      const view = await store.getRunView(updated.id);
      if (!view) {
        res.status(404).json({ error: { code: "run_not_found", message: "Blueprint run not found." } });
        return;
      }
      res.json({ run: view });
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/approvals/pending", async (_req, res, next) => {
    try {
      res.json({ approvals: await store.listPendingApprovals() });
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/roles", async (_req, res, next) => {
    try {
      res.json(await store.getRoleDirectory());
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/inbox", async (_req, res, next) => {
    try {
      res.json({ items: await store.listInboxItems() });
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/inbox/delegations", async (req, res, next) => {
    try {
      const body = normalizeCreateLeaderDelegationRequest(req.body);
      res.status(201).json({ item: await store.createLeaderDelegationRequest(body) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/inbox/blueprint-proposals", async (req, res, next) => {
    try {
      const body = normalizeCreateBlueprintProposalRequest(req.body);
      res.status(201).json({ item: await store.createBlueprintProposal(body) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/inbox/:itemId/approve", async (req, res, next) => {
    try {
      const body = normalizeApproveInboxItemRequest(req.body);
      const config = await openClawConfigStore.getState();
      res.json(await store.approveInboxItem(readRouteParam(req.params.itemId, "itemId"), {
        openclawAgentId: selectDefaultAgentId(config.configuredAgents),
        modelId: config.defaultModelId,
        channelId: selectDefaultChannelId(config.configuredChannels)
      }, body.comment));
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/inbox/:itemId/reject", async (req, res, next) => {
    try {
      const body = normalizeRejectInboxItemRequest(req.body);
      res.json({ item: await store.rejectInboxItem(readRouteParam(req.params.itemId, "itemId"), body.comment) });
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/dashboard-state", async (_req, res, next) => {
    try {
      res.json({ dashboard: await store.getDashboardState() });
    } catch (error) {
      next(error);
    }
  });

  router.put("/api/dashboard-state", async (req, res, next) => {
    try {
      const body = req.body as SaveDashboardStateRequest;
      res.json({ dashboard: await store.saveDashboardState(body.dashboard) });
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/runtime-overview", async (_req, res) => {
    try {
      res.json({ runtime: await adapter.getRuntimeOverview() });
    } catch (error) {
      res.json({ runtime: emptyRuntimeOverview() });
    }
  });

  router.get("/api/chat/sessions", async (_req, res, next) => {
    try {
      res.json({ sessions: await store.listChatSessions() });
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/chat/sessions", async (req, res) => {
    let body: CreateHivewardChatSessionRequest;
    try {
      body = normalizeCreateHivewardChatSessionRequest(req.body);
    } catch (error) {
      res.status(400).json({
        error: {
          code: "hiveward_chat_session_request_invalid",
          message: error instanceof Error ? error.message : "Invalid HiveWard chat session request."
        }
      });
      return;
    }

    try {
      res.status(201).json({ session: await store.createChatSession(body) });
    } catch (error) {
      res.status(500).json({
        error: {
          code: "hiveward_chat_session_create_failed",
          message: error instanceof Error ? error.message : "HiveWard chat session creation failed."
        }
      });
    }
  });

  router.get("/api/chat/sessions/:sessionId", async (req, res, next) => {
    try {
      const session = await store.getChatSession(readRouteParam(req.params.sessionId, "sessionId"));
      if (!session) {
        res.status(404).json({ error: { code: "chat_session_not_found", message: "Chat session not found." } });
        return;
      }
      res.json({ session });
    } catch (error) {
      next(error);
    }
  });

  router.patch("/api/chat/sessions/:sessionId", async (req, res) => {
    let body: UpdateHivewardChatSessionRequest;
    try {
      body = normalizeUpdateHivewardChatSessionRequest(req.body);
    } catch (error) {
      res.status(400).json({
        error: {
          code: "hiveward_chat_session_update_invalid",
          message: error instanceof Error ? error.message : "Invalid HiveWard chat session update."
        }
      });
      return;
    }

    try {
      const session = await store.updateChatSession(readRouteParam(req.params.sessionId, "sessionId"), body);
      if (!session) {
        res.status(404).json({ error: { code: "chat_session_not_found", message: "Chat session not found." } });
        return;
      }
      if (session.harnessId === "openclaw" && session.nativeSessionId && body.title) {
        await adapter.updateChatSessionTitle({ sessionKey: session.nativeSessionId, title: body.title }).catch(() => undefined);
      }
      res.json({ session });
    } catch (error) {
      res.status(500).json({
        error: {
          code: "hiveward_chat_session_update_failed",
          message: error instanceof Error ? error.message : "HiveWard chat session update failed."
        }
      });
    }
  });

  router.get("/api/chat/sessions/:sessionId/messages", async (req, res, next) => {
    try {
      const sessionId = readRouteParam(req.params.sessionId, "sessionId");
      const session = await store.getChatSession(sessionId);
      if (!session) {
        res.status(404).json({ error: { code: "chat_session_not_found", message: "Chat session not found." } });
        return;
      }
      res.json({ messages: await store.listChatMessages(sessionId) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/chat/sessions/:sessionId/end", async (req, res, next) => {
    try {
      const session = await store.endChatSession(readRouteParam(req.params.sessionId, "sessionId"));
      if (!session) {
        res.status(404).json({ error: { code: "chat_session_not_found", message: "Chat session not found." } });
        return;
      }
      res.json({ session });
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/chat/sessions/:sessionId/messages/stream", async (req, res) => {
    const requestStartedAtMs = Date.now();
    let body: SendChatSessionMessageRequest;
    try {
      body = normalizeSessionChatRequest(req.body);
    } catch (error) {
      res.status(400).json({
        error: {
          code: "chat_request_invalid",
          message: error instanceof Error ? error.message : "Invalid chat request."
        }
      });
      return;
    }

    await streamHivewardChatSession({
      sessionId: readRouteParam(req.params.sessionId, "sessionId"),
      body,
      requestStartedAtMs,
      store,
      openClawConfigStore,
      adapter,
      res
    });
  });

  router.post("/api/chat/session", async (req, res) => {
    let body: CreateChatSessionRequest;
    try {
      body = normalizeCreateChatSessionRequest(req.body);
    } catch (error) {
      res.status(400).json({
        error: {
          code: "chat_session_request_invalid",
          message: error instanceof Error ? error.message : "Invalid chat session request."
        }
      });
      return;
    }

    try {
      const config = await openClawConfigStore.getState();
      const session = await adapter.createChatSession({
        agentId: body.agentId || selectDefaultAgentId(config.configuredAgents),
        parentSessionKey: body.parentSessionKey
      });
      res.status(201).json(session);
    } catch (error) {
      res.status(502).json({
        error: {
          code: "chat_session_unavailable",
          message: error instanceof Error ? error.message : "OpenClaw chat session creation is unavailable."
        }
      });
    }
  });

  router.patch("/api/chat/session", async (req, res) => {
    let body: UpdateChatSessionTitleRequest;
    try {
      body = normalizeUpdateChatSessionTitleRequest(req.body);
    } catch (error) {
      res.status(400).json({
        error: {
          code: "chat_session_title_request_invalid",
          message: error instanceof Error ? error.message : "Invalid chat session title request."
        }
      });
      return;
    }

    try {
      res.json(await adapter.updateChatSessionTitle(body));
    } catch (error) {
      res.status(502).json({
        error: {
          code: "chat_session_title_unavailable",
          message: error instanceof Error ? error.message : "OpenClaw chat session title update is unavailable."
        }
      });
    }
  });

  router.get("/api/chat/history", async (req, res) => {
    const sessionKey = readOptionalString(req.query.sessionKey);
    if (!sessionKey) {
      res.status(400).json({
        error: {
          code: "chat_history_session_required",
          message: "Chat history requires an OpenClaw sessionKey."
        }
      });
      return;
    }

    try {
      const messages = await adapter.getSessionMessages(sessionKey);
      res.json(await syncChatHistoryInboxSubmissions(store, messages));
    } catch (error) {
      res.status(502).json({
        error: {
          code: "chat_history_unavailable",
          message: error instanceof Error ? error.message : "OpenClaw chat history is unavailable."
        }
      });
    }
  });

  router.post("/api/blueprint-runs/:runId/approve", async (req, res, next) => {
    try {
      const run = await store.getBlueprintRun(readRouteParam(req.params.runId, "runId"));
      if (!run) {
        res.status(404).json({ error: { code: "run_not_found", message: "Blueprint run not found." } });
        return;
      }
      const blueprint = await store.getBlueprint(run.blueprintId);
      if (!blueprint) {
        res.status(404).json({ error: { code: "blueprint_not_found", message: "Blueprint not found." } });
        return;
      }
      const body = normalizeApproveBlueprintRunRequest(req.body);
      const updated = await worker.approveRun(blueprint, run, body.nodeRunId);
      const view = await store.getRunView(updated.id);
      res.json({ run: view });
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/catalog/snapshot", async (_req, res, next) => {
    try {
      res.json({ snapshot: (await store.getCatalogSnapshot()) ?? emptyCatalogSnapshot() });
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/catalog/refresh", async (_req, res, next) => {
    try {
      res.json({ snapshot: await refreshCatalog(adapter, store) });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

function normalizeApproveBlueprintRunRequest(value: unknown): ApproveBlueprintRunRequest {
  if (value === undefined || value === null) return {};
  if (!isPlainRecord(value)) {
    throw new Error("Approve request must be a JSON object.");
  }
  return {
    nodeRunId: readOptionalString(value.nodeRunId)
  };
}

function normalizeCreateChatSessionRequest(value: unknown): CreateChatSessionRequest {
  if (!isPlainRecord(value)) {
    throw new Error("Chat session request must be a JSON object.");
  }

  return {
    agentId: readOptionalString(value.agentId),
    parentSessionKey: readOptionalString(value.parentSessionKey)
  };
}

function normalizeCreateHivewardChatSessionRequest(value: unknown): CreateHivewardChatSessionRequest {
  if (!isPlainRecord(value)) {
    throw new Error("HiveWard chat session request must be a JSON object.");
  }
  const harnessId = readHarnessId(readOptionalString(value.harnessId));
  const rawThinkingEffort = readOptionalString(value.thinkingEffort);
  const thinkingEffort = rawThinkingEffort ? normalizeChatThinkingEffort(rawThinkingEffort) : undefined;
  if (rawThinkingEffort && !thinkingEffort) {
    throw new Error("Chat thinkingEffort must be off, minimal, low, medium, high, adaptive, xhigh, or max.");
  }
  return {
    harnessId,
    title: readOptionalString(value.title)?.slice(0, 120),
    nativeSessionId: readOptionalString(value.nativeSessionId),
    modelId: readOptionalString(value.modelId),
    agentId: readOptionalString(value.agentId),
    thinkingEffort,
    mode: normalizeChatMode(value.mode),
    roleScope: normalizeChatRoleScope(value.roleScope)
  };
}

function normalizeUpdateHivewardChatSessionRequest(value: unknown): UpdateHivewardChatSessionRequest {
  if (!isPlainRecord(value)) {
    throw new Error("HiveWard chat session update must be a JSON object.");
  }
  const rawThinkingEffort = readOptionalString(value.thinkingEffort);
  const thinkingEffort = rawThinkingEffort ? normalizeChatThinkingEffort(rawThinkingEffort) : undefined;
  if (rawThinkingEffort && !thinkingEffort) {
    throw new Error("Chat thinkingEffort must be off, minimal, low, medium, high, adaptive, xhigh, or max.");
  }
  const status = normalizeChatSessionStatus(value.status);
  if (value.status !== undefined && !status) {
    throw new Error("Chat session status must be active, ended, native_missing, or failed.");
  }
  const nativeSessionState = normalizeNativeSessionState(value.nativeSessionState);
  if (value.nativeSessionState !== undefined && !nativeSessionState) {
    throw new Error("Native session state must be unknown, resumable, or missing.");
  }
  return {
    title: readOptionalString(value.title)?.slice(0, 120),
    nativeSessionId: readOptionalString(value.nativeSessionId),
    nativeSessionState,
    modelId: readOptionalString(value.modelId),
    agentId: readOptionalString(value.agentId),
    thinkingEffort,
    mode: value.mode === undefined ? undefined : normalizeChatMode(value.mode),
    roleScope: normalizeChatRoleScope(value.roleScope),
    status
  };
}

function normalizeUpdateChatSessionTitleRequest(value: unknown): UpdateChatSessionTitleRequest {
  if (!isPlainRecord(value)) {
    throw new Error("Chat session title request must be a JSON object.");
  }
  const sessionKey = readOptionalString(value.sessionKey);
  const title = readOptionalString(value.title);
  if (!sessionKey) throw new Error("Chat session title request requires sessionKey.");
  if (!title) throw new Error("Chat session title request requires title.");
  return {
    sessionKey,
    title: title.slice(0, 120)
  };
}

function normalizeCreateLeaderDelegationRequest(value: unknown): CreateLeaderDelegationRequest {
  if (!isPlainRecord(value)) {
    throw new Error("Leader delegation request must be a JSON object.");
  }
  const leaderId = readOptionalString(value.leaderId);
  if (!leaderId) throw new Error("Leader delegation request requires leaderId.");
  return {
    leaderId,
    blueprintId: readOptionalString(value.blueprintId),
    title: readOptionalString(value.title),
    summary: readOptionalString(value.summary),
    createdByRoleId: readOptionalString(value.createdByRoleId)
  };
}

function normalizeCreateBlueprintProposalRequest(value: unknown): CreateBlueprintProposalRequest {
  if (!isPlainRecord(value)) {
    throw new Error("Blueprint proposal request must be a JSON object.");
  }
  const title = readOptionalString(value.title);
  const summary = readOptionalString(value.summary);
  if (!title) throw new Error("Blueprint proposal request requires title.");
  if (!summary) throw new Error("Blueprint proposal request requires summary.");
  if (!value.blueprintPackage) {
    throw new Error("Blueprint proposal request requires blueprintPackage.");
  }
  const blueprintPackage = readPortableBlueprintPackage(value.blueprintPackage);
  return {
    title,
    summary,
    blueprintId: readOptionalString(value.blueprintId),
    blueprintPackage,
    preview: isPlainRecord(value.preview) ? value.preview : undefined,
    diffSummary: readOptionalString(value.diffSummary),
    createdByRoleId: readOptionalString(value.createdByRoleId),
    targetRoleId: readOptionalString(value.targetRoleId)
  };
}

function normalizeApproveInboxItemRequest(value: unknown): ApproveInboxItemRequest {
  if (value === undefined || value === null) return {};
  if (!isPlainRecord(value)) {
    throw new Error("Inbox approval request must be a JSON object.");
  }
  return {
    comment: readOptionalString(value.comment)
  };
}

function normalizeRejectInboxItemRequest(value: unknown): RejectInboxItemRequest {
  if (value === undefined || value === null) return {};
  if (!isPlainRecord(value)) {
    throw new Error("Inbox rejection request must be a JSON object.");
  }
  return {
    comment: readOptionalString(value.comment)
  };
}

function normalizeSessionChatRequest(value: unknown): SendChatSessionMessageRequest {
  if (!isPlainRecord(value)) {
    throw new Error("Chat request must be a JSON object.");
  }

  const rawThinkingEffort = readOptionalString(value.thinkingEffort);
  const thinkingEffort = rawThinkingEffort ? normalizeChatThinkingEffort(rawThinkingEffort) : undefined;
  if (rawThinkingEffort && !thinkingEffort) {
    throw new Error("Chat thinkingEffort must be off, minimal, low, medium, high, adaptive, xhigh, or max.");
  }

  const message = readOptionalString(value.message) ?? "";
  const attachments = normalizeChatAttachments(value.attachments);
  if (!message.trim() && attachments.length === 0) {
    throw new Error("Chat message or attachment is required.");
  }

  return {
    message: message.slice(0, maxChatMessageChars),
    attachments,
    modelId: readOptionalString(value.modelId),
    agentId: readOptionalString(value.agentId),
    thinkingEffort,
    includePlatformContext: typeof value.includePlatformContext === "boolean" ? value.includePlatformContext : undefined,
    mode: value.mode === undefined ? undefined : normalizeChatMode(value.mode),
    roleScope: normalizeChatRoleScope(value.roleScope),
    rebuildFromHivewardHistory: value.rebuildFromHivewardHistory === true
  };
}

function normalizeChatMode(value: unknown): ChatMode {
  return value === "blueprint" ? "blueprint" : "chat";
}

function normalizeChatRoleScope(value: unknown): ChatRoleScope | undefined {
  if (!isPlainRecord(value)) return undefined;
  const role = readOptionalString(value.role);
  if (role !== "ceo" && role !== "leader") return undefined;
  return {
    role,
    companyId: readOptionalString(value.companyId),
    leaderId: readOptionalString(value.leaderId),
    blueprintId: readOptionalString(value.blueprintId)
  };
}

function normalizeChatThinkingEffort(value: string | undefined): ChatThinkingEffort | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "off" ||
    normalized === "minimal" ||
    normalized === "low" ||
    normalized === "medium" ||
    normalized === "high" ||
    normalized === "adaptive" ||
    normalized === "xhigh" ||
    normalized === "max"
  ) {
    return normalized;
  }
  return undefined;
}

function normalizeChatSessionStatus(value: unknown): ChatSessionStatus | undefined {
  return value === "active" || value === "ended" || value === "native_missing" || value === "failed" ? value : undefined;
}

function normalizeNativeSessionState(value: unknown): HivewardChatSession["nativeSessionState"] | undefined {
  return value === "unknown" || value === "resumable" || value === "missing" ? value : undefined;
}

function normalizeChatAttachments(value: unknown): ChatAttachment[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, maxChatAttachments).flatMap((item) => {
    if (!isPlainRecord(item)) return [];
    const name = readOptionalString(item.name);
    if (!name) return [];
    const size = typeof item.size === "number" && Number.isFinite(item.size) ? Math.max(0, item.size) : 0;
    const text = readOptionalString(item.text);
    return [{
      id: readOptionalString(item.id) ?? `attachment-${nanoid(8)}`,
      name: name.slice(0, 180),
      mediaType: readOptionalString(item.mediaType) ?? "application/octet-stream",
      size,
      text: text?.slice(0, maxChatAttachmentTextChars),
      truncated: item.truncated === true || Boolean(text && text.length > maxChatAttachmentTextChars)
    }];
  });
}

async function buildChatRoleSkillPrompt(store: FileHivewardStore, scope: ChatRoleScope | undefined): Promise<string | undefined> {
  if (!scope) return undefined;
  try {
    const { roles } = await store.getRoleDirectory();
    const role = scope.role === "leader"
      ? roles.leaders.find((leader) => leader.id === scope.leaderId || leader.blueprintId === scope.blueprintId)
      : roles.ceo;
    return buildHivewardRoleSkillPrompt({
      role: scope.role,
      roleId: role?.id ?? scope.leaderId ?? scope.role,
      roleLabel: role?.label,
      companyId: scope.companyId ?? roles.companyId,
      blueprintId: role?.kind === "leader" ? role.blueprintId : scope.blueprintId,
      skillFilePath: buildRoleSkillFilePath(scope.role)
    });
  } catch {
    return buildHivewardRoleSkillPrompt({
      role: scope.role,
      roleId: scope.leaderId ?? scope.role,
      companyId: scope.companyId,
      blueprintId: scope.blueprintId,
      skillFilePath: buildRoleSkillFilePath(scope.role)
    });
  }
}

function buildRoleSkillFilePath(role: ChatRoleScope["role"]): string {
  const skillDirectory = role === "leader" ? "hiveward-leader" : "hiveward-ceo";
  return join(repositoryRoot, "docs", "skills", skillDirectory, "SKILL.md");
}

async function streamHivewardChatSession({
  sessionId,
  body,
  requestStartedAtMs,
  store,
  openClawConfigStore,
  adapter,
  res
}: StreamHivewardChatSessionInput): Promise<void> {
  let session = await store.getChatSession(sessionId);
  if (!session) {
    res.status(404).json({ error: { code: "chat_session_not_found", message: "Chat session not found." } });
    return;
  }
  if (session.status === "ended") {
    res.status(409).json({ error: { code: "chat_session_ended", message: "This chat session has ended. Create a new session to continue." } });
    return;
  }
  if (session.status === "native_missing" && !("rebuildFromHivewardHistory" in body && body.rebuildFromHivewardHistory)) {
    res.status(409).json({
      error: {
        code: "chat_session_native_missing",
        message: "The native session is not recoverable. Create a new session or explicitly rebuild from HiveWard history."
      }
    });
    return;
  }

  const config = await openClawConfigStore.getState();
  const harnessDefaults = resolveHarnessModelDefaults();
  const defaults = {
    openclaw: config.defaultModelId,
    codex: harnessDefaults.codex,
    claude: harnessDefaults.claude
  };
  const messagesBefore = await store.listChatMessages(session.id);
  const shouldRebuildFromHivewardHistory = "rebuildFromHivewardHistory" in body && body.rebuildFromHivewardHistory === true;
  const rebuildContext = shouldRebuildFromHivewardHistory ? buildHivewardHistoryContext(messagesBefore) : undefined;
  if (shouldRebuildFromHivewardHistory) {
    session = await store.updateChatSession(session.id, {
      nativeSessionId: undefined,
      nativeSessionState: "unknown",
      status: "active"
    }) ?? session;
  }

  const requestBody: ResolvedChatSessionMessage = {
    harnessId: session.harnessId,
    message: body.message,
    attachments: body.attachments ?? [],
    modelId: body.modelId ?? session.modelId,
    agentId: body.agentId ?? session.agentId,
    nativeSessionKey: shouldRebuildFromHivewardHistory ? undefined : session.nativeSessionId,
    thinkingEffort: body.thinkingEffort ?? session.thinkingEffort ?? "medium",
    includePlatformContext: body.includePlatformContext ?? messagesBefore.length === 0,
    mode: body.mode ?? session.mode,
    roleScope: body.roleScope ?? session.roleScope
  };
  const source = sourceForChatHarness(requestBody.harnessId);
  const agentId = requestBody.agentId || selectDefaultAgentId(config.configuredAgents);
  const modelId = resolveChatModelId(requestBody, config, defaults);
  const userMessage = await store.appendChatMessage({
    sessionId: session.id,
    role: "user",
    content: requestBody.message || "Uploaded files",
    attachments: requestBody.attachments,
    harnessId: requestBody.harnessId,
    modelId: requestBody.modelId,
    status: "sent"
  });
  const assistantMessage = await store.appendChatMessage({
    sessionId: session.id,
    role: "assistant",
    content: "",
    harnessId: requestBody.harnessId,
    modelId: requestBody.modelId,
    status: "streaming"
  });
  session = await store.updateChatSession(session.id, {
    modelId: requestBody.modelId,
    agentId,
    thinkingEffort: requestBody.thinkingEffort,
    mode: requestBody.mode,
    roleScope: requestBody.roleScope,
    status: "active"
  }) ?? session;

  res.status(200);
  res.setHeader("content-type", "text/event-stream; charset=utf-8");
  res.setHeader("cache-control", "no-cache, no-transform");
  res.setHeader("connection", "keep-alive");
  res.flushHeaders?.();

  const isClosed = () => res.writableEnded || res.destroyed;
  let doneEvent: ChatDoneEvent | undefined;
  let streamedOutput = "";
  let openclawAcceptedAtMs: number | undefined;
  let openclawFirstDeltaAtMs: number | undefined;
  let nativeSessionKey = requestBody.nativeSessionKey ?? "";
  const attemptedNativeResume = Boolean(nativeSessionKey) && !shouldRebuildFromHivewardHistory;
  const openclawStartedAtMs = Date.now();

  try {
    if (requestBody.harnessId === "openclaw" && !nativeSessionKey) {
      const nativeSession = await adapter.createChatSession({ agentId });
      nativeSessionKey = nativeSession.sessionKey;
      requestBody.nativeSessionKey = nativeSessionKey;
      session = await store.updateChatSession(session.id, {
        nativeSessionId: nativeSessionKey,
        nativeSessionState: "resumable"
      }) ?? session;
    }

    const roleSkillPrompt = await buildChatRoleSkillPrompt(store, requestBody.roleScope);
    const prompt = buildChatPrompt(requestBody, roleSkillPrompt, rebuildContext);
    await adapter.streamChatMessage(
      {
        sessionKey: nativeSessionKey,
        source,
        message: prompt,
        attachments: requestBody.attachments ?? [],
        modelId,
        thinking: requestBody.thinkingEffort,
        idempotencyKey: userMessage.id,
        timeoutMs: 600_000,
        skillIds: requestBody.roleScope ? [roleSkillIdForRole(requestBody.roleScope.role)] : undefined
      },
      (event) => {
        if (event.type === "started") {
          openclawAcceptedAtMs ??= Date.now();
        }
        if (event.type === "done") {
          doneEvent = event;
          return;
        }
        if (event.type === "delta") {
          openclawFirstDeltaAtMs ??= Date.now();
          streamedOutput = event.replace ? event.text : `${streamedOutput}${event.text}`;
        }
        writeChatStreamEvent(res, event, isClosed);
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Chat request failed.";
    await store.updateChatMessage(session.id, assistantMessage.id, {
      content: message,
      status: "failed"
    });
    await store.updateChatSession(session.id, {
      status: attemptedNativeResume && isNativeResumeFailure(message) ? "native_missing" : "failed",
      nativeSessionState: attemptedNativeResume && isNativeResumeFailure(message) ? "missing" : session.nativeSessionState
    });
    writeChatStreamEvent(res, { type: "error", message }, isClosed);
    res.end();
    return;
  }

  const openclawFinishedAtMs = Date.now();
  const postprocessStartedAtMs = Date.now();
  if (!doneEvent) {
    const message = "Chat request completed without a final runtime event.";
    await store.updateChatMessage(session.id, assistantMessage.id, {
      content: streamedOutput || message,
      status: streamedOutput ? "sent" : "failed"
    });
    writeChatStreamEvent(res, { type: "error", message }, isClosed);
    res.end();
    return;
  }

  const finalOutput = doneEvent.output ?? streamedOutput;
  const submissionBlock = extractChatInboxSubmissionBlock(finalOutput);
  let submission: ChatInboxSubmissionResult | undefined;
  let inboxSubmissionMs: number | undefined;
  let finalDoneEvent: ChatDoneEvent = doneEvent;
  let assistantOutput = finalOutput || doneEvent.error || "";

  if (doneEvent.status === "succeeded" && submissionBlock) {
    try {
      const submissionStartedAtMs = Date.now();
      submission = await materializeChatInboxSubmission(store, requestBody, finalOutput, submissionBlock);
      inboxSubmissionMs = Date.now() - submissionStartedAtMs;
    } catch (submissionError) {
      const message = submissionError instanceof Error ? submissionError.message : "Invalid Hiveward inbox submission.";
      const failedOutput = buildChatInboxSubmissionFailureOutput(finalOutput, submissionBlock.fullMatch, message);
      writeChatStreamEvent(res, { type: "delta", text: failedOutput, replace: true }, isClosed);
      finalDoneEvent = {
        ...doneEvent,
        status: "failed",
        output: failedOutput,
        error: message
      };
      assistantOutput = failedOutput;
    }
  }

  if (submission) {
    assistantOutput = submission.output;
    writeChatStreamEvent(res, { type: "delta", text: submission.output, replace: true }, isClosed);
    writeChatStreamEvent(res, {
      type: "inbox_item_created",
      item: submission.item,
      message: `Created Hiveward inbox item ${submission.item.id}.`
    }, isClosed);
    finalDoneEvent = { ...doneEvent, output: submission.output };
  }

  const finalEventWithTimings = withChatStreamTimings(
    finalDoneEvent,
    requestStartedAtMs,
    openclawStartedAtMs,
    openclawFinishedAtMs,
    postprocessStartedAtMs,
    inboxSubmissionMs,
    openclawAcceptedAtMs,
    openclawFirstDeltaAtMs
  );
  const runtimeRef = toChatRuntimeRef(finalEventWithTimings);
  const nativeMissing = attemptedNativeResume && finalEventWithTimings.status === "failed" && isNativeResumeFailure(finalEventWithTimings.error);
  await store.updateChatMessage(session.id, assistantMessage.id, {
    content: assistantOutput,
    status: finalEventWithTimings.status === "failed" || finalEventWithTimings.status === "cancelled" ? "failed" : "sent",
    runtimeRef,
    modelId: requestBody.modelId
  });
  const sessionPatch: UpdateHivewardChatSessionRequest = {
    status: nativeMissing ? "native_missing" : "active",
    nativeSessionState: nativeMissing ? "missing" : finalEventWithTimings.sessionKey ? "resumable" : session.nativeSessionState
  };
  if (finalEventWithTimings.sessionKey) {
    sessionPatch.nativeSessionId = finalEventWithTimings.sessionKey;
  }
  await store.updateChatSession(session.id, sessionPatch);
  writeChatStreamEvent(res, finalEventWithTimings, isClosed);
  res.end();
}

function buildChatPrompt(input: ResolvedChatSessionMessage, roleSkillPrompt?: string, rebuildContext?: string): string {
  const contextBlocks = [
    input.includePlatformContext ? hivewardPlatformContext : undefined,
    roleSkillPrompt,
    rebuildContext,
    input.mode === "blueprint" ? buildBlueprintDraftingContext(input.message) : undefined
  ].filter((block): block is string => Boolean(block));
  if (!contextBlocks.length) return input.message.trim();
  return [...contextBlocks, "", "User message:", input.message.trim()].join("\n");
}

async function syncChatHistoryInboxSubmissions(
  store: FileHivewardStore,
  messages: ChatHistoryMessage[]
): Promise<{ messages: ChatHistoryMessage[]; inboxItems: InboxItem[] }> {
  let knownInboxItems: InboxItem[] | undefined;
  const syncedItems = new Map<string, InboxItem>();
  const syncedMessages: ChatHistoryMessage[] = [];

  for (const message of messages) {
    if (message.role !== "assistant") {
      syncedMessages.push(message);
      continue;
    }

    const block = extractChatInboxSubmissionBlock(message.content);
    if (!block) {
      syncedMessages.push(message);
      continue;
    }

    try {
      const parsed = parseChatInboxSubmissionBlock(block);
      knownInboxItems ??= await store.listInboxItems();
      const existing = findExistingChatInboxSubmission(knownInboxItems, parsed);
      if (existing) {
        syncedItems.set(existing.id, existing);
        const output = buildChatInboxSubmissionSuccessOutput(stripChatInboxSubmissionBlock(message.content, block.fullMatch), existing);
        syncedMessages.push({ ...message, content: output });
        continue;
      }

      const submission = await materializeChatInboxSubmission(
        store,
        buildHistoryInboxChatRequest(parsed),
        message.content,
        block
      );
      if (submission) {
        knownInboxItems = [submission.item, ...knownInboxItems];
        syncedItems.set(submission.item.id, submission.item);
        syncedMessages.push({ ...message, content: submission.output });
        continue;
      }

      syncedMessages.push(message);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Invalid Hiveward inbox submission.";
      syncedMessages.push({
        ...message,
        content: buildChatInboxSubmissionFailureOutput(message.content, block.fullMatch, errorMessage)
      });
    }
  }

  return {
    messages: syncedMessages,
    inboxItems: [...syncedItems.values()]
  };
}

function buildHistoryInboxChatRequest(parsed: Record<string, unknown>): ResolvedChatSessionMessage {
  const type = readOptionalString(parsed.type);
  const leaderId = readOptionalString(parsed.leaderId) ?? readOptionalString(parsed.targetRoleId);
  const blueprintId = readOptionalString(parsed.blueprintId);
  return {
    harnessId: "openclaw",
    message: "",
    attachments: [],
    includePlatformContext: false,
    mode: "blueprint",
    roleScope: {
      role: type === "leader_delegation" ? "ceo" : "leader",
      leaderId,
      blueprintId
    }
  };
}

function findExistingChatInboxSubmission(items: InboxItem[], parsed: Record<string, unknown>): InboxItem | undefined {
  const type = readOptionalString(parsed.type);
  if (type !== "leader_delegation" && type !== "blueprint_proposal") return undefined;

  const title = readOptionalString(parsed.title);
  const blueprintId = readOptionalString(parsed.blueprintId);
  const leaderId = readOptionalString(parsed.leaderId);
  const firstBlueprintId = readBlueprintPackageFirstBlueprintId(parsed.blueprintPackage);
  const diffSummary = readOptionalString(parsed.diffSummary);

  return items.find((item) => {
    if (item.type !== type) return false;
    if (title && item.title !== title) return false;
    if (blueprintId && item.blueprintId && item.blueprintId !== blueprintId) return false;

    if (type === "leader_delegation") {
      return !leaderId || readPayloadString(item.payload, "leaderId") === leaderId;
    }

    const itemFirstBlueprintId = readBlueprintPackageFirstBlueprintId(item.payload?.blueprintPackage);
    if (firstBlueprintId) return itemFirstBlueprintId === firstBlueprintId;
    if (diffSummary) return readPayloadString(item.payload, "diffSummary") === diffSummary;
    return Boolean(title || blueprintId);
  });
}

function readPayloadString(payload: Record<string, unknown> | undefined, key: string): string | undefined {
  return isPlainRecord(payload) ? readOptionalString(payload[key]) : undefined;
}

function readBlueprintPackageFirstBlueprintId(value: unknown): string | undefined {
  if (!isPlainRecord(value) || !Array.isArray(value.blueprints)) return undefined;
  const firstBlueprint = value.blueprints[0];
  return isPlainRecord(firstBlueprint) ? readOptionalString(firstBlueprint.id) : undefined;
}

async function materializeChatInboxSubmission(
  store: FileHivewardStore,
  chatRequest: ResolvedChatSessionMessage,
  output: string,
  block = extractChatInboxSubmissionBlock(output)
): Promise<ChatInboxSubmissionResult | undefined> {
  if (!block) return undefined;
  const parsed = parseChatInboxSubmissionBlock(block);

  const type = readOptionalString(parsed.type);
  const createdByRoleId =
    readOptionalString(parsed.createdByRoleId) ??
    chatRequest.roleScope?.leaderId ??
    (chatRequest.roleScope?.role === "ceo" ? "ceo" : undefined);
  const blueprintId = readOptionalString(parsed.blueprintId) ?? chatRequest.roleScope?.blueprintId;
  const outputWithoutBlock = stripChatInboxSubmissionBlock(output, block.fullMatch);

  if (type === "leader_delegation") {
    const item = await store.createLeaderDelegationRequest(normalizeCreateLeaderDelegationRequest({
      ...parsed,
      blueprintId,
      createdByRoleId
    }));
    return { item, output: buildChatInboxSubmissionSuccessOutput(outputWithoutBlock, item) };
  }

  if (type === "blueprint_proposal") {
    const item = await store.createBlueprintProposal(normalizeCreateBlueprintProposalRequest({
      ...parsed,
      blueprintId,
      createdByRoleId,
      targetRoleId: readOptionalString(parsed.targetRoleId) ?? chatRequest.roleScope?.leaderId
    }));
    return { item, output: buildChatInboxSubmissionSuccessOutput(outputWithoutBlock, item) };
  }

  throw new Error("Hiveward inbox submission type must be leader_delegation or blueprint_proposal.");
}

function buildChatInboxSubmissionSuccessOutput(outputWithoutBlock: string, item: InboxItem): string {
  const visibleOutput = outputWithoutBlock.trim() || `已提交「${item.title}」到收件箱。`;
  const approvalHint = "已提交到收件箱，请前往收件箱审批。";
  if (visibleOutput.includes(approvalHint)) return visibleOutput;
  return [visibleOutput, "", approvalHint].join("\n").trim();
}

function parseChatInboxSubmissionBlock(block: ChatInboxSubmissionBlock): Record<string, unknown> {
  const parsed = parseChatInboxSubmissionJson(block.json);
  if (!isPlainRecord(parsed)) {
    throw new Error("Hiveward inbox submission block must contain a JSON object.");
  }
  validateChatInboxSubmissionSchema(parsed);
  return parsed;
}

function validateChatInboxSubmissionSchema(parsed: Record<string, unknown>): void {
  const schema = readOptionalString(parsed.schema);
  if (schema && schema !== hivewardInboxSubmissionSchema) {
    throw new Error(`Unsupported Hiveward inbox submission schema: ${schema}. Expected ${hivewardInboxSubmissionSchema}.`);
  }
}

function parseChatInboxSubmissionJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    const repaired = repairExtraJsonObjectClosers(value);
    if (repaired !== value) {
      try {
        return JSON.parse(repaired) as unknown;
      } catch {
        // Keep the original parser error because its location matches the model output.
      }
    }
    throw error;
  }
}

function repairExtraJsonObjectClosers(value: string): string {
  const stack: string[] = [];
  let repaired = "";
  let inString = false;
  let escaped = false;

  for (const char of value) {
    repaired += char;
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{") {
      stack.push("{");
      continue;
    }
    if (char === "[") {
      stack.push("[");
      continue;
    }
    if (char === "}") {
      if (stack.at(-1) === "{") {
        stack.pop();
        continue;
      }
      repaired = repaired.slice(0, -1);
      continue;
    }
    if (char === "]") {
      if (stack.at(-1) === "[") stack.pop();
    }
  }

  return repaired;
}

function extractChatInboxSubmissionBlock(output: string): ChatInboxSubmissionBlock | undefined {
  const matches = [
    /```hiveward-inbox\s*([\s\S]*?)```/i.exec(output),
    /(?:^|\n)\s*(?:#{1,6}\s*)?hiveward-inbox\s*\n```(?:json)?\s*([\s\S]*?)```/i.exec(output),
    /(?:^|\n)\s*(?:#{1,6}\s*)?hiveward-inbox\s*\n(\{[\s\S]*\})\s*$/i.exec(output)
  ];
  const match = matches.find(Boolean);
  if (!match) return undefined;
  return {
    fullMatch: match[0],
    json: normalizeChatInboxSubmissionJson(match[1] ?? "")
  };
}

function normalizeChatInboxSubmissionJson(value: string): string {
  return value
    .trim()
    .replace(/^json\s*\n/i, "")
    .trim();
}

function stripChatInboxSubmissionBlock(output: string, block: string): string {
  return output
    .replace(block, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function buildChatInboxSubmissionFailureOutput(output: string, block: string, errorMessage: string): string {
  const visibleOutput = stripChatInboxSubmissionBlock(output, block);
  return [
    visibleOutput || "Hiveward inbox submission failed.",
    "",
    `Inbox submission failed: ${errorMessage}`
  ].join("\n").trim();
}

const hivewardPlatformContext = [
  "System context:",
  "HiveWard is a local company operations console for building business workflows, company structure, blueprints, task cards, notes, runtime status views, and local UI metadata.",
  "In Chat, HiveWard is only the user interface and dispatch channel. OpenClaw owns runtime execution, agents, tools, skills, sessions, transcripts, reasoning, and usage facts.",
  "Use OpenClaw-native tools and skills when they are available. If the user asks to create or change HiveWard blueprints, workflows, company structure, or visual assets, help turn the request into concrete platform actions and use real runtime tools/APIs when required.",
  "Do not claim stored HiveWard data, blueprints, files, or external deliveries changed unless an actual tool or API performed that change."
].join("\n");

const hivewardBlueprintDraftingGuidance = [
  "Blueprint drafting mode:",
  "When the user asks for a blueprint change, first align on direction in chat. For final approval, produce a concrete importable content package with proposal text, JSON or patch details, preview, and diff summary.",
  "Do not describe a natural-language idea as approved or imported until the Hiveward inbox item has been approved and the backend import completed."
].join("\n");

const hivewardBlueprintSubmissionContext = [
  hivewardBlueprintDraftingGuidance,
  "If the user explicitly asks to submit the proposal for approval, end the response with one hiveward-inbox fenced block so Hiveward can create the real inbox item.",
  "",
  hivewardInboxSubmissionContract
].join("\n");

function buildBlueprintDraftingContext(message: string): string {
  return shouldIncludeBlueprintSubmissionContract(message)
    ? hivewardBlueprintSubmissionContext
    : hivewardBlueprintDraftingGuidance;
}

function shouldIncludeBlueprintSubmissionContract(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("submit") ||
    normalized.includes("approval") ||
    normalized.includes("approve") ||
    normalized.includes("inbox") ||
    normalized.includes("proposal") ||
    normalized.includes("import") ||
    message.includes("提交") ||
    message.includes("审批") ||
    message.includes("批准") ||
    message.includes("收件箱") ||
    message.includes("提案") ||
    message.includes("导入")
  );
}

function writeChatStreamEvent(
  res: Response,
  event: ChatStreamEvent,
  isClosed: () => boolean
): boolean {
  if (isClosed()) return false;
  res.write(`event: ${event.type}\n`);
  res.write(`data: ${JSON.stringify(event)}\n\n`);
  return !isClosed();
}

function withChatStreamTimings<T extends ChatDoneEvent>(
  event: T,
  requestStartedAtMs: number,
  openclawStartedAtMs: number,
  openclawFinishedAtMs: number,
  postprocessStartedAtMs: number,
  inboxSubmissionMs: number | undefined,
  openclawAcceptedAtMs: number | undefined,
  openclawFirstDeltaAtMs: number | undefined
): T {
  const completedAtMs = Date.now();
  return {
    ...event,
    timings: {
      totalMs: Math.max(0, completedAtMs - requestStartedAtMs),
      hivewardPreprocessMs: Math.max(0, openclawStartedAtMs - requestStartedAtMs),
      openclawMs: Math.max(0, openclawFinishedAtMs - openclawStartedAtMs),
      hivewardPostprocessMs: Math.max(0, completedAtMs - postprocessStartedAtMs),
      inboxSubmissionMs,
      openclawAcceptedMs: openclawAcceptedAtMs === undefined ? undefined : Math.max(0, openclawAcceptedAtMs - openclawStartedAtMs),
      openclawFirstDeltaMs: openclawFirstDeltaAtMs === undefined ? undefined : Math.max(0, openclawFirstDeltaAtMs - openclawStartedAtMs)
    }
  };
}

function toChatRuntimeRef(event: ChatDoneEvent): ChatRuntimeRef {
  return {
    taskId: event.taskId,
    runId: event.runId,
    sessionKey: event.sessionKey,
    source: event.source,
    status: event.status,
    updatedAt: event.updatedAt,
    error: event.error,
    usage: event.usage,
    timings: event.timings
  };
}

function buildHivewardHistoryContext(messages: HivewardChatMessage[]): string {
  const maxMessages = 40;
  const maxChars = 24_000;
  const visibleMessages = messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .slice(-maxMessages)
    .map((message) => `${message.role}: ${message.content.trim() || "[empty message]"}`);
  let history = visibleMessages.join("\n\n");
  if (history.length > maxChars) {
    history = history.slice(history.length - maxChars);
  }
  return [
    "HiveWard visible conversation history:",
    history || "[no prior visible messages]",
    "",
    "The native provider session was not recoverable. Use this explicit HiveWard transcript only as user-visible context; do not describe this as native recovery."
  ].join("\n");
}

function isNativeResumeFailure(message: string | undefined): boolean {
  if (!message) return false;
  const normalized = message.toLowerCase();
  return (
    /(resume|resum|session|thread).*(missing|not found|invalid|expired|deleted|unavailable|cannot|could not|failed)/.test(normalized) ||
    /(missing|not found|invalid|expired|deleted).*(session|thread)/.test(normalized) ||
    normalized.includes("no conversation found")
  );
}

function sourceForChatHarness(harnessId: HarnessId): OpenClawObjectSource {
  if (harnessId === "claudeCode") return "claude";
  return harnessId;
}

function roleSkillIdForRole(role: ChatRoleScope["role"]): HarnessSkillId {
  return role === "leader" ? "hiveward-leader" : "hiveward-ceo";
}

function resolveChatModelId(
  body: ResolvedChatSessionMessage,
  config: OpenClawConfigState,
  defaults: RunModelDefaults
): string | undefined {
  if (body.harnessId === "openclaw") {
    return body.modelId;
  }

  const requestedModel = body.modelId === config.defaultModelId ? undefined : body.modelId;
  const modelId = body.harnessId === "codex"
    ? requestedModel ?? defaults.codex
    : requestedModel ?? defaults.claude;
  if (body.harnessId === "claudeCode" && modelId === "inherit") {
    return undefined;
  }
  return modelId;
}

function readHarnessId(value: string | undefined): HarnessId {
  if (value === "openclaw" || value === "claudeCode" || value === "codex") return value;
  throw new Error(`Unsupported harness id: ${value ?? ""}`);
}

async function buildHarnessSkillStatusResponse(
  harnessId: HarnessId,
  openClawConfigStore: OpenClawConfigStore
): Promise<HarnessSkillStatusResponse> {
  const checkedAt = new Date().toISOString();
  const config = await openClawConfigStore.getState();
  const installTarget = resolveHarnessSkillInstallTarget(harnessId, config);
  const installRoot = installTarget.root;
  const skills = await Promise.all(hivewardHarnessSkills.map((skill) => buildHarnessSkillStatusItem(skill, installRoot)));
  return {
    harnessId,
    supported: true,
    checkedAt,
    installRoot,
    installCandidates: installTarget.candidates,
    skills
  };
}

async function installHarnessSkills(
  harnessId: HarnessId,
  openClawConfigStore: OpenClawConfigStore
): Promise<InstallHarnessSkillsResponse> {
  const config = await openClawConfigStore.getState();
  const installRoot = resolveHarnessSkillInstallTarget(harnessId, config).root;
  await mkdir(installRoot, { recursive: true });

  let installedCount = 0;
  for (const skill of hivewardHarnessSkills) {
    const targetDir = join(installRoot, skill.id);
    await rm(targetDir, { recursive: true, force: true });
    await cp(skill.sourceDir, targetDir, { recursive: true });
    installedCount += 1;
  }

  return {
    ...(await buildHarnessSkillStatusResponse(harnessId, openClawConfigStore)),
    installedCount
  };
}

function resolveHarnessSkillInstallTarget(harnessId: HarnessId, config: OpenClawConfigState): HarnessSkillInstallTarget {
  const candidates = buildHarnessSkillInstallCandidates(harnessId, config);
  const selected = selectHarnessSkillInstallCandidate(candidates);
  const selectedRootKey = normalizePathKey(selected.root);
  return {
    root: selected.root,
    candidates: candidates.map((candidate) => ({
      ...candidate,
      selected: normalizePathKey(candidate.root) === selectedRootKey
    }))
  };
}

function buildHarnessSkillInstallCandidates(
  harnessId: HarnessId,
  config: OpenClawConfigState
): HarnessSkillInstallCandidate[] {
  const candidates: HarnessSkillInstallCandidate[] = [];
  const home = homedir();

  if (harnessId === "codex") {
    addEnvHomeSkillCandidate(candidates, "CODEX_HOME", "Codex CODEX_HOME skills");
    addPersonalSkillCandidate(candidates, join(home, ".codex", "skills"), "Codex personal skills");
    addProjectSkillCandidate(candidates, join(repositoryRoot, ".codex", "skills"), "Codex project skills");
    return candidates;
  }

  if (harnessId === "claudeCode") {
    addEnvHomeSkillCandidate(candidates, "CLAUDE_CONFIG_DIR", "Claude Code CLAUDE_CONFIG_DIR skills");
    addPersonalSkillCandidate(candidates, join(home, ".claude", "skills"), "Claude Code personal skills");
    addProjectSkillCandidate(candidates, join(repositoryRoot, ".claude", "skills"), "Claude Code project skills");
    return candidates;
  }

  addEnvHomeSkillCandidate(candidates, "OPENCLAW_STATE_DIR", "OpenClaw OPENCLAW_STATE_DIR skills");
  addEnvHomeSkillCandidate(candidates, "OPENCLAW_HOME", "OpenClaw OPENCLAW_HOME skills");
  addConfigSiblingSkillCandidate(candidates, config.configPath, "OpenClaw config-adjacent skills");
  addPersonalSkillCandidate(candidates, join(home, ".openclaw", "skills"), "OpenClaw personal skills");
  addProjectSkillCandidate(candidates, join(repositoryRoot, ".openclaw", "skills"), "OpenClaw project skills");
  return candidates;
}

function addEnvHomeSkillCandidate(
  candidates: HarnessSkillInstallCandidate[],
  envName: string,
  label: string
): void {
  const envHome = readEnvString(process.env, envName);
  if (!envHome) return;
  addHarnessSkillInstallCandidate(candidates, {
    root: join(expandHomePath(envHome), "skills"),
    source: "environment",
    label
  });
}

function addPersonalSkillCandidate(
  candidates: HarnessSkillInstallCandidate[],
  root: string,
  label: string
): void {
  const normalizedRoot = resolve(root);
  const hasHiveWardSkills = hasHiveWardSkillInstall(normalizedRoot);
  addHarnessSkillInstallCandidate(candidates, {
    root: normalizedRoot,
    source: hasHiveWardSkills ? "existing_install" : fileExists(normalizedRoot) ? "existing_root" : "default",
    label
  });
}

function addProjectSkillCandidate(
  candidates: HarnessSkillInstallCandidate[],
  root: string,
  label: string
): void {
  addHarnessSkillInstallCandidate(candidates, {
    root,
    source: "project",
    label
  });
}

function addConfigSiblingSkillCandidate(
  candidates: HarnessSkillInstallCandidate[],
  configPath: string | undefined,
  label: string
): void {
  if (!configPath) return;
  const resolvedConfigPath = resolve(expandHomePath(configPath));
  if (!fileExists(resolvedConfigPath) && !fileExists(dirname(resolvedConfigPath))) return;
  addHarnessSkillInstallCandidate(candidates, {
    root: join(dirname(resolvedConfigPath), "skills"),
    source: "existing_root",
    label
  });
}

function addHarnessSkillInstallCandidate(
  candidates: HarnessSkillInstallCandidate[],
  input: HarnessSkillInstallCandidateInput
): void {
  const root = resolve(input.root);
  const rootKey = normalizePathKey(root);
  if (candidates.some((candidate) => normalizePathKey(candidate.root) === rootKey)) return;
  candidates.push({
    root,
    source: input.source,
    label: input.label,
    exists: fileExists(root),
    hasHiveWardSkills: hasHiveWardSkillInstall(root),
    selected: false
  });
}

function selectHarnessSkillInstallCandidate(
  candidates: HarnessSkillInstallCandidate[]
): HarnessSkillInstallCandidate {
  return (
    candidates.find((candidate) => candidate.source === "environment") ??
    candidates.find((candidate) => candidate.source !== "project" && candidate.hasHiveWardSkills) ??
    candidates.find((candidate) => candidate.source !== "project" && candidate.exists) ??
    candidates.find((candidate) => candidate.source === "default") ??
    candidates[0] ??
    {
      root: join(homedir(), ".openclaw", "skills"),
      source: "default",
      label: "Default personal skills",
      exists: false,
      hasHiveWardSkills: false,
      selected: false
    }
  );
}

function hasHiveWardSkillInstall(root: string): boolean {
  return hivewardHarnessSkills.some((skill) => fileExists(join(root, skill.id, "SKILL.md")));
}

function expandHomePath(value: string): string {
  if (value === "~") return homedir();
  return value.startsWith("~/") || value.startsWith("~\\") ? join(homedir(), value.slice(2)) : value;
}

function normalizePathKey(path: string): string {
  return process.platform === "win32" ? resolve(path).toLowerCase() : resolve(path);
}

async function buildHarnessSkillStatusItem(
  skill: (typeof hivewardHarnessSkills)[number],
  installRoot: string
): Promise<HarnessSkillStatusItem> {
  const sourcePath = join(skill.sourceDir, "SKILL.md");
  const targetDir = join(installRoot, skill.id);
  const targetPath = join(targetDir, "SKILL.md");

  let sourceHash: string;
  try {
    sourceHash = await hashDirectory(skill.sourceDir);
  } catch (error) {
    return {
      id: skill.id,
      label: skill.label,
      sourcePath,
      targetPath,
      installed: false,
      status: "error",
      error: error instanceof Error ? error.message : String(error)
    };
  }

  try {
    const installedHash = await hashDirectory(targetDir);
    const installed = installedHash === sourceHash;
    return {
      id: skill.id,
      label: skill.label,
      sourcePath,
      targetPath,
      installed,
      status: installed ? "installed" : "stale",
      sourceHash,
      installedHash
    };
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return {
        id: skill.id,
        label: skill.label,
        sourcePath,
        targetPath,
        installed: false,
        status: "missing",
        sourceHash
      };
    }
    return {
      id: skill.id,
      label: skill.label,
      sourcePath,
      targetPath,
      installed: false,
      status: "error",
      sourceHash,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function hashDirectory(root: string): Promise<string> {
  const hash = createHash("sha256");
  await appendDirectoryHash(hash, root, "");
  return hash.digest("hex");
}

async function appendDirectoryHash(hash: ReturnType<typeof createHash>, root: string, relativePath: string): Promise<void> {
  const directory = relativePath ? join(root, relativePath) : root;
  const entries = (await readdir(directory, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    const childRelativePath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
    const childPath = join(root, childRelativePath);
    if (entry.isDirectory()) {
      hash.update(`dir:${childRelativePath}\0`);
      await appendDirectoryHash(hash, root, childRelativePath);
      continue;
    }
    if (entry.isFile()) {
      hash.update(`file:${childRelativePath}\0`);
      hash.update(await readFile(childPath));
      hash.update("\0");
    }
  }
}

function isFileNotFoundError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "ENOENT";
}

function buildHarnessStatuses(
  version: OpenClawVersionInfo,
  config: OpenClawConfigState,
  defaults: HarnessModelDefaults
): HarnessStatus[] {
  const checkedAt = new Date().toISOString();
  return [
    buildOpenClawHarnessStatus(version, config, checkedAt),
    buildClaudeCodeHarnessStatus(checkedAt, defaults.claude, defaults.claudeModels),
    buildCodexHarnessStatus(checkedAt, defaults.codex, defaults.codexModels)
  ];
}

function buildOpenClawHarnessStatus(
  version: OpenClawVersionInfo,
  config: OpenClawConfigState,
  checkedAt: string
): HarnessStatus {
  const installed = Boolean(version.version && !version.error);
  const gatewayConfigured = Boolean(config.gateway?.url);
  const environmentOk = installed && Boolean(config.configPath);
  const connectionState = installed ? (gatewayConfigured ? "connected" : "available") : "unavailable";
  return {
    id: "openclaw",
    label: "OpenClaw",
    defaultModelId: config.defaultModelId,
    installed,
    environmentOk,
    connectionState,
    summary: installed
      ? gatewayConfigured
        ? `OpenClaw ${version.version} detected with Gateway configured.`
        : `OpenClaw ${version.version} detected. Gateway is not configured.`
      : `OpenClaw is not available${version.error ? `: ${version.error}` : "."}`,
    checkedAt,
    checks: [
      {
        id: "openclaw-version",
        label: "OpenClaw CLI",
        status: installed ? "pass" : "fail",
        detail: installed ? `Version ${version.version}` : version.error ?? "No version was resolved."
      },
      {
        id: "openclaw-config",
        label: "Config file",
        status: config.configPath ? "pass" : "warning",
        detail: config.configPath || "No OpenClaw config path was resolved."
      },
      {
        id: "openclaw-gateway",
        label: "Gateway",
        status: gatewayConfigured ? "pass" : "warning",
        detail: config.gateway?.url ?? "Gateway URL is not configured."
      }
    ]
  };
}

function buildClaudeCodeHarnessStatus(
  checkedAt: string,
  defaultModelId: string | undefined,
  models: HarnessModelOption[]
): HarnessStatus {
  const installed = canResolvePackage("@anthropic-ai/claude-agent-sdk");
  const apiKeyConfigured = hasEnvValue("ANTHROPIC_API_KEY");
  const oauthConfigured = hasEnvValue("CLAUDE_CODE_OAUTH_TOKEN");
  const credentialsFile = resolveConfigFile({
    envDirName: "CLAUDE_CONFIG_DIR",
    fallbackDir: join(homedir(), ".claude"),
    fallbackLabel: "~/.claude",
    fileName: ".credentials.json"
  });
  const credentialsConfigured = fileExists(credentialsFile.path);
  const configured = apiKeyConfigured || oauthConfigured || credentialsConfigured;
  return {
    id: "claudeCode",
    label: "Claude code",
    defaultModelId,
    models,
    installed,
    environmentOk: installed && configured && Boolean(defaultModelId),
    connectionState: !installed ? "unavailable" : configured ? "available" : "needs_config",
    summary: !installed
      ? "Claude Code SDK is not installed in this workspace."
      : configured
        ? "Claude Code SDK is installed and a local credential source was detected."
        : "Claude Code SDK is installed, but no API key, OAuth token, or credentials file was detected.",
    checkedAt,
    checks: [
      {
        id: "claude-sdk",
        label: "Claude Code SDK",
        status: installed ? "pass" : "fail",
        detail: installed ? "@anthropic-ai/claude-agent-sdk resolved from node_modules." : "Package resolution failed."
      },
      {
        id: "claude-auth",
        label: "Claude credentials",
        status: configured ? "pass" : "fail",
        detail: configured
          ? credentialSourceLabel([
              apiKeyConfigured ? "ANTHROPIC_API_KEY" : undefined,
              oauthConfigured ? "CLAUDE_CODE_OAUTH_TOKEN" : undefined,
              credentialsConfigured ? credentialsFile.label : undefined
            ])
          : "No ANTHROPIC_API_KEY, CLAUDE_CODE_OAUTH_TOKEN, or Claude credentials file was detected."
      },
      {
        id: "claude-entitlement",
        label: "Claude entitlement",
        status: configured ? "warning" : "fail",
        detail: configured
          ? "Subscription or API entitlement is not verified by this local check."
          : "A Claude API key, OAuth token, or paid Claude Code entitlement is required before runtime use."
      },
      {
        id: "claude-default-model",
        label: "Default model",
        status: defaultModelId ? "pass" : "fail",
        detail: defaultModelId ? `${defaultModelId} (${models.length} model option${models.length === 1 ? "" : "s"} resolved).` : "No default Claude Code model was resolved."
      }
    ]
  };
}

function buildCodexHarnessStatus(
  checkedAt: string,
  defaultModelId: string | undefined,
  models: HarnessModelOption[]
): HarnessStatus {
  const installed = canResolvePackage("@openai/codex-sdk");
  const apiKeyConfigured = Boolean(process.env.CODEX_API_KEY?.trim());
  const authFile = resolveConfigFile({
    envDirName: "CODEX_HOME",
    fallbackDir: join(homedir(), ".codex"),
    fallbackLabel: "~/.codex",
    fileName: "auth.json"
  });
  const loginConfigured = fileExists(authFile.path);
  const configured = apiKeyConfigured || loginConfigured;
  return {
    id: "codex",
    label: "Codex",
    defaultModelId,
    models,
    installed,
    environmentOk: installed && configured && Boolean(defaultModelId),
    connectionState: !installed ? "unavailable" : configured ? "available" : "needs_config",
    summary: !installed
      ? "Codex SDK is not installed in this workspace."
      : configured
        ? "Codex SDK is installed and a Codex credential source was detected."
        : "Codex SDK is installed, but no CODEX_API_KEY or Codex login file was detected.",
    checkedAt,
    checks: [
      {
        id: "codex-sdk",
        label: "Codex SDK",
        status: installed ? "pass" : "fail",
        detail: installed ? "@openai/codex-sdk resolved from node_modules." : "Package resolution failed."
      },
      {
        id: "codex-auth",
        label: "Codex credentials",
        status: configured ? "pass" : "fail",
        detail: configured
          ? credentialSourceLabel([apiKeyConfigured ? "CODEX_API_KEY" : undefined, loginConfigured ? authFile.label : undefined])
          : `No CODEX_API_KEY or ${authFile.label} was detected.`
      },
      {
        id: "codex-default-model",
        label: "Default model",
        status: defaultModelId ? "pass" : "fail",
        detail: defaultModelId ? `${defaultModelId} (${models.length} model option${models.length === 1 ? "" : "s"} scanned).` : "No default Codex model was resolved."
      }
    ]
  };
}

function resolveConfigFile({
  envDirName,
  fallbackDir,
  fallbackLabel,
  fileName
}: {
  envDirName: string;
  fallbackDir: string;
  fallbackLabel: string;
  fileName: string;
}): { path: string; label: string } {
  const envDir = process.env[envDirName]?.trim();
  return envDir
    ? { path: join(envDir, fileName), label: `${envDirName}/${fileName}` }
    : { path: join(fallbackDir, fileName), label: `${fallbackLabel}/${fileName}` };
}

function hasEnvValue(name: string): boolean {
  return Boolean(process.env[name]?.trim());
}

function fileExists(path: string): boolean {
  try {
    return existsSync(path);
  } catch {
    return false;
  }
}

function credentialSourceLabel(sources: Array<string | undefined>): string {
  return `Detected: ${sources.filter(Boolean).join(", ")}.`;
}

function canResolvePackage(packageName: string): boolean {
  try {
    import.meta.resolve(packageName);
    return true;
  } catch {
    return false;
  }
}

function collectInvalidAgentIds(blueprint: BlueprintDefinition, configuredAgentIds: Set<string>): string[] {
  const invalid = new Set<string>();

  for (const node of blueprint.nodes) {
    if (isAgentBlueprintNode(node) && node.runtimeId === "openclaw") {
      const agentId = node.config.openclawAgentId ?? "main";
      if (!configuredAgentIds.has(agentId)) invalid.add(agentId);
      continue;
    }
    if (node.type === "manager" && (node.runtimeId ?? "openclaw") === "openclaw") {
      const agentId = (node.config as ManagerNodeConfig).openclawAgentId ?? "main";
      if (!configuredAgentIds.has(agentId)) invalid.add(agentId);
      continue;
    }
    if (node.type === "parallel_agents") {
      for (const agent of (node.config as ParallelAgentsNodeConfig).agents) {
        const agentId = agent.openclawAgentId ?? "main";
        if (!configuredAgentIds.has(agentId)) invalid.add(agentId);
      }
    }
  }

  return [...invalid];
}

function readRouteParam(value: string | string[] | undefined, name: string): string {
  if (Array.isArray(value)) {
    const [first] = value;
    if (first) return first;
  }
  if (typeof value === "string" && value) return value;
  throw new Error(`Missing route parameter: ${name}`);
}

function withRunDefaults(blueprint: BlueprintDefinition, defaults: RunModelDefaults): BlueprintDefinition {
  if (!defaults.openclaw && !defaults.codex && !defaults.claude) return blueprint;

  return {
    ...blueprint,
    nodes: blueprint.nodes.map((node) => {
      if (isAgentBlueprintNode(node)) {
        const config = node.config as AgentNodeConfig;
        const defaultModelId = defaultModelForAgentRuntime(node.runtimeId, defaults);
        return config.modelId || !defaultModelId ? node : { ...node, config: { ...config, modelId: defaultModelId } };
      }
      if (node.type === "manager") {
        const config = node.config as ManagerNodeConfig;
        const defaultModelId = defaultModelForAgentRuntime(node.runtimeId ?? "openclaw", defaults);
        return {
          ...node,
          runtimeId: node.runtimeId ?? "openclaw",
          config: config.modelId || !defaultModelId ? config : { ...config, modelId: defaultModelId }
        };
      }
      if (node.type === "parallel_agents") {
        const config = node.config as ParallelAgentsNodeConfig;
        if (!defaults.openclaw) return node;
        return {
          ...node,
          config: {
            ...config,
            agents: config.agents.map((agent) => (agent.modelId ? agent : { ...agent, modelId: defaults.openclaw }))
          }
        };
      }
      if (node.type === "summary") {
        const config = node.config as SummaryNodeConfig;
        return config.mode === "openclaw_summary_agent" && !config.modelId && defaults.openclaw
          ? { ...node, config: { ...config, modelId: defaults.openclaw } }
          : node;
      }
      return node;
    })
  };
}

function defaultModelForAgentRuntime(runtimeId: "openclaw" | "codex" | "claude", defaults: RunModelDefaults): string | undefined {
  if (runtimeId === "openclaw") return defaults.openclaw;
  if (runtimeId === "codex") return defaults.codex;
  return defaults.claude;
}

function resolveHarnessModelDefaults(env: NodeJS.ProcessEnv = process.env): HarnessModelDefaults {
  const codexModels = readCodexModelCache(env);
  const codexConfiguredModel = readCodexConfiguredModel(env);
  const codexDefaultModelId =
    readEnvString(env, "HIVEWARD_CODEX_DEFAULT_MODEL") ??
    readEnvString(env, "CODEX_DEFAULT_MODEL") ??
    codexConfiguredModel ??
    codexModels[0]?.id ??
    fallbackCodexDefaultModel;

  const claudeDefaultModelId =
    readEnvString(env, "HIVEWARD_CLAUDE_CODE_DEFAULT_MODEL") ??
    readEnvString(env, "CLAUDE_CODE_DEFAULT_MODEL") ??
    fallbackClaudeCodeDefaultModel;

  return {
    codex: codexDefaultModelId,
    claude: claudeDefaultModelId,
    codexModels: prepareHarnessModelOptions(codexModels, codexDefaultModelId, "codex", codexDefaultThinkingLevels),
    claudeModels: prepareHarnessModelOptions(
      readClaudeCodeModelOptions(env),
      claudeDefaultModelId,
      "claude",
      claudeCodeDefaultThinkingLevels
    )
  };
}

function readCodexConfiguredModel(env: NodeJS.ProcessEnv): string | undefined {
  for (const root of resolveCodexConfigRoots(env)) {
    const configPath = join(root, "config.toml");
    if (!fileExists(configPath)) continue;
    const model = readTopLevelTomlString(configPath, "model");
    if (model) return model;
  }
  return undefined;
}

function readCodexModelCache(env: NodeJS.ProcessEnv): HarnessModelOption[] {
  const entries: Array<HarnessModelOption & { priority: number }> = [];
  for (const root of resolveCodexConfigRoots(env)) {
    const cachePath = join(root, "models_cache.json");
    const cache = readJsonFile(cachePath);
    const models = isPlainRecord(cache) && Array.isArray(cache.models) ? cache.models : [];
    for (const model of models) {
      const option = readCodexCachedModel(model);
      if (option) entries.push(option);
    }
  }

  entries.sort((left, right) => right.priority - left.priority || left.label.localeCompare(right.label));
  return mergeHarnessModelOptions(entries.map(({ priority: _priority, ...option }) => option));
}

function readCodexCachedModel(value: unknown): (HarnessModelOption & { priority: number }) | undefined {
  if (!isPlainRecord(value)) return undefined;
  const id = readOptionalString(value.slug);
  if (!id) return undefined;

  const visibility = readOptionalString(value.visibility);
  if (visibility && visibility !== "list") return undefined;
  if (value.supported_in_api === false) return undefined;

  return {
    id,
    label: readOptionalString(value.display_name) ?? id,
    provider: "codex",
    description: readOptionalString(value.description),
    thinkingLevels: readCodexThinkingLevels(value.supported_reasoning_levels),
    priority: typeof value.priority === "number" ? value.priority : 0
  };
}

function readCodexThinkingLevels(value: unknown): ChatThinkingEffort[] {
  if (!Array.isArray(value)) return codexDefaultThinkingLevels;
  const levels = value
    .map((item) => (isPlainRecord(item) ? readOptionalString(item.effort) : undefined))
    .filter((effort): effort is ChatThinkingEffort => isChatThinkingEffort(effort) && effort !== "minimal" && effort !== "off");
  return levels.length ? [...new Set(levels)] : codexDefaultThinkingLevels;
}

function readEnvModelOptions(
  env: NodeJS.ProcessEnv,
  names: string[],
  provider: string,
  thinkingLevels: ChatThinkingEffort[]
): HarnessModelOption[] {
  for (const name of names) {
    const value = readEnvString(env, name);
    if (!value) continue;
    return value
      .split(/[,\n]/)
      .map((item) => item.trim())
      .filter(Boolean)
      .map((id) => ({
        id,
        label: id,
        provider,
        thinkingLevels
      }));
  }
  return [];
}

function readClaudeCodeModelOptions(env: NodeJS.ProcessEnv): HarnessModelOption[] {
  return mergeHarnessModelOptions([
    ...readEnvModelOptions(env, ["HIVEWARD_CLAUDE_CODE_MODELS", "CLAUDE_CODE_MODELS"], "claude", claudeCodeDefaultThinkingLevels),
    ...readClaudeCodeSettingsModelOptions(env)
  ]);
}

function readClaudeCodeSettingsModelOptions(env: NodeJS.ProcessEnv): HarnessModelOption[] {
  const modelIds = new Set<string>();
  for (const root of resolveClaudeCodeConfigRoots(env)) {
    for (const fileName of ["settings.json", "settings.local.json"]) {
      const settings = readJsonFile(join(root, fileName));
      if (!isPlainRecord(settings)) continue;
      const topLevelModel = readOptionalString(settings.model);
      if (topLevelModel) modelIds.add(topLevelModel);
      const settingsEnv = isPlainRecord(settings.env) ? settings.env : {};
      for (const [key, value] of Object.entries(settingsEnv)) {
        if (key === "ANTHROPIC_MODEL" || key === "CLAUDE_CODE_DEFAULT_MODEL" || /^ANTHROPIC_DEFAULT_.*_MODEL$/.test(key)) {
          const modelId = readOptionalString(value);
          if (modelId) modelIds.add(modelId);
        }
      }
    }
  }

  return [...modelIds].map((id) => ({
    id,
    label: id,
    provider: "claude",
    thinkingLevels: claudeCodeDefaultThinkingLevels
  }));
}

function prepareHarnessModelOptions(
  scannedModels: HarnessModelOption[],
  defaultModelId: string | undefined,
  provider: string,
  thinkingLevels: ChatThinkingEffort[]
): HarnessModelOption[] {
  const defaultOption = defaultModelId
    ? [{
        id: defaultModelId,
        label: defaultModelId,
        provider,
        thinkingLevels
      }]
    : [];
  const merged = mergeHarnessModelOptions([...defaultOption, ...scannedModels]);
  return merged
    .map((model) => ({
      ...model,
      isDefault: defaultModelId ? model.id === defaultModelId : undefined
    }))
    .sort((left, right) => Number(Boolean(right.isDefault)) - Number(Boolean(left.isDefault)));
}

function mergeHarnessModelOptions(options: HarnessModelOption[]): HarnessModelOption[] {
  const merged: HarnessModelOption[] = [];
  const indexesById = new Map<string, number>();
  for (const option of options) {
    if (!option.id) continue;
    const existingIndex = indexesById.get(option.id);
    if (existingIndex === undefined) {
      indexesById.set(option.id, merged.length);
      merged.push(option);
      continue;
    }
    const existing = merged[existingIndex]!;
    merged[existingIndex] = {
      ...existing,
      ...option,
      thinkingLevels: option.thinkingLevels?.length ? option.thinkingLevels : existing.thinkingLevels
    };
  }
  return merged;
}

function resolveCodexConfigRoots(env: NodeJS.ProcessEnv): string[] {
  const roots = [readEnvString(env, "CODEX_HOME"), join(homedir(), ".codex")].filter((root): root is string => Boolean(root));
  return [...new Set(roots.map((root) => resolve(root)))];
}

function resolveClaudeCodeConfigRoots(env: NodeJS.ProcessEnv): string[] {
  const roots = [readEnvString(env, "CLAUDE_CONFIG_DIR"), join(homedir(), ".claude")].filter((root): root is string => Boolean(root));
  return [...new Set(roots.map((root) => resolve(root)))];
}

function readTopLevelTomlString(path: string, key: string): string | undefined {
  let content: string;
  try {
    content = readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
  const pattern = new RegExp(`^${escapeRegExp(key)}\\s*=\\s*(?:"([^"]+)"|'([^']+)'|([^\\s#]+))`);
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("[")) return undefined;
    const match = pattern.exec(line);
    const value = match?.[1] ?? match?.[2] ?? match?.[3];
    if (value?.trim()) return value.trim();
  }
  return undefined;
}

function readJsonFile(path: string): unknown {
  if (!fileExists(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

function isChatThinkingEffort(value: string | undefined): value is ChatThinkingEffort {
  return value === "off" ||
    value === "minimal" ||
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "adaptive" ||
    value === "xhigh" ||
    value === "max";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readEnvString(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name]?.trim();
  return value || undefined;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

const maxChatMessageChars = 40_000;
const maxChatAttachments = 6;
const maxChatAttachmentTextChars = 24_000;

async function refreshCatalog(adapter: RuntimeAdapter, store: FileHivewardStore): Promise<CatalogSnapshot> {
  const now = new Date();
  const snapshot: CatalogSnapshot = {
    id: `catalog-${nanoid(8)}`,
    source: "openclaw",
    sourceUpdatedAt: now.toISOString(),
    refreshedAt: now.toISOString(),
    staleAfter: new Date(now.getTime() + 1000 * 60 * 15).toISOString(),
    models: await adapter.listModels(),
    agents: await adapter.listAgents(),
    tools: await adapter.listTools(),
    channels: await adapter.listChannels()
  };
  return store.saveCatalogSnapshot(snapshot);
}

function emptyCatalogSnapshot(): CatalogSnapshot {
  const now = new Date();
  return {
    id: "catalog-unscanned",
    source: "openclaw",
    sourceUpdatedAt: now.toISOString(),
    refreshedAt: now.toISOString(),
    staleAfter: now.toISOString(),
    models: [],
    agents: [],
    tools: [],
    channels: []
  };
}

function selectDefaultAgentId(agents: OpenClawConfiguredAgent[]): string {
  return agents.find((agent) => agent.isDefault)?.id ?? agents[0]?.id ?? "main";
}

function selectDefaultChannelId(channels: OpenClawConfiguredChannel[]): string | undefined {
  return channels.find((channel) => channel.enabled)?.id ?? channels[0]?.id;
}

function emptyRuntimeOverview(): RuntimeOverview {
  return {
    sessions: [],
    tasks: []
  };
}
