import { nanoid } from "nanoid";
import type { OpenClawAdapter } from "@openclaw-cui/adapter";
import type {
  AgentNodeConfig,
  ApprovalNodeConfig,
  AgentTaskResult,
  ConditionNodeConfig,
  LoopNodeConfig,
  ManagerNodeConfig,
  ManagerSlotNodeConfig,
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

const executableTypes = new Set(["agent", "parallel_agents", "manager", "manager_slot", "loop", "condition", "summary", "approval", "send"]);
const managerInHandlePrefix = "manager-in-";
const managerOutHandlePrefix = "manager-out-";
const managerSlotInnerOutHandle = "manager-slot-inner-out";
const managerSlotInnerInHandle = "manager-slot-inner-in";
type IncomingEdgeState = "pending" | "satisfied" | "blocked";

interface ManagerTraceItem {
  handoff: number;
  slot: number;
  nodeId: string;
  nodeLabel: string;
  status: AgentTaskResult["status"];
  output?: string;
  error?: string;
  returnEdgePresent: boolean;
  decision?: ManagerDecision;
}

interface ManagerDecision {
  status: "continue" | "retry" | "complete";
  nextSlot?: number;
  reason?: string;
}

interface ManagerSlotContext {
  manager: {
    nodeId: string;
    nodeLabel: string;
    instructions?: string;
    slot: number;
    handoff: number;
    maxHandoffs: number;
  };
  upstream: Array<{ nodeId: string; nodeLabel: string; output: unknown }>;
  previousResults: Array<{
    handoff: number;
    slot: number;
    nodeId: string;
    nodeLabel: string;
    status: AgentTaskResult["status"];
    output?: string;
    error?: string;
    decision?: ManagerDecision;
  }>;
}

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
        const message = error instanceof Error ? error.message : "Workflow worker crashed unexpectedly.";
        await this.event(run.id, "workflow.run.failed", `Workflow ${workflow.name} crashed: ${message}`);
        await this.store.updateWorkflowRun(failed);
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
        await this.event(run.id, "workflow.run.failed", `Workflow ${workflow.name} failed at node ${failedNodeRun.nodeLabel}.`);
        await this.store.updateWorkflowRun(failed);
        return;
      }
      if (nodeRuns.some((nodeRun) => nodeRun.status === "waiting_approval")) {
        await this.store.updateWorkflowRun({ ...run, status: "waiting_approval" });
        return;
      }

      const readyNodes = this.findReadyNodes(workflow, nodeRuns);
      if (readyNodes.length === 0) {
        const pending = workflow.nodes.filter(
          (node) =>
            this.isGlobalSchedulingNode(workflow, node) &&
            !this.hasCurrentTerminalNodeRun(workflow, node, nodeRuns)
        );
        if (pending.length === 0) {
          const completed = await this.applyRunTotals(run, startedAt, "succeeded");
          await this.event(run.id, "workflow.run.completed", `Workflow ${workflow.name} completed.`);
          await this.store.updateWorkflowRun(completed);
          return;
        }

        const failed = await this.applyRunTotals(run, startedAt, "failed");
        await this.event(run.id, "workflow.run.failed", `Workflow ${workflow.name} could not continue. Pending nodes: ${pending.map((node) => node.id).join(", ")}.`);
        await this.store.updateWorkflowRun(failed);
        return;
      }

      await Promise.all(readyNodes.map((node) => this.executeNode(workflow, run, node)));
    }
  }

  private findReadyNodes(workflow: WorkflowDefinition, nodeRuns: WorkflowNodeRun[]): WorkflowNode[] {
    return workflow.nodes.filter((node) => {
      if (!this.isRunnableNode(node)) return false;
      if (!this.isGlobalSchedulingNode(workflow, node)) return false;
      if (this.hasCurrentNodeRun(workflow, node, nodeRuns)) return false;

      const incoming = this.getSchedulingIncomingEdges(workflow, node);
      if (incoming.length === 0) return true;

      const requiredAfterIndex = this.getRequiredAfterIndex(workflow, node, nodeRuns);
      return incoming.every((edge) => this.resolveIncomingEdgeState(workflow, edge, nodeRuns, requiredAfterIndex) === "satisfied");
    });
  }

  private findSkippableNodes(workflow: WorkflowDefinition, nodeRuns: WorkflowNodeRun[]): WorkflowNode[] {
    return workflow.nodes.filter((node) => {
      if (!this.isGlobalSchedulingNode(workflow, node)) return false;
      if (this.hasCurrentNodeRun(workflow, node, nodeRuns)) return false;

      const incoming = this.getSchedulingIncomingEdges(workflow, node);
      if (node.disabled) {
        if (incoming.length === 0) return true;
        const requiredAfterIndex = this.getRequiredAfterIndex(workflow, node, nodeRuns);
        return incoming.every((edge) => this.resolveIncomingEdgeState(workflow, edge, nodeRuns, requiredAfterIndex) !== "pending");
      }
      if (incoming.length === 0) return false;

      const requiredAfterIndex = this.getRequiredAfterIndex(workflow, node, nodeRuns);
      const edgeStates = incoming.map((edge) => this.resolveIncomingEdgeState(workflow, edge, nodeRuns, requiredAfterIndex));
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
      } else if (node.type === "manager") {
        await this.executeManagerNode(workflow, run, node, nodeRun);
      } else if (node.type === "manager_slot") {
        await this.failNode(nodeRun, "Manager slot nodes can only run when called by their manager.");
      } else if (node.type === "loop") {
        await this.executeLoopNode(workflow, run, node, nodeRun);
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
    await this.executeAgentNodeWithInput(workflow, run, node, nodeRun, {
      upstream: await this.collectUpstreamOutputs(workflow, run.id, node)
    });
  }

  private async executeAgentNodeWithInput(
    _workflow: WorkflowDefinition,
    run: WorkflowRun,
    node: WorkflowNode,
    nodeRun: WorkflowNodeRun,
    input: unknown
  ): Promise<AgentTaskResult> {
    const config = node.config as AgentNodeConfig;
    const { result, openclawRef } = await this.runAgentTask({
      workflowRunId: run.id,
      nodeRunId: nodeRun.id,
      agentId: config.agentId ?? "main",
      agentName: config.agentName,
      prompt: config.prompt,
      modelId: config.modelId,
      input,
      tools: config.tools
    });
    if (result.status !== "succeeded") {
      await this.failNode({ ...nodeRun, openclawRef, usage: result.usage }, result.error ?? `OpenClaw agent run ${result.status}.`);
      return result;
    }

    await this.completeNode(
      { ...nodeRun, openclawRef, usage: result.usage },
      result.output ?? "",
      openclawRef
    );
    return result;
  }

  private async executeParallelAgentsNode(
    workflow: WorkflowDefinition,
    run: WorkflowRun,
    node: WorkflowNode,
    nodeRun: WorkflowNodeRun
  ): Promise<void> {
    await this.executeParallelAgentsNodeWithUpstream(
      run,
      node,
      nodeRun,
      await this.collectUpstreamOutputs(workflow, run.id, node)
    );
  }

  private async executeParallelAgentsNodeWithUpstream(
    run: WorkflowRun,
    node: WorkflowNode,
    nodeRun: WorkflowNodeRun,
    upstream: Array<{ nodeId: string; nodeLabel: string; output: unknown }>
  ): Promise<void> {
    const config = node.config as ParallelAgentsNodeConfig;
    if (config.agents.length === 0) {
      throw new Error("Parallel agents node has no agents configured.");
    }

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

  private async executeManagerNode(
    workflow: WorkflowDefinition,
    run: WorkflowRun,
    node: WorkflowNode,
    nodeRun: WorkflowNodeRun,
    upstream?: Array<{ nodeId: string; nodeLabel: string; output: unknown }>
  ): Promise<AgentTaskResult> {
    const config = node.config as ManagerNodeConfig;
    const portCount = normalizeInteger(config.portCount, 1, 8, 3);
    const maxHandoffs = normalizeInteger(config.maxHandoffs, 1, 50, 12);
    const managerUpstream = upstream ?? await this.collectUpstreamOutputs(workflow, run.id, node);
    const trace: ManagerTraceItem[] = [];
    let slot = this.firstConnectedManagerSlot(workflow, node, portCount);

    if (!slot) {
      const output = {
        status: "completed",
        reason: "manager_has_no_connected_slots",
        trace
      };
      await this.completeNode(nodeRun, output);
      return this.syntheticAgentResult(nodeRun.id, "succeeded", stringifyManagerSlotOutput(output));
    }

    for (let handoff = 1; handoff <= maxHandoffs; handoff += 1) {
      const assignment = this.findManagerSlotAssignment(workflow, node, slot);
      if (!assignment) {
        const output = {
          status: "completed",
          reason: `manager_slot_${slot}_is_not_connected`,
          trace
        };
        await this.completeNode(nodeRun, output);
        return this.syntheticAgentResult(nodeRun.id, "succeeded", stringifyManagerSlotOutput(output));
      }

      if (assignment.target.disabled) {
        trace.push({
          handoff,
          slot,
          nodeId: assignment.target.id,
          nodeLabel: assignment.target.config.label,
          status: "cancelled",
          error: "disabled",
          returnEdgePresent: assignment.returnEdgePresent,
          decision: this.resolveManagerDecision({ status: "skipped" }, slot, portCount)
        });
        slot += 1;
        if (slot > portCount) {
          const output = {
            status: "completed",
            reason: "manager_reached_final_slot",
            trace
          };
          await this.completeNode(nodeRun, output);
          return this.syntheticAgentResult(nodeRun.id, "succeeded", stringifyManagerSlotOutput(output));
        }
        continue;
      }

      const managerContext: ManagerSlotContext = {
        manager: {
          nodeId: node.id,
          nodeLabel: node.config.label,
          instructions: config.instructions,
          slot,
          handoff,
          maxHandoffs
        },
        upstream: managerUpstream,
        previousResults: trace.map((item) => ({
          handoff: item.handoff,
          slot: item.slot,
          nodeId: item.nodeId,
          nodeLabel: item.nodeLabel,
          status: item.status,
          output: item.output,
          error: item.error,
          decision: item.decision
        }))
      };
      let result: AgentTaskResult;

      if (assignment.target.type === "agent") {
        const participantRun = await this.createRunningNodeRun(workflow, run, assignment.target);
        result = await this.executeAgentNodeWithInput(workflow, run, assignment.target, participantRun, managerContext);
      } else if (assignment.target.type === "manager_slot") {
        const slotRun = await this.createRunningNodeRun(workflow, run, assignment.target);
        result = await this.executeManagerSlotNode(workflow, run, assignment.target, slotRun, managerContext);
      } else if (assignment.target.type === "manager") {
        const managerRun = await this.createRunningNodeRun(workflow, run, assignment.target);
        result = await this.executeManagerNode(workflow, run, assignment.target, managerRun, [
          {
            nodeId: node.id,
            nodeLabel: node.config.label,
            output: managerContext
          }
        ]);
      } else {
        const error = `Manager slot ${slot} targets unsupported node type ${assignment.target.type}.`;
        await this.failNode(nodeRun, error);
        return this.syntheticAgentResult(nodeRun.id, "failed", undefined, error);
      }

      const traceItem: ManagerTraceItem = {
        handoff,
        slot,
        nodeId: assignment.target.id,
        nodeLabel: assignment.target.config.label,
        status: result.status,
        output: result.output,
        error: result.error,
        returnEdgePresent: assignment.returnEdgePresent
      };
      trace.push(traceItem);

      if (result.status !== "succeeded") {
        const error = result.error ?? `Manager participant ${assignment.target.config.label} returned ${result.status}.`;
        await this.failNode(nodeRun, error);
        return this.syntheticAgentResult(nodeRun.id, "failed", undefined, error);
      }

      const decision = this.resolveManagerDecision(result.output, slot, portCount, {
        ignoreCompletionStatus: assignment.target.type === "manager" && isManagerCompletionEnvelope(result.output)
      });
      traceItem.decision = decision;
      if (decision.status === "complete" || !decision.nextSlot) {
        const output = {
          status: "completed",
          reason: decision.reason ?? "manager_completed",
          trace
        };
        await this.completeNode(nodeRun, output);
        return this.syntheticAgentResult(nodeRun.id, "succeeded", stringifyManagerSlotOutput(output));
      }

      slot = decision.nextSlot;
    }

    const error = `Manager exceeded max handoffs (${maxHandoffs}).`;
    await this.failNode(nodeRun, error);
    return this.syntheticAgentResult(nodeRun.id, "failed", undefined, error);
  }

  private async executeManagerSlotNode(
    workflow: WorkflowDefinition,
    run: WorkflowRun,
    slotNode: WorkflowNode,
    slotRun: WorkflowNodeRun,
    context: ManagerSlotContext
  ): Promise<AgentTaskResult> {
    const childNodes = workflow.nodes.filter((node) => node.parentId === slotNode.id && this.isRunnableNode(node));
    const scopeStartIndex = Math.max(0, (await this.store.listNodeRuns(run.id)).length - 1);
    const boundaryOutput = {
      status: "manager_slot_input",
      manager: context.manager,
      upstream: context.upstream,
      previousResults: context.previousResults
    };

    if (childNodes.length === 0) {
      const output = JSON.stringify({
        status: "complete",
        reason: "manager_slot_empty",
        input: boundaryOutput
      });
      await this.completeNode(slotRun, output);
      return this.syntheticAgentResult(slotRun.id, "succeeded", output);
    }

    const childIds = new Set(childNodes.map((node) => node.id));
    while (true) {
      const nodeRuns = await this.store.listNodeRuns(run.id);
      const failed = nodeRuns.find(
        (nodeRun, index) =>
          index > scopeStartIndex &&
          childIds.has(nodeRun.nodeId) &&
          (nodeRun.status === "failed" || nodeRun.status === "cancelled")
      );
      if (failed) {
        const error = failed.error ?? `${failed.nodeLabel} returned ${failed.status}.`;
        await this.failNode(slotRun, error);
        return this.syntheticAgentResult(slotRun.id, "failed", undefined, error);
      }

      const skippable = childNodes.filter((node) => this.isScopedSkippableNode(workflow, slotNode, node, nodeRuns, scopeStartIndex));
      if (skippable.length > 0) {
        await Promise.all(skippable.map((node) => this.skipNode(workflow, run, node)));
        continue;
      }

      const ready = childNodes.filter((node) => this.isScopedReadyNode(workflow, slotNode, node, nodeRuns, scopeStartIndex));
      if (ready.length > 0) {
        await Promise.all(
          ready.map((node) =>
            this.executeScopedNode(
              workflow,
              run,
              node,
              this.collectScopedUpstreamOutputs(workflow, slotNode, node, nodeRuns, scopeStartIndex, boundaryOutput)
            )
          )
        );
        continue;
      }

      const output = this.resolveManagerSlotOutput(workflow, slotNode, childNodes, nodeRuns, scopeStartIndex);
      if (output !== undefined) {
        const serialized = stringifyManagerSlotOutput(output);
        await this.completeNode(slotRun, serialized);
        return this.syntheticAgentResult(slotRun.id, "succeeded", serialized);
      }

      const pending = childNodes
        .filter((node) => !this.findLatestNodeRun(nodeRuns, node.id, undefined, scopeStartIndex))
        .map((node) => node.id);
      const error = `Manager slot ${slotNode.config.label} could not continue. Pending nodes: ${pending.join(", ") || "unknown"}.`;
      await this.failNode(slotRun, error);
      return this.syntheticAgentResult(slotRun.id, "failed", undefined, error);
    }
  }

  private async executeScopedNode(
    workflow: WorkflowDefinition,
    run: WorkflowRun,
    node: WorkflowNode,
    upstream: Array<{ nodeId: string; nodeLabel: string; output: unknown }>
  ): Promise<void> {
    const nodeRun = await this.createRunningNodeRun(workflow, run, node);
    if (node.type === "agent") {
      await this.executeAgentNodeWithInput(workflow, run, node, nodeRun, { upstream });
    } else if (node.type === "parallel_agents") {
      await this.executeParallelAgentsNodeWithUpstream(run, node, nodeRun, upstream);
    } else if (node.type === "condition") {
      await this.completeNode(nodeRun, { result: this.evaluateCondition(workflow, node.config as ConditionNodeConfig) });
    } else if (node.type === "summary") {
      await this.executeSummaryNodeWithUpstream(run, node, nodeRun, upstream);
    } else if (node.type === "send") {
      await this.executeSendNodeWithUpstream(run, node, nodeRun, workflow.name, upstream);
    } else {
      await this.failNode(nodeRun, `Node type ${node.type} is not supported inside a manager slot yet.`);
    }
  }

  private isScopedReadyNode(
    workflow: WorkflowDefinition,
    slotNode: WorkflowNode,
    node: WorkflowNode,
    nodeRuns: WorkflowNodeRun[],
    scopeStartIndex: number
  ): boolean {
    if (this.findLatestNodeRun(nodeRuns, node.id, undefined, scopeStartIndex)) return false;
    const incoming = this.getScopedIncomingEdges(workflow, slotNode, node);
    if (incoming.length === 0) return true;
    return incoming.every((edge) => this.resolveScopedEdgeState(workflow, slotNode, edge, nodeRuns, scopeStartIndex) === "satisfied");
  }

  private isScopedSkippableNode(
    workflow: WorkflowDefinition,
    slotNode: WorkflowNode,
    node: WorkflowNode,
    nodeRuns: WorkflowNodeRun[],
    scopeStartIndex: number
  ): boolean {
    if (this.findLatestNodeRun(nodeRuns, node.id, undefined, scopeStartIndex)) return false;
    const incoming = this.getScopedIncomingEdges(workflow, slotNode, node);
    if (incoming.length === 0) return false;
    const states = incoming.map((edge) => this.resolveScopedEdgeState(workflow, slotNode, edge, nodeRuns, scopeStartIndex));
    return states.every((state) => state !== "pending") && states.some((state) => state === "blocked");
  }

  private getScopedIncomingEdges(workflow: WorkflowDefinition, slotNode: WorkflowNode, node: WorkflowNode): WorkflowEdge[] {
    return workflow.edges.filter((edge) => {
      if (edge.target !== node.id) return false;
      if (edge.source === slotNode.id) return edge.sourceHandle === managerSlotInnerOutHandle;
      const source = workflow.nodes.find((candidate) => candidate.id === edge.source);
      return source?.parentId === slotNode.id;
    });
  }

  private resolveScopedEdgeState(
    workflow: WorkflowDefinition,
    slotNode: WorkflowNode,
    edge: WorkflowEdge,
    nodeRuns: WorkflowNodeRun[],
    scopeStartIndex: number
  ): IncomingEdgeState {
    if (edge.source === slotNode.id && edge.sourceHandle === managerSlotInnerOutHandle) return "satisfied";
    const source = workflow.nodes.find((candidate) => candidate.id === edge.source);
    if (!source || source.parentId !== slotNode.id) return "blocked";
    const sourceRun = this.findLatestNodeRun(nodeRuns, source.id, undefined, scopeStartIndex);
    if (!sourceRun) return "pending";
    if (!this.isTerminalStatus(sourceRun.status)) return "pending";

    const condition = edge.condition ?? "success";
    if (condition === "success") return sourceRun.status === "succeeded" ? "satisfied" : "blocked";
    if (condition === "failure") return sourceRun.status === "failed" || sourceRun.status === "cancelled" ? "satisfied" : "blocked";
    if (sourceRun.status !== "succeeded") return "blocked";

    const expected = condition === "true";
    return this.readConditionResult(sourceRun.output) === expected ? "satisfied" : "blocked";
  }

  private collectScopedUpstreamOutputs(
    workflow: WorkflowDefinition,
    slotNode: WorkflowNode,
    node: WorkflowNode,
    nodeRuns: WorkflowNodeRun[],
    scopeStartIndex: number,
    boundaryOutput: unknown
  ): Array<{ nodeId: string; nodeLabel: string; output: unknown }> {
    const incoming = this.getScopedIncomingEdges(workflow, slotNode, node);
    if (incoming.length === 0) {
      return [{ nodeId: slotNode.id, nodeLabel: slotNode.config.label, output: boundaryOutput }];
    }

    const outputs: Array<{ nodeId: string; nodeLabel: string; output: unknown }> = [];
    for (const edge of incoming) {
      if (this.resolveScopedEdgeState(workflow, slotNode, edge, nodeRuns, scopeStartIndex) !== "satisfied") continue;
      if (edge.source === slotNode.id && edge.sourceHandle === managerSlotInnerOutHandle) {
        outputs.push({ nodeId: slotNode.id, nodeLabel: slotNode.config.label, output: boundaryOutput });
        continue;
      }

      const sourceRun = this.findLatestNodeRun(nodeRuns, edge.source, "succeeded", scopeStartIndex);
      if (!sourceRun) continue;
      outputs.push({
        nodeId: sourceRun.nodeId,
        nodeLabel: sourceRun.nodeLabel,
        output: sourceRun.output
      });
    }
    return outputs;
  }

  private resolveManagerSlotOutput(
    workflow: WorkflowDefinition,
    slotNode: WorkflowNode,
    childNodes: WorkflowNode[],
    nodeRuns: WorkflowNodeRun[],
    scopeStartIndex: number
  ): unknown {
    const explicitOutputs = workflow.edges
      .filter((edge) => edge.target === slotNode.id && edge.targetHandle === managerSlotInnerInHandle)
      .flatMap((edge) => {
        const source = childNodes.find((node) => node.id === edge.source);
        if (!source) return [];
        if (this.resolveScopedEdgeState(workflow, slotNode, edge, nodeRuns, scopeStartIndex) !== "satisfied") return [];
        const sourceRun = this.findLatestNodeRun(nodeRuns, source.id, "succeeded", scopeStartIndex);
        return sourceRun
          ? [
              {
                nodeId: sourceRun.nodeId,
                nodeLabel: sourceRun.nodeLabel,
                output: sourceRun.output
              }
            ]
          : [];
      });
    if (explicitOutputs.length === 1) return explicitOutputs[0]!.output;
    if (explicitOutputs.length > 1) return { outputs: explicitOutputs };

    const leafNodes = childNodes.filter((node) => {
      return !workflow.edges.some((edge) => edge.source === node.id && childNodes.some((candidate) => candidate.id === edge.target));
    });
    const leafRuns = leafNodes.flatMap((node) => {
      const nodeRun = this.findLatestNodeRun(nodeRuns, node.id, "succeeded", scopeStartIndex);
      return nodeRun ? [nodeRun] : [];
    });
    if (leafRuns.length === 1) return leafRuns[0]!.output;
    if (leafRuns.length > 1) {
      return {
        outputs: leafRuns.map((nodeRun) => ({
          nodeId: nodeRun.nodeId,
          nodeLabel: nodeRun.nodeLabel,
          output: nodeRun.output
        }))
      };
    }
    return undefined;
  }

  private syntheticAgentResult(
    nodeRunId: string,
    status: AgentTaskResult["status"],
    output?: string,
    error?: string
  ): AgentTaskResult {
    return {
      taskId: nodeRunId,
      runId: nodeRunId,
      sessionKey: `manager-slot:${nodeRunId}`,
      status,
      output,
      error,
      updatedAt: new Date().toISOString()
    };
  }

  private async executeLoopNode(
    workflow: WorkflowDefinition,
    run: WorkflowRun,
    node: WorkflowNode,
    nodeRun: WorkflowNodeRun
  ): Promise<void> {
    const config = node.config as LoopNodeConfig;
    const maxIterations = normalizeInteger(config.maxIterations, 1, 25, 3);
    const previousLoopRuns = await this.store.listNodeRuns(run.id);
    const previousIteration = previousLoopRuns
      .filter((candidate) => candidate.nodeId === node.id && candidate.status === "succeeded")
      .reduce((max, candidate) => Math.max(max, readInteger(readOutputRecord(candidate.output)?.iteration) ?? 0), 0);
    const iteration = previousIteration + 1;
    const rerunTargets = this.getLoopRerunTargets(workflow, node).map((target) => ({
      nodeId: target.id,
      nodeLabel: target.config.label
    }));
    const shouldRerun = iteration < maxIterations && rerunTargets.length > 0;

    await this.completeNode(nodeRun, {
      status: shouldRerun ? "rerun" : "completed",
      iteration,
      maxIterations,
      rerunTargets,
      upstream: await this.collectUpstreamOutputs(workflow, run.id, node)
    });
  }

  private async executeSummaryNode(
    workflow: WorkflowDefinition,
    run: WorkflowRun,
    node: WorkflowNode,
    nodeRun: WorkflowNodeRun
  ): Promise<void> {
    await this.executeSummaryNodeWithUpstream(
      run,
      node,
      nodeRun,
      await this.collectUpstreamOutputs(workflow, run.id, node)
    );
  }

  private async executeSummaryNodeWithUpstream(
    run: WorkflowRun,
    node: WorkflowNode,
    nodeRun: WorkflowNodeRun,
    upstream: Array<{ nodeId: string; nodeLabel: string; output: unknown }>
  ): Promise<void> {
    const config = node.config as SummaryNodeConfig;
    if (config.mode === "openclaw_agent") {
      const { result, openclawRef } = await this.runAgentTask({
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
        await this.failNode({ ...nodeRun, openclawRef, usage: result.usage }, result.error ?? `OpenClaw agent run ${result.status}.`);
        return;
      }
      await this.completeNode({ ...nodeRun, openclawRef, usage: result.usage }, result.output ?? "", openclawRef);
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
    await this.executeSendNodeWithUpstream(
      run,
      node,
      nodeRun,
      workflow.name,
      await this.collectUpstreamOutputs(workflow, run.id, node)
    );
  }

  private async executeSendNodeWithUpstream(
    run: WorkflowRun,
    node: WorkflowNode,
    nodeRun: WorkflowNodeRun,
    workflowName: string,
    upstream: Array<{ nodeId: string; nodeLabel: string; output: unknown }>
  ): Promise<void> {
    const config = node.config as SendNodeConfig;
    const summaryPayload = upstream.length <= 1 ? (upstream[0]?.output ?? {}) : upstream;
    const body = config.bodyTemplate
      .replaceAll("{{workflow.name}}", workflowName)
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

  private firstConnectedManagerSlot(workflow: WorkflowDefinition, managerNode: WorkflowNode, portCount: number): number | undefined {
    for (let slot = 1; slot <= portCount; slot += 1) {
      if (this.findManagerSlotAssignment(workflow, managerNode, slot)) return slot;
    }
    return undefined;
  }

  private findManagerSlotAssignment(
    workflow: WorkflowDefinition,
    managerNode: WorkflowNode,
    slot: number
  ): { target: WorkflowNode; returnEdgePresent: boolean } | undefined {
    const outHandle = `${managerOutHandlePrefix}${slot}`;
    const outEdge = workflow.edges.find((edge) => edge.source === managerNode.id && edge.sourceHandle === outHandle);
    if (!outEdge) return undefined;

    const target = workflow.nodes.find((candidate) => candidate.id === outEdge.target);
    if (!target) return undefined;

    const inHandle = `${managerInHandlePrefix}${slot}`;
    const returnEdgePresent = workflow.edges.some(
      (edge) => edge.source === target.id && edge.target === managerNode.id && edge.targetHandle === inHandle
    );
    return { target, returnEdgePresent };
  }

  private getLoopRerunTargets(workflow: WorkflowDefinition, loopNode: WorkflowNode): WorkflowNode[] {
    const nodesById = new Map(workflow.nodes.map((candidate) => [candidate.id, candidate]));
    const visited = new Set<string>();
    const queue = workflow.edges.filter((edge) => edge.source === loopNode.id).map((edge) => edge.target);

    while (queue.length > 0) {
      const nodeId = queue.shift()!;
      if (nodeId === loopNode.id || visited.has(nodeId)) continue;
      const node = nodesById.get(nodeId);
      if (!node) continue;

      visited.add(nodeId);
      for (const edge of workflow.edges) {
        if (edge.source !== nodeId || edge.target === loopNode.id) continue;
        queue.push(edge.target);
      }
    }

    return [...visited].flatMap((nodeId) => {
      const node = nodesById.get(nodeId);
      return node ? [node] : [];
    });
  }

  private getRequiredAfterIndex(
    workflow: WorkflowDefinition,
    node: WorkflowNode,
    nodeRuns: WorkflowNodeRun[]
  ): number | undefined {
    if (node.type === "loop") {
      return this.findLatestTerminalNodeRunWithIndex(nodeRuns, node.id)?.index;
    }

    let latestMarker: { index: number } | undefined;
    for (const candidate of workflow.nodes) {
      if (candidate.type !== "loop") continue;
      if (!this.getLoopRerunTargets(workflow, candidate).some((target) => target.id === node.id)) continue;

      for (let index = nodeRuns.length - 1; index >= 0; index -= 1) {
        const nodeRun = nodeRuns[index]!;
        if (nodeRun.nodeId !== candidate.id || nodeRun.status !== "succeeded") continue;
        const status = readString(readOutputRecord(nodeRun.output)?.status);
        if (status !== "rerun") continue;
        if (!latestMarker || index > latestMarker.index) {
          latestMarker = { index };
        }
        break;
      }
    }

    return latestMarker?.index;
  }

  private hasSatisfiedIncomingAfter(
    workflow: WorkflowDefinition,
    node: WorkflowNode,
    nodeRuns: WorkflowNodeRun[],
    requiredAfterIndex: number
  ): boolean {
    const incoming = this.getSchedulingIncomingEdges(workflow, node);
    if (incoming.length === 0) return false;
    return incoming.every((edge) => this.resolveIncomingEdgeState(workflow, edge, nodeRuns, requiredAfterIndex) === "satisfied");
  }

  private isAfterRequiredIndex(index: number, requiredAfterIndex?: number): boolean {
    return requiredAfterIndex === undefined || index > requiredAfterIndex;
  }

  private resolveManagerDecision(
    output: unknown,
    currentSlot: number,
    portCount: number,
    options: { ignoreCompletionStatus?: boolean } = {}
  ): ManagerDecision {
    const record = readOutputRecord(output);
    const explicitSlot =
      readInteger(record?.nextSlot) ??
      readInteger(record?.routeToSlot) ??
      readInteger(record?.returnToSlot) ??
      readInteger(record?.targetSlot);
    const status = readString(record?.status)?.toLowerCase();
    const reason = readString(record?.reason) ?? readString(record?.message);

    if (
      !options.ignoreCompletionStatus &&
      status &&
      ["complete", "completed", "done", "stop", "passed", "pass", "approved"].includes(status) &&
      currentSlot >= portCount
    ) {
      return { status: "complete", reason };
    }
    if (!options.ignoreCompletionStatus && status && ["complete", "completed", "done", "stop"].includes(status)) {
      return { status: "complete", reason };
    }
    if (explicitSlot !== undefined) {
      if (explicitSlot < 1 || explicitSlot > portCount) {
        return { status: "complete", reason: reason ?? `next slot ${explicitSlot} is outside manager ports` };
      }
      return {
        status: explicitSlot <= currentSlot ? "retry" : "continue",
        nextSlot: explicitSlot,
        reason
      };
    }

    const failed =
      status !== undefined &&
      ["fail", "failed", "needs_revision", "needs-revision", "retry", "rework", "blocked", "reject", "rejected"].includes(status);
    if (failed) {
      return {
        status: "retry",
        nextSlot: Math.max(1, currentSlot - 1),
        reason
      };
    }

    if (currentSlot >= portCount) {
      return { status: "complete", reason };
    }
    return { status: "continue", nextSlot: currentSlot + 1, reason };
  }

  private async collectUpstreamOutputs(
    workflow: WorkflowDefinition,
    workflowRunId: string,
    node: WorkflowNode
  ): Promise<Array<{ nodeId: string; nodeLabel: string; output: unknown }>> {
    const incoming = this.getUpstreamIncomingEdges(workflow, node);
    if (incoming.length === 0) return [];

    const nodeRuns = await this.store.listNodeRuns(workflowRunId);
    const outputs: Array<{ nodeId: string; nodeLabel: string; output: unknown }> = [];
    const seen = new Set<string>();
    const requiredAfterIndex = this.getRequiredAfterIndex(workflow, node, nodeRuns);

    for (const edge of incoming) {
      const source = workflow.nodes.find((candidate) => candidate.id === edge.source);
      const edgeRequiredAfterIndex = source?.type === "loop" ? undefined : requiredAfterIndex;
      if (this.resolveIncomingEdgeState(workflow, edge, nodeRuns, edgeRequiredAfterIndex) !== "satisfied") {
        continue;
      }

      const sourceRun = this.findLatestNodeRun(nodeRuns, edge.source, "succeeded", edgeRequiredAfterIndex);
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

  private hasCurrentNodeRun(workflow: WorkflowDefinition, node: WorkflowNode, nodeRuns: WorkflowNodeRun[]): boolean {
    if (node.type === "loop") {
      const latestLoopRun = this.findLatestNodeRunWithIndex(nodeRuns, node.id);
      if (!latestLoopRun) return false;
      return !this.hasSatisfiedIncomingAfter(workflow, node, nodeRuns, latestLoopRun.index);
    }

    const requiredAfterIndex = this.getRequiredAfterIndex(workflow, node, nodeRuns);
    return nodeRuns.some((nodeRun, index) => nodeRun.nodeId === node.id && this.isAfterRequiredIndex(index, requiredAfterIndex));
  }

  private hasCurrentTerminalNodeRun(workflow: WorkflowDefinition, node: WorkflowNode, nodeRuns: WorkflowNodeRun[]): boolean {
    if (node.type === "loop") {
      const latestLoopRun = this.findLatestNodeRunWithIndex(nodeRuns, node.id);
      if (!latestLoopRun) return false;
      return this.isTerminalStatus(latestLoopRun.nodeRun.status) && !this.hasSatisfiedIncomingAfter(workflow, node, nodeRuns, latestLoopRun.index);
    }

    const requiredAfterIndex = this.getRequiredAfterIndex(workflow, node, nodeRuns);
    return nodeRuns.some(
      (nodeRun, index) =>
        nodeRun.nodeId === node.id &&
        this.isAfterRequiredIndex(index, requiredAfterIndex) &&
        ["succeeded", "failed", "cancelled", "skipped"].includes(nodeRun.status)
    );
  }

  private isWorkflowStep(node: WorkflowNode): boolean {
    return executableTypes.has(node.type);
  }

  private isRunnableNode(node: WorkflowNode): boolean {
    return this.isWorkflowStep(node) && !node.disabled;
  }

  private isGlobalSchedulingNode(workflow: WorkflowDefinition, node: WorkflowNode): boolean {
    return this.isWorkflowStep(node) && node.type !== "manager_slot" && !this.isNestedNode(node) && !this.isManagedParticipant(workflow, node);
  }

  private isNestedNode(node: WorkflowNode): boolean {
    return Boolean(node.parentId);
  }

  private isManagedParticipant(workflow: WorkflowDefinition, node: WorkflowNode): boolean {
    return workflow.edges.some((edge) => {
      if (edge.target !== node.id || !edge.sourceHandle?.startsWith(managerOutHandlePrefix)) return false;
      const source = workflow.nodes.find((candidate) => candidate.id === edge.source);
      return source?.type === "manager";
    });
  }

  private getSchedulingIncomingEdges(workflow: WorkflowDefinition, node: WorkflowNode): WorkflowEdge[] {
    return workflow.edges.filter((edge) => {
      if (edge.target !== node.id) return false;
      if (node.type === "manager" && edge.targetHandle?.startsWith(managerInHandlePrefix)) return false;

      const source = workflow.nodes.find((candidate) => candidate.id === edge.source);
      if (source?.type === "loop") return false;
      return true;
    });
  }

  private getUpstreamIncomingEdges(workflow: WorkflowDefinition, node: WorkflowNode): WorkflowEdge[] {
    return workflow.edges.filter((edge) => {
      if (edge.target !== node.id) return false;
      return !(node.type === "manager" && edge.targetHandle?.startsWith(managerInHandlePrefix));
    });
  }

  private findLatestNodeRun(
    nodeRuns: WorkflowNodeRun[],
    nodeId: string,
    status?: WorkflowNodeRun["status"],
    requiredAfterIndex?: number
  ): WorkflowNodeRun | undefined {
    for (let index = nodeRuns.length - 1; index >= 0; index -= 1) {
      const nodeRun = nodeRuns[index]!;
      if (nodeRun.nodeId !== nodeId) continue;
      if (!this.isAfterRequiredIndex(index, requiredAfterIndex)) continue;
      if (status && nodeRun.status !== status) continue;
      return nodeRun;
    }
    return undefined;
  }

  private findLatestNodeRunWithIndex(
    nodeRuns: WorkflowNodeRun[],
    nodeId: string,
    status?: WorkflowNodeRun["status"]
  ): { nodeRun: WorkflowNodeRun; index: number } | undefined {
    for (let index = nodeRuns.length - 1; index >= 0; index -= 1) {
      const nodeRun = nodeRuns[index]!;
      if (nodeRun.nodeId !== nodeId) continue;
      if (status && nodeRun.status !== status) continue;
      return { nodeRun, index };
    }
    return undefined;
  }

  private findLatestTerminalNodeRunWithIndex(
    nodeRuns: WorkflowNodeRun[],
    nodeId: string
  ): { nodeRun: WorkflowNodeRun; index: number } | undefined {
    for (let index = nodeRuns.length - 1; index >= 0; index -= 1) {
      const nodeRun = nodeRuns[index]!;
      if (nodeRun.nodeId !== nodeId) continue;
      if (!this.isTerminalStatus(nodeRun.status)) continue;
      return { nodeRun, index };
    }
    return undefined;
  }

  private resolveIncomingEdgeState(
    workflow: WorkflowDefinition,
    edge: WorkflowEdge,
    nodeRuns: WorkflowNodeRun[],
    requiredAfterIndex?: number
  ): IncomingEdgeState {
    const source = workflow.nodes.find((candidate) => candidate.id === edge.source);
    if (!source) return "blocked";
    if (!this.isWorkflowStep(source)) return "satisfied";

    const sourceRun = this.findLatestNodeRun(nodeRuns, source.id, undefined, requiredAfterIndex);
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
        agentId: input.agentId,
        modelId: input.modelId
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

function normalizeInteger(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function readOutputRecord(output: unknown): Record<string, unknown> | undefined {
  if (isRecord(output)) return output;
  if (typeof output !== "string") return undefined;

  const trimmed = output.trim();
  if (!trimmed) return undefined;

  const candidates = [trimmed];
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (isRecord(parsed)) return parsed;
    } catch {
      // Keep trying the next candidate.
    }
  }
  return undefined;
}

function isManagerCompletionEnvelope(output: unknown): boolean {
  const record = readOutputRecord(output);
  if (!record) return false;
  const status = readString(record.status)?.toLowerCase();
  return status === "completed" && Array.isArray(record.trace);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readInteger(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
  if (typeof value !== "string") return undefined;

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringifyManagerSlotOutput(output: unknown): string {
  return typeof output === "string" ? output : JSON.stringify(output);
}
