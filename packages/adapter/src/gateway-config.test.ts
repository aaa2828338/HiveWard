import { afterEach, describe, expect, it } from "vitest";
import { resolveGatewayAdapterConfig } from "./gateway-config";

const originalEnv = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) {
      delete process.env[key];
    }
  }

  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe("resolveGatewayAdapterConfig", () => {
  it("uses the default agent start timeout when no override is set", () => {
    process.env.OPENCLAW_CONFIG_FILE = "Z:/does-not-exist/openclaw.json";
    process.env.OPENCLAW_GATEWAY_URL = "ws://127.0.0.1:18789";
    delete process.env.OPENCLAW_AGENT_START_TIMEOUT_MS;

    const config = resolveGatewayAdapterConfig();
    expect(config?.agentStartTimeoutMs).toBe(120_000);
  });

  it("uses OPENCLAW_AGENT_START_TIMEOUT_MS for agent start timeout", () => {
    process.env.OPENCLAW_CONFIG_FILE = "Z:/does-not-exist/openclaw.json";
    process.env.OPENCLAW_GATEWAY_URL = "ws://127.0.0.1:18789";
    process.env.OPENCLAW_AGENT_START_TIMEOUT_MS = "15000";

    const config = resolveGatewayAdapterConfig();
    expect(config?.agentStartTimeoutMs).toBe(15_000);
  });
});
