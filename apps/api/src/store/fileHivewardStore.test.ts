import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { BlueprintDefinition, BlueprintNode, BlueprintNodeRun } from "@hiveward/shared";
import { createBlankBlueprint } from "@hiveward/shared";
import { FileHivewardStore } from "./fileHivewardStore";

describe("FileHivewardStore blueprint node sanitization", () => {
  it("strips removed standalone nodes from saved blueprints and run archives", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hiveward-store-"));
    const store = new FileHivewardStore(join(dir, "hiveward-store.json"));
    await store.init();

    const dirtyBlueprint = createDirtyBlueprint(new Date().toISOString());
    const saved = await store.saveBlueprint(dirtyBlueprint);

    expect(saved.nodes.map((node) => node.type)).toEqual(["agent"]);
    expect(saved.edges).toEqual([]);
    await expect(store.getBlueprint(dirtyBlueprint.id)).resolves.toMatchObject({
      nodes: [{ id: "draft", type: "agent" }],
      edges: []
    });

    const run = await store.createBlueprintRun(dirtyBlueprint, "tester");
    await store.upsertNodeRun(createNodeRun(run.id, dirtyBlueprint.id, "draft", "agent", "succeeded"));
    await store.upsertNodeRun(createNodeRun(run.id, dirtyBlueprint.id, "approval", "approval", "waiting_approval"));
    await store.appendEvent({
      id: "event-approval",
      blueprintRunId: run.id,
      nodeRunId: "node-run-approval",
      type: "node.run.waiting_approval",
      message: "Old approval node waiting.",
      createdAt: new Date().toISOString()
    });

    await expect(store.listNodeRuns(run.id)).resolves.toMatchObject([
      { nodeId: "draft", nodeType: "agent" }
    ]);
    await expect(store.listPendingApprovals()).resolves.toEqual([]);
    await expect(store.getRunView(run.id)).resolves.toMatchObject({
      nodeRuns: [{ nodeId: "draft", nodeType: "agent" }],
      events: []
    });
    await expect(store.listRunArchives()).resolves.toMatchObject([
      {
        blueprintSnapshot: {
          nodes: [{ id: "draft", type: "agent" }],
          edges: []
        },
        nodeRuns: [{ nodeId: "draft", nodeType: "agent" }]
      }
    ]);
  });
});

describe("FileHivewardStore chat storage isolation", () => {
  it("migrates legacy chat fields into a dedicated chat store and cleans the main store", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hiveward-store-"));
    const storePath = join(dir, "hiveward-store.json");
    const chatStorePath = join(dir, "hiveward-chat-store.json");
    const now = new Date().toISOString();

    writeFileSync(storePath, JSON.stringify({
      schema: "hiveward.store-index/v1",
      companies: [{
        id: "company-hiveward-studio",
        name: "Hiveward Studio",
        logoLabel: "HW",
        businessGoal: "Keep storage boundaries clean.",
        createdAt: now,
        updatedAt: now
      }],
      selectedCompanyId: "company-hiveward-studio",
      blueprintIndex: [],
      runIndex: [],
      companyDashboards: {},
      roleDirectories: {},
      inboxItems: {},
      chatSessions: [{
        id: "chat-session-legacy",
        companyId: "company-hiveward-studio",
        harnessId: "codex",
        title: "Legacy chat",
        mode: "chat",
        status: "active",
        createdAt: now,
        updatedAt: now
      }],
      chatMessages: {
        "chat-session-legacy": [
          {
            id: "chat-message-user",
            sessionId: "chat-session-legacy",
            role: "user",
            content: "Build the plan.",
            harnessId: "codex",
            status: "sent",
            createdAt: now
          },
          {
            id: "chat-message-assistant",
            sessionId: "chat-session-legacy",
            role: "assistant",
            content: "Plan ready.",
            harnessId: "codex",
            status: "sent",
            createdAt: now
          }
        ]
      }
    }, null, 2));

    const store = new FileHivewardStore(storePath);
    await store.init();

    const mainStore = JSON.parse(readFileSync(storePath, "utf8")) as Record<string, unknown>;
    const chatStore = JSON.parse(readFileSync(chatStorePath, "utf8")) as {
      schema?: string;
      chatSessions?: Array<{ id: string; title: string }>;
      chatMessages?: Record<string, Array<{ id: string; content: string }>>;
    };

    expect(mainStore.chatSessions).toBeUndefined();
    expect(mainStore.chatMessages).toBeUndefined();
    expect(chatStore.schema).toBe("hiveward.chat-store/v1");
    expect(chatStore.chatSessions).toEqual([
      expect.objectContaining({ id: "chat-session-legacy", title: "Legacy chat" })
    ]);
    expect(chatStore.chatMessages?.["chat-session-legacy"]?.map((message) => message.content)).toEqual([
      "Build the plan.",
      "Plan ready."
    ]);
    await expect(store.listChatMessages("chat-session-legacy")).resolves.toHaveLength(2);
  });

  it("drops legacy chat sessions for unknown companies instead of assigning them to the default company", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hiveward-store-"));
    const storePath = join(dir, "hiveward-store.json");
    const chatStorePath = join(dir, "hiveward-chat-store.json");
    const now = new Date().toISOString();

    writeFileSync(storePath, JSON.stringify({
      schema: "hiveward.store-index/v1",
      companies: [{
        id: "company-hiveward-studio",
        name: "Hiveward Studio",
        logoLabel: "HW",
        businessGoal: "Keep storage boundaries clean.",
        createdAt: now,
        updatedAt: now
      }],
      selectedCompanyId: "company-hiveward-studio",
      blueprintIndex: [],
      runIndex: [],
      companyDashboards: {},
      roleDirectories: {},
      inboxItems: {},
      chatSessions: [
        {
          id: "chat-session-valid",
          companyId: "company-hiveward-studio",
          harnessId: "codex",
          title: "Valid chat",
          mode: "chat",
          status: "active",
          createdAt: now,
          updatedAt: now
        },
        {
          id: "chat-session-unknown-company",
          companyId: "company-deleted",
          harnessId: "codex",
          title: "Orphaned chat",
          mode: "chat",
          status: "active",
          createdAt: now,
          updatedAt: now
        }
      ],
      chatMessages: {
        "chat-session-valid": [createStoredChatMessage("chat-session-valid", 1, new Date(now))],
        "chat-session-unknown-company": [createStoredChatMessage("chat-session-unknown-company", 2, new Date(now))]
      }
    }, null, 2));

    const store = new FileHivewardStore(storePath);
    await store.init();

    const chatStore = JSON.parse(readFileSync(chatStorePath, "utf8")) as {
      chatSessions?: Array<{ id: string; companyId: string }>;
      chatMessages?: Record<string, Array<{ content: string }>>;
    };

    expect(chatStore.chatSessions).toEqual([
      expect.objectContaining({ id: "chat-session-valid", companyId: "company-hiveward-studio" })
    ]);
    expect(chatStore.chatMessages?.["chat-session-valid"]).toHaveLength(1);
    expect(chatStore.chatMessages?.["chat-session-unknown-company"]).toBeUndefined();
    await expect(store.listChatMessages("chat-session-unknown-company")).resolves.toEqual([]);
  });

  it("keeps chat writes out of the main store file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hiveward-store-"));
    const storePath = join(dir, "hiveward-store.json");
    const chatStorePath = join(dir, "hiveward-chat-store.json");
    const store = new FileHivewardStore(storePath);
    await store.init();

    const session = await store.createChatSession({ harnessId: "codex", title: "Storage boundary" });
    const mainBefore = readFileSync(storePath, "utf8");
    await store.appendChatMessage({
      sessionId: session.id,
      role: "user",
      content: "This should only touch chat storage.",
      harnessId: "codex",
      status: "sent"
    });

    expect(readFileSync(storePath, "utf8")).toBe(mainBefore);
    const chatStore = JSON.parse(readFileSync(chatStorePath, "utf8")) as {
      chatMessages?: Record<string, Array<{ content: string }>>;
    };
    expect(chatStore.chatMessages?.[session.id]?.[0]?.content).toBe("This should only touch chat storage.");
  });

  it("keeps config writes out of the chat store file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hiveward-store-"));
    const storePath = join(dir, "hiveward-store.json");
    const chatStorePath = join(dir, "hiveward-chat-store.json");
    const store = new FileHivewardStore(storePath);
    await store.init();
    await store.createChatSession({ harnessId: "codex", title: "Stable chat file" });
    const chatBefore = readFileSync(chatStorePath, "utf8");

    const now = new Date().toISOString();
    await store.saveBlueprint(createBlankBlueprint({
      id: "config-only-blueprint",
      companyId: "company-hiveward-studio",
      now,
      name: "Config only blueprint"
    }));

    expect(readFileSync(chatStorePath, "utf8")).toBe(chatBefore);
  });

  it("deletes a company's chat records from the dedicated chat store", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hiveward-store-"));
    const storePath = join(dir, "hiveward-store.json");
    const chatStorePath = join(dir, "hiveward-chat-store.json");
    const store = new FileHivewardStore(storePath);
    await store.init();

    const created = await store.createCompany({ name: "Disposable Company" });
    const companyId = created.selectedCompanyId!;
    const session = await store.createChatSession({ harnessId: "codex", title: "Disposable chat" });
    await store.appendChatMessage({
      sessionId: session.id,
      role: "user",
      content: "Delete me with the company.",
      harnessId: "codex",
      status: "sent"
    });

    await store.deleteCompany(companyId);

    const chatStore = JSON.parse(readFileSync(chatStorePath, "utf8")) as {
      chatSessions?: Array<{ id: string }>;
      chatMessages?: Record<string, unknown>;
    };
    expect(chatStore.chatSessions?.some((candidate) => candidate.id === session.id)).toBe(false);
    expect(chatStore.chatMessages?.[session.id]).toBeUndefined();
  });

  it("keeps only the newest 60 visible messages per chat session", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hiveward-store-"));
    const storePath = join(dir, "hiveward-store.json");
    const store = new FileHivewardStore(storePath);
    await store.init();

    const session = await store.createChatSession({ harnessId: "codex", title: "Retention" });
    for (let index = 1; index <= 65; index += 1) {
      await store.appendChatMessage({
        sessionId: session.id,
        role: "user",
        content: `message ${index}`,
        harnessId: "codex",
        status: "sent"
      });
    }

    const messages = await store.listChatMessages(session.id);
    expect(messages).toHaveLength(60);
    expect(messages[0]?.content).toBe("message 6");
    expect(messages[59]?.content).toBe("message 65");
  });

  it("applies the message retention limit after merging existing and legacy chat stores", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hiveward-store-"));
    const storePath = join(dir, "hiveward-store.json");
    const chatStorePath = join(dir, "hiveward-chat-store.json");
    const now = new Date("2026-05-26T00:00:00.000Z");
    const company = {
      id: "company-hiveward-studio",
      name: "Hiveward Studio",
      logoLabel: "HW",
      businessGoal: "Keep storage boundaries clean.",
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    };
    const session = {
      id: "chat-session-merge",
      companyId: company.id,
      harnessId: "codex",
      title: "Merge retention",
      mode: "chat",
      status: "active",
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    };

    writeFileSync(chatStorePath, JSON.stringify({
      schema: "hiveward.chat-store/v1",
      chatSessions: [session],
      chatMessages: {
        [session.id]: Array.from({ length: 40 }, (_, index) => createStoredChatMessage(session.id, index + 1, now))
      }
    }, null, 2));
    writeFileSync(storePath, JSON.stringify({
      schema: "hiveward.store-index/v1",
      companies: [company],
      selectedCompanyId: company.id,
      blueprintIndex: [],
      runIndex: [],
      companyDashboards: {},
      roleDirectories: {},
      inboxItems: {},
      chatSessions: [session],
      chatMessages: {
        [session.id]: Array.from({ length: 40 }, (_, index) => createStoredChatMessage(session.id, index + 41, now))
      }
    }, null, 2));

    const store = new FileHivewardStore(storePath);
    await store.init();

    const messages = await store.listChatMessages(session.id);
    const chatStore = JSON.parse(readFileSync(chatStorePath, "utf8")) as {
      chatMessages?: Record<string, Array<{ content: string }>>;
    };
    expect(messages).toHaveLength(60);
    expect(messages[0]?.content).toBe("message 21");
    expect(messages[59]?.content).toBe("message 80");
    expect(chatStore.chatMessages?.[session.id]).toHaveLength(60);
    expect(chatStore.chatMessages?.[session.id]?.[0]?.content).toBe("message 21");
  });
});

function createDirtyBlueprint(now: string): BlueprintDefinition {
  const blueprint = createBlankBlueprint({
    id: "dirty-blueprint",
    companyId: "company-hiveward-studio",
    now,
    name: "Dirty legacy blueprint"
  });
  return {
    ...blueprint,
    nodes: [
      {
        id: "draft",
        type: "agent",
        runtimeId: "openclaw",
        position: { x: 0, y: 0 },
        config: {
          label: "Draft",
          openclawAgentId: "main",
          agentName: "writer",
          prompt: "Write the draft.",
          tools: []
        }
      },
      createRemovedNode("approval", "approval"),
      createRemovedNode("send", "send"),
      createRemovedNode("parallel", "parallel_agents")
    ],
    edges: [
      { id: "edge-draft-approval", source: "draft", target: "approval" },
      { id: "edge-approval-send", source: "approval", target: "send" },
      { id: "edge-send-parallel", source: "send", target: "parallel" }
    ]
  };
}

function createRemovedNode(id: string, type: string): BlueprintNode {
  return {
    id,
    type,
    position: { x: 0, y: 0 },
    config: {
      label: id
    }
  } as unknown as BlueprintNode;
}

function createNodeRun(
  blueprintRunId: string,
  blueprintId: string,
  nodeId: string,
  nodeType: string,
  status: BlueprintNodeRun["status"]
): BlueprintNodeRun {
  return {
    id: `node-run-${nodeId}`,
    blueprintRunId,
    blueprintId,
    nodeId,
    nodeLabel: nodeId,
    nodeType,
    status,
    queuedAt: new Date().toISOString(),
    ...(status === "succeeded" ? { output: `${nodeId} output` } : {})
  } as unknown as BlueprintNodeRun;
}

function createStoredChatMessage(sessionId: string, index: number, start: Date): {
  id: string;
  sessionId: string;
  role: "user";
  content: string;
  harnessId: "codex";
  status: "sent";
  createdAt: string;
} {
  return {
    id: `chat-message-${index}`,
    sessionId,
    role: "user",
    content: `message ${index}`,
    harnessId: "codex",
    status: "sent",
    createdAt: new Date(start.getTime() + index * 1000).toISOString()
  };
}
