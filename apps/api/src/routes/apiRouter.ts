import { Router, type Response } from "express";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
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
  HarnessStatus,
  ImportBlueprintPackageRequest,
  RuntimeOverview,
  OpenClawConfiguredAgent,
  OpenClawConfiguredChannel,
  OpenClawConfigState,
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
  ChatThinkingEffort,
  ApproveBlueprintRunRequest,
  CreateChatSessionRequest,
  InboxItem,
  RejectInboxItemRequest,
  UpdateChatSessionTitleRequest,
  SendChatMessageRequest,
  ChatStreamEvent,
  BlueprintDefinition,
  StartBlueprintRunRequest
} from "@hiveward/shared";
import { createPortableBlueprintPackage, isAgentBlueprintNode, readPortableBlueprintPackage } from "@hiveward/shared";
import { hivewardInboxSubmissionContract, hivewardInboxSubmissionSchema } from "@hiveward/shared";
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

type ChatDoneEvent = Extract<ChatStreamEvent, { type: "done" }>;

type ChatInboxSubmissionResult = {
  item: InboxItem;
  output: string;
};

type ChatInboxSubmissionBlock = {
  fullMatch: string;
  json: string;
};

const fallbackCodexDefaultModel = "gpt-5.4";
const fallbackClaudeCodeDefaultModel = "inherit";

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
      const run = await worker.startRun(
        withRunDefaults(blueprint, {
          openclaw: config.defaultModelId,
          ...resolveHarnessModelDefaults()
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

  router.post("/api/chat/stream", async (req, res) => {
    const requestStartedAtMs = Date.now();
    let body: SendChatMessageRequest;
    try {
      body = normalizeChatRequest(req.body);
    } catch (error) {
      res.status(400).json({
        error: {
          code: "chat_request_invalid",
          message: error instanceof Error ? error.message : "Invalid chat request."
        }
      });
      return;
    }

    if (body.harnessId !== "openclaw") {
      res.status(400).json({
        error: {
          code: "chat_harness_unavailable",
          message: "Only the OpenClaw chat harness is available right now."
        }
      });
      return;
    }

    const config = await openClawConfigStore.getState();
    const roleContext = await buildChatRoleContext(store, body.roleScope);
    const agentId = body.agentId || selectDefaultAgentId(config.configuredAgents);
    const sessionKey = body.nativeSessionKey || buildOpenClawChatSessionKey(agentId);
    const chatMessageRequestId = `chat-message-${nanoid(8)}`;
    const prompt = buildChatPrompt(body, roleContext);
    const openclawStartedAtMs = Date.now();

    res.status(200);
    res.setHeader("content-type", "text/event-stream; charset=utf-8");
    res.setHeader("cache-control", "no-cache, no-transform");
    res.setHeader("connection", "keep-alive");
    res.flushHeaders?.();

    let closed = false;
    req.on("close", () => {
      closed = true;
    });

    try {
      let doneEvent: ChatDoneEvent | undefined;
      let streamedOutput = "";
      await adapter.streamChatMessage(
        {
          sessionKey,
          message: prompt,
          attachments: body.attachments ?? [],
          modelId: body.modelId,
          thinking: body.thinkingEffort,
          idempotencyKey: chatMessageRequestId,
          timeoutMs: 600_000
        },
        (event) => {
          if (event.type === "done") {
            doneEvent = event;
            return;
          }
          if (event.type === "delta") {
            streamedOutput = event.replace ? event.text : `${streamedOutput}${event.text}`;
          }
          writeChatStreamEvent(res, event, () => closed);
        }
      );
      if (doneEvent) {
        const openclawFinishedAtMs = Date.now();
        const postprocessStartedAtMs = Date.now();
        const finalOutput = doneEvent.output ?? streamedOutput;
        const submissionBlock = extractChatInboxSubmissionBlock(finalOutput);
        let submission: ChatInboxSubmissionResult | undefined;
        let inboxSubmissionMs: number | undefined;
        if (doneEvent.status === "succeeded" && submissionBlock) {
          try {
            const submissionStartedAtMs = Date.now();
            submission = await materializeChatInboxSubmission(store, body, finalOutput, submissionBlock);
            inboxSubmissionMs = Date.now() - submissionStartedAtMs;
          } catch (submissionError) {
            const message = submissionError instanceof Error ? submissionError.message : "Invalid Hiveward inbox submission.";
            const failedOutput = buildChatInboxSubmissionFailureOutput(finalOutput, submissionBlock.fullMatch, message);
            writeChatStreamEvent(res, { type: "delta", text: failedOutput, replace: true }, () => closed);
            writeChatStreamEvent(res, {
              ...withChatStreamTimings(doneEvent, requestStartedAtMs, openclawStartedAtMs, openclawFinishedAtMs, postprocessStartedAtMs, inboxSubmissionMs),
              status: "failed",
              output: failedOutput,
              error: message
            }, () => closed);
            res.end();
            return;
          }
        }
        if (submission) {
          writeChatStreamEvent(res, { type: "delta", text: submission.output, replace: true }, () => closed);
          writeChatStreamEvent(res, {
            type: "inbox_item_created",
            item: submission.item,
            message: `Created Hiveward inbox item ${submission.item.id}.`
          }, () => closed);
          writeChatStreamEvent(res, withChatStreamTimings(
            { ...doneEvent, output: submission.output },
            requestStartedAtMs,
            openclawStartedAtMs,
            openclawFinishedAtMs,
            postprocessStartedAtMs,
            inboxSubmissionMs
          ), () => closed);
        } else {
          writeChatStreamEvent(res, withChatStreamTimings(
            doneEvent,
            requestStartedAtMs,
            openclawStartedAtMs,
            openclawFinishedAtMs,
            postprocessStartedAtMs,
            inboxSubmissionMs
          ), () => closed);
        }
      }
      res.end();
    } catch (error) {
      writeChatStreamEvent(res, {
        type: "error",
        message: error instanceof Error ? error.message : "Chat request failed."
      }, () => closed);
      res.end();
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

function normalizeChatRequest(value: unknown): SendChatMessageRequest {
  if (!isPlainRecord(value)) {
    throw new Error("Chat request must be a JSON object.");
  }

  const harnessId = readOptionalString(value.harnessId);
  if (harnessId !== "openclaw" && harnessId !== "claudeCode" && harnessId !== "codex") {
    throw new Error("Chat harnessId must be openclaw, claudeCode, or codex.");
  }

  const rawThinkingEffort = readOptionalString(value.thinkingEffort);
  const thinkingEffort = rawThinkingEffort ? normalizeChatThinkingEffort(rawThinkingEffort) : "medium";
  if (!thinkingEffort) {
    throw new Error("Chat thinkingEffort must be off, minimal, low, medium, high, adaptive, xhigh, or max.");
  }

  const message = readOptionalString(value.message) ?? "";
  const attachments = normalizeChatAttachments(value.attachments);
  if (!message.trim() && attachments.length === 0) {
    throw new Error("Chat message or attachment is required.");
  }

  return {
    harnessId,
    message: message.slice(0, maxChatMessageChars),
    attachments,
    modelId: readOptionalString(value.modelId),
    agentId: readOptionalString(value.agentId),
    nativeSessionKey: readOptionalString(value.nativeSessionKey),
    thinkingEffort,
    includePlatformContext: value.includePlatformContext === true,
    mode: normalizeChatMode(value.mode),
    roleScope: normalizeChatRoleScope(value.roleScope)
  };
}

function normalizeChatMode(value: unknown): SendChatMessageRequest["mode"] {
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

async function buildChatRoleContext(store: FileHivewardStore, scope: ChatRoleScope | undefined): Promise<string | undefined> {
  if (!scope) return undefined;
  try {
    const { roles } = await store.getRoleDirectory();
    const role = scope.role === "leader"
      ? roles.leaders.find((leader) => leader.id === scope.leaderId || leader.blueprintId === scope.blueprintId)
      : roles.ceo;
    const leaderBlueprintId = role?.kind === "leader" ? role.blueprintId : scope.blueprintId;
    const lines = [
      "Hiveward role scope:",
      `- mode: ${scope.role === "leader" ? "Leader" : "CEO"} ${scope.role === "leader" ? "(business blueprint owner)" : "(company command role)"}`,
      `- roleId: ${role?.id ?? scope.leaderId ?? scope.role}`,
      `- roleLabel: ${role?.label ?? scope.role}`,
      `- companyId: ${scope.companyId ?? roles.companyId}`,
      leaderBlueprintId ? `- blueprintId: ${leaderBlueprintId}` : undefined,
      "",
      "Role rules:",
      "- CEO may discuss company direction, inspect summaries, and prepare leader delegation requests for the Hiveward inbox.",
      "- CEO must not write or directly import business blueprint JSON or patches.",
      "- Leader may read only the bound business blueprint scope and generate importable proposal packages for that blueprint.",
      "- Leader must submit concrete proposal packages to the Hiveward inbox instead of changing official blueprints directly.",
      "- Final state changes require Hiveward inbox approval and backend validation.",
      "- Architecture blueprint is a management view; business blueprint is the executable workflow DAG.",
      "",
      "Hiveward inbox submit protocol:",
      "- Chat has no implicit side effects. Saying you are ready to submit does not create an inbox item.",
      "- Hiveward will parse this block, create the inbox item, and remove the block from the visible chat response.",
      "- Do not say the item has been submitted unless you include the block.",
      "",
      hivewardInboxSubmissionContract
    ];
    return lines.filter((line): line is string => typeof line === "string").join("\n");
  } catch {
    return [
      "Hiveward role scope:",
      `- mode: ${scope.role}`,
      scope.companyId ? `- companyId: ${scope.companyId}` : undefined,
      scope.leaderId ? `- leaderId: ${scope.leaderId}` : undefined,
      scope.blueprintId ? `- blueprintId: ${scope.blueprintId}` : undefined,
      "",
      "Role rules: state changes must go through Hiveward inbox approval and backend validation.",
      "Hiveward inbox submit protocol:",
      hivewardInboxSubmissionContract
    ].filter((line): line is string => typeof line === "string").join("\n");
  }
}

function buildChatPrompt(input: SendChatMessageRequest, roleContext?: string): string {
  const contextBlocks = [
    input.includePlatformContext ? hivewardPlatformContext : undefined,
    roleContext,
    input.mode === "blueprint" ? hivewardBlueprintDraftingContext : undefined
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

function buildHistoryInboxChatRequest(parsed: Record<string, unknown>): SendChatMessageRequest {
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
  chatRequest: SendChatMessageRequest,
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

const hivewardBlueprintDraftingContext = [
  "Blueprint drafting mode:",
  "When the user asks for a blueprint change, first align on direction in chat. For final approval, produce a concrete importable content package with proposal text, JSON or patch details, preview, and diff summary.",
  "Do not describe a natural-language idea as approved or imported until the Hiveward inbox item has been approved and the backend import completed.",
  "If the user explicitly asks to submit the proposal for approval, end the response with one hiveward-inbox fenced block so Hiveward can create the real inbox item.",
  "",
  hivewardInboxSubmissionContract
].join("\n");

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
  inboxSubmissionMs: number | undefined
): T {
  const completedAtMs = Date.now();
  return {
    ...event,
    timings: {
      totalMs: Math.max(0, completedAtMs - requestStartedAtMs),
      hivewardPreprocessMs: Math.max(0, openclawStartedAtMs - requestStartedAtMs),
      openclawMs: Math.max(0, openclawFinishedAtMs - openclawStartedAtMs),
      hivewardPostprocessMs: Math.max(0, completedAtMs - postprocessStartedAtMs),
      inboxSubmissionMs
    }
  };
}

function buildOpenClawChatSessionKey(agentId: string): string {
  const normalizedAgentId = agentId.trim().replace(/[^a-zA-Z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "") || "main";
  if (normalizedAgentId.toLowerCase() === "main") return "main";
  return `agent:${normalizedAgentId}:main`;
}

function buildHarnessStatuses(
  version: OpenClawVersionInfo,
  config: OpenClawConfigState,
  defaults: Pick<RunModelDefaults, "codex" | "claude">
): HarnessStatus[] {
  const checkedAt = new Date().toISOString();
  return [
    buildOpenClawHarnessStatus(version, config, checkedAt),
    buildClaudeCodeHarnessStatus(checkedAt, defaults.claude),
    buildCodexHarnessStatus(checkedAt, defaults.codex)
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

function buildClaudeCodeHarnessStatus(checkedAt: string, defaultModelId: string | undefined): HarnessStatus {
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
        detail: defaultModelId ?? "No default Claude Code model was resolved."
      }
    ]
  };
}

function buildCodexHarnessStatus(checkedAt: string, defaultModelId: string | undefined): HarnessStatus {
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
        detail: defaultModelId ?? "No default Codex model was resolved."
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

function resolveHarnessModelDefaults(env: NodeJS.ProcessEnv = process.env): Pick<RunModelDefaults, "codex" | "claude"> {
  return {
    codex: readEnvString(env, "HIVEWARD_CODEX_DEFAULT_MODEL") ?? readEnvString(env, "CODEX_DEFAULT_MODEL") ?? fallbackCodexDefaultModel,
    claude:
      readEnvString(env, "HIVEWARD_CLAUDE_CODE_DEFAULT_MODEL") ??
      readEnvString(env, "CLAUDE_CODE_DEFAULT_MODEL") ??
      fallbackClaudeCodeDefaultModel
  };
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
