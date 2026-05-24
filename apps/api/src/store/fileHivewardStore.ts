import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { nanoid } from "nanoid";
import type {
  AgentRuntimeId,
  CatalogSnapshot,
  CompanyOverview,
  CompanyProfile,
  ArchitectureBlueprintView,
  CompanyRoleDirectory,
  CompanyRoleProfile,
  InboxItem,
  InboxItemType,
  PendingApprovalItem,
  PortableBlueprintPackage,
  WorkspaceDashboard,
  BlueprintDefinition,
  BlueprintImportDefaults,
  BlueprintNodeEvent,
  BlueprintNodeRun,
  BlueprintRun,
  BlueprintRunArchive,
  BlueprintRunSummary,
  BlueprintRunView,
  ChatAttachment,
  ChatMessageStatus,
  ChatMode,
  ChatNativeSessionState,
  ChatRoleScope,
  ChatRuntimeRef,
  ChatSessionStatus,
  ChatThinkingEffort,
  CreateHivewardChatSessionRequest,
  HarnessId,
  HivewardChatMessage,
  HivewardChatSession,
  UpdateHivewardChatSessionRequest,
  RoleDriverBinding
} from "@hiveward/shared";
import {
  blueprintRunArchiveSchema,
  createBlankBlueprint,
  createDefaultCompanies,
  createDefaultBlueprints,
  createDefaultWorkspaceDashboard,
  defaultCompanyId,
  hydrateImportedBlueprint,
  normalizeWorkspaceDashboard,
  readPortableBlueprintPackage,
  resolveFinalRunResult
} from "@hiveward/shared";

const storeIndexSchema = "hiveward.store-index/v1";

interface BlueprintIndexEntry {
  id: string;
  companyId: string;
  name: string;
  description?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

interface HivewardStoreIndex {
  schema: typeof storeIndexSchema;
  companies: CompanyProfile[];
  selectedCompanyId: string | null;
  blueprintIndex: BlueprintIndexEntry[];
  runIndex: BlueprintRunSummary[];
  catalogSnapshot?: CatalogSnapshot;
  companyDashboards: Record<string, WorkspaceDashboard>;
  roleDirectories: Record<string, CompanyRoleDirectory>;
  inboxItems: Record<string, InboxItem[]>;
  chatSessions: HivewardChatSession[];
  chatMessages: Record<string, HivewardChatMessage[]>;
}

type RawHivewardStoreIndex = Partial<HivewardStoreIndex> & {
  companyDashboards?: Record<string, Partial<WorkspaceDashboard>>;
  roleDirectories?: Record<string, Partial<CompanyRoleDirectory>>;
  inboxItems?: Record<string, InboxItem[]>;
  chatSessions?: unknown;
  chatMessages?: unknown;
};

type LegacyHivewardStoreState = Partial<RawHivewardStoreIndex> & {
  blueprints?: BlueprintDefinition[];
  blueprintRuns?: BlueprintRun[];
  nodeRuns?: BlueprintNodeRun[];
  events?: BlueprintNodeEvent[];
};

export class FileHivewardStore {
  private readonly filePath: string;
  private readonly dataDir: string;
  private readonly blueprintsDir: string;
  private readonly runsDir: string;
  private operationQueue: Promise<void> = Promise.resolve();

  constructor(filePath = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../data/hiveward-store.json")) {
    this.filePath = filePath;
    this.dataDir = dirname(filePath);
    this.blueprintsDir = join(this.dataDir, "blueprints");
    this.runsDir = join(this.dataDir, "runs");
  }

  async init(): Promise<void> {
    await this.enqueue(async () => {
      await mkdir(this.dataDir, { recursive: true });
      await mkdir(this.blueprintsDir, { recursive: true });
      await mkdir(this.runsDir, { recursive: true });
      try {
        const index = await this.readIndexUnlocked();
        await this.writeIndexUnlocked(index);
      } catch (error) {
        if (!isFileNotFoundError(error)) {
          throw error;
        }
        const now = new Date().toISOString();
        const companies = createDefaultCompanies(now);
        const seededCompanyId = companies[0]?.id ?? defaultCompanyId;
        const blueprints = createDefaultBlueprints(now, seededCompanyId);
        const index: HivewardStoreIndex = {
          schema: storeIndexSchema,
          companies,
          selectedCompanyId: seededCompanyId,
          blueprintIndex: blueprints.map(toBlueprintIndexEntry),
          runIndex: [],
          companyDashboards: {
            [seededCompanyId]: createDefaultWorkspaceDashboard(now)
          },
          roleDirectories: {},
          inboxItems: {
            [seededCompanyId]: []
          },
          chatSessions: [],
          chatMessages: {}
        };
        index.roleDirectories[seededCompanyId] = buildRoleDirectory(index, seededCompanyId, now);
        await Promise.all(blueprints.map((blueprint) => this.writeBlueprintUnlocked(blueprint)));
        await this.writeIndexUnlocked(index);
      }
    });
  }

  async listCompanies(): Promise<{ companies: CompanyOverview[]; selectedCompanyId?: string }> {
    return this.enqueue(async () => {
      const index = await this.readIndexUnlocked();
      return {
        companies: this.buildCompanyOverviews(index),
        selectedCompanyId: index.selectedCompanyId ?? undefined
      };
    });
  }

  async createCompany(input: { name: string; businessGoal?: string; logoLabel?: string; logoUrl?: string }): Promise<{
    companies: CompanyOverview[];
    selectedCompanyId?: string;
  }> {
    return this.enqueue(async () => {
      const index = await this.readIndexUnlocked();
      const now = new Date().toISOString();
      const name = readRequiredCompanyName(input.name);
      const company: CompanyProfile = {
        id: nextCompanyId(index.companies),
        name,
        logoLabel: readOptionalString(input.logoLabel) ?? companyInitials(name),
        logoUrl: readOptionalString(input.logoUrl),
        businessGoal: readOptionalString(input.businessGoal) ?? "Coordinate blueprints, governed agent runs, and review gates.",
        createdAt: now,
        updatedAt: now
      };

      index.companies.push(company);
      index.selectedCompanyId = company.id;
      index.companyDashboards[company.id] = createDefaultWorkspaceDashboard(now);
      index.roleDirectories[company.id] = buildRoleDirectory(index, company.id, now);
      index.inboxItems[company.id] = [];
      await this.writeIndexUnlocked(index);

      return {
        companies: this.buildCompanyOverviews(index),
        selectedCompanyId: index.selectedCompanyId ?? undefined
      };
    });
  }

  async selectCompany(companyId?: string): Promise<{ companies: CompanyOverview[]; selectedCompanyId?: string }> {
    return this.enqueue(async () => {
      const index = await this.readIndexUnlocked();
      if (!companyId) {
        index.selectedCompanyId = null;
      } else if (index.companies.some((company) => company.id === companyId)) {
        index.selectedCompanyId = companyId;
      } else {
        throw new Error(`Company not found: ${companyId}`);
      }

      await this.writeIndexUnlocked(index);
      return {
        companies: this.buildCompanyOverviews(index),
        selectedCompanyId: index.selectedCompanyId ?? undefined
      };
    });
  }

  async deleteCompany(companyId: string): Promise<{ companies: CompanyOverview[]; selectedCompanyId?: string; deleted: boolean }> {
    return this.enqueue(async () => {
      const index = await this.readIndexUnlocked();
      const existingIndex = index.companies.findIndex((company) => company.id === companyId);
      if (existingIndex < 0) {
        return {
          companies: this.buildCompanyOverviews(index),
          selectedCompanyId: index.selectedCompanyId ?? undefined,
          deleted: false
        };
      }

      const blueprintIds = index.blueprintIndex.filter((blueprint) => blueprint.companyId === companyId).map((blueprint) => blueprint.id);
      const runIds = index.runIndex.filter((run) => run.companyId === companyId).map((run) => run.id);

      index.companies.splice(existingIndex, 1);
      index.blueprintIndex = index.blueprintIndex.filter((blueprint) => blueprint.companyId !== companyId);
      index.runIndex = index.runIndex.filter((run) => run.companyId !== companyId);
      const chatSessionIds = index.chatSessions.filter((session) => session.companyId === companyId).map((session) => session.id);
      index.chatSessions = index.chatSessions.filter((session) => session.companyId !== companyId);
      for (const sessionId of chatSessionIds) {
        delete index.chatMessages[sessionId];
      }
      delete index.companyDashboards[companyId];
      delete index.roleDirectories[companyId];
      delete index.inboxItems[companyId];

      if (index.selectedCompanyId === companyId) {
        index.selectedCompanyId = index.companies[0]?.id ?? null;
      }

      await this.writeIndexUnlocked(index);
      await Promise.all([
        ...blueprintIds.map((id) => rm(this.blueprintPath(id), { force: true })),
        ...runIds.map((id) => rm(this.runArchivePath(id), { force: true }))
      ]);

      return {
        companies: this.buildCompanyOverviews(index),
        selectedCompanyId: index.selectedCompanyId ?? undefined,
        deleted: true
      };
    });
  }

  async listBlueprints(): Promise<BlueprintDefinition[]> {
    return this.enqueue(async () => {
      const index = await this.readIndexUnlocked();
      const companyId = this.getCurrentCompanyId(index);
      if (!companyId) return [];
      return Promise.all(
        index.blueprintIndex
          .filter((blueprint) => blueprint.companyId === companyId)
          .map((blueprint) => this.readBlueprintUnlocked(blueprint.id))
      );
    });
  }

  async getBlueprint(id: string): Promise<BlueprintDefinition | undefined> {
    return this.enqueue(async () => {
      const index = await this.readIndexUnlocked();
      const companyId = this.getCurrentCompanyId(index);
      if (!companyId) return undefined;
      const indexed = index.blueprintIndex.find((blueprint) => blueprint.id === id && blueprint.companyId === companyId);
      return indexed ? this.readBlueprintUnlocked(indexed.id) : undefined;
    });
  }

  async saveBlueprint(blueprint: BlueprintDefinition): Promise<BlueprintDefinition> {
    return this.enqueue(async () => {
      const index = await this.readIndexUnlocked();
      const companyId = this.requireSelectedCompanyId(index);
      const now = new Date().toISOString();
      const existingIndex = index.blueprintIndex.findIndex((item) => item.id === blueprint.id && item.companyId === companyId);
      const currentVersion = existingIndex >= 0 ? index.blueprintIndex[existingIndex]!.version : blueprint.version;
      const currentCreatedAt = existingIndex >= 0 ? index.blueprintIndex[existingIndex]!.createdAt : now;
      const nextBlueprint: BlueprintDefinition = {
        ...blueprint,
        companyId,
        version: existingIndex >= 0 ? currentVersion + 1 : blueprint.version,
        updatedAt: now,
        createdAt: currentCreatedAt
      };

      await this.writeBlueprintUnlocked(nextBlueprint);
      if (existingIndex >= 0) {
        index.blueprintIndex[existingIndex] = toBlueprintIndexEntry(nextBlueprint);
      } else {
        index.blueprintIndex.push(toBlueprintIndexEntry(nextBlueprint));
      }

      index.roleDirectories[companyId] = buildRoleDirectory(index, companyId, now);
      await this.writeIndexUnlocked(index);
      return nextBlueprint;
    });
  }

  async createBlueprint(input: { name?: string; description?: string } = {}): Promise<BlueprintDefinition> {
    return this.enqueue(async () => {
      const index = await this.readIndexUnlocked();
      const companyId = this.requireSelectedCompanyId(index);
      const now = new Date().toISOString();
      const blueprint = createBlankBlueprint({
        id: nextBlueprintId(index.blueprintIndex),
        companyId,
        now,
        name: input.name,
        description: input.description
      });

      await this.writeBlueprintUnlocked(blueprint);
      index.blueprintIndex.push(toBlueprintIndexEntry(blueprint));
      index.roleDirectories[companyId] = buildRoleDirectory(index, companyId, now);
      await this.writeIndexUnlocked(index);
      return blueprint;
    });
  }

  async deleteBlueprint(id: string): Promise<boolean> {
    return this.enqueue(async () => {
      const index = await this.readIndexUnlocked();
      const companyId = this.getCurrentCompanyId(index);
      if (!companyId) return false;

      const existingIndex = index.blueprintIndex.findIndex((item) => item.id === id && item.companyId === companyId);
      if (existingIndex < 0) return false;

      index.blueprintIndex.splice(existingIndex, 1);
      index.roleDirectories[companyId] = buildRoleDirectory(index, companyId, new Date().toISOString());
      await this.writeIndexUnlocked(index);
      await rm(this.blueprintPath(id), { force: true });
      return true;
    });
  }

  async importBlueprintPackage(
    blueprintPackage: PortableBlueprintPackage,
    defaults: BlueprintImportDefaults = {}
  ): Promise<BlueprintDefinition[]> {
    return this.enqueue(async () => {
      const index = await this.readIndexUnlocked();
      const companyId = this.requireSelectedCompanyId(index);
      const imported = await this.importBlueprintPackageUnlocked(index, companyId, blueprintPackage, defaults);
      await this.writeIndexUnlocked(index);
      return imported;
    });
  }

  async getRoleDirectory(): Promise<{ roles: CompanyRoleDirectory; architecture: ArchitectureBlueprintView }> {
    return this.enqueue(async () => {
      const index = await this.readIndexUnlocked();
      const companyId = this.requireSelectedCompanyId(index);
      const roles = buildRoleDirectory(index, companyId, new Date().toISOString(), index.roleDirectories[companyId]);
      return {
        roles,
        architecture: buildArchitectureBlueprintView(index, companyId, roles)
      };
    });
  }

  async listInboxItems(): Promise<InboxItem[]> {
    return this.enqueue(async () => {
      const index = await this.readIndexUnlocked();
      const companyId = this.getCurrentCompanyId(index);
      if (!companyId) return [];
      return [...(index.inboxItems[companyId] ?? [])].sort(
        (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
      );
    });
  }

  async createLeaderDelegationRequest(input: {
    leaderId: string;
    blueprintId?: string;
    title?: string;
    summary?: string;
    createdByRoleId?: string;
  }): Promise<InboxItem> {
    return this.enqueue(async () => {
      const index = await this.readIndexUnlocked();
      const companyId = this.requireSelectedCompanyId(index);
      const now = new Date().toISOString();
      const roles = buildRoleDirectory(index, companyId, now);
      const leader = roles.leaders.find((candidate) => candidate.id === input.leaderId);
      if (!leader) {
        throw new Error(`Leader not found: ${input.leaderId}`);
      }
      const blueprint = index.blueprintIndex.find((candidate) => candidate.companyId === companyId && candidate.id === (input.blueprintId ?? leader.blueprintId));
      const item = createInboxItem({
        companyId,
        type: "leader_delegation",
        title: input.title ?? `Call ${leader.label}`,
        summary: input.summary ?? `Request approval to bring ${leader.label} into this conversation.`,
        createdByRoleId: input.createdByRoleId ?? roles.ceo.id,
        targetRoleId: leader.id,
        blueprintId: blueprint?.id ?? leader.blueprintId,
        blueprintName: blueprint?.name,
        payload: {
          leaderId: leader.id,
          blueprintId: blueprint?.id ?? leader.blueprintId
        },
        now
      });
      index.roleDirectories[companyId] = roles;
      index.inboxItems[companyId] = [item, ...(index.inboxItems[companyId] ?? [])];
      await this.writeIndexUnlocked(index);
      return item;
    });
  }

  async createBlueprintProposal(input: {
    title: string;
    summary: string;
    blueprintId?: string;
    blueprintPackage?: PortableBlueprintPackage;
    preview?: Record<string, unknown>;
    diffSummary?: string;
    createdByRoleId?: string;
    targetRoleId?: string;
    runtimeId?: AgentRuntimeId;
  }): Promise<InboxItem> {
    return this.enqueue(async () => {
      const index = await this.readIndexUnlocked();
      const companyId = this.requireSelectedCompanyId(index);
      const now = new Date().toISOString();
      const roles = buildRoleDirectory(index, companyId, now);
      if (!input.blueprintPackage) {
        throw new Error("Blueprint proposal requires an importable blueprintPackage.");
      }
      const blueprint = input.blueprintId
        ? index.blueprintIndex.find((candidate) => candidate.companyId === companyId && candidate.id === input.blueprintId)
        : undefined;
      const item = createInboxItem({
        companyId,
        type: "blueprint_proposal",
        title: readOptionalString(input.title) ?? "Blueprint proposal",
        summary: readOptionalString(input.summary) ?? "A leader generated importable blueprint package for approval.",
        createdByRoleId: input.createdByRoleId ?? inferLeaderRoleId(roles, input.blueprintId) ?? roles.ceo.id,
        targetRoleId: input.targetRoleId,
        blueprintId: blueprint?.id ?? input.blueprintId,
        blueprintName: blueprint?.name,
        payload: {
          blueprintPackage: input.blueprintPackage,
          preview: input.preview,
          diffSummary: input.diffSummary,
          runtimeId: input.runtimeId
        },
        now
      });
      index.roleDirectories[companyId] = roles;
      index.inboxItems[companyId] = [item, ...(index.inboxItems[companyId] ?? [])];
      await this.writeIndexUnlocked(index);
      return item;
    });
  }

  async approveInboxItem(
    itemId: string,
    defaults: BlueprintImportDefaults = {},
    comment?: string
  ): Promise<{ item: InboxItem; importedBlueprints?: BlueprintDefinition[] }> {
    return this.enqueue(async () => {
      const index = await this.readIndexUnlocked();
      const companyId = this.requireSelectedCompanyId(index);
      const items = index.inboxItems[companyId] ?? [];
      const itemIndex = items.findIndex((item) => item.id === itemId);
      if (itemIndex < 0) throw new Error(`Inbox item not found: ${itemId}`);
      const item = items[itemIndex]!;
      if (item.status !== "pending") {
        return { item };
      }
      let importedBlueprints: BlueprintDefinition[] | undefined;
      const blueprintPackage = readBlueprintPackagePayload(item.payload?.blueprintPackage);
      if (item.type === "blueprint_proposal" && !blueprintPackage) {
        throw new Error(`Blueprint proposal inbox item ${item.id} is missing an importable blueprintPackage.`);
      }
      if (item.type === "blueprint_proposal") {
        const importableBlueprintPackage = blueprintPackage;
        if (!importableBlueprintPackage) {
          throw new Error(`Blueprint proposal inbox item ${item.id} is missing an importable blueprintPackage.`);
        }
        importedBlueprints = await this.importBlueprintPackageUnlocked(index, companyId, importableBlueprintPackage, {
          ...defaults,
          runtimeId: readAgentRuntimeId(item.payload?.runtimeId) ?? defaults.runtimeId
        });
      }
      const now = new Date().toISOString();
      const approved: InboxItem = {
        ...item,
        status: "approved",
        updatedAt: now,
        decidedAt: now,
        decisionComment: readOptionalString(comment)
      };
      items[itemIndex] = approved;
      index.inboxItems[companyId] = items;
      await this.writeIndexUnlocked(index);
      return { item: approved, importedBlueprints };
    });
  }

  async rejectInboxItem(itemId: string, comment?: string): Promise<InboxItem> {
    return this.enqueue(async () => {
      const index = await this.readIndexUnlocked();
      const companyId = this.requireSelectedCompanyId(index);
      const items = index.inboxItems[companyId] ?? [];
      const itemIndex = items.findIndex((item) => item.id === itemId);
      if (itemIndex < 0) throw new Error(`Inbox item not found: ${itemId}`);
      const item = items[itemIndex]!;
      if (item.status !== "pending") {
        return item;
      }
      const now = new Date().toISOString();
      const rejected: InboxItem = {
        ...item,
        status: "rejected",
        updatedAt: now,
        decidedAt: now,
        decisionComment: readOptionalString(comment)
      };
      items[itemIndex] = rejected;
      index.inboxItems[companyId] = items;
      await this.writeIndexUnlocked(index);
      return rejected;
    });
  }

  async createBlueprintRun(blueprint: BlueprintDefinition, startedBy: string): Promise<BlueprintRun> {
    return this.enqueue(async () => {
      const index = await this.readIndexUnlocked();
      const run: BlueprintRun = {
        id: `run-${nanoid(10)}`,
        companyId: blueprint.companyId,
        blueprintId: blueprint.id,
        blueprintName: blueprint.name,
        blueprintVersion: blueprint.version,
        status: "queued",
        startedBy,
        startedAt: new Date().toISOString(),
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCostUsd: 0,
        openclawRefs: []
      };
      const summary = toBlueprintRunSummary(run, blueprint);
      const archive: BlueprintRunArchive = {
        schema: blueprintRunArchiveSchema,
        run: summary,
        blueprintSnapshot: blueprint,
        nodeRuns: [],
        events: [],
        finalResult: null
      };
      await this.writeRunArchiveUnlocked(archive);
      index.runIndex.push(summary);
      await this.writeIndexUnlocked(index);
      return run;
    });
  }

  async updateBlueprintRun(run: BlueprintRun): Promise<void> {
    await this.enqueue(async () => {
      const index = await this.readIndexUnlocked();
      const runIndex = index.runIndex.findIndex((item) => item.id === run.id);
      if (runIndex < 0) {
        throw new Error(`Blueprint run not found: ${run.id}`);
      }
      const archive = await this.readRunArchiveUnlocked(run.id);
      const nextRun = applyNodeRunFactsToRun(
        toBlueprintRunSummary({ ...archive.run, ...run }, archive.blueprintSnapshot),
        archive.nodeRuns
      );
      const nextArchive: BlueprintRunArchive = {
        ...archive,
        run: nextRun,
        finalResult: resolveFinalRunResult(archive.blueprintSnapshot, archive.nodeRuns, nextRun.status)
      };
      index.runIndex[runIndex] = nextRun;
      await this.writeRunArchiveUnlocked(nextArchive);
      await this.writeIndexUnlocked(index);
    });
  }

  async getBlueprintRun(id: string): Promise<BlueprintRun | undefined> {
    return this.enqueue(async () => {
      const index = await this.readIndexUnlocked();
      const companyId = this.getCurrentCompanyId(index);
      const run = index.runIndex.find((candidate) => candidate.id === id);
      if (!run) return undefined;
      if (!companyId || run.companyId !== companyId) return undefined;
      return run;
    });
  }

  async upsertNodeRun(nodeRun: BlueprintNodeRun): Promise<void> {
    await this.enqueue(async () => {
      const indexState = await this.readIndexUnlocked();
      const archive = await this.readRunArchiveUnlocked(nodeRun.blueprintRunId);
      const index = archive.nodeRuns.findIndex((item) => item.id === nodeRun.id);
      if (index >= 0) {
        archive.nodeRuns[index] = nodeRun;
      } else {
        archive.nodeRuns.push(nodeRun);
      }
      const run = applyNodeRunFactsToRun(archive.run, archive.nodeRuns);
      const runIndex = indexState.runIndex.findIndex((item) => item.id === run.id);
      if (runIndex >= 0) {
        indexState.runIndex[runIndex] = run;
      }
      await this.writeRunArchiveUnlocked({
        ...archive,
        run,
        finalResult: resolveFinalRunResult(archive.blueprintSnapshot, archive.nodeRuns, run.status)
      });
      if (runIndex >= 0) {
        await this.writeIndexUnlocked(indexState);
      }
    });
  }

  async listNodeRuns(blueprintRunId: string): Promise<BlueprintNodeRun[]> {
    return this.enqueue(async () => {
      const archive = await this.readRunArchiveUnlocked(blueprintRunId);
      return archive.nodeRuns;
    });
  }

  async appendEvent(event: BlueprintNodeEvent): Promise<void> {
    await this.enqueue(async () => {
      const archive = await this.readRunArchiveUnlocked(event.blueprintRunId);
      archive.events.push(event);
      await this.writeRunArchiveUnlocked(archive);
    });
  }

  async getRunView(blueprintRunId: string): Promise<BlueprintRunView | undefined> {
    return this.enqueue(async () => {
      const index = await this.readIndexUnlocked();
      const companyId = this.getCurrentCompanyId(index);
      const run = index.runIndex.find((item) => item.id === blueprintRunId);
      if (!run || !companyId || run.companyId !== companyId) return undefined;
      return this.getRunViewFromArchive(await this.readRunArchiveUnlocked(blueprintRunId));
    });
  }

  async getLatestRunViewForBlueprint(blueprintId: string): Promise<BlueprintRunView | undefined> {
    return this.enqueue(async () => {
      const index = await this.readIndexUnlocked();
      const companyId = this.getCurrentCompanyId(index);
      if (!companyId) return undefined;
      const run = index.runIndex
        .filter((item) => item.companyId === companyId && item.blueprintId === blueprintId)
        .sort((left, right) => new Date(right.startedAt).getTime() - new Date(left.startedAt).getTime())[0];
      if (!run) return undefined;
      return this.getRunViewFromArchive(await this.readRunArchiveUnlocked(run.id));
    });
  }

  async listRunSummaries(): Promise<BlueprintRunSummary[]> {
    return this.enqueue(async () => {
      const index = await this.readIndexUnlocked();
      const companyId = this.getCurrentCompanyId(index);
      if (!companyId) return [];
      return index.runIndex
        .filter((run) => run.companyId === companyId)
        .slice()
        .sort((left, right) => new Date(right.startedAt).getTime() - new Date(left.startedAt).getTime());
    });
  }

  async listRunViews(): Promise<BlueprintRunView[]> {
    return this.enqueue(async () => {
      const index = await this.readIndexUnlocked();
      const companyId = this.getCurrentCompanyId(index);
      if (!companyId) return [];
      const archives = await Promise.all(
        index.runIndex
        .filter((run) => run.companyId === companyId)
        .slice()
        .sort((left, right) => new Date(right.startedAt).getTime() - new Date(left.startedAt).getTime())
          .map((run) => this.readRunArchiveUnlocked(run.id))
      );
      return archives.map((archive) => this.getRunViewFromArchive(archive));
    });
  }

  async listRunArchives(): Promise<BlueprintRunArchive[]> {
    return this.enqueue(async () => {
      const index = await this.readIndexUnlocked();
      const companyId = this.getCurrentCompanyId(index);
      if (!companyId) return [];
      return Promise.all(
        index.runIndex
          .filter((run) => run.companyId === companyId)
          .map((run) => this.readRunArchiveUnlocked(run.id))
      );
    });
  }

  async listPendingApprovals(): Promise<PendingApprovalItem[]> {
    return this.enqueue(async () => {
      const index = await this.readIndexUnlocked();
      const companyId = this.getCurrentCompanyId(index);
      if (!companyId) return [];
      const archives = await Promise.all(
        index.runIndex
          .filter((run) => run.companyId === companyId)
          .map((run) => this.readRunArchiveUnlocked(run.id))
      );
      return archives
        .flatMap((archive) => archive.nodeRuns
          .filter((nodeRun) => nodeRun.status === "waiting_approval")
          .map((nodeRun) => ({ archive, nodeRun })))
        .flatMap(({ archive, nodeRun }) => {
          if (archive.run.companyId !== companyId || archive.blueprintSnapshot.companyId !== companyId) return [];

          const output = isRecord(nodeRun.output) ? nodeRun.output : undefined;
          const upstream = readPendingApprovalUpstream(nodeRun.input);
          const item: PendingApprovalItem = {
            blueprintId: archive.blueprintSnapshot.id,
            blueprintName: archive.blueprintSnapshot.name,
            blueprintRunId: archive.run.id,
            nodeRunId: nodeRun.id,
            nodeId: nodeRun.nodeId,
            nodeLabel: nodeRun.nodeLabel,
            startedBy: archive.run.startedBy,
            startedAt: archive.run.startedAt,
            requestedAt: nodeRun.startedAt ?? nodeRun.queuedAt,
            approverHint: readString(output?.approverHint),
            instructions: readString(output?.instructions),
            ...(upstream ? { upstream } : {})
          };
          return [item];
        })
        .sort((left, right) => new Date(right.requestedAt).getTime() - new Date(left.requestedAt).getTime());
    });
  }

  async getDashboardState(): Promise<WorkspaceDashboard> {
    return this.enqueue(async () => {
      const index = await this.readIndexUnlocked();
      const companyId = this.getCurrentCompanyId(index);
      if (!companyId) {
        return createDefaultWorkspaceDashboard(new Date().toISOString());
      }
      return index.companyDashboards[companyId] ?? createDefaultWorkspaceDashboard(new Date().toISOString());
    });
  }

  async saveDashboardState(dashboard: WorkspaceDashboard): Promise<WorkspaceDashboard> {
    return this.enqueue(async () => {
      const index = await this.readIndexUnlocked();
      const companyId = this.requireSelectedCompanyId(index);
      index.companyDashboards[companyId] = normalizeWorkspaceDashboard(dashboard, new Date().toISOString());
      index.companyDashboards[companyId].updatedAt = new Date().toISOString();
      await this.writeIndexUnlocked(index);
      return index.companyDashboards[companyId];
    });
  }

  async saveCatalogSnapshot(snapshot: CatalogSnapshot): Promise<CatalogSnapshot> {
    return this.enqueue(async () => {
      const index = await this.readIndexUnlocked();
      index.catalogSnapshot = snapshot;
      await this.writeIndexUnlocked(index);
      return snapshot;
    });
  }

  async getCatalogSnapshot(): Promise<CatalogSnapshot | undefined> {
    return this.enqueue(async () => {
      const index = await this.readIndexUnlocked();
      return index.catalogSnapshot;
    });
  }

  async listChatSessions(): Promise<HivewardChatSession[]> {
    return this.enqueue(async () => {
      const index = await this.readIndexUnlocked();
      const companyId = this.getCurrentCompanyId(index);
      if (!companyId) return [];
      return index.chatSessions
        .filter((session) => session.companyId === companyId)
        .slice()
        .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
    });
  }

  async getChatSession(id: string): Promise<HivewardChatSession | undefined> {
    return this.enqueue(async () => {
      const index = await this.readIndexUnlocked();
      const companyId = this.getCurrentCompanyId(index);
      if (!companyId) return undefined;
      return index.chatSessions.find((session) => session.id === id && session.companyId === companyId);
    });
  }

  async findChatSessionByNative(input: { harnessId: HarnessId; nativeSessionId: string }): Promise<HivewardChatSession | undefined> {
    return this.enqueue(async () => {
      const index = await this.readIndexUnlocked();
      const companyId = this.getCurrentCompanyId(index);
      if (!companyId) return undefined;
      return index.chatSessions.find(
        (session) =>
          session.companyId === companyId &&
          session.harnessId === input.harnessId &&
          session.nativeSessionId === input.nativeSessionId
      );
    });
  }

  async createChatSession(input: CreateHivewardChatSessionRequest): Promise<HivewardChatSession> {
    return this.enqueue(async () => {
      const index = await this.readIndexUnlocked();
      const companyId = this.requireSelectedCompanyId(index);
      const now = new Date().toISOString();
      const session: HivewardChatSession = {
        id: nextChatSessionId(index.chatSessions),
        companyId,
        harnessId: normalizeHarnessId(input.harnessId),
        roleScope: normalizeChatRoleScope(input.roleScope),
        title: readOptionalString(input.title) ?? "New chat",
        nativeSessionId: readOptionalString(input.nativeSessionId),
        nativeSessionState: readOptionalString(input.nativeSessionId) ? "resumable" : "unknown",
        modelId: readOptionalString(input.modelId),
        agentId: readOptionalString(input.agentId),
        thinkingEffort: normalizeChatThinkingEffort(input.thinkingEffort),
        mode: normalizeChatMode(input.mode),
        status: "active",
        createdAt: now,
        updatedAt: now
      };
      index.chatSessions.unshift(session);
      index.chatMessages[session.id] = [];
      await this.writeIndexUnlocked(index);
      return session;
    });
  }

  async updateChatSession(id: string, patch: UpdateHivewardChatSessionRequest): Promise<HivewardChatSession | undefined> {
    return this.enqueue(async () => {
      const index = await this.readIndexUnlocked();
      const companyId = this.getCurrentCompanyId(index);
      if (!companyId) return undefined;
      const sessionIndex = index.chatSessions.findIndex((session) => session.id === id && session.companyId === companyId);
      if (sessionIndex < 0) return undefined;
      const current = index.chatSessions[sessionIndex]!;
      const now = new Date().toISOString();
      const nextStatus = normalizeChatSessionStatus(patch.status) ?? current.status;
      const endedAt = nextStatus === "ended" ? current.endedAt ?? now : current.endedAt;
      const next: HivewardChatSession = {
        ...current,
        title: readOptionalString(patch.title) ?? current.title,
        nativeSessionId: Object.hasOwn(patch, "nativeSessionId") ? readOptionalString(patch.nativeSessionId) : current.nativeSessionId,
        nativeSessionState: normalizeNativeSessionState(patch.nativeSessionState) ?? current.nativeSessionState,
        modelId: readOptionalString(patch.modelId) ?? current.modelId,
        agentId: readOptionalString(patch.agentId) ?? current.agentId,
        thinkingEffort: normalizeChatThinkingEffort(patch.thinkingEffort) ?? current.thinkingEffort,
        mode: patch.mode ? normalizeChatMode(patch.mode) : current.mode,
        roleScope: patch.roleScope ? normalizeChatRoleScope(patch.roleScope) : current.roleScope,
        status: nextStatus,
        endedAt,
        updatedAt: now
      };
      index.chatSessions[sessionIndex] = next;
      await this.writeIndexUnlocked(index);
      return next;
    });
  }

  async endChatSession(id: string): Promise<HivewardChatSession | undefined> {
    return this.updateChatSession(id, { status: "ended" });
  }

  async listChatMessages(sessionId: string): Promise<HivewardChatMessage[]> {
    return this.enqueue(async () => {
      const index = await this.readIndexUnlocked();
      const companyId = this.getCurrentCompanyId(index);
      if (!companyId || !index.chatSessions.some((session) => session.id === sessionId && session.companyId === companyId)) {
        return [];
      }
      return (index.chatMessages[sessionId] ?? []).slice().sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());
    });
  }

  async appendChatMessage(
    input: Omit<HivewardChatMessage, "id" | "createdAt" | "updatedAt"> & {
      id?: string;
      createdAt?: string;
      updatedAt?: string;
    }
  ): Promise<HivewardChatMessage> {
    return this.enqueue(async () => {
      const index = await this.readIndexUnlocked();
      const companyId = this.getCurrentCompanyId(index);
      const sessionIndex = index.chatSessions.findIndex((session) => session.id === input.sessionId && session.companyId === companyId);
      if (sessionIndex < 0) {
        throw new Error(`Chat session not found: ${input.sessionId}`);
      }
      const now = new Date().toISOString();
      const message: HivewardChatMessage = {
        id: input.id ?? nextChatMessageId(index.chatMessages[input.sessionId] ?? []),
        sessionId: input.sessionId,
        role: normalizeChatMessageRole(input.role),
        content: input.content,
        attachments: normalizeStoredChatAttachments(input.attachments),
        harnessId: normalizeHarnessId(input.harnessId),
        modelId: readOptionalString(input.modelId),
        nativeMessageId: readOptionalString(input.nativeMessageId),
        status: normalizeChatMessageStatus(input.status) ?? "sent",
        runtimeRef: normalizeChatRuntimeRef(input.runtimeRef),
        createdAt: input.createdAt ?? now,
        updatedAt: input.updatedAt
      };
      index.chatMessages[input.sessionId] = [...(index.chatMessages[input.sessionId] ?? []), message];
      index.chatSessions[sessionIndex] = {
        ...index.chatSessions[sessionIndex]!,
        title: deriveChatSessionTitle(index.chatSessions[sessionIndex]!, message),
        updatedAt: now
      };
      await this.writeIndexUnlocked(index);
      return message;
    });
  }

  async updateChatMessage(
    sessionId: string,
    messageId: string,
    patch: Partial<Pick<HivewardChatMessage, "content" | "status" | "runtimeRef" | "nativeMessageId" | "modelId">>
  ): Promise<HivewardChatMessage | undefined> {
    return this.enqueue(async () => {
      const index = await this.readIndexUnlocked();
      const companyId = this.getCurrentCompanyId(index);
      const sessionIndex = index.chatSessions.findIndex((session) => session.id === sessionId && session.companyId === companyId);
      if (sessionIndex < 0) return undefined;
      const messages = index.chatMessages[sessionId] ?? [];
      const messageIndex = messages.findIndex((message) => message.id === messageId);
      if (messageIndex < 0) return undefined;
      const now = new Date().toISOString();
      const current = messages[messageIndex]!;
      const next: HivewardChatMessage = {
        ...current,
        content: patch.content ?? current.content,
        status: normalizeChatMessageStatus(patch.status) ?? current.status,
        runtimeRef: patch.runtimeRef === undefined ? current.runtimeRef : normalizeChatRuntimeRef(patch.runtimeRef),
        nativeMessageId: readOptionalString(patch.nativeMessageId) ?? current.nativeMessageId,
        modelId: readOptionalString(patch.modelId) ?? current.modelId,
        updatedAt: now
      };
      messages[messageIndex] = next;
      index.chatMessages[sessionId] = messages;
      index.chatSessions[sessionIndex] = {
        ...index.chatSessions[sessionIndex]!,
        updatedAt: now
      };
      await this.writeIndexUnlocked(index);
      return next;
    });
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.operationQueue.then(operation, operation);
    this.operationQueue = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }

  private async readIndexUnlocked(): Promise<HivewardStoreIndex> {
    const raw = await readFile(this.filePath, "utf8");
    const parsed = JSON.parse(raw) as LegacyHivewardStoreState;
    if (parsed.schema === storeIndexSchema) {
      return this.normalizeIndex(parsed as RawHivewardStoreIndex);
    }
    return this.migrateLegacyStateUnlocked(parsed);
  }

  private async writeIndexUnlocked(index: HivewardStoreIndex): Promise<void> {
    await safeWriteJson(this.filePath, index);
  }

  private async readBlueprintUnlocked(id: string): Promise<BlueprintDefinition> {
    return JSON.parse(await readFile(this.blueprintPath(id), "utf8")) as BlueprintDefinition;
  }

  private async writeBlueprintUnlocked(blueprint: BlueprintDefinition): Promise<void> {
    await safeWriteJson(this.blueprintPath(blueprint.id), blueprint);
  }

  private async readRunArchiveUnlocked(id: string): Promise<BlueprintRunArchive> {
    const rawArchive = JSON.parse(await readFile(this.runArchivePath(id), "utf8")) as Partial<BlueprintRunArchive>;
    const archive = rawArchive as BlueprintRunArchive;
    return {
      schema: blueprintRunArchiveSchema,
      run: archive.run,
      blueprintSnapshot: archive.blueprintSnapshot,
      nodeRuns: Array.isArray(archive.nodeRuns) ? archive.nodeRuns : [],
      events: Array.isArray(archive.events) ? archive.events : [],
      finalResult: archive.finalResult ?? null
    };
  }

  private async writeRunArchiveUnlocked(archive: BlueprintRunArchive): Promise<void> {
    await safeWriteJson(this.runArchivePath(archive.run.id), archive);
  }

  private async importBlueprintPackageUnlocked(
    index: HivewardStoreIndex,
    companyId: string,
    blueprintPackage: PortableBlueprintPackage,
    defaults: BlueprintImportDefaults
  ): Promise<BlueprintDefinition[]> {
    const now = new Date().toISOString();
    const imported: BlueprintDefinition[] = [];
    const knownBlueprints = [...index.blueprintIndex];

    for (const portableBlueprint of blueprintPackage.blueprints) {
      const blueprint = hydrateImportedBlueprint(portableBlueprint, {
        id: nextBlueprintId(knownBlueprints),
        companyId,
        now,
        defaults,
        name: nextImportedBlueprintName(knownBlueprints, portableBlueprint.name)
      });
      const entry = toBlueprintIndexEntry(blueprint);
      knownBlueprints.push(entry);
      await this.writeBlueprintUnlocked(blueprint);
      index.blueprintIndex.push(entry);
      imported.push(blueprint);
    }

    index.roleDirectories[companyId] = buildRoleDirectory(index, companyId, now);
    return imported;
  }

  private blueprintPath(id: string): string {
    return join(this.blueprintsDir, `${id}.json`);
  }

  private runArchivePath(id: string): string {
    return join(this.runsDir, `${id}.json`);
  }

  private normalizeIndex(rawIndex: RawHivewardStoreIndex): HivewardStoreIndex {
    const now = new Date().toISOString();
    const companies = normalizeCompanies(rawIndex.companies, now);
    const primaryCompanyId = companies[0]?.id ?? defaultCompanyId;
    const selectedCompanyId = normalizeSelectedCompanyId(rawIndex.selectedCompanyId, companies, primaryCompanyId);
    const companyDashboards = normalizeCompanyDashboards(rawIndex.companyDashboards, companies, now);
    const blueprintIndex = Array.isArray(rawIndex.blueprintIndex)
      ? rawIndex.blueprintIndex.map((entry) => normalizeBlueprintIndexEntry(entry, primaryCompanyId, now))
      : [];
    const runIndex = Array.isArray(rawIndex.runIndex)
      ? rawIndex.runIndex.map((run) => normalizeRunSummary(run, primaryCompanyId))
      : [];
    const index: HivewardStoreIndex = {
      schema: storeIndexSchema,
      companies,
      selectedCompanyId,
      blueprintIndex,
      runIndex,
      catalogSnapshot: rawIndex.catalogSnapshot,
      companyDashboards,
      roleDirectories: {},
      inboxItems: normalizeInboxItems(rawIndex.inboxItems, companies, now),
      chatSessions: normalizeChatSessions(rawIndex.chatSessions, companies, now),
      chatMessages: {}
    };
    index.chatMessages = normalizeChatMessages(rawIndex.chatMessages, index.chatSessions, now);
    for (const company of companies) {
      index.roleDirectories[company.id] = buildRoleDirectory(index, company.id, now, rawIndex.roleDirectories?.[company.id]);
    }

    return index;
  }

  private async migrateLegacyStateUnlocked(state: LegacyHivewardStoreState): Promise<HivewardStoreIndex> {
    const now = new Date().toISOString();
    const companies = normalizeCompanies(state.companies, now);
    const primaryCompanyId = companies[0]?.id ?? defaultCompanyId;
    const selectedCompanyId = normalizeSelectedCompanyId(state.selectedCompanyId, companies, primaryCompanyId);
    const normalizedBlueprints = Array.isArray(state.blueprints)
      ? state.blueprints.map((blueprint) => ({
          ...blueprint,
          companyId: readScopedCompanyId(blueprint.companyId, primaryCompanyId)
        }))
      : createDefaultBlueprints(now, primaryCompanyId);
    const blueprintCompanyIds = new Map(normalizedBlueprints.map((blueprint) => [blueprint.id, blueprint.companyId]));
    const normalizedRuns = Array.isArray(state.blueprintRuns)
      ? state.blueprintRuns.map((run) => ({
          ...run,
          companyId: readScopedCompanyId(run.companyId ?? blueprintCompanyIds.get(run.blueprintId), primaryCompanyId)
        }))
      : [];
    const nodeRuns = Array.isArray(state.nodeRuns) ? state.nodeRuns : [];
    const events = Array.isArray(state.events) ? state.events : [];
    const index: HivewardStoreIndex = {
      schema: storeIndexSchema,
      companies,
      selectedCompanyId,
      blueprintIndex: normalizedBlueprints.map(toBlueprintIndexEntry),
      runIndex: normalizedRuns.map((run) => {
        const blueprint = normalizedBlueprints.find((candidate) => candidate.id === run.blueprintId);
        return toBlueprintRunSummary(run, blueprint);
      }),
      catalogSnapshot: state.catalogSnapshot,
      companyDashboards: normalizeCompanyDashboards(state.companyDashboards, companies, now),
      roleDirectories: {},
      inboxItems: normalizeInboxItems(state.inboxItems, companies, now),
      chatSessions: normalizeChatSessions(state.chatSessions, companies, now),
      chatMessages: {}
    };
    index.chatMessages = normalizeChatMessages(state.chatMessages, index.chatSessions, now);
    for (const company of companies) {
      index.roleDirectories[company.id] = buildRoleDirectory(index, company.id, now, state.roleDirectories?.[company.id]);
    }

    await Promise.all(normalizedBlueprints.map((blueprint) => this.writeBlueprintUnlocked(blueprint)));
    for (const run of index.runIndex) {
      const blueprint = normalizedBlueprints.find((candidate) => candidate.id === run.blueprintId) ?? createArchivePlaceholderBlueprint(run, now);
      const archiveNodeRuns = nodeRuns.filter((nodeRun) => nodeRun.blueprintRunId === run.id);
      const archive: BlueprintRunArchive = {
        schema: blueprintRunArchiveSchema,
        run,
        blueprintSnapshot: blueprint,
        nodeRuns: archiveNodeRuns,
        events: events.filter((event) => event.blueprintRunId === run.id),
        finalResult: resolveFinalRunResult(blueprint, archiveNodeRuns, run.status)
      };
      await this.writeRunArchiveUnlocked(archive);
    }
    await this.writeIndexUnlocked(index);
    return index;
  }

  private getRunViewFromArchive(archive: BlueprintRunArchive): BlueprintRunView {
    return {
      run: archive.run,
      nodeRuns: archive.nodeRuns,
      events: archive.events,
      finalResult: archive.finalResult
    };
  }

  private buildCompanyOverviews(index: HivewardStoreIndex): CompanyOverview[] {
    return index.companies.map((company) => {
      const blueprints = index.blueprintIndex.filter((blueprint) => blueprint.companyId === company.id);
      const runs = index.runIndex.filter((run) => run.companyId === company.id);
      const pendingInboxCount = (index.inboxItems[company.id] ?? []).filter((item) => item.status === "pending").length;
      const dashboard = index.companyDashboards[company.id] ?? createDefaultWorkspaceDashboard(new Date().toISOString());
      return {
        ...company,
        blueprintCount: blueprints.length,
        runCount: runs.length,
        totalTokens: runs.reduce((sum, run) => sum + run.totalInputTokens + run.totalOutputTokens, 0),
        totalCostUsd: Number(runs.reduce((sum, run) => sum + run.totalCostUsd, 0).toFixed(6)),
        dashboardWidgetCount: dashboard.dashboardWidgets.length,
        savedViewCount: dashboard.savedViews.length,
        noteCount: dashboard.notes.length,
        activeApprovalCount: runs.filter((run) => run.status === "waiting_approval").length + pendingInboxCount,
        latestRunAt: maxTimestamp(runs.map((run) => run.endedAt ?? run.startedAt))
      };
    });
  }

  private getCurrentCompanyId(index: HivewardStoreIndex): string | undefined {
    return index.selectedCompanyId ?? undefined;
  }

  private requireSelectedCompanyId(index: HivewardStoreIndex): string {
    const companyId = this.getCurrentCompanyId(index);
    if (!companyId) {
      throw new Error("No company selected.");
    }
    return companyId;
  }
}

async function safeWriteJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${nanoid(8)}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tempPath, filePath);
}

function normalizeCompanies(value: unknown, now: string): CompanyProfile[] {
  return Array.isArray(value) && value.length > 0
    ? (value as CompanyProfile[]).map((company) => normalizeCompany(company, now))
    : createDefaultCompanies(now);
}

function normalizeCompanyDashboards(
  value: unknown,
  companies: CompanyProfile[],
  now: string
): Record<string, WorkspaceDashboard> {
  const companyDashboards: Record<string, WorkspaceDashboard> = {};
  for (const company of companies) {
    const rawDashboard = isRecord(value) ? value[company.id] : undefined;
    companyDashboards[company.id] = normalizeWorkspaceDashboard(rawDashboard as Partial<WorkspaceDashboard> | undefined, now);
  }
  return companyDashboards;
}

function normalizeInboxItems(value: unknown, companies: CompanyProfile[], now: string): Record<string, InboxItem[]> {
  const inboxItems: Record<string, InboxItem[]> = {};
  for (const company of companies) {
    const companyItems = isRecord(value) ? value[company.id] : undefined;
    const rawItems: unknown[] = Array.isArray(companyItems) ? companyItems : [];
    inboxItems[company.id] = rawItems.flatMap((item) => {
      if (!isRecord(item)) return [];
      const id = readString(item.id) ?? `inbox-${nanoid(8)}`;
      const type = normalizeInboxItemType(item.type);
      const status = item.status === "approved" || item.status === "rejected" ? item.status : "pending";
      const title = readString(item.title) ?? "Inbox item";
      const summary = readString(item.summary) ?? "";
      return [{
        id,
        companyId: company.id,
        type,
        status,
        title,
        summary,
        createdByRoleId: readString(item.createdByRoleId) ?? "ceo",
        targetRoleId: readString(item.targetRoleId),
        blueprintId: readString(item.blueprintId),
        blueprintName: readString(item.blueprintName),
        payload: isRecord(item.payload) ? item.payload : undefined,
        createdAt: readString(item.createdAt) ?? now,
        updatedAt: readString(item.updatedAt) ?? now,
        decidedAt: readString(item.decidedAt),
        decisionComment: readString(item.decisionComment)
      }];
    });
  }
  return inboxItems;
}

function normalizeInboxItemType(value: unknown): InboxItemType {
  if (
    value === "leader_delegation" ||
    value === "blueprint_proposal" ||
    value === "run_request" ||
    value === "report" ||
    value === "company_config"
  ) {
    return value;
  }
  return "report";
}

function normalizeChatSessions(value: unknown, companies: CompanyProfile[], now: string): HivewardChatSession[] {
  const companyIds = new Set(companies.map((company) => company.id));
  const fallbackCompanyId = companies[0]?.id ?? defaultCompanyId;
  return Array.isArray(value)
    ? value.flatMap((item) => {
        if (!isRecord(item)) return [];
        const id = readString(item.id) ?? `chat-session-${nanoid(8)}`;
        const companyId = readString(item.companyId);
        const resolvedCompanyId = companyId && companyIds.has(companyId) ? companyId : fallbackCompanyId;
        return [{
          id,
          companyId: resolvedCompanyId,
          harnessId: normalizeHarnessId(item.harnessId),
          roleScope: normalizeChatRoleScope(item.roleScope),
          title: readString(item.title) ?? "New chat",
          nativeSessionId: readString(item.nativeSessionId),
          nativeSessionState: normalizeNativeSessionState(item.nativeSessionState) ?? "unknown",
          modelId: readString(item.modelId),
          agentId: readString(item.agentId),
          thinkingEffort: normalizeChatThinkingEffort(item.thinkingEffort),
          mode: normalizeChatMode(item.mode),
          status: normalizeChatSessionStatus(item.status) ?? "active",
          createdAt: readString(item.createdAt) ?? now,
          updatedAt: readString(item.updatedAt) ?? readString(item.createdAt) ?? now,
          endedAt: readString(item.endedAt)
        }];
      })
    : [];
}

function normalizeChatMessages(value: unknown, sessions: HivewardChatSession[], now: string): Record<string, HivewardChatMessage[]> {
  const sessionIds = new Set(sessions.map((session) => session.id));
  const messagesBySession: Record<string, HivewardChatMessage[]> = {};
  for (const session of sessions) {
    messagesBySession[session.id] = [];
  }

  if (!isRecord(value)) return messagesBySession;
  for (const [sessionId, messages] of Object.entries(value)) {
    if (!sessionIds.has(sessionId) || !Array.isArray(messages)) continue;
    const session = sessions.find((candidate) => candidate.id === sessionId);
    messagesBySession[sessionId] = messages.flatMap((item) => normalizeChatMessage(item, sessionId, session?.harnessId ?? "openclaw", now));
  }
  return messagesBySession;
}

function normalizeChatMessage(value: unknown, sessionId: string, fallbackHarnessId: HarnessId, now: string): HivewardChatMessage[] {
  if (!isRecord(value)) return [];
  return [{
    id: readString(value.id) ?? `chat-message-${nanoid(8)}`,
    sessionId,
    role: normalizeChatMessageRole(value.role),
    content: readString(value.content) ?? "",
    attachments: normalizeStoredChatAttachments(value.attachments),
    harnessId: normalizeHarnessId(value.harnessId, fallbackHarnessId),
    modelId: readString(value.modelId),
    nativeMessageId: readString(value.nativeMessageId),
    status: normalizeChatMessageStatus(value.status) ?? "sent",
    runtimeRef: normalizeChatRuntimeRef(value.runtimeRef),
    createdAt: readString(value.createdAt) ?? now,
    updatedAt: readString(value.updatedAt)
  }];
}

function normalizeChatRoleScope(value: unknown): ChatRoleScope | undefined {
  if (!isRecord(value)) return undefined;
  const role = value.role === "leader" ? "leader" : value.role === "ceo" ? "ceo" : undefined;
  if (!role) return undefined;
  return {
    companyId: readString(value.companyId),
    role,
    leaderId: readString(value.leaderId),
    blueprintId: readString(value.blueprintId)
  };
}

function normalizeHarnessId(value: unknown, fallback: HarnessId = "openclaw"): HarnessId {
  if (value === "codex" || value === "claudeCode" || value === "openclaw") return value;
  return fallback;
}

function normalizeChatMode(value: unknown): ChatMode {
  return value === "blueprint" ? "blueprint" : "chat";
}

function normalizeChatThinkingEffort(value: unknown): ChatThinkingEffort | undefined {
  return value === "off" ||
    value === "minimal" ||
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "adaptive" ||
    value === "xhigh" ||
    value === "max"
    ? value
    : undefined;
}

function normalizeChatSessionStatus(value: unknown): ChatSessionStatus | undefined {
  return value === "active" || value === "ended" || value === "native_missing" || value === "failed" ? value : undefined;
}

function normalizeNativeSessionState(value: unknown): ChatNativeSessionState | undefined {
  return value === "unknown" || value === "resumable" || value === "missing" ? value : undefined;
}

function normalizeChatMessageRole(value: unknown): HivewardChatMessage["role"] {
  if (value === "assistant" || value === "system") return value;
  return "user";
}

function normalizeChatMessageStatus(value: unknown): ChatMessageStatus | undefined {
  return value === "sent" || value === "streaming" || value === "failed" ? value : undefined;
}

function normalizeStoredChatAttachments(value: unknown): ChatAttachment[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const attachments = value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const id = readString(item.id);
    const name = readString(item.name);
    const mediaType = readString(item.mediaType);
    const size = typeof item.size === "number" && Number.isFinite(item.size) ? item.size : undefined;
    if (!id || !name || !mediaType || size === undefined) return [];
    return [{
      id,
      name,
      mediaType,
      size,
      text: readString(item.text),
      truncated: item.truncated === true
    }];
  });
  return attachments.length ? attachments : undefined;
}

function normalizeChatRuntimeRef(value: unknown): ChatRuntimeRef | undefined {
  if (!isRecord(value)) return undefined;
  const taskId = readString(value.taskId);
  const runId = readString(value.runId);
  const sessionKey = readString(value.sessionKey);
  const source = value.source === "openclaw" || value.source === "codex" || value.source === "claude" ? value.source : undefined;
  const status = readString(value.status);
  const updatedAt = readString(value.updatedAt);
  if (!taskId || !runId || !sessionKey || !source || !status || !updatedAt) return undefined;
  return {
    taskId,
    runId,
    sessionKey,
    source,
    status,
    updatedAt,
    error: readString(value.error),
    usage: isRecord(value.usage) ? value.usage as unknown as ChatRuntimeRef["usage"] : undefined,
    timings: isRecord(value.timings) ? value.timings as unknown as ChatRuntimeRef["timings"] : undefined
  };
}

function deriveChatSessionTitle(session: HivewardChatSession, message: HivewardChatMessage): string {
  if (session.title && session.title !== "New chat") return session.title;
  if (message.role !== "user") return session.title || "New chat";
  const content = message.content.trim();
  if (!content) return session.title || "New chat";
  return content.length > 42 ? `${content.slice(0, 42)}...` : content;
}

function buildRoleDirectory(
  index: HivewardStoreIndex,
  companyId: string,
  now: string,
  rawDirectory?: Partial<CompanyRoleDirectory>
): CompanyRoleDirectory {
  const company = index.companies.find((candidate) => candidate.id === companyId);
  const existingCeo = rawDirectory?.ceo;
  const previousDriverBindings = Array.isArray(rawDirectory?.driverBindings) ? rawDirectory.driverBindings : [];
  const ceoId = existingCeo?.id || "ceo";
  const ceoLabel = existingCeo?.label || "CEO";
  const driverBindings: RoleDriverBinding[] = [];
  const ceoDriverBinding = buildRoleDriverBinding({
    companyId,
    roleId: ceoId,
    roleLabel: ceoLabel,
    roleSource: existingCeo,
    previousDriverBindings,
    now
  });
  driverBindings.push(ceoDriverBinding);
  const ceo: CompanyRoleProfile = {
    id: ceoId,
    companyId,
    kind: "ceo",
    label: ceoLabel,
    description: existingCeo?.description || `Company-level command role for ${company?.name ?? companyId}.`,
    defaultDriverBindingId: ceoDriverBinding.id,
    capabilities: ["read_company", "discuss", "delegate_leader", "submit_inbox"],
    instructions: existingCeo?.instructions,
    createdAt: existingCeo?.createdAt || now,
    updatedAt: now
  };
  const previousLeaders = Array.isArray(rawDirectory?.leaders) ? rawDirectory.leaders : [];
  const blueprints = index.blueprintIndex
    .filter((blueprint) => blueprint.companyId === companyId)
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" }));
  const leaders = blueprints.map((blueprint) => {
    const existing =
      previousLeaders.find((leader) => leader.blueprintId === blueprint.id) ??
      previousLeaders.find((leader) => leader.id === `leader-${safeRoleIdSegment(blueprint.id)}`);
    const leaderId = existing?.id || `leader-${safeRoleIdSegment(blueprint.id)}`;
    const leaderLabel = existing?.label || `${blueprint.name} Leader`;
    const leaderDriverBinding = buildRoleDriverBinding({
      companyId,
      roleId: leaderId,
      roleLabel: leaderLabel,
      roleSource: existing,
      previousDriverBindings,
      now
    });
    driverBindings.push(leaderDriverBinding);
    return {
      id: leaderId,
      companyId,
      kind: "leader",
      label: leaderLabel,
      description: existing?.description || `Leader role bound to ${blueprint.name}.`,
      blueprintId: blueprint.id,
      defaultDriverBindingId: leaderDriverBinding.id,
      capabilities: ["read_blueprint", "discuss", "create_blueprint_proposal", "submit_inbox"],
      instructions: existing?.instructions,
      createdAt: existing?.createdAt || now,
      updatedAt: now
    } satisfies CompanyRoleProfile;
  });

  return {
    companyId,
    ceo,
    leaders,
    driverBindings,
    updatedAt: now
  };
}

function buildRoleDriverBinding(input: {
  companyId: string;
  roleId: string;
  roleLabel: string;
  roleSource?: unknown;
  previousDriverBindings: RoleDriverBinding[];
  now: string;
}): RoleDriverBinding {
  const source = isRecord(input.roleSource) ? input.roleSource : {};
  const requestedBindingId = readString(source.defaultDriverBindingId);
  const existing =
    (requestedBindingId ? input.previousDriverBindings.find((binding) => binding.id === requestedBindingId) : undefined) ??
    input.previousDriverBindings.find((binding) => binding.roleId === input.roleId);
  const id = existing?.id ?? requestedBindingId ?? `driver-${safeRoleIdSegment(input.roleId)}-default`;

  return {
    id,
    companyId: input.companyId,
    roleId: input.roleId,
    harnessId: normalizeRoleDriverHarnessId(existing?.harnessId ?? source.harnessId),
    label: existing?.label || `${input.roleLabel} default driver`,
    agentId: existing?.agentId ?? readString(source.defaultAgentId),
    modelId: existing?.modelId ?? readString(source.modelId),
    workspacePath: existing?.workspacePath ?? readString(source.workspacePath),
    createdAt: existing?.createdAt || input.now,
    updatedAt: input.now
  };
}

function normalizeRoleDriverHarnessId(value: unknown): RoleDriverBinding["harnessId"] {
  return value === "codex" || value === "claude" || value === "openclaw" ? value : "openclaw";
}

function buildArchitectureBlueprintView(
  index: HivewardStoreIndex,
  companyId: string,
  roles: CompanyRoleDirectory
): ArchitectureBlueprintView {
  const companyRuns = index.runIndex.filter((run) => run.companyId === companyId);
  const companyInbox = index.inboxItems[companyId] ?? [];
  const pendingInboxCount = companyInbox.filter((item) => item.status === "pending").length;
  const ceoNode = {
    id: roles.ceo.id,
    roleId: roles.ceo.id,
    kind: "ceo" as const,
    label: roles.ceo.label,
    pendingApprovalCount: pendingInboxCount + companyRuns.filter((run) => run.status === "waiting_approval").length,
    latestRunStatus: latestRun(companyRuns)?.status,
    latestRunAt: latestRun(companyRuns)?.startedAt,
    position: { x: 0, y: 0 }
  };
  const leaderSpacing = 280;
  const leaders = roles.leaders.map((leader, indexOffset) => {
    const blueprint = leader.blueprintId
      ? index.blueprintIndex.find((candidate) => candidate.companyId === companyId && candidate.id === leader.blueprintId)
      : undefined;
    const runs = leader.blueprintId ? companyRuns.filter((run) => run.blueprintId === leader.blueprintId) : [];
    const latest = latestRun(runs);
    return {
      id: leader.id,
      roleId: leader.id,
      kind: "leader" as const,
      label: leader.label,
      blueprintId: leader.blueprintId,
      blueprintName: blueprint?.name,
      pendingApprovalCount:
        runs.filter((run) => run.status === "waiting_approval").length +
        companyInbox.filter((item) => item.status === "pending" && item.blueprintId === leader.blueprintId).length,
      latestRunStatus: latest?.status,
      latestRunAt: latest?.startedAt,
      lastImportAt: blueprint?.updatedAt,
      position: {
        x: (indexOffset - (roles.leaders.length - 1) / 2) * leaderSpacing,
        y: 220
      }
    };
  });

  return {
    companyId,
    rootRoleId: roles.ceo.id,
    nodes: [ceoNode, ...leaders],
    edges: leaders.map((leader) => ({
      id: `${roles.ceo.id}-${leader.id}`,
      source: roles.ceo.id,
      target: leader.id,
      label: "delegates"
    })),
    updatedAt: roles.updatedAt
  };
}

function latestRun(runs: BlueprintRunSummary[]): BlueprintRunSummary | undefined {
  return runs
    .slice()
    .sort((left, right) => new Date(right.startedAt).getTime() - new Date(left.startedAt).getTime())[0];
}

function createInboxItem(input: {
  companyId: string;
  type: InboxItemType;
  title: string;
  summary: string;
  createdByRoleId: string;
  targetRoleId?: string;
  blueprintId?: string;
  blueprintName?: string;
  payload?: Record<string, unknown>;
  now: string;
}): InboxItem {
  return {
    id: `inbox-${nanoid(10)}`,
    companyId: input.companyId,
    type: input.type,
    status: "pending",
    title: input.title,
    summary: input.summary,
    createdByRoleId: input.createdByRoleId,
    targetRoleId: input.targetRoleId,
    blueprintId: input.blueprintId,
    blueprintName: input.blueprintName,
    payload: input.payload,
    createdAt: input.now,
    updatedAt: input.now
  };
}

function readBlueprintPackagePayload(value: unknown): PortableBlueprintPackage | undefined {
  if (!value) return undefined;
  try {
    return readPortableBlueprintPackage(value);
  } catch {
    return undefined;
  }
}

function inferLeaderRoleId(roles: CompanyRoleDirectory, blueprintId: string | undefined): string | undefined {
  if (!blueprintId) return undefined;
  return roles.leaders.find((leader) => leader.blueprintId === blueprintId)?.id;
}

function safeRoleIdSegment(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "") || nanoid(8);
}

function normalizeBlueprintIndexEntry(
  entry: BlueprintIndexEntry,
  fallbackCompanyId: string,
  now: string
): BlueprintIndexEntry {
  return {
    id: entry.id,
    companyId: readScopedCompanyId(entry.companyId, fallbackCompanyId),
    name: entry.name,
    description: entry.description,
    version: entry.version,
    createdAt: entry.createdAt || now,
    updatedAt: entry.updatedAt || now
  };
}

function normalizeRunSummary(run: BlueprintRunSummary, fallbackCompanyId: string): BlueprintRunSummary {
  return {
    ...run,
    companyId: readScopedCompanyId(run.companyId, fallbackCompanyId),
    blueprintName: run.blueprintName || run.blueprintId
  };
}

function toBlueprintIndexEntry(blueprint: BlueprintDefinition): BlueprintIndexEntry {
  return {
    id: blueprint.id,
    companyId: blueprint.companyId,
    name: blueprint.name,
    description: blueprint.description,
    version: blueprint.version,
    createdAt: blueprint.createdAt,
    updatedAt: blueprint.updatedAt
  };
}

function toBlueprintRunSummary(run: BlueprintRun, blueprint?: BlueprintDefinition): BlueprintRunSummary {
  return {
    ...run,
    blueprintName: run.blueprintName ?? blueprint?.name ?? run.blueprintId
  };
}

function applyNodeRunFactsToRun(run: BlueprintRunSummary, nodeRuns: BlueprintNodeRun[]): BlueprintRunSummary {
  const usage = nodeRuns.flatMap((nodeRun) => (nodeRun.usage ? [nodeRun.usage] : []));
  const openclawRefs = nodeRuns.flatMap((nodeRun) => (nodeRun.openclawRef ? [nodeRun.openclawRef] : []));
  return {
    ...run,
    totalInputTokens: usage.reduce((sum, item) => sum + item.inputTokens, 0),
    totalOutputTokens: usage.reduce((sum, item) => sum + item.outputTokens, 0),
    totalCostUsd: Number(usage.reduce((sum, item) => sum + item.costUsd, 0).toFixed(6)),
    openclawRefs
  };
}

function createArchivePlaceholderBlueprint(run: BlueprintRunSummary, now: string): BlueprintDefinition {
  return {
    id: run.blueprintId,
    companyId: run.companyId,
    name: run.blueprintName,
    version: run.blueprintVersion,
    nodes: [],
    edges: [],
    variables: {},
    display: {},
    createdAt: run.startedAt || now,
    updatedAt: run.endedAt ?? run.startedAt ?? now
  };
}

function isFileNotFoundError(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function readPendingApprovalUpstream(input: unknown): PendingApprovalItem["upstream"] {
  if (!isRecord(input) || !Array.isArray(input.upstream)) return undefined;

  const upstream = input.upstream.flatMap((candidate) => {
    if (!isRecord(candidate)) return [];
    const nodeId = readString(candidate.nodeId);
    const nodeLabel = readString(candidate.nodeLabel);
    const nodeRunId = readString(candidate.nodeRunId);
    if (!nodeId || !nodeLabel || !nodeRunId) return [];
    return [
      {
        nodeId,
        nodeLabel,
        nodeRunId,
        output: candidate.output
      }
    ];
  });

  return upstream.length ? upstream : undefined;
}

function readOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function readAgentRuntimeId(value: unknown): AgentRuntimeId | undefined {
  return value === "openclaw" || value === "codex" || value === "claude" ? value : undefined;
}

function readRequiredCompanyName(value: unknown): string {
  const name = readOptionalString(value);
  if (!name) {
    throw new Error("Company name is required.");
  }
  return name;
}

function readScopedCompanyId(value: unknown, fallbackCompanyId: string): string {
  return typeof value === "string" && value ? value : fallbackCompanyId;
}

function normalizeSelectedCompanyId(
  value: unknown,
  companies: CompanyProfile[],
  fallbackCompanyId: string
): string | null {
  if (value === null) return null;
  if (typeof value === "string" && companies.some((company) => company.id === value)) {
    return value;
  }
  return fallbackCompanyId;
}

function normalizeCompany(company: CompanyProfile, now: string): CompanyProfile {
  return {
    id: company.id,
    name: company.name,
    logoUrl: company.logoUrl,
    logoLabel: company.logoLabel,
    businessGoal: company.businessGoal,
    createdAt: company.createdAt || now,
    updatedAt: company.updatedAt || now
  };
}

function maxTimestamp(values: Array<string | undefined>): string | undefined {
  const normalized = values.filter((value): value is string => typeof value === "string" && value.length > 0);
  if (normalized.length === 0) return undefined;
  return normalized.sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0];
}

function nextBlueprintId(blueprints: Array<{ id: string }>): string {
  const used = new Set(blueprints.map((blueprint) => blueprint.id));
  let id = `blueprint-${nanoid(8)}`;
  while (used.has(id)) {
    id = `blueprint-${nanoid(8)}`;
  }
  return id;
}

function nextCompanyId(companies: Array<{ id: string }>): string {
  const used = new Set(companies.map((company) => company.id));
  let id = `company-${nanoid(8)}`;
  while (used.has(id)) {
    id = `company-${nanoid(8)}`;
  }
  return id;
}

function nextChatSessionId(sessions: Array<{ id: string }>): string {
  const used = new Set(sessions.map((session) => session.id));
  let id = `chat-session-${nanoid(10)}`;
  while (used.has(id)) {
    id = `chat-session-${nanoid(10)}`;
  }
  return id;
}

function nextChatMessageId(messages: Array<{ id: string }>): string {
  const used = new Set(messages.map((message) => message.id));
  let id = `chat-message-${nanoid(10)}`;
  while (used.has(id)) {
    id = `chat-message-${nanoid(10)}`;
  }
  return id;
}

function companyInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return parts
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase();
}

function nextImportedBlueprintName(blueprints: Array<{ name: string }>, baseName: string): string {
  const normalizedBase = baseName.trim() || "Imported blueprint";
  const used = new Set(blueprints.map((blueprint) => blueprint.name));
  if (!used.has(normalizedBase)) return normalizedBase;

  let index = 2;
  let candidate = `${normalizedBase} (${index})`;
  while (used.has(candidate)) {
    index += 1;
    candidate = `${normalizedBase} (${index})`;
  }
  return candidate;
}
