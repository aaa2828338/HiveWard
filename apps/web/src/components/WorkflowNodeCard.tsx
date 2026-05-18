import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Bot, CheckCircle2, CircleDashed, Clock3, GitBranch, MessagesSquare, Send, ShieldCheck, XCircle } from "lucide-react";
import type { WorkflowNodeRunStatus, WorkflowNodeType } from "@openclaw-cui/shared";

export interface WorkflowNodeCardData extends Record<string, unknown> {
  label: string;
  type: WorkflowNodeType;
  kindLabel: string;
  status?: WorkflowNodeRunStatus;
  statusLabel: string;
  disabled?: boolean;
}

const typeIcon: Record<WorkflowNodeType, typeof Bot> = {
  agent: Bot,
  parallel_agents: MessagesSquare,
  condition: GitBranch,
  summary: MessagesSquare,
  approval: ShieldCheck,
  send: Send,
  note: MessagesSquare,
  group: MessagesSquare
};

function statusIcon(status?: WorkflowNodeRunStatus) {
  if (status === "succeeded") return CheckCircle2;
  if (status === "failed" || status === "cancelled") return XCircle;
  if (status === "running") return CircleDashed;
  if (status === "waiting_approval") return Clock3;
  return CircleDashed;
}

function statusClass(status?: WorkflowNodeRunStatus) {
  if (status === "succeeded") return "status-success";
  if (status === "failed" || status === "cancelled") return "status-danger";
  if (status === "running") return "status-running";
  if (status === "waiting_approval") return "status-waiting";
  return "status-idle";
}

export const WorkflowNodeCard = memo(function WorkflowNodeCard({ data, selected }: NodeProps) {
  const nodeData = data as WorkflowNodeCardData;
  const TypeIcon = typeIcon[nodeData.type];
  const StatusIcon = statusIcon(nodeData.status);

  return (
    <div className={`workflow-node ${selected ? "selected" : ""} ${nodeData.disabled ? "disabled" : ""}`}>
      <Handle className="node-handle" type="target" position={Position.Left} />
      <div className="node-topline">
        <span className={`node-type node-type-${nodeData.type}`}>
          <TypeIcon size={15} />
        </span>
        <span className={`node-status ${statusClass(nodeData.status)}`} title={nodeData.statusLabel}>
          <StatusIcon size={14} />
        </span>
      </div>
      <div className="node-label">{nodeData.label}</div>
      <div className="node-kind">{nodeData.kindLabel}</div>
      <Handle className="node-handle" type="source" position={Position.Right} />
    </div>
  );
});
