import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import express from "express";
import { describe, expect, it } from "vitest";
import {
  MockRuntimeAdapter,
  type RuntimeChatSessionInput,
  type RuntimeChatSessionTitleInput,
  type RuntimeChatStreamInput
} from "@hiveward/adapter";
import type {
  AgentNodeConfig,
  BlueprintDefinition,
  ChatHistoryMessage,
  ChatStreamEvent,
  HivewardChatMessage,
  HivewardChatSession,
  OpenClawConfigState,
  OpenClawVersionInfo,
  RuntimeOverview,
  StartAgentTaskInput
} from "@hiveward/shared";
import { hivewardInboxSubmissionSchema } from "@hiveward/shared";
import { createApiRouter } from "./apiRouter";
import { FileHivewardStore } from "../store/fileHivewardStore";
import type { OpenClawConfigStore } from "../store/openClawConfigStore";
import type { BlueprintWorker } from "../worker/blueprintWorker";

class TrackingAdapter extends MockRuntimeAdapter {
  runtimeOverviewCalls = 0;
  lastStartInput: StartAgentTaskInput | undefined;
  lastChatSessionInput: RuntimeChatSessionInput | undefined;
  lastChatSessionTitleInput: RuntimeChatSessionTitleInput | undefined;
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

  override async updateChatSessionTitle(input: RuntimeChatSessionTitleInput) {
    this.lastChatSessionTitleInput = input;
    return super.updateChatSessionTitle(input);
  }

  override async getRuntimeOverview(): Promise<RuntimeOverview> {
    this.runtimeOverviewCalls += 1;
    throw new Error("runtime overview is not on the run read path");
  }
}

class ChatOutputAdapter extends TrackingAdapter {
  constructor(private readonly output: string) {
    super();
  }

  override async streamChatMessage(input: RuntimeChatStreamInput, onEvent: (event: ChatStreamEvent) => void) {
    this.lastChatStreamInput = input;
    const now = new Date().toISOString();
    const runId = input.idempotencyKey;
    onEvent({
      type: "started",
      taskId: runId,
      runId,
      sessionKey: input.sessionKey,
      source: "openclaw",
      status: "running",
      updatedAt: now
    });
    onEvent({
      type: "delta",
      text: this.output
    });
    onEvent({
      type: "done",
      taskId: runId,
      runId,
      sessionKey: input.sessionKey,
      source: "openclaw",
      status: "succeeded",
      output: this.output,
      updatedAt: now
    });
  }
}

class ChatHistoryAdapter extends TrackingAdapter {
  constructor(private readonly messages: ChatHistoryMessage[]) {
    super();
  }

  override async getSessionMessages(): Promise<ChatHistoryMessage[]> {
    return this.messages;
  }
}

class NativeSessionTrackingAdapter extends TrackingAdapter {
  readonly chatInputs: RuntimeChatStreamInput[] = [];

  constructor(
    private readonly nativeSessionId: string,
    private readonly output = "native session response"
  ) {
    super();
  }

  override async streamChatMessage(input: RuntimeChatStreamInput, onEvent: (event: ChatStreamEvent) => void) {
    this.chatInputs.push(input);
    this.lastChatStreamInput = input;
    const now = new Date().toISOString();
    const sessionKey = input.sessionKey || this.nativeSessionId;
    onEvent({
      type: "started",
      taskId: input.idempotencyKey,
      runId: input.idempotencyKey,
      sessionKey,
      source: input.source ?? "codex",
      status: "running",
      updatedAt: now
    });
    onEvent({ type: "delta", text: this.output });
    onEvent({
      type: "done",
      taskId: input.idempotencyKey,
      runId: input.idempotencyKey,
      sessionKey,
      source: input.source ?? "codex",
      status: "succeeded",
      output: this.output,
      updatedAt: now
    });
  }
}

class NativeMissingAdapter extends TrackingAdapter {
  readonly chatInputs: RuntimeChatStreamInput[] = [];

  override async streamChatMessage(input: RuntimeChatStreamInput, onEvent: (event: ChatStreamEvent) => void) {
    this.chatInputs.push(input);
    this.lastChatStreamInput = input;
    const now = new Date().toISOString();
    if (input.sessionKey === "missing-native-session") {
      onEvent({
        type: "done",
        taskId: input.idempotencyKey,
        runId: input.idempotencyKey,
        sessionKey: input.sessionKey,
        source: input.source ?? "codex",
        status: "failed",
        error: "Cannot resume thread: session not found",
        updatedAt: now
      });
      return;
    }
    const sessionKey = input.sessionKey || "rebuilt-native-session";
    onEvent({ type: "delta", text: "rebuilt response" });
    onEvent({
      type: "done",
      taskId: input.idempotencyKey,
      runId: input.idempotencyKey,
      sessionKey,
      source: input.source ?? "codex",
      status: "succeeded",
      output: "rebuilt response",
      updatedAt: now
    });
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

  it("reports Codex models from the local Codex config and model cache", async () => {
    const fixture = await createStoreFixture();
    const codexHome = join(fixture.dir, "codex-home");
    const previousCodexHome = process.env.CODEX_HOME;
    const previousHivewardCodexDefault = process.env.HIVEWARD_CODEX_DEFAULT_MODEL;
    const previousCodexDefault = process.env.CODEX_DEFAULT_MODEL;
    process.env.CODEX_HOME = codexHome;
    delete process.env.HIVEWARD_CODEX_DEFAULT_MODEL;
    delete process.env.CODEX_DEFAULT_MODEL;

    mkdirSync(codexHome, { recursive: true });
    writeFileSync(join(codexHome, "config.toml"), 'model = "gpt-5.5"\n[profiles.fast]\nmodel = "gpt-5.3-codex-spark"\n');
    writeFileSync(join(codexHome, "auth.json"), "{}");
    writeFileSync(join(codexHome, "models_cache.json"), JSON.stringify({
      models: [
        {
          slug: "gpt-5.4",
          display_name: "GPT-5.4",
          visibility: "list",
          supported_in_api: true,
          priority: 4,
          supported_reasoning_levels: [{ effort: "low" }, { effort: "minimal" }, { effort: "high" }]
        },
        {
          slug: "gpt-5.5",
          display_name: "GPT-5.5",
          visibility: "list",
          supported_in_api: true,
          priority: 9,
          supported_reasoning_levels: [{ effort: "low" }, { effort: "medium" }, { effort: "xhigh" }]
        },
        {
          slug: "internal-hidden-model",
          display_name: "Hidden",
          visibility: "hidden",
          supported_in_api: true,
          priority: 99
        }
      ]
    }));

    try {
      await withApiServer(fixture.store, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/harness-status`);
        const body = await readOkJson<{
          statuses: Array<{ id: string; defaultModelId?: string; models?: Array<{ id: string; label: string; isDefault?: boolean; thinkingLevels?: string[] }> }>;
        }>(response);
        const codexStatus = body.statuses.find((status) => status.id === "codex");
        const codexModelIds = codexStatus?.models?.map((model) => model.id) ?? [];

        expect(codexStatus?.defaultModelId).toBe("gpt-5.5");
        expect(codexStatus?.models?.[0]).toMatchObject({
          id: "gpt-5.5",
          label: "GPT-5.5",
          isDefault: true
        });
        expect(codexModelIds).toEqual(expect.arrayContaining(["gpt-5.5", "gpt-5.4"]));
        expect(codexModelIds).not.toContain("internal-hidden-model");
        expect(codexStatus?.models?.find((model) => model.id === "gpt-5.4")?.thinkingLevels).toEqual(["low", "high"]);
      });
    } finally {
      restoreEnv("CODEX_HOME", previousCodexHome);
      restoreEnv("HIVEWARD_CODEX_DEFAULT_MODEL", previousHivewardCodexDefault);
      restoreEnv("CODEX_DEFAULT_MODEL", previousCodexDefault);
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it("reports Claude Code model options from local Claude settings", async () => {
    const fixture = await createStoreFixture();
    const claudeHome = join(fixture.dir, "claude-home");
    const previousClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR;
    const previousHivewardClaudeDefault = process.env.HIVEWARD_CLAUDE_CODE_DEFAULT_MODEL;
    const previousClaudeDefault = process.env.CLAUDE_CODE_DEFAULT_MODEL;
    const previousHivewardClaudeModels = process.env.HIVEWARD_CLAUDE_CODE_MODELS;
    const previousClaudeModels = process.env.CLAUDE_CODE_MODELS;
    process.env.CLAUDE_CONFIG_DIR = claudeHome;
    delete process.env.HIVEWARD_CLAUDE_CODE_DEFAULT_MODEL;
    delete process.env.CLAUDE_CODE_DEFAULT_MODEL;
    delete process.env.HIVEWARD_CLAUDE_CODE_MODELS;
    delete process.env.CLAUDE_CODE_MODELS;

    mkdirSync(claudeHome, { recursive: true });
    writeFileSync(join(claudeHome, "settings.json"), JSON.stringify({
      env: {
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "claude-haiku-local",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "claude-sonnet-local",
        UNRELATED_TOKEN: "not-a-model"
      }
    }));
    writeFileSync(join(claudeHome, ".credentials.json"), "{}");

    try {
      await withApiServer(fixture.store, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/harness-status`);
        const body = await readOkJson<{
          statuses: Array<{ id: string; defaultModelId?: string; models?: Array<{ id: string; isDefault?: boolean }> }>;
        }>(response);
        const claudeStatus = body.statuses.find((status) => status.id === "claudeCode");
        const claudeModelIds = claudeStatus?.models?.map((model) => model.id) ?? [];

        expect(claudeStatus?.defaultModelId).toBe("inherit");
        expect(claudeStatus?.models?.[0]).toMatchObject({ id: "inherit", isDefault: true });
        expect(claudeModelIds).toEqual(expect.arrayContaining(["inherit", "claude-haiku-local", "claude-sonnet-local"]));
        expect(claudeModelIds).not.toContain("not-a-model");
      });
    } finally {
      restoreEnv("CLAUDE_CONFIG_DIR", previousClaudeConfigDir);
      restoreEnv("HIVEWARD_CLAUDE_CODE_DEFAULT_MODEL", previousHivewardClaudeDefault);
      restoreEnv("CLAUDE_CODE_DEFAULT_MODEL", previousClaudeDefault);
      restoreEnv("HIVEWARD_CLAUDE_CODE_MODELS", previousHivewardClaudeModels);
      restoreEnv("CLAUDE_CODE_MODELS", previousClaudeModels);
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it("reports and installs HiveWard skills into the OpenClaw home skill root", async () => {
    const fixture = await createStoreFixture();
    const openClawWorkspace = join(fixture.dir, "openclaw-workspace");
    const openClawHome = join(fixture.dir, "openclaw-home");
    const openClawConfigStore = createConfigStoreFixture(openClawWorkspace);
    const previousOpenClawHome = process.env.OPENCLAW_HOME;
    const previousOpenClawStateDir = process.env.OPENCLAW_STATE_DIR;
    process.env.OPENCLAW_HOME = openClawHome;
    delete process.env.OPENCLAW_STATE_DIR;
    try {
      await withApiServer(
        fixture.store,
        async (baseUrl) => {
          const initialResponse = await fetch(`${baseUrl}/api/harness-skills/openclaw`);
          const initialBody = await readOkJson<{
            supported: boolean;
            installRoot?: string;
            installCandidates?: Array<{ root: string; source: string; selected: boolean; hasHiveWardSkills: boolean }>;
            skills: Array<{ id: string; status: string; installed: boolean; targetPath?: string }>;
          }>(initialResponse);

          expect(initialBody.supported).toBe(true);
          expect(initialBody.installRoot).toBe(join(openClawHome, "skills"));
          expect(initialBody.installCandidates?.find((candidate) => candidate.selected)).toMatchObject({
            root: join(openClawHome, "skills"),
            source: "environment",
            hasHiveWardSkills: false
          });
          expect(initialBody.skills.map((skill) => skill.status)).toEqual(["missing", "missing"]);

          const installResponse = await fetch(`${baseUrl}/api/harness-skills/openclaw/install`, {
            method: "POST"
          });
          const installBody = await readOkJson<{
            installedCount: number;
            installCandidates?: Array<{ root: string; source: string; selected: boolean; hasHiveWardSkills: boolean }>;
            skills: Array<{ id: string; status: string; installed: boolean }>;
          }>(installResponse);

          expect(installBody.installedCount).toBe(2);
          expect(installBody.skills.map((skill) => [skill.id, skill.status, skill.installed])).toEqual([
            ["hiveward-ceo", "installed", true],
            ["hiveward-leader", "installed", true]
          ]);
          expect(installBody.installCandidates?.find((candidate) => candidate.selected)).toMatchObject({
            root: join(openClawHome, "skills"),
            source: "environment",
            hasHiveWardSkills: true
          });
          expect(existsSync(join(openClawHome, "skills", "hiveward-ceo", "SKILL.md"))).toBe(true);
          expect(existsSync(join(openClawHome, "skills", "hiveward-leader", "SKILL.md"))).toBe(true);
        },
        new TrackingAdapter(),
        openClawConfigStore
      );
    } finally {
      restoreEnv("OPENCLAW_HOME", previousOpenClawHome);
      restoreEnv("OPENCLAW_STATE_DIR", previousOpenClawStateDir);
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it("reports and installs HiveWard skills into Codex and Claude Code skill roots", async () => {
    const fixture = await createStoreFixture();
    const codexHome = join(fixture.dir, "codex-home");
    const claudeHome = join(fixture.dir, "claude-home");
    const previousCodexHome = process.env.CODEX_HOME;
    const previousClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR;
    process.env.CODEX_HOME = codexHome;
    process.env.CLAUDE_CONFIG_DIR = claudeHome;
    try {
      await withApiServer(fixture.store, async (baseUrl) => {
        for (const [harnessId, root] of [
          ["codex", codexHome],
          ["claudeCode", claudeHome]
        ] as const) {
          const initialResponse = await fetch(`${baseUrl}/api/harness-skills/${harnessId}`);
          const initialBody = await readOkJson<{
            supported: boolean;
            installRoot?: string;
            installCandidates?: Array<{ root: string; source: string; selected: boolean; hasHiveWardSkills: boolean }>;
            skills: Array<{ status: string; installed: boolean }>;
          }>(initialResponse);

          expect(initialBody.supported).toBe(true);
          expect(initialBody.installRoot).toBe(join(root, "skills"));
          expect(initialBody.installCandidates?.find((candidate) => candidate.selected)).toMatchObject({
            root: join(root, "skills"),
            source: "environment",
            hasHiveWardSkills: false
          });
          expect(initialBody.installCandidates?.some((candidate) => candidate.source === "project")).toBe(true);
          expect(initialBody.skills.map((skill) => [skill.status, skill.installed])).toEqual([
            ["missing", false],
            ["missing", false]
          ]);

          const installResponse = await fetch(`${baseUrl}/api/harness-skills/${harnessId}/install`, {
            method: "POST"
          });
          const installBody = await readOkJson<{
            installedCount: number;
            installCandidates?: Array<{ root: string; source: string; selected: boolean; hasHiveWardSkills: boolean }>;
            skills: Array<{ id: string; status: string; installed: boolean }>;
          }>(installResponse);

          expect(installBody.installedCount).toBe(2);
          expect(installBody.skills.map((skill) => [skill.id, skill.status, skill.installed])).toEqual([
            ["hiveward-ceo", "installed", true],
            ["hiveward-leader", "installed", true]
          ]);
          expect(installBody.installCandidates?.find((candidate) => candidate.selected)).toMatchObject({
            root: join(root, "skills"),
            source: "environment",
            hasHiveWardSkills: true
          });
          expect(existsSync(join(root, "skills", "hiveward-ceo", "SKILL.md"))).toBe(true);
          expect(existsSync(join(root, "skills", "hiveward-leader", "SKILL.md"))).toBe(true);
        }
      });
    } finally {
      restoreEnv("CODEX_HOME", previousCodexHome);
      restoreEnv("CLAUDE_CONFIG_DIR", previousClaudeConfigDir);
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it("streams OpenClaw chat responses through the runtime adapter", async () => {
    const fixture = await createStoreFixture();
    const adapter = new TrackingAdapter();
    try {
      await withApiServer(fixture.store, async (baseUrl) => {
        const response = await streamSessionChat(baseUrl, {
          harnessId: "openclaw",
          nativeSessionId: "main",
          message: "Say hello from chat.",
          attachments: [],
          modelId: "openclaw/default",
          agentId: "main",
          thinkingEffort: "medium",
          includePlatformContext: true,
          roleScope: {
            role: "ceo"
          }
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
        expect(adapter.lastChatStreamInput?.message).toContain("HiveWard appointment:");
        expect(adapter.lastChatStreamInput?.message).toContain("Installed external skill:");
        expect(adapter.lastChatStreamInput?.message).toContain("hiveward-ceo");
        expect(adapter.lastChatStreamInput?.message).not.toContain("SKILL.md");
        expect(adapter.lastChatStreamInput?.message).toContain("answer directly without reading files");
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

  it("does not expose the old generic chat stream route", async () => {
    const fixture = await createStoreFixture();
    try {
      await withApiServer(fixture.store, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/chat/stream`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({})
        });

        expect(response.status).toBe(404);
      });
    } finally {
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it("streams Codex and Claude Code chat responses through the selected harness source", async () => {
    const fixture = await createStoreFixture();
    const adapter = new TrackingAdapter();
    const previousCodexDefault = process.env.HIVEWARD_CODEX_DEFAULT_MODEL;
    const previousClaudeDefault = process.env.HIVEWARD_CLAUDE_CODE_DEFAULT_MODEL;
    process.env.HIVEWARD_CODEX_DEFAULT_MODEL = "codex/chat-default";
    process.env.HIVEWARD_CLAUDE_CODE_DEFAULT_MODEL = "inherit";
    try {
      await withApiServer(fixture.store, async (baseUrl) => {
        const codexResponse = await streamSessionChat(baseUrl, {
          harnessId: "codex",
          message: "Say hello from Codex.",
          attachments: [],
          thinkingEffort: "high",
          includePlatformContext: false,
          roleScope: {
            role: "ceo"
          }
        });
        const codexText = await codexResponse.text();

        expect(codexResponse.status, codexText).toBe(200);
        expect(codexText).toContain("main completed through Codex adapter");
        expect(adapter.lastChatStreamInput?.source).toBe("codex");
        expect(adapter.lastChatStreamInput?.sessionKey).toBe("");
        expect(adapter.lastChatStreamInput?.modelId).toBe("codex/chat-default");
        expect(adapter.lastChatStreamInput?.skillIds).toEqual(["hiveward-ceo"]);
        expect(adapter.lastChatStreamInput?.message).toContain("HiveWard appointment:");
        expect(adapter.lastChatStreamInput?.message).toContain("hiveward-ceo");

        const claudeResponse = await streamSessionChat(baseUrl, {
          harnessId: "claudeCode",
          message: "Say hello from Claude Code.",
          attachments: [],
          modelId: "inherit",
          thinkingEffort: "medium",
          roleScope: {
            role: "leader",
            leaderId: "leader-test",
            blueprintId: "blueprint-test"
          }
        });
        const claudeText = await claudeResponse.text();

        expect(claudeResponse.status, claudeText).toBe(200);
        expect(claudeText).toContain("main completed through Claude Code adapter");
        expect(adapter.lastChatStreamInput?.source).toBe("claude");
        expect(adapter.lastChatStreamInput?.sessionKey).toBe("");
        expect(adapter.lastChatStreamInput?.modelId).toBeUndefined();
        expect(adapter.lastChatStreamInput?.skillIds).toEqual(["hiveward-leader"]);
        expect(adapter.lastChatStreamInput?.message).toContain("hiveward-leader");
      }, adapter);
    } finally {
      restoreEnv("HIVEWARD_CODEX_DEFAULT_MODEL", previousCodexDefault);
      restoreEnv("HIVEWARD_CLAUDE_CODE_DEFAULT_MODEL", previousClaudeDefault);
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it("includes the inbox submission contract for Chinese blueprint approval requests", async () => {
    const fixture = await createStoreFixture();
    const adapter = new TrackingAdapter();
    const blueprint = (await fixture.store.listBlueprints())[0]!;
    try {
      await withApiServer(fixture.store, async (baseUrl) => {
        const response = await streamSessionChat(baseUrl, {
          harnessId: "codex",
          message: "\u8bf7\u628a\u8fd9\u4e2a\u84dd\u56fe\u63d0\u6848\u63d0\u4ea4\u5230\u5ba1\u6279",
          attachments: [],
          modelId: "codex/test-default",
          thinkingEffort: "medium",
          mode: "blueprint",
          roleScope: {
            role: "leader",
            leaderId: "leader-test",
            blueprintId: blueprint.id
          }
        });
        const text = await response.text();

        expect(response.status, text).toBe(200);
        expect(adapter.lastChatStreamInput?.source).toBe("codex");
        expect(adapter.lastChatStreamInput?.message).toContain("HIVEWARD_INBOX_SUBMISSION_CONTRACT v1");
        expect(adapter.lastChatStreamInput?.message).toContain(hivewardInboxSubmissionSchema);
      }, adapter);
    } finally {
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it("turns formal chat inbox submission blocks into pending inbox items", async () => {
    const fixture = await createStoreFixture();
    const blueprint = (await fixture.store.listBlueprints())[0]!;
    const output = [
      "I prepared the concrete package and submitted it for inbox approval.",
      "```hiveward-inbox",
      JSON.stringify({
        schema: hivewardInboxSubmissionSchema,
        type: "blueprint_proposal",
        blueprintId: blueprint.id,
        title: "Review generated blueprint package",
        summary: "Approve the generated package before Hiveward imports it.",
        diffSummary: "Creates a pending package review from chat.",
        blueprintPackage: {
          schema: "hiveward.blueprint-package/v1",
          exportedAt: "2026-05-23T00:00:00.000Z",
          blueprints: [
            {
              id: "review-generated-blueprint-package",
              name: "Review generated blueprint package",
              description: "A test blueprint package submitted from chat.",
              version: 1,
              nodes: [
                {
                  id: "brief",
                  type: "agent",
                  runtimeId: "openclaw",
                  position: { x: 0, y: 0 },
                  config: {
                    label: "Brief",
                    agentName: "brief-agent",
                    prompt: "Write a brief.",
                    tools: []
                  }
                }
              ],
              edges: [],
              variables: {},
              display: { viewport: { x: 0, y: 0, zoom: 1 } }
            }
          ]
        }
      }),
      "```"
    ].join("\n");
    const adapter = new ChatOutputAdapter(output);
    try {
      await withApiServer(fixture.store, async (baseUrl) => {
        const response = await streamSessionChat(baseUrl, {
          harnessId: "openclaw",
          nativeSessionId: "main",
          message: "Submit this blueprint package for approval.",
          attachments: [],
          modelId: "openclaw/default",
          agentId: "main",
          thinkingEffort: "medium",
          mode: "blueprint",
          roleScope: {
            role: "leader",
            leaderId: "leader-test",
            blueprintId: blueprint.id
          }
        });
        const text = await response.text();

        expect(response.status, text).toBe(200);
        expect(text).toContain("event: inbox_item_created");
        expect(text).toContain("\"replace\":true");
        expect(text).toContain("Review generated blueprint package");
        expect(text).toContain("已提交到收件箱，请前往收件箱审批。");
        expect(adapter.lastChatStreamInput?.message).toContain("HiveWard appointment:");
        expect(adapter.lastChatStreamInput?.message).toContain("Installed external skill:");
        expect(adapter.lastChatStreamInput?.message).toContain("hiveward-leader");
        expect(adapter.lastChatStreamInput?.message).not.toContain("SKILL.md");
        expect(adapter.lastChatStreamInput?.message).toContain("Leader owns exactly one bound business blueprint");
        expect(adapter.lastChatStreamInput?.message).not.toContain("The Leader is the permanent role seat bound to exactly one business blueprint.");
        expect(adapter.lastChatStreamInput?.message).not.toContain("Hiveward role scope:");
        expect(adapter.lastChatStreamInput?.message).toContain("HIVEWARD_INBOX_SUBMISSION_CONTRACT v1");
        expect(adapter.lastChatStreamInput?.message).toContain(hivewardInboxSubmissionSchema);

        const inboxResponse = await fetch(`${baseUrl}/api/inbox`);
        const inboxBody = await readOkJson<{ items: Array<{ id: string; title: string; status: string; type: string; blueprintId?: string }> }>(inboxResponse);
        expect(inboxBody.items[0]).toMatchObject({
          title: "Review generated blueprint package",
          status: "pending",
          type: "blueprint_proposal",
          blueprintId: blueprint.id
        });

        const approveResponse = await fetch(`${baseUrl}/api/inbox/${inboxBody.items[0]!.id}/approve`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({})
        });
        const approveBody = await readOkJson<{ importedBlueprints?: Array<{ name: string }> }>(approveResponse);
        expect(approveBody.importedBlueprints?.[0]).toMatchObject({
          name: "Review generated blueprint package"
        });

        const blueprintsResponse = await fetch(`${baseUrl}/api/blueprints`);
        const blueprintsBody = await readOkJson<{ blueprints: Array<{ name: string }> }>(blueprintsResponse);
        expect(blueprintsBody.blueprints.some((item) => item.name === "Review generated blueprint package")).toBe(true);
      }, adapter);
    } finally {
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it("reports invalid chat inbox submission blocks without creating inbox items", async () => {
    const fixture = await createStoreFixture();
    const blueprint = (await fixture.store.listBlueprints())[0]!;
    const output = [
      "Okay, submitting this package for approval.",
      "HIVEWARD-INBOX",
      "```json",
      JSON.stringify({
        schema: hivewardInboxSubmissionSchema,
        type: "blueprint_proposal",
        blueprintId: blueprint.id,
        title: "Incomplete package",
        summary: "This should not become an inbox item."
      }),
      "```"
    ].join("\n");
    const adapter = new ChatOutputAdapter(output);
    try {
      await withApiServer(fixture.store, async (baseUrl) => {
        const response = await streamSessionChat(baseUrl, {
          harnessId: "openclaw",
          nativeSessionId: "main",
          message: "Submit this incomplete package for approval.",
          attachments: [],
          modelId: "openclaw/default",
          agentId: "main",
          thinkingEffort: "medium",
          mode: "blueprint",
          roleScope: {
            role: "leader",
            leaderId: "leader-test",
            blueprintId: blueprint.id
          }
        });
        const text = await response.text();

        expect(response.status, text).toBe(200);
        expect(text).toContain("\"replace\":true");
        expect(text).toContain("\"status\":\"failed\"");
        expect(text).toContain("Blueprint proposal request requires blueprintPackage.");
        expect(text).not.toContain("event: inbox_item_created");

        const inboxResponse = await fetch(`${baseUrl}/api/inbox`);
        const inboxBody = await readOkJson<{ items: Array<{ id: string }> }>(inboxResponse);
        expect(inboxBody.items).toEqual([]);
      }, adapter);
    } finally {
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it("rejects unsupported Hiveward inbox submission schema versions", async () => {
    const fixture = await createStoreFixture();
    const blueprint = (await fixture.store.listBlueprints())[0]!;
    const output = [
      "Okay, submitting this package for approval.",
      "```hiveward-inbox",
      JSON.stringify({
        schema: "hiveward.inbox-submission/v0",
        type: "blueprint_proposal",
        blueprintId: blueprint.id,
        title: "Old schema package",
        summary: "This should not become an inbox item.",
        blueprintPackage: {
          schema: "hiveward.blueprint-package/v1",
          exportedAt: "2026-05-23T00:00:00.000Z",
          blueprints: [
            {
              id: "old-schema-blueprint",
              name: "Old schema package",
              version: 1,
              nodes: [],
              edges: [],
              variables: {},
              display: { viewport: { x: 0, y: 0, zoom: 1 } }
            }
          ]
        }
      }),
      "```"
    ].join("\n");
    const adapter = new ChatOutputAdapter(output);
    try {
      await withApiServer(fixture.store, async (baseUrl) => {
        const response = await streamSessionChat(baseUrl, {
          harnessId: "openclaw",
          nativeSessionId: "main",
          message: "Submit this old schema package for approval.",
          attachments: [],
          modelId: "openclaw/default",
          agentId: "main",
          thinkingEffort: "medium",
          mode: "blueprint",
          roleScope: {
            role: "leader",
            leaderId: "leader-test",
            blueprintId: blueprint.id
          }
        });
        const text = await response.text();

        expect(response.status, text).toBe(200);
        expect(text).toContain("\"status\":\"failed\"");
        expect(text).toContain(`Expected ${hivewardInboxSubmissionSchema}.`);
        expect(text).not.toContain("event: inbox_item_created");
      }, adapter);
    } finally {
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it("rejects chat blueprint proposals that use unsupported Hiveward node types", async () => {
    const fixture = await createStoreFixture();
    const blueprint = (await fixture.store.listBlueprints())[0]!;
    const output = [
      "Okay, submitting this package for approval.",
      "```hiveward-inbox",
      JSON.stringify({
        schema: hivewardInboxSubmissionSchema,
        type: "blueprint_proposal",
        blueprintId: blueprint.id,
        title: "Unsupported node proposal",
        summary: "This should fail before it becomes an inbox item.",
        blueprintPackage: {
          schema: "hiveward.blueprint-package/v1",
          exportedAt: "2026-05-23T00:00:00.000Z",
          blueprints: [
            {
              id: "unsupported-node-blueprint",
              name: "Unsupported node proposal",
              version: 1,
              nodes: [
                {
                  id: "fetch",
                  type: "http.get",
                  position: { x: 0, y: 0 },
                  config: { label: "Fetch" }
                }
              ],
              edges: [],
              variables: {},
              display: { viewport: { x: 0, y: 0, zoom: 1 } }
            }
          ]
        }
      }),
      "```"
    ].join("\n");
    const adapter = new ChatOutputAdapter(output);
    try {
      await withApiServer(fixture.store, async (baseUrl) => {
        const response = await streamSessionChat(baseUrl, {
          harnessId: "openclaw",
          nativeSessionId: "main",
          message: "Submit this unsupported package for approval.",
          attachments: [],
          modelId: "openclaw/default",
          agentId: "main",
          thinkingEffort: "medium",
          mode: "blueprint",
          roleScope: {
            role: "leader",
            leaderId: "leader-test",
            blueprintId: blueprint.id
          }
        });
        const text = await response.text();

        expect(response.status, text).toBe(200);
        expect(text).toContain("\"status\":\"failed\"");
        expect(text).toContain("Unsupported blueprint node type: http.get.");
        expect(text).not.toContain("event: inbox_item_created");

        const inboxResponse = await fetch(`${baseUrl}/api/inbox`);
        const inboxBody = await readOkJson<{ items: Array<{ id: string }> }>(inboxResponse);
        expect(inboxBody.items).toEqual([]);
      }, adapter);
    } finally {
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it("repairs common model JSON and edge-shape mistakes in chat blueprint proposals", async () => {
    const fixture = await createStoreFixture();
    const blueprint = (await fixture.store.listBlueprints())[0]!;
    const validSubmission = {
      schema: hivewardInboxSubmissionSchema,
      type: "blueprint_proposal",
      blueprintId: blueprint.id,
      title: "Repaired X blueprint proposal",
      summary: "This proposal has a common extra closing brace and from/to edges.",
      blueprintPackage: {
        schema: "hiveward.blueprint-package/v1",
        exportedAt: "2026-05-23T00:00:00.000Z",
        blueprints: [
          {
            id: "repaired-x-blueprint",
            name: "Repaired X blueprint proposal",
            version: 1,
            nodes: [
              {
                id: "fetch",
                type: "agent",
                runtimeId: "openclaw",
                position: { x: 0, y: 0 },
                config: {
                  label: "Fetch",
                  agentName: "fetch-agent",
                  prompt: "Fetch X trending data.",
                  tools: []
                }
              },
              {
                id: "render",
                type: "agent",
                runtimeId: "openclaw",
                position: { x: 320, y: 0 },
                config: {
                  label: "Render",
                  agentName: "render-agent",
                  prompt: "Render an HTML report from upstream data.",
                  tools: []
                }
              }
            ],
            edges: [{ from: "fetch", to: "render" }],
            variables: {},
            display: { viewport: { x: 0, y: 0, zoom: 1 } }
          }
        ]
      }
    };
    const malformedSubmission = JSON.stringify(validSubmission).replace(/}]}}$/, "}}]}}");
    const adapter = new ChatOutputAdapter([
      "Okay, submitting this package for approval.",
      "```hiveward-inbox",
      malformedSubmission,
      "```"
    ].join("\n"));

    try {
      await withApiServer(fixture.store, async (baseUrl) => {
        const response = await streamSessionChat(baseUrl, {
          harnessId: "openclaw",
          nativeSessionId: "main",
          message: "Submit this package for approval.",
          attachments: [],
          modelId: "openclaw/default",
          agentId: "main",
          thinkingEffort: "medium",
          mode: "blueprint",
          roleScope: {
            role: "leader",
            leaderId: "leader-test",
            blueprintId: blueprint.id
          }
        });
        const text = await response.text();

        expect(response.status, text).toBe(200);
        expect(text).toContain("event: inbox_item_created");
        expect(text).not.toContain("Inbox submission failed");

        const inboxResponse = await fetch(`${baseUrl}/api/inbox`);
        const inboxBody = await readOkJson<{ items: Array<{ id: string; title: string }> }>(inboxResponse);
        expect(inboxBody.items[0]).toMatchObject({ title: "Repaired X blueprint proposal" });

        const approveResponse = await fetch(`${baseUrl}/api/inbox/${inboxBody.items[0]!.id}/approve`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({})
        });
        const approveBody = await readOkJson<{ importedBlueprints?: Array<{ edges: Array<{ source: string; target: string }> }> }>(approveResponse);
        expect(approveBody.importedBlueprints?.[0]?.edges[0]).toMatchObject({
          source: "fetch",
          target: "render"
        });
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

  it("syncs Hiveward inbox submissions from native chat history without duplicates", async () => {
    const fixture = await createStoreFixture();
    const blueprint = (await fixture.store.listBlueprints())[0]!;
    const now = new Date().toISOString();
    const output = [
      "I prepared the package for approval.",
      "```hiveward-inbox",
      JSON.stringify({
        schema: hivewardInboxSubmissionSchema,
        type: "blueprint_proposal",
        blueprintId: blueprint.id,
        title: "History synced blueprint package",
        summary: "Created from a native OpenClaw history response.",
        diffSummary: "Adds a history-synced blueprint package.",
        blueprintPackage: {
          schema: "hiveward.blueprint-package/v1",
          exportedAt: "2026-05-23T00:00:00.000Z",
          blueprints: [
            {
              id: "history-synced-blueprint",
              name: "History synced blueprint package",
              description: "Valid proposal recovered from native history.",
              version: 1,
              nodes: [
                {
                  id: "brief",
                  type: "agent",
                  runtimeId: "openclaw",
                  position: { x: 0, y: 0 },
                  config: {
                    label: "Brief",
                    agentName: "brief-agent",
                    prompt: "Write a brief.",
                    tools: []
                  }
                }
              ],
              edges: [],
              variables: {},
              display: { viewport: { x: 0, y: 0, zoom: 1 } }
            }
          ]
        }
      }),
      "```"
    ].join("\n");
    const adapter = new ChatHistoryAdapter([
      {
        id: "history-sync-user",
        role: "user",
        content: "Submit this package for approval.",
        createdAt: now
      },
      {
        id: "history-sync-assistant",
        role: "assistant",
        content: output,
        createdAt: now
      }
    ]);

    try {
      await withApiServer(fixture.store, async (baseUrl) => {
        const firstResponse = await fetch(`${baseUrl}/api/chat/history?sessionKey=${encodeURIComponent("agent:main:dashboard:history-sync")}`);
        const firstBody = await readOkJson<{
          messages: Array<{ role: string; content: string }>;
          inboxItems?: Array<{ id: string; title: string; status: string; type: string }>;
        }>(firstResponse);

        expect(firstBody.messages[1]?.content).toContain("I prepared the package for approval.");
        expect(firstBody.messages[1]?.content).toContain("已提交到收件箱，请前往收件箱审批。");
        expect(firstBody.messages[1]?.content).not.toContain("hiveward-inbox");
        expect(firstBody.inboxItems?.[0]).toMatchObject({
          title: "History synced blueprint package",
          status: "pending",
          type: "blueprint_proposal"
        });

        const secondResponse = await fetch(`${baseUrl}/api/chat/history?sessionKey=${encodeURIComponent("agent:main:dashboard:history-sync")}`);
        const secondBody = await readOkJson<{ inboxItems?: Array<{ id: string }> }>(secondResponse);
        expect(secondBody.inboxItems?.[0]?.id).toBe(firstBody.inboxItems?.[0]?.id);

        const inboxResponse = await fetch(`${baseUrl}/api/inbox`);
        const inboxBody = await readOkJson<{ items: Array<{ title: string }> }>(inboxResponse);
        expect(inboxBody.items.filter((item) => item.title === "History synced blueprint package")).toHaveLength(1);
      }, adapter);
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

  it("updates native OpenClaw chat session titles through the runtime adapter", async () => {
    const fixture = await createStoreFixture();
    const adapter = new TrackingAdapter();
    try {
      await withApiServer(fixture.store, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/chat/session`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sessionKey: "agent:main:main",
            title: "Renamed chat"
          })
        });
        const body = await readOkJson<{ sessionKey: string; title: string }>(response);

        expect(body).toEqual({
          sessionKey: "agent:main:main",
          title: "Renamed chat"
        });
        expect(adapter.lastChatSessionTitleInput).toEqual({
          sessionKey: "agent:main:main",
          title: "Renamed chat"
        });
      }, adapter);
    } finally {
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it("persists Codex chat sessions and resumes the native session id on the next turn", async () => {
    const fixture = await createStoreFixture();
    const adapter = new NativeSessionTrackingAdapter("codex-native-session-1", "codex persisted response");
    try {
      await withApiServer(fixture.store, async (baseUrl) => {
        const createResponse = await fetch(`${baseUrl}/api/chat/sessions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            harnessId: "codex",
            title: "Codex persistence",
            modelId: "codex/test-default",
            thinkingEffort: "high"
          })
        });
        const created = await readOkJson<{ session: HivewardChatSession }>(createResponse);

        const firstResponse = await fetch(`${baseUrl}/api/chat/sessions/${created.session.id}/messages/stream`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ message: "First Codex turn." })
        });
        expect(firstResponse.status).toBe(200);
        await firstResponse.text();

        const afterFirst = await readOkJson<{ session: HivewardChatSession }>(
          await fetch(`${baseUrl}/api/chat/sessions/${created.session.id}`)
        );
        expect(afterFirst.session.nativeSessionId).toBe("codex-native-session-1");
        expect(afterFirst.session.nativeSessionState).toBe("resumable");

        const secondResponse = await fetch(`${baseUrl}/api/chat/sessions/${created.session.id}/messages/stream`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ message: "Second Codex turn." })
        });
        expect(secondResponse.status).toBe(200);
        await secondResponse.text();

        expect(adapter.chatInputs).toHaveLength(2);
        expect(adapter.chatInputs[0]?.sessionKey).toBe("");
        expect(adapter.chatInputs[1]?.sessionKey).toBe("codex-native-session-1");

        const messages = await readOkJson<{ messages: HivewardChatMessage[] }>(
          await fetch(`${baseUrl}/api/chat/sessions/${created.session.id}/messages`)
        );
        expect(messages.messages.map((message) => message.role)).toEqual(["user", "assistant", "user", "assistant"]);
        expect(messages.messages[1]).toMatchObject({
          harnessId: "codex",
          content: "codex persisted response",
          status: "sent"
        });
      }, adapter);
    } finally {
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it("marks missing native sessions and requires explicit HiveWard history rebuild", async () => {
    const fixture = await createStoreFixture();
    const adapter = new NativeMissingAdapter();
    try {
      await withApiServer(fixture.store, async (baseUrl) => {
        const createResponse = await fetch(`${baseUrl}/api/chat/sessions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            harnessId: "codex",
            title: "Missing native",
            nativeSessionId: "missing-native-session",
            modelId: "codex/test-default"
          })
        });
        const created = await readOkJson<{ session: HivewardChatSession }>(createResponse);

        const failedResponse = await fetch(`${baseUrl}/api/chat/sessions/${created.session.id}/messages/stream`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ message: "Try to resume." })
        });
        expect(failedResponse.status).toBe(200);
        await failedResponse.text();

        const afterFailure = await readOkJson<{ session: HivewardChatSession }>(
          await fetch(`${baseUrl}/api/chat/sessions/${created.session.id}`)
        );
        expect(afterFailure.session.status).toBe("native_missing");
        expect(afterFailure.session.nativeSessionState).toBe("missing");

        const blockedResponse = await fetch(`${baseUrl}/api/chat/sessions/${created.session.id}/messages/stream`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ message: "Continue without permission." })
        });
        expect(blockedResponse.status).toBe(409);

        const rebuiltResponse = await fetch(`${baseUrl}/api/chat/sessions/${created.session.id}/messages/stream`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            message: "Continue with history.",
            rebuildFromHivewardHistory: true
          })
        });
        expect(rebuiltResponse.status).toBe(200);
        await rebuiltResponse.text();

        expect(adapter.chatInputs.at(-1)?.sessionKey).toBe("");
        expect(adapter.chatInputs.at(-1)?.message).toContain("HiveWard visible conversation history:");

        const afterRebuild = await readOkJson<{ session: HivewardChatSession }>(
          await fetch(`${baseUrl}/api/chat/sessions/${created.session.id}`)
        );
        expect(afterRebuild.session.status).toBe("active");
        expect(afterRebuild.session.nativeSessionId).toBe("rebuilt-native-session");
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

type StreamSessionChatTestInput = {
  harnessId: HivewardChatSession["harnessId"];
  title?: string;
  nativeSessionId?: string;
  message: string;
  attachments?: unknown[];
  modelId?: string;
  agentId?: string;
  thinkingEffort?: HivewardChatSession["thinkingEffort"];
  includePlatformContext?: boolean;
  mode?: HivewardChatSession["mode"];
  roleScope?: HivewardChatSession["roleScope"];
  rebuildFromHivewardHistory?: boolean;
};

async function streamSessionChat(baseUrl: string, input: StreamSessionChatTestInput): Promise<Response> {
  const createResponse = await fetch(`${baseUrl}/api/chat/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      harnessId: input.harnessId,
      title: input.title ?? input.message,
      nativeSessionId: input.nativeSessionId,
      modelId: input.modelId,
      agentId: input.agentId,
      thinkingEffort: input.thinkingEffort,
      mode: input.mode,
      roleScope: input.roleScope
    })
  });
  const created = await readOkJson<{ session: HivewardChatSession }>(createResponse);

  return fetch(`${baseUrl}/api/chat/sessions/${created.session.id}/messages/stream`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      message: input.message,
      attachments: input.attachments ?? [],
      modelId: input.modelId,
      agentId: input.agentId,
      thinkingEffort: input.thinkingEffort,
      includePlatformContext: input.includePlatformContext,
      mode: input.mode,
      roleScope: input.roleScope,
      rebuildFromHivewardHistory: input.rebuildFromHivewardHistory
    })
  });
}

function createConfigStoreFixture(defaultWorkspace = "D:\\hiveward-test"): OpenClawConfigStore {
  const state: OpenClawConfigState = {
    configPath: "test-openclaw.json",
    defaultWorkspace,
    defaultModelId: "openclaw/default",
    configuredModels: [{ id: "openclaw/default", label: "OpenClaw Default", provider: "openclaw" }],
    configuredAgents: [
      {
        id: "main",
        name: "main",
        workspace: defaultWorkspace,
        agentDir: join(defaultWorkspace, ".openclaw", "agents", "main"),
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
