import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

export interface GatewayAdapterConfig {
  url: string;
  origin: string;
  token?: string;
  password?: string;
  locale: string;
  requestTimeoutMs: number;
  agentTimeoutMs: number;
}

interface OpenClawConfigFile {
  gateway?: {
    port?: number;
    remote?: {
      url?: string;
      token?: string;
      password?: string;
    };
    auth?: {
      token?: string;
      password?: string;
    };
  };
}

export function resolveGatewayAdapterConfig(): GatewayAdapterConfig | undefined {
  const config = readOpenClawConfig();
  const envUrl = normalizeString(process.env.OPENCLAW_GATEWAY_URL);
  const configuredUrl = normalizeString(config?.gateway?.remote?.url);
  const configuredPort = config?.gateway?.port;
  const url = envUrl ?? configuredUrl ?? (configuredPort ? `ws://127.0.0.1:${configuredPort}` : undefined);

  if (!url) return undefined;

  const token =
    normalizeString(process.env.OPENCLAW_GATEWAY_TOKEN) ??
    normalizeString(config?.gateway?.remote?.token) ??
    normalizeString(config?.gateway?.auth?.token);
  const password =
    normalizeString(process.env.OPENCLAW_GATEWAY_PASSWORD) ??
    normalizeString(config?.gateway?.remote?.password) ??
    normalizeString(config?.gateway?.auth?.password);

  return {
    url,
    origin: normalizeString(process.env.OPENCLAW_GATEWAY_ORIGIN) ?? websocketUrlToHttpOrigin(url),
    token,
    password,
    locale: normalizeString(process.env.OPENCLAW_GATEWAY_LOCALE) ?? "zh-CN",
    requestTimeoutMs: readIntegerEnv("OPENCLAW_GATEWAY_REQUEST_TIMEOUT_MS", 20_000),
    agentTimeoutMs: readIntegerEnv("OPENCLAW_AGENT_TIMEOUT_MS", 120_000),
  };
}

function readOpenClawConfig(): OpenClawConfigFile | undefined {
  const explicit = normalizeString(process.env.OPENCLAW_CONFIG_FILE);
  const filePath = explicit ?? resolve(homedir(), ".openclaw", "openclaw.json");
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as OpenClawConfigFile;
  } catch {
    return undefined;
  }
}

function websocketUrlToHttpOrigin(url: string): string {
  const parsed = new URL(url);
  parsed.protocol = parsed.protocol === "wss:" ? "https:" : "http:";
  parsed.pathname = "/";
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

function readIntegerEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function normalizeString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
