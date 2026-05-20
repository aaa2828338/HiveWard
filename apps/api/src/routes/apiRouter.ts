import { Router } from "express";
import { nanoid } from "nanoid";
import type {
  AgentNodeConfig,
  CatalogSnapshot,
  ConfigureOpenClawChannelRequest,
  ConfigureOpenClawModelAuthRequest,
  CreateOpenClawChannelRequest,
  CreateMissionRequest,
  CreateOpenClawAgentRequest,
  CreateOpenClawModelRequest,
  ImportMissionPackageRequest,
  RuntimeOverview,
  OpenClawConfiguredAgent,
  OpenClawConfiguredChannel,
  ParallelAgentsNodeConfig,
  SummaryNodeConfig,
  UpdateOpenClawDefaultModelRequest,
  SelectCompanyRequest,
  SaveDashboardStateRequest,
  SaveMissionRequest,
  MissionDefinition,
  StartMissionRunRequest
} from "@hiveward/shared";
import { createPortableMissionPackage, readPortableMissionPackage } from "@hiveward/shared";
import type { OpenClawAdapter } from "@hiveward/adapter";
import type { FileHivewardStore } from "../store/fileHivewardStore";
import type { OpenClawConfigStore } from "../store/openClawConfigStore";
import { listOpenClawModelUsage } from "../store/openClawUsageStore";
import type { MissionWorker } from "../worker/missionWorker";

interface ApiRouterDeps {
  store: FileHivewardStore;
  openClawConfigStore: OpenClawConfigStore;
  adapter: OpenClawAdapter;
  worker: MissionWorker;
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

  router.get("/api/missions", async (_req, res, next) => {
    try {
      res.json({ missions: await store.listMissions() });
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/missions", async (req, res, next) => {
    try {
      const body = req.body as CreateMissionRequest;
      const mission = await store.createMission({
        name: body.name,
        description: body.description
      });
      res.status(201).json({ mission });
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/missions/import", async (req, res, next) => {
    try {
      const body = req.body as ImportMissionPackageRequest;
      const missionPackage = readPortableMissionPackage(body.missionPackage);
      const config = await openClawConfigStore.getState();
      const missions = await store.importMissionPackage(missionPackage, {
        agentId: selectDefaultAgentId(config.configuredAgents),
        modelId: config.defaultModelId,
        channelId: selectDefaultChannelId(config.configuredChannels)
      });
      res.status(201).json({ missions });
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/missions/:missionId", async (req, res, next) => {
    try {
      const missionId = readRouteParam(req.params.missionId, "missionId");
      const mission = await store.getMission(missionId);
      if (!mission) {
        res.status(404).json({ error: { code: "mission_not_found", message: "Mission not found." } });
        return;
      }
      res.json({ mission });
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/missions/:missionId/export", async (req, res, next) => {
    try {
      const missionId = readRouteParam(req.params.missionId, "missionId");
      const mission = await store.getMission(missionId);
      if (!mission) {
        res.status(404).json({ error: { code: "mission_not_found", message: "Mission not found." } });
        return;
      }
      res.json({ missionPackage: createPortableMissionPackage([mission], new Date().toISOString()) });
    } catch (error) {
      next(error);
    }
  });

  router.put("/api/missions/:missionId", async (req, res, next) => {
    try {
      const body = req.body as SaveMissionRequest;
      const saved = await store.saveMission({
        ...body.mission,
        id: readRouteParam(req.params.missionId, "missionId")
      });
      res.json({ mission: saved });
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/missions/:missionId/runs", async (req, res, next) => {
    try {
      const missionId = readRouteParam(req.params.missionId, "missionId");
      const mission = await store.getMission(missionId);
      if (!mission) {
        res.status(404).json({ error: { code: "mission_not_found", message: "Mission not found." } });
        return;
      }
      const config = await openClawConfigStore.getState();
      const invalidAgentIds = collectInvalidAgentIds(mission, new Set(config.configuredAgents.map((agent) => agent.id)));
      if (invalidAgentIds.length > 0) {
        res.status(400).json({
          error: {
            code: "mission_agent_invalid",
            message: `Mission references agent ids that are not present in OpenClaw config: ${invalidAgentIds.join(", ")}`
          }
        });
        return;
      }
      const body = req.body as StartMissionRunRequest;
      const run = await worker.startRun(withRunDefaults(mission, config.defaultModelId), body.startedBy ?? "local-user");
      const view = await store.getRunView(run.id);
      res.status(201).json({ run: view });
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/missions/:missionId/runs/latest", async (req, res, next) => {
    try {
      const missionId = readRouteParam(req.params.missionId, "missionId");
      const mission = await store.getMission(missionId);
      if (!mission) {
        res.status(404).json({ error: { code: "mission_not_found", message: "Mission not found." } });
        return;
      }
      res.json({ run: (await store.getLatestRunViewForMission(missionId)) ?? null });
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/mission-runs/:runId", async (req, res, next) => {
    try {
      const view = await store.getRunView(readRouteParam(req.params.runId, "runId"));
      if (!view) {
        res.status(404).json({ error: { code: "run_not_found", message: "Mission run not found." } });
        return;
      }
      res.json({ run: view });
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/mission-runs", async (_req, res, next) => {
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

  router.post("/api/mission-runs/:runId/approve", async (req, res, next) => {
    try {
      const run = await store.getMissionRun(readRouteParam(req.params.runId, "runId"));
      if (!run) {
        res.status(404).json({ error: { code: "run_not_found", message: "Mission run not found." } });
        return;
      }
      const mission = await store.getMission(run.missionId);
      if (!mission) {
        res.status(404).json({ error: { code: "mission_not_found", message: "Mission not found." } });
        return;
      }
      const updated = await worker.approveRun(mission, run);
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

function collectInvalidAgentIds(mission: MissionDefinition, configuredAgentIds: Set<string>): string[] {
  const invalid = new Set<string>();

  for (const node of mission.nodes) {
    if (node.type === "openclaw_agent") {
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

function readRouteParam(value: string | string[] | undefined, name: string): string {
  if (Array.isArray(value)) {
    const [first] = value;
    if (first) return first;
  }
  if (typeof value === "string" && value) return value;
  throw new Error(`Missing route parameter: ${name}`);
}

function withRunDefaults(mission: MissionDefinition, defaultModelId?: string): MissionDefinition {
  if (!defaultModelId) return mission;

  return {
    ...mission,
    nodes: mission.nodes.map((node) => {
      if (node.type === "openclaw_agent") {
        const config = node.config as AgentNodeConfig;
        return config.modelId ? node : { ...node, config: { ...config, modelId: defaultModelId } };
      }
      if (node.type === "parallel_agents") {
        const config = node.config as ParallelAgentsNodeConfig;
        return {
          ...node,
          config: {
            ...config,
            agents: config.agents.map((agent) => (agent.modelId ? agent : { ...agent, modelId: defaultModelId }))
          }
        };
      }
      if (node.type === "summary") {
        const config = node.config as SummaryNodeConfig;
        return config.mode === "openclaw_agent" && !config.modelId ? { ...node, config: { ...config, modelId: defaultModelId } } : node;
      }
      return node;
    })
  };
}

async function refreshCatalog(adapter: OpenClawAdapter, store: FileHivewardStore): Promise<CatalogSnapshot> {
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
