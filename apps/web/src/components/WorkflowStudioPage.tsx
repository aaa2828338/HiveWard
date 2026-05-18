import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addEdge,
  applyNodeChanges,
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  type Connection,
  type CoordinateExtent,
  type Edge,
  type EdgeMouseHandler,
  type Node,
  type NodeChange,
  type NodeMouseHandler,
  type OnNodeDrag,
  type OnNodesChange
} from "@xyflow/react";
import { Bot, Check, GitBranch, MessagesSquare, Network, Plus, Repeat2, Send, ShieldCheck, X } from "lucide-react";
import type {
  AgentNodeConfig,
  ApprovalNodeConfig,
  CanvasPosition,
  CanvasSize,
  CatalogSnapshot,
  ConditionNodeConfig,
  LoopNodeConfig,
  ManagerNodeConfig,
  ManagerSlotNodeConfig,
  NoteNodeConfig,
  OpenClawConfiguredAgent,
  ParallelAgentsNodeConfig,
  SendNodeConfig,
  SummaryNodeConfig,
  WorkflowDefinition,
  WorkflowEdge,
  WorkflowNode,
  WorkflowNodeRun,
  WorkflowNodeType,
  WorkflowRunView
} from "@openclaw-cui/shared";
import {
  MANAGER_SLOT_DEFAULT_SIZE,
  MANAGER_SLOT_FRAME,
  MANAGER_SLOT_MIN_SIZE,
  WorkflowNodeCard,
  type WorkflowNodeCardData
} from "./WorkflowNodeCard";
import { type Language, type Messages } from "../lib/i18n";

const nodeTypes = {
  workflowNode: WorkflowNodeCard
};

const palette: Array<{ type: WorkflowNodeType; icon: typeof Plus }> = [
  { type: "agent", icon: Bot },
  { type: "manager", icon: Network },
  { type: "loop", icon: Repeat2 },
  { type: "condition", icon: GitBranch },
  { type: "summary", icon: MessagesSquare },
  { type: "approval", icon: ShieldCheck },
  { type: "send", icon: Send }
];

const managerInHandlePrefix = "manager-in-";
const managerOutHandlePrefix = "manager-out-";
const managerSlotInHandle = "manager-slot-in";
const managerSlotOutHandle = "manager-slot-out";
const managerSlotInnerOutHandle = "manager-slot-inner-out";
const managerSlotInnerInHandle = "manager-slot-inner-in";
const rightButtonDragThreshold = 4;
const defaultChildNodeSize: CanvasSize = { width: 232, height: 108 };

export function WorkflowStudioPage({
  workflow,
  catalog,
  configuredAgents,
  runView,
  selectedNodeId,
  language,
  busy,
  onSelectNode,
  onUpdateWorkflow,
  onApproveRun,
  t
}: {
  workflow?: WorkflowDefinition;
  catalog?: CatalogSnapshot;
  configuredAgents?: OpenClawConfiguredAgent[];
  runView?: WorkflowRunView;
  selectedNodeId?: string;
  language: Language;
  busy: boolean;
  onSelectNode: (nodeId?: string) => void;
  onUpdateWorkflow: (updater: (current: WorkflowDefinition) => WorkflowDefinition) => void;
  onApproveRun: () => void;
  t: Messages;
}) {
  const selectedNode = workflow?.nodes.find((node) => node.id === selectedNodeId);
  const [inspectedNodeId, setInspectedNodeId] = useState<string | undefined>();
  const inspectedNode = workflow?.nodes.find((node) => node.id === inspectedNodeId);
  const [selectedCanvasNodeIds, setSelectedCanvasNodeIds] = useState<string[]>([]);
  const [localNodes, setLocalNodes] = useState<Node<WorkflowNodeCardData>[]>([]);
  const [localEdges, setLocalEdges] = useState<Edge[]>([]);
  const [nodeMenuOpen, setNodeMenuOpen] = useState(false);
  const [nodeMenuAnchor, setNodeMenuAnchor] = useState<{ x: number; y: number }>({ x: 88, y: 252 });
  const [nodeContextMenu, setNodeContextMenu] = useState<{ open: boolean; x: number; y: number; nodeId?: string }>({
    open: false,
    x: 0,
    y: 0,
    nodeId: undefined
  });
  const rightDragStateRef = useRef<{ x: number; y: number; moved: boolean; openedMenu: boolean } | undefined>(undefined);

  const setSelectedCanvasNodeIdsIfChanged = useCallback((nextIds: string[]) => {
    setSelectedCanvasNodeIds((current) => {
      if (current.length === nextIds.length && current.every((item, index) => item === nextIds[index])) {
        return current;
      }
      return nextIds;
    });
  }, []);

  const statusByNode = useMemo(() => {
    const map = new Map<string, WorkflowNodeRun>();
    for (const nodeRun of runView?.nodeRuns ?? []) {
      map.set(nodeRun.nodeId, nodeRun);
    }
    return map;
  }, [runView]);

  useEffect(() => {
    setLocalNodes(buildFlowNodes(workflow, statusByNode, t));
  }, [statusByNode, t, workflow]);

  useEffect(() => {
    setLocalEdges(buildFlowEdges(workflow, runView?.run.status));
  }, [runView?.run.status, workflow]);

  useEffect(() => {
    if (!workflow) return;
    if (hasDuplicateNodeIds(workflow)) {
      onUpdateWorkflow((current) => (current.id === workflow.id ? ensureUniqueWorkflowNodeIds(current) : current));
      return;
    }
    if (!needsManagerSlotSync(workflow)) return;
    onUpdateWorkflow((current) => (current.id === workflow.id ? syncAllManagerSlotBoxes(current) : current));
  }, [onUpdateWorkflow, workflow]);

  const patchNodeConfig = useCallback(
    (nodeId: string, patch: Partial<WorkflowNode["config"]>) => {
      onUpdateWorkflow((current) => {
        const next = {
          ...current,
          nodes: current.nodes.map((node) =>
            node.id === nodeId
              ? {
                  ...node,
                  config: {
                    ...node.config,
                    ...patch
                  } as WorkflowNode["config"]
                }
              : node
          )
        };
        const patchedNode = next.nodes.find((node) => node.id === nodeId);
        return patchedNode?.type === "manager" ? syncManagerSlotBoxes(next, patchedNode) : next;
      });
    },
    [onUpdateWorkflow]
  );

  const onNodesChange: OnNodesChange<Node<WorkflowNodeCardData>> = useCallback(
    (changes) => {
      setLocalNodes((current) => applyNodeChanges(changes, current));
      const sizeChanges = collectManagerSlotSizeChanges(changes);
      if (sizeChanges.size === 0) return;
      onUpdateWorkflow((current) => resizeManagerSlotNodes(current, sizeChanges));
    },
    [onUpdateWorkflow]
  );

  const onNodeDragStop: OnNodeDrag<Node<WorkflowNodeCardData>> = useCallback(
    (_event, draggedNode) => {
      onUpdateWorkflow((current) => {
        const parentNode = draggedNode.parentId ? current.nodes.find((node) => node.id === draggedNode.parentId) : undefined;
        const position =
          parentNode?.type === "manager_slot"
            ? clampPositionToManagerSlotFrame(draggedNode.position, parentNode, defaultChildNodeSize)
            : draggedNode.position;
        return {
          ...current,
          nodes: current.nodes.map((node) =>
            node.id === draggedNode.id ? { ...node, position } : node
          )
        };
      });
    },
    [onUpdateWorkflow]
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      onUpdateWorkflow((current) => {
        if (
          current.edges.some(
            (edge) =>
              edge.source === connection.source &&
              edge.target === connection.target &&
              edge.sourceHandle === connection.sourceHandle &&
              edge.targetHandle === connection.targetHandle
          )
        ) {
          return current;
        }

        return {
          ...current,
          edges: [...current.edges, createWorkflowEdge(current, connection)]
        };
      });
    },
    [onUpdateWorkflow]
  );

  const addNode = useCallback(
    (type: WorkflowNodeType) => {
      onUpdateWorkflow((current) => {
        const workflowWithUniqueIds = ensureUniqueWorkflowNodeIds(current);
        const selectedSlot =
          selectedNodeId ? workflowWithUniqueIds.nodes.find((node) => node.id === selectedNodeId && node.type === "manager_slot") : undefined;
        const shouldNest = Boolean(selectedSlot && type !== "manager");
        const id = nextWorkflowNodeId(workflowWithUniqueIds, type, shouldNest ? selectedSlot?.id : undefined);
        const node: WorkflowNode = {
          id,
          type,
          parentId: shouldNest ? selectedSlot?.id : undefined,
          position: shouldNest
            ? managerSlotChildInitialPosition(selectedSlot!, workflowWithUniqueIds.nodes.filter((candidate) => candidate.parentId === selectedSlot!.id).length)
            : { x: 180 + workflowWithUniqueIds.nodes.length * 42, y: 188 + workflowWithUniqueIds.nodes.length * 22 },
          config: defaultConfig(type, t)
        };
        const next = {
          ...workflowWithUniqueIds,
          nodes: [...workflowWithUniqueIds.nodes, node]
        };
        return type === "manager" ? syncManagerSlotBoxes(next, node) : next;
      });
      setNodeMenuOpen(false);
    },
    [onUpdateWorkflow, selectedNodeId, t]
  );

  const openNodeMenuAt = useCallback((x: number, y: number) => {
    setNodeMenuAnchor({ x, y });
    setNodeContextMenu((current) => (current.open ? { ...current, open: false } : current));
    setNodeMenuOpen(true);
  }, []);

  const closeNodeMenu = useCallback(() => {
    setNodeMenuOpen(false);
  }, []);

  const closeNodeContextMenu = useCallback(() => {
    setNodeContextMenu({ open: false, x: 0, y: 0, nodeId: undefined });
  }, []);

  const deleteNodeById = useCallback(
    (nodeId: string) => {
      onUpdateWorkflow((current) => {
        const deleteIds = collectDeletedNodeIds(current, new Set([nodeId]));
        return {
          ...current,
          nodes: current.nodes.filter((node) => !deleteIds.has(node.id)),
          edges: current.edges.filter((edge) => !deleteIds.has(edge.source) && !deleteIds.has(edge.target))
        };
      });
      setLocalNodes((current) => {
        const deleteIds = new Set([nodeId]);
        return current.filter((node) => !deleteIds.has(node.id) && node.parentId !== nodeId);
      });
      setLocalEdges((current) => current.filter((edge) => edge.source !== nodeId && edge.target !== nodeId));
      if (selectedNodeId === nodeId) onSelectNode(undefined);
      if (inspectedNodeId === nodeId) setInspectedNodeId(undefined);
      setSelectedCanvasNodeIdsIfChanged([]);
      closeNodeContextMenu();
    },
    [closeNodeContextMenu, inspectedNodeId, onSelectNode, onUpdateWorkflow, selectedNodeId, setSelectedCanvasNodeIdsIfChanged]
  );

  const toggleNodeDisabled = useCallback(
    (nodeId: string) => {
      onUpdateWorkflow((current) => ({
        ...current,
        nodes: current.nodes.map((node) => (node.id === nodeId ? { ...node, disabled: !node.disabled } : node))
      }));
      closeNodeContextMenu();
    },
    [closeNodeContextMenu, onUpdateWorkflow]
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      if (selectedCanvasNodeIds.length === 0) return;

      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }

      event.preventDefault();
      const selectedSet = new Set(selectedCanvasNodeIds);

      onUpdateWorkflow((current) => {
        const deleteIds = collectDeletedNodeIds(current, selectedSet);
        return {
          ...current,
          nodes: current.nodes.filter((node) => !deleteIds.has(node.id)),
          edges: current.edges.filter((edge) => !deleteIds.has(edge.source) && !deleteIds.has(edge.target))
        };
      });

      if (selectedNodeId && selectedSet.has(selectedNodeId)) {
        onSelectNode(undefined);
      }
      if (inspectedNodeId && selectedSet.has(inspectedNodeId)) {
        setInspectedNodeId(undefined);
      }

      setSelectedCanvasNodeIdsIfChanged([]);
      closeNodeContextMenu();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closeNodeContextMenu, inspectedNodeId, onSelectNode, onUpdateWorkflow, selectedCanvasNodeIds, selectedNodeId, setSelectedCanvasNodeIdsIfChanged]);

  const onNodeClick: NodeMouseHandler<Node<WorkflowNodeCardData>> = useCallback(
    (event, node) => {
      closeNodeMenu();
      closeNodeContextMenu();
      if (node.data.type === "manager_slot" && isManagerSlotInnerFrameContext(event)) {
        if (selectedNodeId !== node.id) {
          setSelectedCanvasNodeIdsIfChanged([node.id]);
          onSelectNode(node.id);
        }
        setInspectedNodeId(undefined);
        return;
      }
      if (selectedNodeId === node.id) {
        setInspectedNodeId(node.id);
        return;
      }
      setSelectedCanvasNodeIdsIfChanged([node.id]);
      onSelectNode(node.id);
      setInspectedNodeId(undefined);
    },
    [closeNodeContextMenu, closeNodeMenu, onSelectNode, selectedNodeId, setSelectedCanvasNodeIdsIfChanged]
  );

  const onNodeContextMenu: NodeMouseHandler<Node<WorkflowNodeCardData>> = useCallback(
    (event, node) => {
      event.preventDefault();
      event.stopPropagation();
      rightDragStateRef.current = undefined;
      const { x, y } = getMenuPoint(event);
      setSelectedCanvasNodeIdsIfChanged([node.id]);
      onSelectNode(node.id);
      setInspectedNodeId(undefined);
      if (node.data.type === "manager_slot" && isManagerSlotInnerFrameContext(event)) {
        closeNodeContextMenu();
        openNodeMenuAt(x, y);
        return;
      }
      closeNodeMenu();
      setNodeContextMenu({
        open: true,
        x,
        y,
        nodeId: node.id
      });
    },
    [closeNodeContextMenu, closeNodeMenu, onSelectNode, openNodeMenuAt, setSelectedCanvasNodeIdsIfChanged]
  );

  const onEdgeClick: EdgeMouseHandler<Edge> = useCallback(
    (event, edge) => {
      if (!event.altKey) return;
      event.preventDefault();
      event.stopPropagation();
      setLocalEdges((current) => current.filter((item) => item.id !== edge.id));
      onUpdateWorkflow((current) => ({
        ...current,
        edges: current.edges.filter((item) => item.id !== edge.id)
      }));
    },
    [onUpdateWorkflow]
  );

  return (
    <ReactFlowProvider>
      <section className="workflow-shell compact-workflow-shell">
        <section
          className="workflow-canvas-panel expanded-workflow-panel"
          onPointerDownCapture={(event) => {
            if (event.button !== 2) return;
            rightDragStateRef.current = {
              x: event.clientX,
              y: event.clientY,
              moved: false,
              openedMenu: false
            };
          }}
          onPointerMoveCapture={(event) => {
            const state = rightDragStateRef.current;
            if (!state || (event.buttons & 2) !== 2) return;
            if (Math.hypot(event.clientX - state.x, event.clientY - state.y) > rightButtonDragThreshold) {
              state.moved = true;
            }
          }}
          onPointerUpCapture={(event) => {
            if (event.button !== 2) return;
            const state = rightDragStateRef.current;
            if (!state || state.moved || state.openedMenu || !isPaneAddMenuTarget(event.target)) return;
            state.openedMenu = true;
            const { x, y } = getMenuPoint(event);
            closeNodeContextMenu();
            setInspectedNodeId(undefined);
            openNodeMenuAt(x, y);
          }}
          onContextMenuCapture={(event) => {
            event.preventDefault();
            if (rightDragStateRef.current?.moved) {
              event.stopPropagation();
              rightDragStateRef.current = undefined;
              closeNodeContextMenu();
              closeNodeMenu();
              setInspectedNodeId(undefined);
            }
          }}
        >
          <button
            type="button"
            className="node-menu-trigger"
            title={t.actions.add}
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              openNodeMenuAt(rect.right + 8, rect.top);
            }}
            disabled={!workflow || busy}
          >
            <Plus size={18} />
          </button>

          {runView && (
            <div className="workflow-overlay workflow-overlay-right">
              <div className="floating-run-pill">
                <span className={`status-pill status-${runView.run.status}`}>{t.status[runView.run.status]}</span>
                <span>{t.metrics.nodes(runView.nodeRuns.length)}</span>
                {runView.run.status === "waiting_approval" && (
                  <button type="button" className="primary-action inline-action" onClick={onApproveRun} disabled={busy}>
                    <Check size={14} />
                    {t.actions.approve}
                  </button>
                )}
              </div>
            </div>
          )}

          <ReactFlow
            key={workflow?.id ?? "empty-workflow"}
            nodes={localNodes}
            edges={localEdges}
            nodeTypes={nodeTypes}
            defaultViewport={workflow?.display.viewport ?? { x: 0, y: 0, zoom: 1 }}
            onNodeClick={onNodeClick}
            onNodeContextMenu={onNodeContextMenu}
            onEdgeClick={onEdgeClick}
            onPaneClick={() => {
              setSelectedCanvasNodeIdsIfChanged([]);
              onSelectNode(undefined);
              closeNodeMenu();
              closeNodeContextMenu();
              setInspectedNodeId(undefined);
            }}
            onPaneContextMenu={(event) => {
              event.preventDefault();
              const rightDragState = rightDragStateRef.current;
              rightDragStateRef.current = undefined;
              if (rightDragState?.moved) {
                closeNodeContextMenu();
                closeNodeMenu();
                setInspectedNodeId(undefined);
                return;
              }
              const { x, y } = getMenuPoint(event);
              closeNodeContextMenu();
              setInspectedNodeId(undefined);
              openNodeMenuAt(x, y);
            }}
            onSelectionChange={({ nodes }) => setSelectedCanvasNodeIdsIfChanged(nodes.map((node) => node.id))}
            onNodesChange={onNodesChange}
            onNodeDragStop={onNodeDragStop}
            onConnect={onConnect}
            selectionOnDrag
            selectionMode={SelectionMode.Partial}
            panOnDrag={[1, 2]}
            deleteKeyCode={null}
            minZoom={0.35}
            maxZoom={1.5}
          >
            <Background gap={24} size={1} />
            <MiniMap pannable zoomable />
            <Controls position="bottom-right" />
          </ReactFlow>

          {nodeMenuOpen && workflow && (
            <div
              className="node-menu-popover"
              style={{
                left: nodeMenuAnchor.x,
                top: nodeMenuAnchor.y
              }}
            >
              <div className="node-menu-title">{t.panels.nodes}</div>
              <div className="node-menu-list">
                {palette.map((item) => {
                  const Icon = item.icon;
                  const label = t.nodeTypes[item.type];
                  return (
                    <button
                      key={item.type}
                      type="button"
                      className="node-menu-item"
                      title={`${t.actions.add} ${label}`}
                      onClick={() => addNode(item.type)}
                      disabled={busy}
                    >
                      <Icon size={15} />
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {nodeContextMenu.open && nodeContextMenu.nodeId && (
            <div
              className="node-context-menu"
              style={{
                left: nodeContextMenu.x,
                top: nodeContextMenu.y
              }}
            >
              <button type="button" className="node-context-item" onClick={() => toggleNodeDisabled(nodeContextMenu.nodeId!)}>
                {workflow?.nodes.find((node) => node.id === nodeContextMenu.nodeId)?.disabled
                  ? language === "zh-CN"
                    ? "启用节点"
                    : "Enable node"
                  : language === "zh-CN"
                    ? "禁用节点"
                    : "Disable node"}
              </button>
              <button type="button" className="node-context-item danger" onClick={() => deleteNodeById(nodeContextMenu.nodeId!)}>
                {language === "zh-CN" ? "删除节点" : "Delete node"}
              </button>
            </div>
          )}
        </section>

        {inspectedNode && workflow && (
          <NodeDetailModal
            catalog={catalog}
            configuredAgents={configuredAgents}
            node={inspectedNode}
            nodeRun={statusByNode.get(inspectedNode.id)}
            language={language}
            t={t}
            onClose={() => setInspectedNodeId(undefined)}
            onPatchConfig={(patch) => patchNodeConfig(inspectedNode.id, patch)}
          />
        )}
      </section>
    </ReactFlowProvider>
  );
}

function NodeDetailModal({
  catalog,
  configuredAgents,
  node,
  nodeRun,
  language,
  t,
  onClose,
  onPatchConfig
}: {
  catalog?: CatalogSnapshot;
  configuredAgents?: OpenClawConfiguredAgent[];
  node: WorkflowNode;
  nodeRun?: WorkflowNodeRun;
  language: Language;
  t: Messages;
  onClose: () => void;
  onPatchConfig: (patch: Partial<WorkflowNode["config"]>) => void;
}) {
  const models = catalog?.models ?? [];
  const channels = catalog?.channels ?? [];

  return (
    <div className="node-modal-backdrop" onClick={onClose}>
      <section className="node-modal" onClick={(event) => event.stopPropagation()}>
        <header className="node-modal-header">
          <div>
            <span className="hero-eyebrow modal-eyebrow">{t.nodeTypes[node.type]}</span>
            <h3>{node.config.label}</h3>
            <p>
              {t.fields.nodeId}: {node.id}
            </p>
          </div>
          <button type="button" className="icon-button" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <div className="node-modal-grid">
          <div className="node-modal-main">
            <div className="node-modal-section">
              <h4>{t.panels.inspector}</h4>
              <NodeConfigForm
                catalog={catalog}
                node={node}
                configuredAgents={configuredAgents}
                models={models}
                channels={channels}
                language={language}
                onPatchConfig={onPatchConfig}
                t={t}
              />
            </div>
          </div>

          <aside className="node-modal-side">
            <div className="node-modal-section">
              <h4>{t.panels.run}</h4>
              <dl className="meta-grid">
                <dt>{t.fields.status}</dt>
                <dd>{t.status[nodeRun?.status ?? "idle"]}</dd>
                <dt>{t.fields.position}</dt>
                <dd>
                  {Math.round(node.position.x)}, {Math.round(node.position.y)}
                </dd>
                {nodeRun?.openclawRef?.taskId && (
                  <>
                    <dt>{t.fields.openclawTask}</dt>
                    <dd>{nodeRun.openclawRef.taskId}</dd>
                  </>
                )}
                {nodeRun?.openclawRef?.runId && (
                  <>
                    <dt>{t.fields.openclawRun}</dt>
                    <dd>{nodeRun.openclawRef.runId}</dd>
                  </>
                )}
                {nodeRun?.openclawRef?.sessionKey && (
                  <>
                    <dt>{t.fields.openclawSession}</dt>
                    <dd>{nodeRun.openclawRef.sessionKey}</dd>
                  </>
                )}
                {nodeRun?.startedAt && (
                  <>
                    <dt>{t.fields.updatedAt}</dt>
                    <dd>{new Date(nodeRun.startedAt).toLocaleString(language)}</dd>
                  </>
                )}
              </dl>
            </div>

            {node.type === "agent" && (
              <AgentSkillPanel
                language={language}
                node={node}
                skills={catalog?.tools ?? []}
                onPatchConfig={onPatchConfig}
              />
            )}

            {(nodeRun?.output !== undefined || nodeRun?.error) && (
              <div className="node-modal-section">
                <h4>Output</h4>
                {nodeRun?.output !== undefined && <pre className="output-block">{formatOutput(nodeRun.output)}</pre>}
                {nodeRun?.error && <pre className="node-output-error output-block">{nodeRun.error}</pre>}
              </div>
            )}
          </aside>
        </div>
      </section>
    </div>
  );
}

function NodeConfigForm({
  node,
  configuredAgents,
  models,
  channels,
  language,
  onPatchConfig,
  t
}: {
  catalog?: CatalogSnapshot;
  node: WorkflowNode;
  configuredAgents?: OpenClawConfiguredAgent[];
  models: NonNullable<CatalogSnapshot["models"]>;
  channels: NonNullable<CatalogSnapshot["channels"]>;
  language: Language;
  onPatchConfig: (patch: Partial<WorkflowNode["config"]>) => void;
  t: Messages;
}) {
  if (node.type === "agent") {
    const config = node.config as AgentNodeConfig;
    const selectedModel = config.modelId ?? "";
    const hasSelectedModel = selectedModel ? models.some((model) => model.id === selectedModel) : true;
    const agentOptions = configuredAgents ?? [];
    const selectedAgentId = config.agentId ?? agentOptions[0]?.id ?? "main";
    const hasSelectedAgent = agentOptions.some((agent) => agent.id === selectedAgentId);

    return (
      <div className="config-form node-modal-form">
        <label>
          <span>{language === "zh-CN" ? "职称" : "Title"}</span>
          <input value={config.label} onChange={(event) => onPatchConfig({ label: event.target.value })} />
        </label>
        <label>
          <span>{t.fields.openclawAgent}</span>
          <select
            value={selectedAgentId}
            onChange={(event) => onPatchConfig({ agentId: event.target.value })}
          >
            {!hasSelectedAgent && <option value={selectedAgentId}>{selectedAgentId}</option>}
            {agentOptions.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name ? `${agent.name} (${agent.id})` : agent.id}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{t.fields.model}</span>
          <select value={selectedModel} onChange={(event) => onPatchConfig({ modelId: event.target.value || undefined })}>
            <option value="">{t.common.defaultModel}</option>
            {!hasSelectedModel && <option value={selectedModel}>{selectedModel}</option>}
            {models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{t.fields.runLabel}</span>
          <input value={config.agentName} onChange={(event) => onPatchConfig({ agentName: event.target.value })} />
        </label>
        <label className="field-span-full">
          <span>{t.fields.prompt}</span>
          <textarea rows={10} value={config.prompt} onChange={(event) => onPatchConfig({ prompt: event.target.value })} />
        </label>
      </div>
    );
  }

  if (node.type === "manager") {
    const config = node.config as ManagerNodeConfig;
    return (
      <div className="config-form node-modal-form">
        <label>
          <span>{t.fields.label}</span>
          <input value={config.label} onChange={(event) => onPatchConfig({ label: event.target.value })} />
        </label>
        <label>
          <span>Ports</span>
          <input
            min={1}
            max={8}
            type="number"
            value={config.portCount}
            onChange={(event) => onPatchConfig({ portCount: clampNumberInput(event.target.value, 1, 8, 3) })}
          />
        </label>
        <label>
          <span>Max handoffs</span>
          <input
            min={1}
            max={50}
            type="number"
            value={config.maxHandoffs}
            onChange={(event) => onPatchConfig({ maxHandoffs: clampNumberInput(event.target.value, 1, 50, 12) })}
          />
        </label>
        <label className="field-span-full">
          <span>Instructions</span>
          <textarea
            rows={8}
            value={config.instructions ?? ""}
            onChange={(event) => onPatchConfig({ instructions: event.target.value })}
          />
        </label>
      </div>
    );
  }

  if (node.type === "manager_slot") {
    const config = node.config as ManagerSlotNodeConfig;
    return (
      <div className="config-form node-modal-form">
        <label>
          <span>{t.fields.label}</span>
          <input value={config.label} onChange={(event) => onPatchConfig({ label: event.target.value })} />
        </label>
        <label>
          <span>Slot</span>
          <input value={config.slot} readOnly />
        </label>
        <label>
          <span>Manager</span>
          <input value={config.managerNodeId} readOnly />
        </label>
      </div>
    );
  }

  if (node.type === "loop") {
    const config = node.config as LoopNodeConfig;
    return (
      <div className="config-form node-modal-form">
        <label>
          <span>{t.fields.label}</span>
          <input value={config.label} onChange={(event) => onPatchConfig({ label: event.target.value })} />
        </label>
        <label>
          <span>Max iterations</span>
          <input
            min={1}
            max={25}
            type="number"
            value={config.maxIterations}
            onChange={(event) => onPatchConfig({ maxIterations: clampNumberInput(event.target.value, 1, 25, 3) })}
          />
        </label>
      </div>
    );
  }

  if (node.type === "condition") {
    const config = node.config as ConditionNodeConfig;
    return (
      <div className="config-form node-modal-form">
        <label>
          <span>{t.fields.label}</span>
          <input value={config.label} onChange={(event) => onPatchConfig({ label: event.target.value })} />
        </label>
        <label className="field-span-full">
          <span>Expression</span>
          <input value={config.expression} onChange={(event) => onPatchConfig({ expression: event.target.value })} />
        </label>
      </div>
    );
  }

  if (node.type === "approval") {
    const config = node.config as ApprovalNodeConfig;
    return (
      <div className="config-form node-modal-form">
        <label>
          <span>{t.fields.label}</span>
          <input value={config.label} onChange={(event) => onPatchConfig({ label: event.target.value })} />
        </label>
        <label>
          <span>{t.defaults.approvalOwner}</span>
          <input value={config.approverHint ?? ""} onChange={(event) => onPatchConfig({ approverHint: event.target.value })} />
        </label>
        <label className="field-span-full">
          <span>{t.defaults.approvalInstructions}</span>
          <textarea rows={8} value={config.instructions ?? ""} onChange={(event) => onPatchConfig({ instructions: event.target.value })} />
        </label>
      </div>
    );
  }

  if (node.type === "send") {
    const config = node.config as SendNodeConfig;
    return (
      <div className="config-form node-modal-form">
        <label>
          <span>{t.fields.label}</span>
          <input value={config.label} onChange={(event) => onPatchConfig({ label: event.target.value })} />
        </label>
        <label>
          <span>{t.fields.channels}</span>
          <select value={config.channelId} onChange={(event) => onPatchConfig({ channelId: event.target.value })}>
            {channels.length === 0 && <option value={config.channelId}>{config.channelId}</option>}
            {channels.map((channel) => (
              <option key={channel.id} value={channel.id}>
                {channel.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{t.fields.target}</span>
          <input value={config.target} onChange={(event) => onPatchConfig({ target: event.target.value })} />
        </label>
        <label className="field-span-full">
          <span>{t.fields.body}</span>
          <textarea rows={8} value={config.bodyTemplate} onChange={(event) => onPatchConfig({ bodyTemplate: event.target.value })} />
        </label>
      </div>
    );
  }

  if (node.type === "summary") {
    const config = node.config as SummaryNodeConfig;
    return (
      <div className="config-form node-modal-form">
        <label>
          <span>{t.fields.label}</span>
          <input value={config.label} onChange={(event) => onPatchConfig({ label: event.target.value })} />
        </label>
        <label>
          <span>{t.fields.model}</span>
          <select value={config.modelId ?? ""} onChange={(event) => onPatchConfig({ modelId: event.target.value || undefined })}>
            <option value="">{t.common.defaultModel}</option>
            {models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Mode</span>
          <select value={config.mode} onChange={(event) => onPatchConfig({ mode: event.target.value as SummaryNodeConfig["mode"] })}>
            <option value="structured_merge">structured_merge</option>
            <option value="openclaw_agent">openclaw_agent</option>
          </select>
        </label>
        <label className="field-span-full">
          <span>{t.fields.prompt}</span>
          <textarea rows={8} value={config.prompt ?? ""} onChange={(event) => onPatchConfig({ prompt: event.target.value })} />
        </label>
      </div>
    );
  }

  if (node.type === "parallel_agents") {
    const config = node.config as ParallelAgentsNodeConfig;
    const agentOptions = configuredAgents ?? [];
    const updateAgent = (index: number, patch: Partial<AgentNodeConfig>) => {
      onPatchConfig({
        agents: config.agents.map((agent, agentIndex) => (agentIndex === index ? { ...agent, ...patch } : agent))
      });
    };
    const addAgent = () => {
      onPatchConfig({
        agents: [...config.agents, createDefaultParallelAgent(t, agentOptions[0]?.id ?? "main")]
      });
    };
    const removeAgent = (index: number) => {
      onPatchConfig({
        agents: config.agents.filter((_, agentIndex) => agentIndex !== index)
      });
    };

    return (
      <div className="config-form node-modal-form">
        <label>
          <span>{t.fields.label}</span>
          <input value={config.label} onChange={(event) => onPatchConfig({ label: event.target.value })} />
        </label>
        <label>
          <span>Wait for</span>
          <select value={config.waitFor} onChange={(event) => onPatchConfig({ waitFor: event.target.value as ParallelAgentsNodeConfig["waitFor"] })}>
            <option value="all">all</option>
            <option value="first_success">first_success</option>
          </select>
        </label>
        <label>
          <span>{t.metrics.agents(config.agents.length)}</span>
          <input value={config.agents.map((agent) => agent.agentName).join(", ")} readOnly />
        </label>
        <div className="field-span-full parallel-agent-list">
          {config.agents.length === 0 ? (
            <div className="empty-state compact-empty-state">No parallel agents configured</div>
          ) : (
            config.agents.map((agent, index) => {
              const selectedModel = agent.modelId ?? "";
              const hasSelectedModel = selectedModel ? models.some((model) => model.id === selectedModel) : true;
              const selectedAgentId = agent.agentId ?? agentOptions[0]?.id ?? "main";
              const hasSelectedAgent = agentOptions.some((candidate) => candidate.id === selectedAgentId);

              return (
                <div key={`${agent.agentId ?? "main"}-${index}`} className="node-modal-section parallel-agent-card">
                  <div className="parallel-agent-card-header">
                    <h4>{`Parallel agent ${index + 1}`}</h4>
                    <button type="button" className="icon-button" onClick={() => removeAgent(index)}>
                      <X size={14} />
                    </button>
                  </div>
                  <div className="config-form parallel-agent-form">
                    <label>
                      <span>{t.fields.openclawAgent}</span>
                      <select value={selectedAgentId} onChange={(event) => updateAgent(index, { agentId: event.target.value })}>
                        {!hasSelectedAgent && <option value={selectedAgentId}>{selectedAgentId}</option>}
                        {agentOptions.map((candidate) => (
                          <option key={candidate.id} value={candidate.id}>
                            {candidate.name ? `${candidate.name} (${candidate.id})` : candidate.id}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>{t.fields.model}</span>
                      <select value={selectedModel} onChange={(event) => updateAgent(index, { modelId: event.target.value || undefined })}>
                        <option value="">{t.common.defaultModel}</option>
                        {!hasSelectedModel && <option value={selectedModel}>{selectedModel}</option>}
                        {models.map((model) => (
                          <option key={model.id} value={model.id}>
                            {model.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>{t.fields.runLabel}</span>
                      <input value={agent.agentName} onChange={(event) => updateAgent(index, { agentName: event.target.value })} />
                    </label>
                    <label className="field-span-full">
                      <span>{t.fields.prompt}</span>
                      <textarea rows={6} value={agent.prompt} onChange={(event) => updateAgent(index, { prompt: event.target.value })} />
                    </label>
                  </div>
                </div>
              );
            })
          )}
          <button type="button" onClick={addAgent}>
            Add parallel agent
          </button>
        </div>
      </div>
    );
  }

  if (node.type === "note") {
    const config = node.config as NoteNodeConfig;
    return (
      <div className="config-form node-modal-form">
        <label>
          <span>{t.fields.label}</span>
          <input value={config.label} onChange={(event) => onPatchConfig({ label: event.target.value })} />
        </label>
        <label className="field-span-full">
          <span>{t.fields.body}</span>
          <textarea rows={10} value={config.body} onChange={(event) => onPatchConfig({ body: event.target.value })} />
        </label>
      </div>
    );
  }

  return (
    <div className="config-form node-modal-form">
      <label>
        <span>{t.fields.label}</span>
        <input value={node.config.label} onChange={(event) => onPatchConfig({ label: event.target.value })} />
      </label>
    </div>
  );
}

function AgentSkillPanel({
  language,
  node,
  skills,
  onPatchConfig
}: {
  language: Language;
  node: WorkflowNode;
  skills: NonNullable<CatalogSnapshot["tools"]>;
  onPatchConfig: (patch: Partial<WorkflowNode["config"]>) => void;
}) {
  const config = node.config as AgentNodeConfig;
  const [selectedSkillId, setSelectedSkillId] = useState("");
  const selectedSkills = config.tools ?? [];
  const availableSkills = skills.filter((skill) => !selectedSkills.includes(skill.id));

  const addSkill = () => {
    if (!selectedSkillId) return;
    onPatchConfig({
      tools: [...selectedSkills, selectedSkillId]
    });
    setSelectedSkillId("");
  };

  const removeSkill = (skillId: string) => {
    onPatchConfig({
      tools: selectedSkills.filter((item) => item !== skillId)
    });
  };

  return (
    <div className="node-modal-section">
      <h4>{language === "zh-CN" ? "Skill" : "Skills"}</h4>
      <div className="skill-picker">
        <select value={selectedSkillId} onChange={(event) => setSelectedSkillId(event.target.value)}>
          <option value="">{language === "zh-CN" ? "选择一个 skill" : "Select a skill"}</option>
          {availableSkills.map((skill) => (
            <option key={skill.id} value={skill.id}>
              {skill.label} ({skill.category})
            </option>
          ))}
        </select>
        <button type="button" onClick={addSkill} disabled={!selectedSkillId}>
          {language === "zh-CN" ? "添加 Skill" : "Add skill"}
        </button>
      </div>
      <div className="skill-list">
        {selectedSkills.length === 0 ? (
          <div className="empty-state compact-empty-state">{language === "zh-CN" ? "还没有添加 skill" : "No skills added"}</div>
        ) : (
          selectedSkills.map((skillId) => {
            const match = skills.find((skill) => skill.id === skillId);
            return (
              <div key={skillId} className="skill-item">
                <div className="skill-item-main">
                  <strong>{match?.label ?? skillId}</strong>
                  <span>{match ? `${match.category} | ${match.id}` : skillId}</span>
                </div>
                <button type="button" className="icon-button" onClick={() => removeSkill(skillId)}>
                  <X size={14} />
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function formatOutput(output: unknown): string {
  if (typeof output === "string") return output;
  return JSON.stringify(output, null, 2);
}

function clampNumberInput(value: string, min: number, max: number, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function nextWorkflowNodeId(workflow: WorkflowDefinition, type: WorkflowNodeType, parentId?: string): string {
  return nextAvailableWorkflowNodeId(new Set(workflow.nodes.map((node) => node.id)), type, parentId);
}

function nextAvailableWorkflowNodeId(existingIds: Set<string>, type: WorkflowNodeType, parentId?: string): string {
  const baseId = parentId ? `${parentId}-${type}` : type;
  let index = 1;
  let id = `${baseId}-${index}`;
  while (existingIds.has(id)) {
    index += 1;
    id = `${baseId}-${index}`;
  }
  return id;
}

function hasDuplicateNodeIds(workflow: WorkflowDefinition): boolean {
  const seen = new Set<string>();
  for (const node of workflow.nodes) {
    if (seen.has(node.id)) return true;
    seen.add(node.id);
  }
  return false;
}

function ensureUniqueWorkflowNodeIds(workflow: WorkflowDefinition): WorkflowDefinition {
  const usedIds = new Set<string>();
  let changed = false;
  const nodes = workflow.nodes.map((node) => {
    if (!usedIds.has(node.id)) {
      usedIds.add(node.id);
      return node;
    }
    const nextId = nextAvailableWorkflowNodeId(usedIds, node.type, node.parentId);
    usedIds.add(nextId);
    changed = true;
    return {
      ...node,
      id: nextId
    };
  });

  return changed ? { ...workflow, nodes } : workflow;
}

function isPaneAddMenuTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (
    target.closest(
      ".react-flow__node, .react-flow__handle, .react-flow__controls, .react-flow__minimap, .node-menu-popover, .node-context-menu, .node-menu-trigger"
    )
  ) {
    return false;
  }
  return Boolean(target.closest(".react-flow__pane"));
}

function isManagerSlotInnerFrameContext(event: { currentTarget: EventTarget | null; clientX: number; clientY: number }): boolean {
  if (!(event.currentTarget instanceof Element)) return false;
  const innerFrame = event.currentTarget.querySelector(".manager-slot-box-body");
  if (!innerFrame) return false;
  const rect = innerFrame.getBoundingClientRect();
  return event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
}

function getMenuPoint(event: { clientX: number; clientY: number }): { x: number; y: number } {
  return {
    x: event.clientX + 8,
    y: event.clientY + 8
  };
}

function collectManagerSlotSizeChanges(changes: NodeChange<Node<WorkflowNodeCardData>>[]): Map<string, CanvasSize> {
  const sizes = new Map<string, CanvasSize>();
  for (const change of changes) {
    if (change.type !== "dimensions" || !change.dimensions) continue;
    if (change.resizing === true) continue;
    sizes.set(change.id, normalizeManagerSlotSize(change.dimensions));
  }
  return sizes;
}

function resizeManagerSlotNodes(workflow: WorkflowDefinition, sizesById: Map<string, CanvasSize>): WorkflowDefinition {
  let changed = false;
  const resizedNodes = workflow.nodes.map((node) => {
    const nextSize = sizesById.get(node.id);
    if (!nextSize || node.type !== "manager_slot") return node;
    const currentSize = normalizeManagerSlotSize(node.size);
    if (currentSize.width === nextSize.width && currentSize.height === nextSize.height) return node;
    changed = true;
    return { ...node, size: nextSize };
  });

  if (!changed) return workflow;

  const resizedNodesById = new Map(resizedNodes.map((node) => [node.id, node]));
  const nodes = resizedNodes.map((node) => {
    if (!node.parentId) return node;
    const parentNode = resizedNodesById.get(node.parentId);
    if (parentNode?.type !== "manager_slot") return node;
    const position = clampPositionToManagerSlotFrame(node.position, parentNode, defaultChildNodeSize);
    if (position.x === node.position.x && position.y === node.position.y) return node;
    return { ...node, position };
  });

  return {
    ...workflow,
    nodes
  };
}

function normalizeManagerSlotSize(size?: Partial<CanvasSize>): CanvasSize {
  return {
    width: normalizeDimension(size?.width, MANAGER_SLOT_DEFAULT_SIZE.width, MANAGER_SLOT_MIN_SIZE.width),
    height: normalizeDimension(size?.height, MANAGER_SLOT_DEFAULT_SIZE.height, MANAGER_SLOT_MIN_SIZE.height)
  };
}

function normalizeDimension(value: unknown, fallback: number, min: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.round(value));
}

function managerSlotChildExtent(slotNode: WorkflowNode): CoordinateExtent {
  const size = normalizeManagerSlotSize(slotNode.size);
  return [
    [MANAGER_SLOT_FRAME.side, MANAGER_SLOT_FRAME.top],
    [size.width - MANAGER_SLOT_FRAME.side, size.height - MANAGER_SLOT_FRAME.bottom]
  ];
}

function managerSlotChildInitialPosition(slotNode: WorkflowNode, childIndex: number): CanvasPosition {
  const extent = managerSlotChildExtent(slotNode);
  const position = {
    x: MANAGER_SLOT_FRAME.side + 48 + childIndex * 28,
    y: MANAGER_SLOT_FRAME.top + 52
  };
  return clampPositionToExtent(position, extent, defaultChildNodeSize);
}

function clampPositionToManagerSlotFrame(position: CanvasPosition, slotNode: WorkflowNode, childSize: CanvasSize): CanvasPosition {
  return clampPositionToExtent(position, managerSlotChildExtent(slotNode), childSize);
}

function clampPositionToExtent(position: CanvasPosition, extent: CoordinateExtent, childSize: CanvasSize): CanvasPosition {
  return {
    x: Math.min(Math.max(position.x, extent[0][0]), Math.max(extent[0][0], extent[1][0] - childSize.width)),
    y: Math.min(Math.max(position.y, extent[0][1]), Math.max(extent[0][1], extent[1][1] - childSize.height))
  };
}

function syncManagerSlotBoxes(workflow: WorkflowDefinition, managerNode: WorkflowNode): WorkflowDefinition {
  const config = managerNode.config as ManagerNodeConfig;
  const portCount = clampNumber(config.portCount, 1, 8, 3);
  const slotIds = new Set(Array.from({ length: portCount }, (_item, index) => managerSlotNodeId(managerNode.id, index + 1)));
  const removedSlotIds = new Set(
    workflow.nodes
      .filter((node) => node.type === "manager_slot" && (node.config as ManagerSlotNodeConfig).managerNodeId === managerNode.id && !slotIds.has(node.id))
      .map((node) => node.id)
  );
  const deleteIds = collectDeletedNodeIds(workflow, removedSlotIds);
  const retainedNodes = workflow.nodes.filter((node) => !deleteIds.has(node.id));
  const nodesById = new Map(retainedNodes.map((node) => [node.id, node]));
  const nodes = [...retainedNodes];

  for (let slot = 1; slot <= portCount; slot += 1) {
    const id = managerSlotNodeId(managerNode.id, slot);
    const existing = nodesById.get(id);
    if (existing) {
      const existingIndex = nodes.findIndex((node) => node.id === id);
      nodes[existingIndex] = {
        ...existing,
        config: {
          ...existing.config,
          label: `Slot ${slot}`,
          managerNodeId: managerNode.id,
          slot
        } as WorkflowNode["config"]
      };
      continue;
    }

    nodes.push({
      id,
      type: "manager_slot",
      position: {
        x: managerNode.position.x + 360,
        y: managerNode.position.y + (slot - 1) * 300
      },
      size: MANAGER_SLOT_DEFAULT_SIZE,
      config: {
        label: `Slot ${slot}`,
        managerNodeId: managerNode.id,
        slot
      }
    });
  }

  const edges = workflow.edges.filter((edge) => {
    if (deleteIds.has(edge.source) || deleteIds.has(edge.target)) return false;
    for (let slot = 1; slot <= portCount; slot += 1) {
      if (edge.source === managerNode.id && edge.sourceHandle === `${managerOutHandlePrefix}${slot}`) return false;
      if (edge.target === managerNode.id && edge.targetHandle === `${managerInHandlePrefix}${slot}`) return false;
    }
    return true;
  });

  for (let slot = 1; slot <= portCount; slot += 1) {
    const slotNodeId = managerSlotNodeId(managerNode.id, slot);
    edges.push({
      id: managerToSlotEdgeId(managerNode.id, slot),
      source: managerNode.id,
      sourceHandle: `${managerOutHandlePrefix}${slot}`,
      target: slotNodeId,
      targetHandle: managerSlotInHandle,
      condition: "success"
    });
    edges.push({
      id: slotToManagerEdgeId(managerNode.id, slot),
      source: slotNodeId,
      sourceHandle: managerSlotOutHandle,
      target: managerNode.id,
      targetHandle: `${managerInHandlePrefix}${slot}`,
      condition: "success"
    });
  }

  return {
    ...workflow,
    nodes,
    edges
  };
}

function syncAllManagerSlotBoxes(workflow: WorkflowDefinition): WorkflowDefinition {
  return workflow.nodes
    .filter((node) => node.type === "manager")
    .reduce((current, managerNode) => {
      const latestManager = current.nodes.find((node) => node.id === managerNode.id);
      return latestManager ? syncManagerSlotBoxes(current, latestManager) : current;
    }, workflow);
}

function needsManagerSlotSync(workflow: WorkflowDefinition): boolean {
  for (const managerNode of workflow.nodes.filter((node) => node.type === "manager")) {
    const portCount = clampNumber((managerNode.config as ManagerNodeConfig).portCount, 1, 8, 3);
    const managerSlots = workflow.nodes.filter(
      (node) => node.type === "manager_slot" && (node.config as ManagerSlotNodeConfig).managerNodeId === managerNode.id
    );
    if (managerSlots.some((node) => (node.config as ManagerSlotNodeConfig).slot > portCount)) return true;

    for (let slot = 1; slot <= portCount; slot += 1) {
      const slotNodeId = managerSlotNodeId(managerNode.id, slot);
      if (!workflow.nodes.some((node) => node.id === slotNodeId && node.type === "manager_slot")) return true;
      if (!workflow.edges.some((edge) => edge.id === managerToSlotEdgeId(managerNode.id, slot))) return true;
      if (!workflow.edges.some((edge) => edge.id === slotToManagerEdgeId(managerNode.id, slot))) return true;
      if (
        workflow.edges.some(
          (edge) =>
            edge.source === managerNode.id &&
            edge.sourceHandle === `${managerOutHandlePrefix}${slot}` &&
            (edge.target !== slotNodeId || edge.targetHandle !== managerSlotInHandle)
        )
      ) {
        return true;
      }
      if (
        workflow.edges.some(
          (edge) =>
            edge.target === managerNode.id &&
            edge.targetHandle === `${managerInHandlePrefix}${slot}` &&
            (edge.source !== slotNodeId || edge.sourceHandle !== managerSlotOutHandle)
        )
      ) {
        return true;
      }
    }
  }
  return false;
}

function collectDeletedNodeIds(workflow: WorkflowDefinition, seedIds: Set<string>): Set<string> {
  const deleteIds = new Set(seedIds);
  for (const node of workflow.nodes) {
    if (!deleteIds.has(node.id)) continue;
    if (node.type !== "manager") continue;
    for (const candidate of workflow.nodes) {
      if (candidate.type === "manager_slot" && (candidate.config as ManagerSlotNodeConfig).managerNodeId === node.id) {
        deleteIds.add(candidate.id);
      }
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const node of workflow.nodes) {
      if (node.parentId && deleteIds.has(node.parentId) && !deleteIds.has(node.id)) {
        deleteIds.add(node.id);
        changed = true;
      }
    }
  }
  return deleteIds;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function managerSlotNodeId(managerNodeId: string, slot: number): string {
  return `${managerNodeId}-slot-${slot}`;
}

function managerToSlotEdgeId(managerNodeId: string, slot: number): string {
  return `edge-${managerNodeId}-slot-${slot}-out`;
}

function slotToManagerEdgeId(managerNodeId: string, slot: number): string {
  return `edge-${managerNodeId}-slot-${slot}-return`;
}

function buildFlowNodes(
  workflow: WorkflowDefinition | undefined,
  statusByNode: Map<string, WorkflowNodeRun>,
  t: Messages
): Node<WorkflowNodeCardData>[] {
  const nodesById = new Map((workflow?.nodes ?? []).map((node) => [node.id, node]));
  return (workflow?.nodes ?? []).map((node) => {
    const status = statusByNode.get(node.id)?.status;
    const managerSlotSize = node.type === "manager_slot" ? normalizeManagerSlotSize(node.size) : undefined;
    const parentNode = node.parentId ? nodesById.get(node.parentId) : undefined;
    const extent = parentNode?.type === "manager_slot" ? managerSlotChildExtent(parentNode) : node.parentId ? "parent" : undefined;
    return {
      id: node.id,
      type: "workflowNode",
      position: node.position,
      style: managerSlotSize ? { width: managerSlotSize.width, height: managerSlotSize.height } : undefined,
      initialWidth: managerSlotSize?.width,
      initialHeight: managerSlotSize?.height,
      parentId: node.parentId,
      extent,
      data: {
        label: node.config.label,
        type: node.type,
        kindLabel: t.nodeTypes[node.type],
        status,
        statusLabel: t.status[status ?? "idle"],
        disabled: node.disabled,
        managerPortCount:
          node.type === "manager" ? (node.config as ManagerNodeConfig).portCount : undefined,
        managerSlot: node.type === "manager_slot" ? (node.config as ManagerSlotNodeConfig).slot : undefined,
        managerSlotSize
      }
    };
  });
}

function buildFlowEdges(workflow: WorkflowDefinition | undefined, runStatus?: WorkflowRunView["run"]["status"]): Edge[] {
  return (workflow?.edges ?? []).map((edge) => ({
    id: edge.id,
    type: workflowEdgeType(edge),
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle,
    targetHandle: edge.targetHandle,
    label: edge.label ?? defaultVisibleEdgeLabel(edge.condition),
    animated: runStatus === "running",
    className: "workflow-edge"
  }));
}

function workflowEdgeType(edge: WorkflowEdge): Edge["type"] | undefined {
  if (edge.sourceHandle === managerSlotInnerOutHandle || edge.targetHandle === managerSlotInnerInHandle) return "straight";
  return undefined;
}

export function defaultConfig(type: WorkflowNodeType, t: Messages): WorkflowNode["config"] {
  if (type === "agent") {
    return {
      label: t.defaults.agentLabel,
      agentId: "main",
      agentName: t.defaults.agentName,
      prompt: t.defaults.agentPrompt,
      tools: []
    };
  }
  if (type === "condition") {
    return {
      label: t.defaults.conditionLabel,
      expression: "true"
    };
  }
  if (type === "approval") {
    return {
      label: t.defaults.approvalLabel,
      approverHint: t.defaults.approvalOwner,
      instructions: t.defaults.approvalInstructions
    };
  }
  if (type === "send") {
    return {
      label: t.defaults.sendLabel,
      channelId: "slack",
      target: "#engineering",
      bodyTemplate: t.defaults.sendBody
    };
  }
  if (type === "summary") {
    return {
      label: t.defaults.summaryLabel,
      mode: "structured_merge"
    };
  }
  if (type === "parallel_agents") {
    return {
      label: t.defaults.parallelAgentsLabel,
      agents: [createDefaultParallelAgent(t)],
      waitFor: "all"
    };
  }
  if (type === "manager") {
    return {
      label: t.defaults.managerLabel,
      portCount: 3,
      maxHandoffs: 12,
      instructions:
        "Route work through numbered slots. Agents may return JSON with status and nextSlot or returnToSlot."
    };
  }
  if (type === "manager_slot") {
    return {
      label: "Manager slot",
      managerNodeId: "",
      slot: 1
    };
  }
  if (type === "loop") {
    return {
      label: t.defaults.loopLabel,
      maxIterations: 3
    };
  }
  if (type === "note") {
    return {
      label: t.defaults.noteLabel,
      body: t.defaults.noteBody
    };
  }
  return {
    label: t.defaults.groupLabel,
    color: "#64748b"
  };
}

function toFlowEdge(edge: WorkflowEdge): Edge {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle,
    targetHandle: edge.targetHandle,
    label: edge.label ?? defaultVisibleEdgeLabel(edge.condition)
  };
}

function fromFlowEdge(edge: Edge): WorkflowEdge {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle ?? undefined,
    targetHandle: edge.targetHandle ?? undefined,
    label: typeof edge.label === "string" ? edge.label : undefined
  };
}

function createWorkflowEdge(workflow: WorkflowDefinition, connection: Connection): WorkflowEdge {
  const condition = pickDefaultEdgeCondition(workflow, connection.source!);
  return {
    id: `edge-${connection.source}-${connection.target}-${Math.random().toString(36).slice(2, 8)}`,
    source: connection.source!,
    target: connection.target!,
    sourceHandle: connection.sourceHandle ?? undefined,
    targetHandle: connection.targetHandle ?? undefined,
    condition,
    label: defaultVisibleEdgeLabel(condition)
  };
}

function pickDefaultEdgeCondition(
  workflow: WorkflowDefinition,
  sourceId: string
): WorkflowEdge["condition"] {
  const source = workflow.nodes.find((node) => node.id === sourceId);
  if (source?.type !== "condition") {
    return "success";
  }

  const outgoing = workflow.edges.filter((edge) => edge.source === sourceId);
  const hasTrue = outgoing.some((edge) => edge.condition === "true");
  const hasFalse = outgoing.some((edge) => edge.condition === "false");
  if (!hasTrue) return "true";
  if (!hasFalse) return "false";
  return "true";
}

function defaultVisibleEdgeLabel(condition?: WorkflowEdge["condition"]): string | undefined {
  if (condition === "true" || condition === "false" || condition === "failure") {
    return condition;
  }
  return undefined;
}

function createDefaultParallelAgent(t: Messages, agentId = "main"): AgentNodeConfig {
  return {
    label: t.defaults.agentLabel,
    agentId,
    agentName: t.defaults.agentName,
    prompt: t.defaults.agentPrompt,
    tools: []
  };
}
