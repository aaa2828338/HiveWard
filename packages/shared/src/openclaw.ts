export type OpenClawObjectSource = "openclaw";

export interface OpenClawObjectRef {
  source: OpenClawObjectSource;
  sourceId: string;
  sourceUpdatedAt: string;
  taskId?: string;
  runId?: string;
  sessionKey?: string;
  messageId?: string;
  usageRef?: string;
}

export interface OpenClawModel {
  id: string;
  label: string;
  provider: string;
  supportsTools: boolean;
  contextWindow?: number;
}

export interface OpenClawTool {
  id: string;
  label: string;
  description: string;
  category: string;
}

export interface OpenClawChannel {
  id: string;
  label: string;
  status: "available" | "not_configured" | "disabled";
}

export interface OpenClawAgent {
  id: string;
  label: string;
  workspace?: string;
  runtimeId?: string;
  modelId?: string;
}

export interface OpenClawSessionSummary {
  id: string;
  title: string;
  updatedAt: string;
}

export interface OpenClawTaskSummary {
  id: string;
  title: string;
  status: OpenClawExecutionStatus;
  updatedAt: string;
}

export type OpenClawExecutionStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export interface OpenClawUsageFact {
  id: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  recordedAt: string;
}

export interface StartAgentTaskInput {
  workflowRunId: string;
  nodeRunId: string;
  agentId?: string;
  agentName: string;
  prompt: string;
  modelId?: string;
  input: unknown;
  tools: string[];
}

export interface StartAgentTaskResult {
  taskId: string;
  runId: string;
  sessionKey: string;
  status: OpenClawExecutionStatus;
  output?: string;
  usage?: OpenClawUsageFact;
  updatedAt: string;
}

export interface SendChannelInput {
  channelId: string;
  target: string;
  body: string;
  workflowRunId: string;
  nodeRunId: string;
}

export interface SendChannelResult {
  deliveryId: string;
  status: "sent" | "failed";
  updatedAt: string;
}
