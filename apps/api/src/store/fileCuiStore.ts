import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { nanoid } from "nanoid";
import type {
  CatalogSnapshot,
  CompanyOverview,
  CompanyProfile,
  PendingApprovalItem,
  PortableWorkflowPackage,
  WorkspaceDashboard,
  WorkflowDefinition,
  WorkflowImportDefaults,
  WorkflowNodeEvent,
  WorkflowNodeRun,
  WorkflowRun,
  WorkflowRunView
} from "@openclaw-cui/shared";
import {
  createBlankWorkflow,
  createDefaultCompanies,
  createDefaultWorkflows,
  createDefaultWorkspaceDashboard,
  defaultCompanyId,
  hydrateImportedWorkflow,
  normalizeWorkspaceDashboard
} from "@openclaw-cui/shared";

interface CUIStoreState {
  companies: CompanyProfile[];
  selectedCompanyId: string | null;
  workflows: WorkflowDefinition[];
  workflowRuns: WorkflowRun[];
  nodeRuns: WorkflowNodeRun[];
  events: WorkflowNodeEvent[];
  catalogSnapshot?: CatalogSnapshot;
  companyDashboards: Record<string, WorkspaceDashboard>;
}

type RawCUIStoreState = Partial<CUIStoreState> & {
  workspaceDashboard?: Partial<WorkspaceDashboard>;
  companyDashboards?: Record<string, Partial<WorkspaceDashboard>>;
};

export class FileCuiStore {
  private readonly filePath: string;
  private operationQueue: Promise<void> = Promise.resolve();

  constructor(filePath = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../data/cui-store.json")) {
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
          workflows: createDefaultWorkflows(now, seededCompanyId, this.defaultSdkWorkingDirectory()),
          workflowRuns: [],
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

  async listWorkflows(): Promise<WorkflowDefinition[]> {
    return this.enqueue(async () => {
      const state = await this.readStateUnlocked();
      const companyId = this.getCurrentCompanyId(state);
      if (!companyId) return [];
      return state.workflows.filter((workflow) => workflow.companyId === companyId);
    });
  }

  async getWorkflow(id: string): Promise<WorkflowDefinition | undefined> {
    return this.enqueue(async () => {
      const state = await this.readStateUnlocked();
      const companyId = this.getCurrentCompanyId(state);
      if (!companyId) return undefined;
      return state.workflows.find((workflow) => workflow.id === id && workflow.companyId === companyId);
    });
  }

  async saveWorkflow(workflow: WorkflowDefinition): Promise<WorkflowDefinition> {
    return this.enqueue(async () => {
      const state = await this.readStateUnlocked();
      const companyId = this.requireSelectedCompanyId(state);
      const now = new Date().toISOString();
      const existingIndex = state.workflows.findIndex((item) => item.id === workflow.id && item.companyId === companyId);
      const currentVersion = existingIndex >= 0 ? state.workflows[existingIndex]!.version : workflow.version;
      const currentCreatedAt = existingIndex >= 0 ? state.workflows[existingIndex]!.createdAt : now;
      const nextWorkflow: WorkflowDefinition = {
        ...workflow,
        companyId,
        version: existingIndex >= 0 ? currentVersion + 1 : workflow.version,
        updatedAt: now,
        createdAt: currentCreatedAt
      };

      if (existingIndex >= 0) {
        state.workflows[existingIndex] = nextWorkflow;
      } else {
        state.workflows.push(nextWorkflow);
      }

      await this.writeStateUnlocked(state);
      return nextWorkflow;
    });
  }

  async createWorkflow(input: { name?: string; description?: string } = {}): Promise<WorkflowDefinition> {
    return this.enqueue(async () => {
      const state = await this.readStateUnlocked();
      const companyId = this.requireSelectedCompanyId(state);
      const now = new Date().toISOString();
      const workflow = createBlankWorkflow({
        id: nextWorkflowId(state.workflows),
        companyId,
        now,
        name: input.name,
        description: input.description
      });

      state.workflows.push(workflow);
      await this.writeStateUnlocked(state);
      return workflow;
    });
  }

  async importWorkflowPackage(
    workflowPackage: PortableWorkflowPackage,
    defaults: WorkflowImportDefaults = {}
  ): Promise<WorkflowDefinition[]> {
    return this.enqueue(async () => {
      const state = await this.readStateUnlocked();
      const companyId = this.requireSelectedCompanyId(state);
      const now = new Date().toISOString();
      const imported: WorkflowDefinition[] = [];

      for (const portableWorkflow of workflowPackage.workflows) {
        const workflow = hydrateImportedWorkflow(portableWorkflow, {
          id: nextWorkflowId(state.workflows),
          companyId,
          now,
          defaults,
          name: nextImportedWorkflowName(state.workflows, portableWorkflow.name)
        });
        state.workflows.push(workflow);
        imported.push(workflow);
      }

      await this.writeStateUnlocked(state);
      return imported;
    });
  }

  async createWorkflowRun(workflow: WorkflowDefinition, startedBy: string): Promise<WorkflowRun> {
    return this.enqueue(async () => {
      const state = await this.readStateUnlocked();
      const run: WorkflowRun = {
        id: `run-${nanoid(10)}`,
        companyId: workflow.companyId,
        workflowId: workflow.id,
        workflowVersion: workflow.version,
        status: "queued",
        startedBy,
        startedAt: new Date().toISOString(),
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCostUsd: 0,
        openclawRefs: []
      };
      state.workflowRuns.push(run);
      await this.writeStateUnlocked(state);
      return run;
    });
  }

  async updateWorkflowRun(run: WorkflowRun): Promise<void> {
    await this.enqueue(async () => {
      const state = await this.readStateUnlocked();
      const index = state.workflowRuns.findIndex((item) => item.id === run.id);
      if (index < 0) {
        throw new Error(`Workflow run not found: ${run.id}`);
      }
      state.workflowRuns[index] = run;
      await this.writeStateUnlocked(state);
    });
  }

  async getWorkflowRun(id: string): Promise<WorkflowRun | undefined> {
    return this.enqueue(async () => {
      const state = await this.readStateUnlocked();
      const companyId = this.getCurrentCompanyId(state);
      const run = state.workflowRuns.find((candidate) => candidate.id === id);
      if (!run) return undefined;
      if (!companyId || run.companyId !== companyId) return undefined;
      return run;
    });
  }

  async upsertNodeRun(nodeRun: WorkflowNodeRun): Promise<void> {
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

  async listNodeRuns(workflowRunId: string): Promise<WorkflowNodeRun[]> {
    return this.enqueue(async () => {
      const state = await this.readStateUnlocked();
      return state.nodeRuns.filter((run) => run.workflowRunId === workflowRunId);
    });
  }

  async appendEvent(event: WorkflowNodeEvent): Promise<void> {
    await this.enqueue(async () => {
      const state = await this.readStateUnlocked();
      state.events.push(event);
      await this.writeStateUnlocked(state);
    });
  }

  async getRunView(workflowRunId: string): Promise<WorkflowRunView | undefined> {
    return this.enqueue(async () => {
      const state = await this.readStateUnlocked();
      const companyId = this.getCurrentCompanyId(state);
      const view = this.getRunViewFromState(state, workflowRunId);
      if (!view) return undefined;
      if (!companyId || view.run.companyId !== companyId) return undefined;
      return view;
    });
  }

  async getLatestRunViewForWorkflow(workflowId: string): Promise<WorkflowRunView | undefined> {
    return this.enqueue(async () => {
      const state = await this.readStateUnlocked();
      const companyId = this.getCurrentCompanyId(state);
      if (!companyId) return undefined;
      const run = state.workflowRuns
        .filter((item) => item.companyId === companyId && item.workflowId === workflowId)
        .sort((left, right) => new Date(right.startedAt).getTime() - new Date(left.startedAt).getTime())[0];
      if (!run) return undefined;
      return this.getRunViewFromState(state, run.id);
    });
  }

  async listRunViews(): Promise<WorkflowRunView[]> {
    return this.enqueue(async () => {
      const state = await this.readStateUnlocked();
      const companyId = this.getCurrentCompanyId(state);
      if (!companyId) return [];
      return state.workflowRuns
        .filter((run) => run.companyId === companyId)
        .slice()
        .sort((left, right) => new Date(right.startedAt).getTime() - new Date(left.startedAt).getTime())
        .map((run) => this.getRunViewFromState(state, run.id))
        .filter((view): view is WorkflowRunView => Boolean(view));
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
          const run = state.workflowRuns.find((candidate) => candidate.id === nodeRun.workflowRunId);
          const workflow = state.workflows.find((candidate) => candidate.id === nodeRun.workflowId);
          if (!run || !workflow || run.companyId !== companyId || workflow.companyId !== companyId) return [];

          const output = isRecord(nodeRun.output) ? nodeRun.output : undefined;
          const item: PendingApprovalItem = {
            workflowId: workflow.id,
            workflowName: workflow.name,
            workflowRunId: run.id,
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

  private async readStateUnlocked(): Promise<CUIStoreState> {
    const raw = await readFile(this.filePath, "utf8");
    return this.normalizeState(JSON.parse(raw) as RawCUIStoreState);
  }

  private async writeStateUnlocked(state: CUIStoreState): Promise<void> {
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

  private normalizeState(state: RawCUIStoreState): CUIStoreState {
    const now = new Date().toISOString();
    const companies = Array.isArray(state.companies) && state.companies.length > 0 ? state.companies.map((company) => normalizeCompany(company, now)) : createDefaultCompanies(now);
    const primaryCompanyId = companies[0]?.id ?? defaultCompanyId;
    const selectedCompanyId = normalizeSelectedCompanyId(state.selectedCompanyId, companies, primaryCompanyId);
    const normalizedWorkflows = Array.isArray(state.workflows)
      ? state.workflows.map((workflow) => ({
          ...workflow,
          companyId: readScopedCompanyId(workflow.companyId, primaryCompanyId)
        }))
      : createDefaultWorkflows(now, primaryCompanyId, this.defaultSdkWorkingDirectory());
    const workflowCompanyIds = new Map(normalizedWorkflows.map((workflow) => [workflow.id, workflow.companyId]));
    const normalizedRuns = Array.isArray(state.workflowRuns)
      ? state.workflowRuns.map((run) => ({
          ...run,
          companyId: readScopedCompanyId(run.companyId ?? workflowCompanyIds.get(run.workflowId), primaryCompanyId)
        }))
      : [];

    const companyDashboards: Record<string, WorkspaceDashboard> = {};
    for (const company of companies) {
      const rawDashboard = isRecord(state.companyDashboards) ? state.companyDashboards[company.id] : undefined;
      const legacyDashboard = company.id === primaryCompanyId ? state.workspaceDashboard : undefined;
      companyDashboards[company.id] = normalizeWorkspaceDashboard(
        (rawDashboard as Partial<WorkspaceDashboard> | undefined) ?? legacyDashboard,
        now
      );
    }

    return {
      companies,
      selectedCompanyId,
      workflows: normalizedWorkflows,
      workflowRuns: normalizedRuns,
      nodeRuns: Array.isArray(state.nodeRuns) ? state.nodeRuns : [],
      events: Array.isArray(state.events) ? state.events : [],
      catalogSnapshot: state.catalogSnapshot,
      companyDashboards
    };
  }

  private getRunViewFromState(state: CUIStoreState, workflowRunId: string): WorkflowRunView | undefined {
    const run = state.workflowRuns.find((item) => item.id === workflowRunId);
    if (!run) return undefined;
    return {
      run,
      nodeRuns: state.nodeRuns.filter((item) => item.workflowRunId === workflowRunId),
      events: state.events.filter((item) => item.workflowRunId === workflowRunId)
    };
  }

  private defaultSdkWorkingDirectory(): string {
    return resolve(dirname(this.filePath), "..");
  }

  private buildCompanyOverviews(state: CUIStoreState): CompanyOverview[] {
    return state.companies.map((company) => {
      const workflows = state.workflows.filter((workflow) => workflow.companyId === company.id);
      const runs = state.workflowRuns.filter((run) => run.companyId === company.id);
      const runIds = new Set(runs.map((run) => run.id));
      const dashboard = state.companyDashboards[company.id] ?? createDefaultWorkspaceDashboard(new Date().toISOString());
      return {
        ...company,
        workflowCount: workflows.length,
        runCount: runs.length,
        totalTokens: runs.reduce((sum, run) => sum + run.totalInputTokens + run.totalOutputTokens, 0),
        totalCostUsd: Number(runs.reduce((sum, run) => sum + run.totalCostUsd, 0).toFixed(6)),
        dashboardWidgetCount: dashboard.dashboardWidgets.length,
        savedViewCount: dashboard.savedViews.length,
        noteCount: dashboard.notes.length,
        activeApprovalCount: state.nodeRuns.filter((nodeRun) => nodeRun.status === "waiting_approval" && runIds.has(nodeRun.workflowRunId)).length,
        latestRunAt: maxTimestamp(runs.map((run) => run.endedAt ?? run.startedAt))
      };
    });
  }

  private getCurrentCompanyId(state: CUIStoreState): string | undefined {
    return state.selectedCompanyId ?? undefined;
  }

  private requireSelectedCompanyId(state: CUIStoreState): string {
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

function nextWorkflowId(workflows: WorkflowDefinition[]): string {
  const used = new Set(workflows.map((workflow) => workflow.id));
  let id = `workflow-${nanoid(8)}`;
  while (used.has(id)) {
    id = `workflow-${nanoid(8)}`;
  }
  return id;
}

function nextImportedWorkflowName(workflows: WorkflowDefinition[], baseName: string): string {
  const normalizedBase = baseName.trim() || "Imported workflow";
  const used = new Set(workflows.map((workflow) => workflow.name));
  if (!used.has(normalizedBase)) return normalizedBase;

  let index = 2;
  let candidate = `${normalizedBase} (${index})`;
  while (used.has(candidate)) {
    index += 1;
    candidate = `${normalizedBase} (${index})`;
  }
  return candidate;
}
