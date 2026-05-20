import { nanoid } from "nanoid";
import type { OpenClawAdapter } from "@hiveward/adapter";
import {
  isAgentMissionNodeType,
  resolveAgentNodeSource,
  type AgentNodeConfig,
  type AgentMissionNodeType,
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
  type MissionDefinition,
  type MissionEdge,
  type MissionNode,
  type MissionNodeEvent,
  type MissionNodeRun,
  type MissionRun
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

export class MissionWorker {
  private readonly activeRuns = new Map<string, Promise<void>>();

  constructor(
    private readonly store: FileHivewardStore,
    private readonly adapter: OpenClawAdapter
  ) {}

  async startRun(mission: MissionDefinition, startedBy: string): Promise<MissionRun> {
    const run = await this.store.createMissionRun(mission, startedBy);
    const runningRun = {
      ...run,
      status: "running" as const
    };
    await this.store.updateMissionRun(runningRun);
    await this.event(runningRun.id, "mission.run.started", `Mission ${mission.name} started.`);
    this.scheduleRun(mission, runningRun);
    return runningRun;
  }

  async approveRun(mission: MissionDefinition, run: MissionRun): Promise<MissionRun> {
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
    await this.store.updateMissionRun(running);
    this.scheduleRun(mission, running);
    return running;
  }

  private scheduleRun(mission: MissionDefinition, run: MissionRun): void {
    if (this.activeRuns.has(run.id)) {
      return;
    }

    const execution = this.runUntilBlockedOrDone(mission, run)
      .catch(async (error) => {
        const currentRun = await this.store.getMissionRun(run.id);
        if (!currentRun) return;

        const failed = await this.applyRunTotals(currentRun, new Date(currentRun.startedAt).getTime(), "failed");
        const message = error instanceof Error ? error.message : "Mission worker crashed unexpectedly.";
        await this.event(run.id, "mission.run.failed", `Mission ${mission.name} crashed: ${message}`);
        await this.store.updateMissionRun(failed);
      })
      .finally(() => {
        this.activeRuns.delete(run.id);
      });

    this.activeRuns.set(run.id, execution);
  }

  private async runUntilBlockedOrDone(mission: MissionDefinition, run: MissionRun): Promise<void> {
    const startedAt = new Date(run.startedAt).getTime();

    while (true) {
      const nodeRuns = await this.store.listNodeRuns(run.id);
      const skippedNodes = this.findSkippableNodes(mission, nodeRuns);
      if (skippedNodes.length > 0) {
        await Promise.all(skippedNodes.map((node) => this.skipNode(mission, run, node)));
        continue;
      }

      const failedNodeRun = nodeRuns.find((nodeRun) => nodeRun.status === "failed" || nodeRun.status === "cancelled");
      if (failedNodeRun) {
        const failed = await this.applyRunTotals(run, startedAt, "failed");
        await this.event(run.id, "mission.run.failed", `Mission ${mission.name} failed at node ${failedNodeRun.nodeLabel}.`);
        await this.store.updateMissionRun(failed);
        return;
      }
      if (nodeRuns.some((nodeRun) => nodeRun.status === "waiting_approval")) {
        await this.store.updateMissionRun({ ...run, status: "waiting_approval" });
        return;
      }

      const readyNodes = this.findReadyNodes(mission, nodeRuns);
      if (readyNodes.length === 0) {
        const pending = mission.nodes.filter(
          (node) =>
            this.isGlobalSchedulingNode(mission, node) &&
            !this.hasCurrentTerminalNodeRun(mission, node, nodeRuns)
        );
        if (pending.length === 0) {
          const completed = await this.applyRunTotals(run, startedAt, "succeeded");
          await this.event(run.id, "mission.run.completed", `Mission ${mission.name} completed.`);
          await this.store.updateMissionRun(completed);
          return;
        }

        const failed = await this.applyRunTotals(run, startedAt, "failed");
        await this.event(run.id, "mission.run.failed", `Mission ${mission.name} could not continue. Pending nodes: ${pending.map((node) => node.id).join(", ")}.`);
        await this.store.updateMissionRun(failed);
        return;
      }

      await Promise.all(readyNodes.map((node) => this.executeNode(mission, run, node)));
    }
  }

  private findReadyNodes(mission: MissionDefinition, nodeRuns: MissionNodeRun[]): MissionNode[] {
    return mission.nodes.filter((node) => {
      if (!this.isRunnableNode(node)) return false;
      if (!this.isGlobalSchedulingNode(mission, node)) return false;
      if (this.hasCurrentNodeRun(mission, node, nodeRuns)) return false;

      const incoming = this.getSchedulingIncomingEdges(mission, node);
      if (incoming.length === 0) return true;

      const requiredAfterIndex = this.getRequiredAfterIndex(mission, node, nodeRuns);
      return incoming.every((edge) => this.resolveIncomingEdgeState(mission, edge, nodeRuns, requiredAfterIndex) === "satisfied");
    });
  }

  private findSkippableNodes(mission: MissionDefinition, nodeRuns: MissionNodeRun[]): MissionNode[] {
    return mission.nodes.filter((node) => {
      if (!this.isGlobalSchedulingNode(mission, node)) return false;
      if (this.hasCurrentNodeRun(mission, node, nodeRuns)) return false;

      const incoming = this.getSchedulingIncomingEdges(mission, node);
      if (node.disabled) {
        if (incoming.length === 0) return true;
        const requiredAfterIndex = this.getRequiredAfterIndex(mission, node, nodeRuns);
        return incoming.every((edge) => this.resolveIncomingEdgeState(mission, edge, nodeRuns, requiredAfterIndex) !== "pending");
      }
      if (incoming.length === 0) return false;

      const requiredAfterIndex = this.getRequiredAfterIndex(mission, node, nodeRuns);
      const edgeStates = incoming.map((edge) => this.resolveIncomingEdgeState(mission, edge, nodeRuns, requiredAfterIndex));
      return edgeStates.every((state) => state !== "pending") && edgeStates.some((state) => state === "blocked");
    });
  }

  private async executeNode(mission: MissionDefinition, run: MissionRun, node: MissionNode): Promise<void> {
    const nodeRun = await this.createRunningNodeRun(mission, run, node);

    try {
      if (isAgentMissionNodeType(node.type)) {
        await this.executeAgentNode(mission, run, asAgentMissionNode(node), nodeRun);
      } else if (node.type === "parallel_agents") {
        await this.executeParallelAgentsNode(mission, run, node, nodeRun);
      } else if (node.type === "manager") {
        await this.executeManagerNode(mission, run, node, nodeRun);
      } else if (node.type === "manager_slot") {
        await this.failNode(nodeRun, "Manager slot nodes can only run when called by their manager.");
      } else if (node.type === "loop") {
        await this.executeLoopNode(mission, run, node, nodeRun);
      } else if (node.type === "condition") {
        await this.completeNode(nodeRun, { result: this.evaluateCondition(mission, node.config as ConditionNodeConfig) });
      } else if (node.type === "summary") {
        await this.executeSummaryNode(mission, run, node, nodeRun);
      } else if (node.type === "approval") {
        await this.waitForApproval(node, nodeRun);
      } else if (node.type === "send") {
        await this.executeSendNode(mission, run, node, nodeRun);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown node failure";
      await this.failNode(nodeRun, message);
    }
  }

  private async createRunningNodeRun(mission: MissionDefinition, run: MissionRun, node: MissionNode): Promise<MissionNodeRun> {
    const now = new Date().toISOString();
    const nodeRun: MissionNodeRun = {
      id: `node-run-${nanoid(10)}`,
      missionRunId: run.id,
      missionId: mission.id,
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
    mission: MissionDefinition,
    run: MissionRun,
    node: MissionNode & { type: AgentMissionNodeType },
    nodeRun: MissionNodeRun
  ): Promise<void> {
    await this.executeAgentNodeWithInput(mission, run, node, nodeRun, {
      upstream: await this.collectUpstreamOutputs(mission, run.id, node)
    });
  }

  private async executeAgentNodeWithInput(
    _mission: MissionDefinition,
    run: MissionRun,
    node: MissionNode & { type: AgentMissionNodeType },
    nodeRun: MissionNodeRun,
    input: unknown
  ): Promise<AgentTaskResult> {
    const config = node.config as AgentNodeConfig;
    const nodeRunWithInput: MissionNodeRun = {
      ...nodeRun,
      input
    };
    const { result, openclawRef } = await this.runAgentTask({
      missionRunId: run.id,
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
    mission: MissionDefinition,
    run: MissionRun,
    node: MissionNode,
    nodeRun: MissionNodeRun
  ): Promise<void> {
    await this.executeParallelAgentsNodeWithUpstream(
      run,
      node,
      nodeRun,
      await this.collectUpstreamOutputs(mission, run.id, node)
    );
  }

  private async executeParallelAgentsNodeWithUpstream(
    run: MissionRun,
    node: MissionNode,
    nodeRun: MissionNodeRun,
    upstream: Array<{ nodeId: string; nodeLabel: string; output: unknown }>
  ): Promise<void> {
    const config = node.config as ParallelAgentsNodeConfig;
    if (config.agents.length === 0) {
      throw new Error("Parallel agents node has no agents configured.");
    }

    const outputs = await Promise.all(
      config.agents.map((agent) =>
        this.runAgentTask({
          missionRunId: run.id,
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
    mission: MissionDefinition,
    run: MissionRun,
    node: MissionNode,
    nodeRun: MissionNodeRun,
    upstream?: Array<{ nodeId: string; nodeLabel: string; output: unknown }>
  ): Promise<AgentTaskResult> {
    const config = node.config as ManagerNodeConfig;
    const portCount = normalizeInteger(config.portCount, 1, 8, 3);
    const maxHandoffs = normalizeInteger(config.maxHandoffs, 1, 50, 12);
    const managerUpstream = upstream ?? await this.collectUpstreamOutputs(mission, run.id, node);
    const trace: ManagerTraceItem[] = [];
    let slot = this.firstConnectedManagerSlot(mission, node, portCount);

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
      const assignment = this.findManagerSlotAssignment(mission, node, slot);
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

      if (isAgentMissionNodeType(assignment.target.type)) {
        const participantRun = await this.createRunningNodeRun(mission, run, assignment.target);
        result = await this.executeAgentNodeWithInput(mission, run, asAgentMissionNode(assignment.target), participantRun, managerContext);
      } else if (assignment.target.type === "manager_slot") {
        const slotRun = await this.createRunningNodeRun(mission, run, assignment.target);
        result = await this.executeManagerSlotNode(mission, run, assignment.target, slotRun, managerContext);
      } else if (assignment.target.type === "manager") {
        const managerRun = await this.createRunningNodeRun(mission, run, assignment.target);
        result = await this.executeManagerNode(mission, run, assignment.target, managerRun, [
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
    mission: MissionDefinition,
    run: MissionRun,
    slotNode: MissionNode,
    slotRun: MissionNodeRun,
    context: ManagerSlotContext
  ): Promise<AgentTaskResult> {
    const childNodes = mission.nodes.filter((node) => node.parentId === slotNode.id && this.isRunnableNode(node));
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

      const skippable = childNodes.filter((node) => this.isScopedSkippableNode(mission, slotNode, node, nodeRuns, scopeStartIndex));
      if (skippable.length > 0) {
        await Promise.all(skippable.map((node) => this.skipNode(mission, run, node)));
        continue;
      }

      const ready = childNodes.filter((node) => this.isScopedReadyNode(mission, slotNode, node, nodeRuns, scopeStartIndex));
      if (ready.length > 0) {
        await Promise.all(
          ready.map((node) =>
            this.executeScopedNode(
              mission,
              run,
              node,
              this.collectScopedUpstreamOutputs(mission, slotNode, node, nodeRuns, scopeStartIndex, boundaryOutput)
            )
          )
        );
        continue;
      }

      const output = this.resolveManagerSlotOutput(mission, slotNode, childNodes, nodeRuns, scopeStartIndex);
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
    mission: MissionDefinition,
    run: MissionRun,
    node: MissionNode,
    upstream: Array<{ nodeId: string; nodeLabel: string; output: unknown }>
  ): Promise<void> {
    const nodeRun = await this.createRunningNodeRun(mission, run, node);
    if (isAgentMissionNodeType(node.type)) {
      await this.executeAgentNodeWithInput(mission, run, asAgentMissionNode(node), nodeRun, { upstream });
    } else if (node.type === "parallel_agents") {
      await this.executeParallelAgentsNodeWithUpstream(run, node, nodeRun, upstream);
    } else if (node.type === "condition") {
      await this.completeNode(nodeRun, { result: this.evaluateCondition(mission, node.config as ConditionNodeConfig) });
    } else if (node.type === "summary") {
      await this.executeSummaryNodeWithUpstream(run, node, nodeRun, upstream);
    } else if (node.type === "send") {
      await this.executeSendNodeWithUpstream(run, node, nodeRun, mission.name, upstream);
    } else {
      await this.failNode(nodeRun, `Node type ${node.type} is not supported inside a manager slot yet.`);
    }
  }

  private isScopedReadyNode(
    mission: MissionDefinition,
    slotNode: MissionNode,
    node: MissionNode,
    nodeRuns: MissionNodeRun[],
    scopeStartIndex: number
  ): boolean {
    if (this.findLatestNodeRun(nodeRuns, node.id, undefined, scopeStartIndex)) return false;
    const incoming = this.getScopedIncomingEdges(mission, slotNode, node);
    if (incoming.length === 0) return true;
    return incoming.every((edge) => this.resolveScopedEdgeState(mission, slotNode, edge, nodeRuns, scopeStartIndex) === "satisfied");
  }

  private isScopedSkippableNode(
    mission: MissionDefinition,
    slotNode: MissionNode,
    node: MissionNode,
    nodeRuns: MissionNodeRun[],
    scopeStartIndex: number
  ): boolean {
    if (this.findLatestNodeRun(nodeRuns, node.id, undefined, scopeStartIndex)) return false;
    const incoming = this.getScopedIncomingEdges(mission, slotNode, node);
    if (incoming.length === 0) return false;
    const states = incoming.map((edge) => this.resolveScopedEdgeState(mission, slotNode, edge, nodeRuns, scopeStartIndex));
    return states.every((state) => state !== "pending") && states.some((state) => state === "blocked");
  }

  private getScopedIncomingEdges(mission: MissionDefinition, slotNode: MissionNode, node: MissionNode): MissionEdge[] {
    return mission.edges.filter((edge) => {
      if (edge.target !== node.id) return false;
      if (edge.source === slotNode.id) return edge.sourceHandle === managerSlotInnerOutHandle;
      const source = mission.nodes.find((candidate) => candidate.id === edge.source);
      return source?.parentId === slotNode.id;
    });
  }

  private resolveScopedEdgeState(
    mission: MissionDefinition,
    slotNode: MissionNode,
    edge: MissionEdge,
    nodeRuns: MissionNodeRun[],
    scopeStartIndex: number
  ): IncomingEdgeState {
    if (edge.source === slotNode.id && edge.sourceHandle === managerSlotInnerOutHandle) return "satisfied";
    const source = mission.nodes.find((candidate) => candidate.id === edge.source);
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
    mission: MissionDefinition,
    slotNode: MissionNode,
    node: MissionNode,
    nodeRuns: MissionNodeRun[],
    scopeStartIndex: number,
    boundaryOutput: unknown
  ): Array<{ nodeId: string; nodeLabel: string; output: unknown }> {
    const incoming = this.getScopedIncomingEdges(mission, slotNode, node);
    if (incoming.length === 0) {
      return [{ nodeId: slotNode.id, nodeLabel: slotNode.config.label, output: boundaryOutput }];
    }

    const outputs: Array<{ nodeId: string; nodeLabel: string; output: unknown }> = [];
    for (const edge of incoming) {
      if (this.resolveScopedEdgeState(mission, slotNode, edge, nodeRuns, scopeStartIndex) !== "satisfied") continue;
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
    mission: MissionDefinition,
    slotNode: MissionNode,
    childNodes: MissionNode[],
    nodeRuns: MissionNodeRun[],
    scopeStartIndex: number
  ): unknown {
    const explicitOutputs = mission.edges
      .filter((edge) => edge.target === slotNode.id && edge.targetHandle === managerSlotInnerInHandle)
      .flatMap((edge) => {
        const source = childNodes.find((node) => node.id === edge.source);
        if (!source) return [];
        if (this.resolveScopedEdgeState(mission, slotNode, edge, nodeRuns, scopeStartIndex) !== "satisfied") return [];
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
      return !mission.edges.some((edge) => edge.source === node.id && childNodes.some((candidate) => candidate.id === edge.target));
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
    mission: MissionDefinition,
    run: MissionRun,
    node: MissionNode,
    nodeRun: MissionNodeRun
  ): Promise<void> {
    const config = node.config as LoopNodeConfig;
    const maxIterations = normalizeInteger(config.maxIterations, 1, 25, 3);
    const previousLoopRuns = await this.store.listNodeRuns(run.id);
    const previousIteration = previousLoopRuns
      .filter((candidate) => candidate.nodeId === node.id && candidate.status === "succeeded")
      .reduce((max, candidate) => Math.max(max, readInteger(readOutputRecord(candidate.output)?.iteration) ?? 0), 0);
    const iteration = previousIteration + 1;
    const rerunTargets = this.getLoopRerunTargets(mission, node).map((target) => ({
      nodeId: target.id,
      nodeLabel: target.config.label
    }));
    const shouldRerun = iteration < maxIterations && rerunTargets.length > 0;

    await this.completeNode(nodeRun, {
      status: shouldRerun ? "rerun" : "completed",
      iteration,
      maxIterations,
      rerunTargets,
      upstream: await this.collectUpstreamOutputs(mission, run.id, node)
    });
  }

  private async executeSummaryNode(
    mission: MissionDefinition,
    run: MissionRun,
    node: MissionNode,
    nodeRun: MissionNodeRun
  ): Promise<void> {
    await this.executeSummaryNodeWithUpstream(
      run,
      node,
      nodeRun,
      await this.collectUpstreamOutputs(mission, run.id, node)
    );
  }

  private async executeSummaryNodeWithUpstream(
    run: MissionRun,
    node: MissionNode,
    nodeRun: MissionNodeRun,
    upstream: Array<{ nodeId: string; nodeLabel: string; output: unknown }>
  ): Promise<void> {
    const config = node.config as SummaryNodeConfig;
    if (config.mode === "openclaw_agent") {
      const { result, openclawRef } = await this.runAgentTask({
        missionRunId: run.id,
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

  private async waitForApproval(node: MissionNode, nodeRun: MissionNodeRun): Promise<void> {
    const config = node.config as ApprovalNodeConfig;
    const waiting: MissionNodeRun = {
      ...nodeRun,
      status: "waiting_approval",
      output: {
        approverHint: config.approverHint,
        instructions: config.instructions
      }
    };
    await this.store.upsertNodeRun(waiting);
    await this.event(nodeRun.missionRunId, "node.run.waiting_approval", `${node.config.label} is waiting for approval.`, nodeRun.id);
  }

  private async executeSendNode(mission: MissionDefinition, run: MissionRun, node: MissionNode, nodeRun: MissionNodeRun): Promise<void> {
    await this.executeSendNodeWithUpstream(
      run,
      node,
      nodeRun,
      mission.name,
      await this.collectUpstreamOutputs(mission, run.id, node)
    );
  }

  private async executeSendNodeWithUpstream(
    run: MissionRun,
    node: MissionNode,
    nodeRun: MissionNodeRun,
    missionName: string,
    upstream: Array<{ nodeId: string; nodeLabel: string; output: unknown }>
  ): Promise<void> {
    const config = node.config as SendNodeConfig;
    const summaryPayload = upstream.length <= 1 ? (upstream[0]?.output ?? {}) : upstream;
    const body = config.bodyTemplate
      .replaceAll("{{mission.name}}", missionName)
      .replaceAll("{{summary}}", JSON.stringify(summaryPayload))
      .replaceAll("{{upstream}}", JSON.stringify(upstream));
    const result = await this.adapter.sendChannelMessage({
      channelId: config.channelId,
      target: config.target,
      body,
      missionRunId: run.id,
      nodeRunId: nodeRun.id
    });
    await this.completeNode(nodeRun, result);
  }

  private evaluateCondition(mission: MissionDefinition, config: ConditionNodeConfig): boolean {
    const expression = config.expression.trim();
    if (expression === "true") return true;
    if (expression === "false") return false;
    return mission.variables[expression] === "true";
  }

  private firstConnectedManagerSlot(mission: MissionDefinition, managerNode: MissionNode, portCount: number): number | undefined {
    for (let slot = 1; slot <= portCount; slot += 1) {
      if (this.findManagerSlotAssignment(mission, managerNode, slot)) return slot;
    }
    return undefined;
  }

  private findManagerSlotAssignment(
    mission: MissionDefinition,
    managerNode: MissionNode,
    slot: number
  ): { target: MissionNode; returnEdgePresent: boolean } | undefined {
    const outHandle = `${managerOutHandlePrefix}${slot}`;
    const outEdge = mission.edges.find((edge) => edge.source === managerNode.id && edge.sourceHandle === outHandle);
    if (!outEdge) return undefined;

    const target = mission.nodes.find((candidate) => candidate.id === outEdge.target);
    if (!target) return undefined;

    const inHandle = `${managerInHandlePrefix}${slot}`;
    const returnEdgePresent = mission.edges.some(
      (edge) => edge.source === target.id && edge.target === managerNode.id && edge.targetHandle === inHandle
    );
    return { target, returnEdgePresent };
  }

  private getLoopRerunTargets(mission: MissionDefinition, loopNode: MissionNode): MissionNode[] {
    const nodesById = new Map(mission.nodes.map((candidate) => [candidate.id, candidate]));
    const visited = new Set<string>();
    const queue = mission.edges.filter((edge) => edge.source === loopNode.id).map((edge) => edge.target);

    while (queue.length > 0) {
      const nodeId = queue.shift()!;
      if (nodeId === loopNode.id || visited.has(nodeId)) continue;
      const node = nodesById.get(nodeId);
      if (!node) continue;

      visited.add(nodeId);
      for (const edge of mission.edges) {
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
    mission: MissionDefinition,
    node: MissionNode,
    nodeRuns: MissionNodeRun[]
  ): number | undefined {
    if (node.type === "loop") {
      return this.findLatestTerminalNodeRunWithIndex(nodeRuns, node.id)?.index;
    }

    let latestMarker: { index: number } | undefined;
    for (const candidate of mission.nodes) {
      if (candidate.type !== "loop") continue;
      if (!this.getLoopRerunTargets(mission, candidate).some((target) => target.id === node.id)) continue;

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
    mission: MissionDefinition,
    node: MissionNode,
    nodeRuns: MissionNodeRun[],
    requiredAfterIndex: number
  ): boolean {
    const incoming = this.getSchedulingIncomingEdges(mission, node);
    if (incoming.length === 0) return false;
    return incoming.every((edge) => this.resolveIncomingEdgeState(mission, edge, nodeRuns, requiredAfterIndex) === "satisfied");
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
    mission: MissionDefinition,
    missionRunId: string,
    node: MissionNode
  ): Promise<Array<{ nodeId: string; nodeLabel: string; output: unknown }>> {
    const incoming = this.getUpstreamIncomingEdges(mission, node);
    if (incoming.length === 0) return [];

    const nodeRuns = await this.store.listNodeRuns(missionRunId);
    const outputs: Array<{ nodeId: string; nodeLabel: string; output: unknown }> = [];
    const seen = new Set<string>();
    const requiredAfterIndex = this.getRequiredAfterIndex(mission, node, nodeRuns);

    for (const edge of incoming) {
      const source = mission.nodes.find((candidate) => candidate.id === edge.source);
      const edgeRequiredAfterIndex = source?.type === "loop" ? undefined : requiredAfterIndex;
      if (this.resolveIncomingEdgeState(mission, edge, nodeRuns, edgeRequiredAfterIndex) !== "satisfied") {
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

  private async completeNode(nodeRun: MissionNodeRun, output: unknown, openclawRef?: OpenClawObjectRef): Promise<void> {
    const completed: MissionNodeRun = {
      ...nodeRun,
      status: "succeeded",
      endedAt: new Date().toISOString(),
      output,
      openclawRef: openclawRef ?? nodeRun.openclawRef
    };
    await this.store.upsertNodeRun(completed);
    await this.event(nodeRun.missionRunId, "node.run.completed", `${nodeRun.nodeLabel} completed.`, nodeRun.id, openclawRef);
  }

  private async failNode(nodeRun: MissionNodeRun, error: string): Promise<void> {
    await this.store.upsertNodeRun({
      ...nodeRun,
      status: "failed",
      endedAt: new Date().toISOString(),
      error
    });
    await this.event(nodeRun.missionRunId, "node.run.failed", `${nodeRun.nodeLabel} failed: ${error}`, nodeRun.id);
  }

  private async skipNode(mission: MissionDefinition, run: MissionRun, node: MissionNode): Promise<void> {
    const now = new Date().toISOString();
    const reason = node.disabled ? "disabled" : "branch_not_selected";
    const skipped: MissionNodeRun = {
      id: `node-run-${nanoid(10)}`,
      missionRunId: run.id,
      missionId: mission.id,
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

  private async applyRunTotals(run: MissionRun, startedAt: number, status: "succeeded" | "failed"): Promise<MissionRun> {
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

  private hasCurrentNodeRun(mission: MissionDefinition, node: MissionNode, nodeRuns: MissionNodeRun[]): boolean {
    if (node.type === "loop") {
      const latestLoopRun = this.findLatestNodeRunWithIndex(nodeRuns, node.id);
      if (!latestLoopRun) return false;
      return !this.hasSatisfiedIncomingAfter(mission, node, nodeRuns, latestLoopRun.index);
    }

    const requiredAfterIndex = this.getRequiredAfterIndex(mission, node, nodeRuns);
    return nodeRuns.some((nodeRun, index) => nodeRun.nodeId === node.id && this.isAfterRequiredIndex(index, requiredAfterIndex));
  }

  private hasCurrentTerminalNodeRun(mission: MissionDefinition, node: MissionNode, nodeRuns: MissionNodeRun[]): boolean {
    if (node.type === "loop") {
      const latestLoopRun = this.findLatestNodeRunWithIndex(nodeRuns, node.id);
      if (!latestLoopRun) return false;
      return this.isTerminalStatus(latestLoopRun.nodeRun.status) && !this.hasSatisfiedIncomingAfter(mission, node, nodeRuns, latestLoopRun.index);
    }

    const requiredAfterIndex = this.getRequiredAfterIndex(mission, node, nodeRuns);
    return nodeRuns.some(
      (nodeRun, index) =>
        nodeRun.nodeId === node.id &&
        this.isAfterRequiredIndex(index, requiredAfterIndex) &&
        ["succeeded", "failed", "cancelled", "skipped"].includes(nodeRun.status)
    );
  }

  private isMissionStep(node: MissionNode): boolean {
    return executableTypes.has(node.type);
  }

  private isRunnableNode(node: MissionNode): boolean {
    return this.isMissionStep(node) && !node.disabled;
  }

  private isGlobalSchedulingNode(mission: MissionDefinition, node: MissionNode): boolean {
    return this.isMissionStep(node) && node.type !== "manager_slot" && !this.isNestedNode(node) && !this.isManagedParticipant(mission, node);
  }

  private isNestedNode(node: MissionNode): boolean {
    return Boolean(node.parentId);
  }

  private isManagedParticipant(mission: MissionDefinition, node: MissionNode): boolean {
    return mission.edges.some((edge) => {
      if (edge.target !== node.id || !edge.sourceHandle?.startsWith(managerOutHandlePrefix)) return false;
      const source = mission.nodes.find((candidate) => candidate.id === edge.source);
      return source?.type === "manager";
    });
  }

  private getSchedulingIncomingEdges(mission: MissionDefinition, node: MissionNode): MissionEdge[] {
    return mission.edges.filter((edge) => {
      if (edge.target !== node.id) return false;
      if (node.type === "manager" && edge.targetHandle?.startsWith(managerInHandlePrefix)) return false;

      const source = mission.nodes.find((candidate) => candidate.id === edge.source);
      if (source?.type === "loop") return false;
      return true;
    });
  }

  private getUpstreamIncomingEdges(mission: MissionDefinition, node: MissionNode): MissionEdge[] {
    return mission.edges.filter((edge) => {
      if (edge.target !== node.id) return false;
      return !(node.type === "manager" && edge.targetHandle?.startsWith(managerInHandlePrefix));
    });
  }

  private findLatestNodeRun(
    nodeRuns: MissionNodeRun[],
    nodeId: string,
    status?: MissionNodeRun["status"],
    requiredAfterIndex?: number
  ): MissionNodeRun | undefined {
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
    nodeRuns: MissionNodeRun[],
    nodeId: string,
    status?: MissionNodeRun["status"]
  ): { nodeRun: MissionNodeRun; index: number } | undefined {
    for (let index = nodeRuns.length - 1; index >= 0; index -= 1) {
      const nodeRun = nodeRuns[index]!;
      if (nodeRun.nodeId !== nodeId) continue;
      if (status && nodeRun.status !== status) continue;
      return { nodeRun, index };
    }
    return undefined;
  }

  private findLatestTerminalNodeRunWithIndex(
    nodeRuns: MissionNodeRun[],
    nodeId: string
  ): { nodeRun: MissionNodeRun; index: number } | undefined {
    for (let index = nodeRuns.length - 1; index >= 0; index -= 1) {
      const nodeRun = nodeRuns[index]!;
      if (nodeRun.nodeId !== nodeId) continue;
      if (!this.isTerminalStatus(nodeRun.status)) continue;
      return { nodeRun, index };
    }
    return undefined;
  }

  private resolveIncomingEdgeState(
    mission: MissionDefinition,
    edge: MissionEdge,
    nodeRuns: MissionNodeRun[],
    requiredAfterIndex?: number
  ): IncomingEdgeState {
    const source = mission.nodes.find((candidate) => candidate.id === edge.source);
    if (!source) return "blocked";
    if (!this.isMissionStep(source)) return "satisfied";

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

  private isTerminalStatus(status: MissionNodeRun["status"]): boolean {
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
    missionRunId: string,
    type: MissionNodeEvent["type"],
    message: string,
    nodeRunId?: string,
    openclawRef?: OpenClawObjectRef
  ): Promise<void> {
    await this.store.appendEvent({
      id: `event-${nanoid(10)}`,
      missionRunId,
      nodeRunId,
      type,
      message,
      createdAt: new Date().toISOString(),
      openclawRef
    });
  }
}

function asAgentMissionNode(node: MissionNode): MissionNode & { type: AgentMissionNodeType } {
  if (!isAgentMissionNodeType(node.type)) {
    throw new Error(`Node type ${node.type} is not an agent node.`);
  }
  return node as MissionNode & { type: AgentMissionNodeType };
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
