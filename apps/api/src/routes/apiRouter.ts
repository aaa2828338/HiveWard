import { Router } from "express";
import { nanoid } from "nanoid";
import type {
  AgentNodeConfig,
  CatalogSnapshot,
  ConfigureOpenClawChannelRequest,
  ConfigureOpenClawModelAuthRequest,
  CreateOpenClawChannelRequest,
  CreateWorkflowRequest,
  CreateOpenClawAgentRequest,
  CreateOpenClawModelRequest,
  ImportWorkflowPackageRequest,
  RuntimeOverview,
  OpenClawConfiguredAgent,
  OpenClawConfiguredChannel,
  ParallelAgentsNodeConfig,
  UpdateOpenClawDefaultModelRequest,
  SelectCompanyRequest,
  SaveDashboardStateRequest,
  SaveWorkflowRequest,
  WorkflowDefinition,
  StartWorkflowRunRequest
} from "@openclaw-cui/shared";
import { createPortableWorkflowPackage, readPortableWorkflowPackage } from "@openclaw-cui/shared";
import type { OpenClawAdapter } from "@openclaw-cui/adapter";
import type { FileCuiStore } from "../store/fileCuiStore";
import type { OpenClawConfigStore } from "../store/openClawConfigStore";
import type { WorkflowWorker } from "../worker/workflowWorker";

interface ApiRouterDeps {
  store: FileCuiStore;
  openClawConfigStore: OpenClawConfigStore;
  adapter: OpenClawAdapter;
  worker: WorkflowWorker;
}

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

  router.put("/api/companies/selected", async (req, res, next) => {
    try {
      const body = req.body as SelectCompanyRequest;
      res.json(await store.selectCompany(body.companyId));
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

  router.get("/api/workflows", async (_req, res, next) => {
    try {
      res.json({ workflows: await store.listWorkflows() });
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/workflows", async (req, res, next) => {
    try {
      const body = req.body as CreateWorkflowRequest;
      const workflow = await store.createWorkflow({
        name: body.name,
        description: body.description
      });
      res.status(201).json({ workflow });
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/workflows/import", async (req, res, next) => {
    try {
      const body = req.body as ImportWorkflowPackageRequest;
      const workflowPackage = readPortableWorkflowPackage(body.workflowPackage);
      const config = await openClawConfigStore.getState();
      const workflows = await store.importWorkflowPackage(workflowPackage, {
        agentId: selectDefaultAgentId(config.configuredAgents),
        modelId: config.defaultModelId,
        channelId: selectDefaultChannelId(config.configuredChannels)
      });
      res.status(201).json({ workflows });
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/workflows/:workflowId", async (req, res, next) => {
    try {
      const workflow = await store.getWorkflow(req.params.workflowId);
      if (!workflow) {
        res.status(404).json({ error: { code: "workflow_not_found", message: "Workflow not found." } });
        return;
      }
      res.json({ workflow });
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/workflows/:workflowId/export", async (req, res, next) => {
    try {
      const workflow = await store.getWorkflow(req.params.workflowId);
      if (!workflow) {
        res.status(404).json({ error: { code: "workflow_not_found", message: "Workflow not found." } });
        return;
      }
      res.json({ workflowPackage: createPortableWorkflowPackage([workflow], new Date().toISOString()) });
    } catch (error) {
      next(error);
    }
  });

  router.put("/api/workflows/:workflowId", async (req, res, next) => {
    try {
      const body = req.body as SaveWorkflowRequest;
      const saved = await store.saveWorkflow({
        ...body.workflow,
        id: req.params.workflowId
      });
      res.json({ workflow: saved });
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/workflows/:workflowId/runs", async (req, res, next) => {
    try {
      const workflow = await store.getWorkflow(req.params.workflowId);
      if (!workflow) {
        res.status(404).json({ error: { code: "workflow_not_found", message: "Workflow not found." } });
        return;
      }
      const configuredAgents = await openClawConfigStore.getState();
      const invalidAgentIds = collectInvalidAgentIds(workflow, new Set(configuredAgents.configuredAgents.map((agent) => agent.id)));
      if (invalidAgentIds.length > 0) {
        res.status(400).json({
          error: {
            code: "workflow_agent_invalid",
            message: `Workflow references agent ids that are not present in OpenClaw config: ${invalidAgentIds.join(", ")}`
          }
        });
        return;
      }
      const body = req.body as StartWorkflowRunRequest;
      const run = await worker.startRun(workflow, body.startedBy ?? "local-user");
      const view = await store.getRunView(run.id);
      res.status(201).json({ run: view });
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/workflows/:workflowId/runs/latest", async (req, res, next) => {
    try {
      const workflow = await store.getWorkflow(req.params.workflowId);
      if (!workflow) {
        res.status(404).json({ error: { code: "workflow_not_found", message: "Workflow not found." } });
        return;
      }
      res.json({ run: (await store.getLatestRunViewForWorkflow(req.params.workflowId)) ?? null });
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/workflow-runs/:runId", async (req, res, next) => {
    try {
      const view = await store.getRunView(req.params.runId);
      if (!view) {
        res.status(404).json({ error: { code: "run_not_found", message: "Workflow run not found." } });
        return;
      }
      res.json({ run: view });
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/workflow-runs", async (_req, res, next) => {
    try {
      res.json({ runs: await store.listRunViews() });
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

  router.post("/api/workflow-runs/:runId/approve", async (req, res, next) => {
    try {
      const run = await store.getWorkflowRun(req.params.runId);
      if (!run) {
        res.status(404).json({ error: { code: "run_not_found", message: "Workflow run not found." } });
        return;
      }
      const workflow = await store.getWorkflow(run.workflowId);
      if (!workflow) {
        res.status(404).json({ error: { code: "workflow_not_found", message: "Workflow not found." } });
        return;
      }
      const updated = await worker.approveRun(workflow, run);
      const view = await store.getRunView(updated.id);
      res.json({ run: view });
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/catalog/snapshot", async (_req, res, next) => {
    try {
      let snapshot = await store.getCatalogSnapshot();
      if (!snapshot) {
        snapshot = await refreshCatalog(adapter, store);
      }
      res.json({ snapshot });
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

function collectInvalidAgentIds(workflow: WorkflowDefinition, configuredAgentIds: Set<string>): string[] {
  const invalid = new Set<string>();

  for (const node of workflow.nodes) {
    if (node.type === "agent") {
      const agentId = (node.config as AgentNodeConfig).agentId ?? "main";
      if (!configuredAgentIds.has(agentId)) invalid.add(agentId);
      continue;
    }
    if (node.type === "parallel_agents") {
      for (const agent of (node.config as ParallelAgentsNodeConfig).agents) {
        const agentId = agent.agentId ?? "main";
        if (!configuredAgentIds.has(agentId)) invalid.add(agentId);
      }
    }
  }

  return [...invalid];
}

async function refreshCatalog(adapter: OpenClawAdapter, store: FileCuiStore): Promise<CatalogSnapshot> {
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
