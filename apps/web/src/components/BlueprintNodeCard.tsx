import { memo, useEffect, type CSSProperties } from "react";
import { Handle, NodeResizer, Position, useUpdateNodeInternals, type NodeProps } from "@xyflow/react";
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
import {
  managerSlotInnerInHandleId,
  managerSlotInnerOutHandleId,
  type CanvasSize,
  type BlueprintNodeRunStatus,
  type BlueprintNodeType,
  type ManagerSlotExecutionMode
} from "@hiveward/shared";

export interface BlueprintNodeCardData extends Record<string, unknown> {
  label: string;
  type: BlueprintNodeType;
  kindLabel: string;
  status?: BlueprintNodeRunStatus;
  statusLabel: string;
  disabled?: boolean;
  isStartNode?: boolean;
  managerPortCount?: number;
  managerSlot?: number;
  managerSlotExecutionMode?: ManagerSlotExecutionMode;
  managerSlotLaneCount?: number;
  managerSlotSize?: CanvasSize;
}

const typeIcon: Record<BlueprintNodeType, typeof Bot> = {
  agent: Bot,
  parallel_agents: MessagesSquare,
  manager: Network,
  manager_slot: Network,
  loop: Repeat2,
  condition: GitBranch,
  summary: MessagesSquare,
  approval: ShieldCheck,
  send: Send,
  note: MessagesSquare,
  group: MessagesSquare
};

const managerPortStart = 122;
const managerPortGap = 48;
const managerBlueprintInputTop = 34;
const managerBlueprintOutputTop = 62;
const managerPortLaneOffset = 11;
export const MANAGER_SLOT_DEFAULT_SIZE: CanvasSize = { width: 560, height: 300 };
export const MANAGER_SLOT_MIN_SIZE: CanvasSize = { width: 420, height: 260 };
export const MANAGER_SLOT_FRAME = {
  top: 86,
  side: 28,
  bottom: 28
} as const;

function statusIcon(status?: BlueprintNodeRunStatus) {
  if (status === "succeeded") return CheckCircle2;
  if (status === "failed" || status === "cancelled") return XCircle;
  if (status === "running") return CircleDashed;
  if (status === "waiting_approval") return Clock3;
  return CircleDashed;
}

function statusClass(status?: BlueprintNodeRunStatus) {
  if (status === "succeeded") return "status-success";
  if (status === "failed" || status === "cancelled") return "status-danger";
  if (status === "running") return "status-running";
  if (status === "waiting_approval") return "status-waiting";
  return "status-idle";
}

export const BlueprintNodeCard = memo(function BlueprintNodeCard({ data, id, selected, width, height }: NodeProps) {
  const nodeData = data as BlueprintNodeCardData;
  const updateNodeInternals = useUpdateNodeInternals();
  const TypeIcon = typeIcon[nodeData.type];
  const StatusIcon = statusIcon(nodeData.status);
  const managerPortCount = clampManagerPortCount(nodeData.managerPortCount);
  const managerSlots = Array.from({ length: managerPortCount }, (_item, index) => index + 1);
  const managerSlotLaneCount = clampManagerSlotLaneCount(nodeData.managerSlotLaneCount);
  const managerSlotLanes = Array.from({ length: managerSlotLaneCount }, (_item, index) => index + 1);
  const nodeStyle =
    nodeData.type === "manager"
      ? managerNodeStyle(managerPortCount)
      : nodeData.type === "manager_slot"
        ? managerSlotNodeStyle(nodeData.managerSlotSize, { width, height })
        : undefined;

  useEffect(() => {
    if (nodeData.type !== "manager" && nodeData.type !== "manager_slot") return;
    updateNodeInternals(id);
  }, [
    height,
    id,
    managerPortCount,
    managerSlotLaneCount,
    nodeData.managerSlotSize?.height,
    nodeData.managerSlotSize?.width,
    nodeData.type,
    updateNodeInternals,
    width
  ]);

  return (
    <div
      className={`blueprint-node blueprint-node-${nodeData.type} ${selected ? "selected" : ""} ${nodeData.disabled ? "disabled" : ""}`}
      style={nodeStyle}
    >
      {nodeData.type === "manager_slot" ? (
        <>
          <NodeResizer
            isVisible={selected}
            minWidth={MANAGER_SLOT_MIN_SIZE.width}
            minHeight={MANAGER_SLOT_MIN_SIZE.height}
            handleClassName="manager-slot-resize-handle"
            lineClassName="manager-slot-resize-line"
            color="var(--accent)"
          />
          <Handle
            id="manager-slot-in"
            className="node-handle input-handle manager-slot-box-handle manager-slot-box-external manager-slot-box-external-in"
            type="target"
            position={Position.Left}
            style={{ top: 30 }}
          />
          <Handle
            id="manager-slot-out"
            className="node-handle output-handle manager-slot-box-handle manager-slot-box-external manager-slot-box-external-out"
            type="source"
            position={Position.Left}
            style={{ top: 58 }}
          />
          <Handle
            id={managerSlotInnerOutHandleId(1)}
            className="node-handle output-handle manager-slot-box-handle manager-slot-box-inner manager-slot-box-inner-out"
            type="source"
            position={Position.Right}
            style={managerSlotLaneHandleStyle(1, managerSlotLaneCount, nodeData.managerSlotSize, { width, height }, "out")}
          />
          <Handle
            id={managerSlotInnerInHandleId(1)}
            className="node-handle input-handle manager-slot-box-handle manager-slot-box-inner manager-slot-box-inner-in"
            type="target"
            position={Position.Left}
            style={managerSlotLaneHandleStyle(1, managerSlotLaneCount, nodeData.managerSlotSize, { width, height }, "in")}
          />
          {managerSlotLanes.slice(1).map((lane) => (
            <Handle
              key={`manager-slot-inner-out-${lane}`}
              id={managerSlotInnerOutHandleId(lane)}
              className="node-handle output-handle manager-slot-box-handle manager-slot-box-inner manager-slot-box-inner-out"
              type="source"
              position={Position.Right}
              style={managerSlotLaneHandleStyle(lane, managerSlotLaneCount, nodeData.managerSlotSize, { width, height }, "out")}
            />
          ))}
          {managerSlotLanes.slice(1).map((lane) => (
            <Handle
              key={`manager-slot-inner-in-${lane}`}
              id={managerSlotInnerInHandleId(lane)}
              className="node-handle input-handle manager-slot-box-handle manager-slot-box-inner manager-slot-box-inner-in"
              type="target"
              position={Position.Left}
              style={managerSlotLaneHandleStyle(lane, managerSlotLaneCount, nodeData.managerSlotSize, { width, height }, "in")}
            />
          ))}
        </>
      ) : nodeData.type === "manager" ? (
        <>
          <Handle
            className="node-handle input-handle manager-blueprint-handle manager-blueprint-input-handle"
            type="target"
            position={Position.Left}
            style={{ top: managerBlueprintInputTop }}
          />
          {managerSlots.map((slot, index) => (
            <Handle
              key={`manager-in-${slot}`}
              id={`manager-in-${slot}`}
              className="node-handle input-handle manager-slot-handle manager-slot-input-handle"
              type="target"
              position={Position.Right}
              style={managerHandleStyle(index, "input")}
            />
          ))}
        </>
      ) : nodeData.type === "loop" ? (
        <Handle className="node-handle input-handle loop-input-handle" type="target" position={Position.Right} />
      ) : (
        <Handle className="node-handle input-handle" type="target" position={Position.Left} />
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
      {nodeData.isStartNode && <span className="node-start-badge">Start</span>}
      {nodeData.type === "manager_slot" && (
        <>
          <div className="manager-slot-box-body" aria-hidden="true">
            <span className="manager-slot-box-tag">{`Slot ${nodeData.managerSlot ?? ""}`}</span>
            <span className={`manager-slot-mode-tag manager-slot-mode-${nodeData.managerSlotExecutionMode ?? "manual"}`}>
              {nodeData.managerSlotExecutionMode === "parallel" ? "Parallel" : "Manual"}
            </span>
            <span className="manager-slot-box-wall manager-slot-box-wall-left" />
            <span className="manager-slot-box-wall manager-slot-box-wall-right" />
          </div>
          {managerSlotLanes.map((lane) => (
            <span
              key={`manager-slot-lane-out-label-${lane}`}
              className="manager-slot-lane-label manager-slot-lane-label-out"
              style={managerSlotLaneLabelStyle(lane, managerSlotLaneCount, nodeData.managerSlotSize, { width, height }, "out")}
              aria-hidden="true"
            >
              {lane}
            </span>
          ))}
          {managerSlotLanes.map((lane) => (
            <span
              key={`manager-slot-lane-in-label-${lane}`}
              className="manager-slot-lane-label manager-slot-lane-label-in"
              style={managerSlotLaneLabelStyle(lane, managerSlotLaneCount, nodeData.managerSlotSize, { width, height }, "in")}
              aria-hidden="true"
            >
              {lane}
            </span>
          ))}
        </>
      )}
      {nodeData.type === "manager" && (
        <div className="manager-port-list" aria-hidden="true">
          {managerSlots.map((slot) => (
            <div key={slot} className="manager-port-row">
              <span className="manager-port-index">{slot}</span>
              <span className="manager-port-rule" />
              <span className="manager-port-guide" />
            </div>
          ))}
        </div>
      )}
      {nodeData.type === "manager_slot" ? null : nodeData.type === "manager" ? (
        <>
          <Handle
            className="node-handle output-handle manager-blueprint-handle manager-blueprint-output-handle"
            type="source"
            position={Position.Left}
            style={{ top: managerBlueprintOutputTop }}
          />
          {managerSlots.map((slot, index) => (
            <Handle
              key={`manager-out-${slot}`}
              id={`manager-out-${slot}`}
              className="node-handle output-handle manager-slot-handle manager-slot-output-handle"
              type="source"
              position={Position.Right}
              style={managerHandleStyle(index, "output")}
            />
          ))}
        </>
      ) : nodeData.type === "loop" ? (
        <Handle className="node-handle output-handle loop-output-handle" type="source" position={Position.Left} />
      ) : (
        <Handle className="node-handle output-handle" type="source" position={Position.Right} />
      )}
    </div>
  );
});

function clampManagerPortCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 3;
  return Math.min(8, Math.max(1, Math.round(value)));
}

function clampManagerSlotLaneCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 1;
  return Math.min(16, Math.max(1, Math.round(value)));
}

function managerNodeStyle(portCount: number): CSSProperties {
  return {
    minHeight: managerPortStart + Math.max(0, portCount - 1) * managerPortGap + 40,
    "--manager-port-start": `${managerPortStart}px`,
    "--manager-port-gap": `${managerPortGap}px`
  } as CSSProperties;
}

function managerSlotNodeStyle(size?: CanvasSize, liveSize?: Partial<CanvasSize>): CSSProperties {
  const normalizedWidth = normalizeManagerSlotSizeValue(liveSize?.width ?? size?.width, MANAGER_SLOT_DEFAULT_SIZE.width, MANAGER_SLOT_MIN_SIZE.width);
  const normalizedHeight = normalizeManagerSlotSizeValue(liveSize?.height ?? size?.height, MANAGER_SLOT_DEFAULT_SIZE.height, MANAGER_SLOT_MIN_SIZE.height);
  const innerHandleTop = MANAGER_SLOT_FRAME.top + (normalizedHeight - MANAGER_SLOT_FRAME.top - MANAGER_SLOT_FRAME.bottom) / 2;
  return {
    width: normalizedWidth,
    height: normalizedHeight,
    "--manager-slot-frame-top": `${MANAGER_SLOT_FRAME.top}px`,
    "--manager-slot-frame-side": `${MANAGER_SLOT_FRAME.side}px`,
    "--manager-slot-frame-bottom": `${MANAGER_SLOT_FRAME.bottom}px`,
    "--manager-slot-inner-handle-top": `${innerHandleTop}px`
  } as CSSProperties;
}

function managerSlotLaneHandleStyle(
  lane: number,
  laneCount: number,
  size: CanvasSize | undefined,
  liveSize: Partial<CanvasSize>,
  side: "in" | "out"
): CSSProperties {
  const normalizedHeight = normalizeManagerSlotSizeValue(liveSize.height ?? size?.height, MANAGER_SLOT_DEFAULT_SIZE.height, MANAGER_SLOT_MIN_SIZE.height);
  const availableHeight = Math.max(1, normalizedHeight - MANAGER_SLOT_FRAME.top - MANAGER_SLOT_FRAME.bottom);
  const top = MANAGER_SLOT_FRAME.top + (availableHeight * lane) / (laneCount + 1);
  return {
    top,
    ...(side === "out" ? { left: MANAGER_SLOT_FRAME.side, right: "auto" } : { left: "auto", right: MANAGER_SLOT_FRAME.side })
  };
}

function managerSlotLaneLabelStyle(
  lane: number,
  laneCount: number,
  size: CanvasSize | undefined,
  liveSize: Partial<CanvasSize>,
  side: "in" | "out"
): CSSProperties {
  const normalizedHeight = normalizeManagerSlotSizeValue(liveSize.height ?? size?.height, MANAGER_SLOT_DEFAULT_SIZE.height, MANAGER_SLOT_MIN_SIZE.height);
  const availableHeight = Math.max(1, normalizedHeight - MANAGER_SLOT_FRAME.top - MANAGER_SLOT_FRAME.bottom);
  const laneGap = availableHeight / (laneCount + 1);
  const labelSize = Math.min(16, Math.max(10, Math.floor(laneGap - 1)));
  const top = MANAGER_SLOT_FRAME.top + laneGap * lane;
  return {
    top,
    width: labelSize,
    height: labelSize,
    fontSize: Math.max(6, labelSize * 0.58),
    ...(side === "out" ? { left: Math.max(0, MANAGER_SLOT_FRAME.side - 10 - labelSize) } : { right: Math.max(0, MANAGER_SLOT_FRAME.side - 10 - labelSize) })
  };
}

function normalizeManagerSlotSizeValue(value: unknown, fallback: number, min: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.round(value));
}

function managerHandleStyle(
  index: number,
  lane: "input" | "output"
): CSSProperties {
  return {
    top: `calc(var(--manager-port-start) + ${index * managerPortGap}px ${lane === "input" ? `+ ${managerPortLaneOffset}px` : `- ${managerPortLaneOffset}px`})`,
    right: 0
  };
}
