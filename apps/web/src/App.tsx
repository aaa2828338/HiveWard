import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addEdge,
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  type Connection,
  type Edge,
  type Node,
  type OnNodeDrag
} from "@xyflow/react";
import { Check, Database, GitBranch, Languages, Loader2, Play, Plus, RefreshCw, Save, Send, ShieldCheck } from "lucide-react";
import type {
  AgentNodeConfig,
  CatalogSnapshot,
  WorkflowDefinition,
  WorkflowEdge,
  WorkflowNode,
  WorkflowNodeRun,
  WorkflowNodeType,
  WorkflowRunView
} from "@openclaw-cui/shared";
import { api } from "./lib/api";
import { WorkflowNodeCard, type WorkflowNodeCardData } from "./components/WorkflowNodeCard";
import { getInitialLanguage, messages, translateEventMessage, type Language, type Messages } from "./lib/i18n";

const nodeTypes = {
  workflowNode: WorkflowNodeCard
};

const palette: Array<{ type: WorkflowNodeType; icon: typeof Plus }> = [
  { type: "agent", icon: Plus },
  { type: "condition", icon: GitBranch },
  { type: "approval", icon: ShieldCheck },
  { type: "send", icon: Send }
];

export function App() {
  const [language, setLanguage] = useState<Language>(() => getInitialLanguage());
  const [workflows, setWorkflows] = useState<WorkflowDefinition[]>([]);
  const [workflow, setWorkflow] = useState<WorkflowDefinition | undefined>();
  const [catalog, setCatalog] = useState<CatalogSnapshot | undefined>();
  const [runView, setRunView] = useState<WorkflowRunView | undefined>();
  const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const t = messages[language];
  const messageRef = useRef(t);

  useEffect(() => {
    messageRef.current = t;
  }, [t]);

  const selectedNode = workflow?.nodes.find((node) => node.id === selectedNodeId);
  const statusByNode = useMemo(() => {
    const map = new Map<string, WorkflowNodeRun>();
    for (const nodeRun of runView?.nodeRuns ?? []) {
      map.set(nodeRun.nodeId, nodeRun);
    }
    return map;
  }, [runView]);

  const flowNodes = useMemo<Node<WorkflowNodeCardData>[]>(() => {
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
  }, [statusByNode, t, workflow?.nodes]);

  const flowEdges = useMemo<Edge[]>(() => {
    return (workflow?.edges ?? []).map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: edge.label,
      animated: runView?.run.status === "running",
      className: "workflow-edge"
    }));
  }, [runView?.run.status, workflow?.edges]);

  const load = useCallback(async () => {
    setBusy(true);
    setError(undefined);
    try {
      const [nextWorkflows, nextCatalog] = await Promise.all([api.listWorkflows(), api.getCatalogSnapshot()]);
      const firstWorkflow = nextWorkflows[0];
      setWorkflows(nextWorkflows);
      setWorkflow(firstWorkflow);
      setCatalog(nextCatalog);
      setRunView(firstWorkflow ? await api.getLatestWorkflowRun(firstWorkflow.id) : undefined);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : messageRef.current.errors.load);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    localStorage.setItem("openclaw-cui-language", language);
  }, [language]);

  const updateWorkflow = useCallback((updater: (current: WorkflowDefinition) => WorkflowDefinition) => {
    setWorkflow((current) => (current ? updater(current) : current));
  }, []);

  const patchNodeConfig = useCallback((nodeId: string, patch: Partial<WorkflowNode["config"]>) => {
    updateWorkflow((current) => ({
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
  }, [updateWorkflow]);

  const onNodeDragStop: OnNodeDrag<Node<WorkflowNodeCardData>> = useCallback((_event, draggedNode) => {
    updateWorkflow((current) => ({
      ...current,
      nodes: current.nodes.map((node) =>
        node.id === draggedNode.id ? { ...node, position: draggedNode.position } : node
      )
    }));
  }, [updateWorkflow]);

  const onConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target) return;
    updateWorkflow((current) => ({
      ...current,
      edges: addEdge(connection, current.edges.map(toFlowEdge)).map(fromFlowEdge)
    }));
  }, [updateWorkflow]);

  const save = useCallback(async () => {
    if (!workflow) return;
    setBusy(true);
    setError(undefined);
    try {
      const saved = await api.saveWorkflow(workflow);
      setWorkflow(saved);
      setWorkflows((items) => items.map((item) => (item.id === saved.id ? saved : item)));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t.errors.save);
    } finally {
      setBusy(false);
    }
  }, [t.errors.save, workflow]);

  const run = useCallback(async () => {
    if (!workflow) return;
    setBusy(true);
    setError(undefined);
    try {
      const saved = await api.saveWorkflow(workflow);
      setWorkflow(saved);
      setWorkflows((items) => items.map((item) => (item.id === saved.id ? saved : item)));
      setRunView(await api.startWorkflowRun(saved.id));
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : t.errors.run);
    } finally {
      setBusy(false);
    }
  }, [t.errors.run, workflow]);

  const approve = useCallback(async () => {
    if (!runView) return;
    setBusy(true);
    setError(undefined);
    try {
      setRunView(await api.approveWorkflowRun(runView.run.id));
    } catch (approveError) {
      setError(approveError instanceof Error ? approveError.message : t.errors.approve);
    } finally {
      setBusy(false);
    }
  }, [runView, t.errors.approve]);

  const refreshCatalog = useCallback(async () => {
    setBusy(true);
    setError(undefined);
    try {
      setCatalog(await api.refreshCatalog());
    } catch (catalogError) {
      setError(catalogError instanceof Error ? catalogError.message : t.errors.catalog);
    } finally {
      setBusy(false);
    }
  }, [t.errors.catalog]);

  const addNode = useCallback((type: WorkflowNodeType) => {
    updateWorkflow((current) => {
      const id = `${type}-${current.nodes.length + 1}`;
      const node: WorkflowNode = {
        id,
        type,
        position: { x: 160 + current.nodes.length * 36, y: 400 + current.nodes.length * 18 },
        config: defaultConfig(type, t)
      };
      return {
        ...current,
        nodes: [...current.nodes, node]
      };
    });
  }, [t, updateWorkflow]);

  const toggleLanguage = useCallback(() => {
    setLanguage((current) => (current === "zh-CN" ? "en" : "zh-CN"));
  }, []);

  const selectWorkflow = useCallback(async (workflowId: string) => {
    const next = workflows.find((item) => item.id === workflowId);
    setWorkflow(next);
    setSelectedNodeId(undefined);
    setRunView(undefined);
    if (!next) return;

    setBusy(true);
    setError(undefined);
    try {
      setRunView(await api.getLatestWorkflowRun(next.id));
    } catch (selectError) {
      setError(selectError instanceof Error ? selectError.message : messageRef.current.errors.load);
    } finally {
      setBusy(false);
    }
  }, [workflows]);

  return (
    <ReactFlowProvider>
      <main className="app-shell">
        <header className="topbar">
          <div className="brand-block">
            <div className="brand-mark">OC</div>
            <div>
              <h1>openclaw-cui</h1>
              <p>{workflow?.name ?? t.fields.workflow}</p>
            </div>
          </div>
          <div className="toolbar">
            <select
              value={workflow?.id ?? ""}
              onChange={(event) => void selectWorkflow(event.target.value)}
              aria-label={t.fields.workflow}
            >
              {workflows.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <button type="button" title={t.actions.switchLanguage} aria-label={t.actions.switchLanguage} onClick={toggleLanguage}>
              <Languages size={16} />
              {language === "zh-CN" ? "中文" : "EN"}
            </button>
            <button type="button" title={t.actions.refreshCatalog} onClick={refreshCatalog} disabled={busy}>
              <RefreshCw size={16} />
              {t.actions.catalog}
            </button>
            <button type="button" title={t.actions.saveWorkflow} onClick={save} disabled={!workflow || busy}>
              <Save size={16} />
              {t.actions.save}
            </button>
            <button className="primary-action" type="button" title={t.actions.runWorkflow} onClick={run} disabled={!workflow || busy}>
              {busy ? <Loader2 className="spin" size={16} /> : <Play size={16} />}
              {t.actions.run}
            </button>
          </div>
        </header>

        <section className="workspace">
          <aside className="left-rail">
            <div className="panel-title">{t.panels.nodes}</div>
            <div className="palette-list">
              {palette.map((item) => {
                const Icon = item.icon;
                const label = t.nodeTypes[item.type];
                return (
                  <button key={item.type} type="button" title={`${t.actions.add} ${label}`} onClick={() => addNode(item.type)}>
                    <Icon size={16} />
                    {label}
                  </button>
                );
              })}
            </div>

            <div className="panel-title catalog-title">{t.panels.catalog}</div>
            <div className="catalog-block">
              <div className="catalog-metric">
                <Database size={15} />
                <span>{t.metrics.models(catalog?.models.length ?? 0)}</span>
              </div>
              <div className="catalog-metric">
                <Database size={15} />
                <span>{t.metrics.agents(catalog?.agents?.length ?? 0)}</span>
              </div>
              <div className="catalog-metric">
                <Database size={15} />
                <span>{t.metrics.tools(catalog?.tools.length ?? 0)}</span>
              </div>
              <div className="catalog-metric">
                <Database size={15} />
                <span>{t.metrics.channels(catalog?.channels.length ?? 0)}</span>
              </div>
            </div>
          </aside>

          <section className="canvas-panel">
            {error && <div className="error-banner">{error}</div>}
            <ReactFlow
              nodes={flowNodes}
              edges={flowEdges}
              nodeTypes={nodeTypes}
              onNodeClick={(_event, node) => setSelectedNodeId(node.id)}
              onPaneClick={() => setSelectedNodeId(undefined)}
              onNodeDragStop={onNodeDragStop}
              onConnect={onConnect}
              fitView
              minZoom={0.35}
              maxZoom={1.5}
            >
              <Background gap={24} size={1} />
              <MiniMap pannable zoomable />
              <Controls />
            </ReactFlow>
          </section>

          <aside className="right-rail">
            <section className="inspector-section">
              <div className="panel-title">{t.panels.inspector}</div>
              {selectedNode ? (
                <NodeInspector
                  catalog={catalog}
                  node={selectedNode}
                  nodeRun={statusByNode.get(selectedNode.id)}
                  onPatchConfig={(patch) => patchNodeConfig(selectedNode.id, patch)}
                  t={t}
                />
              ) : (
                <div className="empty-state">{t.empty.selectNode}</div>
              )}
            </section>

            <section className="inspector-section run-section">
              <div className="run-heading">
                <div className="panel-title">{t.panels.run}</div>
                {runView?.run.status === "waiting_approval" && (
                  <button type="button" title={t.actions.approve} onClick={approve} disabled={busy}>
                    <Check size={16} />
                    {t.actions.approve}
                  </button>
                )}
              </div>
              {runView ? <RunPanel runView={runView} language={language} t={t} /> : <div className="empty-state">{t.empty.noRun}</div>}
            </section>
          </aside>
        </section>
      </main>
    </ReactFlowProvider>
  );
}

function NodeInspector({
  catalog,
  node,
  nodeRun,
  onPatchConfig,
  t
}: {
  catalog?: CatalogSnapshot;
  node: WorkflowNode;
  nodeRun?: WorkflowNodeRun;
  onPatchConfig: (patch: Partial<AgentNodeConfig>) => void;
  t: Messages;
}) {
  const agentConfig = node.type === "agent" ? (node.config as AgentNodeConfig) : undefined;
  const agents = catalog?.agents ?? [];
  const models = catalog?.models ?? [];
  const selectedModel = agentConfig?.modelId ?? "";
  const hasSelectedModel = selectedModel ? models.some((model) => model.id === selectedModel) : true;

  return (
    <div className="inspector-card">
      <div className="node-inspector-header">
        <span>{node.config.label}</span>
        <code>{t.nodeTypes[node.type]}</code>
      </div>
      {agentConfig && (
        <div className="config-form">
          <label>
            <span>{t.fields.label}</span>
            <input value={node.config.label} onChange={(event) => onPatchConfig({ label: event.target.value })} />
          </label>
          <label>
            <span>{t.fields.openclawAgent}</span>
            <select
              value={agentConfig.agentId ?? agents[0]?.id ?? "main"}
              onChange={(event) => onPatchConfig({ agentId: event.target.value })}
            >
              {agents.length === 0 && <option value={agentConfig.agentId ?? "main"}>{agentConfig.agentId ?? "main"}</option>}
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>{t.fields.model}</span>
            <select
              value={selectedModel}
              onChange={(event) => onPatchConfig({ modelId: event.target.value || undefined })}
            >
              <option value="">OpenClaw default</option>
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
            <input value={agentConfig.agentName} onChange={(event) => onPatchConfig({ agentName: event.target.value })} />
          </label>
          <label>
            <span>{t.fields.prompt}</span>
            <textarea
              value={agentConfig.prompt}
              onChange={(event) => onPatchConfig({ prompt: event.target.value })}
              rows={7}
            />
          </label>
        </div>
      )}
      <dl>
        <dt>{t.fields.status}</dt>
        <dd>{t.status[nodeRun?.status ?? "idle"]}</dd>
        {agentConfig && (
          <>
            <dt>{t.fields.openclawAgent}</dt>
            <dd>{agentConfig.agentId ?? "main"}</dd>
            <dt>{t.fields.runLabel}</dt>
            <dd>{agentConfig.agentName}</dd>
            <dt>{t.fields.model}</dt>
            <dd>{agentConfig.modelId ?? "default"}</dd>
          </>
        )}
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
        <dt>{t.fields.nodeId}</dt>
        <dd>{node.id}</dd>
        <dt>{t.fields.position}</dt>
        <dd>
          {Math.round(node.position.x)}, {Math.round(node.position.y)}
        </dd>
      </dl>
      {nodeRun?.output !== undefined && (
        <pre className="output-block">{JSON.stringify(nodeRun.output, null, 2)}</pre>
      )}
    </div>
  );
}

function RunPanel({ runView, language, t }: { runView: WorkflowRunView; language: Language; t: Messages }) {
  const formattedCost = `$${runView.run.totalCostUsd.toFixed(6)}`;
  return (
    <div className="run-panel">
      <div className={`run-status run-${runView.run.status}`}>{t.status[runView.run.status]}</div>
      <div className="run-metrics">
        <span>{t.metrics.nodes(runView.nodeRuns.length)}</span>
        <span>{t.metrics.tokens(runView.run.totalInputTokens + runView.run.totalOutputTokens)}</span>
        <span>{t.metrics.cost(formattedCost)}</span>
      </div>
      <div className="event-list">
        {runView.events.slice(-8).reverse().map((event) => (
          <div key={event.id} className="event-row">
            <time>{new Date(event.createdAt).toLocaleTimeString(language)}</time>
            <span>
              {t.events[event.type]} · {translateEventMessage(event.message, language)}
            </span>
          </div>
        ))}
      </div>
      <div className="node-output-list">
        {runView.nodeRuns.map((nodeRun) => (
          <div key={nodeRun.id} className="node-output-row">
            <div className="node-output-heading">
              <span>{nodeRun.nodeLabel}</span>
              <code>{t.status[nodeRun.status]}</code>
            </div>
            {nodeRun.output !== undefined && <pre>{formatOutput(nodeRun.output)}</pre>}
            {nodeRun.error && <pre className="node-output-error">{nodeRun.error}</pre>}
          </div>
        ))}
      </div>
    </div>
  );
}

function formatOutput(output: unknown): string {
  if (typeof output === "string") return output;
  return JSON.stringify(output, null, 2);
}

function defaultConfig(type: WorkflowNodeType, t: Messages): WorkflowNode["config"] {
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
      body: ""
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
