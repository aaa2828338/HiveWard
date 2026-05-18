import { nanoid } from "nanoid";
import type { OpenClawAdapter } from "@openclaw-cui/adapter";
import type {
  AgentNodeConfig,
  ApprovalNodeConfig,
  AgentTaskResult,
  ConditionNodeConfig,
  OpenClawObjectRef,
  ParallelAgentsNodeConfig,
  SendNodeConfig,
  StartAgentTaskInput,
  SummaryNodeConfig,
  WorkflowDefinition,
  WorkflowEdge,
  WorkflowNode,
  WorkflowNodeEvent,
  WorkflowNodeRun,
  WorkflowRun
} from "@openclaw-cui/shared";
import type { FileCuiStore } from "../store/fileCuiStore";

const executableTypes = new Set(["agent", "parallel_agents", "condition", "summary", "approval", "send"]);
type IncomingEdgeState = "pending" | "satisfied" | "blocked";

export class WorkflowWorker {
  private readonly activeRuns = new Map<string, Promise<void>>();

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
    this.scheduleRun(workflow, runningRun);
    return runningRun;
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
    this.scheduleRun(workflow, running);
    return running;
  }

  private scheduleRun(workflow: WorkflowDefinition, run: WorkflowRun): void {
    if (this.activeRuns.has(run.id)) {
      return;
    }

    const execution = this.runUntilBlockedOrDone(workflow, run)
      .catch(async (error) => {
        const currentRun = await this.store.getWorkflowRun(run.id);
        if (!currentRun) return;

        const failed = await this.applyRunTotals(currentRun, new Date(currentRun.startedAt).getTime(), "failed");
        await this.store.updateWorkflowRun(failed);
        const message = error instanceof Error ? error.message : "Workflow worker crashed unexpectedly.";
        await this.event(run.id, "workflow.run.failed", `Workflow ${workflow.name} crashed: ${message}`);
      })
      .finally(() => {
        this.activeRuns.delete(run.id);
      });

    this.activeRuns.set(run.id, execution);
  }

  private async runUntilBlockedOrDone(workflow: WorkflowDefinition, run: WorkflowRun): Promise<void> {
    const startedAt = new Date(run.startedAt).getTime();

    while (true) {
      const nodeRuns = await this.store.listNodeRuns(run.id);
      const skippedNodes = this.findSkippableNodes(workflow, nodeRuns);
      if (skippedNodes.length > 0) {
        await Promise.all(skippedNodes.map((node) => this.skipNode(workflow, run, node)));
        continue;
      }

      const failedNodeRun = nodeRuns.find((nodeRun) => nodeRun.status === "failed" || nodeRun.status === "cancelled");
      if (failedNodeRun) {
        const failed = await this.applyRunTotals(run, startedAt, "failed");
        await this.store.updateWorkflowRun(failed);
        await this.event(run.id, "workflow.run.failed", `Workflow ${workflow.name} failed at node ${failedNodeRun.nodeLabel}.`);
        return;
      }
      if (nodeRuns.some((nodeRun) => nodeRun.status === "waiting_approval")) {
        await this.store.updateWorkflowRun({ ...run, status: "waiting_approval" });
        return;
      }

      const readyNodes = this.findReadyNodes(workflow, nodeRuns);
      if (readyNodes.length === 0) {
        const pending = workflow.nodes.filter((node) => this.isWorkflowStep(node) && !this.hasTerminalNodeRun(node, nodeRuns));
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
      if (!this.isRunnableNode(node)) return false;
      if (this.hasNodeRun(node, nodeRuns)) return false;

      const incoming = workflow.edges.filter((edge) => edge.target === node.id);
      if (incoming.length === 0) return true;

      return incoming.every((edge) => this.resolveIncomingEdgeState(workflow, edge, nodeRuns) === "satisfied");
    });
  }

  private findSkippableNodes(workflow: WorkflowDefinition, nodeRuns: WorkflowNodeRun[]): WorkflowNode[] {
    return workflow.nodes.filter((node) => {
      if (!this.isWorkflowStep(node)) return false;
      if (this.hasNodeRun(node, nodeRuns)) return false;

      const incoming = workflow.edges.filter((edge) => edge.target === node.id);
      if (node.disabled) {
        if (incoming.length === 0) return true;
        return incoming.every((edge) => this.resolveIncomingEdgeState(workflow, edge, nodeRuns) !== "pending");
      }
      if (incoming.length === 0) return false;

      const edgeStates = incoming.map((edge) => this.resolveIncomingEdgeState(workflow, edge, nodeRuns));
      return edgeStates.every((state) => state !== "pending") && edgeStates.some((state) => state === "blocked");
    });
  }

  private async executeNode(workflow: WorkflowDefinition, run: WorkflowRun, node: WorkflowNode): Promise<void> {
    const nodeRun = await this.createRunningNodeRun(workflow, run, node);

    try {
      if (node.type === "agent") {
        await this.executeAgentNode(workflow, run, node, nodeRun);
      } else if (node.type === "parallel_agents") {
        await this.executeParallelAgentsNode(workflow, run, node, nodeRun);
      } else if (node.type === "condition") {
        await this.completeNode(nodeRun, { result: this.evaluateCondition(workflow, node.config as ConditionNodeConfig) });
      } else if (node.type === "summary") {
        await this.executeSummaryNode(workflow, run, node, nodeRun);
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
    const { result, openclawRef } = await this.runAgentTask({
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
    if (result.status !== "succeeded") {
      await this.failNode({ ...nodeRun, openclawRef, usage: result.usage }, result.error ?? `OpenClaw agent run ${result.status}.`);
      return;
    }

    await this.completeNode(
      { ...nodeRun, openclawRef, usage: result.usage },
      result.output ?? "",
      openclawRef
    );
  }

  private async executeParallelAgentsNode(
    workflow: WorkflowDefinition,
    run: WorkflowRun,
    node: WorkflowNode,
    nodeRun: WorkflowNodeRun
  ): Promise<void> {
    const config = node.config as ParallelAgentsNodeConfig;
    if (config.agents.length === 0) {
      throw new Error("Parallel agents node has no agents configured.");
    }

    const upstream = await this.collectUpstreamOutputs(workflow, run.id, node);
    const outputs = await Promise.all(
      config.agents.map((agent) =>
        this.runAgentTask({
          workflowRunId: run.id,
          nodeRunId: nodeRun.id,
          agentId: agent.agentId ?? "main",
          agentName: agent.agentName,
          prompt: agent.prompt,
          modelId: agent.modelId,
          input: {
            upstream
          },
          tools: agent.tools
        })
      )
    );

    if (config.waitFor === "first_success") {
      const winnerIndex = outputs.findIndex((output) => output.result.status === "succeeded");
      if (winnerIndex < 0) {
        const firstFailure = outputs[0];
        await this.failNode(nodeRun, firstFailure?.result.error ?? "No parallel agent succeeded.");
        return;
      }
      await this.completeNode(nodeRun, {
        waitFor: config.waitFor,
        winner: this.formatParallelAgentOutput(config.agents[winnerIndex]!, outputs[winnerIndex]!.result),
        results: outputs.map((output, index) => this.formatParallelAgentOutput(config.agents[index]!, output.result))
      });
      return;
    }

    const failed = outputs.find((output) => output.result.status !== "succeeded");
    if (failed) {
      await this.failNode(nodeRun, failed.result.error ?? `OpenClaw agent run ${failed.result.status}.`);
      return;
    }
    await this.completeNode(
      nodeRun,
      outputs.map((output, index) => this.formatParallelAgentOutput(config.agents[index]!, output.result))
    );
  }

  private async executeSummaryNode(
    workflow: WorkflowDefinition,
    run: WorkflowRun,
    node: WorkflowNode,
    nodeRun: WorkflowNodeRun
  ): Promise<void> {
    const config = node.config as SummaryNodeConfig;
    const upstream = await this.collectUpstreamOutputs(workflow, run.id, node);
    if (config.mode === "openclaw_agent") {
      const { result } = await this.runAgentTask({
        workflowRunId: run.id,
        nodeRunId: nodeRun.id,
        agentId: "main",
        agentName: "summary-agent",
        prompt: config.prompt ?? "Summarize upstream node outputs.",
        modelId: config.modelId,
        input: {
          upstream
        },
        tools: []
      });
      if (result.status !== "succeeded") {
        await this.failNode(nodeRun, result.error ?? `OpenClaw agent run ${result.status}.`);
        return;
      }
      await this.completeNode(nodeRun, result.output ?? "");
      return;
    }

    await this.completeNode(
      nodeRun,
      {
        merged: upstream.map((candidate) => ({
          node: candidate.nodeLabel,
          output: candidate.output
        }))
      }
    );
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
    const upstream = await this.collectUpstreamOutputs(workflow, run.id, node);
    const summaryPayload = upstream.length <= 1 ? (upstream[0]?.output ?? {}) : upstream;
    const body = config.bodyTemplate
      .replaceAll("{{workflow.name}}", workflow.name)
      .replaceAll("{{summary}}", JSON.stringify(summaryPayload))
      .replaceAll("{{upstream}}", JSON.stringify(upstream));
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
    const incoming = workflow.edges.filter((edge) => edge.target === node.id);
    if (incoming.length === 0) return [];

    const nodeRuns = await this.store.listNodeRuns(workflowRunId);
    const outputs: Array<{ nodeId: string; nodeLabel: string; output: unknown }> = [];
    const seen = new Set<string>();

    for (const edge of incoming) {
      if (this.resolveIncomingEdgeState(workflow, edge, nodeRuns) !== "satisfied") {
        continue;
      }

      const sourceRun = nodeRuns.find((candidate) => candidate.nodeId === edge.source && candidate.status === "succeeded");
      if (!sourceRun || seen.has(sourceRun.nodeId)) continue;

      seen.add(sourceRun.nodeId);
      outputs.push({
        nodeId: sourceRun.nodeId,
        nodeLabel: sourceRun.nodeLabel,
        output: sourceRun.output
      });
    }

    return outputs;
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

  private async skipNode(workflow: WorkflowDefinition, run: WorkflowRun, node: WorkflowNode): Promise<void> {
    const now = new Date().toISOString();
    const reason = node.disabled ? "disabled" : "branch_not_selected";
    const skipped: WorkflowNodeRun = {
      id: `node-run-${nanoid(10)}`,
      workflowRunId: run.id,
      workflowId: workflow.id,
      nodeId: node.id,
      nodeLabel: node.config.label,
      nodeType: node.type,
      status: "skipped",
      queuedAt: now,
      startedAt: now,
      endedAt: now,
      output: {
        reason
      }
    };
    await this.store.upsertNodeRun(skipped);
    await this.event(run.id, "node.run.completed", `${node.config.label} skipped (${reason}).`, skipped.id);
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

  private isWorkflowStep(node: WorkflowNode): boolean {
    return executableTypes.has(node.type);
  }

  private isRunnableNode(node: WorkflowNode): boolean {
    return this.isWorkflowStep(node) && !node.disabled;
  }

  private resolveIncomingEdgeState(
    workflow: WorkflowDefinition,
    edge: WorkflowEdge,
    nodeRuns: WorkflowNodeRun[]
  ): IncomingEdgeState {
    const source = workflow.nodes.find((candidate) => candidate.id === edge.source);
    if (!source) return "blocked";
    if (!this.isWorkflowStep(source)) return "satisfied";

    const sourceRun = nodeRuns.find((candidate) => candidate.nodeId === source.id);
    if (!sourceRun) return "pending";
    if (!this.isTerminalStatus(sourceRun.status)) return "pending";

    const condition = edge.condition ?? "success";
    if (condition === "success") {
      return sourceRun.status === "succeeded" ? "satisfied" : "blocked";
    }
    if (condition === "failure") {
      return sourceRun.status === "failed" || sourceRun.status === "cancelled" ? "satisfied" : "blocked";
    }

    if (sourceRun.status !== "succeeded") {
      return "blocked";
    }

    const expected = condition === "true";
    const actual = this.readConditionResult(sourceRun.output);
    return actual === expected ? "satisfied" : "blocked";
  }

  private isTerminalStatus(status: WorkflowNodeRun["status"]): boolean {
    return ["succeeded", "failed", "cancelled", "skipped"].includes(status);
  }

  private readConditionResult(output: unknown): boolean | undefined {
    if (typeof output === "boolean") return output;
    if (!output || typeof output !== "object") return undefined;

    const result = (output as { result?: unknown }).result;
    return typeof result === "boolean" ? result : undefined;
  }

  private formatParallelAgentOutput(agent: AgentNodeConfig, result: AgentTaskResult) {
    return {
      agentId: agent.agentId ?? "main",
      agentName: agent.agentName,
      status: result.status,
      output: result.output ?? "",
      error: result.error,
      taskId: result.taskId,
      runId: result.runId,
      sessionKey: result.sessionKey,
      updatedAt: result.updatedAt
    };
  }

  private async runAgentTask(input: StartAgentTaskInput): Promise<{ result: AgentTaskResult; openclawRef: OpenClawObjectRef }> {
    const started = await this.adapter.startAgentTask(input);
    const openclawRef: OpenClawObjectRef = {
      source: "openclaw",
      sourceId: started.taskId,
      sourceUpdatedAt: started.updatedAt,
      taskId: started.taskId,
      runId: started.runId,
      sessionKey: started.sessionKey,
      usageRef: undefined
    };

    if (started.status === "failed" || started.status === "cancelled") {
      return {
        result: {
          ...started,
          output: undefined,
          usage: undefined
        },
        openclawRef
      };
    }

    return {
      result: await this.adapter.waitForAgentTask({
        nodeRunId: input.nodeRunId,
        taskId: started.taskId,
        runId: started.runId,
        sessionKey: started.sessionKey,
        agentId: input.agentId
      }),
      openclawRef
    };
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
