# Chat Store Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move HiveWard visible chat history out of `data/hiveward-store.json` into a dedicated `data/hiveward-chat-store.json`, migrate old data safely, and keep long-term storage boundaries clean.

**Architecture:** `FileHivewardStore` remains the public store facade used by routes and workers. Main business configuration stays in `hiveward-store.json`; a new `FileHivewardChatStore` owns chat sessions and visible chat messages. Startup migration imports legacy `chatSessions` and `chatMessages` from the main file into the chat file, then rewrites the main file without chat fields.

**Tech Stack:** TypeScript, Node.js `fs/promises`, Vitest, existing JSON safe-write pattern with temporary file plus rename.

---

## Engineering Intent

HiveWard should save product-level facts, not harness-internal transcripts. The platform stores visible chat turns, final node inputs and outputs, statuses, runtime refs, usage, and timing summaries. It must not store hidden reasoning, raw tool calls, or provider-native transcripts unless a future explicit trace feature is designed separately.

The clean final shape is:

```text
data/
  hiveward-store.json          # companies, selected company, blueprint index, run index, dashboards, roles, inbox, catalog
  hiveward-chat-store.json     # visible chat sessions and visible chat messages only
  blueprints/*.json            # full blueprint definitions
  runs/*.json                  # run archives with node input/output/status/ref/usage
```

The migration rule is conservative:

1. Read and normalize the old main store.
2. If legacy chat fields exist, merge them into the dedicated chat store.
3. Write the chat store with a safe temporary-file rename.
4. Rewrite the main store without `chatSessions` and `chatMessages`.
5. If chat-store writing fails, do not clean the legacy fields from the main file.

After migration, normal chat writes must only touch `hiveward-chat-store.json`; normal config writes must only touch `hiveward-store.json`.

## File Structure

- Create `apps/api/src/store/jsonFile.ts`
  - Owns shared JSON helpers: `safeWriteJson` and `isFileNotFoundError`.
  - Keeps safe file writing consistent across main, chat, blueprint, and run archive files.

- Create `apps/api/src/store/fileHivewardChatStore.ts`
  - Owns `hiveward.chat-store/v1`.
  - Owns chat normalization, ID creation, visible-message retention, and chat-only write operations.
  - Default retention: keep the newest 60 messages per session.
  - Does not know about blueprints, runs, dashboards, inbox, or role-directory internals.

- Modify `apps/api/src/store/fileHivewardStore.ts`
  - Remove long-term chat fields from `HivewardStoreIndex`.
  - Keep optional legacy chat fields only in raw input types for migration.
  - Construct `FileHivewardChatStore` beside the main store file.
  - Route chat methods to `FileHivewardChatStore`.
  - Keep role-scope validation in the main facade because it depends on company roles and blueprints.
  - Delete chat for a company through the chat store when deleting that company.

- Modify `apps/api/src/store/fileHivewardStore.test.ts`
  - Add storage-boundary and migration tests.
  - These tests must fail before implementation.

## Task 1: Failing Tests For Migration And Storage Boundaries

**Files:**
- Modify: `apps/api/src/store/fileHivewardStore.test.ts`

- [ ] **Step 1: Add imports for file reads and writes**

Change the first import from:

```ts
import { mkdtempSync } from "node:fs";
```

to:

```ts
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
```

- [ ] **Step 2: Add tests below the existing describe block**

Add a second describe block named `FileHivewardStore chat storage isolation` with these tests:

```ts
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
});
```

- [ ] **Step 3: Run the new tests and verify failure**

Run:

```bash
npm test -- apps/api/src/store/fileHivewardStore.test.ts
```

Expected before implementation:

- The migration test fails because `hiveward-chat-store.json` does not exist.
- The main-store isolation test fails because appending a chat message rewrites `hiveward-store.json`.
- The retention test fails because all 65 messages are still present.

## Task 2: Shared JSON Safe-Write Helper

**Files:**
- Create: `apps/api/src/store/jsonFile.ts`
- Modify: `apps/api/src/store/fileHivewardStore.ts`

- [ ] **Step 1: Create `jsonFile.ts`**

```ts
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { nanoid } from "nanoid";

export async function safeWriteJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${nanoid(8)}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tempPath, filePath);
}

export function isFileNotFoundError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "ENOENT";
}
```

- [ ] **Step 2: Import the helper in `fileHivewardStore.ts`**

Add:

```ts
import { isFileNotFoundError, safeWriteJson } from "./jsonFile";
```

Remove `rename` and `writeFile` from the `node:fs/promises` import if they are no longer used there.

- [ ] **Step 3: Remove local duplicate helper functions**

Delete the local `safeWriteJson` function and the local `isFileNotFoundError` function from `fileHivewardStore.ts`.

- [ ] **Step 4: Run existing store tests**

Run:

```bash
npm test -- apps/api/src/store/fileHivewardStore.test.ts
```

Expected:

- The new tests still fail for the known reasons from Task 1.
- Existing blueprint sanitization behavior should not regress.

## Task 3: Dedicated Chat Store

**Files:**
- Create: `apps/api/src/store/fileHivewardChatStore.ts`

- [ ] **Step 1: Add the chat store class**

Create `FileHivewardChatStore` with:

```ts
const chatStoreSchema = "hiveward.chat-store/v1";
const defaultMaxMessagesPerSession = 60;

interface HivewardChatStoreState {
  schema: typeof chatStoreSchema;
  chatSessions: HivewardChatSession[];
  chatMessages: Record<string, HivewardChatMessage[]>;
}

export interface LegacyHivewardChatState {
  chatSessions?: unknown;
  chatMessages?: unknown;
}
```

Constructor:

```ts
constructor(
  private readonly filePath: string,
  private readonly maxMessagesPerSession = defaultMaxMessagesPerSession
) {}
```

- [ ] **Step 2: Implement initialization and migration merge**

Implement:

```ts
async init(companies: CompanyProfile[], legacyChat?: LegacyHivewardChatState): Promise<void>
```

Rules:

- If chat file exists, normalize it.
- If chat file is missing, start with an empty chat state.
- If legacy chat is present, normalize it with the same company list and merge by session id and message id.
- Write the merged chat state through `safeWriteJson`.
- Do not persist any raw fields outside `chatSessions` and `chatMessages`.

- [ ] **Step 3: Implement chat methods**

Implement these public methods with the same semantics the facade currently exposes:

```ts
listChatSessions(companyId: string): Promise<HivewardChatSession[]>
getChatSession(companyId: string, id: string): Promise<HivewardChatSession | undefined>
findChatSessionByNative(companyId: string, input: { harnessId: HarnessId; nativeSessionId: string }): Promise<HivewardChatSession | undefined>
createChatSession(companyId: string, input: CreateHivewardChatSessionRequest & { roleScope?: ChatRoleScope }): Promise<HivewardChatSession>
updateChatSession(companyId: string, id: string, patch: UpdateHivewardChatSessionRequest & { roleScope?: ChatRoleScope }): Promise<HivewardChatSession | undefined>
endChatSession(companyId: string, id: string): Promise<HivewardChatSession | undefined>
listChatMessages(companyId: string, sessionId: string): Promise<HivewardChatMessage[]>
appendChatMessage(companyId: string | undefined, input: Omit<HivewardChatMessage, "id" | "createdAt" | "updatedAt"> & { id?: string; createdAt?: string; updatedAt?: string }): Promise<HivewardChatMessage>
updateChatMessage(companyId: string | undefined, sessionId: string, messageId: string, patch: Partial<Pick<HivewardChatMessage, "content" | "status" | "runtimeRef" | "nativeMessageId" | "modelId">>): Promise<HivewardChatMessage | undefined>
deleteCompanyChats(companyId: string): Promise<void>
```

- [ ] **Step 4: Implement retention**

Add a private `enforceMessageRetention` method:

```ts
private enforceMessageRetention(state: HivewardChatStoreState, sessionId: string): void
```

It sorts the session messages by `createdAt`, keeps only the last `maxMessagesPerSession`, and writes them back. It keeps only visible HiveWard message records; it does not add raw provider events, tool calls, or reasoning fields.

- [ ] **Step 5: Keep helper functions private to the chat store**

Move or re-create chat-only helpers in `fileHivewardChatStore.ts`:

- `normalizeChatSessions`
- `normalizeChatMessages`
- `normalizeChatMessage`
- `normalizeHarnessId`
- `normalizeChatMode`
- `normalizeChatThinkingEffort`
- `normalizeChatSessionStatus`
- `normalizeNativeSessionState`
- `normalizeChatMessageRole`
- `normalizeChatMessageStatus`
- `normalizeStoredChatAttachments`
- `normalizeChatRuntimeRef`
- `deriveChatSessionTitle`
- `nextChatSessionId`
- `nextChatMessageId`

- [ ] **Step 6: Run the tests**

Run:

```bash
npm test -- apps/api/src/store/fileHivewardStore.test.ts
```

Expected:

- Tests may still fail until the facade routes to the new chat store in Task 4.
- TypeScript errors about unused helpers in `fileHivewardStore.ts` are acceptable until Task 4 cleanup.

## Task 4: Route Chat Facade Methods To The Dedicated Chat Store

**Files:**
- Modify: `apps/api/src/store/fileHivewardStore.ts`

- [ ] **Step 1: Remove chat from the long-term main index type**

Change `HivewardStoreIndex` so it no longer contains:

```ts
chatSessions: HivewardChatSession[];
chatMessages: Record<string, HivewardChatMessage[]>;
```

Keep these fields only as optional legacy input in `RawHivewardStoreIndex` and `LegacyHivewardStoreState`.

- [ ] **Step 2: Add chat-store construction**

Add:

```ts
private readonly chatStore: FileHivewardChatStore;
```

In the constructor, set:

```ts
this.chatStore = new FileHivewardChatStore(join(this.dataDir, "hiveward-chat-store.json"));
```

- [ ] **Step 3: Add a legacy-chat-aware index reader**

Create:

```ts
private async readIndexWithLegacyChatUnlocked(): Promise<{
  index: HivewardStoreIndex;
  legacyChat?: LegacyHivewardChatState;
}>
```

For current-schema files, return normalized main index and legacy chat fields if present.

For pre-index legacy files, reuse migration logic and return legacy chat fields from the old state.

Normal `readIndexUnlocked()` should return only the normalized main index.

- [ ] **Step 4: Initialize chat store before cleaning legacy fields**

In `init()`:

```ts
const { index, legacyChat } = await this.readIndexWithLegacyChatUnlocked();
await this.chatStore.init(index.companies, legacyChat);
await this.writeIndexUnlocked(index);
```

For brand-new stores, create the main index without chat fields, then initialize an empty chat store.

- [ ] **Step 5: Route chat methods through `chatStore`**

For each chat method:

- Read the main index only to resolve the selected company and validate role scope.
- Call the matching `this.chatStore.*` method.
- Do not mutate or write `HivewardStoreIndex` for chat-only operations.

Examples:

```ts
async listChatSessions(): Promise<HivewardChatSession[]> {
  return this.enqueue(async () => {
    const index = await this.readIndexUnlocked();
    const companyId = this.getCurrentCompanyId(index);
    if (!companyId) return [];
    return this.chatStore.listChatSessions(companyId);
  });
}
```

```ts
async createChatSession(input: CreateHivewardChatSessionRequest): Promise<HivewardChatSession> {
  return this.enqueue(async () => {
    const index = await this.readIndexUnlocked();
    const companyId = this.requireSelectedCompanyId(index);
    const roleScope = normalizeChatRoleScopeForSelectedCompany(index, companyId, input.roleScope, new Date().toISOString());
    return this.chatStore.createChatSession(companyId, { ...input, roleScope });
  });
}
```

- [ ] **Step 6: Delete company chat through `chatStore`**

In `deleteCompany`, remove all direct references to `index.chatSessions` and `index.chatMessages`. After writing the main index, call:

```ts
await this.chatStore.deleteCompanyChats(companyId);
```

- [ ] **Step 7: Remove obsolete chat helper functions from `fileHivewardStore.ts`**

Delete helpers that now live in `fileHivewardChatStore.ts`, except role-scope helpers that depend on `HivewardStoreIndex`:

- Keep `normalizeChatRoleScope`
- Keep `normalizeChatRoleScopeForCompany`
- Keep `normalizeChatRoleScopeForSelectedCompany`
- Keep `readCompanyBlueprintId`

- [ ] **Step 8: Run the focused tests**

Run:

```bash
npm test -- apps/api/src/store/fileHivewardStore.test.ts
```

Expected:

- All tests in `fileHivewardStore.test.ts` pass.

## Task 5: Verify Chat API Behavior Still Works

**Files:**
- No production file changes expected unless tests expose a bug.

- [ ] **Step 1: Run existing chat route tests**

Run:

```bash
npm test -- apps/api/src/routes/apiRouter.test.ts
```

Expected:

- Existing chat session persistence tests pass.
- Native session resume behavior still uses `nativeSessionId`.
- Visible chat messages still list as user/assistant turns.

- [ ] **Step 2: If route tests fail because of storage movement, fix the facade only**

Allowed fix locations:

- `apps/api/src/store/fileHivewardStore.ts`
- `apps/api/src/store/fileHivewardChatStore.ts`

Do not change route API shape unless a test proves the old API cannot be preserved.

## Task 6: Full Verification

**Files:**
- No production file changes expected unless checks expose a bug.

- [ ] **Step 1: Run full project check**

Run:

```bash
npm run check
```

Expected:

- Environment check passes.
- Boundaries check passes.
- Workspace typechecks pass.

- [ ] **Step 2: Run full test suite**

Run:

```bash
npm test
```

Expected:

- All Vitest suites pass.

- [ ] **Step 3: Inspect git diff**

Run:

```bash
git diff --stat
git diff -- apps/api/src/store/fileHivewardStore.ts apps/api/src/store/fileHivewardChatStore.ts apps/api/src/store/jsonFile.ts apps/api/src/store/fileHivewardStore.test.ts
```

Expected:

- Main store no longer has long-term chat fields.
- New chat store has the chat schema and retention logic.
- Tests document migration, isolation, company deletion cleanup, and retention.

## Self-Review

- Spec coverage: The plan covers safe migration, clean final storage boundaries, visible-message-only chat storage, 60-message retention, company chat deletion, and unchanged external APIs.
- Placeholder scan: No `TBD`, `TODO`, or "implement later" placeholders remain.
- Type consistency: The main facade remains `FileHivewardStore`; the new chat class is `FileHivewardChatStore`; the chat schema is consistently `hiveward.chat-store/v1`; the main schema remains `hiveward.store-index/v1`.
