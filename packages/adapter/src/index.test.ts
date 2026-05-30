import { afterEach, describe, expect, it } from "vitest";
import { createRuntimeAdapter } from "./index";

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

describe("createRuntimeAdapter", () => {
  it("fails OpenClaw calls explicitly in auto mode when no Gateway is configured", async () => {
    process.env.OPENCLAW_ADAPTER = "auto";
    process.env.OPENCLAW_CONFIG_FILE = "Z:/does-not-exist/openclaw.json";
    delete process.env.OPENCLAW_GATEWAY_URL;

    const adapter = createRuntimeAdapter({ sdkWorkspaceRoot: process.cwd() });

    await expect(adapter.createChatSession({ agentId: "main" })).rejects.toMatchObject({
      code: "openclaw_gateway_not_configured",
      statusCode: 503
    });
  });

  it("keeps explicit mock mode available for demos", async () => {
    process.env.OPENCLAW_ADAPTER = "mock";
    process.env.OPENCLAW_CONFIG_FILE = "Z:/does-not-exist/openclaw.json";
    delete process.env.OPENCLAW_GATEWAY_URL;

    const adapter = createRuntimeAdapter({ sdkWorkspaceRoot: process.cwd() });
    const events: unknown[] = [];

    await adapter.streamChatMessage(
      {
        sessionKey: "main",
        source: "openclaw",
        message: "hello",
        attachments: [],
        idempotencyKey: "request-1"
      },
      (event) => events.push(event)
    );

    expect(events).toContainEqual(expect.objectContaining({
      type: "done",
      status: "succeeded",
      output: expect.stringContaining("completed through runtime adapter")
    }));
  });
});
