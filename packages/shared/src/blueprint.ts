import type { AgentPermissionProfile, OpenClawObjectRef, OpenClawObjectSource, OpenClawUsageFact } from "./openclaw";

export type AgentBlueprintNodeType =
  | "openclaw_agent"
  | "codex_agent"
  | "claude_code_agent";

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
  agentId?: string;
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
  mode: "structured_merge" | "openclaw_agent";
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
  return type === "openclaw_agent" || type === "codex_agent" || type === "claude_code_agent";
}

export function resolveAgentNodeSource(type: AgentBlueprintNodeType): OpenClawObjectSource {
  if (type === "codex_agent") return "codex";
  if (type === "claude_code_agent") return "claude";
  return "openclaw";
}

export interface BlueprintNode {
  id: string;
  type: BlueprintNodeType;
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
  agentId?: string;
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
    | "blueprint.run.failed";
  message: string;
  createdAt: string;
  openclawRef?: OpenClawObjectRef;
}

export interface BlueprintRunView {
  run: BlueprintRun;
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
  "openclaw_agent",
  "codex_agent",
  "claude_code_agent",
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

  const explicitFinals = indexedCandidates.filter((candidate) => candidate.resultRole === "final");
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

  if (selectedCandidates.length === 0 && !failedNode && !waitingApprovalNode) {
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
    resultProducingNodeTypes.has(nodeType) &&
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
  if (runStatus === "failed" || failedNode) return "failed";
  if (runStatus === "waiting_approval" || waitingApprovalNode) return "waiting_approval";
  return candidates.length > 0 ? "available" : "empty";
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
        type: "openclaw_agent",
        position: { x: 80, y: 120 },
        config: {
          label: "Requirements Agent",
          agentId: "main",
          agentName: "requirements-analyst",
          prompt: "Analyze the requested change and produce crisp acceptance criteria.",
          tools: ["repo.search"]
        }
      },
      {
        id: "architecture",
        type: "openclaw_agent",
        position: { x: 420, y: 36 },
        config: {
          label: "Architecture Agent",
          agentId: "main",
          agentName: "architect",
          prompt: "Check boundaries, data ownership, and integration shape.",
          tools: ["repo.search"]
        }
      },
      {
        id: "tests",
        type: "openclaw_agent",
        position: { x: 420, y: 220 },
        config: {
          label: "Test Agent",
          agentId: "main",
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
        type: "openclaw_agent",
        position: { x: 120, y: 180 },
        config: {
          label: "1. Brief",
          agentId: "main",
          agentName: "main",
          prompt:
            "Summarize the user request in JSON with goal, constraints, and acceptance criteria. Keep it concise.",
          tools: []
        }
      },
      {
        id: "plan",
        type: "openclaw_agent",
        position: { x: 500, y: 180 },
        config: {
          label: "2. Plan",
          agentId: "main",
          agentName: "main",
          prompt:
            "Using the upstream brief, propose exactly three implementation steps and one verification command. Return JSON.",
          tools: []
        }
      },
      {
        id: "verify",
        type: "openclaw_agent",
        position: { x: 880, y: 180 },
        config: {
          label: "3. Verify",
          agentId: "main",
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
        type: "openclaw_agent",
        position: { x: 80, y: 180 },
        config: {
          label: "1. OpenClaw Brief",
          agentId: "main",
          agentName: "openclaw-compat-brief",
          prompt:
            "Create a concise JSON compatibility brief for this Hiveward blueprint. Return only JSON with keys: goal, inputContract, expectedNodeTypes, passCriteria.",
          tools: []
        }
      },
      {
        id: "compat-codex-check",
        type: "codex_agent",
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
        type: "claude_code_agent",
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
        type: "openclaw_agent",
        position: { x: 1240, y: 180 },
        config: {
          label: "4. OpenClaw Verify",
          agentId: "main",
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
        position: { x: 80, y: 420 },
        config: {
          label: "HTML Delivery Manager",
          portCount: 2,
          maxHandoffs: 8,
          instructions:
            "Run Slot 1 first. In Slot 1, Agent 1 collects a concrete news brief and Agent 2 turns that brief into an HTML production execution document. Send Slot 1 output to Slot 2. In Slot 2, Agent 1 writes the final standalone HTML code. Complete when Slot 2 returns status complete with an html field."
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
        type: "openclaw_agent",
        parentId: "html-manager-slot-1",
        position: { x: 76, y: 154 },
        config: {
          label: "1. News Research",
          resultRole: "ignore",
          agentId: "main",
          agentName: "news-researcher",
          prompt:
            "Collect a concrete news brief for an HTML page. Use the manager input to determine the topic, audience, region, timeframe, and output goal. If the input does not specify a topic, default to AI agent productivity news for builders and operators. Do not ask for clarification and do not leave placeholders. Return strict JSON only: {\"status\":\"continue\",\"topic\":\"...\",\"audience\":\"...\",\"timeframe\":\"...\",\"sourceStatus\":\"verified_sources\"|\"needs_source_verification\",\"newsItems\":[{\"headline\":\"...\",\"summary\":\"...\",\"whyItMatters\":\"...\",\"pageAngle\":\"...\",\"sourceHint\":\"...\"}],\"pageThesis\":\"...\",\"contentRisks\":[...]}. Include 3 to 5 newsItems with specific, page-ready angles.",
          tools: []
        }
      },
      {
        id: "html-manager-slot-1-agent-2",
        type: "openclaw_agent",
        parentId: "html-manager-slot-1",
        position: { x: 424, y: 154 },
        config: {
          label: "2. HTML Execution Doc",
          resultRole: "ignore",
          agentId: "main",
          agentName: "execution-doc-writer",
          prompt:
            "Use the upstream news brief to write a production-ready HTML execution document for the builder. Do not ask for more context. Do not include [fill in], lorem ipsum, placeholder logos, placeholder testimonials, or unresolved <em>placeholder</em> text. If a detail is missing, make a concrete conservative editorial choice and record it in assumptions. Return strict JSON only: {\"status\":\"continue\",\"nextSlot\":2,\"executionDocumentHtml\":\"<section>...</section>\",\"pageTitle\":\"...\",\"requirements\":[...],\"acceptanceCriteria\":[...],\"assumptions\":[...]}. The executionDocumentHtml must include the final page thesis, section-by-section copy direction, real headings, CTA copy, visual constraints, responsive behavior, and the exact data from the news brief that the HTML must present.",
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
        type: "openclaw_agent",
        parentId: "html-manager-slot-2",
        position: { x: 264, y: 132 },
        config: {
          label: "3. HTML Builder",
          resultRole: "final",
          agentId: "main",
          agentName: "html-code-builder",
          prompt:
            "Use the manager previousResults to find Slot 1 executionDocumentHtml. Build a complete standalone HTML document with inline CSS and any needed inline JavaScript. Return strict JSON only: {\"status\":\"complete\",\"html\":\"<!doctype html>...\",\"buildNotes\":[...]}. The html value must be directly runnable in a browser and must not contain [fill in], lorem ipsum, placeholder logos, placeholder testimonials, or generic bracketed copy. Preserve the news-driven page thesis, headings, CTA text, and concrete content from the execution document.",
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

export function createDefaultBlueprints(
  now: string,
  companyId = "company-hiveward-studio",
  workingDirectory = ""
): BlueprintDefinition[] {
  return [
    createStarterBlueprint(now, companyId),
    createRealThreeAgentBlueprint(now, companyId),
    createMultiAgentCompatibilityBlueprint(now, companyId, workingDirectory),
    createManagerDrivenHtmlBlueprint(now, companyId)
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
      agents: parallelConfig.agents.map((agent) => toPortableBlueprintNodeConfig("openclaw_agent", agent) as AgentNodeConfig),
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
      agentId: defaults.agentId ?? "main",
      modelId: defaults.modelId,
      tools: []
    };
  }
  if (type === "parallel_agents") {
    const parallelConfig = config as ParallelAgentsNodeConfig;
    return {
      ...parallelConfig,
      agents: parallelConfig.agents.map((agent) => applyImportDefaultsToConfig("openclaw_agent", agent, defaults) as AgentNodeConfig)
    };
  }
  if (type === "summary") {
    const summaryConfig = config as SummaryNodeConfig;
    return {
      ...summaryConfig,
      modelId: summaryConfig.mode === "openclaw_agent" ? defaults.modelId : undefined
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
