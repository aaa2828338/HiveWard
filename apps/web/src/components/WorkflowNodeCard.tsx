import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import {
  Bot,
  CheckCircle2,
  CircleDashed,
  Clock3,
  GitBranch,
  MessagesSquare,
  Network,
  Repeat2,
  Send,
  ShieldCheck,
  XCircle
} from "lucide-react";
import type { WorkflowNodeRunStatus, WorkflowNodeType } from "@openclaw-cui/shared";

export interface WorkflowNodeCardData extends Record<string, unknown> {
  label: string;
  type: WorkflowNodeType;
  kindLabel: string;
  status?: WorkflowNodeRunStatus;
  statusLabel: string;
  disabled?: boolean;
  managerPortCount?: number;
}

const typeIcon: Record<WorkflowNodeType, typeof Bot> = {
  agent: Bot,
  parallel_agents: MessagesSquare,
  manager: Network,
  loop: Repeat2,
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
  const managerPortCount = clampManagerPortCount(nodeData.managerPortCount);
  const managerSlots = Array.from({ length: managerPortCount }, (_item, index) => index + 1);

  return (
    <div
      className={`workflow-node workflow-node-${nodeData.type} ${selected ? "selected" : ""} ${nodeData.disabled ? "disabled" : ""}`}
      style={nodeData.type === "manager" ? { minHeight: Math.max(138, 92 + managerPortCount * 26) } : undefined}
    >
      {nodeData.type === "manager" ? (
        managerSlots.map((slot, index) => (
          <Handle
            key={`manager-in-${slot}`}
            id={`manager-in-${slot}`}
            className="node-handle manager-slot-handle"
            type="target"
            position={Position.Left}
            style={{ top: managerHandleTop(index, managerPortCount) }}
          />
        ))
      ) : nodeData.type === "loop" ? (
        <Handle className="node-handle loop-input-handle" type="target" position={Position.Right} />
      ) : (
        <Handle className="node-handle" type="target" position={Position.Left} />
      )}
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
      {nodeData.type === "manager" && (
        <div className="manager-port-stack" aria-hidden="true">
          {managerSlots.map((slot) => (
            <span key={slot}>{slot}</span>
          ))}
        </div>
      )}
      {nodeData.type === "manager" ? (
        managerSlots.map((slot, index) => (
          <Handle
            key={`manager-out-${slot}`}
            id={`manager-out-${slot}`}
            className="node-handle manager-slot-handle"
            type="source"
            position={Position.Right}
            style={{ top: managerHandleTop(index, managerPortCount) }}
          />
        ))
      ) : nodeData.type === "loop" ? (
        <Handle className="node-handle loop-output-handle" type="source" position={Position.Left} />
      ) : (
        <Handle className="node-handle" type="source" position={Position.Right} />
      )}
    </div>
  );
});

function clampManagerPortCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 3;
  return Math.min(8, Math.max(1, Math.round(value)));
}

function managerHandleTop(index: number, portCount: number): string {
  if (portCount <= 1) return "72%";
  const first = 58;
  const last = 88;
  return `${first + ((last - first) * index) / (portCount - 1)}%`;
}
