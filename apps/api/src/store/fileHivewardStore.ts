import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { nanoid } from "nanoid";
import type {
  CatalogSnapshot,
  CompanyOverview,
  CompanyProfile,
  PendingApprovalItem,
  PortableMissionPackage,
  WorkspaceDashboard,
  MissionDefinition,
  MissionImportDefaults,
  MissionNodeEvent,
  MissionNodeRun,
  MissionRun,
  MissionRunView
} from "@hiveward/shared";
import {
  createBlankMission,
  createDefaultCompanies,
  createDefaultMissions,
  createDefaultWorkspaceDashboard,
  defaultCompanyId,
  hydrateImportedMission,
  normalizeWorkspaceDashboard
} from "@hiveward/shared";

interface HivewardStoreState {
  companies: CompanyProfile[];
  selectedCompanyId: string | null;
  missions: MissionDefinition[];
  missionRuns: MissionRun[];
  nodeRuns: MissionNodeRun[];
  events: MissionNodeEvent[];
  catalogSnapshot?: CatalogSnapshot;
  companyDashboards: Record<string, WorkspaceDashboard>;
}

type RawHivewardStoreState = Partial<HivewardStoreState> & {
  companyDashboards?: Record<string, Partial<WorkspaceDashboard>>;
};

export class FileHivewardStore {
  private readonly filePath: string;
  private operationQueue: Promise<void> = Promise.resolve();

  constructor(filePath = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../data/hiveward-store.json")) {
    this.filePath = filePath;
  }

  async init(): Promise<void> {
    await this.enqueue(async () => {
      await mkdir(dirname(this.filePath), { recursive: true });
      try {
        const state = await this.readStateUnlocked();
        await this.writeStateUnlocked(state);
      } catch {
        const now = new Date().toISOString();
        const companies = createDefaultCompanies(now);
        const seededCompanyId = companies[0]?.id ?? defaultCompanyId;
        await this.writeStateUnlocked({
          companies,
          selectedCompanyId: seededCompanyId,
          missions: createDefaultMissions(now, seededCompanyId),
          missionRuns: [],
          nodeRuns: [],
          events: [],
          companyDashboards: {
            [seededCompanyId]: createDefaultWorkspaceDashboard(now)
          }
        });
      }
    });
  }

  async listCompanies(): Promise<{ companies: CompanyOverview[]; selectedCompanyId?: string }> {
    return this.enqueue(async () => {
      const state = await this.readStateUnlocked();
      return {
        companies: this.buildCompanyOverviews(state),
        selectedCompanyId: state.selectedCompanyId ?? undefined
      };
    });
  }

  async selectCompany(companyId?: string): Promise<{ companies: CompanyOverview[]; selectedCompanyId?: string }> {
    return this.enqueue(async () => {
      const state = await this.readStateUnlocked();
      if (!companyId) {
        state.selectedCompanyId = null;
      } else if (state.companies.some((company) => company.id === companyId)) {
        state.selectedCompanyId = companyId;
      } else {
        throw new Error(`Company not found: ${companyId}`);
      }

      await this.writeStateUnlocked(state);
      return {
        companies: this.buildCompanyOverviews(state),
        selectedCompanyId: state.selectedCompanyId ?? undefined
      };
    });
  }

  async listMissions(): Promise<MissionDefinition[]> {
    return this.enqueue(async () => {
      const state = await this.readStateUnlocked();
      const companyId = this.getCurrentCompanyId(state);
      if (!companyId) return [];
      return state.missions.filter((mission) => mission.companyId === companyId);
    });
  }

  async getMission(id: string): Promise<MissionDefinition | undefined> {
    return this.enqueue(async () => {
      const state = await this.readStateUnlocked();
      const companyId = this.getCurrentCompanyId(state);
      if (!companyId) return undefined;
      return state.missions.find((mission) => mission.id === id && mission.companyId === companyId);
    });
  }

  async saveMission(mission: MissionDefinition): Promise<MissionDefinition> {
    return this.enqueue(async () => {
      const state = await this.readStateUnlocked();
      const companyId = this.requireSelectedCompanyId(state);
      const now = new Date().toISOString();
      const existingIndex = state.missions.findIndex((item) => item.id === mission.id && item.companyId === companyId);
      const currentVersion = existingIndex >= 0 ? state.missions[existingIndex]!.version : mission.version;
      const currentCreatedAt = existingIndex >= 0 ? state.missions[existingIndex]!.createdAt : now;
      const nextMission: MissionDefinition = {
        ...mission,
        companyId,
        version: existingIndex >= 0 ? currentVersion + 1 : mission.version,
        updatedAt: now,
        createdAt: currentCreatedAt
      };

      if (existingIndex >= 0) {
        state.missions[existingIndex] = nextMission;
      } else {
        state.missions.push(nextMission);
      }

      await this.writeStateUnlocked(state);
      return nextMission;
    });
  }

  async createMission(input: { name?: string; description?: string } = {}): Promise<MissionDefinition> {
    return this.enqueue(async () => {
      const state = await this.readStateUnlocked();
      const companyId = this.requireSelectedCompanyId(state);
      const now = new Date().toISOString();
      const mission = createBlankMission({
        id: nextMissionId(state.missions),
        companyId,
        now,
        name: input.name,
        description: input.description
      });

      state.missions.push(mission);
      await this.writeStateUnlocked(state);
      return mission;
    });
  }

  async importMissionPackage(
    missionPackage: PortableMissionPackage,
    defaults: MissionImportDefaults = {}
  ): Promise<MissionDefinition[]> {
    return this.enqueue(async () => {
      const state = await this.readStateUnlocked();
      const companyId = this.requireSelectedCompanyId(state);
      const now = new Date().toISOString();
      const imported: MissionDefinition[] = [];

      for (const portableMission of missionPackage.missions) {
        const mission = hydrateImportedMission(portableMission, {
          id: nextMissionId(state.missions),
          companyId,
          now,
          defaults,
          name: nextImportedMissionName(state.missions, portableMission.name)
        });
        state.missions.push(mission);
        imported.push(mission);
      }

      await this.writeStateUnlocked(state);
      return imported;
    });
  }

  async createMissionRun(mission: MissionDefinition, startedBy: string): Promise<MissionRun> {
    return this.enqueue(async () => {
      const state = await this.readStateUnlocked();
      const run: MissionRun = {
        id: `run-${nanoid(10)}`,
        companyId: mission.companyId,
        missionId: mission.id,
        missionVersion: mission.version,
        status: "queued",
        startedBy,
        startedAt: new Date().toISOString(),
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCostUsd: 0,
        openclawRefs: []
      };
      state.missionRuns.push(run);
      await this.writeStateUnlocked(state);
      return run;
    });
  }

  async updateMissionRun(run: MissionRun): Promise<void> {
    await this.enqueue(async () => {
      const state = await this.readStateUnlocked();
      const index = state.missionRuns.findIndex((item) => item.id === run.id);
      if (index < 0) {
        throw new Error(`Mission run not found: ${run.id}`);
      }
      state.missionRuns[index] = run;
      await this.writeStateUnlocked(state);
    });
  }

  async getMissionRun(id: string): Promise<MissionRun | undefined> {
    return this.enqueue(async () => {
      const state = await this.readStateUnlocked();
      const companyId = this.getCurrentCompanyId(state);
      const run = state.missionRuns.find((candidate) => candidate.id === id);
      if (!run) return undefined;
      if (!companyId || run.companyId !== companyId) return undefined;
      return run;
    });
  }

  async upsertNodeRun(nodeRun: MissionNodeRun): Promise<void> {
    await this.enqueue(async () => {
      const state = await this.readStateUnlocked();
      const index = state.nodeRuns.findIndex((item) => item.id === nodeRun.id);
      if (index >= 0) {
        state.nodeRuns[index] = nodeRun;
      } else {
        state.nodeRuns.push(nodeRun);
      }
      await this.writeStateUnlocked(state);
    });
  }

  async listNodeRuns(missionRunId: string): Promise<MissionNodeRun[]> {
    return this.enqueue(async () => {
      const state = await this.readStateUnlocked();
      return state.nodeRuns.filter((run) => run.missionRunId === missionRunId);
    });
  }

  async appendEvent(event: MissionNodeEvent): Promise<void> {
    await this.enqueue(async () => {
      const state = await this.readStateUnlocked();
      state.events.push(event);
      await this.writeStateUnlocked(state);
    });
  }

  async getRunView(missionRunId: string): Promise<MissionRunView | undefined> {
    return this.enqueue(async () => {
      const state = await this.readStateUnlocked();
      const companyId = this.getCurrentCompanyId(state);
      const view = this.getRunViewFromState(state, missionRunId);
      if (!view) return undefined;
      if (!companyId || view.run.companyId !== companyId) return undefined;
      return view;
    });
  }

  async getLatestRunViewForMission(missionId: string): Promise<MissionRunView | undefined> {
    return this.enqueue(async () => {
      const state = await this.readStateUnlocked();
      const companyId = this.getCurrentCompanyId(state);
      if (!companyId) return undefined;
      const run = state.missionRuns
        .filter((item) => item.companyId === companyId && item.missionId === missionId)
        .sort((left, right) => new Date(right.startedAt).getTime() - new Date(left.startedAt).getTime())[0];
      if (!run) return undefined;
      return this.getRunViewFromState(state, run.id);
    });
  }

  async listRunViews(): Promise<MissionRunView[]> {
    return this.enqueue(async () => {
      const state = await this.readStateUnlocked();
      const companyId = this.getCurrentCompanyId(state);
      if (!companyId) return [];
      return state.missionRuns
        .filter((run) => run.companyId === companyId)
        .slice()
        .sort((left, right) => new Date(right.startedAt).getTime() - new Date(left.startedAt).getTime())
        .map((run) => this.getRunViewFromState(state, run.id))
        .filter((view): view is MissionRunView => Boolean(view));
    });
  }

  async listPendingApprovals(): Promise<PendingApprovalItem[]> {
    return this.enqueue(async () => {
      const state = await this.readStateUnlocked();
      const companyId = this.getCurrentCompanyId(state);
      if (!companyId) return [];
      return state.nodeRuns
        .filter((nodeRun) => nodeRun.status === "waiting_approval")
        .flatMap((nodeRun) => {
          const run = state.missionRuns.find((candidate) => candidate.id === nodeRun.missionRunId);
          const mission = state.missions.find((candidate) => candidate.id === nodeRun.missionId);
          if (!run || !mission || run.companyId !== companyId || mission.companyId !== companyId) return [];

          const output = isRecord(nodeRun.output) ? nodeRun.output : undefined;
          const item: PendingApprovalItem = {
            missionId: mission.id,
            missionName: mission.name,
            missionRunId: run.id,
            nodeRunId: nodeRun.id,
            nodeId: nodeRun.nodeId,
            nodeLabel: nodeRun.nodeLabel,
            startedBy: run.startedBy,
            startedAt: run.startedAt,
            requestedAt: nodeRun.startedAt ?? nodeRun.queuedAt,
            approverHint: readString(output?.approverHint),
            instructions: readString(output?.instructions)
          };
          return [item];
        })
        .sort((left, right) => new Date(right.requestedAt).getTime() - new Date(left.requestedAt).getTime());
    });
  }

  async getDashboardState(): Promise<WorkspaceDashboard> {
    return this.enqueue(async () => {
      const state = await this.readStateUnlocked();
      const companyId = this.getCurrentCompanyId(state);
      if (!companyId) {
        return createDefaultWorkspaceDashboard(new Date().toISOString());
      }
      return state.companyDashboards[companyId] ?? createDefaultWorkspaceDashboard(new Date().toISOString());
    });
  }

  async saveDashboardState(dashboard: WorkspaceDashboard): Promise<WorkspaceDashboard> {
    return this.enqueue(async () => {
      const state = await this.readStateUnlocked();
      const companyId = this.requireSelectedCompanyId(state);
      state.companyDashboards[companyId] = normalizeWorkspaceDashboard(dashboard, new Date().toISOString());
      state.companyDashboards[companyId].updatedAt = new Date().toISOString();
      await this.writeStateUnlocked(state);
      return state.companyDashboards[companyId];
    });
  }

  async saveCatalogSnapshot(snapshot: CatalogSnapshot): Promise<CatalogSnapshot> {
    return this.enqueue(async () => {
      const state = await this.readStateUnlocked();
      state.catalogSnapshot = snapshot;
      await this.writeStateUnlocked(state);
      return snapshot;
    });
  }

  async getCatalogSnapshot(): Promise<CatalogSnapshot | undefined> {
    return this.enqueue(async () => {
      const state = await this.readStateUnlocked();
      return state.catalogSnapshot;
    });
  }

  private async readStateUnlocked(): Promise<HivewardStoreState> {
    const raw = await readFile(this.filePath, "utf8");
    return this.normalizeState(JSON.parse(raw) as RawHivewardStoreState);
  }

  private async writeStateUnlocked(state: HivewardStoreState): Promise<void> {
    await writeFile(this.filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.operationQueue.then(operation, operation);
    this.operationQueue = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }

  private normalizeState(state: RawHivewardStoreState): HivewardStoreState {
    const now = new Date().toISOString();
    const companies = Array.isArray(state.companies) && state.companies.length > 0 ? state.companies.map((company) => normalizeCompany(company, now)) : createDefaultCompanies(now);
    const primaryCompanyId = companies[0]?.id ?? defaultCompanyId;
    const selectedCompanyId = normalizeSelectedCompanyId(state.selectedCompanyId, companies, primaryCompanyId);
    const normalizedMissions = Array.isArray(state.missions)
      ? state.missions.map((mission) => ({
          ...mission,
          companyId: readScopedCompanyId(mission.companyId, primaryCompanyId)
        }))
      : createDefaultMissions(now, primaryCompanyId);
    const missionCompanyIds = new Map(normalizedMissions.map((mission) => [mission.id, mission.companyId]));
    const normalizedRuns = Array.isArray(state.missionRuns)
      ? state.missionRuns.map((run) => ({
          ...run,
          companyId: readScopedCompanyId(run.companyId ?? missionCompanyIds.get(run.missionId), primaryCompanyId)
        }))
      : [];

    const companyDashboards: Record<string, WorkspaceDashboard> = {};
    for (const company of companies) {
      const rawDashboard = isRecord(state.companyDashboards) ? state.companyDashboards[company.id] : undefined;
      companyDashboards[company.id] = normalizeWorkspaceDashboard(rawDashboard as Partial<WorkspaceDashboard> | undefined, now);
    }

    return {
      companies,
      selectedCompanyId,
      missions: normalizedMissions,
      missionRuns: normalizedRuns,
      nodeRuns: Array.isArray(state.nodeRuns) ? state.nodeRuns : [],
      events: Array.isArray(state.events) ? state.events : [],
      catalogSnapshot: state.catalogSnapshot,
      companyDashboards
    };
  }

  private getRunViewFromState(state: HivewardStoreState, missionRunId: string): MissionRunView | undefined {
    const run = state.missionRuns.find((item) => item.id === missionRunId);
    if (!run) return undefined;
    return {
      run,
      nodeRuns: state.nodeRuns.filter((item) => item.missionRunId === missionRunId),
      events: state.events.filter((item) => item.missionRunId === missionRunId)
    };
  }

  private buildCompanyOverviews(state: HivewardStoreState): CompanyOverview[] {
    return state.companies.map((company) => {
      const missions = state.missions.filter((mission) => mission.companyId === company.id);
      const runs = state.missionRuns.filter((run) => run.companyId === company.id);
      const runIds = new Set(runs.map((run) => run.id));
      const dashboard = state.companyDashboards[company.id] ?? createDefaultWorkspaceDashboard(new Date().toISOString());
      return {
        ...company,
        missionCount: missions.length,
        runCount: runs.length,
        totalTokens: runs.reduce((sum, run) => sum + run.totalInputTokens + run.totalOutputTokens, 0),
        totalCostUsd: Number(runs.reduce((sum, run) => sum + run.totalCostUsd, 0).toFixed(6)),
        dashboardWidgetCount: dashboard.dashboardWidgets.length,
        savedViewCount: dashboard.savedViews.length,
        noteCount: dashboard.notes.length,
        activeApprovalCount: state.nodeRuns.filter((nodeRun) => nodeRun.status === "waiting_approval" && runIds.has(nodeRun.missionRunId)).length,
        latestRunAt: maxTimestamp(runs.map((run) => run.endedAt ?? run.startedAt))
      };
    });
  }

  private getCurrentCompanyId(state: HivewardStoreState): string | undefined {
    return state.selectedCompanyId ?? undefined;
  }

  private requireSelectedCompanyId(state: HivewardStoreState): string {
    const companyId = this.getCurrentCompanyId(state);
    if (!companyId) {
      throw new Error("No company selected.");
    }
    return companyId;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
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

function nextMissionId(missions: MissionDefinition[]): string {
  const used = new Set(missions.map((mission) => mission.id));
  let id = `mission-${nanoid(8)}`;
  while (used.has(id)) {
    id = `mission-${nanoid(8)}`;
  }
  return id;
}

function nextImportedMissionName(missions: MissionDefinition[], baseName: string): string {
  const normalizedBase = baseName.trim() || "Imported mission";
  const used = new Set(missions.map((mission) => mission.name));
  if (!used.has(normalizedBase)) return normalizedBase;

  let index = 2;
  let candidate = `${normalizedBase} (${index})`;
  while (used.has(candidate)) {
    index += 1;
    candidate = `${normalizedBase} (${index})`;
  }
  return candidate;
}
