import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addEdge,
  applyNodeChanges,
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  type Connection,
  type Edge,
  type EdgeMouseHandler,
  type Node,
  type NodeMouseHandler,
  type OnNodeDrag,
  type OnNodesChange
} from "@xyflow/react";
import { Bot, Check, GitBranch, Plus, Send, ShieldCheck, X } from "lucide-react";
import type {
  AgentNodeConfig,
  ApprovalNodeConfig,
  CatalogSnapshot,
  ConditionNodeConfig,
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
import { WorkflowNodeCard, type WorkflowNodeCardData } from "./WorkflowNodeCard";
import { type Language, type Messages } from "../lib/i18n";

const nodeTypes = {
  workflowNode: WorkflowNodeCard
};

const palette: Array<{ type: WorkflowNodeType; icon: typeof Plus }> = [
  { type: "agent", icon: Bot },
  { type: "condition", icon: GitBranch },
  { type: "approval", icon: ShieldCheck },
  { type: "send", icon: Send }
];

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

  const patchNodeConfig = useCallback(
    (nodeId: string, patch: Partial<WorkflowNode["config"]>) => {
      onUpdateWorkflow((current) => ({
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
      }));
    },
    [onUpdateWorkflow]
  );

  const onNodesChange: OnNodesChange<Node<WorkflowNodeCardData>> = useCallback(
    (changes) => {
      setLocalNodes((current) => applyNodeChanges(changes, current));
    },
    []
  );

  const onNodeDragStop: OnNodeDrag<Node<WorkflowNodeCardData>> = useCallback(
    (_event, draggedNode) => {
      onUpdateWorkflow((current) => ({
        ...current,
        nodes: current.nodes.map((node) =>
          node.id === draggedNode.id ? { ...node, position: draggedNode.position } : node
        )
      }));
    },
    [onUpdateWorkflow]
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      setLocalEdges((current) => addEdge(connection, current));
      onUpdateWorkflow((current) => ({
        ...current,
        edges: addEdge(connection, current.edges.map(toFlowEdge)).map(fromFlowEdge)
      }));
    },
    [onUpdateWorkflow]
  );

  const addNode = useCallback(
    (type: WorkflowNodeType) => {
      onUpdateWorkflow((current) => {
        const id = `${type}-${current.nodes.length + 1}`;
        const node: WorkflowNode = {
          id,
          type,
          position: { x: 180 + current.nodes.length * 42, y: 188 + current.nodes.length * 22 },
          config: defaultConfig(type, t)
        };
        return {
          ...current,
          nodes: [...current.nodes, node]
        };
      });
      setNodeMenuOpen(false);
    },
    [onUpdateWorkflow, t]
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
      onUpdateWorkflow((current) => ({
        ...current,
        nodes: current.nodes.filter((node) => node.id !== nodeId),
        edges: current.edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId)
      }));
      setLocalNodes((current) => current.filter((node) => node.id !== nodeId));
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

      onUpdateWorkflow((current) => ({
        ...current,
        nodes: current.nodes.filter((node) => !selectedSet.has(node.id)),
        edges: current.edges.filter((edge) => !selectedSet.has(edge.source) && !selectedSet.has(edge.target))
      }));

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
    (_event, node) => {
      closeNodeMenu();
      closeNodeContextMenu();
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
      const panel = (event.currentTarget as HTMLElement).closest(".workflow-canvas-panel") as HTMLDivElement | null;
      const rect = panel?.getBoundingClientRect();
      setSelectedCanvasNodeIdsIfChanged([node.id]);
      onSelectNode(node.id);
      setInspectedNodeId(undefined);
      closeNodeMenu();
      setNodeContextMenu({
        open: true,
        x: rect ? event.clientX - rect.left : event.clientX,
        y: rect ? event.clientY - rect.top : event.clientY,
        nodeId: node.id
      });
    },
    [closeNodeMenu, onSelectNode, setSelectedCanvasNodeIdsIfChanged]
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
        <section className="workflow-canvas-panel expanded-workflow-panel">
          <button
            type="button"
            className="node-menu-trigger"
            title={t.actions.add}
            onClick={() => openNodeMenuAt(88, 252)}
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
              const rect = (event.currentTarget as HTMLDivElement).getBoundingClientRect();
              closeNodeContextMenu();
              setInspectedNodeId(undefined);
              openNodeMenuAt(event.clientX - rect.left, event.clientY - rect.top);
            }}
            onSelectionChange={({ nodes }) => setSelectedCanvasNodeIdsIfChanged(nodes.map((node) => node.id))}
            onNodesChange={onNodesChange}
            onNodeDragStop={onNodeDragStop}
            onConnect={onConnect}
            selectionOnDrag
            panOnDrag={[1]}
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

  if (node.type === "condition") {
    const config = node.config as ConditionNodeConfig;
    return (
      <div className="config-form node-modal-form">
        <label>
          <span>{t.fields.label}</span>
          <input value={config.label} onChange={(event) => onPatchConfig({ label: event.target.value })} />
        </label>
        <label className="field-span-full">
          <span>{t.fields.description}</span>
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

function buildFlowNodes(
  workflow: WorkflowDefinition | undefined,
  statusByNode: Map<string, WorkflowNodeRun>,
  t: Messages
): Node<WorkflowNodeCardData>[] {
  return (workflow?.nodes ?? []).map((node) => {
    const status = statusByNode.get(node.id)?.status;
    return {
      id: node.id,
      type: "workflowNode",
      position: node.position,
      data: {
        label: node.config.label,
        type: node.type,
        kindLabel: t.nodeTypes[node.type],
        status,
        statusLabel: t.status[status ?? "idle"]
      }
    };
  });
}

function buildFlowEdges(workflow: WorkflowDefinition | undefined, runStatus?: WorkflowRunView["run"]["status"]): Edge[] {
  return (workflow?.edges ?? []).map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.label,
    animated: runStatus === "running",
    className: "workflow-edge"
  }));
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
      agents: [],
      waitFor: "all"
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
    label: edge.label
  };
}

function fromFlowEdge(edge: Edge): WorkflowEdge {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: typeof edge.label === "string" ? edge.label : undefined
  };
}
