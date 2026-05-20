import { nanoid } from "nanoid";
import type { OpenClawAdapter } from "@hiveward/adapter";
import {
  isAgentBlueprintNodeType,
  resolveAgentNodeSource,
  type AgentNodeConfig,
  type AgentBlueprintNodeType,
  type ApprovalNodeConfig,
  type AgentTaskResult,
  type ConditionNodeConfig,
  type LoopNodeConfig,
  type ManagerNodeConfig,
  type OpenClawObjectRef,
  type ParallelAgentsNodeConfig,
  type SendNodeConfig,
  type StartAgentTaskInput,
  type SummaryNodeConfig,
  type BlueprintDefinition,
  type BlueprintEdge,
  type BlueprintNode,
  type BlueprintNodeEvent,
  type BlueprintNodeRun,
  type BlueprintRun
} from "@hiveward/shared";
import type { FileHivewardStore } from "../store/fileHivewardStore";

const executableTypes = new Set([
  "openclaw_agent",
  "codex_agent",
  "claude_code_agent",
  "parallel_agents",
  "manager",
  "manager_slot",
  "loop",
  "condition",
  "summary",
  "approval",
  "send"
]);
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

export class BlueprintWorker {
  private readonly activeRuns = new Map<string, Promise<void>>();

  constructor(
    private readonly store: FileHivewardStore,
    private readonly adapter: OpenClawAdapter
  ) {}

  async startRun(blueprint: BlueprintDefinition, startedBy: string): Promise<BlueprintRun> {
    const run = await this.store.createBlueprintRun(blueprint, startedBy);
    const runningRun = {
      ...run,
      status: "running" as const
    };
    await this.store.updateBlueprintRun(runningRun);
    await this.event(runningRun.id, "blueprint.run.started", `Blueprint ${blueprint.name} started.`);
    this.scheduleRun(blueprint, runningRun);
    return runningRun;
  }

  async approveRun(blueprint: BlueprintDefinition, run: BlueprintRun): Promise<BlueprintRun> {
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
    await this.store.updateBlueprintRun(running);
    this.scheduleRun(blueprint, running);
    return running;
  }

  private scheduleRun(blueprint: BlueprintDefinition, run: BlueprintRun): void {
    if (this.activeRuns.has(run.id)) {
      return;
    }

    const execution = this.runUntilBlockedOrDone(blueprint, run)
      .catch(async (error) => {
        const currentRun = await this.store.getBlueprintRun(run.id);
        if (!currentRun) return;

        const failed = await this.applyRunTotals(currentRun, new Date(currentRun.startedAt).getTime(), "failed");
        const message = error instanceof Error ? error.message : "Blueprint worker crashed unexpectedly.";
        await this.event(run.id, "blueprint.run.failed", `Blueprint ${blueprint.name} crashed: ${message}`);
        await this.store.updateBlueprintRun(failed);
      })
      .finally(() => {
        this.activeRuns.delete(run.id);
      });

    this.activeRuns.set(run.id, execution);
  }

  private async runUntilBlockedOrDone(blueprint: BlueprintDefinition, run: BlueprintRun): Promise<void> {
    const startedAt = new Date(run.startedAt).getTime();

    while (true) {
      const nodeRuns = await this.store.listNodeRuns(run.id);
      const skippedNodes = this.findSkippableNodes(blueprint, nodeRuns);
      if (skippedNodes.length > 0) {
        await Promise.all(skippedNodes.map((node) => this.skipNode(blueprint, run, node)));
        continue;
      }

      const failedNodeRun = nodeRuns.find((nodeRun) => nodeRun.status === "failed" || nodeRun.status === "cancelled");
      if (failedNodeRun) {
        const failed = await this.applyRunTotals(run, startedAt, "failed");
        await this.event(run.id, "blueprint.run.failed", `Blueprint ${blueprint.name} failed at node ${failedNodeRun.nodeLabel}.`);
        await this.store.updateBlueprintRun(failed);
        return;
      }
      if (nodeRuns.some((nodeRun) => nodeRun.status === "waiting_approval")) {
        await this.store.updateBlueprintRun({ ...run, status: "waiting_approval" });
        return;
      }

      const readyNodes = this.findReadyNodes(blueprint, nodeRuns);
      if (readyNodes.length === 0) {
        const pending = blueprint.nodes.filter(
          (node) =>
            this.isGlobalSchedulingNode(blueprint, node) &&
            !this.hasCurrentTerminalNodeRun(blueprint, node, nodeRuns)
        );
        if (pending.length === 0) {
          const completed = await this.applyRunTotals(run, startedAt, "succeeded");
          await this.event(run.id, "blueprint.run.completed", `Blueprint ${blueprint.name} completed.`);
          await this.store.updateBlueprintRun(completed);
          return;
        }

        const failed = await this.applyRunTotals(run, startedAt, "failed");
        await this.event(run.id, "blueprint.run.failed", `Blueprint ${blueprint.name} could not continue. Pending nodes: ${pending.map((node) => node.id).join(", ")}.`);
        await this.store.updateBlueprintRun(failed);
        return;
      }

      await Promise.all(readyNodes.map((node) => this.executeNode(blueprint, run, node)));
    }
  }

  private findReadyNodes(blueprint: BlueprintDefinition, nodeRuns: BlueprintNodeRun[]): BlueprintNode[] {
    return blueprint.nodes.filter((node) => {
      if (!this.isRunnableNode(node)) return false;
      if (!this.isGlobalSchedulingNode(blueprint, node)) return false;
      if (this.hasCurrentNodeRun(blueprint, node, nodeRuns)) return false;

      const incoming = this.getSchedulingIncomingEdges(blueprint, node);
      if (incoming.length === 0) return true;

      const requiredAfterIndex = this.getRequiredAfterIndex(blueprint, node, nodeRuns);
      return incoming.every((edge) => this.resolveIncomingEdgeState(blueprint, edge, nodeRuns, requiredAfterIndex) === "satisfied");
    });
  }

  private findSkippableNodes(blueprint: BlueprintDefinition, nodeRuns: BlueprintNodeRun[]): BlueprintNode[] {
    return blueprint.nodes.filter((node) => {
      if (!this.isGlobalSchedulingNode(blueprint, node)) return false;
      if (this.hasCurrentNodeRun(blueprint, node, nodeRuns)) return false;

      const incoming = this.getSchedulingIncomingEdges(blueprint, node);
      if (node.disabled) {
        if (incoming.length === 0) return true;
        const requiredAfterIndex = this.getRequiredAfterIndex(blueprint, node, nodeRuns);
        return incoming.every((edge) => this.resolveIncomingEdgeState(blueprint, edge, nodeRuns, requiredAfterIndex) !== "pending");
      }
      if (incoming.length === 0) return false;

      const requiredAfterIndex = this.getRequiredAfterIndex(blueprint, node, nodeRuns);
      const edgeStates = incoming.map((edge) => this.resolveIncomingEdgeState(blueprint, edge, nodeRuns, requiredAfterIndex));
      return edgeStates.every((state) => state !== "pending") && edgeStates.some((state) => state === "blocked");
    });
  }

  private async executeNode(blueprint: BlueprintDefinition, run: BlueprintRun, node: BlueprintNode): Promise<void> {
    const nodeRun = await this.createRunningNodeRun(blueprint, run, node);

    try {
      if (isAgentBlueprintNodeType(node.type)) {
        await this.executeAgentNode(blueprint, run, asAgentBlueprintNode(node), nodeRun);
      } else if (node.type === "parallel_agents") {
        await this.executeParallelAgentsNode(blueprint, run, node, nodeRun);
      } else if (node.type === "manager") {
        await this.executeManagerNode(blueprint, run, node, nodeRun);
      } else if (node.type === "manager_slot") {
        await this.failNode(nodeRun, "Manager slot nodes can only run when called by their manager.");
      } else if (node.type === "loop") {
        await this.executeLoopNode(blueprint, run, node, nodeRun);
      } else if (node.type === "condition") {
        await this.completeNode(nodeRun, { result: this.evaluateCondition(blueprint, node.config as ConditionNodeConfig) });
      } else if (node.type === "summary") {
        await this.executeSummaryNode(blueprint, run, node, nodeRun);
      } else if (node.type === "approval") {
        await this.waitForApproval(node, nodeRun);
      } else if (node.type === "send") {
        await this.executeSendNode(blueprint, run, node, nodeRun);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown node failure";
      await this.failNode(nodeRun, message);
    }
  }

  private async createRunningNodeRun(blueprint: BlueprintDefinition, run: BlueprintRun, node: BlueprintNode): Promise<BlueprintNodeRun> {
    const now = new Date().toISOString();
    const nodeRun: BlueprintNodeRun = {
      id: `node-run-${nanoid(10)}`,
      blueprintRunId: run.id,
      blueprintId: blueprint.id,
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
    blueprint: BlueprintDefinition,
    run: BlueprintRun,
    node: BlueprintNode & { type: AgentBlueprintNodeType },
    nodeRun: BlueprintNodeRun
  ): Promise<void> {
    await this.executeAgentNodeWithInput(blueprint, run, node, nodeRun, {
      upstream: await this.collectUpstreamOutputs(blueprint, run.id, node)
    });
  }

  private async executeAgentNodeWithInput(
    _blueprint: BlueprintDefinition,
    run: BlueprintRun,
    node: BlueprintNode & { type: AgentBlueprintNodeType },
    nodeRun: BlueprintNodeRun,
    input: unknown
  ): Promise<AgentTaskResult> {
    const config = node.config as AgentNodeConfig;
    const nodeRunWithInput: BlueprintNodeRun = {
      ...nodeRun,
      input
    };
    const { result, openclawRef } = await this.runAgentTask({
      blueprintRunId: run.id,
      nodeRunId: nodeRun.id,
      source: resolveAgentNodeSource(node.type),
      agentId: config.agentId ?? "main",
      agentName: config.agentName,
      prompt: config.prompt,
      modelId: config.modelId,
      permissionProfile: config.permissionProfile,
      workingDirectory: config.workingDirectory,
      timeoutMs: config.timeoutMs,
      outputSchema: config.outputSchema,
      input,
      tools: config.tools
    });
    if (result.status !== "succeeded") {
      await this.failNode({ ...nodeRunWithInput, openclawRef, usage: result.usage }, result.error ?? `Agent task ${result.status}.`);
      return result;
    }

    await this.completeNode(
      { ...nodeRunWithInput, openclawRef, usage: result.usage },
      result.output ?? "",
      openclawRef
    );
    return result;
  }

  private async executeParallelAgentsNode(
    blueprint: BlueprintDefinition,
    run: BlueprintRun,
    node: BlueprintNode,
    nodeRun: BlueprintNodeRun
  ): Promise<void> {
    await this.executeParallelAgentsNodeWithUpstream(
      run,
      node,
      nodeRun,
      await this.collectUpstreamOutputs(blueprint, run.id, node)
    );
  }

  private async executeParallelAgentsNodeWithUpstream(
    run: BlueprintRun,
    node: BlueprintNode,
    nodeRun: BlueprintNodeRun,
    upstream: Array<{ nodeId: string; nodeLabel: string; output: unknown }>
  ): Promise<void> {
    const config = node.config as ParallelAgentsNodeConfig;
    if (config.agents.length === 0) {
      throw new Error("Parallel agents node has no agents configured.");
    }

    const outputs = await Promise.all(
      config.agents.map((agent) =>
        this.runAgentTask({
          blueprintRunId: run.id,
          nodeRunId: nodeRun.id,
          source: "openclaw",
          agentId: agent.agentId ?? "main",
          agentName: agent.agentName,
          prompt: agent.prompt,
          modelId: agent.modelId,
          permissionProfile: agent.permissionProfile,
          workingDirectory: agent.workingDirectory,
          timeoutMs: agent.timeoutMs,
          outputSchema: agent.outputSchema,
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
      await this.failNode(nodeRun, failed.result.error ?? `Agent task ${failed.result.status}.`);
      return;
    }
    await this.completeNode(
      nodeRun,
      outputs.map((output, index) => this.formatParallelAgentOutput(config.agents[index]!, output.result))
    );
  }

  private async executeManagerNode(
    blueprint: BlueprintDefinition,
    run: BlueprintRun,
    node: BlueprintNode,
    nodeRun: BlueprintNodeRun,
    upstream?: Array<{ nodeId: string; nodeLabel: string; output: unknown }>
  ): Promise<AgentTaskResult> {
    const config = node.config as ManagerNodeConfig;
    const portCount = normalizeInteger(config.portCount, 1, 8, 3);
    const maxHandoffs = normalizeInteger(config.maxHandoffs, 1, 50, 12);
    const managerUpstream = upstream ?? await this.collectUpstreamOutputs(blueprint, run.id, node);
    const trace: ManagerTraceItem[] = [];
    let slot = this.firstConnectedManagerSlot(blueprint, node, portCount);

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
      const assignment = this.findManagerSlotAssignment(blueprint, node, slot);
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

      if (isAgentBlueprintNodeType(assignment.target.type)) {
        const participantRun = await this.createRunningNodeRun(blueprint, run, assignment.target);
        result = await this.executeAgentNodeWithInput(blueprint, run, asAgentBlueprintNode(assignment.target), participantRun, managerContext);
      } else if (assignment.target.type === "manager_slot") {
        const slotRun = await this.createRunningNodeRun(blueprint, run, assignment.target);
        result = await this.executeManagerSlotNode(blueprint, run, assignment.target, slotRun, managerContext);
      } else if (assignment.target.type === "manager") {
        const managerRun = await this.createRunningNodeRun(blueprint, run, assignment.target);
        result = await this.executeManagerNode(blueprint, run, assignment.target, managerRun, [
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
    blueprint: BlueprintDefinition,
    run: BlueprintRun,
    slotNode: BlueprintNode,
    slotRun: BlueprintNodeRun,
    context: ManagerSlotContext
  ): Promise<AgentTaskResult> {
    const childNodes = blueprint.nodes.filter((node) => node.parentId === slotNode.id && this.isRunnableNode(node));
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

      const skippable = childNodes.filter((node) => this.isScopedSkippableNode(blueprint, slotNode, node, nodeRuns, scopeStartIndex));
      if (skippable.length > 0) {
        await Promise.all(skippable.map((node) => this.skipNode(blueprint, run, node)));
        continue;
      }

      const ready = childNodes.filter((node) => this.isScopedReadyNode(blueprint, slotNode, node, nodeRuns, scopeStartIndex));
      if (ready.length > 0) {
        await Promise.all(
          ready.map((node) =>
            this.executeScopedNode(
              blueprint,
              run,
              node,
              this.collectScopedUpstreamOutputs(blueprint, slotNode, node, nodeRuns, scopeStartIndex, boundaryOutput)
            )
          )
        );
        continue;
      }

      const output = this.resolveManagerSlotOutput(blueprint, slotNode, childNodes, nodeRuns, scopeStartIndex);
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
    blueprint: BlueprintDefinition,
    run: BlueprintRun,
    node: BlueprintNode,
    upstream: Array<{ nodeId: string; nodeLabel: string; output: unknown }>
  ): Promise<void> {
    const nodeRun = await this.createRunningNodeRun(blueprint, run, node);
    if (isAgentBlueprintNodeType(node.type)) {
      await this.executeAgentNodeWithInput(blueprint, run, asAgentBlueprintNode(node), nodeRun, { upstream });
    } else if (node.type === "parallel_agents") {
      await this.executeParallelAgentsNodeWithUpstream(run, node, nodeRun, upstream);
    } else if (node.type === "condition") {
      await this.completeNode(nodeRun, { result: this.evaluateCondition(blueprint, node.config as ConditionNodeConfig) });
    } else if (node.type === "summary") {
      await this.executeSummaryNodeWithUpstream(run, node, nodeRun, upstream);
    } else if (node.type === "send") {
      await this.executeSendNodeWithUpstream(run, node, nodeRun, blueprint.name, upstream);
    } else {
      await this.failNode(nodeRun, `Node type ${node.type} is not supported inside a manager slot yet.`);
    }
  }

  private isScopedReadyNode(
    blueprint: BlueprintDefinition,
    slotNode: BlueprintNode,
    node: BlueprintNode,
    nodeRuns: BlueprintNodeRun[],
    scopeStartIndex: number
  ): boolean {
    if (this.findLatestNodeRun(nodeRuns, node.id, undefined, scopeStartIndex)) return false;
    const incoming = this.getScopedIncomingEdges(blueprint, slotNode, node);
    if (incoming.length === 0) return true;
    return incoming.every((edge) => this.resolveScopedEdgeState(blueprint, slotNode, edge, nodeRuns, scopeStartIndex) === "satisfied");
  }

  private isScopedSkippableNode(
    blueprint: BlueprintDefinition,
    slotNode: BlueprintNode,
    node: BlueprintNode,
    nodeRuns: BlueprintNodeRun[],
    scopeStartIndex: number
  ): boolean {
    if (this.findLatestNodeRun(nodeRuns, node.id, undefined, scopeStartIndex)) return false;
    const incoming = this.getScopedIncomingEdges(blueprint, slotNode, node);
    if (incoming.length === 0) return false;
    const states = incoming.map((edge) => this.resolveScopedEdgeState(blueprint, slotNode, edge, nodeRuns, scopeStartIndex));
    return states.every((state) => state !== "pending") && states.some((state) => state === "blocked");
  }

  private getScopedIncomingEdges(blueprint: BlueprintDefinition, slotNode: BlueprintNode, node: BlueprintNode): BlueprintEdge[] {
    return blueprint.edges.filter((edge) => {
      if (edge.target !== node.id) return false;
      if (edge.source === slotNode.id) return edge.sourceHandle === managerSlotInnerOutHandle;
      const source = blueprint.nodes.find((candidate) => candidate.id === edge.source);
      return source?.parentId === slotNode.id;
    });
  }

  private resolveScopedEdgeState(
    blueprint: BlueprintDefinition,
    slotNode: BlueprintNode,
    edge: BlueprintEdge,
    nodeRuns: BlueprintNodeRun[],
    scopeStartIndex: number
  ): IncomingEdgeState {
    if (edge.source === slotNode.id && edge.sourceHandle === managerSlotInnerOutHandle) return "satisfied";
    const source = blueprint.nodes.find((candidate) => candidate.id === edge.source);
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
    blueprint: BlueprintDefinition,
    slotNode: BlueprintNode,
    node: BlueprintNode,
    nodeRuns: BlueprintNodeRun[],
    scopeStartIndex: number,
    boundaryOutput: unknown
  ): Array<{ nodeId: string; nodeLabel: string; output: unknown }> {
    const incoming = this.getScopedIncomingEdges(blueprint, slotNode, node);
    if (incoming.length === 0) {
      return [{ nodeId: slotNode.id, nodeLabel: slotNode.config.label, output: boundaryOutput }];
    }

    const outputs: Array<{ nodeId: string; nodeLabel: string; output: unknown }> = [];
    for (const edge of incoming) {
      if (this.resolveScopedEdgeState(blueprint, slotNode, edge, nodeRuns, scopeStartIndex) !== "satisfied") continue;
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
    blueprint: BlueprintDefinition,
    slotNode: BlueprintNode,
    childNodes: BlueprintNode[],
    nodeRuns: BlueprintNodeRun[],
    scopeStartIndex: number
  ): unknown {
    const explicitOutputs = blueprint.edges
      .filter((edge) => edge.target === slotNode.id && edge.targetHandle === managerSlotInnerInHandle)
      .flatMap((edge) => {
        const source = childNodes.find((node) => node.id === edge.source);
        if (!source) return [];
        if (this.resolveScopedEdgeState(blueprint, slotNode, edge, nodeRuns, scopeStartIndex) !== "satisfied") return [];
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
      return !blueprint.edges.some((edge) => edge.source === node.id && childNodes.some((candidate) => candidate.id === edge.target));
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
      source: "openclaw",
      status,
      output,
      error,
      updatedAt: new Date().toISOString()
    };
  }

  private async executeLoopNode(
    blueprint: BlueprintDefinition,
    run: BlueprintRun,
    node: BlueprintNode,
    nodeRun: BlueprintNodeRun
  ): Promise<void> {
    const config = node.config as LoopNodeConfig;
    const maxIterations = normalizeInteger(config.maxIterations, 1, 25, 3);
    const previousLoopRuns = await this.store.listNodeRuns(run.id);
    const previousIteration = previousLoopRuns
      .filter((candidate) => candidate.nodeId === node.id && candidate.status === "succeeded")
      .reduce((max, candidate) => Math.max(max, readInteger(readOutputRecord(candidate.output)?.iteration) ?? 0), 0);
    const iteration = previousIteration + 1;
    const rerunTargets = this.getLoopRerunTargets(blueprint, node).map((target) => ({
      nodeId: target.id,
      nodeLabel: target.config.label
    }));
    const shouldRerun = iteration < maxIterations && rerunTargets.length > 0;

    await this.completeNode(nodeRun, {
      status: shouldRerun ? "rerun" : "completed",
      iteration,
      maxIterations,
      rerunTargets,
      upstream: await this.collectUpstreamOutputs(blueprint, run.id, node)
    });
  }

  private async executeSummaryNode(
    blueprint: BlueprintDefinition,
    run: BlueprintRun,
    node: BlueprintNode,
    nodeRun: BlueprintNodeRun
  ): Promise<void> {
    await this.executeSummaryNodeWithUpstream(
      run,
      node,
      nodeRun,
      await this.collectUpstreamOutputs(blueprint, run.id, node)
    );
  }

  private async executeSummaryNodeWithUpstream(
    run: BlueprintRun,
    node: BlueprintNode,
    nodeRun: BlueprintNodeRun,
    upstream: Array<{ nodeId: string; nodeLabel: string; output: unknown }>
  ): Promise<void> {
    const config = node.config as SummaryNodeConfig;
    if (config.mode === "openclaw_agent") {
      const { result, openclawRef } = await this.runAgentTask({
        blueprintRunId: run.id,
        nodeRunId: nodeRun.id,
        source: "openclaw",
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
        await this.failNode({ ...nodeRun, openclawRef, usage: result.usage }, result.error ?? `Agent task ${result.status}.`);
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

  private async waitForApproval(node: BlueprintNode, nodeRun: BlueprintNodeRun): Promise<void> {
    const config = node.config as ApprovalNodeConfig;
    const waiting: BlueprintNodeRun = {
      ...nodeRun,
      status: "waiting_approval",
      output: {
        approverHint: config.approverHint,
        instructions: config.instructions
      }
    };
    await this.store.upsertNodeRun(waiting);
    await this.event(nodeRun.blueprintRunId, "node.run.waiting_approval", `${node.config.label} is waiting for approval.`, nodeRun.id);
  }

  private async executeSendNode(blueprint: BlueprintDefinition, run: BlueprintRun, node: BlueprintNode, nodeRun: BlueprintNodeRun): Promise<void> {
    await this.executeSendNodeWithUpstream(
      run,
      node,
      nodeRun,
      blueprint.name,
      await this.collectUpstreamOutputs(blueprint, run.id, node)
    );
  }

  private async executeSendNodeWithUpstream(
    run: BlueprintRun,
    node: BlueprintNode,
    nodeRun: BlueprintNodeRun,
    blueprintName: string,
    upstream: Array<{ nodeId: string; nodeLabel: string; output: unknown }>
  ): Promise<void> {
    const config = node.config as SendNodeConfig;
    const summaryPayload = upstream.length <= 1 ? (upstream[0]?.output ?? {}) : upstream;
    const body = config.bodyTemplate
      .replaceAll("{{blueprint.name}}", blueprintName)
      .replaceAll("{{summary}}", JSON.stringify(summaryPayload))
      .replaceAll("{{upstream}}", JSON.stringify(upstream));
    const result = await this.adapter.sendChannelMessage({
      channelId: config.channelId,
      target: config.target,
      body,
      blueprintRunId: run.id,
      nodeRunId: nodeRun.id
    });
    await this.completeNode(nodeRun, result);
  }

  private evaluateCondition(blueprint: BlueprintDefinition, config: ConditionNodeConfig): boolean {
    const expression = config.expression.trim();
    if (expression === "true") return true;
    if (expression === "false") return false;
    return blueprint.variables[expression] === "true";
  }

  private firstConnectedManagerSlot(blueprint: BlueprintDefinition, managerNode: BlueprintNode, portCount: number): number | undefined {
    for (let slot = 1; slot <= portCount; slot += 1) {
      if (this.findManagerSlotAssignment(blueprint, managerNode, slot)) return slot;
    }
    return undefined;
  }

  private findManagerSlotAssignment(
    blueprint: BlueprintDefinition,
    managerNode: BlueprintNode,
    slot: number
  ): { target: BlueprintNode; returnEdgePresent: boolean } | undefined {
    const outHandle = `${managerOutHandlePrefix}${slot}`;
    const outEdge = blueprint.edges.find((edge) => edge.source === managerNode.id && edge.sourceHandle === outHandle);
    if (!outEdge) return undefined;

    const target = blueprint.nodes.find((candidate) => candidate.id === outEdge.target);
    if (!target) return undefined;

    const inHandle = `${managerInHandlePrefix}${slot}`;
    const returnEdgePresent = blueprint.edges.some(
      (edge) => edge.source === target.id && edge.target === managerNode.id && edge.targetHandle === inHandle
    );
    return { target, returnEdgePresent };
  }

  private getLoopRerunTargets(blueprint: BlueprintDefinition, loopNode: BlueprintNode): BlueprintNode[] {
    const nodesById = new Map(blueprint.nodes.map((candidate) => [candidate.id, candidate]));
    const visited = new Set<string>();
    const queue = blueprint.edges.filter((edge) => edge.source === loopNode.id).map((edge) => edge.target);

    while (queue.length > 0) {
      const nodeId = queue.shift()!;
      if (nodeId === loopNode.id || visited.has(nodeId)) continue;
      const node = nodesById.get(nodeId);
      if (!node) continue;

      visited.add(nodeId);
      for (const edge of blueprint.edges) {
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
    blueprint: BlueprintDefinition,
    node: BlueprintNode,
    nodeRuns: BlueprintNodeRun[]
  ): number | undefined {
    if (node.type === "loop") {
      return this.findLatestTerminalNodeRunWithIndex(nodeRuns, node.id)?.index;
    }

    let latestMarker: { index: number } | undefined;
    for (const candidate of blueprint.nodes) {
      if (candidate.type !== "loop") continue;
      if (!this.getLoopRerunTargets(blueprint, candidate).some((target) => target.id === node.id)) continue;

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
    blueprint: BlueprintDefinition,
    node: BlueprintNode,
    nodeRuns: BlueprintNodeRun[],
    requiredAfterIndex: number
  ): boolean {
    const incoming = this.getSchedulingIncomingEdges(blueprint, node);
    if (incoming.length === 0) return false;
    return incoming.every((edge) => this.resolveIncomingEdgeState(blueprint, edge, nodeRuns, requiredAfterIndex) === "satisfied");
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
    blueprint: BlueprintDefinition,
    blueprintRunId: string,
    node: BlueprintNode
  ): Promise<Array<{ nodeId: string; nodeLabel: string; output: unknown }>> {
    const incoming = this.getUpstreamIncomingEdges(blueprint, node);
    if (incoming.length === 0) return [];

    const nodeRuns = await this.store.listNodeRuns(blueprintRunId);
    const outputs: Array<{ nodeId: string; nodeLabel: string; output: unknown }> = [];
    const seen = new Set<string>();
    const requiredAfterIndex = this.getRequiredAfterIndex(blueprint, node, nodeRuns);

    for (const edge of incoming) {
      const source = blueprint.nodes.find((candidate) => candidate.id === edge.source);
      const edgeRequiredAfterIndex = source?.type === "loop" ? undefined : requiredAfterIndex;
      if (this.resolveIncomingEdgeState(blueprint, edge, nodeRuns, edgeRequiredAfterIndex) !== "satisfied") {
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

  private async completeNode(nodeRun: BlueprintNodeRun, output: unknown, openclawRef?: OpenClawObjectRef): Promise<void> {
    const completed: BlueprintNodeRun = {
      ...nodeRun,
      status: "succeeded",
      endedAt: new Date().toISOString(),
      output,
      openclawRef: openclawRef ?? nodeRun.openclawRef
    };
    await this.store.upsertNodeRun(completed);
    await this.event(nodeRun.blueprintRunId, "node.run.completed", `${nodeRun.nodeLabel} completed.`, nodeRun.id, openclawRef);
  }

  private async failNode(nodeRun: BlueprintNodeRun, error: string): Promise<void> {
    await this.store.upsertNodeRun({
      ...nodeRun,
      status: "failed",
      endedAt: new Date().toISOString(),
      error
    });
    await this.event(nodeRun.blueprintRunId, "node.run.failed", `${nodeRun.nodeLabel} failed: ${error}`, nodeRun.id);
  }

  private async skipNode(blueprint: BlueprintDefinition, run: BlueprintRun, node: BlueprintNode): Promise<void> {
    const now = new Date().toISOString();
    const reason = node.disabled ? "disabled" : "branch_not_selected";
    const skipped: BlueprintNodeRun = {
      id: `node-run-${nanoid(10)}`,
      blueprintRunId: run.id,
      blueprintId: blueprint.id,
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

  private async applyRunTotals(run: BlueprintRun, startedAt: number, status: "succeeded" | "failed"): Promise<BlueprintRun> {
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

  private hasCurrentNodeRun(blueprint: BlueprintDefinition, node: BlueprintNode, nodeRuns: BlueprintNodeRun[]): boolean {
    if (node.type === "loop") {
      const latestLoopRun = this.findLatestNodeRunWithIndex(nodeRuns, node.id);
      if (!latestLoopRun) return false;
      return !this.hasSatisfiedIncomingAfter(blueprint, node, nodeRuns, latestLoopRun.index);
    }

    const requiredAfterIndex = this.getRequiredAfterIndex(blueprint, node, nodeRuns);
    return nodeRuns.some((nodeRun, index) => nodeRun.nodeId === node.id && this.isAfterRequiredIndex(index, requiredAfterIndex));
  }

  private hasCurrentTerminalNodeRun(blueprint: BlueprintDefinition, node: BlueprintNode, nodeRuns: BlueprintNodeRun[]): boolean {
    if (node.type === "loop") {
      const latestLoopRun = this.findLatestNodeRunWithIndex(nodeRuns, node.id);
      if (!latestLoopRun) return false;
      return this.isTerminalStatus(latestLoopRun.nodeRun.status) && !this.hasSatisfiedIncomingAfter(blueprint, node, nodeRuns, latestLoopRun.index);
    }

    const requiredAfterIndex = this.getRequiredAfterIndex(blueprint, node, nodeRuns);
    return nodeRuns.some(
      (nodeRun, index) =>
        nodeRun.nodeId === node.id &&
        this.isAfterRequiredIndex(index, requiredAfterIndex) &&
        ["succeeded", "failed", "cancelled", "skipped"].includes(nodeRun.status)
    );
  }

  private isBlueprintStep(node: BlueprintNode): boolean {
    return executableTypes.has(node.type);
  }

  private isRunnableNode(node: BlueprintNode): boolean {
    return this.isBlueprintStep(node) && !node.disabled;
  }

  private isGlobalSchedulingNode(blueprint: BlueprintDefinition, node: BlueprintNode): boolean {
    return this.isBlueprintStep(node) && node.type !== "manager_slot" && !this.isNestedNode(node) && !this.isManagedParticipant(blueprint, node);
  }

  private isNestedNode(node: BlueprintNode): boolean {
    return Boolean(node.parentId);
  }

  private isManagedParticipant(blueprint: BlueprintDefinition, node: BlueprintNode): boolean {
    return blueprint.edges.some((edge) => {
      if (edge.target !== node.id || !edge.sourceHandle?.startsWith(managerOutHandlePrefix)) return false;
      const source = blueprint.nodes.find((candidate) => candidate.id === edge.source);
      return source?.type === "manager";
    });
  }

  private getSchedulingIncomingEdges(blueprint: BlueprintDefinition, node: BlueprintNode): BlueprintEdge[] {
    return blueprint.edges.filter((edge) => {
      if (edge.target !== node.id) return false;
      if (node.type === "manager" && edge.targetHandle?.startsWith(managerInHandlePrefix)) return false;

      const source = blueprint.nodes.find((candidate) => candidate.id === edge.source);
      if (source?.type === "loop") return false;
      return true;
    });
  }

  private getUpstreamIncomingEdges(blueprint: BlueprintDefinition, node: BlueprintNode): BlueprintEdge[] {
    return blueprint.edges.filter((edge) => {
      if (edge.target !== node.id) return false;
      return !(node.type === "manager" && edge.targetHandle?.startsWith(managerInHandlePrefix));
    });
  }

  private findLatestNodeRun(
    nodeRuns: BlueprintNodeRun[],
    nodeId: string,
    status?: BlueprintNodeRun["status"],
    requiredAfterIndex?: number
  ): BlueprintNodeRun | undefined {
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
    nodeRuns: BlueprintNodeRun[],
    nodeId: string,
    status?: BlueprintNodeRun["status"]
  ): { nodeRun: BlueprintNodeRun; index: number } | undefined {
    for (let index = nodeRuns.length - 1; index >= 0; index -= 1) {
      const nodeRun = nodeRuns[index]!;
      if (nodeRun.nodeId !== nodeId) continue;
      if (status && nodeRun.status !== status) continue;
      return { nodeRun, index };
    }
    return undefined;
  }

  private findLatestTerminalNodeRunWithIndex(
    nodeRuns: BlueprintNodeRun[],
    nodeId: string
  ): { nodeRun: BlueprintNodeRun; index: number } | undefined {
    for (let index = nodeRuns.length - 1; index >= 0; index -= 1) {
      const nodeRun = nodeRuns[index]!;
      if (nodeRun.nodeId !== nodeId) continue;
      if (!this.isTerminalStatus(nodeRun.status)) continue;
      return { nodeRun, index };
    }
    return undefined;
  }

  private resolveIncomingEdgeState(
    blueprint: BlueprintDefinition,
    edge: BlueprintEdge,
    nodeRuns: BlueprintNodeRun[],
    requiredAfterIndex?: number
  ): IncomingEdgeState {
    const source = blueprint.nodes.find((candidate) => candidate.id === edge.source);
    if (!source) return "blocked";
    if (!this.isBlueprintStep(source)) return "satisfied";

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

  private isTerminalStatus(status: BlueprintNodeRun["status"]): boolean {
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
    const source = started.source;
    const openclawRef: OpenClawObjectRef = {
      source,
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

    const result = await this.adapter.waitForAgentTask({
      nodeRunId: input.nodeRunId,
      taskId: started.taskId,
      runId: started.runId,
      sessionKey: started.sessionKey,
      source,
      agentId: input.agentId,
      modelId: input.modelId
    });

    return {
      result,
      openclawRef: {
        ...openclawRef,
        sourceId: result.taskId,
        sourceUpdatedAt: result.updatedAt,
        taskId: result.taskId,
        runId: result.runId,
        sessionKey: result.sessionKey,
        usageRef: result.usage?.id
      }
    };
  }

  private async event(
    blueprintRunId: string,
    type: BlueprintNodeEvent["type"],
    message: string,
    nodeRunId?: string,
    openclawRef?: OpenClawObjectRef
  ): Promise<void> {
    await this.store.appendEvent({
      id: `event-${nanoid(10)}`,
      blueprintRunId,
      nodeRunId,
      type,
      message,
      createdAt: new Date().toISOString(),
      openclawRef
    });
  }
}

function asAgentBlueprintNode(node: BlueprintNode): BlueprintNode & { type: AgentBlueprintNodeType } {
  if (!isAgentBlueprintNodeType(node.type)) {
    throw new Error(`Node type ${node.type} is not an agent node.`);
  }
  return node as BlueprintNode & { type: AgentBlueprintNodeType };
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
