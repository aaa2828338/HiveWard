import type { OpenClawObjectRef, OpenClawUsageFact } from "./openclaw";

export type WorkflowNodeType =
  | "agent"
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

export type WorkflowRunStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "waiting_approval";

export type WorkflowNodeRunStatus =
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

export interface WorkflowNodeBaseConfig {
  label: string;
  description?: string;
}

export interface AgentNodeConfig extends WorkflowNodeBaseConfig {
  agentId?: string;
  agentName: string;
  prompt: string;
  modelId?: string;
  tools: string[];
}

export interface ParallelAgentsNodeConfig extends WorkflowNodeBaseConfig {
  agents: AgentNodeConfig[];
  waitFor: "all" | "first_success";
}

export interface ManagerNodeConfig extends WorkflowNodeBaseConfig {
  portCount: number;
  maxHandoffs: number;
  instructions?: string;
}

export interface ManagerSlotNodeConfig extends WorkflowNodeBaseConfig {
  managerNodeId: string;
  slot: number;
}

export interface LoopNodeConfig extends WorkflowNodeBaseConfig {
  maxIterations: number;
}

export interface ConditionNodeConfig extends WorkflowNodeBaseConfig {
  expression: string;
}

export interface SummaryNodeConfig extends WorkflowNodeBaseConfig {
  mode: "structured_merge" | "openclaw_agent";
  prompt?: string;
  modelId?: string;
}

export interface ApprovalNodeConfig extends WorkflowNodeBaseConfig {
  approverHint?: string;
  instructions?: string;
}

export interface SendNodeConfig extends WorkflowNodeBaseConfig {
  channelId: string;
  target: string;
  bodyTemplate: string;
}

export interface NoteNodeConfig extends WorkflowNodeBaseConfig {
  body: string;
}

export interface GroupNodeConfig extends WorkflowNodeBaseConfig {
  color: string;
}

export type WorkflowNodeConfig =
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

export interface WorkflowNode {
  id: string;
  type: WorkflowNodeType;
  position: CanvasPosition;
  size?: CanvasSize;
  config: WorkflowNodeConfig;
  parentId?: string;
  disabled?: boolean;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  label?: string;
  condition?: "true" | "false" | "success" | "failure";
}

export interface WorkflowDefinition {
  id: string;
  companyId: string;
  name: string;
  description?: string;
  version: number;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
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

export interface WorkflowRun {
  id: string;
  companyId: string;
  workflowId: string;
  workflowVersion: number;
  status: WorkflowRunStatus;
  startedBy: string;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  openclawRefs: OpenClawObjectRef[];
}

export interface WorkflowNodeRun {
  id: string;
  workflowRunId: string;
  workflowId: string;
  nodeId: string;
  nodeLabel: string;
  nodeType: WorkflowNodeType;
  status: WorkflowNodeRunStatus;
  queuedAt: string;
  startedAt?: string;
  endedAt?: string;
  output?: unknown;
  error?: string;
  usage?: OpenClawUsageFact;
  openclawRef?: OpenClawObjectRef;
}

export interface WorkflowNodeEvent {
  id: string;
  workflowRunId: string;
  nodeRunId?: string;
  type:
    | "workflow.run.started"
    | "node.run.queued"
    | "node.run.started"
    | "node.run.waiting_approval"
    | "node.run.completed"
    | "node.run.failed"
    | "node.run.cancelled"
    | "workflow.run.completed"
    | "workflow.run.failed";
  message: string;
  createdAt: string;
  openclawRef?: OpenClawObjectRef;
}

export interface WorkflowRunView {
  run: WorkflowRun;
  nodeRuns: WorkflowNodeRun[];
  events: WorkflowNodeEvent[];
}

export function createStarterWorkflow(now: string, companyId = "company-openclaw-studio"): WorkflowDefinition {
  return {
    id: "starter-workflow",
    companyId,
    name: "Multi-agent delivery review",
    description: "A minimal n8n-style OpenClaw workflow for requirements, architecture, test review, approval, and Slack delivery.",
    version: 1,
    nodes: [
      {
        id: "requirements",
        type: "agent",
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
        type: "agent",
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
        type: "agent",
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
          bodyTemplate: "Workflow {{workflow.name}} completed. Summary: {{summary}}"
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

export function createRealThreeAgentWorkflow(now: string, companyId = "company-openclaw-studio"): WorkflowDefinition {
  return {
    id: "real-three-agent-workflow",
    companyId,
    name: "Real 3-node OpenClaw agent chain",
    description:
      "A minimal executable chain that calls the real OpenClaw agent configured as main. Each node receives upstream output from the previous node.",
    version: 1,
    nodes: [
      {
        id: "brief",
        type: "agent",
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
        type: "agent",
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
        type: "agent",
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

export function createManagerDrivenHtmlWorkflow(now: string, companyId = "company-openclaw-studio"): WorkflowDefinition {
  return {
    id: "manager-driven-html-workflow",
    companyId,
    name: "Manager-driven HTML delivery",
    description:
      "A manager orchestrates three slot boxes: inspiration and execution document, HTML implementation, and QA verification.",
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
        type: "agent",
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
        type: "agent",
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
        type: "agent",
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
        type: "agent",
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

export function createDefaultWorkflows(now: string, companyId = "company-openclaw-studio"): WorkflowDefinition[] {
  return [
    createStarterWorkflow(now, companyId),
    createRealThreeAgentWorkflow(now, companyId),
    createManagerDrivenHtmlWorkflow(now, companyId)
  ];
}
