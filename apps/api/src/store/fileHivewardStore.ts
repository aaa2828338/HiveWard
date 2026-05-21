import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { nanoid } from "nanoid";
import type {
  CatalogSnapshot,
  CompanyOverview,
  CompanyProfile,
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
  BlueprintRunView
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
}

type RawHivewardStoreIndex = Partial<HivewardStoreIndex> & {
  companyDashboards?: Record<string, Partial<WorkspaceDashboard>>;
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
          }
        };
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
      delete index.companyDashboards[companyId];

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

      await this.writeIndexUnlocked(index);
      return imported;
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

    return {
      schema: storeIndexSchema,
      companies,
      selectedCompanyId,
      blueprintIndex: Array.isArray(rawIndex.blueprintIndex)
        ? rawIndex.blueprintIndex.map((entry) => normalizeBlueprintIndexEntry(entry, primaryCompanyId, now))
        : [],
      runIndex: Array.isArray(rawIndex.runIndex)
        ? rawIndex.runIndex.map((run) => normalizeRunSummary(run, primaryCompanyId))
        : [],
      catalogSnapshot: rawIndex.catalogSnapshot,
      companyDashboards
    };
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
      companyDashboards: normalizeCompanyDashboards(state.companyDashboards, companies, now)
    };

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
        activeApprovalCount: runs.filter((run) => run.status === "waiting_approval").length,
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
