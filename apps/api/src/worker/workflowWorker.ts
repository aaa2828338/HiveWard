import { nanoid } from "nanoid";
import type { OpenClawAdapter } from "@openclaw-cui/adapter";
import type {
  AgentNodeConfig,
  ApprovalNodeConfig,
  ConditionNodeConfig,
  OpenClawObjectRef,
  ParallelAgentsNodeConfig,
  SendNodeConfig,
  SummaryNodeConfig,
  WorkflowDefinition,
  WorkflowNode,
  WorkflowNodeEvent,
  WorkflowNodeRun,
  WorkflowRun
} from "@openclaw-cui/shared";
import type { FileCuiStore } from "../store/fileCuiStore";

const executableTypes = new Set(["agent", "parallel_agents", "condition", "summary", "approval", "send"]);

export class WorkflowWorker {
  constructor(
    private readonly store: FileCuiStore,
    private readonly adapter: OpenClawAdapter
  ) {}

  async startRun(workflow: WorkflowDefinition, startedBy: string): Promise<WorkflowRun> {
    const run = await this.store.createWorkflowRun(workflow, startedBy);
    const runningRun = {
      ...run,
      status: "running" as const
    };
    await this.store.updateWorkflowRun(runningRun);
    await this.event(runningRun.id, "workflow.run.started", `Workflow ${workflow.name} started.`);
    await this.runUntilBlockedOrDone(workflow, runningRun);
    const updated = await this.store.getWorkflowRun(run.id);
    if (!updated) throw new Error(`Workflow run not found after start: ${run.id}`);
    return updated;
  }

  async approveRun(workflow: WorkflowDefinition, run: WorkflowRun): Promise<WorkflowRun> {
    const waiting = (await this.store.listNodeRuns(run.id)).find((nodeRun) => nodeRun.status === "waiting_approval");
    if (!waiting) {
      throw new Error("No node is waiting for approval.");
    }

    const now = new Date().toISOString();
    await this.store.upsertNodeRun({
      ...waiting,
      status: "succeeded",
      endedAt: now,
      output: { approved: true }
    });
    await this.event(run.id, "node.run.completed", `${waiting.nodeLabel} approved.`, waiting.id);
    const running = { ...run, status: "running" as const };
    await this.store.updateWorkflowRun(running);
    await this.runUntilBlockedOrDone(workflow, running);
    const updated = await this.store.getWorkflowRun(run.id);
    if (!updated) throw new Error(`Workflow run not found after approval: ${run.id}`);
    return updated;
  }

  private async runUntilBlockedOrDone(workflow: WorkflowDefinition, run: WorkflowRun): Promise<void> {
    const startedAt = Date.now();

    while (true) {
      const nodeRuns = await this.store.listNodeRuns(run.id);
      if (nodeRuns.some((nodeRun) => nodeRun.status === "waiting_approval")) {
        await this.store.updateWorkflowRun({ ...run, status: "waiting_approval" });
        return;
      }

      const readyNodes = this.findReadyNodes(workflow, nodeRuns);
      if (readyNodes.length === 0) {
        const pending = workflow.nodes.filter((node) => this.isExecutable(node) && !this.hasTerminalNodeRun(node, nodeRuns));
        if (pending.length === 0) {
          const completed = await this.applyRunTotals(run, startedAt, "succeeded");
          await this.store.updateWorkflowRun(completed);
          await this.event(run.id, "workflow.run.completed", `Workflow ${workflow.name} completed.`);
          return;
        }

        const failed = await this.applyRunTotals(run, startedAt, "failed");
        await this.store.updateWorkflowRun(failed);
        await this.event(run.id, "workflow.run.failed", `Workflow ${workflow.name} could not continue. Pending nodes: ${pending.map((node) => node.id).join(", ")}.`);
        return;
      }

      await Promise.all(readyNodes.map((node) => this.executeNode(workflow, run, node)));
    }
  }

  private findReadyNodes(workflow: WorkflowDefinition, nodeRuns: WorkflowNodeRun[]): WorkflowNode[] {
    return workflow.nodes.filter((node) => {
      if (!this.isExecutable(node)) return false;
      if (this.hasNodeRun(node, nodeRuns)) return false;

      const incoming = workflow.edges.filter((edge) => edge.target === node.id);
      if (incoming.length === 0) return true;

      return incoming.every((edge) => {
        const source = workflow.nodes.find((candidate) => candidate.id === edge.source);
        if (!source || !this.isExecutable(source)) return true;
        return nodeRuns.some((nodeRun) => nodeRun.nodeId === source.id && nodeRun.status === "succeeded");
      });
    });
  }

  private async executeNode(workflow: WorkflowDefinition, run: WorkflowRun, node: WorkflowNode): Promise<void> {
    const nodeRun = await this.createRunningNodeRun(workflow, run, node);

    try {
      if (node.type === "agent") {
        await this.executeAgentNode(workflow, run, node, nodeRun);
      } else if (node.type === "parallel_agents") {
        await this.executeParallelAgentsNode(run, node, nodeRun);
      } else if (node.type === "condition") {
        await this.completeNode(nodeRun, { result: this.evaluateCondition(workflow, node.config as ConditionNodeConfig) });
      } else if (node.type === "summary") {
        await this.executeSummaryNode(run, node, nodeRun);
      } else if (node.type === "approval") {
        await this.waitForApproval(node, nodeRun);
      } else if (node.type === "send") {
        await this.executeSendNode(workflow, run, node, nodeRun);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown node failure";
      await this.failNode(nodeRun, message);
    }
  }

  private async createRunningNodeRun(workflow: WorkflowDefinition, run: WorkflowRun, node: WorkflowNode): Promise<WorkflowNodeRun> {
    const now = new Date().toISOString();
    const nodeRun: WorkflowNodeRun = {
      id: `node-run-${nanoid(10)}`,
      workflowRunId: run.id,
      workflowId: workflow.id,
      nodeId: node.id,
      nodeLabel: node.config.label,
      nodeType: node.type,
      status: "running",
      queuedAt: now,
      startedAt: now
    };
    await this.store.upsertNodeRun(nodeRun);
    await this.event(run.id, "node.run.queued", `${node.config.label} queued.`, nodeRun.id);
    await this.event(run.id, "node.run.started", `${node.config.label} started.`, nodeRun.id);
    return nodeRun;
  }

  private async executeAgentNode(
    workflow: WorkflowDefinition,
    run: WorkflowRun,
    node: WorkflowNode,
    nodeRun: WorkflowNodeRun
  ): Promise<void> {
    const config = node.config as AgentNodeConfig;
    const result = await this.adapter.startAgentTask({
      workflowRunId: run.id,
      nodeRunId: nodeRun.id,
      agentId: config.agentId ?? "main",
      agentName: config.agentName,
      prompt: config.prompt,
      modelId: config.modelId,
      input: {
        upstream: await this.collectUpstreamOutputs(workflow, run.id, node)
      },
      tools: config.tools
    });

    const openclawRef: OpenClawObjectRef = {
      source: "openclaw",
      sourceId: result.taskId,
      sourceUpdatedAt: result.updatedAt,
      taskId: result.taskId,
      runId: result.runId,
      sessionKey: result.sessionKey,
      usageRef: result.usage?.id
    };

    await this.completeNode(
      {
        ...nodeRun,
        usage: result.usage,
        openclawRef
      },
      result.output ?? "",
      openclawRef
    );
  }

  private async executeParallelAgentsNode(run: WorkflowRun, node: WorkflowNode, nodeRun: WorkflowNodeRun): Promise<void> {
    const config = node.config as ParallelAgentsNodeConfig;
    const outputs = await Promise.all(
      config.agents.map((agent) =>
        this.adapter.startAgentTask({
          workflowRunId: run.id,
          nodeRunId: nodeRun.id,
          agentId: agent.agentId ?? "main",
          agentName: agent.agentName,
          prompt: agent.prompt,
          modelId: agent.modelId,
          input: {},
          tools: agent.tools
        })
      )
    );
    await this.completeNode(nodeRun, outputs.map((output) => output.output ?? ""));
  }

  private async executeSummaryNode(run: WorkflowRun, node: WorkflowNode, nodeRun: WorkflowNodeRun): Promise<void> {
    const config = node.config as SummaryNodeConfig;
    if (config.mode === "openclaw_agent") {
      const result = await this.adapter.startAgentTask({
        workflowRunId: run.id,
        nodeRunId: nodeRun.id,
        agentId: "main",
        agentName: "summary-agent",
        prompt: config.prompt ?? "Summarize upstream node outputs.",
        modelId: config.modelId,
        input: await this.store.listNodeRuns(run.id),
        tools: []
      });
      await this.completeNode(nodeRun, result.output ?? "");
      return;
    }

    const upstream = (await this.store.listNodeRuns(run.id))
      .filter((candidate) => candidate.status === "succeeded")
      .map((candidate) => ({
        node: candidate.nodeLabel,
        output: candidate.output
      }));
    await this.completeNode(nodeRun, { merged: upstream });
  }

  private async waitForApproval(node: WorkflowNode, nodeRun: WorkflowNodeRun): Promise<void> {
    const config = node.config as ApprovalNodeConfig;
    const waiting: WorkflowNodeRun = {
      ...nodeRun,
      status: "waiting_approval",
      output: {
        approverHint: config.approverHint,
        instructions: config.instructions
      }
    };
    await this.store.upsertNodeRun(waiting);
    await this.event(nodeRun.workflowRunId, "node.run.waiting_approval", `${node.config.label} is waiting for approval.`, nodeRun.id);
  }

  private async executeSendNode(workflow: WorkflowDefinition, run: WorkflowRun, node: WorkflowNode, nodeRun: WorkflowNodeRun): Promise<void> {
    const config = node.config as SendNodeConfig;
    const summaryRun = (await this.store.listNodeRuns(run.id)).find((candidate) => candidate.nodeType === "summary");
    const body = config.bodyTemplate
      .replaceAll("{{workflow.name}}", workflow.name)
      .replaceAll("{{summary}}", JSON.stringify(summaryRun?.output ?? {}));
    const result = await this.adapter.sendChannelMessage({
      channelId: config.channelId,
      target: config.target,
      body,
      workflowRunId: run.id,
      nodeRunId: nodeRun.id
    });
    await this.completeNode(nodeRun, result);
  }

  private evaluateCondition(workflow: WorkflowDefinition, config: ConditionNodeConfig): boolean {
    const expression = config.expression.trim();
    if (expression === "true") return true;
    if (expression === "false") return false;
    return workflow.variables[expression] === "true";
  }

  private async collectUpstreamOutputs(
    workflow: WorkflowDefinition,
    workflowRunId: string,
    node: WorkflowNode
  ): Promise<Array<{ nodeId: string; nodeLabel: string; output: unknown }>> {
    const sourceIds = new Set(workflow.edges.filter((edge) => edge.target === node.id).map((edge) => edge.source));
    if (sourceIds.size === 0) return [];

    return (await this.store.listNodeRuns(workflowRunId))
      .filter((candidate) => sourceIds.has(candidate.nodeId) && candidate.status === "succeeded")
      .map((candidate) => ({
        nodeId: candidate.nodeId,
        nodeLabel: candidate.nodeLabel,
        output: candidate.output
      }));
  }

  private async completeNode(nodeRun: WorkflowNodeRun, output: unknown, openclawRef?: OpenClawObjectRef): Promise<void> {
    const completed: WorkflowNodeRun = {
      ...nodeRun,
      status: "succeeded",
      endedAt: new Date().toISOString(),
      output,
      openclawRef: openclawRef ?? nodeRun.openclawRef
    };
    await this.store.upsertNodeRun(completed);
    await this.event(nodeRun.workflowRunId, "node.run.completed", `${nodeRun.nodeLabel} completed.`, nodeRun.id, openclawRef);
  }

  private async failNode(nodeRun: WorkflowNodeRun, error: string): Promise<void> {
    await this.store.upsertNodeRun({
      ...nodeRun,
      status: "failed",
      endedAt: new Date().toISOString(),
      error
    });
    await this.event(nodeRun.workflowRunId, "node.run.failed", `${nodeRun.nodeLabel} failed: ${error}`, nodeRun.id);
  }

  private async applyRunTotals(run: WorkflowRun, startedAt: number, status: "succeeded" | "failed"): Promise<WorkflowRun> {
    const endedAt = new Date().toISOString();
    const nodeRuns = await this.store.listNodeRuns(run.id);
    const usage = nodeRuns.flatMap((nodeRun) => (nodeRun.usage ? [nodeRun.usage] : []));
    const openclawRefs = nodeRuns.flatMap((nodeRun) => (nodeRun.openclawRef ? [nodeRun.openclawRef] : []));
    return {
      ...run,
      status,
      endedAt,
      durationMs: Date.now() - startedAt,
      totalInputTokens: usage.reduce((sum, item) => sum + item.inputTokens, 0),
      totalOutputTokens: usage.reduce((sum, item) => sum + item.outputTokens, 0),
      totalCostUsd: Number(usage.reduce((sum, item) => sum + item.costUsd, 0).toFixed(6)),
      openclawRefs
    };
  }

  private hasNodeRun(node: WorkflowNode, nodeRuns: WorkflowNodeRun[]): boolean {
    return nodeRuns.some((nodeRun) => nodeRun.nodeId === node.id);
  }

  private hasTerminalNodeRun(node: WorkflowNode, nodeRuns: WorkflowNodeRun[]): boolean {
    return nodeRuns.some(
      (nodeRun) =>
        nodeRun.nodeId === node.id &&
        ["succeeded", "failed", "cancelled", "skipped"].includes(nodeRun.status)
    );
  }

  private isExecutable(node: WorkflowNode): boolean {
    return executableTypes.has(node.type) && !node.disabled;
  }

  private async event(
    workflowRunId: string,
    type: WorkflowNodeEvent["type"],
    message: string,
    nodeRunId?: string,
    openclawRef?: OpenClawObjectRef
  ): Promise<void> {
    await this.store.appendEvent({
      id: `event-${nanoid(10)}`,
      workflowRunId,
      nodeRunId,
      type,
      message,
      createdAt: new Date().toISOString(),
      openclawRef
    });
  }
}
