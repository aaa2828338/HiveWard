import type { AgentPermissionProfile, OpenClawObjectRef, OpenClawObjectSource, OpenClawUsageFact } from "./openclaw";

export type AgentMissionNodeType =
  | "openclaw_agent"
  | "codex_agent"
  | "claude_code_agent";

export type MissionNodeType =
  | AgentMissionNodeType
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

export type MissionRunStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "waiting_approval";

export type MissionNodeRunStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "skipped"
  | "waiting_approval";

export interface CanvasPosition {
  x: number;
  y: number;
}

export interface CanvasSize {
  width: number;
  height: number;
}

export interface MissionNodeBaseConfig {
  label: string;
  description?: string;
}

export interface AgentNodeConfig extends MissionNodeBaseConfig {
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

export interface ParallelAgentsNodeConfig extends MissionNodeBaseConfig {
  agents: AgentNodeConfig[];
  waitFor: "all" | "first_success";
}

export interface ManagerNodeConfig extends MissionNodeBaseConfig {
  portCount: number;
  maxHandoffs: number;
  instructions?: string;
}

export interface ManagerSlotNodeConfig extends MissionNodeBaseConfig {
  managerNodeId: string;
  slot: number;
}

export interface LoopNodeConfig extends MissionNodeBaseConfig {
  maxIterations: number;
}

export interface ConditionNodeConfig extends MissionNodeBaseConfig {
  expression: string;
}

export interface SummaryNodeConfig extends MissionNodeBaseConfig {
  mode: "structured_merge" | "openclaw_agent";
  prompt?: string;
  modelId?: string;
}

export interface ApprovalNodeConfig extends MissionNodeBaseConfig {
  approverHint?: string;
  instructions?: string;
}

export interface SendNodeConfig extends MissionNodeBaseConfig {
  channelId: string;
  target: string;
  bodyTemplate: string;
}

export interface NoteNodeConfig extends MissionNodeBaseConfig {
  body: string;
}

export interface GroupNodeConfig extends MissionNodeBaseConfig {
  color: string;
}

export type MissionNodeConfig =
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

export function isAgentMissionNodeType(type: MissionNodeType): type is AgentMissionNodeType {
  return type === "openclaw_agent" || type === "codex_agent" || type === "claude_code_agent";
}

export function resolveAgentNodeSource(type: AgentMissionNodeType): OpenClawObjectSource {
  if (type === "codex_agent") return "codex";
  if (type === "claude_code_agent") return "claude";
  return "openclaw";
}

export interface MissionNode {
  id: string;
  type: MissionNodeType;
  position: CanvasPosition;
  size?: CanvasSize;
  config: MissionNodeConfig;
  parentId?: string;
  disabled?: boolean;
}

export interface MissionEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  label?: string;
  condition?: "true" | "false" | "success" | "failure";
}

export interface MissionDefinition {
  id: string;
  companyId: string;
  name: string;
  description?: string;
  version: number;
  nodes: MissionNode[];
  edges: MissionEdge[];
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

export const portableMissionPackageSchema = "hiveward.mission-package/v1";

export type PortableMissionDefinition = Pick<
  MissionDefinition,
  "id" | "name" | "description" | "version" | "nodes" | "edges" | "variables" | "display"
>;

export interface PortableMissionPackage {
  schema: typeof portableMissionPackageSchema;
  exportedAt: string;
  missions: PortableMissionDefinition[];
}

export interface MissionImportDefaults {
  agentId?: string;
  modelId?: string;
  channelId?: string;
}

export interface MissionRun {
  id: string;
  companyId: string;
  missionId: string;
  missionVersion: number;
  status: MissionRunStatus;
  startedBy: string;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  openclawRefs: OpenClawObjectRef[];
}

export interface MissionNodeRun {
  id: string;
  missionRunId: string;
  missionId: string;
  nodeId: string;
  nodeLabel: string;
  nodeType: MissionNodeType;
  status: MissionNodeRunStatus;
  queuedAt: string;
  startedAt?: string;
  endedAt?: string;
  output?: unknown;
  error?: string;
  usage?: OpenClawUsageFact;
  openclawRef?: OpenClawObjectRef;
}

export interface MissionNodeEvent {
  id: string;
  missionRunId: string;
  nodeRunId?: string;
  type:
    | "mission.run.started"
    | "node.run.queued"
    | "node.run.started"
    | "node.run.waiting_approval"
    | "node.run.completed"
    | "node.run.failed"
    | "node.run.cancelled"
    | "mission.run.completed"
    | "mission.run.failed";
  message: string;
  createdAt: string;
  openclawRef?: OpenClawObjectRef;
}

export interface MissionRunView {
  run: MissionRun;
  nodeRuns: MissionNodeRun[];
  events: MissionNodeEvent[];
}

export function createStarterMission(now: string, companyId = "company-hiveward-studio"): MissionDefinition {
  return {
    id: "starter-mission",
    companyId,
    name: "Multi-agent delivery review",
    description:
      "A governed Hiveward mission for requirements, architecture, test review, approval, and delivery through full agent harnesses.",
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
          bodyTemplate: "Mission {{mission.name}} completed. Summary: {{summary}}"
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

export function createRealThreeAgentMission(now: string, companyId = "company-hiveward-studio"): MissionDefinition {
  return {
    id: "real-three-agent-mission",
    companyId,
    name: "Real 3-node OpenClaw agent chain",
    description:
      "A minimal executable Hiveward mission that calls the real OpenClaw agent configured as main. Each node receives upstream output from the previous node.",
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

export function createMultiAgentCompatibilityMission(
  now: string,
  companyId = "company-hiveward-studio",
  workingDirectory = ""
): MissionDefinition {
  const workspaceConfig = workingDirectory ? { workingDirectory } : {};

  return {
    id: "multi-agent-compatibility-mission",
    companyId,
    name: "Multi-agent compatibility smoke test",
    description:
      "A focused mission that validates OpenClaw, Codex, and Claude Code agent nodes through one shared upstream payload and one merged result.",
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
            "Create a concise JSON compatibility brief for this Hiveward mission. Return only JSON with keys: goal, inputContract, expectedNodeTypes, passCriteria.",
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

export function createManagerDrivenHtmlMission(now: string, companyId = "company-hiveward-studio"): MissionDefinition {
  return {
    id: "manager-driven-html-mission",
    companyId,
    name: "Manager-driven HTML delivery",
    description:
      "A manager coordinates three mission slots: inspiration and execution document, HTML implementation, and QA verification.",
    version: 1,
    nodes: [
      {
        id: "html-manager",
        type: "manager",
        position: { x: 80, y: 420 },
        config: {
          label: "HTML Delivery Manager",
          portCount: 3,
          maxHandoffs: 8,
          instructions:
            "Run Slot 1 first to collect inspiration and write an HTML execution document. Send Slot 1 output to Slot 2 to build a runnable HTML page. Send Slot 2 output to Slot 3 for QA. If Slot 3 returns needs_revision or returnToSlot 2, route back to Slot 2. Complete only after Slot 3 returns pass or complete."
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
          label: "1. Inspiration",
          agentId: "main",
          agentName: "inspiration-collector",
          prompt:
            "Use the manager input and project goal to collect practical inspiration for an HTML deliverable. Return strict JSON only with keys: status, audience, inspiration, pageSections, interactionIdeas, constraints. Keep the ideas concrete enough for a writer to turn into an execution document.",
          tools: []
        }
      },
      {
        id: "html-manager-slot-1-agent-2",
        type: "openclaw_agent",
        parentId: "html-manager-slot-1",
        position: { x: 424, y: 154 },
        config: {
          label: "2. Execution Doc",
          agentId: "main",
          agentName: "execution-doc-writer",
          prompt:
            "Use the upstream inspiration to write an HTML-formatted execution document for the builder. Return strict JSON only: {\"status\":\"continue\",\"nextSlot\":2,\"executionDocumentHtml\":\"<section>...</section>\",\"requirements\":[...],\"acceptanceCriteria\":[...]}. The executionDocumentHtml must describe layout, content, interactions, data, and visual constraints.",
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
          agentId: "main",
          agentName: "html-code-builder",
          prompt:
            "Use the manager previousResults to find Slot 1 executionDocumentHtml. Build a complete standalone HTML document with inline CSS and any needed inline JavaScript. Return strict JSON only: {\"status\":\"continue\",\"nextSlot\":3,\"html\":\"<!doctype html>...\",\"buildNotes\":[...]}. The html value must be directly runnable in a browser.",
          tools: []
        }
      },
      {
        id: "html-manager-slot-3",
        type: "manager_slot",
        position: { x: 480, y: 820 },
        size: { width: 760, height: 320 },
        config: {
          label: "Slot 3",
          managerNodeId: "html-manager",
          slot: 3
        }
      },
      {
        id: "html-manager-slot-3-agent-1",
        type: "openclaw_agent",
        parentId: "html-manager-slot-3",
        position: { x: 264, y: 132 },
        config: {
          label: "4. HTML QA",
          agentId: "main",
          agentName: "html-qa-tester",
          prompt:
            "Use the manager previousResults to find Slot 2 html. Verify it is a complete standalone HTML document, has visible body content, can open without external files, and has no obvious display or runtime errors. If it passes, return strict JSON only: {\"status\":\"complete\",\"verified\":true,\"result\":\"passed\",\"checks\":[...]}. If it fails, return strict JSON only: {\"status\":\"needs_revision\",\"returnToSlot\":2,\"verified\":false,\"issues\":[...]}.",
          tools: []
        }
      }
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
        id: "html-manager-to-slot-3",
        source: "html-manager",
        sourceHandle: "manager-out-3",
        target: "html-manager-slot-3",
        targetHandle: "manager-slot-in",
        condition: "success"
      },
      {
        id: "html-slot-3-to-manager",
        source: "html-manager-slot-3",
        sourceHandle: "manager-slot-out",
        target: "html-manager",
        targetHandle: "manager-in-3",
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
      },
      {
        id: "html-slot-3-start",
        source: "html-manager-slot-3",
        sourceHandle: "manager-slot-inner-out",
        target: "html-manager-slot-3-agent-1",
        condition: "success"
      },
      {
        id: "html-slot-3-finish",
        source: "html-manager-slot-3-agent-1",
        target: "html-manager-slot-3",
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

export function createDefaultMissions(
  now: string,
  companyId = "company-hiveward-studio",
  workingDirectory = ""
): MissionDefinition[] {
  return [
    createStarterMission(now, companyId),
    createRealThreeAgentMission(now, companyId),
    createMultiAgentCompatibilityMission(now, companyId, workingDirectory),
    createManagerDrivenHtmlMission(now, companyId)
  ];
}

export function createBlankMission({
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
}): MissionDefinition {
  return {
    id,
    companyId,
    name: normalizeMissionText(name, "Untitled mission"),
    description: normalizeMissionText(description, "Start with an empty command canvas and add Hiveward mission nodes."),
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

export function createPortableMissionPackage(
  missions: MissionDefinition[],
  exportedAt: string
): PortableMissionPackage {
  return {
    schema: portableMissionPackageSchema,
    exportedAt,
    missions: missions.map(toPortableMissionDefinition)
  };
}

export function toPortableMissionDefinition(mission: MissionDefinition): PortableMissionDefinition {
  return {
    id: mission.id,
    name: mission.name,
    description: mission.description,
    version: mission.version,
    nodes: mission.nodes.map(toPortableMissionNode),
    edges: mission.edges.map((edge) => ({ ...edge })),
    variables: { ...mission.variables },
    display: {
      viewport: mission.display.viewport ? { ...mission.display.viewport } : undefined
    }
  };
}

export function readPortableMissionPackage(value: unknown): PortableMissionPackage {
  if (!isRecord(value)) {
    throw new Error("Mission package must be a JSON object.");
  }
  if (value.schema !== portableMissionPackageSchema) {
    throw new Error(`Unsupported mission package schema: ${String(value.schema ?? "missing")}`);
  }
  if (!Array.isArray(value.missions) || value.missions.length === 0) {
    throw new Error("Mission package does not contain any missions.");
  }

  return {
    schema: portableMissionPackageSchema,
    exportedAt: readRequiredString(value.exportedAt, "exportedAt"),
    missions: value.missions.map(readPortableMissionDefinition)
  };
}

export function hydrateImportedMission(
  portableMission: PortableMissionDefinition,
  options: {
    id: string;
    companyId: string;
    now: string;
    defaults?: MissionImportDefaults;
    name?: string;
  }
): MissionDefinition {
  return {
    id: options.id,
    companyId: options.companyId,
    name: normalizeMissionText(options.name ?? portableMission.name, "Imported mission"),
    description: portableMission.description,
    version: 1,
    nodes: portableMission.nodes.map((node) => applyImportDefaultsToNode(toPortableMissionNode(node), options.defaults)),
    edges: portableMission.edges.map((edge) => ({ ...edge })),
    variables: { ...portableMission.variables },
    display: {
      viewport: portableMission.display.viewport ? { ...portableMission.display.viewport } : { x: 0, y: 0, zoom: 1 }
    },
    createdAt: options.now,
    updatedAt: options.now
  };
}

function normalizeMissionText(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : fallback;
}

function toPortableMissionNode(node: MissionNode): MissionNode {
  return {
    ...node,
    position: { ...node.position },
    size: node.size ? { ...node.size } : undefined,
    config: toPortableMissionNodeConfig(node.type, node.config)
  };
}

function toPortableMissionNodeConfig(type: MissionNodeType, config: MissionNodeConfig): MissionNodeConfig {
  if (isAgentMissionNodeType(type)) {
    const agentConfig = config as AgentNodeConfig;
    return {
      label: agentConfig.label,
      description: agentConfig.description,
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
      agents: parallelConfig.agents.map((agent) => toPortableMissionNodeConfig("openclaw_agent", agent) as AgentNodeConfig),
      waitFor: parallelConfig.waitFor
    };
  }
  if (type === "summary") {
    const summaryConfig = config as SummaryNodeConfig;
    return {
      label: summaryConfig.label,
      description: summaryConfig.description,
      mode: summaryConfig.mode,
      prompt: summaryConfig.prompt
    };
  }
  if (type === "send") {
    const sendConfig = config as SendNodeConfig;
    return {
      label: sendConfig.label,
      description: sendConfig.description,
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

function applyImportDefaultsToNode(node: MissionNode, defaults: MissionImportDefaults = {}): MissionNode {
  return {
    ...node,
    disabled: node.type === "send" ? true : node.disabled,
    config: applyImportDefaultsToConfig(node.type, node.config, defaults)
  };
}

function applyImportDefaultsToConfig(
  type: MissionNodeType,
  config: MissionNodeConfig,
  defaults: MissionImportDefaults
): MissionNodeConfig {
  if (isAgentMissionNodeType(type)) {
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

function readPortableMissionDefinition(value: unknown): PortableMissionDefinition {
  if (!isRecord(value)) {
    throw new Error("Mission entry must be an object.");
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
    id: readRequiredString(value.id, "mission.id"),
    name: readRequiredString(value.name, "mission.name"),
    description: readOptionalString(value.description),
    version: readNumber(value.version, 1),
    nodes: readArray(value.nodes, "mission.nodes") as MissionNode[],
    edges: readArray(value.edges, "mission.edges") as MissionEdge[],
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
