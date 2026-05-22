import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import express from "express";
import { describe, expect, it } from "vitest";
import { MockRuntimeAdapter, type RuntimeChatSessionInput, type RuntimeChatStreamInput } from "@hiveward/adapter";
import type {
  AgentNodeConfig,
  BlueprintDefinition,
  ChatStreamEvent,
  OpenClawConfigState,
  OpenClawVersionInfo,
  RuntimeOverview,
  StartAgentTaskInput
} from "@hiveward/shared";
import { createApiRouter } from "./apiRouter";
import { FileHivewardStore } from "../store/fileHivewardStore";
import type { OpenClawConfigStore } from "../store/openClawConfigStore";
import type { BlueprintWorker } from "../worker/blueprintWorker";

class TrackingAdapter extends MockRuntimeAdapter {
  runtimeOverviewCalls = 0;
  lastStartInput: StartAgentTaskInput | undefined;
  lastChatSessionInput: RuntimeChatSessionInput | undefined;
  lastChatStreamInput: RuntimeChatStreamInput | undefined;

  override async startAgentTask(input: StartAgentTaskInput) {
    this.lastStartInput = input;
    return super.startAgentTask(input);
  }

  override async streamChatMessage(input: RuntimeChatStreamInput, onEvent: (event: ChatStreamEvent) => void) {
    this.lastChatStreamInput = input;
    return super.streamChatMessage(input, onEvent);
  }

  override async createChatSession(input: RuntimeChatSessionInput) {
    this.lastChatSessionInput = input;
    return super.createChatSession(input);
  }

  override async getRuntimeOverview(): Promise<RuntimeOverview> {
    this.runtimeOverviewCalls += 1;
    throw new Error("runtime overview is not on the run read path");
  }
}

describe("apiRouter", () => {
  it("creates and selects a new company", async () => {
    const fixture = await createStoreFixture();
    try {
      await withApiServer(fixture.store, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/companies`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: "Field Ops",
            businessGoal: "Coordinate field operations.",
            logoLabel: "FO"
          })
        });
        const body = await readOkJson<{
          companies: Array<{ id: string; name: string; businessGoal: string; logoLabel?: string }>;
          selectedCompanyId?: string;
        }>(response);
        const company = body.companies.find((item) => item.name === "Field Ops");

        expect(company).toMatchObject({
          businessGoal: "Coordinate field operations.",
          logoLabel: "FO"
        });
        expect(body.selectedCompanyId).toBe(company?.id);
      });
    } finally {
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it("deletes a selected company and its scoped blueprints", async () => {
    const fixture = await createStoreFixture();
    try {
      await withApiServer(fixture.store, async (baseUrl) => {
        const createCompanyResponse = await fetch(`${baseUrl}/api/companies`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: "Archive Lab",
            businessGoal: "Temporary company for deletion coverage."
          })
        });
        const createdCompanyBody = await readOkJson<{ selectedCompanyId: string }>(createCompanyResponse);
        const companyId = createdCompanyBody.selectedCompanyId;

        const createBlueprintResponse = await fetch(`${baseUrl}/api/blueprints`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "Temporary deletion blueprint" })
        });
        const createdBlueprintBody = await readOkJson<{ blueprint: { id: string } }>(createBlueprintResponse);
        const blueprintPath = join(fixture.dir, "blueprints", `${createdBlueprintBody.blueprint.id}.json`);
        expect(existsSync(blueprintPath)).toBe(true);

        const deleteResponse = await fetch(`${baseUrl}/api/companies/${companyId}`, {
          method: "DELETE"
        });
        const deleteBody = await readOkJson<{
          companies: Array<{ id: string; name: string }>;
          selectedCompanyId?: string;
          deleted: boolean;
        }>(deleteResponse);

        expect(deleteBody.deleted).toBe(true);
        expect(deleteBody.companies.some((company) => company.id === companyId)).toBe(false);
        expect(deleteBody.selectedCompanyId).not.toBe(companyId);
        expect(existsSync(blueprintPath)).toBe(false);
      });
    } finally {
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it("lists run summaries from runIndex without reading archive files", async () => {
    const fixture = await createStoreFixture();
    try {
      const blueprint = (await fixture.store.listBlueprints())[0]!;
      const run = await fixture.store.createBlueprintRun(blueprint, "tester");
      rmSync(join(fixture.dir, "runs", `${run.id}.json`), { force: true });

      await withApiServer(fixture.store, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/blueprint-runs`);
        const body = await readOkJson<{ runs: Array<Record<string, unknown>> }>(response);

        expect(body.runs[0]).toMatchObject({
          id: run.id,
          blueprintId: blueprint.id,
          blueprintName: blueprint.name
        });
        expect(body.runs[0]).not.toHaveProperty("nodeRuns");
        expect(body.runs[0]).not.toHaveProperty("events");
      });
    } finally {
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it("serves a single run archive without touching runtime overview", async () => {
    const fixture = await createStoreFixture();
    const adapter = new TrackingAdapter();
    try {
      const blueprint = (await fixture.store.listBlueprints())[0]!;
      const run = await fixture.store.createBlueprintRun(blueprint, "tester");

      await withApiServer(fixture.store, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/blueprint-runs/${run.id}`);
        const body = await readOkJson<{ run: { run: { id: string }; nodeRuns: unknown[]; events: unknown[] } }>(response);

        expect(body.run.run.id).toBe(run.id);
        expect(body.run.nodeRuns).toEqual([]);
        expect(body.run.events).toEqual([]);
        expect(adapter.runtimeOverviewCalls).toBe(0);
      }, adapter);
    } finally {
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it("deletes a blueprint from the selected company", async () => {
    const fixture = await createStoreFixture();
    try {
      const blueprint = (await fixture.store.listBlueprints())[0]!;

      await withApiServer(fixture.store, async (baseUrl) => {
        const deleteResponse = await fetch(`${baseUrl}/api/blueprints/${blueprint.id}`, {
          method: "DELETE"
        });
        const deleteBody = await readOkJson<{ blueprintId: string }>(deleteResponse);
        expect(deleteBody.blueprintId).toBe(blueprint.id);

        const listResponse = await fetch(`${baseUrl}/api/blueprints`);
        const listBody = await readOkJson<{ blueprints: Array<{ id: string }> }>(listResponse);
        expect(listBody.blueprints.some((item) => item.id === blueprint.id)).toBe(false);

        const getResponse = await fetch(`${baseUrl}/api/blueprints/${blueprint.id}`);
        expect(getResponse.status).toBe(404);
      });
    } finally {
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it("injects runtime default models before starting a blueprint run", async () => {
    const fixture = await createStoreFixture();
    const previousCodexDefault = process.env.HIVEWARD_CODEX_DEFAULT_MODEL;
    const previousClaudeDefault = process.env.HIVEWARD_CLAUDE_CODE_DEFAULT_MODEL;
    process.env.HIVEWARD_CODEX_DEFAULT_MODEL = "codex/test-default";
    process.env.HIVEWARD_CLAUDE_CODE_DEFAULT_MODEL = "claude/test-default";

    const startedBlueprints: BlueprintDefinition[] = [];
    const worker = {
      async startRun(blueprint: BlueprintDefinition, startedBy: string) {
        startedBlueprints.push(blueprint);
        return fixture.store.createBlueprintRun(blueprint, startedBy);
      }
    } as unknown as BlueprintWorker;

    try {
      await withApiServer(
        fixture.store,
        async (baseUrl) => {
          const response = await fetch(`${baseUrl}/api/blueprints/multi-agent-compatibility-blueprint/runs`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ startedBy: "tester" })
          });
          await readOkJson(response);

          const started = startedBlueprints[0]!;
          expect(readAgentConfig(started, "compat-openclaw-brief").modelId).toBe("openclaw/default");
          expect(readAgentConfig(started, "compat-codex-check").modelId).toBe("codex/test-default");
          expect(readAgentConfig(started, "compat-claude-check").modelId).toBe("claude/test-default");
        },
        new TrackingAdapter(),
        createConfigStoreFixture(),
        worker
      );
    } finally {
      restoreEnv("HIVEWARD_CODEX_DEFAULT_MODEL", previousCodexDefault);
      restoreEnv("HIVEWARD_CLAUDE_CODE_DEFAULT_MODEL", previousClaudeDefault);
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it("streams OpenClaw chat responses through the runtime adapter", async () => {
    const fixture = await createStoreFixture();
    const adapter = new TrackingAdapter();
    try {
      await withApiServer(fixture.store, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/chat/stream`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            harnessId: "openclaw",
            message: "Say hello from chat.",
            attachments: [],
            modelId: "openclaw/default",
            agentId: "main",
            thinkingEffort: "medium",
            includePlatformContext: true
          })
        });
        const text = await response.text();

        expect(response.status, text).toBe(200);
        expect(response.headers.get("content-type")).toContain("text/event-stream");
        expect(text).toContain("event: started");
        expect(text).toContain("event: delta");
        expect(text).toContain("event: done");
        expect(text).toContain("main completed through OpenClaw adapter");
        expect(adapter.lastStartInput).toBeUndefined();
        expect(adapter.lastChatStreamInput?.sessionKey).toBe("main");
        expect(adapter.lastChatStreamInput?.message).toContain("System context:");
        expect(adapter.lastChatStreamInput?.message).toContain("HiveWard is a local company operations console");
        expect(adapter.lastChatStreamInput?.message).toContain("User message:\nSay hello from chat.");
        expect(adapter.lastChatStreamInput?.message).not.toContain("Project context: HiveWard");
        expect(adapter.lastChatStreamInput?.message).not.toContain("Hiveward blueprint run");
        expect(adapter.lastChatStreamInput?.modelId).toBe("openclaw/default");
        expect(adapter.lastChatStreamInput?.thinking).toBe("medium");
      }, adapter);
    } finally {
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it("proxies OpenClaw native chat history by session key", async () => {
    const fixture = await createStoreFixture();
    try {
      await withApiServer(fixture.store, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/chat/history?sessionKey=${encodeURIComponent("session-demo-1")}`);
        const body = await readOkJson<{ messages: Array<{ role: string; content: string }> }>(response);

        expect(body.messages.length).toBeGreaterThan(0);
        expect(body.messages[0]).toMatchObject({
          role: "user",
          content: "Mock OpenClaw session history."
        });
      });
    } finally {
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it("creates native OpenClaw chat sessions through the runtime adapter", async () => {
    const fixture = await createStoreFixture();
    const adapter = new TrackingAdapter();
    try {
      await withApiServer(fixture.store, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/chat/session`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            agentId: "main",
            parentSessionKey: "main"
          })
        });
        const body = await readOkJson<{ sessionKey: string }>(response);

        expect(response.status).toBe(201);
        expect(body.sessionKey).toMatch(/^agent:main:chat-/);
        expect(adapter.lastChatSessionInput).toEqual({
          agentId: "main",
          parentSessionKey: "main"
        });
      }, adapter);
    } finally {
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });
});

async function createStoreFixture(): Promise<{ dir: string; store: FileHivewardStore }> {
  const dir = mkdtempSync(join(tmpdir(), "hiveward-api-"));
  const store = new FileHivewardStore(join(dir, "hiveward-store.json"));
  await store.init();
  return { dir, store };
}

async function withApiServer(
  store: FileHivewardStore,
  work: (baseUrl: string) => Promise<void>,
  adapter = new TrackingAdapter(),
  openClawConfigStore = createConfigStoreFixture(),
  worker = {} as BlueprintWorker
): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use(createApiRouter({
    store,
    openClawConfigStore,
    adapter,
    worker
  }));

  const server = app.listen(0);
  try {
    const address = server.address() as AddressInfo;
    await work(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
}

async function readOkJson<T = unknown>(response: Response): Promise<T> {
  const text = await response.text();
  expect([200, 201], text).toContain(response.status);
  return JSON.parse(text) as T;
}

function createConfigStoreFixture(): OpenClawConfigStore {
  const state: OpenClawConfigState = {
    configPath: "test-openclaw.json",
    defaultWorkspace: "D:\\hiveward-test",
    defaultModelId: "openclaw/default",
    configuredModels: [{ id: "openclaw/default", label: "OpenClaw Default", provider: "openclaw" }],
    configuredAgents: [
      {
        id: "main",
        name: "main",
        workspace: "D:\\hiveward-test",
        agentDir: "D:\\hiveward-test\\.openclaw\\agents\\main",
        modelId: "openclaw/default",
        isDefault: true
      }
    ],
    configuredChannels: []
  };
  const version: OpenClawVersionInfo = {
    version: "0.0.0-test",
    resolvedAt: "2026-05-21T00:00:00.000Z"
  };
  return {
    async getState() {
      return state;
    },
    async getVersion() {
      return version;
    }
  } as OpenClawConfigStore;
}

function readAgentConfig(blueprint: BlueprintDefinition, nodeId: string): AgentNodeConfig {
  return blueprint.nodes.find((node) => node.id === nodeId)!.config as AgentNodeConfig;
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
