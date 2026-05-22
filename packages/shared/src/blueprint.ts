import type { AgentPermissionProfile, OpenClawObjectRef, OpenClawObjectSource, OpenClawUsageFact } from "./openclaw";

export type AgentRuntimeId = "openclaw" | "codex" | "claude";

export type AgentBlueprintNodeType = "agent";

export type BlueprintNodeType =
  | AgentBlueprintNodeType
  | "parallel_agents"
  | "manager"
  | "manager_slot"
  | "loop"
  | "condition"
  | "summary"
  | "approval"
  | "send"
  | "note"
  | "group";

export type BlueprintRunStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "waiting_approval";

export type BlueprintNodeRunStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "skipped"
  | "waiting_approval";

export type BlueprintNodeResultRole = "auto" | "final" | "ignore";

export interface CanvasPosition {
  x: number;
  y: number;
}

export interface CanvasSize {
  width: number;
  height: number;
}

export interface BlueprintNodeBaseConfig {
  label: string;
  description?: string;
  resultRole?: BlueprintNodeResultRole;
}

export interface AgentNodeConfig extends BlueprintNodeBaseConfig {
  openclawAgentId?: string;
  profileId?: string;
  agentName: string;
  prompt: string;
  modelId?: string;
  permissionProfile?: AgentPermissionProfile;
  workingDirectory?: string;
  timeoutMs?: number;
  outputSchema?: Record<string, unknown>;
  tools: string[];
}

export interface ParallelAgentsNodeConfig extends BlueprintNodeBaseConfig {
  agents: AgentNodeConfig[];
  waitFor: "all" | "first_success";
}

export interface ManagerNodeConfig extends BlueprintNodeBaseConfig {
  portCount: number;
  maxHandoffs: number;
  instructions?: string;
  openclawAgentId?: string;
  agentName?: string;
  modelId?: string;
  permissionProfile?: AgentPermissionProfile;
  workingDirectory?: string;
  timeoutMs?: number;
  tools?: string[];
}

export interface ManagerSlotNodeConfig extends BlueprintNodeBaseConfig {
  managerNodeId: string;
  slot: number;
}

export interface LoopNodeConfig extends BlueprintNodeBaseConfig {
  maxIterations: number;
}

export interface ConditionNodeConfig extends BlueprintNodeBaseConfig {
  expression: string;
}

export interface SummaryNodeConfig extends BlueprintNodeBaseConfig {
  mode: "structured_merge" | "openclaw_summary_agent";
  prompt?: string;
  modelId?: string;
}

export interface ApprovalNodeConfig extends BlueprintNodeBaseConfig {
  approverHint?: string;
  instructions?: string;
}

export interface SendNodeConfig extends BlueprintNodeBaseConfig {
  channelId: string;
  target: string;
  bodyTemplate: string;
}

export interface NoteNodeConfig extends BlueprintNodeBaseConfig {
  body: string;
}

export interface GroupNodeConfig extends BlueprintNodeBaseConfig {
  color: string;
}

export type BlueprintNodeConfig =
  | AgentNodeConfig
  | ParallelAgentsNodeConfig
  | ManagerNodeConfig
  | ManagerSlotNodeConfig
  | LoopNodeConfig
  | ConditionNodeConfig
  | SummaryNodeConfig
  | ApprovalNodeConfig
  | SendNodeConfig
  | NoteNodeConfig
  | GroupNodeConfig;

export function isAgentBlueprintNodeType(type: BlueprintNodeType): type is AgentBlueprintNodeType {
  return type === "agent";
}

export function isAgentBlueprintNode(node: BlueprintNode): node is BlueprintNode & {
  type: "agent";
  runtimeId: AgentRuntimeId;
  config: AgentNodeConfig;
} {
  return node.type === "agent";
}

export function resolveAgentRuntimeSource(runtimeId: AgentRuntimeId): OpenClawObjectSource {
  return runtimeId;
}

export interface BlueprintNode {
  id: string;
  type: BlueprintNodeType;
  runtimeId?: AgentRuntimeId;
  position: CanvasPosition;
  size?: CanvasSize;
  config: BlueprintNodeConfig;
  parentId?: string;
  disabled?: boolean;
}

export interface BlueprintEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  label?: string;
  condition?: "true" | "false" | "success" | "failure";
}

export interface BlueprintDefinition {
  id: string;
  companyId: string;
  name: string;
  description?: string;
  version: number;
  nodes: BlueprintNode[];
  edges: BlueprintEdge[];
  variables: Record<string, string>;
  display: {
    viewport?: {
      x: number;
      y: number;
      zoom: number;
    };
  };
  createdAt: string;
  updatedAt: string;
}

export const portableBlueprintPackageSchema = "hiveward.blueprint-package/v1";

export type PortableBlueprintDefinition = Pick<
  BlueprintDefinition,
  "id" | "name" | "description" | "version" | "nodes" | "edges" | "variables" | "display"
>;

export interface PortableBlueprintPackage {
  schema: typeof portableBlueprintPackageSchema;
  exportedAt: string;
  blueprints: PortableBlueprintDefinition[];
}

export interface BlueprintImportDefaults {
  openclawAgentId?: string;
  modelId?: string;
  channelId?: string;
}

export interface BlueprintRun {
  id: string;
  companyId: string;
  blueprintId: string;
  blueprintName?: string;
  blueprintVersion: number;
  status: BlueprintRunStatus;
  startedBy: string;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  openclawRefs: OpenClawObjectRef[];
}

export interface BlueprintNodeRun {
  id: string;
  blueprintRunId: string;
  blueprintId: string;
  nodeId: string;
  nodeLabel: string;
  nodeType: BlueprintNodeType;
  status: BlueprintNodeRunStatus;
  queuedAt: string;
  startedAt?: string;
  endedAt?: string;
  input?: unknown;
  output?: unknown;
  error?: string;
  usage?: OpenClawUsageFact;
  openclawRef?: OpenClawObjectRef;
}

export interface BlueprintNodeEvent {
  id: string;
  blueprintRunId: string;
  nodeRunId?: string;
  type:
    | "blueprint.run.started"
    | "node.run.queued"
    | "node.run.started"
    | "node.run.waiting_approval"
    | "node.run.completed"
    | "node.run.failed"
    | "node.run.cancelled"
    | "blueprint.run.completed"
    | "blueprint.run.cancelled"
    | "blueprint.run.failed";
  message: string;
  createdAt: string;
  openclawRef?: OpenClawObjectRef;
}

export interface BlueprintRunView {
  run: BlueprintRunSummary;
  nodeRuns: BlueprintNodeRun[];
  events: BlueprintNodeEvent[];
  finalResult?: FinalRunResult | null;
}

export interface BlueprintRunSummary extends BlueprintRun {
  blueprintName: string;
}

export const blueprintRunArchiveSchema = "hiveward.run-archive/v1";

export interface BlueprintRunArchive {
  schema: typeof blueprintRunArchiveSchema;
  run: BlueprintRunSummary;
  blueprintSnapshot: BlueprintDefinition;
  nodeRuns: BlueprintNodeRun[];
  events: BlueprintNodeEvent[];
  finalResult: FinalRunResult | null;
}

export type FinalRunResultState = "available" | "failed" | "waiting_approval" | "empty";

export type FinalRunResultSelectionReason =
  | "explicit_final"
  | "terminal_result"
  | "latest_result";

export interface FinalRunResultCandidate {
  nodeRunId: string;
  blueprintRunId: string;
  blueprintId: string;
  nodeId: string;
  nodeLabel: string;
  nodeType: BlueprintNodeType;
  resultRole: BlueprintNodeResultRole;
  selectionReason: FinalRunResultSelectionReason;
  output: unknown;
  endedAt?: string;
  openclawRef?: OpenClawObjectRef;
}

export interface FinalRunNodeContext {
  nodeRunId: string;
  blueprintRunId: string;
  blueprintId: string;
  nodeId: string;
  nodeLabel: string;
  nodeType: BlueprintNodeType;
  status: BlueprintNodeRunStatus;
  input?: unknown;
  output?: unknown;
  error?: string;
  endedAt?: string;
  openclawRef?: OpenClawObjectRef;
}

export interface FinalRunResult {
  state: FinalRunResultState;
  candidates: FinalRunResultCandidate[];
  failedNode?: FinalRunNodeContext;
  waitingApprovalNode?: FinalRunNodeContext;
}

const resultProducingNodeTypes = new Set<BlueprintNodeType>([
  "agent",
  "parallel_agents",
  "manager",
  "summary"
]);

const managerOutHandlePrefix = "manager-out-";

export function resolveFinalRunResult(
  blueprint: BlueprintDefinition,
  nodeRuns: BlueprintNodeRun[],
  runStatus?: BlueprintRunStatus
): FinalRunResult | null {
  const nodesById = new Map(blueprint.nodes.map((node) => [node.id, node]));
  const indexedCandidates = nodeRuns
    .map((nodeRun, index) => {
      const node = nodesById.get(nodeRun.nodeId);
      return {
        index,
        nodeRun,
        node,
        nodeType: node?.type ?? nodeRun.nodeType,
        resultRole: node?.config.resultRole ?? "auto"
      };
    })
    .filter((candidate) => isSuccessfulResultCandidate(candidate.nodeType, candidate.nodeRun, candidate.resultRole));

  const explicitFinals = indexedCandidates
    .filter((candidate) => candidate.resultRole === "final")
    .filter((candidate, _index, finals) => !hasLaterSameNodeCandidate(candidate, finals));
  const selectedCandidates = explicitFinals.length > 0
    ? explicitFinals.map((candidate) => toFinalRunResultCandidate(candidate, "explicit_final"))
    : resolveAutomaticFinalCandidates(blueprint, indexedCandidates)
        .map(({ candidate, reason }) => toFinalRunResultCandidate(candidate, reason));

  const failedNode = [...nodeRuns]
    .reverse()
    .find((nodeRun) => nodeRun.status === "failed" || nodeRun.status === "cancelled");
  const waitingApprovalNode = [...nodeRuns]
    .reverse()
    .find((nodeRun) => nodeRun.status === "waiting_approval");
  const finalRunState = resolveFinalRunResultState(runStatus, selectedCandidates, failedNode, waitingApprovalNode);

  if (selectedCandidates.length === 0 && !failedNode && !waitingApprovalNode && !shouldReturnEmptyFinalResult(runStatus)) {
    return null;
  }

  return {
    state: finalRunState,
    candidates: selectedCandidates,
    failedNode: failedNode ? toFinalRunNodeContext(failedNode) : undefined,
    waitingApprovalNode: waitingApprovalNode ? toFinalRunNodeContext(waitingApprovalNode) : undefined
  };
}

interface IndexedFinalCandidate {
  index: number;
  nodeRun: BlueprintNodeRun;
  node?: BlueprintNode;
  nodeType: BlueprintNodeType;
  resultRole: BlueprintNodeResultRole;
}

function resolveAutomaticFinalCandidates(
  blueprint: BlueprintDefinition,
  candidates: IndexedFinalCandidate[]
): Array<{ candidate: IndexedFinalCandidate; reason: FinalRunResultSelectionReason }> {
  const automaticCandidates = candidates.filter(
    (candidate) => candidate.resultRole !== "final" && !isManagerInternalAutoCandidate(blueprint, candidate.node)
  );
  const terminalCandidates = automaticCandidates.filter(
    (candidate) =>
      !hasLaterSameNodeCandidate(candidate, automaticCandidates) &&
      !hasLaterDownstreamResultCandidate(blueprint, candidate, automaticCandidates)
  );

  if (terminalCandidates.length > 0) {
    return terminalCandidates.map((candidate) => ({ candidate, reason: "terminal_result" }));
  }

  const latestCandidate = automaticCandidates[automaticCandidates.length - 1];
  return latestCandidate ? [{ candidate: latestCandidate, reason: "latest_result" }] : [];
}

function isSuccessfulResultCandidate(
  nodeType: BlueprintNodeType,
  nodeRun: BlueprintNodeRun,
  resultRole: BlueprintNodeResultRole
): boolean {
  return (
    resultRole !== "ignore" &&
    (resultRole === "final" || resultProducingNodeTypes.has(nodeType)) &&
    nodeRun.status === "succeeded" &&
    nodeRun.output !== undefined
  );
}

function isManagerInternalAutoCandidate(blueprint: BlueprintDefinition, node: BlueprintNode | undefined): boolean {
  if (!node) return false;
  if (node.parentId) return true;

  return blueprint.edges.some((edge) => {
    if (edge.target !== node.id || !edge.sourceHandle?.startsWith(managerOutHandlePrefix)) return false;
    const source = blueprint.nodes.find((candidate) => candidate.id === edge.source);
    return source?.type === "manager";
  });
}

function hasLaterSameNodeCandidate(
  candidate: IndexedFinalCandidate,
  candidates: IndexedFinalCandidate[]
): boolean {
  return candidates.some((item) => item.nodeRun.nodeId === candidate.nodeRun.nodeId && item.index > candidate.index);
}

function hasLaterDownstreamResultCandidate(
  blueprint: BlueprintDefinition,
  candidate: IndexedFinalCandidate,
  candidates: IndexedFinalCandidate[]
): boolean {
  return candidates.some(
    (item) =>
      item.index > candidate.index &&
      item.nodeRun.id !== candidate.nodeRun.id &&
      isDownstreamNode(blueprint, candidate.nodeRun.nodeId, item.nodeRun.nodeId)
  );
}

function isDownstreamNode(blueprint: BlueprintDefinition, sourceNodeId: string, targetNodeId: string): boolean {
  const visited = new Set<string>();
  const queue = blueprint.edges.filter((edge) => edge.source === sourceNodeId).map((edge) => edge.target);

  while (queue.length > 0) {
    const nextNodeId = queue.shift()!;
    if (nextNodeId === targetNodeId) return true;
    if (visited.has(nextNodeId)) continue;

    visited.add(nextNodeId);
    queue.push(...blueprint.edges.filter((edge) => edge.source === nextNodeId).map((edge) => edge.target));
  }

  return false;
}

function toFinalRunResultCandidate(
  candidate: IndexedFinalCandidate,
  selectionReason: FinalRunResultSelectionReason
): FinalRunResultCandidate {
  return {
    nodeRunId: candidate.nodeRun.id,
    blueprintRunId: candidate.nodeRun.blueprintRunId,
    blueprintId: candidate.nodeRun.blueprintId,
    nodeId: candidate.nodeRun.nodeId,
    nodeLabel: candidate.nodeRun.nodeLabel,
    nodeType: candidate.nodeType,
    resultRole: candidate.resultRole,
    selectionReason,
    output: candidate.nodeRun.output,
    endedAt: candidate.nodeRun.endedAt,
    openclawRef: candidate.nodeRun.openclawRef
  };
}

function toFinalRunNodeContext(nodeRun: BlueprintNodeRun): FinalRunNodeContext {
  return {
    nodeRunId: nodeRun.id,
    blueprintRunId: nodeRun.blueprintRunId,
    blueprintId: nodeRun.blueprintId,
    nodeId: nodeRun.nodeId,
    nodeLabel: nodeRun.nodeLabel,
    nodeType: nodeRun.nodeType,
    status: nodeRun.status,
    input: nodeRun.input,
    output: nodeRun.output,
    error: nodeRun.error,
    endedAt: nodeRun.endedAt,
    openclawRef: nodeRun.openclawRef
  };
}

function resolveFinalRunResultState(
  runStatus: BlueprintRunStatus | undefined,
  candidates: FinalRunResultCandidate[],
  failedNode: BlueprintNodeRun | undefined,
  waitingApprovalNode: BlueprintNodeRun | undefined
): FinalRunResultState {
  if (runStatus === "failed" || runStatus === "cancelled" || failedNode) return "failed";
  if (runStatus === "waiting_approval" || waitingApprovalNode) return "waiting_approval";
  return candidates.length > 0 ? "available" : "empty";
}

function shouldReturnEmptyFinalResult(runStatus: BlueprintRunStatus | undefined): boolean {
  return runStatus === "succeeded" || runStatus === "failed" || runStatus === "cancelled" || runStatus === "waiting_approval";
}

export function createStarterBlueprint(now: string, companyId = "company-hiveward-studio"): BlueprintDefinition {
  return {
    id: "starter-blueprint",
    companyId,
    name: "Multi-agent delivery review",
    description:
      "A governed Hiveward blueprint for requirements, architecture, test review, approval, and delivery through full agent harnesses.",
    version: 1,
    nodes: [
      {
        id: "requirements",
        type: "agent",
        runtimeId: "openclaw",
        position: { x: 80, y: 120 },
        config: {
          label: "Requirements Agent",
          openclawAgentId: "main",
          agentName: "requirements-analyst",
          prompt: "Analyze the requested change and produce crisp acceptance criteria.",
          tools: ["repo.search"]
        }
      },
      {
        id: "architecture",
        type: "agent",
        runtimeId: "openclaw",
        position: { x: 420, y: 36 },
        config: {
          label: "Architecture Agent",
          openclawAgentId: "main",
          agentName: "architect",
          prompt: "Check boundaries, data ownership, and integration shape.",
          tools: ["repo.search"]
        }
      },
      {
        id: "tests",
        type: "agent",
        runtimeId: "openclaw",
        position: { x: 420, y: 220 },
        config: {
          label: "Test Agent",
          openclawAgentId: "main",
          agentName: "test-engineer",
          prompt: "Define verification that proves behavior without coupling to runtime internals.",
          tools: ["repo.test"]
        }
      },
      {
        id: "summary",
        type: "summary",
        position: { x: 760, y: 132 },
        config: {
          label: "Merge Summary",
          mode: "structured_merge",
          description: "Merge upstream node outputs for review."
        }
      },
      {
        id: "approval",
        type: "approval",
        position: { x: 1100, y: 132 },
        config: {
          label: "Human Approval",
          approverHint: "Engineering lead",
          instructions: "Approve before sending to the team channel."
        }
      },
      {
        id: "send",
        type: "send",
        position: { x: 1440, y: 132 },
        config: {
          label: "Send to Slack",
          channelId: "slack",
          target: "#engineering",
          bodyTemplate: "Blueprint {{blueprint.name}} completed. Summary: {{summary}}"
        }
      }
    ],
    edges: [
      { id: "e1", source: "requirements", target: "architecture", condition: "success" },
      { id: "e2", source: "requirements", target: "tests", condition: "success" },
      { id: "e3", source: "architecture", target: "summary", condition: "success" },
      { id: "e4", source: "tests", target: "summary", condition: "success" },
      { id: "e5", source: "summary", target: "approval", condition: "success" },
      { id: "e6", source: "approval", target: "send", condition: "success" }
    ],
    variables: {},
    display: {
      viewport: { x: 0, y: 0, zoom: 0.82 }
    },
    createdAt: now,
    updatedAt: now
  };
}

export function createRealThreeAgentBlueprint(now: string, companyId = "company-hiveward-studio"): BlueprintDefinition {
  return {
    id: "real-three-agent-blueprint",
    companyId,
    name: "Real 3-node OpenClaw agent chain",
    description:
      "A minimal executable Hiveward blueprint that calls the real OpenClaw agent configured as main. Each node receives upstream output from the previous node.",
    version: 1,
    nodes: [
      {
        id: "brief",
        type: "agent",
        runtimeId: "openclaw",
        position: { x: 120, y: 180 },
        config: {
          label: "1. Brief",
          openclawAgentId: "main",
          agentName: "main",
          prompt:
            "Summarize the user request in JSON with goal, constraints, and acceptance criteria. Keep it concise.",
          tools: []
        }
      },
      {
        id: "plan",
        type: "agent",
        runtimeId: "openclaw",
        position: { x: 500, y: 180 },
        config: {
          label: "2. Plan",
          openclawAgentId: "main",
          agentName: "main",
          prompt:
            "Using the upstream brief, propose exactly three implementation steps and one verification command. Return JSON.",
          tools: []
        }
      },
      {
        id: "verify",
        type: "agent",
        runtimeId: "openclaw",
        position: { x: 880, y: 180 },
        config: {
          label: "3. Verify",
          openclawAgentId: "main",
          agentName: "main",
          prompt:
            "Review the upstream plan. Return JSON with verified boolean, risks array, and final recommendation.",
          tools: []
        }
      }
    ],
    edges: [
      { id: "real-e1", source: "brief", target: "plan", condition: "success" },
      { id: "real-e2", source: "plan", target: "verify", condition: "success" }
    ],
    variables: {},
    display: {
      viewport: { x: 0, y: 0, zoom: 0.95 }
    },
    createdAt: now,
    updatedAt: now
  };
}

export function createMultiAgentCompatibilityBlueprint(
  now: string,
  companyId = "company-hiveward-studio",
  workingDirectory = ""
): BlueprintDefinition {
  const workspaceConfig = workingDirectory ? { workingDirectory } : {};

  return {
    id: "multi-agent-compatibility-blueprint",
    companyId,
    name: "Multi-agent compatibility smoke test",
    description:
      "A focused blueprint that validates OpenClaw, Codex, and Claude Code agent nodes through one shared upstream payload and one merged result.",
    version: 1,
    nodes: [
      {
        id: "compat-openclaw-brief",
        type: "agent",
        runtimeId: "openclaw",
        position: { x: 80, y: 180 },
        config: {
          label: "1. OpenClaw Brief",
          openclawAgentId: "main",
          agentName: "openclaw-compat-brief",
          prompt:
            "Create a concise JSON compatibility brief for this Hiveward blueprint. Return only JSON with keys: goal, inputContract, expectedNodeTypes, passCriteria.",
          tools: []
        }
      },
      {
        id: "compat-codex-check",
        type: "agent",
        runtimeId: "codex",
        position: { x: 480, y: 64 },
        config: {
          label: "2A. Codex Check",
          agentName: "codex-compat-check",
          prompt:
            "Read the upstream compatibility brief. Return only JSON with keys: runtime, upstreamReceived, contractAccepted, notes. runtime must be codex.",
          permissionProfile: "read_only",
          timeoutMs: 600000,
          outputSchema: {
            type: "object",
            required: ["runtime", "upstreamReceived", "contractAccepted", "notes"],
            properties: {
              runtime: { type: "string" },
              upstreamReceived: { type: "boolean" },
              contractAccepted: { type: "boolean" },
              notes: { type: "array", items: { type: "string" } }
            }
          },
          ...workspaceConfig,
          tools: []
        }
      },
      {
        id: "compat-claude-check",
        type: "agent",
        runtimeId: "claude",
        position: { x: 480, y: 296 },
        config: {
          label: "2B. Claude Code Check",
          agentName: "claude-code-compat-check",
          prompt:
            "Read the upstream compatibility brief. Return only JSON with keys: runtime, upstreamReceived, contractAccepted, notes. runtime must be claude_code.",
          permissionProfile: "read_only",
          timeoutMs: 600000,
          outputSchema: {
            type: "object",
            required: ["runtime", "upstreamReceived", "contractAccepted", "notes"],
            properties: {
              runtime: { type: "string" },
              upstreamReceived: { type: "boolean" },
              contractAccepted: { type: "boolean" },
              notes: { type: "array", items: { type: "string" } }
            }
          },
          ...workspaceConfig,
          tools: []
        }
      },
      {
        id: "compat-merge",
        type: "summary",
        position: { x: 880, y: 180 },
        config: {
          label: "3. Merge Compatibility Results",
          mode: "structured_merge",
          description: "Merge the Codex and Claude Code compatibility outputs."
        }
      },
      {
        id: "compat-openclaw-verify",
        type: "agent",
        runtimeId: "openclaw",
        position: { x: 1240, y: 180 },
        config: {
          label: "4. OpenClaw Verify",
          openclawAgentId: "main",
          agentName: "openclaw-compat-verifier",
          prompt:
            "Inspect the merged upstream outputs. Return only JSON with keys: passed, checkedRuntimes, missingRuntimes, recommendation.",
          tools: []
        }
      }
    ],
    edges: [
      { id: "compat-e1", source: "compat-openclaw-brief", target: "compat-codex-check", condition: "success" },
      { id: "compat-e2", source: "compat-openclaw-brief", target: "compat-claude-check", condition: "success" },
      { id: "compat-e3", source: "compat-codex-check", target: "compat-merge", condition: "success" },
      { id: "compat-e4", source: "compat-claude-check", target: "compat-merge", condition: "success" },
      { id: "compat-e5", source: "compat-merge", target: "compat-openclaw-verify", condition: "success" }
    ],
    variables: {},
    display: {
      viewport: { x: 0, y: 0, zoom: 0.78 }
    },
    createdAt: now,
    updatedAt: now
  };
}

export function createManagerDrivenHtmlBlueprint(now: string, companyId = "company-hiveward-studio"): BlueprintDefinition {
  return {
    id: "manager-driven-html-blueprint",
    companyId,
    name: "Manager-driven HTML delivery",
    description:
      "A manager coordinates two blueprint slots: news research plus an HTML execution document, then standalone HTML implementation.",
    version: 1,
    nodes: [
      {
        id: "html-manager",
        type: "manager",
        runtimeId: "openclaw",
        position: { x: 80, y: 420 },
        config: {
          label: "HTML Delivery Manager",
          portCount: 2,
          maxHandoffs: 8,
          openclawAgentId: "main",
          agentName: "html-delivery-manager",
          timeoutMs: 600000,
          tools: [],
          instructions:
            "先运行 Slot 1。Slot 1 中，Agent 1 收集具体新闻简报，Agent 2 把新闻简报整理成可执行的 HTML 页面制作说明。然后把 Slot 1 的输出交给 Slot 2。Slot 2 中，Agent 1 根据制作说明写出完整、可直接运行的独立 HTML 页面。Slot 2 完成后即可结束流程。"
        }
      },
      {
        id: "html-manager-slot-1",
        type: "manager_slot",
        position: { x: 480, y: 40 },
        size: { width: 760, height: 380 },
        config: {
          label: "Slot 1",
          managerNodeId: "html-manager",
          slot: 1
        }
      },
      {
        id: "html-manager-slot-1-agent-1",
        type: "agent",
        runtimeId: "openclaw",
        parentId: "html-manager-slot-1",
        position: { x: 76, y: 154 },
        config: {
          label: "1. News Research",
          resultRole: "ignore",
          openclawAgentId: "main",
          agentName: "news-researcher",
          prompt:
            "为后续 HTML 页面收集一份具体新闻简报。根据管理器输入判断主题、受众、地区、时间范围和最终页面目标；如果输入没有指定主题，默认选择面向构建者和运营者的 AI agent 生产力新闻。不要向用户追问，不要留下占位符。请用清晰的中文结构输出，包含：主题、受众、时间范围、来源状态、3 到 5 条可直接用于页面创作的新闻要点、每条新闻为什么重要、适合页面呈现的角度、来源线索、页面核心主张和内容风险。",
          tools: []
        }
      },
      {
        id: "html-manager-slot-1-agent-2",
        type: "agent",
        runtimeId: "openclaw",
        parentId: "html-manager-slot-1",
        position: { x: 424, y: 154 },
        config: {
          label: "2. HTML Execution Doc",
          resultRole: "ignore",
          openclawAgentId: "main",
          agentName: "execution-doc-writer",
          prompt:
            "使用上游新闻简报，写一份可直接交给 HTML 构建者执行的生产说明。不要要求更多上下文，不要出现 [fill in]、lorem ipsum、占位 logo、占位评价或未解决的 placeholder 文本。缺少细节时，请做具体、保守的编辑判断，并在假设中说明。请用中文写成清晰的制作文档，包含：页面标题、核心主张、分区结构、每个区块的真实标题和文案方向、CTA 文案、视觉约束、响应式要求、必须呈现的新闻事实、验收标准和假设。完成后自然交给下一个槽位继续制作页面，不需要输出 JSON。",
          tools: []
        }
      },
      {
        id: "html-manager-slot-2",
        type: "manager_slot",
        position: { x: 480, y: 460 },
        size: { width: 760, height: 320 },
        config: {
          label: "Slot 2",
          managerNodeId: "html-manager",
          slot: 2
        }
      },
      {
        id: "html-manager-slot-2-agent-1",
        type: "agent",
        runtimeId: "openclaw",
        parentId: "html-manager-slot-2",
        position: { x: 264, y: 132 },
        config: {
          label: "3. HTML Builder",
          resultRole: "final",
          openclawAgentId: "main",
          agentName: "html-code-builder",
          prompt:
            "根据管理器 previousResults 中的 Slot 1 制作说明，写出一个完整的独立 HTML 文档，包含 inline CSS 和必要的 inline JavaScript。最终输出应当是可直接在浏览器运行的 HTML，不要包含 [fill in]、lorem ipsum、占位 logo、占位评价或泛泛的括号占位文案。保留新闻驱动的页面主张、真实标题、CTA 文案和制作说明中的具体内容。不需要包成 JSON。",
          tools: []
        }
      },
    ],
    edges: [
      {
        id: "html-manager-to-slot-1",
        source: "html-manager",
        sourceHandle: "manager-out-1",
        target: "html-manager-slot-1",
        targetHandle: "manager-slot-in",
        condition: "success"
      },
      {
        id: "html-slot-1-to-manager",
        source: "html-manager-slot-1",
        sourceHandle: "manager-slot-out",
        target: "html-manager",
        targetHandle: "manager-in-1",
        condition: "success"
      },
      {
        id: "html-manager-to-slot-2",
        source: "html-manager",
        sourceHandle: "manager-out-2",
        target: "html-manager-slot-2",
        targetHandle: "manager-slot-in",
        condition: "success"
      },
      {
        id: "html-slot-2-to-manager",
        source: "html-manager-slot-2",
        sourceHandle: "manager-slot-out",
        target: "html-manager",
        targetHandle: "manager-in-2",
        condition: "success"
      },
      {
        id: "html-slot-1-start",
        source: "html-manager-slot-1",
        sourceHandle: "manager-slot-inner-out",
        target: "html-manager-slot-1-agent-1",
        condition: "success"
      },
      {
        id: "html-slot-1-write-doc",
        source: "html-manager-slot-1-agent-1",
        target: "html-manager-slot-1-agent-2",
        condition: "success"
      },
      {
        id: "html-slot-1-finish",
        source: "html-manager-slot-1-agent-2",
        target: "html-manager-slot-1",
        targetHandle: "manager-slot-inner-in",
        condition: "success"
      },
      {
        id: "html-slot-2-start",
        source: "html-manager-slot-2",
        sourceHandle: "manager-slot-inner-out",
        target: "html-manager-slot-2-agent-1",
        condition: "success"
      },
      {
        id: "html-slot-2-finish",
        source: "html-manager-slot-2-agent-1",
        target: "html-manager-slot-2",
        targetHandle: "manager-slot-inner-in",
        condition: "success"
      }
    ],
    variables: {},
    display: {
      viewport: { x: 18, y: 22, zoom: 0.74 }
    },
    createdAt: now,
    updatedAt: now
  };
}

export function createActiveManagerNewsHtmlChaosBlueprint(
  now: string,
  companyId = "company-hiveward-studio"
): BlueprintDefinition {
  return {
    id: "active-manager-news-html-chaos-blueprint",
    companyId,
    name: "主动分发 Manager 测试机：乱序新闻 HTML",
    description:
      "一个中文压力测试蓝图：端口顺序被故意打乱，manager 必须先读下属职责，再主动把新闻研究、制作说明、HTML 构建和 QA 返工串起来。",
    version: 1,
    nodes: [
      {
        id: "chaos-manager",
        type: "manager",
        runtimeId: "openclaw",
        position: { x: 80, y: 380 },
        config: {
          label: "主动分发 Manager",
          description: "读取下属职责清单，主动选择下一个 slot，而不是按端口顺序执行。",
          portCount: 4,
          maxHandoffs: 10,
          openclawAgentId: "main",
          agentName: "active-dispatch-manager",
          timeoutMs: 600000,
          tools: [],
          instructions:
            [
              "你是 Hiveward 的公司架构 manager。你的任务不是自己写新闻或 HTML，而是根据 delegationRoster 选择应该委派给哪个 slot。",
              "这个蓝图故意把端口顺序打乱：Slot 1 是最终 HTML 构建，Slot 2 是 QA，Slot 3 是新闻研究，Slot 4 是制作说明。",
              "不要机械按 1、2、3、4 执行。你必须先让新闻研究完成，再让制作说明完成，再让 HTML 构建完成，最后让 QA 检查。",
              "如果 QA 输出指出需要返工，优先回到 Slot 1 修复 HTML；如果 QA 输出已经通过或 status 为 complete/completed/pass，则结束流程。",
              "每次只选择一个 slot。只返回 JSON，不要返回 markdown。",
              "可用输出格式：{\"status\":\"continue\",\"nextSlot\":3,\"reason\":\"先收集新闻事实\"} 或 {\"status\":\"complete\",\"reason\":\"QA 已通过\"}。"
            ].join("\n")
        }
      },
      {
        id: "chaos-slot-build",
        type: "manager_slot",
        position: { x: 520, y: 454 },
        size: { width: 640, height: 320 },
        config: {
          label: "Slot 1 - HTML 构建（乱序放在最前）",
          description: "根据新闻简报和制作说明生成最终独立 HTML；若 QA 要求返工，则修复 HTML。",
          managerNodeId: "chaos-manager",
          slot: 1
        }
      },
      {
        id: "chaos-html-builder",
        type: "agent",
        runtimeId: "openclaw",
        parentId: "chaos-slot-build",
        position: { x: 154, y: 142 },
        config: {
          label: "HTML 构建 Agent",
          resultRole: "final",
          openclawAgentId: "main",
          agentName: "html-builder",
          description: "把已核定的新闻研究和制作说明转成完整可运行的单文件 HTML。",
          prompt:
            [
              "你是 HTML 构建 Agent。请根据 manager previousResults 中的新闻研究和制作说明输出完整、可直接保存运行的单文件 HTML。",
              "必须包含 inline CSS 和必要的 inline JavaScript，不要使用外部依赖，不要输出 markdown 代码围栏。",
              "页面主题聚焦“AI agent 和多 agent 工作流进入企业运营”。",
              "验收硬要求：包含 hero、新闻要点、时间线、影响分析、执行建议、source-index 来源索引、risk-notes 风险提示、移动端响应式样式。",
              "如果 previousResults 中有 QA 返工意见，必须逐条修复；否则先产出完整首版。",
              "最终输出必须以 <!doctype html> 开头。"
            ].join("\n"),
          tools: []
        }
      },
      {
        id: "chaos-slot-qa",
        type: "manager_slot",
        position: { x: 1220, y: 454 },
        size: { width: 640, height: 320 },
        config: {
          label: "Slot 2 - QA 检查",
          description: "严格检查最终 HTML，必要时要求回到 Slot 1 返工。",
          managerNodeId: "chaos-manager",
          slot: 2
        }
      },
      {
        id: "chaos-qa-reviewer",
        type: "agent",
        runtimeId: "openclaw",
        parentId: "chaos-slot-qa",
        position: { x: 154, y: 142 },
        config: {
          label: "QA 审查 Agent",
          resultRole: "ignore",
          openclawAgentId: "main",
          agentName: "html-qa-reviewer",
          description: "检查 HTML 是否满足新闻事实、结构、风险提示、来源索引和移动端要求。",
          prompt:
            [
              "你是 QA 审查 Agent。请检查上游 HTML 是否满足验收要求：",
              "1. 以 <!doctype html> 开头；2. 包含 hero、新闻要点、时间线、影响分析、执行建议；",
              "3. 包含 id=\"source-index\" 的来源索引；4. 包含 id=\"risk-notes\" 的风险提示；5. 有移动端响应式 CSS。",
              "如果不通过，返回严格 JSON：{\"status\":\"fail\",\"returnToSlot\":1,\"reason\":\"...\",\"fixes\":[\"...\"]}。",
              "如果通过，返回严格 JSON：{\"status\":\"complete\",\"reason\":\"HTML 已满足测试机验收\",\"deliveryReady\":true}。",
              "不要返回 markdown。"
            ].join("\n"),
          tools: []
        }
      },
      {
        id: "chaos-slot-research",
        type: "manager_slot",
        position: { x: 520, y: 58 },
        size: { width: 640, height: 320 },
        config: {
          label: "Slot 3 - 新闻研究",
          description: "先收集中文新闻简报和可核验线索，这是后续制作说明和 HTML 的事实基础。",
          managerNodeId: "chaos-manager",
          slot: 3
        }
      },
      {
        id: "chaos-news-researcher",
        type: "agent",
        runtimeId: "openclaw",
        parentId: "chaos-slot-research",
        position: { x: 154, y: 142 },
        config: {
          label: "新闻研究 Agent",
          resultRole: "ignore",
          openclawAgentId: "main",
          agentName: "news-researcher-cn",
          description: "收集 AI agent、多 agent 工作流、企业运营自动化相关的中文新闻简报。",
          prompt:
            [
              "你是中文新闻研究 Agent。请为后续 HTML 页面收集一份新闻简报。",
              "如果运行器具备联网或检索能力，优先检索最近的真实新闻；如果不能联网，请明确写出“未联网核验”，并给出可核验的来源线索，不要伪造具体链接。",
              "输出必须包含：主题、受众、时间范围、5 条新闻/趋势线索、每条为什么重要、页面呈现角度、来源线索、事实风险。",
              "请用中文结构化输出，不要输出 JSON。"
            ].join("\n"),
          tools: []
        }
      },
      {
        id: "chaos-slot-spec",
        type: "manager_slot",
        position: { x: 1220, y: 58 },
        size: { width: 640, height: 320 },
        config: {
          label: "Slot 4 - HTML 制作说明",
          description: "把新闻研究整理成可交付给 HTML 构建 Agent 的生产说明。",
          managerNodeId: "chaos-manager",
          slot: 4
        }
      },
      {
        id: "chaos-execution-doc",
        type: "agent",
        runtimeId: "openclaw",
        parentId: "chaos-slot-spec",
        position: { x: 154, y: 142 },
        config: {
          label: "制作说明 Agent",
          resultRole: "ignore",
          openclawAgentId: "main",
          agentName: "html-execution-doc-writer",
          description: "把新闻简报转成完整 HTML 生产说明、信息架构和验收清单。",
          prompt:
            [
              "你是 HTML 制作说明 Agent。请把上游新闻研究整理成可直接交给 HTML 构建 Agent 的生产说明。",
              "必须包含：页面标题、核心主张、目标读者、信息架构、每个区块的真实文案方向、视觉约束、互动要求、来源索引要求、风险提示要求、移动端验收标准。",
              "请明确要求最终 HTML 包含 source-index 和 risk-notes。",
              "不要要求更多上下文，不要使用 placeholder。请用中文输出制作文档，不要输出 JSON。"
            ].join("\n"),
          tools: []
        }
      }
    ],
    edges: [
      { id: "chaos-manager-to-build", source: "chaos-manager", sourceHandle: "manager-out-1", target: "chaos-slot-build", targetHandle: "manager-slot-in", condition: "success" },
      { id: "chaos-build-to-manager", source: "chaos-slot-build", sourceHandle: "manager-slot-out", target: "chaos-manager", targetHandle: "manager-in-1", condition: "success" },
      { id: "chaos-manager-to-qa", source: "chaos-manager", sourceHandle: "manager-out-2", target: "chaos-slot-qa", targetHandle: "manager-slot-in", condition: "success" },
      { id: "chaos-qa-to-manager", source: "chaos-slot-qa", sourceHandle: "manager-slot-out", target: "chaos-manager", targetHandle: "manager-in-2", condition: "success" },
      { id: "chaos-manager-to-research", source: "chaos-manager", sourceHandle: "manager-out-3", target: "chaos-slot-research", targetHandle: "manager-slot-in", condition: "success" },
      { id: "chaos-research-to-manager", source: "chaos-slot-research", sourceHandle: "manager-slot-out", target: "chaos-manager", targetHandle: "manager-in-3", condition: "success" },
      { id: "chaos-manager-to-spec", source: "chaos-manager", sourceHandle: "manager-out-4", target: "chaos-slot-spec", targetHandle: "manager-slot-in", condition: "success" },
      { id: "chaos-spec-to-manager", source: "chaos-slot-spec", sourceHandle: "manager-slot-out", target: "chaos-manager", targetHandle: "manager-in-4", condition: "success" },
      { id: "chaos-build-start", source: "chaos-slot-build", sourceHandle: "manager-slot-inner-out", target: "chaos-html-builder", condition: "success" },
      { id: "chaos-build-finish", source: "chaos-html-builder", target: "chaos-slot-build", targetHandle: "manager-slot-inner-in", condition: "success" },
      { id: "chaos-qa-start", source: "chaos-slot-qa", sourceHandle: "manager-slot-inner-out", target: "chaos-qa-reviewer", condition: "success" },
      { id: "chaos-qa-finish", source: "chaos-qa-reviewer", target: "chaos-slot-qa", targetHandle: "manager-slot-inner-in", condition: "success" },
      { id: "chaos-research-start", source: "chaos-slot-research", sourceHandle: "manager-slot-inner-out", target: "chaos-news-researcher", condition: "success" },
      { id: "chaos-research-finish", source: "chaos-news-researcher", target: "chaos-slot-research", targetHandle: "manager-slot-inner-in", condition: "success" },
      { id: "chaos-spec-start", source: "chaos-slot-spec", sourceHandle: "manager-slot-inner-out", target: "chaos-execution-doc", condition: "success" },
      { id: "chaos-spec-finish", source: "chaos-execution-doc", target: "chaos-slot-spec", targetHandle: "manager-slot-inner-in", condition: "success" }
    ],
    variables: {},
    display: {
      viewport: { x: -18, y: 14, zoom: 0.62 }
    },
    createdAt: now,
    updatedAt: now
  };
}

export function createActiveManagerRemotionVideoChaosBlueprint(
  now: string,
  companyId = "company-hiveward-studio"
): BlueprintDefinition {
  return {
    id: "active-manager-remotion-video-chaos-blueprint",
    companyId,
    name: "主动分发 Manager 测试机：乱序 Remotion 视频",
    description:
      "一个中文 Remotion 视频生产测试蓝图：端口顺序被故意打乱，manager 必须主动安排研究、脚本、技术规划、Remotion 构建和严格 QA，并在不合格时回退返工。",
    version: 1,
    nodes: [
      {
        id: "remotion-manager",
        type: "manager",
        runtimeId: "openclaw",
        position: { x: 80, y: 420 },
        config: {
          label: "Remotion 主动分发 Manager",
          description: "读取 Remotion 视频团队职责，主动选择下一步，并根据 QA 结果回退返工。",
          portCount: 5,
          maxHandoffs: 14,
          openclawAgentId: "main",
          agentName: "remotion-dispatch-manager",
          timeoutMs: 600000,
          tools: [],
          instructions:
            [
              "你是 Hiveward 的 Remotion 视频制作 manager。你只负责选择下一步委派，不要自己写完整代码或审查报告。",
              "这个蓝图故意打乱端口顺序：Slot 1 是 Remotion 构建，Slot 2 是严格 QA，Slot 3 是新闻/主题研究，Slot 4 是视频脚本与分镜，Slot 5 是 Remotion 技术规划。",
              "正确基础路线应该是 Slot 3 -> Slot 4 -> Slot 5 -> Slot 1 -> Slot 2。",
              "如果 QA 输出 status 为 fail、needs_revision、retry、rework，或包含 returnToSlot/nextSlot，则优先按 QA 意见回退，通常回到 Slot 1 修复 Remotion 代码。",
              "如果 QA 输出 status 为 complete/completed/pass/approved，或者明确 deliveryReady 为 true，则结束流程。",
              "每次只选择一个 slot。只返回 JSON，不要返回 markdown。",
              "示例：{\"status\":\"continue\",\"nextSlot\":3,\"reason\":\"先收集视频主题事实\"} 或 {\"status\":\"complete\",\"reason\":\"QA 已通过\"}。"
            ].join("\n")
        }
      },
      {
        id: "remotion-slot-build",
        type: "manager_slot",
        position: { x: 520, y: 490 },
        size: { width: 680, height: 340 },
        config: {
          label: "Slot 1 - Remotion 构建（故意放在最前）",
          description: "根据研究、分镜和技术规划产出 Remotion Composition 源码包；QA 不通过时负责返工。",
          managerNodeId: "remotion-manager",
          slot: 1
        }
      },
      {
        id: "remotion-code-builder",
        type: "agent",
        runtimeId: "openclaw",
        parentId: "remotion-slot-build",
        position: { x: 142, y: 152 },
        config: {
          label: "Remotion 构建 Agent",
          resultRole: "final",
          openclawAgentId: "main",
          agentName: "remotion-code-builder",
          description: "产出可落地的 Remotion React Composition 源码包，并按 QA 意见返工。",
          prompt:
            [
              "你是 Remotion 构建 Agent。请根据 previousResults 中的研究、脚本分镜和技术规划，输出 Remotion 源码包，不要输出 HTML 页面。",
              "输出必须包含文件路径和代码内容，至少包括：src/Root.tsx、src/AgentOpsBrief.tsx、src/remotion-data.ts、package.json 依赖片段或运行命令。",
              "Composition 要求：id 为 AgentOpsBriefVideo，1920x1080，30fps，12 到 18 秒，总帧数明确，使用 React + Remotion API。",
              "必须使用 Remotion 的 Composition、AbsoluteFill、Sequence、interpolate 或 spring 中的至少两类；画面要有 4 个以上镜头/段落。",
              "视频主题：AI agent 和多 agent 工作流进入企业运营。必须包含中文标题、3 个事实/趋势点、风险提示、结尾行动建议。",
              "视觉要求：不是网页落地页，不要生成 <!doctype html>，不要依赖 Tailwind；使用内联 style 或组件内样式。",
              "如果 previousResults 中有 QA 返工意见，必须先列出修复摘要，再输出修复后的完整源码包。",
              "最终输出应能让开发者复制到 Remotion 项目中运行 npx remotion studio 预览。"
            ].join("\n"),
          tools: []
        }
      },
      {
        id: "remotion-slot-qa",
        type: "manager_slot",
        position: { x: 1260, y: 490 },
        size: { width: 680, height: 340 },
        config: {
          label: "Slot 2 - 严格 Remotion QA",
          description: "严格审查 Remotion 源码包，失败时要求 manager 回退到 Slot 1。",
          managerNodeId: "remotion-manager",
          slot: 2
        }
      },
      {
        id: "remotion-qa-reviewer",
        type: "agent",
        runtimeId: "openclaw",
        parentId: "remotion-slot-qa",
        position: { x: 142, y: 152 },
        config: {
          label: "Remotion QA Agent",
          resultRole: "ignore",
          openclawAgentId: "main",
          agentName: "remotion-qa-reviewer",
          description: "检查 Remotion 产物是否真的可运行、符合镜头/时长/组件/API/非 HTML 要求。",
          prompt:
            [
              "你是严格 Remotion QA Agent。请审查上游 Remotion 源码包。",
              "必须检查：1. 不是 HTML 页面；2. 包含 src/Root.tsx 和 Composition；3. Composition id 为 AgentOpsBriefVideo；4. 1920x1080、30fps、12-18 秒；",
              "5. 使用 AbsoluteFill 和 Sequence；6. 使用 interpolate 或 spring；7. 至少 4 个镜头/段落；8. 有中文标题、趋势点、风险提示、行动建议；",
              "9. 没有 lorem ipsum、placeholder、外部不可控图片依赖；10. 给出 npx remotion studio 或 still 的验证命令。",
              "如果不通过，返回严格 JSON：{\"status\":\"fail\",\"returnToSlot\":1,\"reason\":\"...\",\"fixes\":[\"...\"]}。",
              "如果通过，返回严格 JSON：{\"status\":\"complete\",\"reason\":\"Remotion 产物已通过严格审查\",\"deliveryReady\":true}。",
              "不要返回 markdown。"
            ].join("\n"),
          tools: []
        }
      },
      {
        id: "remotion-slot-research",
        type: "manager_slot",
        position: { x: 520, y: 58 },
        size: { width: 680, height: 340 },
        config: {
          label: "Slot 3 - 视频主题研究",
          description: "先收集适合视频表达的 AI agent 企业运营主题事实、趋势和风险线索。",
          managerNodeId: "remotion-manager",
          slot: 3
        }
      },
      {
        id: "remotion-researcher",
        type: "agent",
        runtimeId: "openclaw",
        parentId: "remotion-slot-research",
        position: { x: 142, y: 152 },
        config: {
          label: "视频研究 Agent",
          resultRole: "ignore",
          openclawAgentId: "main",
          agentName: "remotion-video-researcher",
          description: "为 Remotion 视频收集中文主题事实、叙事角度、风险和素材线索。",
          prompt:
            [
              "你是中文视频研究 Agent。请为一个 12-18 秒 Remotion 短视频收集主题材料。",
              "主题聚焦 AI agent、多 agent 协同和企业运营自动化。若不能联网，请明确写出未联网核验，并给出可核验的来源方向，不要伪造具体链接。",
              "输出必须包含：视频目标受众、核心观点、3-5 个事实/趋势点、每个点的画面隐喻、风险提示、可视化素材建议、不可声称的内容。",
              "用中文结构化输出，不要输出 JSON。"
            ].join("\n"),
          tools: []
        }
      },
      {
        id: "remotion-slot-storyboard",
        type: "manager_slot",
        position: { x: 1260, y: 58 },
        size: { width: 680, height: 340 },
        config: {
          label: "Slot 4 - 视频脚本与分镜",
          description: "把研究材料变成可执行的 Remotion 分镜、旁白和节奏表。",
          managerNodeId: "remotion-manager",
          slot: 4
        }
      },
      {
        id: "remotion-storyboard-writer",
        type: "agent",
        runtimeId: "openclaw",
        parentId: "remotion-slot-storyboard",
        position: { x: 142, y: 152 },
        config: {
          label: "脚本分镜 Agent",
          resultRole: "ignore",
          openclawAgentId: "main",
          agentName: "remotion-storyboard-writer",
          description: "写出 12-18 秒短视频的镜头表、字幕、动效节奏和画面重点。",
          prompt:
            [
              "你是视频脚本与分镜 Agent。请基于上游研究输出一个 Remotion 可执行分镜。",
              "必须包含：总时长、fps、镜头序列、每个镜头的帧范围、画面构图、字幕文本、动效建议、色彩/字体建议、转场节奏。",
              "至少 4 个镜头，不能写成网页结构。字幕必须是中文，文案要短而有节奏。",
              "请给 Remotion 构建 Agent 明确的 props/data 结构建议。不要输出 JSON。"
            ].join("\n"),
          tools: []
        }
      },
      {
        id: "remotion-slot-tech-plan",
        type: "manager_slot",
        position: { x: 2000, y: 58 },
        size: { width: 680, height: 340 },
        config: {
          label: "Slot 5 - Remotion 技术规划",
          description: "把分镜翻译成 Remotion 组件结构、时序、动画 API 和验收命令。",
          managerNodeId: "remotion-manager",
          slot: 5
        }
      },
      {
        id: "remotion-tech-planner",
        type: "agent",
        runtimeId: "openclaw",
        parentId: "remotion-slot-tech-plan",
        position: { x: 142, y: 152 },
        config: {
          label: "Remotion 技术规划 Agent",
          resultRole: "ignore",
          openclawAgentId: "main",
          agentName: "remotion-tech-planner",
          description: "设计 Remotion 文件结构、Composition 元数据、Sequence 时序和动画实现约束。",
          prompt:
            [
              "你是 Remotion 技术规划 Agent。请把上游分镜转成 Remotion 实现计划。",
              "必须明确：文件结构、Composition id、width、height、fps、durationInFrames、props/data shape、每个 Sequence 的 from/durationInFrames。",
              "必须要求使用 AbsoluteFill、Sequence、interpolate 或 spring；避免 Tailwind 和外部图片依赖。",
              "必须给出 QA 可执行的检查点和建议命令：npx remotion studio、npx remotion still AgentOpsBriefVideo --frame=30 --scale=0.25。",
              "用中文输出技术规划，不要输出 JSON。"
            ].join("\n"),
          tools: []
        }
      }
    ],
    edges: [
      { id: "remotion-manager-to-build", source: "remotion-manager", sourceHandle: "manager-out-1", target: "remotion-slot-build", targetHandle: "manager-slot-in", condition: "success" },
      { id: "remotion-build-to-manager", source: "remotion-slot-build", sourceHandle: "manager-slot-out", target: "remotion-manager", targetHandle: "manager-in-1", condition: "success" },
      { id: "remotion-manager-to-qa", source: "remotion-manager", sourceHandle: "manager-out-2", target: "remotion-slot-qa", targetHandle: "manager-slot-in", condition: "success" },
      { id: "remotion-qa-to-manager", source: "remotion-slot-qa", sourceHandle: "manager-slot-out", target: "remotion-manager", targetHandle: "manager-in-2", condition: "success" },
      { id: "remotion-manager-to-research", source: "remotion-manager", sourceHandle: "manager-out-3", target: "remotion-slot-research", targetHandle: "manager-slot-in", condition: "success" },
      { id: "remotion-research-to-manager", source: "remotion-slot-research", sourceHandle: "manager-slot-out", target: "remotion-manager", targetHandle: "manager-in-3", condition: "success" },
      { id: "remotion-manager-to-storyboard", source: "remotion-manager", sourceHandle: "manager-out-4", target: "remotion-slot-storyboard", targetHandle: "manager-slot-in", condition: "success" },
      { id: "remotion-storyboard-to-manager", source: "remotion-slot-storyboard", sourceHandle: "manager-slot-out", target: "remotion-manager", targetHandle: "manager-in-4", condition: "success" },
      { id: "remotion-manager-to-tech-plan", source: "remotion-manager", sourceHandle: "manager-out-5", target: "remotion-slot-tech-plan", targetHandle: "manager-slot-in", condition: "success" },
      { id: "remotion-tech-plan-to-manager", source: "remotion-slot-tech-plan", sourceHandle: "manager-slot-out", target: "remotion-manager", targetHandle: "manager-in-5", condition: "success" },
      { id: "remotion-build-start", source: "remotion-slot-build", sourceHandle: "manager-slot-inner-out", target: "remotion-code-builder", condition: "success" },
      { id: "remotion-build-finish", source: "remotion-code-builder", target: "remotion-slot-build", targetHandle: "manager-slot-inner-in", condition: "success" },
      { id: "remotion-qa-start", source: "remotion-slot-qa", sourceHandle: "manager-slot-inner-out", target: "remotion-qa-reviewer", condition: "success" },
      { id: "remotion-qa-finish", source: "remotion-qa-reviewer", target: "remotion-slot-qa", targetHandle: "manager-slot-inner-in", condition: "success" },
      { id: "remotion-research-start", source: "remotion-slot-research", sourceHandle: "manager-slot-inner-out", target: "remotion-researcher", condition: "success" },
      { id: "remotion-research-finish", source: "remotion-researcher", target: "remotion-slot-research", targetHandle: "manager-slot-inner-in", condition: "success" },
      { id: "remotion-storyboard-start", source: "remotion-slot-storyboard", sourceHandle: "manager-slot-inner-out", target: "remotion-storyboard-writer", condition: "success" },
      { id: "remotion-storyboard-finish", source: "remotion-storyboard-writer", target: "remotion-slot-storyboard", targetHandle: "manager-slot-inner-in", condition: "success" },
      { id: "remotion-tech-plan-start", source: "remotion-slot-tech-plan", sourceHandle: "manager-slot-inner-out", target: "remotion-tech-planner", condition: "success" },
      { id: "remotion-tech-plan-finish", source: "remotion-tech-planner", target: "remotion-slot-tech-plan", targetHandle: "manager-slot-inner-in", condition: "success" }
    ],
    variables: {},
    display: {
      viewport: { x: -54, y: 8, zoom: 0.54 }
    },
    createdAt: now,
    updatedAt: now
  };
}

export function createDefaultBlueprints(
  now: string,
  companyId = "company-hiveward-studio",
  workingDirectory = ""
): BlueprintDefinition[] {
  return [
    createStarterBlueprint(now, companyId),
    createRealThreeAgentBlueprint(now, companyId),
    createMultiAgentCompatibilityBlueprint(now, companyId, workingDirectory),
    createManagerDrivenHtmlBlueprint(now, companyId),
    createActiveManagerNewsHtmlChaosBlueprint(now, companyId),
    createActiveManagerRemotionVideoChaosBlueprint(now, companyId)
  ];
}

export function createBlankBlueprint({
  id,
  now,
  companyId = "company-hiveward-studio",
  name,
  description
}: {
  id: string;
  now: string;
  companyId?: string;
  name?: string;
  description?: string;
}): BlueprintDefinition {
  return {
    id,
    companyId,
    name: normalizeBlueprintText(name, "Untitled blueprint"),
    description: normalizeBlueprintText(description, "Start with an empty command canvas and add Hiveward blueprint nodes."),
    version: 1,
    nodes: [],
    edges: [],
    variables: {},
    display: {
      viewport: { x: 0, y: 0, zoom: 1 }
    },
    createdAt: now,
    updatedAt: now
  };
}

export function createPortableBlueprintPackage(
  blueprints: BlueprintDefinition[],
  exportedAt: string
): PortableBlueprintPackage {
  return {
    schema: portableBlueprintPackageSchema,
    exportedAt,
    blueprints: blueprints.map(toPortableBlueprintDefinition)
  };
}

export function toPortableBlueprintDefinition(blueprint: BlueprintDefinition): PortableBlueprintDefinition {
  return {
    id: blueprint.id,
    name: blueprint.name,
    description: blueprint.description,
    version: blueprint.version,
    nodes: blueprint.nodes.map(toPortableBlueprintNode),
    edges: blueprint.edges.map((edge) => ({ ...edge })),
    variables: { ...blueprint.variables },
    display: {
      viewport: blueprint.display.viewport ? { ...blueprint.display.viewport } : undefined
    }
  };
}

export function readPortableBlueprintPackage(value: unknown): PortableBlueprintPackage {
  if (!isRecord(value)) {
    throw new Error("Blueprint package must be a JSON object.");
  }
  if (value.schema !== portableBlueprintPackageSchema) {
    throw new Error(`Unsupported blueprint package schema: ${String(value.schema ?? "missing")}`);
  }
  if (!Array.isArray(value.blueprints) || value.blueprints.length === 0) {
    throw new Error("Blueprint package does not contain any blueprints.");
  }

  return {
    schema: portableBlueprintPackageSchema,
    exportedAt: readRequiredString(value.exportedAt, "exportedAt"),
    blueprints: value.blueprints.map(readPortableBlueprintDefinition)
  };
}

export function hydrateImportedBlueprint(
  portableBlueprint: PortableBlueprintDefinition,
  options: {
    id: string;
    companyId: string;
    now: string;
    defaults?: BlueprintImportDefaults;
    name?: string;
  }
): BlueprintDefinition {
  return {
    id: options.id,
    companyId: options.companyId,
    name: normalizeBlueprintText(options.name ?? portableBlueprint.name, "Imported blueprint"),
    description: portableBlueprint.description,
    version: 1,
    nodes: portableBlueprint.nodes.map((node) => applyImportDefaultsToNode(toPortableBlueprintNode(node), options.defaults)),
    edges: portableBlueprint.edges.map((edge) => ({ ...edge })),
    variables: { ...portableBlueprint.variables },
    display: {
      viewport: portableBlueprint.display.viewport ? { ...portableBlueprint.display.viewport } : { x: 0, y: 0, zoom: 1 }
    },
    createdAt: options.now,
    updatedAt: options.now
  };
}

function normalizeBlueprintText(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : fallback;
}

function toPortableBlueprintNode(node: BlueprintNode): BlueprintNode {
  return {
    ...node,
    position: { ...node.position },
    size: node.size ? { ...node.size } : undefined,
    config: toPortableBlueprintNodeConfig(node.type, node.config)
  };
}

function toPortableBlueprintNodeConfig(type: BlueprintNodeType, config: BlueprintNodeConfig): BlueprintNodeConfig {
  if (isAgentBlueprintNodeType(type)) {
    const agentConfig = config as AgentNodeConfig;
    return {
      label: agentConfig.label,
      description: agentConfig.description,
      resultRole: agentConfig.resultRole,
      agentName: agentConfig.agentName,
      prompt: agentConfig.prompt,
      permissionProfile: agentConfig.permissionProfile,
      timeoutMs: agentConfig.timeoutMs,
      outputSchema: cloneJsonObject(agentConfig.outputSchema),
      tools: []
    };
  }
  if (type === "parallel_agents") {
    const parallelConfig = config as ParallelAgentsNodeConfig;
    return {
      label: parallelConfig.label,
      description: parallelConfig.description,
      resultRole: parallelConfig.resultRole,
      agents: parallelConfig.agents.map((agent) => toPortableBlueprintNodeConfig("agent", agent) as AgentNodeConfig),
      waitFor: parallelConfig.waitFor
    };
  }
  if (type === "summary") {
    const summaryConfig = config as SummaryNodeConfig;
    return {
      label: summaryConfig.label,
      description: summaryConfig.description,
      resultRole: summaryConfig.resultRole,
      mode: summaryConfig.mode,
      prompt: summaryConfig.prompt
    };
  }
  if (type === "send") {
    const sendConfig = config as SendNodeConfig;
    return {
      label: sendConfig.label,
      description: sendConfig.description,
      resultRole: sendConfig.resultRole,
      channelId: "",
      target: "",
      bodyTemplate: sendConfig.bodyTemplate
    };
  }
  return { ...config };
}

function cloneJsonObject(value: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  return value ? JSON.parse(JSON.stringify(value)) as Record<string, unknown> : undefined;
}

function applyImportDefaultsToNode(node: BlueprintNode, defaults: BlueprintImportDefaults = {}): BlueprintNode {
  return {
    ...node,
    disabled: node.type === "send" ? true : node.disabled,
    config: applyImportDefaultsToConfig(node.type, node.config, defaults)
  };
}

function applyImportDefaultsToConfig(
  type: BlueprintNodeType,
  config: BlueprintNodeConfig,
  defaults: BlueprintImportDefaults
): BlueprintNodeConfig {
  if (isAgentBlueprintNodeType(type)) {
    const agentConfig = config as AgentNodeConfig;
    return {
      ...agentConfig,
      openclawAgentId: defaults.openclawAgentId ?? "main",
      modelId: defaults.modelId,
      tools: []
    };
  }
  if (type === "parallel_agents") {
    const parallelConfig = config as ParallelAgentsNodeConfig;
    return {
      ...parallelConfig,
      agents: parallelConfig.agents.map((agent) => applyImportDefaultsToConfig("agent", agent, defaults) as AgentNodeConfig)
    };
  }
  if (type === "summary") {
    const summaryConfig = config as SummaryNodeConfig;
    return {
      ...summaryConfig,
      modelId: summaryConfig.mode === "openclaw_summary_agent" ? defaults.modelId : undefined
    };
  }
  if (type === "send") {
    const sendConfig = config as SendNodeConfig;
    return {
      ...sendConfig,
      channelId: defaults.channelId ?? "",
      target: ""
    };
  }
  return config;
}

function readPortableBlueprintDefinition(value: unknown): PortableBlueprintDefinition {
  if (!isRecord(value)) {
    throw new Error("Blueprint entry must be an object.");
  }
  const display = isRecord(value.display) ? value.display : {};
  const viewport = isRecord(display.viewport)
    ? {
        x: readNumber(display.viewport.x, 0),
        y: readNumber(display.viewport.y, 0),
        zoom: readNumber(display.viewport.zoom, 1)
      }
    : undefined;

  return {
    id: readRequiredString(value.id, "blueprint.id"),
    name: readRequiredString(value.name, "blueprint.name"),
    description: readOptionalString(value.description),
    version: readNumber(value.version, 1),
    nodes: readArray(value.nodes, "blueprint.nodes") as BlueprintNode[],
    edges: readArray(value.edges, "blueprint.edges") as BlueprintEdge[],
    variables: isRecord(value.variables) ? readStringRecord(value.variables) : {},
    display: {
      viewport
    }
  };
}

function readArray(value: unknown, fieldName: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be an array.`);
  }
  return value;
}

function readRequiredString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${fieldName} must be a non-empty string.`);
  }
  return value.trim();
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readStringRecord(value: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, item]) => (typeof item === "string" ? [[key, item]] : []))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
