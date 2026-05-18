import { Router } from "express";
import { nanoid } from "nanoid";
import type {
  CatalogSnapshot,
  SaveDashboardStateRequest,
  SaveWorkflowRequest,
  StartWorkflowRunRequest
} from "@openclaw-cui/shared";
import type { OpenClawAdapter } from "@openclaw-cui/adapter";
import type { FileCuiStore } from "../store/fileCuiStore";
import type { WorkflowWorker } from "../worker/workflowWorker";

interface ApiRouterDeps {
  store: FileCuiStore;
  adapter: OpenClawAdapter;
  worker: WorkflowWorker;
}

export function createApiRouter({ store, adapter, worker }: ApiRouterDeps): Router {
  const router = Router();

  router.get("/healthz", (_req, res) => {
    res.json({ ok: true });
  });

  router.get("/readyz", (_req, res) => {
    res.json({ ok: true, runtimeDiscovery: "not_on_readiness_path" });
  });

  router.get("/api/workflows", async (_req, res, next) => {
    try {
      res.json({ workflows: await store.listWorkflows() });
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

  router.get("/api/runtime-overview", async (_req, res, next) => {
    try {
      const [sessions, tasks] = await Promise.all([adapter.listSessions(), adapter.listTasks()]);
      res.json({ runtime: { sessions, tasks } });
    } catch (error) {
      next(error);
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
