import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import type { AddressInfo } from "node:net";
import express from "express";
import { describe, expect, it } from "vitest";
import {
  MockRuntimeAdapter,
  RuntimeAdapterError,
  type RuntimeChatSessionInput,
  type RuntimeChatSessionResult,
  type RuntimeChatSessionTitleInput,
  type RuntimeChatStreamInput
} from "@hiveward/adapter";
import type {
  AgentNodeConfig,
  AgentOutputEvent,
  BlueprintDefinition,
  BlueprintNodeRun,
  BlueprintRun,
  ChatHistoryMessage,
  RuntimeChatEvent,
  RuntimeTaskEventHandler,
  HivewardChatSession,
  ManagerNodeConfig,
  OpenClawConfigState,
  OpenClawVersionInfo,
  RuntimeOverview,
  RunRoomOutputSnapshot,
  RunRoomOutputStreamEvent,
  StartAgentTaskInput,
  WorkspaceDashboard,
  ApprovalRequest,
  BlueprintKanbanBoard,
  HumanActionRequest,
  ManagerCommand,
  RunRoom,
  WorkerTask
} from "@hiveward/shared";
import { resolveApprovalCapabilities } from "@hiveward/shared";
import { createApiRouter } from "./apiRouter";
import { ArtifactService } from "../services/artifactService";
import { FileHivewardStore } from "../store/fileHivewardStore";
import { ManagerCommandService } from "../services/managerCommandService";
import type { OpenClawConfigStore } from "../store/openClawConfigStore";
import { BlueprintWorker } from "../worker/blueprintWorker";

const oldInboxCreatedChatOutputEventName = ["inbox", "item", "created"].join("_");
const historicalInboxSubmissionSchema = "hiveward.inbox-submission/v1";

class TrackingAdapter extends MockRuntimeAdapter {
  runtimeOverviewCalls = 0;
  lastStartInput: StartAgentTaskInput | undefined;
  lastChatSessionInput: RuntimeChatSessionInput | undefined;
  lastChatSessionTitleInput: RuntimeChatSessionTitleInput | undefined;
  lastChatStreamInput: RuntimeChatStreamInput | undefined;

  override async startAgentTask(input: StartAgentTaskInput, onEvent?: RuntimeTaskEventHandler) {
    this.lastStartInput = input;
    return super.startAgentTask(input, onEvent);
  }

  override async streamChatMessage(input: RuntimeChatStreamInput, onEvent: (event: RuntimeChatEvent) => void) {
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

class OpenClawGatewayNotConfiguredAdapter extends TrackingAdapter {
  override async createChatSession(_input: RuntimeChatSessionInput): Promise<RuntimeChatSessionResult> {
    throw new RuntimeAdapterError(
      "openclaw_gateway_not_configured",
      "OpenClaw Gateway is not configured."
    );
  }
}

class ChatOutputAdapter extends TrackingAdapter {
  constructor(private readonly output: string) {
    super();
  }

  override async streamChatMessage(input: RuntimeChatStreamInput, onEvent: (event: RuntimeChatEvent) => void) {
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

class ChatRuntimeActivityAdapter extends TrackingAdapter {
  override async streamChatMessage(input: RuntimeChatStreamInput, onEvent: (event: RuntimeChatEvent) => void) {
    this.lastChatStreamInput = input;
    const now = new Date().toISOString();
    const runId = input.idempotencyKey;
    onEvent({
      type: "started",
      taskId: runId,
      runId,
      sessionKey: input.sessionKey || "codex-chat-session-test",
      source: "codex",
      status: "running",
      updatedAt: now
    });
    onEvent({
      type: "runtime_state",
      source: "codex",
      phase: "tool",
      label: "repo.search apps/api",
      id: "tool-1",
      status: "started",
      updatedAt: now
    });
    onEvent({ type: "delta", text: "First visible sentence." });
    onEvent({
      type: "runtime_state",
      source: "codex",
      phase: "tool",
      label: "repo.search apps/api",
      id: "tool-1",
      status: "completed",
      updatedAt: now
    });
    onEvent({
      type: "done",
      taskId: runId,
      runId,
      sessionKey: input.sessionKey || "codex-chat-session-test",
      source: "codex",
      status: "succeeded",
      output: "First visible sentence.",
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

  override async streamChatMessage(input: RuntimeChatStreamInput, onEvent: (event: RuntimeChatEvent) => void) {
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

  override async streamChatMessage(input: RuntimeChatStreamInput, onEvent: (event: RuntimeChatEvent) => void) {
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

  it("directly creates, renames, and persists an isolated company workspace", async () => {
    const fixture = await createStoreFixture();
    try {
      await withApiServer(fixture.store, async (baseUrl) => {
        const initialResponse = await fetch(`${baseUrl}/api/companies`);
        const initialBody = await readOkJson<{ selectedCompanyId: string }>(initialResponse);
        const defaultCompanyId = initialBody.selectedCompanyId;

        const createResponse = await fetch(`${baseUrl}/api/companies`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({})
        });
        const createdBody = await readOkJson<{
          companies: Array<{ id: string; name: string; logoLabel?: string }>;
          selectedCompanyId: string;
        }>(createResponse);
        const companyId = createdBody.selectedCompanyId;
        const createdCompany = createdBody.companies.find((company) => company.id === companyId);

        expect(createdCompany).toMatchObject({
          name: "New Company",
          logoLabel: "NC"
        });

        const emptyWorkspaceResponse = await fetch(`${baseUrl}/api/dashboard-state`);
        const emptyWorkspaceBody = await readOkJson<{ dashboard: WorkspaceDashboard }>(emptyWorkspaceResponse);
        expect(emptyWorkspaceBody.dashboard.notes).toEqual([]);

        const now = new Date().toISOString();
        const companyDashboard: WorkspaceDashboard = {
          dashboardWidgets: [],
          savedViews: [],
          tags: [],
          notes: [
            {
              id: "note-company-only",
              title: "Company scoped note",
              body: "Stored only in the new company's workspace.",
              tagIds: [],
              createdAt: now,
              updatedAt: now
            }
          ],
          updatedAt: now
        };
        const saveWorkspaceResponse = await fetch(`${baseUrl}/api/dashboard-state`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ dashboard: companyDashboard })
        });
        const savedWorkspaceBody = await readOkJson<{ dashboard: WorkspaceDashboard }>(saveWorkspaceResponse);
        expect(savedWorkspaceBody.dashboard.notes).toHaveLength(1);

        const renameResponse = await fetch(`${baseUrl}/api/companies/${companyId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "Renamed Ops" })
        });
        const renamedBody = await readOkJson<{ companies: Array<{ id: string; name: string; logoLabel?: string }> }>(renameResponse);
        expect(renamedBody.companies.find((company) => company.id === companyId)).toMatchObject({
          name: "Renamed Ops",
          logoLabel: "RO"
        });

        const selectDefaultResponse = await fetch(`${baseUrl}/api/companies/selected`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ companyId: defaultCompanyId })
        });
        await readOkJson(selectDefaultResponse);
        const defaultWorkspaceResponse = await fetch(`${baseUrl}/api/dashboard-state`);
        const defaultWorkspaceBody = await readOkJson<{ dashboard: WorkspaceDashboard }>(defaultWorkspaceResponse);
        expect(defaultWorkspaceBody.dashboard.notes.some((note) => note.id === "note-company-only")).toBe(false);

        const selectNewResponse = await fetch(`${baseUrl}/api/companies/selected`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ companyId })
        });
        await readOkJson(selectNewResponse);
        const restoredWorkspaceResponse = await fetch(`${baseUrl}/api/dashboard-state`);
        const restoredWorkspaceBody = await readOkJson<{ dashboard: WorkspaceDashboard }>(restoredWorkspaceResponse);
        expect(restoredWorkspaceBody.dashboard.notes).toMatchObject([{ id: "note-company-only" }]);
      });
    } finally {
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it("keeps company CEOs, leaders, blueprints, and role scopes isolated", async () => {
    const fixture = await createStoreFixture();
    try {
      await withApiServer(fixture.store, async (baseUrl) => {
        const initialCompanies = await readOkJson<{
          selectedCompanyId: string;
        }>(await fetch(`${baseUrl}/api/companies`));
        const defaultCompanyId = initialCompanies.selectedCompanyId;
        const defaultBlueprints = await readOkJson<{ blueprints: Array<{ id: string; companyId: string; name: string }> }>(
          await fetch(`${baseUrl}/api/blueprints`)
        );
        const defaultBlueprintId = defaultBlueprints.blueprints[0]!.id;
        const defaultRoles = await readOkJson<{
          roles: {
            companyId: string;
            ceo: { companyId: string; id: string };
            leaders: Array<{ companyId: string; id: string; blueprintId?: string }>;
          };
          architecture: { companyId: string; nodes: Array<{ kind: string; blueprintId?: string }> };
        }>(await fetch(`${baseUrl}/api/roles`));

        expect(defaultRoles.roles.companyId).toBe(defaultCompanyId);
        expect(defaultRoles.roles.ceo).toMatchObject({ id: "ceo", companyId: defaultCompanyId });
        expect(defaultRoles.roles.leaders.every((leader) => leader.companyId === defaultCompanyId)).toBe(true);
        expect(defaultRoles.roles.leaders.map((leader) => leader.blueprintId).sort()).toEqual(
          defaultBlueprints.blueprints.map((blueprint) => blueprint.id).sort()
        );
        expect(defaultRoles.architecture.companyId).toBe(defaultCompanyId);

        const createCompany = await readOkJson<{ selectedCompanyId: string }>(
          await fetch(`${baseUrl}/api/companies`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name: "Isolated Company" })
          })
        );
        const isolatedCompanyId = createCompany.selectedCompanyId;

        const emptyBlueprints = await readOkJson<{ blueprints: Array<{ id: string }> }>(await fetch(`${baseUrl}/api/blueprints`));
        expect(emptyBlueprints.blueprints).toEqual([]);
        const emptyRoles = await readOkJson<{
          roles: { companyId: string; ceo: { companyId: string; id: string }; leaders: unknown[] };
          architecture: { companyId: string; nodes: Array<{ kind: string }> };
        }>(await fetch(`${baseUrl}/api/roles`));
        expect(emptyRoles.roles).toMatchObject({
          companyId: isolatedCompanyId,
          ceo: { id: "ceo", companyId: isolatedCompanyId },
          leaders: []
        });
        expect(emptyRoles.architecture).toMatchObject({
          companyId: isolatedCompanyId,
          nodes: [{ kind: "ceo" }]
        });

        const createBlueprint = await readOkJson<{ blueprint: { id: string; companyId: string; name: string } }>(
          await fetch(`${baseUrl}/api/blueprints`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name: "Isolated Blueprint" })
          })
        );
        const isolatedBlueprintId = createBlueprint.blueprint.id;
        expect(createBlueprint.blueprint).toMatchObject({
          companyId: isolatedCompanyId,
          name: "Isolated Blueprint"
        });

        const isolatedRoles = await readOkJson<{
          roles: {
            companyId: string;
            ceo: { companyId: string; id: string };
            leaders: Array<{ companyId: string; id: string; blueprintId?: string }>;
          };
          architecture: { companyId: string; nodes: Array<{ kind: string; blueprintId?: string }> };
        }>(await fetch(`${baseUrl}/api/roles`));
        expect(isolatedRoles.roles.companyId).toBe(isolatedCompanyId);
        expect(isolatedRoles.roles.ceo.companyId).toBe(isolatedCompanyId);
        expect(isolatedRoles.roles.leaders).toMatchObject([
          {
            companyId: isolatedCompanyId,
            blueprintId: isolatedBlueprintId
          }
        ]);
        expect(isolatedRoles.architecture.nodes.some((node) => node.kind === "leader" && node.blueprintId === isolatedBlueprintId)).toBe(true);

        const selectDefault = await fetch(`${baseUrl}/api/companies/selected`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ companyId: defaultCompanyId })
        });
        await readOkJson(selectDefault);
        const defaultBlueprintsAgain = await readOkJson<{ blueprints: Array<{ id: string; companyId: string }> }>(
          await fetch(`${baseUrl}/api/blueprints`)
        );
        expect(defaultBlueprintsAgain.blueprints.some((blueprint) => blueprint.id === isolatedBlueprintId)).toBe(false);
        expect(defaultBlueprintsAgain.blueprints.every((blueprint) => blueprint.companyId === defaultCompanyId)).toBe(true);
        expect((await fetch(`${baseUrl}/api/blueprints/${isolatedBlueprintId}`)).status).toBe(404);

        const defaultRolesAgain = await readOkJson<{
          roles: { companyId: string; ceo: { companyId: string }; leaders: Array<{ companyId: string; blueprintId?: string }> };
          architecture: { companyId: string; nodes: Array<{ blueprintId?: string }> };
        }>(await fetch(`${baseUrl}/api/roles`));
        expect(defaultRolesAgain.roles.companyId).toBe(defaultCompanyId);
        expect(defaultRolesAgain.roles.ceo.companyId).toBe(defaultCompanyId);
        expect(defaultRolesAgain.roles.leaders.some((leader) => leader.blueprintId === isolatedBlueprintId)).toBe(false);
        expect(defaultRolesAgain.architecture.nodes.some((node) => node.blueprintId === isolatedBlueprintId)).toBe(false);

        const ceoSessionResponse = await fetch(`${baseUrl}/api/chat/sessions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            harnessId: "openclaw",
            roleScope: { role: "ceo", companyId: isolatedCompanyId, blueprintId: isolatedBlueprintId }
          })
        });
        const ceoSessionBody = await readOkJson<{ session: { companyId: string; roleScope?: { companyId?: string; blueprintId?: string } } }>(
          ceoSessionResponse
        );
        expect(ceoSessionBody.session.companyId).toBe(defaultCompanyId);
        expect(ceoSessionBody.session.roleScope).toMatchObject({ companyId: defaultCompanyId });
        expect(ceoSessionBody.session.roleScope?.blueprintId).toBeUndefined();

        const leaderSessionResponse = await fetch(`${baseUrl}/api/chat/sessions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            harnessId: "openclaw",
            roleScope: {
              role: "leader",
              companyId: isolatedCompanyId,
              leaderId: isolatedRoles.roles.leaders[0]!.id,
              blueprintId: isolatedBlueprintId
            }
          })
        });
        const leaderSessionBody = await readOkJson<{ session: { roleScope?: unknown } }>(leaderSessionResponse);
        expect(leaderSessionBody.session.roleScope).toBeUndefined();

        const selectIsolated = await fetch(`${baseUrl}/api/companies/selected`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ companyId: isolatedCompanyId })
        });
        await readOkJson(selectIsolated);
        expect((await fetch(`${baseUrl}/api/blueprints/${defaultBlueprintId}`)).status).toBe(404);
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

  it("does not repair missing artifact index entries from node output when serving a run archive", async () => {
    const fixture = await createStoreFixture();
    try {
      const blueprint = (await fixture.store.listBlueprints())[0]!;
      const run = await fixture.store.createBlueprintRun(blueprint, "tester");
      const node = blueprint.nodes[0]!;
      const now = new Date().toISOString();
      const nodeRun: BlueprintNodeRun = {
        id: "node-run-html-artifact",
        blueprintRunId: run.id,
        blueprintId: blueprint.id,
        nodeId: node.id,
        nodeLabel: node.config.label,
        nodeType: "agent",
        status: "succeeded",
        queuedAt: now,
        startedAt: now,
        endedAt: now,
        output: JSON.stringify({
          humanReportMd: "## 摘要\n已制作 HTML 页面。\n\n## 交付位置\n- artifacts[0]：自分发测试页面。",
          result: { ok: true },
          artifacts: [{
            title: "自分发测试页面",
            kind: "html",
            format: "text/html",
            previewPolicy: "sandboxed_iframe",
            trusted: true,
            body: "<!doctype html><html><body>自分发测试页面</body></html>"
          }]
        })
      };
      await fixture.store.upsertNodeRun(nodeRun);
      expect(await fixture.store.listArtifacts(run.id)).toHaveLength(0);

      await withApiServer(fixture.store, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/blueprint-runs/${run.id}`);
        const body = await readOkJson<{ run: { artifacts: Array<{ nodeRunId?: string; storagePath?: string; downloadUrl?: string }> } }>(response);

        expect(body.run.artifacts).toEqual([]);
        expect(await fixture.store.listArtifacts(run.id)).toHaveLength(0);
      });
    } finally {
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it("does not expose run-scoped approval action routes", async () => {
    const fixture = await createStoreFixture();
    const worker = {
      async applyApprovalRequest() {
        throw new Error("Run-scoped approval routes must not call the worker.");
      },
      async selectApprovalReply() {
        throw new Error("Run-scoped approval selection routes must not call the worker.");
      }
    } as unknown as BlueprintWorker;

    try {
      const blueprint = (await fixture.store.listBlueprints())[0]!;
      const run = await fixture.store.createBlueprintRun(blueprint, "tester");
      await seedRunApprovalRequest(fixture.store, run.id, "node-run-1");

      await withApiServer(fixture.store, async (baseUrl) => {
        const approve = await fetch(`${baseUrl}/api/blueprint-runs/${run.id}/approve`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ nodeRunId: "node-run-1", comment: "Looks good." })
        });
        const reject = await fetch(`${baseUrl}/api/blueprint-runs/${run.id}/reject`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ nodeRunId: "node-run-1", comment: "Needs work." })
        });
        const reply = await fetch(`${baseUrl}/api/blueprint-runs/${run.id}/reply`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ nodeRunId: "node-run-1", message: "Please revise this answer." })
        });
        const select = await fetch(`${baseUrl}/api/blueprint-runs/${run.id}/select-approval-reply`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ nodeRunId: "node-run-1", selectedReplyId: "reply-1" })
        });
        expect(approve.status).toBe(404);
        expect(reject.status).toBe(404);
        expect(reply.status).toBe(404);
        expect(select.status).toBe(404);
      }, new TrackingAdapter(), createConfigStoreFixture(), worker);
    } finally {
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it("does not expose request-scoped approval selection as a normal route", async () => {
    const fixture = await createStoreFixture();
    const worker = {
      async selectApprovalReply() {
        throw new Error("Request-scoped approval selection routes must not call the worker.");
      }
    } as unknown as BlueprintWorker;

    try {
      const blueprint = (await fixture.store.listBlueprints())[0]!;
      const run = await fixture.store.createBlueprintRun(blueprint, "tester");
      const approvalRequest = await seedRunApprovalRequest(fixture.store, run.id, "node-run-select");

      await withApiServer(fixture.store, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/approval-requests/${approvalRequest.id}/select-reply`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ selectedReplyId: null })
        });
        expect(response.status).toBe(404);
      }, new TrackingAdapter(), createConfigStoreFixture(), worker);
    } finally {
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it("does not expose request-scoped approval selection on terminal runs", async () => {
    const fixture = await createStoreFixture();
    const worker = {
      async selectApprovalReply() {
        throw new Error("Terminal selection routes must not call the worker.");
      }
    } as unknown as BlueprintWorker;

    try {
      const blueprint = (await fixture.store.listBlueprints())[0]!;
      const run = await fixture.store.createBlueprintRun(blueprint, "tester");
      await fixture.store.updateBlueprintRun({
        ...run,
        status: "cancelled",
        endedAt: new Date().toISOString()
      });
      const approvalRequest = await seedRunApprovalRequest(fixture.store, run.id, "node-run-terminal-select");

      await withApiServer(fixture.store, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/approval-requests/${approvalRequest.id}/select-reply`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ selectedReplyId: null })
        });
        expect(response.status).toBe(404);
      }, new TrackingAdapter(), createConfigStoreFixture(), worker);
    } finally {
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it("applies request-scoped run approvals against the immutable run blueprint snapshot", async () => {
    const fixture = await createStoreFixture();
    const receivedBlueprints: BlueprintDefinition[] = [];
    const worker = {
      async applyApprovalRequest(
        blueprint: BlueprintDefinition,
        run: BlueprintRun,
        _approvalRequestId: string,
        _action: "approve" | "reject" | "reply"
      ) {
        receivedBlueprints.push(blueprint);
        return { ...run, status: "running" as const };
      }
    } as unknown as BlueprintWorker;

    try {
      const created = await fixture.store.createBlueprint({ name: "Approval snapshot" });
      const snapshotBlueprint = await fixture.store.saveBlueprint({
        ...created,
        nodes: [
          {
            id: "manager",
            type: "manager",
            runtimeId: "codex",
            position: { x: 0, y: 0 },
            config: {
              label: "Manager",
              portCount: 1,
              maxHandoffs: 1,
              modelId: "codex/snapshot-model"
            } satisfies ManagerNodeConfig
          }
        ]
      });
      const run = await fixture.store.createBlueprintRun(snapshotBlueprint, "tester");
      await fixture.store.saveBlueprint({
        ...snapshotBlueprint,
        nodes: snapshotBlueprint.nodes.map((node) => {
          if (node.type !== "manager") return node;
          const config = node.config as ManagerNodeConfig;
          return { ...node, config: { ...config, modelId: undefined } satisfies ManagerNodeConfig };
        })
      });
      const approvalRequest = await seedRunApprovalRequest(fixture.store, run.id, "node-run-1");

      await withApiServer(fixture.store, async (baseUrl) => {
        await readOkJson(await fetch(`${baseUrl}/api/approval-requests/${approvalRequest.id}/approve`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({})
        }));
      }, new TrackingAdapter(), createConfigStoreFixture(), worker);

      const managerConfig = receivedBlueprints[0]?.nodes.find((node) => node.id === "manager")?.config as ManagerNodeConfig | undefined;
      expect(managerConfig?.modelId).toBe("codex/snapshot-model");
    } finally {
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it("returns 409 for repeated approval decisions and forbids old inbox decision routes", async () => {
    const fixture = await createStoreFixture();
    try {
      const approval = await seedStandaloneApprovalRequest(fixture.store, "external-approval");
      const historicalInboxItemId = "historical-inbox-item";

      await withApiServer(fixture.store, async (baseUrl) => {
        await readOkJson(await fetch(`${baseUrl}/api/approval-requests/${approval.id}/approve`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ comment: "Approved once." })
        }));
        const secondApproval = await fetch(`${baseUrl}/api/approval-requests/${approval.id}/approve`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ comment: "Duplicate click." })
        });
        const secondApprovalBody = await secondApproval.json() as { error?: { code?: string } };
        expect(secondApproval.status, JSON.stringify(secondApprovalBody)).toBe(409);
        expect(secondApprovalBody.error?.code).toBe("approval_conflict");
        expect(await fixture.store.listApprovalDecisions(approval.id)).toHaveLength(1);
        expectOldInboxNormalStoreSurfaceDeleted(fixture.store);

        const oldApprove = await fetch(`${baseUrl}/api/inbox/${historicalInboxItemId}/approve`, { method: "POST" });
        const oldReject = await fetch(`${baseUrl}/api/inbox/${historicalInboxItemId}/reject`, { method: "POST" });
        const oldReply = await fetch(`${baseUrl}/api/inbox/${historicalInboxItemId}/reply`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ message: "old inbox reply" })
        });
        expect(oldApprove.status).toBe(404);
        expect(oldReject.status).toBe(404);
        expect(oldReply.status).toBe(404);
        expect(await fixture.store.listApprovalRequests({ runId: historicalInboxItemId })).toEqual([]);
      });
    } finally {
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it("exposes approval threads and replies through request-compatible API facades", async () => {
    const fixture = await createStoreFixture();
    try {
      const approval = await seedStandaloneApprovalRequest(fixture.store, "threaded-approval");
      await withApiServer(fixture.store, async (baseUrl) => {
        const replyBody = await readOkJson<{
          approvalRequest: ApprovalRequest;
          approvalThread?: { id: string; status: string; currentRequestId?: string };
          approvalReplies?: Array<{ threadId: string; approvalRequestId?: string; body: string }>;
        }>(await fetch(`${baseUrl}/api/approval-requests/${approval.id}/reply`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ message: "Keep this as a thread comment." })
        }));

        expect(replyBody.approvalRequest).toMatchObject({ id: approval.id, status: "pending" });
        expect(replyBody.approvalThread).toMatchObject({
          id: approval.threadId,
          status: "open",
          currentRequestId: approval.id
        });
        expect(replyBody.approvalReplies).toEqual([
          expect.objectContaining({
            threadId: approval.threadId,
            approvalRequestId: approval.id,
            body: "Keep this as a thread comment."
          })
        ]);

        const requestBody = await readOkJson<{
          approvalRequest: ApprovalRequest;
          approvalThread?: { id: string };
          approvalReplies?: Array<{ body: string }>;
        }>(await fetch(`${baseUrl}/api/approval-requests/${approval.id}`));
        expect(requestBody.approvalRequest.id).toBe(approval.id);
        expect(requestBody.approvalThread?.id).toBe(approval.threadId);
        expect(requestBody.approvalReplies?.[0]?.body).toBe("Keep this as a thread comment.");

        const listBody = await readOkJson<{ approvalThreads: Array<{ id: string; status: string }> }>(
          await fetch(`${baseUrl}/api/approval-threads?runId=${encodeURIComponent(approval.runId!)}`)
        );
        expect(listBody.approvalThreads).toEqual([
          expect.objectContaining({ id: approval.threadId, status: "open" })
        ]);

        const threadBody = await readOkJson<{
          approvalThread: { id: string };
          approvalRequests: ApprovalRequest[];
          approvalReplies: Array<{ body: string }>;
          approvalDecisions: Array<{ action: string }>;
        }>(await fetch(`${baseUrl}/api/approval-threads/${encodeURIComponent(approval.threadId ?? approval.id)}`));
        expect(threadBody.approvalThread.id).toBe(approval.threadId);
        expect(threadBody.approvalRequests.map((request) => request.id)).toEqual([approval.id]);
        expect(threadBody.approvalReplies.map((reply) => reply.body)).toEqual(["Keep this as a thread comment."]);
        expect(threadBody.approvalDecisions.map((decision) => decision.action)).toEqual(["reply"]);

        const repliesBody = await readOkJson<{ approvalReplies: Array<{ body: string }> }>(
          await fetch(`${baseUrl}/api/approval-threads/${encodeURIComponent(approval.threadId ?? approval.id)}/replies`)
        );
        expect(repliesBody.approvalReplies.map((reply) => reply.body)).toEqual(["Keep this as a thread comment."]);
      });
    } finally {
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it("rejects removed approval request actions before they reach the worker", async () => {
    const fixture = await createStoreFixture();
    const calls: Array<{ action: string; approvalRequestId?: string; comment?: string; message?: string }> = [];
    const worker = {
      async applyApprovalRequest(
        _blueprint: BlueprintDefinition,
        run: BlueprintRun,
        approvalRequestId: string,
        action: "approve" | "reject" | "reply",
        input?: { comment?: string; message?: string }
      ) {
        calls.push({ action, approvalRequestId, comment: input?.comment, message: input?.message });
        return { ...run, status: "waiting_approval" as const };
      }
    } as unknown as BlueprintWorker;

    try {
      const blueprint = (await fixture.store.listBlueprints())[0]!;
      const run = await fixture.store.createBlueprintRun(blueprint, "tester");
      const canonicalRequest = await seedRunApprovalRequest(fixture.store, run.id, "node-run-return");

      await withApiServer(fixture.store, async (baseUrl) => {
        for (const removedRoute of [
          "return-for-revision",
          "return_for_revision",
          "request-changes",
          "request_changes",
          "revise",
          "complete",
          "terminate"
        ]) {
          const response = await fetch(`${baseUrl}/api/approval-requests/${canonicalRequest.id}/${removedRoute}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ message: "Removed route must not execute.", comment: "Removed route must not execute." })
          });
          expect(response.status).toBe(404);
        }
      }, new TrackingAdapter(), createConfigStoreFixture(), worker);

      expect(calls).toEqual([]);
    } finally {
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it("allows stale approval requests on finished runs to be commented on and closed without worker reruns", async () => {
    const fixture = await createStoreFixture();
    const worker = {
      async applyApprovalRequest() {
        throw new Error("Terminal approval cleanup must not call the worker.");
      }
    } as unknown as BlueprintWorker;

    try {
      const blueprint = (await fixture.store.listBlueprints())[0]!;
      const run = await fixture.store.createBlueprintRun(blueprint, "tester");
      await fixture.store.updateBlueprintRun({
        ...run,
        status: "cancelled",
        endedAt: new Date().toISOString()
      });
      const staleRequest = await seedRunApprovalRequest(fixture.store, run.id, "terminal-cleanup");
      const blockedRequest = await seedRunApprovalRequest(fixture.store, run.id, "terminal-approve");
      const approvedRepairRequest = await seedRunApprovalRequest(fixture.store, run.id, "terminal-approved-repair");
      const repairHumanActionId = "human-action-terminal-run-approve-repair";
      await fixture.store.appendHumanActionRequest(createHumanActionRequestFact({
        id: repairHumanActionId,
        sourceContextType: "run_room",
        sourceContextId: run.id,
        responseIntent: "decision_required",
        approvalRequestId: approvedRepairRequest.id,
        title: "Terminal approve repair"
      }));
      const approvedAt = "2026-06-04T00:11:00.000Z";
      await fixture.store.applyApprovalDecision({
        approvalRequestId: approvedRepairRequest.id,
        expectedStatus: "pending",
        nextRequest: {
          ...approvedRepairRequest,
          status: "approved",
          capabilities: resolveApprovalCapabilities(approvedRepairRequest.kind, "approved"),
          updatedAt: approvedAt
        },
        decision: {
          id: "decision-terminal-approve-repair",
          approvalRequestId: approvedRepairRequest.id,
          action: "approve",
          actor: "user",
          resultingStatus: "approved",
          createdAt: approvedAt
        }
      });
      await fixture.store.updateHumanActionRequest({
        id: repairHumanActionId,
        status: "pending",
        updatedAt: "2026-06-04T00:12:00.000Z"
      });

      await withApiServer(fixture.store, async (baseUrl) => {
        const replyBody = await readOkJson<{
          approvalRequest: ApprovalRequest;
          approvalReplies?: Array<{ body: string }>;
          run?: { run: { id: string } };
        }>(await fetch(`${baseUrl}/api/approval-requests/${staleRequest.id}/reply`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ message: "Leaving cleanup context." })
        }));
        expect(replyBody.approvalRequest).toMatchObject({ id: staleRequest.id, status: "pending" });
        expect(replyBody.approvalReplies?.map((reply) => reply.body)).toEqual(["Leaving cleanup context."]);
        expect(replyBody.run?.run.id).toBe(run.id);

        const rejectBody = await readOkJson<{
          approvalRequest: ApprovalRequest;
          decision?: { action: string };
          run?: { run: { id: string } };
        }>(await fetch(`${baseUrl}/api/approval-requests/${staleRequest.id}/reject`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ comment: "Close stale request." })
        }));
        expect(rejectBody.approvalRequest).toMatchObject({ id: staleRequest.id, status: "rejected" });
        expect(rejectBody.decision?.action).toBe("reject");
        expect(rejectBody.run?.run.id).toBe(run.id);

        const approveResponse = await fetch(`${baseUrl}/api/approval-requests/${blockedRequest.id}/approve`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ comment: "Should not restart a finished run." })
        });
        const approveBody = await approveResponse.json() as { error?: { code?: string; message?: string } };
        expect(approveResponse.status, JSON.stringify(approveBody)).toBe(409);
        expect(approveBody.error).toMatchObject({
          code: "run_already_finished",
          message: "Run is already finished."
        });

        const repairApproveResponse = await fetch(`${baseUrl}/api/approval-requests/${approvedRepairRequest.id}/approve`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ comment: "Repair stale terminal approval action." })
        });
        const repairApproveBody = await repairApproveResponse.json() as { error?: { code?: string } };
        expect(repairApproveResponse.status, JSON.stringify(repairApproveBody)).toBe(409);
        expect(repairApproveBody.error?.code).toBe("approval_conflict");
      }, new TrackingAdapter(), createConfigStoreFixture(), worker);

      expect((await fixture.store.listApprovalDecisions(staleRequest.id)).map((decision) => decision.action)).toEqual([
        "reply",
        "reject"
      ]);
      expect(await fixture.store.getHumanActionRequest(repairHumanActionId)).toMatchObject({
        status: "closed"
      });
      expect(await fixture.store.listApprovalDecisions(approvedRepairRequest.id)).toHaveLength(1);
    } finally {
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it("serves published HTML artifact download URLs from the configured store data directory", async () => {
    const fixture = await createStoreFixture();
    try {
      const now = new Date().toISOString();
      const service = new ArtifactService(fixture.store);
      const [artifact] = await service.publishFromNodeRun({
        runId: "run-artifact-route",
        roundId: "round-artifact-route",
        nodeRun: {
          id: "node-run-artifact-route",
          blueprintRunId: "run-artifact-route",
          blueprintId: "blueprint-artifact-route",
          nodeId: "html-builder",
          nodeLabel: "HTML Builder",
          nodeType: "agent",
          status: "succeeded",
          queuedAt: now,
          startedAt: now,
          endedAt: now,
          output: {
            humanReportMd: "## Delivery location\n\n- HTML preview declared in artifacts[].",
            artifacts: [{
              title: "HTML Builder",
              kind: "html",
              content: "<!doctype html><html><body>artifact route ok</body></html>"
            }]
          }
        } satisfies BlueprintNodeRun
      });
      if (!artifact?.downloadUrl) throw new Error("Expected published HTML artifact with a downloadUrl.");

      expect(artifact).toMatchObject({
        kind: "html",
        trusted: false,
        previewPolicy: "sandboxed_iframe"
      });
      await withApiServer(fixture.store, async (baseUrl) => {
        const response = await fetch(`${baseUrl}${artifact.downloadUrl}`);
        expect(response.status).toBe(200);
        expect(await response.text()).toContain("artifact route ok");
      });
    } finally {
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it("serves published markdown and JSON artifact download URLs", async () => {
    const fixture = await createStoreFixture();
    try {
      const now = new Date().toISOString();
      const service = new ArtifactService(fixture.store);
      const markdownArtifacts = await service.publishFromNodeRun({
        runId: "run-artifact-route-md",
        roundId: "round-artifact-route-md",
        nodeRun: {
          id: "node-run-artifact-route-md",
          blueprintRunId: "run-artifact-route-md",
          blueprintId: "blueprint-artifact-route",
          nodeId: "markdown-builder",
          nodeLabel: "Markdown Builder",
          nodeType: "agent",
          status: "succeeded",
          queuedAt: now,
          startedAt: now,
          endedAt: now,
          output: {
            humanReportMd: "## Delivery location\n\n- Markdown declared in artifacts[].",
            artifacts: [{
              title: "Markdown Builder",
              kind: "markdown",
              content: "# Artifact route markdown"
            }]
          }
        } satisfies BlueprintNodeRun
      });
      const jsonArtifacts = await service.publishFromNodeRun({
        runId: "run-artifact-route-json",
        roundId: "round-artifact-route-json",
        nodeRun: {
          id: "node-run-artifact-route-json",
          blueprintRunId: "run-artifact-route-json",
          blueprintId: "blueprint-artifact-route",
          nodeId: "json-builder",
          nodeLabel: "JSON Builder",
          nodeType: "agent",
          status: "succeeded",
          queuedAt: now,
          startedAt: now,
          endedAt: now,
          output: {
            humanReportMd: "## Delivery location\n\n- JSON declared in artifacts[].",
            artifacts: [{
              title: "JSON Builder",
              kind: "json",
              content: { ok: true, message: "artifact route json" }
            }]
          }
        } satisfies BlueprintNodeRun
      });
      const markdown = markdownArtifacts[0];
      const json = jsonArtifacts[0];
      if (!markdown?.downloadUrl || !json?.downloadUrl) throw new Error("Expected markdown and JSON artifacts with download URLs.");

      expect(markdown).toMatchObject({
        kind: "markdown",
        previewPolicy: "source",
        relativePath: expect.stringContaining(".md")
      });
      expect(json).toMatchObject({
        kind: "json",
        previewPolicy: "source",
        relativePath: expect.stringContaining(".json")
      });

      await withApiServer(fixture.store, async (baseUrl) => {
        const markdownResponse = await fetch(`${baseUrl}${markdown.downloadUrl}`);
        expect(markdownResponse.status).toBe(200);
        expect(await markdownResponse.text()).toContain("Artifact route markdown");

        const jsonResponse = await fetch(`${baseUrl}${json.downloadUrl}`);
        expect(jsonResponse.status).toBe(200);
        expect(await jsonResponse.json()).toMatchObject({ ok: true, message: "artifact route json" });
      });
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

  it("persists architecture blueprint node positions across role rebuilds", async () => {
    const fixture = await createStoreFixture();
    try {
      await withApiServer(fixture.store, async (baseUrl) => {
        const initial = await readOkJson<{
          architecture: { nodes: Array<{ id: string; kind: string; position: { x: number; y: number } }> };
        }>(await fetch(`${baseUrl}/api/roles`));
        const ceo = initial.architecture.nodes.find((node) => node.kind === "ceo")!;
        const leader = initial.architecture.nodes.find((node) => node.kind === "leader")!;

        const saveLayoutResponse = await fetch(`${baseUrl}/api/roles/architecture-layout`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            positions: {
              [ceo.id]: { x: -40, y: 16 },
              [leader.id]: { x: 320, y: 480 }
            }
          })
        });
        const saved = await readOkJson<{
          architecture: { nodes: Array<{ id: string; position: { x: number; y: number } }> };
        }>(saveLayoutResponse);
        expect(saved.architecture.nodes.find((node) => node.id === ceo.id)?.position).toEqual({ x: -40, y: 16 });
        expect(saved.architecture.nodes.find((node) => node.id === leader.id)?.position).toEqual({ x: 320, y: 480 });

        await readOkJson(await fetch(`${baseUrl}/api/blueprints`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "Layout rebuild coverage" })
        }));

        const afterRebuild = await readOkJson<{
          architecture: { nodes: Array<{ id: string; position: { x: number; y: number } }> };
        }>(await fetch(`${baseUrl}/api/roles`));
        expect(afterRebuild.architecture.nodes.find((node) => node.id === ceo.id)?.position).toEqual({ x: -40, y: 16 });
        expect(afterRebuild.architecture.nodes.find((node) => node.id === leader.id)?.position).toEqual({ x: 320, y: 480 });
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

  it("orders harness status by node priority and exposes OpenClaw models and agents", async () => {
    const fixture = await createStoreFixture();
    try {
      await withApiServer(fixture.store, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/harness-status`);
        const body = await readOkJson<{
          statuses: Array<{
            id: string;
            defaultModelId?: string;
            models?: Array<{ id: string; label: string; provider?: string; isDefault?: boolean }>;
            profiles?: Array<{ id: string; label: string; modelId?: string; workspace?: string; isDefault?: boolean }>;
          }>;
        }>(response);
        const openClawStatus = body.statuses.find((status) => status.id === "openclaw");

        expect(body.statuses.slice(0, 4).map((status) => status.id)).toEqual([
          "codex",
          "claudeCode",
          "openclaw",
          "hermes"
        ]);
        expect(openClawStatus?.defaultModelId).toBe("openclaw/default");
        expect(openClawStatus?.models).toEqual([
          expect.objectContaining({
            id: "openclaw/default",
            label: "OpenClaw Default",
            provider: "openclaw",
            isDefault: true
          })
        ]);
        expect(openClawStatus?.profiles).toEqual([
          expect.objectContaining({
            id: "main",
            label: "main",
            modelId: "openclaw/default",
            workspace: "D:\\hiveward-test",
            isDefault: true
          })
        ]);
      });
    } finally {
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it("reports Google, Cursor, OpenCode, and Hermes CLI harness status and model defaults", async () => {
    const fixture = await createStoreFixture();
    const binDir = join(fixture.dir, "bin");
    const hermesHome = join(fixture.dir, "hermes-home");
    const previousPath = process.env.PATH;
    const previousGoogleDefault = process.env.HIVEWARD_GOOGLE_CLI_DEFAULT_MODEL;
    const previousGoogleModels = process.env.HIVEWARD_GOOGLE_CLI_MODELS;
    const previousCursorDefault = process.env.HIVEWARD_CURSOR_DEFAULT_MODEL;
    const previousCursorModels = process.env.HIVEWARD_CURSOR_MODELS;
    const previousOpenCodeDefault = process.env.HIVEWARD_OPENCODE_DEFAULT_MODEL;
    const previousOpenCodeModels = process.env.HIVEWARD_OPENCODE_MODELS;
    const previousHermesDefault = process.env.HIVEWARD_HERMES_DEFAULT_MODEL;
    const previousHermesModels = process.env.HIVEWARD_HERMES_MODELS;
    const previousHermesHome = process.env.HERMES_HOME;
    mkdirSync(binDir, { recursive: true });
    mkdirSync(hermesHome, { recursive: true });
    writeFakeExecutable(join(binDir, "gemini"), "gemini 0.38.1");
    writeFakeExecutable(join(binDir, "cursor-agent"), "cursor-agent 2026.1.0");
    writeFakeExecutable(join(binDir, "opencode"), "opencode 1.2.3");
    writeFakeExecutable(join(binDir, "hermes-architect"), "hermes profile architect wrapper");
    writeFakeHermesExecutable(join(binDir, "hermes"));
    process.env.PATH = `${binDir}${delimiter}${previousPath ?? ""}`;
    process.env.HIVEWARD_GOOGLE_CLI_DEFAULT_MODEL = "gemini-2.5-pro";
    process.env.HIVEWARD_GOOGLE_CLI_MODELS = "gemini-2.5-pro,gemini-2.5-flash";
    process.env.HIVEWARD_CURSOR_DEFAULT_MODEL = "gpt-5";
    process.env.HIVEWARD_CURSOR_MODELS = "gpt-5,claude-4-sonnet";
    process.env.HIVEWARD_OPENCODE_DEFAULT_MODEL = "anthropic/claude-sonnet-4";
    process.env.HIVEWARD_OPENCODE_MODELS = "anthropic/claude-sonnet-4,openai/gpt-5.4";
    process.env.HIVEWARD_HERMES_DEFAULT_MODEL = "hermes-env-default";
    process.env.HIVEWARD_HERMES_MODELS = "hermes-env-default,hermes-env-fallback";
    process.env.HERMES_HOME = hermesHome;

    try {
      await withApiServer(fixture.store, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/harness-status`);
        const body = await readOkJson<{
          statuses: Array<{
            id: string;
            label?: string;
            summary?: string;
            installed?: boolean;
            connectionState?: string;
            defaultModelId?: string;
            models?: Array<{ id: string; isDefault?: boolean }>;
            profiles?: Array<{ id: string; label: string; alias?: string; isDefault?: boolean }>;
            checks?: Array<{ label: string }>;
          }>;
        }>(response);
        const googleStatus = body.statuses.find((status) => status.id === "google");
        const cursorStatus = body.statuses.find((status) => status.id === "cursor");
        const opencodeStatus = body.statuses.find((status) => status.id === "opencode");
        const hermesStatus = body.statuses.find((status) => status.id === "hermes");

        expect(googleStatus).toMatchObject({
          label: "Google CLI",
          installed: true,
          connectionState: "available",
          defaultModelId: "gemini-2.5-pro"
        });
        expect(googleStatus?.summary).not.toContain("CLI CLI");
        expect(googleStatus?.checks?.[0]?.label).toBe("Gemini CLI");
        expect(googleStatus?.models?.map((model) => model.id)).toEqual([
          "gemini-2.5-pro",
          "gemini-2.5-flash"
        ]);
        expect(cursorStatus).toMatchObject({
          label: "Cursor CLI",
          installed: true,
          connectionState: "available",
          defaultModelId: "gpt-5"
        });
        expect(cursorStatus?.summary).not.toContain("CLI CLI");
        expect(cursorStatus?.checks?.[0]?.label).toBe("Cursor CLI");
        expect(cursorStatus?.models?.map((model) => model.id)).toEqual([
          "gpt-5",
          "claude-4-sonnet"
        ]);
        expect(opencodeStatus).toMatchObject({
          label: "OpenCode",
          installed: true,
          connectionState: "available",
          defaultModelId: "anthropic/claude-sonnet-4"
        });
        expect(opencodeStatus?.checks?.[0]?.label).toBe("OpenCode CLI");
        expect(opencodeStatus?.models?.map((model) => model.id)).toEqual([
          "anthropic/claude-sonnet-4",
          "openai/gpt-5.4"
        ]);
        expect(opencodeStatus?.models?.[0]?.isDefault).toBe(true);
        expect(hermesStatus).toMatchObject({
          label: "Hermes",
          installed: true,
          connectionState: "available",
          defaultModelId: "hermes-env-default"
        });
        expect(hermesStatus?.checks?.[0]?.label).toBe("Hermes CLI");
        expect(hermesStatus?.models?.map((model) => model.id)).toEqual([
          "hermes-env-default",
          "hermes-env-fallback"
        ]);
        expect(hermesStatus?.profiles).toEqual([
          { id: "ceo", label: "ceo", alias: "hw-ceo", modelId: "hermes-primary-test", isDefault: true },
          { id: "architect", label: "architect", modelId: "hermes-profile-model-test" },
          { id: "researcher", label: "researcher", modelId: "hermes-research-model-test" }
        ]);
      });
    } finally {
      restoreEnv("PATH", previousPath);
      restoreEnv("HIVEWARD_GOOGLE_CLI_DEFAULT_MODEL", previousGoogleDefault);
      restoreEnv("HIVEWARD_GOOGLE_CLI_MODELS", previousGoogleModels);
      restoreEnv("HIVEWARD_CURSOR_DEFAULT_MODEL", previousCursorDefault);
      restoreEnv("HIVEWARD_CURSOR_MODELS", previousCursorModels);
      restoreEnv("HIVEWARD_OPENCODE_DEFAULT_MODEL", previousOpenCodeDefault);
      restoreEnv("HIVEWARD_OPENCODE_MODELS", previousOpenCodeModels);
      restoreEnv("HIVEWARD_HERMES_DEFAULT_MODEL", previousHermesDefault);
      restoreEnv("HIVEWARD_HERMES_MODELS", previousHermesModels);
      restoreEnv("HERMES_HOME", previousHermesHome);
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it("reads Hermes agents and channels, then creates local entries", async () => {
    const fixture = await createStoreFixture();
    const binDir = join(fixture.dir, "bin");
    const hermesHome = join(fixture.dir, "hermes-home");
    const previousPath = process.env.PATH;
    const previousHermesHome = process.env.HERMES_HOME;
    mkdirSync(binDir, { recursive: true });
    mkdirSync(hermesHome, { recursive: true });
    mkdirSync(join(hermesHome, "skills", "hiveward-leader"), { recursive: true });
    mkdirSync(join(hermesHome, "profiles", "ceo", "skills", "hiveward-ceo"), { recursive: true });
    mkdirSync(join(hermesHome, "profiles", "ceo"), { recursive: true });
    writeFileSync(join(hermesHome, "config.yaml"), [
      "model:",
      "  default: hermes-primary-test",
      "  provider: custom:test-primary",
      "fallback_providers:",
      "  - provider: custom:test-fallback",
      "    model: hermes-fallback-test",
      "terminal:",
      "  cwd: ."
    ].join("\n"));
    writeFileSync(join(hermesHome, "profiles", "ceo", "config.yaml"), [
      "model:",
      "  default: claude-sonnet-4",
      "  provider: anthropic",
      "terminal:",
      `  cwd: ${join(fixture.dir, "ceo-workspace")}`
    ].join("\n"));
    writeFileSync(join(hermesHome, "skills", "hiveward-leader", "SKILL.md"), "# Leader\n");
    writeFileSync(join(hermesHome, "profiles", "ceo", "skills", "hiveward-ceo", "SKILL.md"), "# CEO\n");
    writeFileSync(join(hermesHome, "channel_directory.json"), JSON.stringify({
      updated_at: "2026-05-01T00:00:00.000Z",
      platforms: {
        feishu: [
          { id: "channel_demo", name: "Demo Group", type: "group", thread_id: null }
        ]
      }
    }));
    writeFileSync(join(hermesHome, "profiles", "ceo", "channel_directory.json"), JSON.stringify({
      updated_at: "2026-05-01T00:00:00.000Z",
      platforms: {
        feishu: [
          { id: "profile_room", name: "CEO Room", type: "group", thread_id: "thread-1" }
        ]
      }
    }));
    writeFakeHermesExecutable(join(binDir, "hermes"), {
      allowProfileWrites: true,
      profileRows: [
        " Profile          Model                        Gateway      Alias        Distribution",
        "\u25c6ceo             hermes-primary-test            stopped      hermes-ceo   \u2014"
      ]
    });
    process.env.PATH = `${binDir}${delimiter}${previousPath ?? ""}`;
    process.env.HERMES_HOME = hermesHome;

    try {
      await withApiServer(fixture.store, async (baseUrl) => {
        const initialResponse = await fetch(`${baseUrl}/api/hermes-config`);
        const initial = await readOkJson<{
          profiles: Array<{ id: string; alias?: string; provider?: string; path?: string; workspace?: string; modelId?: string }>;
          channels: Array<{ profileId?: string; platform: string; id: string; name: string; type?: string }>;
          skills: Array<{ id: string; profileId?: string; path: string }>;
          channelDirectoryPath: string;
        }>(initialResponse);

        expect(initial.profiles).toEqual([
          expect.objectContaining({
            id: "ceo",
            alias: "hermes-ceo",
            modelId: "hermes-primary-test",
            provider: "anthropic",
            path: join(hermesHome, "profiles", "ceo"),
            workspace: join(fixture.dir, "ceo-workspace")
          })
        ]);
        expect(initial.channels).toEqual(expect.arrayContaining([
          expect.objectContaining({ profileId: "default", platform: "feishu", id: "channel_demo", name: "Demo Group", type: "group" }),
          expect.objectContaining({ profileId: "ceo", platform: "feishu", id: "profile_room", name: "CEO Room", type: "group" })
        ]));
        expect(initial.skills).toEqual(expect.arrayContaining([
          expect.objectContaining({ id: "hiveward-leader", path: join(hermesHome, "skills", "hiveward-leader", "SKILL.md") }),
          expect.objectContaining({ id: "hiveward-ceo", profileId: "ceo", path: join(hermesHome, "profiles", "ceo", "skills", "hiveward-ceo", "SKILL.md") })
        ]));
        expect(initial.channelDirectoryPath).toBe(join(hermesHome, "channel_directory.json"));

        const profileResponse = await fetch(`${baseUrl}/api/hermes-config/profiles`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "researcher", description: "Research tasks", cloneFrom: "ceo" })
        });
        expect(profileResponse.status).toBe(201);

        const channelResponse = await fetch(`${baseUrl}/api/hermes-config/channels`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ platform: "slack", id: "C123", name: "ops", type: "group" })
        });
        const channelBody = await readOkJson<{ channels: Array<{ platform: string; id: string; name: string }> }>(channelResponse);
        expect(channelResponse.status).toBe(201);
        expect(channelBody.channels).toEqual(expect.arrayContaining([expect.objectContaining({ platform: "slack", id: "C123", name: "ops" })]));
      });
    } finally {
      restoreEnv("PATH", previousPath);
      restoreEnv("HERMES_HOME", previousHermesHome);
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it("reads Hermes configured models from local config files", async () => {
    const fixture = await createStoreFixture();
    const hermesHome = join(fixture.dir, "hermes-home");
    const previousHermesHome = process.env.HERMES_HOME;
    const previousHermesDefault = process.env.HIVEWARD_HERMES_DEFAULT_MODEL;
    const previousHermesModels = process.env.HIVEWARD_HERMES_MODELS;
    mkdirSync(join(hermesHome, "profiles", "writer"), { recursive: true });
    writeFileSync(join(hermesHome, "config.yaml"), [
      "model:",
      "  default: hermes-primary-test",
      "  provider: custom:test-primary",
      "fallback_providers:",
      "  - provider: custom:test-fallback",
      "    model: hermes-fallback-test"
    ].join("\n"));
    writeFileSync(join(hermesHome, "profiles", "writer", "config.yaml"), [
      "model:",
      "  default: hermes-profile-test",
      "  provider: custom:test-profile"
    ].join("\n"));
    process.env.HERMES_HOME = hermesHome;
    delete process.env.HIVEWARD_HERMES_DEFAULT_MODEL;
    delete process.env.HIVEWARD_HERMES_MODELS;

    try {
      await withApiServer(fixture.store, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/harness-status`);
        const body = await readOkJson<{
          statuses: Array<{ id: string; defaultModelId?: string; models?: Array<{ id: string; provider?: string; isDefault?: boolean }> }>;
        }>(response);
        const hermesStatus = body.statuses.find((status) => status.id === "hermes");

        expect(hermesStatus?.defaultModelId).toBe("hermes-primary-test");
        expect(hermesStatus?.models).toEqual(expect.arrayContaining([
          expect.objectContaining({ id: "hermes-primary-test", provider: "custom:test-primary", isDefault: true }),
          expect.objectContaining({ id: "hermes-fallback-test", provider: "custom:test-fallback" }),
          expect.objectContaining({ id: "hermes-profile-test", provider: "custom:test-profile" })
        ]));
      });
    } finally {
      restoreEnv("HERMES_HOME", previousHermesHome);
      restoreEnv("HIVEWARD_HERMES_DEFAULT_MODEL", previousHermesDefault);
      restoreEnv("HIVEWARD_HERMES_MODELS", previousHermesModels);
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it("accepts Claude Code auth from local settings env when reporting harness status", async () => {
    const fixture = await createStoreFixture();
    const claudeHome = join(fixture.dir, "claude-home");
    const previousClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR;
    const previousHivewardClaudeDefault = process.env.HIVEWARD_CLAUDE_CODE_DEFAULT_MODEL;
    const previousClaudeDefault = process.env.CLAUDE_CODE_DEFAULT_MODEL;
    const previousAnthropicApiKey = process.env.ANTHROPIC_API_KEY;
    const previousAnthropicAuthToken = process.env.ANTHROPIC_AUTH_TOKEN;
    const previousClaudeOauthToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;
    process.env.CLAUDE_CONFIG_DIR = claudeHome;
    delete process.env.HIVEWARD_CLAUDE_CODE_DEFAULT_MODEL;
    delete process.env.CLAUDE_CODE_DEFAULT_MODEL;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;

    mkdirSync(claudeHome, { recursive: true });
    writeFileSync(join(claudeHome, "settings.json"), JSON.stringify({
      env: {
        ANTHROPIC_AUTH_TOKEN: "sk-minimax",
        ANTHROPIC_MODEL: "MiniMax-M2.7"
      }
    }));

    try {
      await withApiServer(fixture.store, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/harness-status`);
        const body = await readOkJson<{
          statuses: Array<{
            id: string;
            environmentOk?: boolean;
            connectionState?: string;
            models?: Array<{ id: string }>;
            checks?: Array<{ id: string; status: string; detail: string }>;
          }>;
        }>(response);
        const claudeStatus = body.statuses.find((status) => status.id === "claudeCode");
        const authCheck = claudeStatus?.checks?.find((check) => check.id === "claude-auth");

        expect(claudeStatus?.environmentOk).toBe(true);
        expect(claudeStatus?.connectionState).toBe("available");
        expect(claudeStatus?.models?.map((model) => model.id)).toContain("MiniMax-M2.7");
        expect(authCheck).toMatchObject({ status: "pass" });
        expect(authCheck?.detail).toContain("settings.json");
        expect(authCheck?.detail).toContain("ANTHROPIC_AUTH_TOKEN");
      });
    } finally {
      restoreEnv("CLAUDE_CONFIG_DIR", previousClaudeConfigDir);
      restoreEnv("HIVEWARD_CLAUDE_CODE_DEFAULT_MODEL", previousHivewardClaudeDefault);
      restoreEnv("CLAUDE_CODE_DEFAULT_MODEL", previousClaudeDefault);
      restoreEnv("ANTHROPIC_API_KEY", previousAnthropicApiKey);
      restoreEnv("ANTHROPIC_AUTH_TOKEN", previousAnthropicAuthToken);
      restoreEnv("CLAUDE_CODE_OAUTH_TOKEN", previousClaudeOauthToken);
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it("does not treat a Claude Code model preset as configured auth", async () => {
    const fixture = await createStoreFixture();
    const claudeHome = join(fixture.dir, "claude-home");
    const previousClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR;
    const previousHivewardClaudeDefault = process.env.HIVEWARD_CLAUDE_CODE_DEFAULT_MODEL;
    const previousClaudeDefault = process.env.CLAUDE_CODE_DEFAULT_MODEL;
    const previousAnthropicApiKey = process.env.ANTHROPIC_API_KEY;
    const previousAnthropicAuthToken = process.env.ANTHROPIC_AUTH_TOKEN;
    const previousClaudeOauthToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;
    process.env.CLAUDE_CONFIG_DIR = claudeHome;
    delete process.env.HIVEWARD_CLAUDE_CODE_DEFAULT_MODEL;
    delete process.env.CLAUDE_CODE_DEFAULT_MODEL;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;

    mkdirSync(claudeHome, { recursive: true });
    writeFileSync(join(claudeHome, "settings.json"), JSON.stringify({
      env: {
        ANTHROPIC_BASE_URL: "https://api.deepseek.com/anthropic",
        ANTHROPIC_MODEL: "deepseek-v4-pro",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "deepseek-v4-flash",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "deepseek-v4-pro",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "deepseek-v4-pro"
      }
    }));

    try {
      await withApiServer(fixture.store, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/harness-status`);
        const body = await readOkJson<{
          statuses: Array<{
            id: string;
            environmentOk?: boolean;
            connectionState?: string;
            checks?: Array<{ id: string; status: string; detail: string }>;
          }>;
        }>(response);
        const claudeStatus = body.statuses.find((status) => status.id === "claudeCode");
        const authCheck = claudeStatus?.checks?.find((check) => check.id === "claude-auth");

        expect(claudeStatus?.environmentOk).toBe(false);
        expect(claudeStatus?.connectionState).toBe("needs_config");
        expect(authCheck).toMatchObject({ status: "fail" });
        expect(authCheck?.detail).not.toContain("settings.json");
        expect(authCheck?.detail).not.toContain("Detected:");
      });
    } finally {
      restoreEnv("CLAUDE_CONFIG_DIR", previousClaudeConfigDir);
      restoreEnv("HIVEWARD_CLAUDE_CODE_DEFAULT_MODEL", previousHivewardClaudeDefault);
      restoreEnv("CLAUDE_CODE_DEFAULT_MODEL", previousClaudeDefault);
      restoreEnv("ANTHROPIC_API_KEY", previousAnthropicApiKey);
      restoreEnv("ANTHROPIC_AUTH_TOKEN", previousAnthropicAuthToken);
      restoreEnv("CLAUDE_CODE_OAUTH_TOKEN", previousClaudeOauthToken);
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it("reads Claude Code model config from local settings", async () => {
    const fixture = await createStoreFixture();
    const claudeHome = join(fixture.dir, "claude-home");
    const previousClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = claudeHome;

    mkdirSync(claudeHome, { recursive: true });
    writeFileSync(join(claudeHome, "settings.json"), JSON.stringify({
      env: {
        ANTHROPIC_MODEL: "fallback-model",
        ANTHROPIC_SMALL_FAST_MODEL: "legacy-small",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "sonnet-model",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "opus-model",
        ANTHROPIC_DEFAULT_OPUS_MODEL_NAME: "Opus Model"
      },
      permissions: { allow: ["Bash(ls)"] }
    }));

    try {
      await withApiServer(fixture.store, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/claude-code-config/models`);
        const body = await readOkJson<{
          config: {
            configPath: string;
            fallbackModelId?: string;
            haikuModelId?: string;
            sonnetModelId?: string;
            opusModelId?: string;
            opusModelName?: string;
          };
        }>(response);

        expect(body.config.configPath).toBe(join(claudeHome, "settings.json"));
        expect(body.config.fallbackModelId).toBe("fallback-model");
        expect(body.config.haikuModelId).toBe("legacy-small");
        expect(body.config.sonnetModelId).toBe("sonnet-model");
        expect(body.config.opusModelId).toBe("opus-model");
        expect(body.config.opusModelName).toBe("Opus Model");
      });
    } finally {
      restoreEnv("CLAUDE_CONFIG_DIR", previousClaudeConfigDir);
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it("reports Claude Code model presets from the CCSwitch-style catalog", async () => {
    const fixture = await createStoreFixture();
    try {
      await withApiServer(fixture.store, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/claude-code-config/models`);
        const body = await readOkJson<{
          presets?: Array<{
            id: string;
            name: string;
            category: string;
            baseUrl?: string;
            sonnetModelId?: string;
            modelOptions?: string[];
          }>;
        }>(response);

        expect(body.presets?.length).toBeGreaterThanOrEqual(12);
        expect(body.presets).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: "deepseek",
              name: "DeepSeek",
              category: "cn_official",
              baseUrl: "https://api.deepseek.com/anthropic",
              sonnetModelId: "deepseek-v4-pro"
            }),
            expect.objectContaining({
              id: "kimi",
              name: "Kimi",
              category: "cn_official",
              baseUrl: "https://api.moonshot.cn/anthropic",
              sonnetModelId: "kimi-k2.6"
            }),
            expect.objectContaining({
              id: "minimax-cn",
              name: "MiniMax",
              category: "cn_official",
              baseUrl: "https://api.minimaxi.com/anthropic",
              sonnetModelId: "MiniMax-M2.7",
              modelOptions: expect.arrayContaining(["MiniMax-M2.7", "MiniMax-M2.7-highspeed", "MiniMax-M2.5"])
            }),
            expect.objectContaining({
              id: "xiaomi-mimo",
              name: "Xiaomi MiMo",
              modelOptions: ["mimo-v2.5-pro", "mimo-v2.5", "mimo-v2-pro", "mimo-v2-omni", "mimo-v2-flash"]
            })
          ])
        );
      });
    } finally {
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it("writes Claude Code model config while preserving unrelated settings", async () => {
    const fixture = await createStoreFixture();
    const claudeHome = join(fixture.dir, "claude-home");
    const previousClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = claudeHome;

    mkdirSync(claudeHome, { recursive: true });
    writeFileSync(join(claudeHome, "settings.json"), JSON.stringify({
      env: {
        ANTHROPIC_MODEL: "old-fallback",
        ANTHROPIC_SMALL_FAST_MODEL: "old-small",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "old-sonnet",
        ANTHROPIC_DEFAULT_SONNET_MODEL_NAME: "Old Sonnet",
        ANTHROPIC_API_KEY: "sk-preserved"
      },
      permissions: { allow: ["Bash(ls)"] }
    }));

    try {
      await withApiServer(fixture.store, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/claude-code-config/models`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            fallbackModelId: "next-fallback",
            haikuModelId: "next-haiku",
            sonnetModelId: "next-sonnet",
            sonnetModelName: "Next Sonnet",
            opusModelId: "next-opus"
          })
        });
        const body = await readOkJson<{
          config: {
            fallbackModelId?: string;
            haikuModelId?: string;
            sonnetModelId?: string;
            sonnetModelName?: string;
            opusModelId?: string;
          };
        }>(response);

        expect(body.config).toMatchObject({
          fallbackModelId: "next-fallback",
          haikuModelId: "next-haiku",
          sonnetModelId: "next-sonnet",
          sonnetModelName: "Next Sonnet",
          opusModelId: "next-opus"
        });

        const settings = JSON.parse(readFileSync(join(claudeHome, "settings.json"), "utf8"));
        expect(settings.env).toMatchObject({
          ANTHROPIC_MODEL: "next-fallback",
          ANTHROPIC_DEFAULT_HAIKU_MODEL: "next-haiku",
          ANTHROPIC_DEFAULT_SONNET_MODEL: "next-sonnet",
          ANTHROPIC_DEFAULT_SONNET_MODEL_NAME: "Next Sonnet",
          ANTHROPIC_DEFAULT_OPUS_MODEL: "next-opus",
          ANTHROPIC_API_KEY: "sk-preserved"
        });
        expect(settings.env).not.toHaveProperty("ANTHROPIC_SMALL_FAST_MODEL");
        expect(settings.permissions).toEqual({ allow: ["Bash(ls)"] });
      });
    } finally {
      restoreEnv("CLAUDE_CONFIG_DIR", previousClaudeConfigDir);
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it("applies a Claude Code model preset without creating a token", async () => {
    const fixture = await createStoreFixture();
    const claudeHome = join(fixture.dir, "claude-home");
    const previousClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = claudeHome;

    mkdirSync(claudeHome, { recursive: true });
    writeFileSync(join(claudeHome, "settings.json"), JSON.stringify({
      env: {
        ANTHROPIC_AUTH_TOKEN: "sk-preserved",
        ANTHROPIC_BASE_URL: "https://api.deepseek.com/anthropic",
        ANTHROPIC_MODEL: "deepseek-v4-pro",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "deepseek-v4-flash",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "deepseek-v4-pro",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "deepseek-v4-pro"
      },
      permissions: { allow: ["Bash(ls)"] }
    }));

    try {
      await withApiServer(fixture.store, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/claude-code-config/models`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ presetId: "deepseek" })
        });
        const body = await readOkJson<{
          config: {
            providerPresetId?: string;
            baseUrl?: string;
            fallbackModelId?: string;
            haikuModelId?: string;
            sonnetModelId?: string;
            opusModelId?: string;
          };
        }>(response);

        expect(body.config).toMatchObject({
          providerPresetId: "deepseek",
          baseUrl: "https://api.deepseek.com/anthropic",
          fallbackModelId: "deepseek-v4-pro",
          haikuModelId: "deepseek-v4-flash",
          sonnetModelId: "deepseek-v4-pro",
          opusModelId: "deepseek-v4-pro"
        });

        const settings = JSON.parse(readFileSync(join(claudeHome, "settings.json"), "utf8"));
        expect(settings.env).toMatchObject({
          ANTHROPIC_BASE_URL: "https://api.deepseek.com/anthropic",
          ANTHROPIC_AUTH_TOKEN: "sk-preserved",
          ANTHROPIC_MODEL: "deepseek-v4-pro",
          ANTHROPIC_DEFAULT_HAIKU_MODEL: "deepseek-v4-flash",
          ANTHROPIC_DEFAULT_SONNET_MODEL: "deepseek-v4-pro",
          ANTHROPIC_DEFAULT_OPUS_MODEL: "deepseek-v4-pro"
        });
        expect(settings.env.ANTHROPIC_API_KEY).toBeUndefined();
        expect(settings.permissions).toEqual({ allow: ["Bash(ls)"] });
      });
    } finally {
      restoreEnv("CLAUDE_CONFIG_DIR", previousClaudeConfigDir);
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it("rejects switching Claude Code presets without the new provider token", async () => {
    const fixture = await createStoreFixture();
    const claudeHome = join(fixture.dir, "claude-home");
    const previousClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = claudeHome;

    mkdirSync(claudeHome, { recursive: true });
    writeFileSync(join(claudeHome, "settings.json"), JSON.stringify({
      env: {
        ANTHROPIC_AUTH_TOKEN: "sk-kimi",
        ANTHROPIC_BASE_URL: "https://api.moonshot.cn/anthropic",
        ANTHROPIC_MODEL: "kimi-k2.6",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "kimi-k2.6",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "kimi-k2.6",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "kimi-k2.6"
      },
      permissions: { allow: ["Bash(ls)"] }
    }));

    try {
      await withApiServer(fixture.store, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/claude-code-config/models`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ presetId: "minimax-global" })
        });
        const body = await response.json() as { error?: { code?: string; message?: string } };

        expect(response.status).toBe(400);
        expect(body.error).toMatchObject({
          code: "claude_code_auth_required"
        });

        const settings = JSON.parse(readFileSync(join(claudeHome, "settings.json"), "utf8"));
        expect(settings.env).toMatchObject({
          ANTHROPIC_AUTH_TOKEN: "sk-kimi",
          ANTHROPIC_BASE_URL: "https://api.moonshot.cn/anthropic",
          ANTHROPIC_MODEL: "kimi-k2.6"
        });
      });
    } finally {
      restoreEnv("CLAUDE_CONFIG_DIR", previousClaudeConfigDir);
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it("rejects applying a Claude Code model preset without an auth token", async () => {
    const fixture = await createStoreFixture();
    const claudeHome = join(fixture.dir, "claude-home");
    const previousClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = claudeHome;

    mkdirSync(claudeHome, { recursive: true });
    writeFileSync(join(claudeHome, "settings.json"), JSON.stringify({
      env: {},
      permissions: { allow: ["Bash(ls)"] }
    }));

    try {
      await withApiServer(fixture.store, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/claude-code-config/models`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ presetId: "deepseek" })
        });
        const body = await response.json() as { error?: { code?: string; message?: string } };

        expect(response.status).toBe(400);
        expect(body.error).toMatchObject({
          code: "claude_code_auth_required"
        });
        expect(body.error?.message).toContain("API key");

        const settings = JSON.parse(readFileSync(join(claudeHome, "settings.json"), "utf8"));
        expect(settings.env).toEqual({});
        expect(settings.permissions).toEqual({ allow: ["Bash(ls)"] });
      });
    } finally {
      restoreEnv("CLAUDE_CONFIG_DIR", previousClaudeConfigDir);
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it("applies a Claude Code model preset with a provided auth token", async () => {
    const fixture = await createStoreFixture();
    const claudeHome = join(fixture.dir, "claude-home");
    const previousClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = claudeHome;

    mkdirSync(claudeHome, { recursive: true });
    writeFileSync(join(claudeHome, "settings.json"), JSON.stringify({
      env: {},
      permissions: { allow: ["Bash(ls)"] }
    }));

    try {
      await withApiServer(fixture.store, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/claude-code-config/models`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            presetId: "deepseek",
            authEnvKey: "ANTHROPIC_AUTH_TOKEN",
            authValue: "sk-deepseek"
          })
        });
        const body = await readOkJson<{
          config: {
            authConfigured?: boolean;
            authEnvKey?: string;
            providerPresetId?: string;
          };
        }>(response);

        expect(body.config).toMatchObject({
          authConfigured: true,
          authEnvKey: "ANTHROPIC_AUTH_TOKEN",
          providerPresetId: "deepseek"
        });

        const settings = JSON.parse(readFileSync(join(claudeHome, "settings.json"), "utf8"));
        expect(settings.env).toMatchObject({
          ANTHROPIC_AUTH_TOKEN: "sk-deepseek",
          ANTHROPIC_BASE_URL: "https://api.deepseek.com/anthropic",
          ANTHROPIC_MODEL: "deepseek-v4-pro"
        });
      });
    } finally {
      restoreEnv("CLAUDE_CONFIG_DIR", previousClaudeConfigDir);
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it("uses CC Switch preset auth fields and plan metadata when writing Claude Code settings", async () => {
    const fixture = await createStoreFixture();
    const claudeHome = join(fixture.dir, "claude-home");
    const previousClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = claudeHome;

    mkdirSync(claudeHome, { recursive: true });
    writeFileSync(join(claudeHome, "settings.json"), JSON.stringify({
      env: {
        ANTHROPIC_AUTH_TOKEN: "stale-bearer-token",
        ANTHROPIC_BASE_URL: "https://api.deepseek.com/anthropic"
      }
    }));

    try {
      await withApiServer(fixture.store, async (baseUrl) => {
        const listResponse = await fetch(`${baseUrl}/api/claude-code-config/models`);
        const listBody = await readOkJson<{
          presets: Array<{
            id: string;
            authEnvKey?: string;
            baseUrl?: string;
            planType?: string;
            planProvider?: string;
          }>;
        }>(listResponse);

        expect(listBody.presets.find((preset) => preset.id === "pateway-ai")).toMatchObject({
          authEnvKey: "ANTHROPIC_API_KEY",
          baseUrl: "https://api.pateway.ai"
        });
        expect(listBody.presets.find((preset) => preset.id === "aihubmix")).toMatchObject({
          authEnvKey: "ANTHROPIC_API_KEY",
          baseUrl: "https://aihubmix.com"
        });
        expect(listBody.presets.find((preset) => preset.id === "minimax-cn")).toMatchObject({
          planType: "coding_plan",
          planProvider: "minimax"
        });
        expect(listBody.presets.find((preset) => preset.id === "xiaomi-mimo-token-plan-cn")).toMatchObject({
          planType: "token_plan",
          planProvider: "xiaomi_mimo"
        });

        const response = await fetch(`${baseUrl}/api/claude-code-config/models`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            presetId: "pateway-ai",
            authEnvKey: "ANTHROPIC_AUTH_TOKEN",
            authValue: "sk-pateway"
          })
        });
        const body = await readOkJson<{
          config: {
            authConfigured?: boolean;
            authEnvKey?: string;
            providerPresetId?: string;
          };
        }>(response);

        expect(body.config).toMatchObject({
          authConfigured: true,
          authEnvKey: "ANTHROPIC_API_KEY",
          providerPresetId: "pateway-ai"
        });

        const settings = JSON.parse(readFileSync(join(claudeHome, "settings.json"), "utf8"));
        expect(settings.env).toMatchObject({
          ANTHROPIC_API_KEY: "sk-pateway",
          ANTHROPIC_BASE_URL: "https://api.pateway.ai"
        });
        expect(settings.env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
      });
    } finally {
      restoreEnv("CLAUDE_CONFIG_DIR", previousClaudeConfigDir);
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it("applies Claude Code preset defaults while allowing selected model overrides", async () => {
    const fixture = await createStoreFixture();
    const claudeHome = join(fixture.dir, "claude-home");
    const previousClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = claudeHome;

    mkdirSync(claudeHome, { recursive: true });
    writeFileSync(join(claudeHome, "settings.json"), JSON.stringify({
      env: {},
      permissions: { allow: ["Bash(ls)"] }
    }));

    try {
      await withApiServer(fixture.store, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/claude-code-config/models`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            presetId: "minimax-global",
            authEnvKey: "ANTHROPIC_AUTH_TOKEN",
            authValue: "sk-minimax",
            fallbackModelId: "MiniMax-M2.7",
            haikuModelId: "",
            sonnetModelId: "",
            opusModelId: ""
          })
        });
        const body = await readOkJson<{
          config: {
            providerPresetId?: string;
            baseUrl?: string;
            fallbackModelId?: string;
            haikuModelId?: string;
            sonnetModelId?: string;
            opusModelId?: string;
          };
        }>(response);

        expect(body.config).toMatchObject({
          providerPresetId: "minimax-global",
          baseUrl: "https://api.minimax.io/anthropic",
          fallbackModelId: "MiniMax-M2.7",
          haikuModelId: "MiniMax-M2.7",
          sonnetModelId: "MiniMax-M2.7",
          opusModelId: "MiniMax-M2.7"
        });

        const settings = JSON.parse(readFileSync(join(claudeHome, "settings.json"), "utf8"));
        expect(settings.env).toMatchObject({
          ANTHROPIC_AUTH_TOKEN: "sk-minimax",
          ANTHROPIC_BASE_URL: "https://api.minimax.io/anthropic",
          ANTHROPIC_MODEL: "MiniMax-M2.7",
          ANTHROPIC_DEFAULT_HAIKU_MODEL: "MiniMax-M2.7",
          ANTHROPIC_DEFAULT_SONNET_MODEL: "MiniMax-M2.7",
          ANTHROPIC_DEFAULT_OPUS_MODEL: "MiniMax-M2.7"
        });
      });
    } finally {
      restoreEnv("CLAUDE_CONFIG_DIR", previousClaudeConfigDir);
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it("forces preset auth env and clears stale alternate Claude Code auth when switching providers", async () => {
    const fixture = await createStoreFixture();
    const claudeHome = join(fixture.dir, "claude-home");
    const previousClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = claudeHome;

    mkdirSync(claudeHome, { recursive: true });
    writeFileSync(join(claudeHome, "settings.json"), JSON.stringify({
      env: {
        ANTHROPIC_AUTH_TOKEN: "sk-minimax-old",
        ANTHROPIC_API_KEY: "sk-api-old",
        ANTHROPIC_BASE_URL: "https://api.minimax.io/anthropic",
        ANTHROPIC_MODEL: "MiniMax-M2.7"
      },
      permissions: { allow: ["Bash(ls)"] }
    }));

    try {
      await withApiServer(fixture.store, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/claude-code-config/models`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            presetId: "deepseek",
            authEnvKey: "ANTHROPIC_API_KEY",
            authValue: "sk-deepseek"
          })
        });
        const body = await readOkJson<{
          config: {
            authConfigured?: boolean;
            authEnvKey?: string;
            providerPresetId?: string;
          };
        }>(response);

        expect(body.config).toMatchObject({
          authConfigured: true,
          authEnvKey: "ANTHROPIC_AUTH_TOKEN",
          providerPresetId: "deepseek"
        });

        const settings = JSON.parse(readFileSync(join(claudeHome, "settings.json"), "utf8"));
        expect(settings.env).toMatchObject({
          ANTHROPIC_AUTH_TOKEN: "sk-deepseek",
          ANTHROPIC_BASE_URL: "https://api.deepseek.com/anthropic",
          ANTHROPIC_MODEL: "deepseek-v4-pro",
          ANTHROPIC_DEFAULT_HAIKU_MODEL: "deepseek-v4-flash",
          ANTHROPIC_DEFAULT_SONNET_MODEL: "deepseek-v4-pro",
          ANTHROPIC_DEFAULT_OPUS_MODEL: "deepseek-v4-pro"
        });
        expect(settings.env.ANTHROPIC_API_KEY).toBeUndefined();
      });
    } finally {
      restoreEnv("CLAUDE_CONFIG_DIR", previousClaudeConfigDir);
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it("does not treat conflicting Claude Code auth envs as reusable preset auth", async () => {
    const fixture = await createStoreFixture();
    const claudeHome = join(fixture.dir, "claude-home");
    const previousClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = claudeHome;

    mkdirSync(claudeHome, { recursive: true });
    writeFileSync(join(claudeHome, "settings.json"), JSON.stringify({
      env: {
        ANTHROPIC_AUTH_TOKEN: "sk-minimax-old",
        ANTHROPIC_API_KEY: "sk-deepseek-new",
        ANTHROPIC_BASE_URL: "https://api.deepseek.com/anthropic",
        ANTHROPIC_MODEL: "deepseek-v4-pro",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "deepseek-v4-flash",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "deepseek-v4-pro",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "deepseek-v4-pro"
      }
    }));

    try {
      await withApiServer(fixture.store, async (baseUrl) => {
        const readResponse = await fetch(`${baseUrl}/api/claude-code-config/models`);
        const readBody = await readOkJson<{
          config: {
            authConfigured?: boolean;
            authEnvKey?: string;
            providerPresetId?: string;
          };
        }>(readResponse);

        expect(readBody.config).toMatchObject({
          authConfigured: false,
          authEnvKey: "ANTHROPIC_AUTH_TOKEN",
          providerPresetId: "deepseek"
        });

        const updateResponse = await fetch(`${baseUrl}/api/claude-code-config/models`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ presetId: "deepseek" })
        });
        const updateBody = await updateResponse.json() as { error?: { code?: string } };

        expect(updateResponse.status).toBe(400);
        expect(updateBody.error?.code).toBe("claude_code_auth_required");
      });
    } finally {
      restoreEnv("CLAUDE_CONFIG_DIR", previousClaudeConfigDir);
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it("keeps preset model defaults when the Claude Code form submits empty model overrides", async () => {
    const fixture = await createStoreFixture();
    const claudeHome = join(fixture.dir, "claude-home");
    const previousClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = claudeHome;

    mkdirSync(claudeHome, { recursive: true });
    writeFileSync(join(claudeHome, "settings.json"), JSON.stringify({
      env: {},
      permissions: { allow: ["Bash(ls)"] }
    }));

    try {
      await withApiServer(fixture.store, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/claude-code-config/models`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            presetId: "deepseek",
            authEnvKey: "ANTHROPIC_AUTH_TOKEN",
            authValue: "sk-deepseek",
            fallbackModelId: "",
            haikuModelId: "",
            sonnetModelId: "",
            opusModelId: ""
          })
        });
        const body = await readOkJson<{
          config: {
            fallbackModelId?: string;
            haikuModelId?: string;
            sonnetModelId?: string;
            opusModelId?: string;
          };
        }>(response);

        expect(body.config).toMatchObject({
          fallbackModelId: "deepseek-v4-pro",
          haikuModelId: "deepseek-v4-flash",
          sonnetModelId: "deepseek-v4-pro",
          opusModelId: "deepseek-v4-pro"
        });

        const settings = JSON.parse(readFileSync(join(claudeHome, "settings.json"), "utf8"));
        expect(settings.env).toMatchObject({
          ANTHROPIC_MODEL: "deepseek-v4-pro",
          ANTHROPIC_DEFAULT_HAIKU_MODEL: "deepseek-v4-flash",
          ANTHROPIC_DEFAULT_SONNET_MODEL: "deepseek-v4-pro",
          ANTHROPIC_DEFAULT_OPUS_MODEL: "deepseek-v4-pro"
        });
      });
    } finally {
      restoreEnv("CLAUDE_CONFIG_DIR", previousClaudeConfigDir);
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it("saves the current Claude Code model profile without exposing the API key", async () => {
    const fixture = await createStoreFixture();
    const claudeHome = join(fixture.dir, "claude-home");
    const previousClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = claudeHome;

    mkdirSync(claudeHome, { recursive: true });
    writeFileSync(join(claudeHome, "settings.json"), JSON.stringify({
      env: {
        ANTHROPIC_AUTH_TOKEN: "sk-deepseek",
        ANTHROPIC_BASE_URL: "https://api.deepseek.com/anthropic",
        ANTHROPIC_MODEL: "deepseek-v4-pro",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "deepseek-v4-flash",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "deepseek-v4-pro",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "deepseek-v4-pro"
      }
    }));

    try {
      await withApiServer(fixture.store, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/claude-code-config/model-profiles`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "DeepSeek saved" })
        });
        const body = await readOkJson<{
          savedProfiles: Array<{
            id: string;
            name: string;
            authConfigured?: boolean;
            providerPresetId?: string;
            authValue?: string;
          }>;
        }>(response);

        expect(body.savedProfiles).toHaveLength(1);
        expect(body.savedProfiles[0]).toMatchObject({
          name: "DeepSeek saved",
          authConfigured: true,
          providerPresetId: "deepseek"
        });
        expect(body.savedProfiles[0]).not.toHaveProperty("authValue");

        const profileStore = JSON.parse(readFileSync(join(claudeHome, "hiveward-model-profiles.json"), "utf8")) as {
          profiles: Array<{ authValue?: string }>;
        };
        expect(profileStore.profiles[0]?.authValue).toBe("sk-deepseek");
      });
    } finally {
      restoreEnv("CLAUDE_CONFIG_DIR", previousClaudeConfigDir);
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it("applies a saved Claude Code model profile for quick switching", async () => {
    const fixture = await createStoreFixture();
    const claudeHome = join(fixture.dir, "claude-home");
    const previousClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = claudeHome;

    mkdirSync(claudeHome, { recursive: true });
    writeFileSync(join(claudeHome, "settings.json"), JSON.stringify({
      env: {
        ANTHROPIC_AUTH_TOKEN: "sk-deepseek",
        ANTHROPIC_BASE_URL: "https://api.deepseek.com/anthropic",
        ANTHROPIC_MODEL: "deepseek-v4-pro",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "deepseek-v4-flash",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "deepseek-v4-pro",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "deepseek-v4-pro"
      }
    }));

    try {
      await withApiServer(fixture.store, async (baseUrl) => {
        const saveResponse = await fetch(`${baseUrl}/api/claude-code-config/model-profiles`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "DeepSeek saved" })
        });
        const saved = await readOkJson<{ savedProfiles: Array<{ id: string; providerPresetId?: string }> }>(saveResponse);
        const deepseekProfileId = saved.savedProfiles.find((profile) => profile.providerPresetId === "deepseek")?.id;
        expect(deepseekProfileId).toBeTruthy();

        await readOkJson(await fetch(`${baseUrl}/api/claude-code-config/models`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            presetId: "minimax-global",
            authEnvKey: "ANTHROPIC_AUTH_TOKEN",
            authValue: "sk-minimax"
          })
        }));

        const applyResponse = await fetch(`${baseUrl}/api/claude-code-config/model-profiles/${deepseekProfileId}/apply`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({})
        });
        const applied = await readOkJson<{
          config: { providerPresetId?: string; authConfigured?: boolean; fallbackModelId?: string };
          savedProfiles: Array<{ providerPresetId?: string }>;
        }>(applyResponse);

        expect(applied.config).toMatchObject({
          providerPresetId: "deepseek",
          authConfigured: true,
          fallbackModelId: "deepseek-v4-pro"
        });
        expect(applied.savedProfiles).toEqual(expect.arrayContaining([
          expect.objectContaining({ providerPresetId: "minimax-global" })
        ]));

        const settings = JSON.parse(readFileSync(join(claudeHome, "settings.json"), "utf8"));
        expect(settings.env).toMatchObject({
          ANTHROPIC_AUTH_TOKEN: "sk-deepseek",
          ANTHROPIC_BASE_URL: "https://api.deepseek.com/anthropic",
          ANTHROPIC_MODEL: "deepseek-v4-pro"
        });
        expect(settings.env.ANTHROPIC_API_KEY).toBeUndefined();
      });
    } finally {
      restoreEnv("CLAUDE_CONFIG_DIR", previousClaudeConfigDir);
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it("reports and installs HiveWard skills into the OpenClaw workspace skill root", async () => {
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
          expect(initialBody.installRoot).toBe(join(openClawHome, "workspace", "skills"));
          expect(initialBody.installCandidates?.find((candidate) => candidate.selected)).toMatchObject({
            root: join(openClawHome, "workspace", "skills"),
            source: "environment",
            hasHiveWardSkills: false
          });
          expect(initialBody.skills.map((skill) => skill.status)).toEqual(["missing", "missing", "missing"]);

          const installResponse = await fetch(`${baseUrl}/api/harness-skills/openclaw/install`, {
            method: "POST"
          });
          const installBody = await readOkJson<{
            installedCount: number;
            installCandidates?: Array<{ root: string; source: string; selected: boolean; hasHiveWardSkills: boolean }>;
            skills: Array<{ id: string; status: string; installed: boolean }>;
          }>(installResponse);

          expect(installBody.installedCount).toBe(3);
          expect(installBody.skills.map((skill) => [skill.id, skill.status, skill.installed])).toEqual([
            ["hiveward-ceo", "installed", true],
            ["hiveward-leader", "installed", true],
            ["hiveward-skill-decomposer", "installed", true]
          ]);
          expect(installBody.installCandidates?.find((candidate) => candidate.selected)).toMatchObject({
            root: join(openClawHome, "workspace", "skills"),
            source: "environment",
            hasHiveWardSkills: true
          });
          expect(existsSync(join(openClawHome, "workspace", "skills", "hiveward-ceo", "SKILL.md"))).toBe(true);
          expect(existsSync(join(openClawHome, "workspace", "skills", "hiveward-leader", "SKILL.md"))).toBe(true);
          expect(existsSync(join(openClawHome, "workspace", "skills", "hiveward-skill-decomposer", "SKILL.md"))).toBe(true);
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

          expect(installBody.installedCount).toBe(3);
          expect(installBody.skills.map((skill) => [skill.id, skill.status, skill.installed])).toEqual([
            ["hiveward-ceo", "installed", true],
            ["hiveward-leader", "installed", true],
            ["hiveward-skill-decomposer", "installed", true]
          ]);
          expect(installBody.installCandidates?.find((candidate) => candidate.selected)).toMatchObject({
            root: join(root, "skills"),
            source: "environment",
            hasHiveWardSkills: true
          });
          expect(existsSync(join(root, "skills", "hiveward-ceo", "SKILL.md"))).toBe(true);
          expect(existsSync(join(root, "skills", "hiveward-leader", "SKILL.md"))).toBe(true);
          expect(existsSync(join(root, "skills", "hiveward-skill-decomposer", "SKILL.md"))).toBe(true);
        }
      });
    } finally {
      restoreEnv("CODEX_HOME", previousCodexHome);
      restoreEnv("CLAUDE_CONFIG_DIR", previousClaudeConfigDir);
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it("streams native chat responses through the runtime adapter", async () => {
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
        expect(text).toContain("event: message_started");
        expect(text).toContain("event: message_delta");
        expect(text).toContain("event: message_completed");
        expect(text).toContain("main completed through runtime adapter");
        expect(adapter.lastStartInput).toBeUndefined();
        expect(adapter.lastChatStreamInput?.sessionKey).toBe("main");
        expect(adapter.lastChatStreamInput?.message).toContain("System context:");
        expect(adapter.lastChatStreamInput?.message).toContain("HiveWard is a local company operations console");
        expect(adapter.lastChatStreamInput?.message).toContain("selected harness owns runtime execution");
        expect(adapter.lastChatStreamInput?.message).not.toContain("OpenClaw owns runtime execution");
        expect(adapter.lastChatStreamInput?.message).not.toContain("OpenClaw-native tools");
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

  it("streams a narrow OpenClaw connection error when Gateway is not configured", async () => {
    const fixture = await createStoreFixture();
    const adapter = new OpenClawGatewayNotConfiguredAdapter();
    try {
      await withApiServer(fixture.store, async (baseUrl) => {
        const response = await streamSessionChat(baseUrl, {
          harnessId: "openclaw",
          message: "Say hello from chat.",
          attachments: [],
          modelId: "openclaw/default",
          agentId: "main",
          thinkingEffort: "medium"
        });
        const text = await response.text();

        expect(response.status, text).toBe(200);
        expect(text).toContain("event: message_failed");
        expect(text).toContain("\"code\":\"openclaw_gateway_not_configured\"");
        expect(text).toContain("OpenClaw Gateway is not configured.");
        expect(text).not.toContain("completed through runtime adapter");
      }, adapter);
    } finally {
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it("does not pass native chat skills to a harness when those skills are not installed", async () => {
    const fixture = await createStoreFixture();
    const adapter = new TrackingAdapter();
    const codexHome = join(fixture.dir, "codex-home");
    const previousCodexHome = process.env.CODEX_HOME;
    mkdirSync(join(codexHome, "skills"), { recursive: true });
    process.env.CODEX_HOME = codexHome;
    try {
      await withApiServer(fixture.store, async (baseUrl) => {
        const response = await streamSessionChat(baseUrl, {
          harnessId: "codex",
          message: "Say hello from Codex chat.",
          attachments: [],
          modelId: "gpt-5.5",
          thinkingEffort: "medium",
          includePlatformContext: true,
          roleScope: {
            role: "ceo"
          }
        });
        const text = await response.text();

        expect(response.status, text).toBe(200);
        expect(adapter.lastChatStreamInput?.source).toBe("codex");
        expect(adapter.lastChatStreamInput?.skillIds).toBeUndefined();
        expect(adapter.lastChatStreamInput?.message).toContain("hiveward-ceo");
      }, adapter);
    } finally {
      restoreEnv("CODEX_HOME", previousCodexHome);
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

  it("forbids historical chat messages from mutating normal chat output", async () => {
    const fixture = await createStoreFixture();
    try {
      const session = await fixture.store.createChatSession({
        harnessId: "codex",
        title: "Historical write guard"
      });

      await expect(
        fixture.store.appendChatMessage({
          sessionId: session.id,
          role: "assistant",
          content: "old output path",
          harnessId: "codex",
          status: "sent"
        })
      ).rejects.toThrow("保留为历史事实，不参与决策");
      expect(await fixture.store.listChatMessages(session.id)).toEqual([]);
      expect(await fixture.store.listAgentOutputEvents({ ownerType: "chat_session", ownerId: session.id })).toEqual([]);
    } finally {
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it("returns 404 for missing run room output resources", async () => {
    const fixture = await createStoreFixture();
    try {
      await withApiServer(fixture.store, async (baseUrl) => {
        const outputResponse = await fetch(`${baseUrl}/api/run-rooms/missing-run-room/output/events`);
        const body = await outputResponse.json() as { error?: { code?: string } };

        expect(outputResponse.status, JSON.stringify(body)).toBe(404);
        expect(body.error?.code).toBe("run_room_not_found");
      });
    } finally {
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it("returns run room output events only from canonical run-room node invocations", async () => {
    const fixture = await createStoreFixture();
    try {
      const createdAt = "2026-06-03T00:00:00.000Z";
      const runRoom = createRunRoomFact({ id: "run-room-output-owner", runId: "run-output-owner" });
      const otherRunRoom = createRunRoomFact({ id: "run-room-other", runId: "run-other" });
      await fixture.store.createRunRoom(runRoom);
      await fixture.store.createRunRoom(otherRunRoom);
      await fixture.store.appendRunInterjection({
        id: "run-interjection-output",
        runRoomId: runRoom.id,
        target: "manager",
        messageMarkdown: "User interjection.",
        createdAt
      });
      await fixture.store.appendAgentOutputEvent({
        id: "run-room-output-1",
        ownerType: "run_room",
        ownerId: runRoom.id,
        actorType: "worker",
        kind: "message_started",
        sequence: 1,
        sourceType: "blueprint_node_run",
        sourceId: "node-run-1",
        bodyMarkdown: "Started output must not create a row.",
        metadata: { runRoomId: runRoom.id },
        createdAt
      });
      await fixture.store.appendAgentOutputEvent({
        id: "message-delta-output",
        ownerType: "run_room",
        ownerId: runRoom.id,
        actorType: "worker",
        kind: "message_delta",
        sequence: 2,
        sourceType: "blueprint_node_run",
        sourceId: "node-run-1",
        delta: "Streaming delta belongs to the invocation.",
        metadata: { runRoomId: runRoom.id },
        createdAt
      });
      await fixture.store.appendAgentOutputEvent({
        id: "completed-output",
        ownerType: "run_room",
        ownerId: runRoom.id,
        actorType: "worker",
        kind: "message_completed",
        sequence: 3,
        sourceType: "blueprint_node_run",
        sourceId: "node-run-1",
        bodyMarkdown: "Final node output.",
        metadata: { runRoomId: runRoom.id },
        createdAt
      });
      await fixture.store.appendAgentOutputEvent({
        id: "old-worker-owner-output",
        ownerType: "worker_task",
        ownerId: "worker-task-output",
        actorType: "worker",
        kind: "message_completed",
        sequence: 1,
        sourceType: "blueprint_node_run",
        sourceId: "node-run-old-owner",
        bodyMarkdown: "Old worker owner must not project.",
        metadata: {
          runRoomId: runRoom.id,
          workerTaskId: "worker-task-output"
        },
        createdAt
      });
      await fixture.store.appendAgentOutputEvent({
        id: "old-manager-owner-output",
        ownerType: "manager_thread",
        ownerId: "manager-thread-output",
        actorType: "manager",
        kind: "message_completed",
        sequence: 1,
        sourceType: "blueprint_node_run",
        sourceId: "node-run-old-manager",
        bodyMarkdown: "Old manager owner must not project.",
        metadata: { runRoomId: runRoom.id },
        createdAt
      });
      await fixture.store.appendAgentOutputEvent({
        id: "old-human-action-owner-output",
        ownerType: "human_action_request",
        ownerId: "human-action-output",
        actorType: "user",
        kind: "message_completed",
        sequence: 1,
        sourceType: "blueprint_node_run",
        sourceId: "node-run-old-human-action",
        bodyMarkdown: "Old human action owner must not project.",
        metadata: { runRoomId: runRoom.id },
        createdAt
      });
      await fixture.store.appendAgentOutputEvent({
        id: "chat-bleed-output",
        ownerType: "chat_session",
        ownerId: "chat-session-feed",
        actorType: "leader",
        kind: "message_completed",
        sequence: 1,
        sourceType: "blueprint_node_run",
        sourceId: "node-run-chat",
        bodyMarkdown: "Chat output must not bleed into run room output.",
        metadata: {
          runRoomId: runRoom.id
        },
        createdAt
      });
      await fixture.store.appendAgentOutputEvent({
        id: "metadata-mismatch-output",
        ownerType: "run_room",
        ownerId: runRoom.id,
        actorType: "worker",
        kind: "message_completed",
        sequence: 4,
        sourceType: "blueprint_node_run",
        sourceId: "node-run-metadata-mismatch",
        bodyMarkdown: "Mismatched metadata must not project.",
        metadata: {
          runRoomId: otherRunRoom.id
        },
        createdAt
      });
      await fixture.store.appendAgentOutputEvent({
        id: "missing-source-output",
        ownerType: "run_room",
        ownerId: runRoom.id,
        actorType: "worker",
        kind: "message_completed",
        sequence: 5,
        sourceType: "blueprint_node_run",
        bodyMarkdown: "Missing source must not project.",
        metadata: { runRoomId: runRoom.id },
        createdAt
      });
      await fixture.store.appendAgentOutputEvent({
        id: "tool-state-output",
        ownerType: "run_room",
        ownerId: runRoom.id,
        actorType: "worker",
        kind: "tool_state",
        sequence: 6,
        sourceType: "blueprint_node_run",
        sourceId: "node-run-tool-state",
        bodyMarkdown: "Tool state must not project until a product meaning exists.",
        metadata: { runRoomId: runRoom.id },
        createdAt
      });

      await withApiServer(fixture.store, async (baseUrl) => {
        const outputResponse = await fetch(`${baseUrl}/api/run-rooms/${runRoom.id}/output/events`);
        const { output } = await readOkJson<{ output: RunRoomOutputSnapshot }>(outputResponse);

        expect(output.runRoomId).toBe(runRoom.id);
        expect(output.events.map((event) => event.id)).toEqual([
          "run-room-output-1",
          "message-delta-output",
          "completed-output"
        ]);
        expect(output.events.map((event) => event.kind)).toEqual([
          "message_started",
          "message_delta",
          "message_completed"
        ]);
        expect(output.interjections).toEqual([
          expect.objectContaining({
            id: "run-interjection-output",
            messageMarkdown: "User interjection."
          })
        ]);
        expect(JSON.stringify(output)).not.toContain("Old worker owner must not project.");
        expect(JSON.stringify(output)).not.toContain("Old manager owner must not project.");
        expect(JSON.stringify(output)).not.toContain("Old human action owner must not project.");
        expect(JSON.stringify(output)).not.toContain("Chat output must not bleed into run room output.");
        expect(JSON.stringify(output)).not.toContain("Mismatched metadata must not project.");
        expect(JSON.stringify(output)).not.toContain("Missing source must not project.");
        expect(JSON.stringify(output)).not.toContain("Tool state must not project.");
      });
    } finally {
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it("streams run room output snapshots, newly appended events, and interjections", async () => {
    const fixture = await createStoreFixture();
    const abort = new AbortController();
    try {
      const createdAt = "2026-06-03T00:00:00.000Z";
      const runRoom = createRunRoomFact({ id: "run-room-output-stream", runId: "run-output-stream" });
      await fixture.store.createRunRoom(runRoom);
      await fixture.store.appendAgentOutputEvent({
        id: "stream-initial-output",
        ownerType: "run_room",
        ownerId: runRoom.id,
        actorType: "worker",
        kind: "message_completed",
        sequence: 1,
        sourceType: "blueprint_node_run",
        sourceId: "node-run-stream-1",
        bodyMarkdown: "Initial stream output.",
        metadata: { runRoomId: runRoom.id },
        createdAt
      });

      await withApiServer(fixture.store, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/run-rooms/${runRoom.id}/output/events/stream`, { signal: abort.signal });
        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toContain("text/event-stream");
        const reader = createSseReader(response);
        try {
          const snapshot = await readNextSseFrame(reader);
          expect(snapshot.event).toBe("output_snapshot");
          expect(snapshot.data).toMatchObject({
            type: "output_snapshot",
            runRoomId: runRoom.id,
            output: {
              events: [expect.objectContaining({ bodyMarkdown: "Initial stream output." })],
              interjections: []
            }
          });

          await fixture.store.appendAgentOutputEvent({
            id: "stream-live-output",
            ownerType: "run_room",
            ownerId: runRoom.id,
            actorType: "worker",
            kind: "message_delta",
            sequence: 2,
            sourceType: "blueprint_node_run",
            sourceId: "node-run-stream-1",
            delta: "Live canonical delta.",
            metadata: { runRoomId: runRoom.id },
            createdAt: "2026-06-03T00:00:01.000Z"
          });
          const eventFrame = await readUntilSseEvent(reader, "agent_output_event");
          if (eventFrame.data.type !== "agent_output_event") {
            throw new Error(`Unexpected SSE event type: ${eventFrame.data.type}`);
          }
          expect(eventFrame.data).toMatchObject({
            type: "agent_output_event",
            runRoomId: runRoom.id,
            event: {
              id: "stream-live-output",
              delta: "Live canonical delta."
            }
          });
          expect(eventFrame.data.cursor).toContain("stream-live-output");

          await fixture.store.appendRunInterjection({
            id: "stream-live-interjection",
            runRoomId: runRoom.id,
            target: "manager",
            messageMarkdown: "Please inspect the live output.",
            createdAt: "2026-06-03T00:00:02.000Z"
          });
          const interjectionFrame = await readUntilSseEvent(reader, "run_interjection");
          if (interjectionFrame.data.type !== "run_interjection") {
            throw new Error(`Unexpected SSE event type: ${interjectionFrame.data.type}`);
          }
          expect(interjectionFrame.data).toMatchObject({
            type: "run_interjection",
            runRoomId: runRoom.id,
            interjection: {
              id: "stream-live-interjection",
              messageMarkdown: "Please inspect the live output."
            }
          });
        } finally {
          abort.abort();
          await reader.reader.cancel().catch(() => undefined);
        }
      });
    } finally {
      abort.abort();
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it("streams empty output snapshots and heartbeat without creating facts", async () => {
    const fixture = await createStoreFixture();
    const abort = new AbortController();
    try {
      const runRoom = createRunRoomFact({ id: "run-room-empty-stream", runId: "run-empty-stream" });
      await fixture.store.createRunRoom(runRoom);
      await fixture.store.appendAgentOutputEvent({
        id: "stream-chat-bleed-output",
        ownerType: "chat_session",
        ownerId: "chat-session-stream",
        actorType: "leader",
        kind: "message_completed",
        sequence: 1,
        bodyMarkdown: "Chat event must not appear in stream.",
        metadata: { runRoomId: runRoom.id },
        createdAt: "2026-06-03T00:00:00.000Z"
      });

      await withApiServer(fixture.store, async (baseUrl) => {
        const beforeEvents = await fixture.store.listAgentOutputEvents();
        const beforeInterjections = await fixture.store.listRunInterjections({ runRoomId: runRoom.id });
        const response = await fetch(`${baseUrl}/api/run-rooms/${runRoom.id}/output/events/stream`, { signal: abort.signal });
        expect(response.status).toBe(200);
        const reader = createSseReader(response);
        try {
          const snapshot = await readNextSseFrame(reader);
          expect(snapshot.event).toBe("output_snapshot");
          expect(snapshot.data).toMatchObject({
            type: "output_snapshot",
            runRoomId: runRoom.id,
            output: { events: [], interjections: [] }
          });
          const heartbeat = await readUntilSseEvent(reader, "heartbeat");
          expect(heartbeat.data).toMatchObject({ type: "heartbeat", runRoomId: runRoom.id });
        } finally {
          abort.abort();
          await reader.reader.cancel().catch(() => undefined);
        }
        expect(await fixture.store.listAgentOutputEvents()).toEqual(beforeEvents);
        expect(await fixture.store.listRunInterjections({ runRoomId: runRoom.id })).toEqual(beforeInterjections);
      });
    } finally {
      abort.abort();
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it("returns 404 for missing run room output streams before SSE headers", async () => {
    const fixture = await createStoreFixture();
    try {
      await withApiServer(fixture.store, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/run-rooms/missing-run-room/output/events/stream`);
        const body = await response.json() as { error?: { code?: string } };

        expect(response.status, JSON.stringify(body)).toBe(404);
        expect(response.headers.get("content-type")).not.toContain("text/event-stream");
        expect(body.error?.code).toBe("run_room_not_found");
      });
    } finally {
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it("does not expose old run room feed endpoints as normal product data", async () => {
    const fixture = await createStoreFixture();
    try {
      const runRoom = createRunRoomFact({ id: "run-room-old-feed", runId: "run-old-feed" });
      await fixture.store.createRunRoom(runRoom);

      await withApiServer(fixture.store, async (baseUrl) => {
        const snapshotResponse = await fetch(`${baseUrl}/api/run-rooms/${runRoom.id}/feed`);
        const streamResponse = await fetch(`${baseUrl}/api/run-rooms/${runRoom.id}/feed/stream`);

        expect(snapshotResponse.status).toBe(404);
        expect(streamResponse.status).toBe(404);
        expect(await snapshotResponse.text()).not.toContain("output_snapshot");
        expect(await streamResponse.text()).not.toContain("agent_output_event");
      });
    } finally {
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it("projects Blueprint Kanban lanes from run rooms, worker tasks, and pending human actions without mutating state", async () => {
    const fixture = await createStoreFixture();
    try {
      const now = "2026-06-04T00:00:00.000Z";
      const runRooms: RunRoom[] = [
        createRunRoomFact({ id: "run-room-running", status: "open", runId: "run-running", updatedAt: "2026-06-04T00:04:00.000Z" }),
        createRunRoomFact({ id: "run-room-completed", status: "completed", runId: "run-completed", updatedAt: "2026-06-04T00:03:00.000Z" }),
        createRunRoomFact({ id: "run-room-failed", status: "failed", runId: "run-failed", updatedAt: "2026-06-04T00:02:00.000Z" }),
        createRunRoomFact({ id: "run-room-waiting", status: "open", runId: "run-waiting", updatedAt: "2026-06-04T00:01:00.000Z" })
      ];
      for (const runRoom of runRooms) {
        await fixture.store.createRunRoom(runRoom);
      }
      const command: ManagerCommand = {
        id: "manager-command-kanban",
        runRoomId: "run-room-running",
        action: "dispatch_worker_task",
        status: "running",
        createdAt: now,
        updatedAt: now
      };
      await fixture.store.appendManagerCommand(command);
      const workerTask: WorkerTask = {
        id: "worker-task-kanban",
        runRoomId: "run-room-running",
        managerCommandId: command.id,
        status: "running",
        title: "Worker is active",
        createdAt: now,
        updatedAt: "2026-06-04T00:05:00.000Z"
      };
      await fixture.store.createWorkerTask(workerTask);
      const approval = await seedStandaloneApprovalRequest(fixture.store, "approval-kanban-decision");
      const request: HumanActionRequest = {
        id: "human-action-request-kanban",
        runRoomId: "run-room-waiting",
        sourceContextType: "run_room",
        sourceContextId: "run-room-waiting",
        responseIntent: "decision_required",
        approvalRequestId: approval.id,
        status: "pending",
        title: "Pending decision",
        bodyMarkdown: "Choose the next run-room action.",
        createdAt: now,
        updatedAt: "2026-06-04T00:06:00.000Z"
      };
      await fixture.store.appendHumanActionRequest(request);

      const beforeCommands = await fixture.store.listManagerCommands();
      const beforeTasks = await fixture.store.listWorkerTasks();
      const beforeResponses = await fixture.store.listHumanActionResponses();

      await withApiServer(fixture.store, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/blueprints/kanban`);
        const { board } = await readOkJson<{ board: BlueprintKanbanBoard }>(response);

        expect(board.lanes.running.map((card) => card.id)).toEqual([
          "blueprint-kanban-worker-task-worker-task-kanban",
          "blueprint-kanban-run-room-run-room-running",
          "blueprint-kanban-run-room-run-room-waiting"
        ]);
        expect(board.lanes.waiting_user).toEqual([
          expect.objectContaining({
            humanActionRequestId: request.id,
            humanActionQueueItemId: `human-action-queue-item-${request.id}`,
            lane: "waiting_user",
            responseIntent: "decision_required",
            targetRef: expect.objectContaining({
              type: "human_action_queue_item",
              humanActionRequestId: request.id
            })
          })
        ]);
        expect(board.lanes.completed.map((card) => card.runRoomId)).toEqual(["run-room-completed"]);
        expect(board.lanes.failed.map((card) => card.runRoomId)).toEqual(["run-room-failed"]);
        const waitingCard = board.lanes.waiting_user[0] as BlueprintKanbanBoard["cards"][number] & {
          approve?: unknown;
          reject?: unknown;
          reply?: unknown;
          dispatch?: unknown;
          mutateState?: unknown;
        };
        expect(waitingCard.approve).toBeUndefined();
        expect(waitingCard.reject).toBeUndefined();
        expect(waitingCard.reply).toBeUndefined();
        expect(waitingCard.dispatch).toBeUndefined();
        expect(waitingCard.mutateState).toBeUndefined();

        const filteredResponse = await fetch(`${baseUrl}/api/blueprints/kanban?responseIntent=reply_required`);
        const filtered = await readOkJson<{ board: BlueprintKanbanBoard }>(filteredResponse);
        expect(filtered.board.cards).toEqual([]);
      });

      expect(await fixture.store.listManagerCommands()).toEqual(beforeCommands);
      expect(await fixture.store.listWorkerTasks()).toEqual(beforeTasks);
      expect(await fixture.store.listHumanActionResponses()).toEqual(beforeResponses);
    } finally {
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it("stores Run page sends only as manager-targeted RunInterjection facts", async () => {
    const fixture = await createStoreFixture();
    try {
      const now = "2026-06-03T00:00:00.000Z";
      await fixture.store.createRunRoom({
        id: "run-room-interjection",
        companyId: "company-1",
        status: "open",
        title: "Run room interjection",
        createdAt: now,
        updatedAt: now
      });

      await withApiServer(fixture.store, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/run-rooms/run-room-interjection/interjections`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ messageMarkdown: "Please inspect worker output." })
        });
        const body = await readOkJson<{ output: RunRoomOutputSnapshot }>(response);
        const interjections = await fixture.store.listRunInterjections({ runRoomId: "run-room-interjection" });

        expect(interjections).toHaveLength(1);
        expect(interjections[0]).toMatchObject({
          runRoomId: "run-room-interjection",
          target: "manager",
          messageMarkdown: "Please inspect worker output."
        });
        expect(await fixture.store.listManagerCommands({ runRoomId: "run-room-interjection" })).toEqual([]);
        expect(await fixture.store.listWorkerTasks({ runRoomId: "run-room-interjection" })).toEqual([]);
        expect(body.output.events).toEqual([]);
        expect(body.output.interjections).toHaveLength(1);
        expect(body.output.interjections[0]).toMatchObject({
          runRoomId: "run-room-interjection",
          target: "manager",
          messageMarkdown: "Please inspect worker output."
        });
      });
    } finally {
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it("applies manager commands to one active WorkerTask and rejects plural dispatch actions", async () => {
    const fixture = await createStoreFixture();
    try {
      const now = "2026-06-03T00:00:00.000Z";
      await fixture.store.createRunRoom({
        id: "run-room-worker-task",
        companyId: "company-1",
        status: "open",
        createdAt: now,
        updatedAt: now
      });
      const service = new ManagerCommandService(fixture.store);
      const applied = await service.applyCommand({
        runRoomId: "run-room-worker-task",
        action: "dispatch_worker_task",
        workerSeatId: "worker-seat-1",
        instructionMarkdown: "Research current risks."
      });

      expect(applied.managerCommand.action).toBe("dispatch_worker_task");
      expect(applied.workerTask).toMatchObject({
        runRoomId: "run-room-worker-task",
        managerCommandId: applied.managerCommand.id,
        workerSeatId: "worker-seat-1",
        status: "queued"
      });
      await expect(service.applyCommand({
        runRoomId: "run-room-worker-task",
        action: "dispatch_worker_task",
        workerSeatId: "worker-seat-2",
        instructionMarkdown: "Second task should wait."
      })).rejects.toThrow(/active WorkerTask/);
      expect(await fixture.store.listManagerCommands({ runRoomId: "run-room-worker-task" })).toHaveLength(1);
      expect(await fixture.store.listWorkerTasks({ runRoomId: "run-room-worker-task" })).toHaveLength(1);

      const pluralDispatch = ["dispatch", "worker", "tasks"].join("_");
      await expect(service.applyCommand({
        runRoomId: "run-room-worker-task",
        action: pluralDispatch,
        instructionMarkdown: "Plural dispatch is forbidden."
      })).rejects.toThrow(/ManagerCommand\.action/);

      await fixture.store.createRunRoom({
        id: "run-room-worker-task-succeeded",
        companyId: "company-1",
        status: "open",
        createdAt: now,
        updatedAt: now
      });
      await fixture.store.appendManagerCommand({
        id: "manager-command-succeeded",
        runRoomId: "run-room-worker-task-succeeded",
        action: "dispatch_worker_task",
        status: "succeeded",
        createdAt: now,
        updatedAt: now
      });
      await fixture.store.createWorkerTask({
        id: "worker-task-succeeded",
        runRoomId: "run-room-worker-task-succeeded",
        managerCommandId: "manager-command-succeeded",
        status: "succeeded",
        createdAt: now,
        updatedAt: now
      });
      const nextApplied = await service.applyCommand({
        runRoomId: "run-room-worker-task-succeeded",
        action: "dispatch_worker_task",
        instructionMarkdown: "Follow up after success."
      });
      expect(nextApplied.workerTask?.status).toBe("queued");

      await fixture.store.createRunRoom({
        id: "run-room-worker-task-waiting",
        companyId: "company-1",
        status: "open",
        createdAt: now,
        updatedAt: now
      });
      await fixture.store.appendManagerCommand({
        id: "manager-command-waiting",
        runRoomId: "run-room-worker-task-waiting",
        action: "dispatch_worker_task",
        status: "waiting_user",
        createdAt: now,
        updatedAt: now
      });
      await fixture.store.createWorkerTask({
        id: "worker-task-waiting",
        runRoomId: "run-room-worker-task-waiting",
        managerCommandId: "manager-command-waiting",
        status: "waiting_user",
        createdAt: now,
        updatedAt: now
      });
      await expect(service.applyCommand({
        runRoomId: "run-room-worker-task-waiting",
        action: "dispatch_worker_task",
        instructionMarkdown: "Blocked by user wait."
      })).rejects.toThrow(/active WorkerTask/);
    } finally {
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it("streams Codex and Claude Code chat responses through the selected harness source", async () => {
    const fixture = await createStoreFixture();
    const adapter = new TrackingAdapter();
    const codexHome = join(fixture.dir, "codex-home");
    const claudeHome = join(fixture.dir, "claude-home");
    const previousCodexDefault = process.env.HIVEWARD_CODEX_DEFAULT_MODEL;
    const previousClaudeDefault = process.env.HIVEWARD_CLAUDE_CODE_DEFAULT_MODEL;
    const previousCodexHome = process.env.CODEX_HOME;
    const previousClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR;
    mkdirSync(join(codexHome, "skills", "hiveward-ceo"), { recursive: true });
    mkdirSync(join(claudeHome, "skills", "hiveward-leader"), { recursive: true });
    writeFileSync(join(codexHome, "skills", "hiveward-ceo", "SKILL.md"), "# CEO\n");
    writeFileSync(join(claudeHome, "skills", "hiveward-leader", "SKILL.md"), "# Leader\n");
    process.env.HIVEWARD_CODEX_DEFAULT_MODEL = "codex/chat-default";
    process.env.HIVEWARD_CLAUDE_CODE_DEFAULT_MODEL = "inherit";
    process.env.CODEX_HOME = codexHome;
    process.env.CLAUDE_CONFIG_DIR = claudeHome;
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
        expect(adapter.lastChatStreamInput?.permissionMode).toBe("safe");
        expect(adapter.lastChatStreamInput?.skillIds).toEqual(["hiveward-ceo"]);
        expect(adapter.lastChatStreamInput?.message).toContain("HiveWard appointment:");
        expect(adapter.lastChatStreamInput?.message).toContain("hiveward-ceo");

        const { roles } = await fixture.store.getRoleDirectory();
        const leader = roles.leaders[0]!;
        expect(leader).toBeDefined();
        const claudeResponse = await streamSessionChat(baseUrl, {
          harnessId: "claudeCode",
          message: "Say hello from Claude Code.",
          attachments: [],
          modelId: "inherit",
          thinkingEffort: "medium",
          permissionMode: "full_access",
          roleScope: {
            role: "leader",
            leaderId: leader.id,
            blueprintId: leader.blueprintId
          }
        });
        const claudeText = await claudeResponse.text();

        expect(claudeResponse.status, claudeText).toBe(200);
        expect(claudeText).toContain("main completed through Claude Code adapter");
        expect(adapter.lastChatStreamInput?.source).toBe("claude");
        expect(adapter.lastChatStreamInput?.sessionKey).toBe("");
        expect(adapter.lastChatStreamInput?.modelId).toBeUndefined();
        expect(adapter.lastChatStreamInput?.permissionMode).toBe("full_access");
        expect(adapter.lastChatStreamInput?.skillIds).toEqual(["hiveward-leader"]);
        expect(adapter.lastChatStreamInput?.message).toContain("hiveward-leader");
      }, adapter);
    } finally {
      restoreEnv("HIVEWARD_CODEX_DEFAULT_MODEL", previousCodexDefault);
      restoreEnv("HIVEWARD_CLAUDE_CODE_DEFAULT_MODEL", previousClaudeDefault);
      restoreEnv("CODEX_HOME", previousCodexHome);
      restoreEnv("CLAUDE_CONFIG_DIR", previousClaudeConfigDir);
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it("injects CEO skill decomposition guidance in skill split mode", async () => {
    const fixture = await createStoreFixture();
    const adapter = new TrackingAdapter();
    const codexHome = join(fixture.dir, "codex-home");
    const previousCodexHome = process.env.CODEX_HOME;
    mkdirSync(join(codexHome, "skills", "hiveward-ceo"), { recursive: true });
    mkdirSync(join(codexHome, "skills", "hiveward-skill-decomposer"), { recursive: true });
    writeFileSync(join(codexHome, "skills", "hiveward-ceo", "SKILL.md"), "# CEO\n");
    writeFileSync(join(codexHome, "skills", "hiveward-skill-decomposer", "SKILL.md"), "# Decomposer\n");
    process.env.CODEX_HOME = codexHome;
    try {
      await withApiServer(fixture.store, async (baseUrl) => {
        const response = await streamSessionChat(baseUrl, {
          harnessId: "codex",
          message: "帮我拆分一个 skill",
          attachments: [],
          modelId: "codex/test-default",
          thinkingEffort: "medium",
          mode: "skill_split",
          roleScope: {
            role: "ceo"
          }
        });
        const text = await response.text();

        expect(response.status, text).toBe(200);
        expect(adapter.lastChatStreamInput?.message).toContain("Skill split mode:");
        expect(adapter.lastChatStreamInput?.message).toContain("hiveward-skill-decomposer");
        expect(adapter.lastChatStreamInput?.message).toContain("Ask the user for skill material");
        expect(adapter.lastChatStreamInput?.message).toContain("source completeness");
        expect(adapter.lastChatStreamInput?.message).toContain("Skill IR summary");
        expect(adapter.lastChatStreamInput?.message).toContain("blueprint exposure metadata");
        expect(adapter.lastChatStreamInput?.message).toContain("states where required scripts live");
        expect(adapter.lastChatStreamInput?.message).toContain("Do not place the CEO role inside the generated runtime blueprint");
        expect(adapter.lastChatStreamInput?.message).toContain("do not claim current blueprint runtime enforces per-node thinking effort");
        expect(adapter.lastChatStreamInput?.message).not.toContain("Current selected blueprint JSON:");
        expect(adapter.lastChatStreamInput?.skillIds).toEqual(["hiveward-ceo", "hiveward-skill-decomposer"]);
      }, adapter);
    } finally {
      restoreEnv("CODEX_HOME", previousCodexHome);
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it("does not include the inbox submission contract for skill split approval requests", async () => {
    const fixture = await createStoreFixture();
    const adapter = new TrackingAdapter();
    try {
      await withApiServer(fixture.store, async (baseUrl) => {
        const response = await streamSessionChat(baseUrl, {
          harnessId: "codex",
          message: "Submit the decomposed skill blueprint for approval.",
          attachments: [],
          modelId: "codex/test-default",
          thinkingEffort: "medium",
          mode: "skill_split",
          roleScope: {
            role: "ceo"
          }
        });
        const text = await response.text();

        expect(response.status, text).toBe(200);
        expect(adapter.lastChatStreamInput?.message).toContain("Skill split mode:");
        expect(adapter.lastChatStreamInput?.message).toContain("Use the structured ExecutiveCommand channel");
        expect(adapter.lastChatStreamInput?.message).not.toContain("HIVEWARD_INBOX_SUBMISSION_CONTRACT v1");
        expect(adapter.lastChatStreamInput?.message).not.toContain("hiveward-inbox");
      }, adapter);
    } finally {
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it("does not include the inbox submission contract for Leader blueprint approval requests", async () => {
    const fixture = await createStoreFixture();
    const adapter = new TrackingAdapter();
    const blueprint = (await fixture.store.listBlueprints())[0]!;
    const codexHome = join(fixture.dir, "codex-home");
    const previousCodexHome = process.env.CODEX_HOME;
    mkdirSync(join(codexHome, "skills", "hiveward-leader"), { recursive: true });
    writeFileSync(join(codexHome, "skills", "hiveward-leader", "SKILL.md"), "# Leader\n");
    process.env.CODEX_HOME = codexHome;
    try {
      await withApiServer(fixture.store, async (baseUrl) => {
        const response = await streamSessionChat(baseUrl, {
          harnessId: "codex",
          message: "Please submit this blueprint proposal for approval.",
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
        expect(adapter.lastChatStreamInput?.skillIds).toEqual(["hiveward-leader"]);
        expect(adapter.lastChatStreamInput?.message).toContain("Use the structured ExecutiveCommand channel");
        expect(adapter.lastChatStreamInput?.message).not.toContain("HIVEWARD_INBOX_SUBMISSION_CONTRACT v1");
        expect(adapter.lastChatStreamInput?.message).not.toContain("hiveward-inbox");
      }, adapter);
    } finally {
      restoreEnv("CODEX_HOME", previousCodexHome);
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it("streams runtime activity events and stores the visible partial output", async () => {
    const fixture = await createStoreFixture();
    const adapter = new ChatRuntimeActivityAdapter();
    try {
      await withApiServer(fixture.store, async (baseUrl) => {
        const response = await streamSessionChat(baseUrl, {
          harnessId: "codex",
          message: "Show runtime activity.",
          attachments: [],
          modelId: "codex/test-default",
          thinkingEffort: "medium",
          mode: "chat",
          roleScope: {
            role: "ceo"
          }
        });
        const text = await response.text();

        expect(response.status, text).toBe(200);
        expect(text).toContain("event: runtime_state");
        expect(text).toContain("First visible sentence.");
        const session = (await fixture.store.listChatSessions())[0]!;
        const historicalMessages = await fixture.store.listChatMessages(session.id);
        expect(historicalMessages).toEqual([]);
        const events = await fixture.store.listAgentOutputEvents({ ownerType: "chat_session", ownerId: session.id });
        const assistant = events.find((event) => event.kind === "message_completed" && event.metadata?.role === "assistant");
        expect(assistant).toMatchObject({
          kind: "message_completed",
          bodyMarkdown: "First visible sentence."
        });
        expect(assistant?.runtimeState?.activity).toEqual([
          expect.objectContaining({
            id: "tool-1",
            phase: "tool",
            label: "repo.search apps/api",
            status: "completed"
          })
        ]);
      }, adapter);
    } finally {
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it("auto-rebuilds Codex chat context instead of resuming a heavy native session", async () => {
    const fixture = await createStoreFixture();
    const adapter = new TrackingAdapter();
    try {
      const now = new Date().toISOString();
      const session = await fixture.store.createChatSession({
        harnessId: "codex",
        title: "Heavy Codex session",
        nativeSessionId: "codex-heavy-session",
        modelId: "codex/test-default",
        permissionMode: "full_access",
        mode: "blueprint",
        roleScope: { role: "ceo" }
      });
      await fixture.store.appendAgentOutputEvent({
        id: "agent-output-user-heavy",
        ownerType: "chat_session",
        ownerId: session.id,
        actorType: "user",
        kind: "message_completed",
        sequence: 1,
        bodyMarkdown: "先分析当前蓝图逻辑。",
        metadata: {
          role: "user",
          attachments: [],
          harnessId: "codex",
          modelId: "codex/test-default"
        },
        createdAt: now
      });
      await fixture.store.appendAgentOutputEvent({
        id: "agent-output-assistant-heavy",
        ownerType: "chat_session",
        ownerId: session.id,
        actorType: "worker",
        kind: "message_completed",
        sequence: 2,
        bodyMarkdown: "Heavy analysis summary.",
        metadata: {
          role: "assistant",
          harnessId: "codex",
          modelId: "codex/test-default"
        },
        runtimeState: {
          taskId: "heavy-task",
          runId: "heavy-run",
          sessionKey: "codex-heavy-session",
          source: "codex",
          status: "succeeded",
          updatedAt: now,
          usage: {
            id: "usage-heavy",
            modelId: "gpt-5.5",
            inputTokens: 5_000_000,
            outputTokens: 10_000,
            costUsd: 0,
            recordedAt: now
          },
          timings: {
            totalMs: 900_000,
            hivewardPreprocessMs: 10,
            runtimeMs: 899_000,
            hivewardPostprocessMs: 10
          }
        },
        createdAt: now
      });

      await withApiServer(fixture.store, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/chat/sessions/${session.id}/messages/stream`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            message: "开始构建发邮件吧",
            attachments: [],
            modelId: "codex/test-default",
            thinkingEffort: "medium",
            permissionMode: "full_access",
            mode: "blueprint",
            roleScope: { role: "ceo" }
          })
        });
        const text = await response.text();

        expect(response.status, text).toBe(200);
        expect(adapter.lastChatStreamInput?.sessionKey).toBe("");
        expect(adapter.lastChatStreamInput?.message).toContain("HiveWard visible conversation history:");
        expect(adapter.lastChatStreamInput?.message).toContain("Heavy analysis summary.");
        const updated = await fixture.store.getChatSession(session.id);
        expect(updated?.nativeSessionId).toBeUndefined();
      }, adapter);
    } finally {
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it("does not include the inbox submission contract when the user asks for a draft only", async () => {
    const fixture = await createStoreFixture();
    const adapter = new TrackingAdapter();
    try {
      await withApiServer(fixture.store, async (baseUrl) => {
        const response = await streamSessionChat(baseUrl, {
          harnessId: "codex",
          message: "请生成一个测试蓝图，但只要草稿，不要提交到收件箱。",
          attachments: [],
          modelId: "codex/test-default",
          thinkingEffort: "medium",
          mode: "blueprint",
          roleScope: {
            role: "ceo"
          }
        });
        const text = await response.text();

        expect(response.status, text).toBe(200);
        expect(adapter.lastChatStreamInput?.message).not.toContain("HIVEWARD_INBOX_SUBMISSION_CONTRACT v1");
        expect(adapter.lastChatStreamInput?.message).not.toContain("hiveward-inbox");
      }, adapter);
    } finally {
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it("streams hiveward-inbox markdown as ordinary chat output without creating inbox items", async () => {
    const fixture = await createStoreFixture();
    const blueprint = (await fixture.store.listBlueprints())[0]!;
    const output = [
      "I prepared the concrete package and submitted it for inbox approval.",
      "```hiveward-inbox",
      JSON.stringify({
        schema: historicalInboxSubmissionSchema,
        type: "blueprint_proposal",
        blueprintId: blueprint.id,
        title: "Review generated blueprint package",
        summary: "Approve the generated package before Hiveward imports it."
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
        expect(text).toContain("hiveward-inbox");
        expect(text).not.toContain(`event: ${oldInboxCreatedChatOutputEventName}`);
        expect(text).not.toContain("\"replace\":true");
        const session = (await fixture.store.listChatSessions())[0]!;
        const events = await fixture.store.listAgentOutputEvents({ ownerType: "chat_session", ownerId: session.id });
        const assistant = events.find((event) => event.kind === "message_completed" && event.metadata?.role === "assistant");
        expect(assistant?.bodyMarkdown).toContain("hiveward-inbox");
        expectOldInboxNormalStoreSurfaceDeleted(fixture.store);
        expect(await fixture.store.listApprovalRequests()).toEqual([]);
      }, adapter);
    } finally {
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it("does not repair malformed hiveward-inbox markdown into an inbox item", async () => {
    const fixture = await createStoreFixture();
    const blueprint = (await fixture.store.listBlueprints())[0]!;
    const malformedSubmission = JSON.stringify({
      schema: historicalInboxSubmissionSchema,
      type: "blueprint_proposal",
      blueprintId: blueprint.id,
      title: "Malformed package",
      summary: "This is historical chat text only."
    }).replace(/}$/, "}}");
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
          message: "Submit this malformed package for approval.",
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
        expect(text).toContain("hiveward-inbox");
        expect(text).not.toContain("Inbox submission failed");
        expect(text).not.toContain(`event: ${oldInboxCreatedChatOutputEventName}`);
        expectOldInboxNormalStoreSurfaceDeleted(fixture.store);
        expect(await fixture.store.listApprovalRequests()).toEqual([]);
      }, adapter);
    } finally {
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it("accepts inspect_blueprint executive commands", async () => {
    const fixture = await createStoreFixture();
    const blueprint = (await fixture.store.listBlueprints())[0]!;
    try {
      await withApiServer(fixture.store, async (baseUrl) => {
        const created = await readOkJson<{ session: HivewardChatSession }>(await fetch(`${baseUrl}/api/chat/sessions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ harnessId: "codex", title: "Executive", mode: "chat", roleScope: { role: "ceo" } })
        }));
        const response = await fetch(`${baseUrl}/api/chat/sessions/${created.session.id}/executive-commands`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            command: {
              action: "inspect_blueprint",
              sourceRole: "ceo",
              payload: { blueprintId: blueprint.id }
            }
          })
        });
        const body = await readOkJson<{ result: { action: string; blueprint: { id: string } } }>(response);

        expect(body.result.action).toBe("inspect_blueprint");
        expect(body.result.blueprint.id).toBe(blueprint.id);
      });
    } finally {
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it("starts a CEO blueprint run through the worker-owned run command path", async () => {
    const fixture = await createStoreFixture();
    const blueprint = await fixture.store.createBlueprint({ name: "Executive run command blueprint" });
    const adapter = new TrackingAdapter();
    const worker = new BlueprintWorker(fixture.store, adapter);
    try {
      await withApiServer(fixture.store, async (baseUrl) => {
        const created = await readOkJson<{ session: HivewardChatSession }>(await fetch(`${baseUrl}/api/chat/sessions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ harnessId: "codex", title: "Executive", mode: "chat", roleScope: { role: "ceo" } })
        }));
        const response = await fetch(`${baseUrl}/api/chat/sessions/${created.session.id}/executive-commands`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            command: {
              action: "start_blueprint_run",
              sourceRole: "ceo",
              payload: {
                blueprintId: blueprint.id,
                startedBy: "ceo-test",
                title: "Executive run",
                summary: "Started from CEO chat."
              }
            }
          })
        });
        const body = await readOkJson<{
          result: {
            action: string;
            run: { run: { id: string; blueprintId: string } };
            runRoom: {
              runId: string;
              blueprintId: string;
              status: string;
              title?: string;
              summary?: string;
              metadata?: Record<string, unknown>;
            };
          };
        }>(response);

        expect(body.result.action).toBe("start_blueprint_run");
        expect(body.result.run.run.blueprintId).toBe(blueprint.id);
        expect(body.result.runRoom).toMatchObject({
          blueprintId: blueprint.id,
          runId: body.result.run.run.id,
          status: "open",
          title: "Executive run",
          summary: "Started from CEO chat.",
          metadata: {
            sourceContextType: "executive_chat",
            chatSessionId: created.session.id,
            executiveCommandAction: "start_blueprint_run",
            sourceRole: "ceo"
          }
        });
        expect(await fixture.store.listRunCommands({ runId: body.result.run.run.id })).toEqual([
          expect.objectContaining({
            blueprintId: blueprint.id,
            runId: body.result.run.run.id,
            kind: "regular_run"
          })
        ]);
        expect(await fixture.store.listRunRooms({ blueprintId: blueprint.id })).toHaveLength(1);
        const runPage = await readOkJson<{ run: { run: { id: string; blueprintId: string }; runRoomOutput?: unknown } }>(
          await fetch(`${baseUrl}/api/blueprint-runs/${body.result.run.run.id}`)
        );
        expect(runPage.run.run).toMatchObject({ id: body.result.run.run.id, blueprintId: blueprint.id });
        expect(runPage.run.runRoomOutput).toBeDefined();
        await waitForRunsSettled(fixture.store, [body.result.run.run.id]);
      }, adapter, createConfigStoreFixture(), worker);
    } finally {
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it("starts a Leader blueprint run only for the session-scoped blueprint", async () => {
    const fixture = await createStoreFixture();
    const blueprint = await fixture.store.createBlueprint({ name: "Leader run command blueprint" });
    const adapter = new TrackingAdapter();
    const worker = new BlueprintWorker(fixture.store, adapter);
    try {
      await withApiServer(fixture.store, async (baseUrl) => {
        const created = await readOkJson<{ session: HivewardChatSession }>(await fetch(`${baseUrl}/api/chat/sessions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            harnessId: "codex",
            title: "Leader",
            mode: "chat",
            roleScope: { role: "leader", leaderId: "leader-test", blueprintId: blueprint.id }
          })
        }));
        const response = await fetch(`${baseUrl}/api/chat/sessions/${created.session.id}/executive-commands`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            command: {
              action: "start_blueprint_run",
              sourceRole: "leader",
              payload: { blueprintId: blueprint.id, startedBy: "leader-test", title: "Leader scoped run" }
            }
          })
        });
        const body = await readOkJson<{
          result: {
            run: { run: { id: string; blueprintId: string } };
            runRoom: { managerRoleId?: string; metadata?: Record<string, unknown> };
          };
        }>(response);

        expect(body.result.run.run.blueprintId).toBe(blueprint.id);
        expect(body.result.runRoom).toMatchObject({
          managerRoleId: created.session.roleScope?.leaderId,
          metadata: {
            chatSessionId: created.session.id,
            sourceRole: "leader"
          }
        });
        expect(await fixture.store.listRunCommands({ runId: body.result.run.run.id })).toEqual([
          expect.objectContaining({ kind: "regular_run", runId: body.result.run.run.id })
        ]);
        await waitForRunsSettled(fixture.store, [body.result.run.run.id]);
      }, adapter, createConfigStoreFixture(), worker);
    } finally {
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it("starts every CEO batch blueprint run through worker-owned run commands", async () => {
    const fixture = await createStoreFixture();
    const firstBlueprint = await fixture.store.createBlueprint({ name: "First executive batch blueprint" });
    const secondBlueprint = await fixture.store.createBlueprint({ name: "Second executive batch blueprint" });
    const adapter = new TrackingAdapter();
    const worker = new BlueprintWorker(fixture.store, adapter);
    try {
      await withApiServer(fixture.store, async (baseUrl) => {
        const created = await readOkJson<{ session: HivewardChatSession }>(await fetch(`${baseUrl}/api/chat/sessions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ harnessId: "codex", title: "Executive", mode: "chat", roleScope: { role: "ceo" } })
        }));
        const response = await fetch(`${baseUrl}/api/chat/sessions/${created.session.id}/executive-commands`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            command: {
              action: "batch_start_blueprint_runs",
              sourceRole: "ceo",
              payload: { blueprintIds: [firstBlueprint.id, secondBlueprint.id], startedBy: "ceo-test" }
            }
          })
        });
        const body = await readOkJson<{ result: { runs: Array<{ run: { id: string; blueprintId: string } }>; runRooms: RunRoom[] } }>(response);
        expect(body.result.runs.map((runView) => runView.run.blueprintId)).toEqual([firstBlueprint.id, secondBlueprint.id]);
        expect(body.result.runRooms.map((runRoom) => runRoom.blueprintId)).toEqual([firstBlueprint.id, secondBlueprint.id]);

        for (const runView of body.result.runs) {
          expect(await fixture.store.listRunCommands({ runId: runView.run.id })).toEqual([
            expect.objectContaining({ kind: "regular_run", runId: runView.run.id })
          ]);
        }
        await waitForRunsSettled(fixture.store, body.result.runs.map((runView) => runView.run.id));
      }, adapter, createConfigStoreFixture(), worker);
    } finally {
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it("rejects Leader executive commands that target another blueprint before side effects", async () => {
    const fixture = await createStoreFixture();
    const allowedBlueprint = (await fixture.store.listBlueprints())[0]!;
    const forbiddenBlueprint = await fixture.store.createBlueprint({ name: "Forbidden leader blueprint" });
    const worker = {
      async startRun() {
        throw new Error("Leader cross-blueprint command reached the worker.");
      }
    } as unknown as BlueprintWorker;
    try {
      await withApiServer(fixture.store, async (baseUrl) => {
        const created = await readOkJson<{ session: HivewardChatSession }>(await fetch(`${baseUrl}/api/chat/sessions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            harnessId: "codex",
            title: "Leader",
            mode: "chat",
            roleScope: { role: "leader", leaderId: "leader-test", blueprintId: allowedBlueprint.id }
          })
        }));
        const commands = [
          { action: "inspect_blueprint", sourceRole: "leader", payload: { blueprintId: forbiddenBlueprint.id } },
          { action: "summarize_blueprint", sourceRole: "leader", payload: { blueprintId: forbiddenBlueprint.id } },
          { action: "start_blueprint_run", sourceRole: "leader", payload: { blueprintId: forbiddenBlueprint.id } },
          { action: "batch_start_blueprint_runs", sourceRole: "leader", payload: { blueprintIds: [forbiddenBlueprint.id] } },
          { action: "update_blueprint_draft", sourceRole: "leader", payload: { blueprintId: forbiddenBlueprint.id, title: "Forbidden" } },
          {
            action: "govern_blueprint_version",
            sourceRole: "leader",
            payload: { blueprintId: forbiddenBlueprint.id, decision: "approve" }
          },
          {
            action: "request_human_action",
            sourceRole: "leader",
            payload: {
              sourceContextType: "blueprint_governance",
              blueprintId: forbiddenBlueprint.id,
              responseIntent: "reply_required",
              title: "Forbidden human action",
              bodyMarkdown: "This must not be created."
            }
          }
        ];

        for (const command of commands) {
          const response = await fetch(`${baseUrl}/api/chat/sessions/${created.session.id}/executive-commands`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ command })
          });
          const body = await response.json() as { error?: { code?: string } };
          expect(response.status, JSON.stringify({ action: command.action, body })).toBe(400);
          expect(body.error?.code).toBe("executive_command_blueprint_scope_mismatch");
        }
        expect(await fixture.store.listRunSummaries()).toEqual([]);
        expect(await fixture.store.listRunRooms()).toEqual([]);
        expect(await fixture.store.listHumanActionRequests()).toEqual([]);
      }, new TrackingAdapter(), createConfigStoreFixture(), worker);
    } finally {
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it("rejects a Leader batch with one unauthorized blueprint before starting any run", async () => {
    const fixture = await createStoreFixture();
    const allowedBlueprint = (await fixture.store.listBlueprints())[0]!;
    const forbiddenBlueprint = await fixture.store.createBlueprint({ name: "Forbidden batch blueprint" });
    const worker = {
      async startRun() {
        throw new Error("Unauthorized batch command reached the worker.");
      }
    } as unknown as BlueprintWorker;
    try {
      await withApiServer(fixture.store, async (baseUrl) => {
        const created = await readOkJson<{ session: HivewardChatSession }>(await fetch(`${baseUrl}/api/chat/sessions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            harnessId: "codex",
            title: "Leader",
            mode: "chat",
            roleScope: { role: "leader", leaderId: "leader-test", blueprintId: allowedBlueprint.id }
          })
        }));
        const response = await fetch(`${baseUrl}/api/chat/sessions/${created.session.id}/executive-commands`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            command: {
              action: "batch_start_blueprint_runs",
              sourceRole: "leader",
              payload: { blueprintIds: [allowedBlueprint.id, forbiddenBlueprint.id], startedBy: "leader-test" }
            }
          })
        });
        const body = await response.json() as { error?: { code?: string } };

        expect(response.status, JSON.stringify(body)).toBe(400);
        expect(body.error?.code).toBe("executive_command_blueprint_scope_mismatch");
        expect(await fixture.store.listRunSummaries()).toEqual([]);
        expect(await fixture.store.listRunRooms()).toEqual([]);
      }, new TrackingAdapter(), createConfigStoreFixture(), worker);
    } finally {
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it("creates human action requests for executive chat and blueprint governance contexts", async () => {
    const fixture = await createStoreFixture();
    const blueprint = (await fixture.store.listBlueprints())[0]!;
    try {
      await withApiServer(fixture.store, async (baseUrl) => {
        const created = await readOkJson<{ session: HivewardChatSession }>(await fetch(`${baseUrl}/api/chat/sessions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ harnessId: "codex", title: "Executive", mode: "chat", roleScope: { role: "ceo" } })
        }));
        for (const command of [
          {
            action: "request_human_action",
            sourceRole: "ceo",
            payload: {
              sourceContextType: "executive_chat",
              responseIntent: "reply_required",
              title: "Executive clarification",
              bodyMarkdown: "Please clarify this request."
            }
          },
          {
            action: "request_human_action",
            sourceRole: "ceo",
            payload: {
              sourceContextType: "blueprint_governance",
              blueprintId: blueprint.id,
              responseIntent: "reply_required",
              title: "Review blueprint",
              bodyMarkdown: "Review this governance step."
            }
          }
        ]) {
          const response = await fetch(`${baseUrl}/api/chat/sessions/${created.session.id}/executive-commands`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ command })
          });
          expect(response.status, await response.text()).toBe(201);
        }

        expect(await fixture.store.listHumanActionRequests({ sourceContextType: "executive_chat" })).toHaveLength(1);
        expect(await fixture.store.listHumanActionRequests({ sourceContextType: "blueprint_governance" })).toHaveLength(1);
      });
    } finally {
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it("rejects executive decision human actions without the canonical approval owner", async () => {
    const fixture = await createStoreFixture();
    const blueprint = (await fixture.store.listBlueprints())[0]!;
    try {
      await withApiServer(fixture.store, async (baseUrl) => {
        const created = await readOkJson<{ session: HivewardChatSession }>(await fetch(`${baseUrl}/api/chat/sessions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ harnessId: "codex", title: "Executive", mode: "chat", roleScope: { role: "ceo" } })
        }));
        const response = await fetch(`${baseUrl}/api/chat/sessions/${created.session.id}/executive-commands`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            command: {
              action: "request_human_action",
              sourceRole: "ceo",
              payload: {
                sourceContextType: "blueprint_governance",
                blueprintId: blueprint.id,
                responseIntent: "decision_required",
                title: "Govern blueprint",
                bodyMarkdown: "Approve this governance step."
              }
            }
          })
        });
        const body = await response.json() as { error?: { code?: string; message?: string } };

        expect(response.status, JSON.stringify(body)).toBe(400);
        expect(body.error).toMatchObject({
          code: "executive_decision_human_action_requires_approval_owner"
        });
        expect(body.error?.message).toContain("canonical approval owner");
        expect(await fixture.store.listHumanActionRequests()).toEqual([]);
      });
    } finally {
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it("closes reply human actions through request status without closing decision requests by ordinary text", async () => {
    const fixture = await createStoreFixture();
    try {
      const approval = await seedStandaloneApprovalRequest(fixture.store, "decision-human-action-approval");
      await fixture.store.appendHumanActionRequest(createHumanActionRequestFact({
        id: "human-action-reply",
        responseIntent: "reply_required",
        title: "Reply needed"
      }));
      await fixture.store.appendHumanActionRequest(createHumanActionRequestFact({
        id: "human-action-decision",
        responseIntent: "decision_required",
        title: "Decision needed",
        approvalRequestId: approval.id
      }));

      await withApiServer(fixture.store, async (baseUrl) => {
        const replyResponse = await fetch(`${baseUrl}/api/human-action-requests/human-action-reply/responses`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ messageMarkdown: "Reply completed." })
        });
        const replyBody = await readOkJson<{
          queue: Array<{ humanActionRequestId: string; status: string }>;
        }>(replyResponse);
        const replyRequest = await fixture.store.getHumanActionRequest("human-action-reply");
        expect(replyRequest?.status).toBe("responded");
        expect(replyBody.queue.some((item) => item.humanActionRequestId === "human-action-reply")).toBe(false);
        expect(await fixture.store.listHumanActionRequests({ status: "pending" })).toEqual([
          expect.objectContaining({ id: "human-action-decision" })
        ]);

        await expect(fetch(`${baseUrl}/api/human-action-requests/human-action-reply/responses`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ messageMarkdown: "Duplicate reply." })
        })).resolves.toMatchObject({ status: 500 });

        const decisionResponse = await fetch(`${baseUrl}/api/human-action-requests/human-action-decision/responses`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ messageMarkdown: "I approve in text." })
        });
        const decisionBody = await readOkJson<{
          queue: Array<{ humanActionRequestId: string; status: string }>;
        }>(decisionResponse);
        const decisionRequest = await fixture.store.getHumanActionRequest("human-action-decision");
        expect(decisionRequest?.status).toBe("pending");
        expect(decisionBody.queue).toEqual([
          expect.objectContaining({ humanActionRequestId: "human-action-decision", status: "pending" })
        ]);

        await readOkJson(await fetch(`${baseUrl}/api/approval-requests/${approval.id}/approve`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ comment: "Approved through canonical approval owner." })
        }));
        const closedDecisionRequest = await fixture.store.getHumanActionRequest("human-action-decision");
        expect(closedDecisionRequest?.status).toBe("closed");
        expect(await fixture.store.listHumanActionRequests({ status: "pending" })).toEqual([]);
        expect(await fixture.store.listHumanActionQueue({ status: "pending" })).toEqual([]);

        await fixture.store.updateHumanActionRequest({
          id: "human-action-decision",
          status: "pending",
          updatedAt: "2026-06-04T00:10:00.000Z"
        });
        const retryApprovalResponse = await fetch(`${baseUrl}/api/approval-requests/${approval.id}/approve`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ comment: "Duplicate click after terminal approval." })
        });
        const retryBody = await retryApprovalResponse.json() as { error?: { code?: string } };
        expect(retryApprovalResponse.status, JSON.stringify(retryBody)).toBe(409);
        expect(retryBody.error?.code).toBe("approval_conflict");
        expect(await fixture.store.getHumanActionRequest("human-action-decision")).toMatchObject({
          status: "closed"
        });
        expect(await fixture.store.listApprovalDecisions(approval.id)).toHaveLength(1);
        expect(await fixture.store.listHumanActionQueue({ status: "pending" })).toEqual([]);
      });
    } finally {
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it("closes approval-owned decision human actions for approval and rejection routes", async () => {
    const fixture = await createStoreFixture();
    try {
      await withApiServer(fixture.store, async (baseUrl) => {
        for (const routeCase of [
          { action: "approve", resultingStatus: "approved", kind: "leader_delegation" },
          { action: "reject", resultingStatus: "rejected", kind: "leader_delegation" }
        ] as const) {
          const approval = await seedStandaloneApprovalRequest(
            fixture.store,
            `terminal-route-${routeCase.action}`,
            {
              kind: routeCase.kind,
              capabilities: resolveApprovalCapabilities(routeCase.kind, "pending")
            }
          );
          const humanActionId = `human-action-terminal-route-${routeCase.action}`;
          await fixture.store.appendHumanActionRequest(createHumanActionRequestFact({
            id: humanActionId,
            responseIntent: "decision_required",
            title: `${routeCase.action} decision needed`,
            approvalRequestId: approval.id
          }));

          const response = await fetch(`${baseUrl}/api/approval-requests/${approval.id}/${routeCase.action}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ comment: `Run ${routeCase.action}.` })
          });
          await readOkJson(response);

          expect(await fixture.store.getApprovalRequest(approval.id)).toMatchObject({
            status: routeCase.resultingStatus
          });
          expect(await fixture.store.getHumanActionRequest(humanActionId)).toMatchObject({
            status: "closed"
          });
          expect(await fixture.store.listHumanActionQueue({ status: "pending" })).not.toEqual(
            expect.arrayContaining([expect.objectContaining({ humanActionRequestId: humanActionId })])
          );
        }
      });
    } finally {
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it("submits chat blueprint proposals through the approval owner and projects an inbox decision", async () => {
    const fixture = await createStoreFixture();
    const blueprint = (await fixture.store.listBlueprints())[0]!;
    try {
      await withApiServer(fixture.store, async (baseUrl) => {
        const created = await readOkJson<{ session: HivewardChatSession }>(await fetch(`${baseUrl}/api/chat/sessions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            harnessId: "codex",
            title: "Blueprint proposal chat",
            mode: "blueprint",
            roleScope: { role: "ceo", blueprintId: blueprint.id }
          })
        }));
        const response = await fetch(`${baseUrl}/api/chat/sessions/${created.session.id}/executive-commands`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            command: {
              action: "submit_blueprint_proposal",
              sourceRole: "ceo",
              payload: {
                blueprintId: blueprint.id,
                title: "3-node OpenClaw blueprint",
                bodyMarkdown: "Manager routes one Agent task and publishes one review-ready output.",
                sourceMessageId: "assistant-message-1"
              }
            }
          })
        });
        const body = await readOkJson<{
          result: {
            action: "submit_blueprint_proposal";
            approvalRequest: ApprovalRequest;
            humanActionRequest: HumanActionRequest;
          };
        }>(response);

        expect(body.result.approvalRequest).toMatchObject({
          kind: "blueprint_proposal",
          status: "pending",
          payloadRef: "chat-message:assistant-message-1",
          sourceRef: { type: "system", id: created.session.id }
        });
        expect(body.result.humanActionRequest).toMatchObject({
          responseIntent: "decision_required",
          status: "pending",
          sourceContextType: "blueprint_governance",
          sourceContextId: blueprint.id,
          approvalRequestId: body.result.approvalRequest.id
        });
        expect(await fixture.store.listHumanActionQueue({ status: "pending" })).toEqual([
          expect.objectContaining({
            title: "3-node OpenClaw blueprint",
            responseIntent: "decision_required",
            approvalRequestId: body.result.approvalRequest.id,
            humanActionRequestId: body.result.humanActionRequest.id
          })
        ]);

        await readOkJson(await fetch(`${baseUrl}/api/approval-requests/${body.result.approvalRequest.id}/approve`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ comment: "Approve the proposal." })
        }));
        expect(await fixture.store.listHumanActionQueue({ status: "pending" })).toEqual([]);
      });
    } finally {
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it("keeps executive decision_required human actions behind the approval owner", async () => {
    const fixture = await createStoreFixture();
    try {
      await withApiServer(fixture.store, async (baseUrl) => {
        const created = await readOkJson<{ session: HivewardChatSession }>(await fetch(`${baseUrl}/api/chat/sessions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ harnessId: "codex", title: "Executive", mode: "chat", roleScope: { role: "ceo" } })
        }));
        const response = await fetch(`${baseUrl}/api/chat/sessions/${created.session.id}/executive-commands`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            command: {
              action: "request_human_action",
              sourceRole: "ceo",
              payload: {
                sourceContextType: "executive_chat",
                responseIntent: "decision_required",
                title: "Forbidden direct decision",
                bodyMarkdown: "This must be created by submit_blueprint_proposal or another approval owner."
              }
            }
          })
        });
        const body = await response.json() as { error?: { code?: string; message?: string } };

        expect(response.status).toBe(400);
        expect(body.error?.code).toBe("executive_decision_human_action_requires_approval_owner");
        expect(await fixture.store.listApprovalRequests()).toEqual([]);
        expect(await fixture.store.listHumanActionRequests()).toEqual([]);
      });
    } finally {
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it("rejects executive human action requests that claim run_room context", async () => {
    const fixture = await createStoreFixture();
    try {
      await withApiServer(fixture.store, async (baseUrl) => {
        const created = await readOkJson<{ session: HivewardChatSession }>(await fetch(`${baseUrl}/api/chat/sessions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ harnessId: "codex", title: "Executive", mode: "chat", roleScope: { role: "ceo" } })
        }));
        const response = await fetch(`${baseUrl}/api/chat/sessions/${created.session.id}/executive-commands`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            command: {
              action: "request_human_action",
              sourceRole: "ceo",
              payload: {
                sourceContextType: "run_room",
                sourceContextId: "run-room-forbidden",
                responseIntent: "decision_required",
                title: "Forbidden",
                bodyMarkdown: "This must not become a run-room request."
              }
            }
          })
        });
        const body = await response.json() as { error?: { code?: string; message?: string } };

        expect(response.status).toBe(400);
        expect(body.error?.code).toBe("executive_command_invalid");
        expect(body.error?.message).toContain("cannot be run_room");
        expect(await fixture.store.listHumanActionRequests()).toEqual([]);
      });
    } finally {
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it("rejects worker dispatch executive command actions", async () => {
    const fixture = await createStoreFixture();
    try {
      await withApiServer(fixture.store, async (baseUrl) => {
        const created = await readOkJson<{ session: HivewardChatSession }>(await fetch(`${baseUrl}/api/chat/sessions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ harnessId: "codex", title: "Executive", mode: "chat", roleScope: { role: "ceo" } })
        }));
        for (const action of ["dispatch_worker_task", "dispatch_worker_tasks"]) {
          const response = await fetch(`${baseUrl}/api/chat/sessions/${created.session.id}/executive-commands`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ command: { action, sourceRole: "ceo", payload: {} } })
          });
          const body = await response.json() as { error?: { message?: string } };
          expect(response.status).toBe(400);
          expect(body.error?.message).toContain("cannot dispatch WorkerTask");
        }
        expect(await fixture.store.listWorkerTasks()).toEqual([]);
      });
    } finally {
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it("rejects malformed executive command payloads without repairing them", async () => {
    const fixture = await createStoreFixture();
    const blueprint = (await fixture.store.listBlueprints())[0]!;
    try {
      await withApiServer(fixture.store, async (baseUrl) => {
        const created = await readOkJson<{ session: HivewardChatSession }>(await fetch(`${baseUrl}/api/chat/sessions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ harnessId: "codex", title: "Executive", mode: "chat", roleScope: { role: "ceo" } })
        }));
        const response = await fetch(`${baseUrl}/api/chat/sessions/${created.session.id}/executive-commands`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            command: {
              action: "start_blueprint_run",
              sourceRole: "ceo",
              payload: `{"blueprintId":"${blueprint.id}"}}`
            }
          })
        });
        const body = await response.json() as { error?: { code?: string; message?: string } };

        expect(response.status).toBe(400);
        expect(body.error?.code).toBe("executive_command_invalid");
        expect(body.error?.message).toContain("payload must be a JSON object");
        expect(await fixture.store.listRunRooms()).toEqual([]);
        expect(await fixture.store.listWorkerTasks()).toEqual([]);
      });
    } finally {
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it("proxies native chat history without materializing hiveward-inbox markdown", async () => {
    const fixture = await createStoreFixture();
    const blueprint = (await fixture.store.listBlueprints())[0]!;
    const now = new Date().toISOString();
    const output = [
      "I prepared the package for approval.",
      "```hiveward-inbox",
      JSON.stringify({
        schema: historicalInboxSubmissionSchema,
        type: "blueprint_proposal",
        blueprintId: blueprint.id,
        title: "History synced blueprint package",
        summary: "Created from a native runtime history response."
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
        const response = await fetch(`${baseUrl}/api/chat/history?sessionKey=${encodeURIComponent("agent:main:dashboard:history-sync")}`);
        const body = await readOkJson<{
          messages: Array<{ role: string; content: string }>;
          inboxItems?: unknown[];
        }>(response);

        expect(body.messages[1]?.content).toContain("I prepared the package for approval.");
        expect(body.messages[1]?.content).toContain("hiveward-inbox");
        expect(body.inboxItems).toBeUndefined();
        expectOldInboxNormalStoreSurfaceDeleted(fixture.store);
        expect(await fixture.store.listApprovalRequests()).toEqual([]);
      }, adapter);
    } finally {
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it("creates native chat sessions through the runtime adapter", async () => {
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

  it("updates native chat session titles through the runtime adapter", async () => {
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

  it("persists skill split chat mode on HiveWard chat sessions", async () => {
    const fixture = await createStoreFixture();
    try {
      await withApiServer(fixture.store, async (baseUrl) => {
        const createResponse = await fetch(`${baseUrl}/api/chat/sessions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            harnessId: "codex",
            title: "Skill split",
            mode: "skill_split"
          })
        });
        const created = await readOkJson<{ session: HivewardChatSession }>(createResponse);

        expect(created.session.mode).toBe("skill_split");

        const readResponse = await fetch(`${baseUrl}/api/chat/sessions/${created.session.id}`);
        const readBack = await readOkJson<{ session: HivewardChatSession }>(readResponse);

        expect(readBack.session.mode).toBe("skill_split");
      });
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

        const messages = await readOkJson<{ messages: AgentOutputEvent[] }>(
          await fetch(`${baseUrl}/api/chat/sessions/${created.session.id}/messages`)
        );
        expect(messages.messages.map((message) => [message.kind, message.metadata?.role])).toEqual([
          ["message_completed", "user"],
          ["message_started", "assistant"],
          ["message_delta", "assistant"],
          ["message_completed", "assistant"],
          ["message_completed", "user"],
          ["message_started", "assistant"],
          ["message_delta", "assistant"],
          ["message_completed", "assistant"]
        ]);
        expect(messages.messages[3]).toMatchObject({
          kind: "message_completed",
          bodyMarkdown: "codex persisted response",
          metadata: {
            harnessId: "codex"
          }
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

function createRunRoomFact(overrides: Partial<RunRoom> = {}): RunRoom {
  return {
    id: "run-room-test",
    companyId: "company-1",
    blueprintId: "blueprint-1",
    status: "open",
    createdAt: "2026-06-04T00:00:00.000Z",
    updatedAt: "2026-06-04T00:00:00.000Z",
    ...overrides
  };
}

function createHumanActionRequestFact(overrides: Partial<HumanActionRequest> = {}): HumanActionRequest {
  return {
    id: "human-action-request-test",
    sourceContextType: "executive_chat",
    sourceContextId: "chat-session-test",
    responseIntent: "reply_required",
    status: "pending",
    title: "Human action required",
    bodyMarkdown: "Please respond.",
    createdAt: "2026-06-04T00:00:00.000Z",
    updatedAt: "2026-06-04T00:00:00.000Z",
    ...overrides
  };
}

async function createStoreFixture(): Promise<{ dir: string; store: FileHivewardStore }> {
  const dir = mkdtempSync(join(tmpdir(), "hiveward-api-"));
  const store = new FileHivewardStore(join(dir, "hiveward-store.json"));
  await store.init();
  return { dir, store };
}

function expectOldInboxNormalStoreSurfaceDeleted(store: FileHivewardStore): void {
  const oldSurface = store as unknown as {
    listInboxItems?: unknown;
    createLeaderDelegationRequest?: unknown;
    createBlueprintProposal?: unknown;
  };
  expect(oldSurface.listInboxItems).toBeUndefined();
  expect(oldSurface.createLeaderDelegationRequest).toBeUndefined();
  expect(oldSurface.createBlueprintProposal).toBeUndefined();
}

async function seedRunApprovalRequest(store: FileHivewardStore, runId: string, nodeRunId: string): Promise<ApprovalRequest> {
  const now = new Date().toISOString();
  const request: ApprovalRequest = {
    id: `approval-${nodeRunId}`,
    runId,
    nodeRunId,
    kind: "agent_proposal",
    status: "pending",
    title: `${nodeRunId} approval`,
    body: "Review output",
    sourceRef: { type: "node_run", id: nodeRunId },
    threadId: `thread-${nodeRunId}`,
    revision: 1,
    capabilities: resolveApprovalCapabilities("agent_proposal", "pending"),
    requestedBy: {
      type: "node",
      label: nodeRunId,
      nodeId: nodeRunId
    },
    requestedAt: now,
    updatedAt: now
  };
  return store.upsertApprovalRequest(request);
}

async function seedStandaloneApprovalRequest(
  store: FileHivewardStore,
  id: string,
  overrides: Partial<ApprovalRequest> = {}
): Promise<ApprovalRequest> {
  const now = new Date().toISOString();
  const request: ApprovalRequest = {
    id,
    runId: id,
    kind: "leader_delegation",
    status: "pending",
    title: "Standalone approval",
    body: "Approve the standalone request.",
    sourceRef: { type: "system", id },
    threadId: `thread-${id}`,
    revision: 1,
    capabilities: resolveApprovalCapabilities("leader_delegation", "pending"),
    requestedBy: {
      type: "role",
      label: "ceo",
      roleId: "ceo"
    },
    requestedAt: now,
    updatedAt: now,
    ...overrides
  };
  return store.upsertApprovalRequest(request);
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
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const statusCode = typeof error === "object" && error !== null && "statusCode" in error &&
      typeof (error as { statusCode?: unknown }).statusCode === "number"
      ? (error as { statusCode: number }).statusCode
      : 500;
    const code = typeof error === "object" && error !== null && "code" in error &&
      typeof (error as { code?: unknown }).code === "string"
      ? (error as { code: string }).code
      : "internal_error";
    const message = error instanceof Error ? error.message : "Unexpected API failure.";
    res.status(statusCode).json({ error: { code, message } });
  });

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

async function waitForRunsSettled(store: FileHivewardStore, runIds: string[]): Promise<void> {
  const activeStatuses: BlueprintRun["status"][] = ["queued", "running", "waiting_approval"];
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const runs = await Promise.all(runIds.map((runId) => store.getBlueprintRun(runId)));
    if (runs.every((run) => run && !activeStatuses.includes(run.status))) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const runs = await Promise.all(runIds.map((runId) => store.getBlueprintRun(runId)));
  throw new Error(`Runs did not settle before fixture cleanup: ${runs.map((run) => `${run?.id}:${run?.status}`).join(", ")}`);
}

type SseFrame = {
  event: string;
  data: RunRoomOutputStreamEvent;
};

type SseReader = {
  reader: ReadableStreamDefaultReader<Uint8Array>;
  decoder: TextDecoder;
  buffer: string;
};

function createSseReader(response: Response): SseReader {
  if (!response.body) {
    throw new Error("SSE response did not include a body.");
  }
  return {
    reader: response.body.getReader(),
    decoder: new TextDecoder(),
    buffer: ""
  };
}

async function readUntilSseEvent(reader: SseReader, eventName: string): Promise<SseFrame> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const frame = await readNextSseFrame(reader);
    if (frame.event === eventName) return frame;
  }
  throw new Error(`SSE event was not received: ${eventName}`);
}

async function readNextSseFrame(state: SseReader): Promise<SseFrame> {
  for (;;) {
    const separatorIndex = state.buffer.indexOf("\n\n");
    if (separatorIndex >= 0) {
      const rawFrame = state.buffer.slice(0, separatorIndex);
      state.buffer = state.buffer.slice(separatorIndex + 2);
      return parseSseFrame(rawFrame);
    }
    const chunk = await readStreamChunkWithTimeout(state.reader);
    if (chunk.done) {
      throw new Error("SSE stream closed before the next frame.");
    }
    state.buffer += state.decoder.decode(chunk.value, { stream: true }).replace(/\r\n/g, "\n");
  }
}

async function readStreamChunkWithTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs = 3000
): Promise<ReadableStreamReadResult<Uint8Array>> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      reader.read(),
      new Promise<ReadableStreamReadResult<Uint8Array>>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Timed out waiting for SSE frame.")), timeoutMs);
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function parseSseFrame(rawFrame: string): SseFrame {
  const lines = rawFrame.split("\n");
  const event = lines.find((line) => line.startsWith("event: "))?.slice("event: ".length);
  const data = lines
    .filter((line) => line.startsWith("data: "))
    .map((line) => line.slice("data: ".length))
    .join("\n");
  if (!event || !data) {
    throw new Error(`Invalid SSE frame: ${rawFrame}`);
  }
  return { event, data: JSON.parse(data) as RunRoomOutputStreamEvent };
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
  permissionMode?: HivewardChatSession["permissionMode"];
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
      permissionMode: input.permissionMode,
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
      permissionMode: input.permissionMode,
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

function writeFakeExecutable(path: string, output: string): void {
  if (process.platform === "win32") {
    writeFileSync(`${path}.cmd`, `@echo off\r\necho ${output}\r\n`, "utf8");
    return;
  }
  writeFileSync(path, `#!/bin/sh\nprintf '%s\\n' '${output}'\n`, "utf8");
  chmodSync(path, 0o755);
}

function writeFakeHermesExecutable(
  path: string,
  options: { allowProfileWrites?: boolean; profileRows?: string[] } = {}
): void {
  const profileRows = options.profileRows ?? [
    " Profile          Model                        Gateway      Alias        Distribution",
    "\u25c6ceo             hermes-primary-test            stopped      hw-ceo       \u2014",
    " architect       hermes-profile-model-test                      stopped      \u2014            \u2014",
    " researcher      hermes-research-model-test      stopped      -            \u2014"
  ];
  const scriptPath = `${path}.js`;
  const script = [
    "const args = process.argv.slice(2);",
    "if (args[0] === \"--version\") { console.log(\"hermes 0.9.0\"); process.exit(0); }",
    "if (args[0] === \"profile\" && args[1] === \"list\") {",
    ...profileRows.map((row) => `  console.log(${JSON.stringify(row)});`),
    "  process.exit(0);",
    "}",
    options.allowProfileWrites
      ? "if (args[0] === \"profile\" && (args[1] === \"create\" || args[1] === \"alias\")) process.exit(0);"
      : "",
    "process.exit(1);"
  ].filter(Boolean).join("\n");
  writeFileSync(scriptPath, script, "utf8");
  if (process.platform === "win32") {
    writeFileSync(`${path}.cmd`, `@echo off\r\nnode "${scriptPath}" %*\r\n`, "utf8");
    return;
  }
  writeFileSync(path, `#!/bin/sh\nnode '${scriptPath.replace(/'/g, "'\\''")}' "$@"\n`, "utf8");
  chmodSync(path, 0o755);
}
