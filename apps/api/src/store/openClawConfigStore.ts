import { execFile } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type {
  CreateOpenClawAgentRequest,
  OpenClawConfigState,
  OpenClawConfiguredAgent,
  OpenClawConfiguredModel
} from "@openclaw-cui/shared";

const execFileAsync = promisify(execFile);

interface OpenClawConfigFile {
  agent?: {
    model?: string | { primary?: string };
  };
  agents?: {
    defaults?: {
      workspace?: string;
      models?: Record<string, { alias?: string }>;
      model?: string | { primary?: string };
    };
    list?: Array<{
      id?: string;
      default?: boolean;
      name?: string;
      workspace?: string;
      agentDir?: string;
      model?: string | { primary?: string };
    }>;
  };
  models?: {
    providers?: Record<string, { models?: Array<{ id?: string; name?: string }> }>;
  };
  [key: string]: unknown;
}

export class OpenClawConfigStore {
  private readonly configPath: string;

  constructor(configPath = resolveOpenClawConfigPath()) {
    this.configPath = configPath;
  }

  async getState(): Promise<OpenClawConfigState> {
    const config = await this.readConfig();
    return this.toState(config);
  }

  async updateDefaultModel(modelId: string): Promise<OpenClawConfigState> {
    await runOpenClawCli(["models", "set", modelId.trim()], { timeoutMs: 120_000 });
    return this.getState();
  }

  async addAgent(input: CreateOpenClawAgentRequest): Promise<OpenClawConfigState> {
    if (!input.name.trim()) {
      throw new Error("Agent name is required.");
    }
    const config = await this.readConfig();
    const agentId = normalizeAgentId(input.name);
    const workspace = input.workspace?.trim() || resolveSuggestedWorkspace(config, agentId);
    const args = [
      "agents",
      "add",
      input.name.trim(),
      "--non-interactive",
      "--workspace",
      workspace,
      "--json"
    ];
    if (input.modelId?.trim()) {
      args.push("--model", input.modelId.trim());
    }

    await runOpenClawCli(args, { timeoutMs: 300_000 });
    return this.getState();
  }

  private async readConfig(): Promise<OpenClawConfigFile> {
    try {
      const raw = await readFile(this.configPath, "utf8");
      return JSON.parse(raw) as OpenClawConfigFile;
    } catch {
      return {};
    }
  }

  private toState(config: OpenClawConfigFile): OpenClawConfigState {
    const defaultWorkspace = resolveDefaultWorkspace(config);
    const defaultModelId = resolveModelId(config.agents?.defaults?.model) ?? resolveModelId(config.agent?.model);

    return {
      configPath: this.configPath,
      defaultWorkspace,
      defaultModelId,
      configuredModels: collectConfiguredModels(config, defaultModelId),
      configuredAgents: buildConfiguredAgents(config, defaultWorkspace, defaultModelId)
    };
  }
}

function resolveOpenClawConfigPath(): string {
  const explicit = process.env.OPENCLAW_CONFIG_PATH?.trim() || process.env.OPENCLAW_CONFIG_FILE?.trim();
  if (explicit) return path.resolve(expandHome(explicit));
  return path.join(resolveStateDir(), "openclaw.json");
}

function resolveStateDir(): string {
  const explicit = process.env.OPENCLAW_STATE_DIR?.trim();
  if (explicit) return path.resolve(expandHome(explicit));
  return path.join(homedir(), ".openclaw");
}

function resolveDefaultWorkspace(config: OpenClawConfigFile): string {
  const configured = config.agents?.defaults?.workspace?.trim();
  if (configured) return path.resolve(expandHome(configured));

  const profile = process.env.OPENCLAW_PROFILE?.trim();
  if (profile && profile.toLowerCase() !== "default") {
    return path.join(homedir(), ".openclaw", `workspace-${profile}`);
  }
  return path.join(homedir(), ".openclaw", "workspace");
}

function resolveSuggestedWorkspace(config: OpenClawConfigFile, agentId: string): string {
  return path.join(resolveDefaultWorkspace(config), agentId);
}

function buildConfiguredAgents(
  config: OpenClawConfigFile,
  defaultWorkspace: string,
  defaultModelId: string | undefined
): OpenClawConfiguredAgent[] {
  const entries = listAgentEntries(config);
  const defaultAgentId = entries.find((entry) => entry.default && entry.id)?.id?.trim() || entries[0]?.id?.trim() || "main";

  const normalized = entries.map((entry) => ({
    id: normalizeAgentId(entry.id),
    name: readString(entry.name),
    workspace: path.resolve(expandHome(readString(entry.workspace) || path.join(defaultWorkspace, normalizeAgentId(entry.id)))),
    agentDir: path.resolve(expandHome(readString(entry.agentDir) || path.join(resolveStateDir(), "agents", normalizeAgentId(entry.id), "agent"))),
    modelId: resolveModelId(entry.model) ?? defaultModelId,
    isDefault: normalizeAgentId(entry.id) === normalizeAgentId(defaultAgentId)
  }));

  if (normalized.length > 0) return normalized;

  return [
    {
      id: "main",
      name: "main",
      workspace: defaultWorkspace,
      agentDir: path.join(resolveStateDir(), "agents", "main", "agent"),
      modelId: defaultModelId,
      isDefault: true
    }
  ];
}

function collectConfiguredModels(config: OpenClawConfigFile, defaultModelId?: string): OpenClawConfiguredModel[] {
  const aliases = config.agents?.defaults?.models ?? {};
  const models: OpenClawConfiguredModel[] = [];

  for (const [provider, providerConfig] of Object.entries(config.models?.providers ?? {})) {
    for (const model of providerConfig.models ?? []) {
      const modelId = model.id?.trim();
      if (!modelId) continue;
      const fullId = `${provider}/${modelId}`;
      models.push({
        id: fullId,
        label: model.name?.trim() || aliases[fullId]?.alias || fullId,
        provider,
        alias: aliases[fullId]?.alias
      });
    }
  }

  for (const [fullId, meta] of Object.entries(aliases)) {
    if (models.some((model) => model.id === fullId)) continue;
    const [provider = "unknown"] = fullId.split("/", 1);
    models.push({
      id: fullId,
      label: meta.alias?.trim() || fullId,
      provider,
      alias: meta.alias?.trim()
    });
  }

  if (defaultModelId && !models.some((model) => model.id === defaultModelId)) {
    const [provider = "unknown"] = defaultModelId.split("/", 1);
    models.push({
      id: defaultModelId,
      label: defaultModelId,
      provider
    });
  }

  return models.sort((left, right) => left.label.localeCompare(right.label));
}

function listAgentEntries(config: OpenClawConfigFile): Array<NonNullable<NonNullable<OpenClawConfigFile["agents"]>["list"]>[number]> {
  return Array.isArray(config.agents?.list) ? config.agents!.list!.filter((entry) => Boolean(entry && typeof entry === "object")) : [];
}

function resolveModelId(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value && typeof value === "object" && "primary" in value && typeof (value as { primary?: unknown }).primary === "string") {
    return (value as { primary: string }).primary.trim();
  }
  return undefined;
}

function normalizeAgentId(value: unknown): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) return "main";
  const normalized = trimmed.toLowerCase();
  return normalized.replace(/[^a-z0-9_-]+/g, "-").replace(/^-+/g, "").replace(/-+$/g, "").slice(0, 64) || "main";
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function expandHome(value: string): string {
  return value.startsWith("~") ? path.join(homedir(), value.slice(1)) : value;
}

async function runOpenClawCli(args: string[], options?: { timeoutMs?: number }): Promise<string> {
  const entryPath = await resolveOpenClawCliEntry();
  try {
    const { stdout } = await execFileAsync(process.execPath, [entryPath, ...args], {
      windowsHide: true,
      timeout: options?.timeoutMs ?? 120_000,
      maxBuffer: 1024 * 1024 * 8
    });
    return stdout.trim();
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; message: string };
    const detail = failure.stderr?.trim() || failure.stdout?.trim() || failure.message;
    throw new Error(detail);
  }
}

async function resolveOpenClawCliEntry(): Promise<string> {
  const explicit = process.env.OPENCLAW_CLI_ENTRY?.trim();
  if (explicit) return path.resolve(expandHome(explicit));

  const candidates = [
    process.env.APPDATA ? path.join(process.env.APPDATA, "npm", "node_modules", "openclaw", "openclaw.mjs") : undefined,
    path.join(resolveStateDir(), "..", "AppData", "Roaming", "npm", "node_modules", "openclaw", "openclaw.mjs"),
    "/usr/local/lib/node_modules/openclaw/openclaw.mjs",
    "/opt/homebrew/lib/node_modules/openclaw/openclaw.mjs"
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      continue;
    }
  }

  try {
    const { stdout } = await execFileAsync("npm", ["root", "-g"], {
      windowsHide: true,
      timeout: 15_000
    });
    const root = stdout.trim();
    const candidate = path.join(root, "openclaw", "openclaw.mjs");
    await access(candidate);
    return candidate;
  } catch {
    throw new Error("OpenClaw CLI entry could not be resolved.");
  }
}
