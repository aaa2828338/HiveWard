import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { nanoid } from "nanoid";
import type {
  CatalogSnapshot,
  PendingApprovalItem,
  WorkspaceDashboard,
  WorkflowDefinition,
  WorkflowNodeEvent,
  WorkflowNodeRun,
  WorkflowRun,
  WorkflowRunView
} from "@openclaw-cui/shared";
import {
  createDefaultWorkflows,
  createDefaultWorkspaceDashboard,
  normalizeWorkspaceDashboard
} from "@openclaw-cui/shared";

interface CUIStoreState {
  workflows: WorkflowDefinition[];
  workflowRuns: WorkflowRun[];
  nodeRuns: WorkflowNodeRun[];
  events: WorkflowNodeEvent[];
  catalogSnapshot?: CatalogSnapshot;
  workspaceDashboard: WorkspaceDashboard;
}

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
        await this.writeStateUnlocked({
          workflows: createDefaultWorkflows(now),
          workflowRuns: [],
          nodeRuns: [],
          events: [],
          workspaceDashboard: createDefaultWorkspaceDashboard(now)
        });
      }
    });
  }

  async listWorkflows(): Promise<WorkflowDefinition[]> {
    return this.enqueue(async () => (await this.readStateUnlocked()).workflows);
  }

  async getWorkflow(id: string): Promise<WorkflowDefinition | undefined> {
    return this.enqueue(async () => {
      const state = await this.readStateUnlocked();
      return state.workflows.find((workflow) => workflow.id === id);
    });
  }

  async saveWorkflow(workflow: WorkflowDefinition): Promise<WorkflowDefinition> {
    return this.enqueue(async () => {
      const state = await this.readStateUnlocked();
      const now = new Date().toISOString();
      const existingIndex = state.workflows.findIndex((item) => item.id === workflow.id);
      const nextWorkflow: WorkflowDefinition = {
        ...workflow,
        version: existingIndex >= 0 ? state.workflows[existingIndex]!.version + 1 : workflow.version,
        updatedAt: now,
        createdAt: existingIndex >= 0 ? state.workflows[existingIndex]!.createdAt : now
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

  async createWorkflowRun(workflow: WorkflowDefinition, startedBy: string): Promise<WorkflowRun> {
    return this.enqueue(async () => {
      const state = await this.readStateUnlocked();
      const now = new Date().toISOString();
      const run: WorkflowRun = {
        id: `run-${nanoid(10)}`,
        workflowId: workflow.id,
        workflowVersion: workflow.version,
        status: "queued",
        startedBy,
        startedAt: now,
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
      return state.workflowRuns.find((run) => run.id === id);
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
      return this.getRunViewFromState(state, workflowRunId);
    });
  }

  async getLatestRunViewForWorkflow(workflowId: string): Promise<WorkflowRunView | undefined> {
    return this.enqueue(async () => {
      const state = await this.readStateUnlocked();
      const run = state.workflowRuns
        .filter((item) => item.workflowId === workflowId)
        .sort((left, right) => new Date(right.startedAt).getTime() - new Date(left.startedAt).getTime())[0];
      if (!run) return undefined;
      return this.getRunViewFromState(state, run.id);
    });
  }

  async listRunViews(): Promise<WorkflowRunView[]> {
    return this.enqueue(async () => {
      const state = await this.readStateUnlocked();
      return state.workflowRuns
        .slice()
        .sort((left, right) => new Date(right.startedAt).getTime() - new Date(left.startedAt).getTime())
        .map((run) => this.getRunViewFromState(state, run.id))
        .filter((view): view is WorkflowRunView => Boolean(view));
    });
  }

  async listPendingApprovals(): Promise<PendingApprovalItem[]> {
    return this.enqueue(async () => {
      const state = await this.readStateUnlocked();
      return state.nodeRuns
        .filter((nodeRun) => nodeRun.status === "waiting_approval")
        .flatMap((nodeRun) => {
          const run = state.workflowRuns.find((candidate) => candidate.id === nodeRun.workflowRunId);
          const workflow = state.workflows.find((candidate) => candidate.id === nodeRun.workflowId);
          if (!run || !workflow) return [];

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
    return this.enqueue(async () => (await this.readStateUnlocked()).workspaceDashboard);
  }

  async saveDashboardState(dashboard: WorkspaceDashboard): Promise<WorkspaceDashboard> {
    return this.enqueue(async () => {
      const state = await this.readStateUnlocked();
      state.workspaceDashboard = normalizeWorkspaceDashboard(dashboard, new Date().toISOString());
      state.workspaceDashboard.updatedAt = new Date().toISOString();
      await this.writeStateUnlocked(state);
      return state.workspaceDashboard;
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
    return this.normalizeState(JSON.parse(raw) as Partial<CUIStoreState>);
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

  private normalizeState(state: Partial<CUIStoreState>): CUIStoreState {
    const now = new Date().toISOString();
    return {
      workflows: Array.isArray(state.workflows) ? state.workflows : createDefaultWorkflows(now),
      workflowRuns: Array.isArray(state.workflowRuns) ? state.workflowRuns : [],
      nodeRuns: Array.isArray(state.nodeRuns) ? state.nodeRuns : [],
      events: Array.isArray(state.events) ? state.events : [],
      catalogSnapshot: state.catalogSnapshot,
      workspaceDashboard: normalizeWorkspaceDashboard(state.workspaceDashboard, now)
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
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}
