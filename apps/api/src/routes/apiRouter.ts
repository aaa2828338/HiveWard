import { Router } from "express";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { nanoid } from "nanoid";
import type {
  AgentNodeConfig,
  CatalogSnapshot,
  CreateCompanyRequest,
  ConfigureOpenClawChannelRequest,
  ConfigureOpenClawModelAuthRequest,
  CreateOpenClawChannelRequest,
  CreateBlueprintRequest,
  CreateOpenClawAgentRequest,
  CreateOpenClawModelRequest,
  HarnessStatus,
  ImportBlueprintPackageRequest,
  RuntimeOverview,
  OpenClawConfiguredAgent,
  OpenClawConfiguredChannel,
  OpenClawConfigState,
  OpenClawVersionInfo,
  ParallelAgentsNodeConfig,
  SummaryNodeConfig,
  UpdateOpenClawDefaultModelRequest,
  SelectCompanyRequest,
  SaveDashboardStateRequest,
  SaveBlueprintRequest,
  BlueprintDefinition,
  StartBlueprintRunRequest
} from "@hiveward/shared";
import { createPortableBlueprintPackage, isAgentBlueprintNode, readPortableBlueprintPackage } from "@hiveward/shared";
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
      const updated = await worker.approveRun(blueprint, run);
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
