import type { WorkflowNodeEvent, WorkflowNodeRunStatus, WorkflowNodeType, WorkflowRunStatus } from "@openclaw-cui/shared";

export type Language = "en" | "zh-CN";
export type StatusKey = WorkflowNodeRunStatus | WorkflowRunStatus | "idle";

export interface Messages {
  actions: {
    add: string;
    approve: string;
    catalog: string;
    refreshCatalog: string;
    run: string;
    runWorkflow: string;
    save: string;
    saveWorkflow: string;
    switchLanguage: string;
  };
  defaults: {
    agentLabel: string;
    agentName: string;
    agentPrompt: string;
    approvalInstructions: string;
    approvalLabel: string;
    approvalOwner: string;
    conditionLabel: string;
    groupLabel: string;
    noteLabel: string;
    parallelAgentsLabel: string;
    sendBody: string;
    sendLabel: string;
    summaryLabel: string;
  };
  empty: {
    noRun: string;
    selectNode: string;
  };
  errors: {
    approve: string;
    catalog: string;
    load: string;
    run: string;
    save: string;
  };
  fields: {
    label: string;
    prompt: string;
    openclawAgent: string;
    runLabel: string;
    model: string;
    nodeId: string;
    openclawRun: string;
    openclawSession: string;
    openclawTask: string;
    position: string;
    status: string;
    workflow: string;
  };
  metrics: {
    agents: (count: number) => string;
    channels: (count: number) => string;
    cost: (cost: string) => string;
    models: (count: number) => string;
    nodes: (count: number) => string;
    tokens: (count: number) => string;
    tools: (count: number) => string;
  };
  nodeTypes: Record<WorkflowNodeType, string>;
  panels: {
    catalog: string;
    inspector: string;
    nodes: string;
    run: string;
  };
  status: Record<StatusKey, string>;
  events: Record<WorkflowNodeEvent["type"], string>;
}

export const messages: Record<Language, Messages> = {
  en: {
    actions: {
      add: "Add",
      approve: "Approve",
      catalog: "Catalog",
      refreshCatalog: "Refresh catalog",
      run: "Run",
      runWorkflow: "Run workflow",
      save: "Save",
      saveWorkflow: "Save workflow",
      switchLanguage: "Switch language",
    },
    defaults: {
      agentLabel: "OpenClaw call",
      agentName: "agent",
      agentPrompt: "Execute this CUI node through OpenClaw.",
      approvalInstructions: "Review the merged output.",
      approvalLabel: "Approval",
      approvalOwner: "Owner",
      conditionLabel: "Condition",
      groupLabel: "Group",
      noteLabel: "Note",
      parallelAgentsLabel: "Parallel Agents",
      sendBody: "Workflow {{workflow.name}} completed. Summary: {{summary}}",
      sendLabel: "Send",
      summaryLabel: "Summary",
    },
    empty: {
      noRun: "No run yet",
      selectNode: "Select a node",
    },
    errors: {
      approve: "Failed to approve run.",
      catalog: "Failed to refresh catalog.",
      load: "Failed to load workspace.",
      run: "Failed to run workflow.",
      save: "Failed to save workflow.",
    },
    fields: {
      label: "Node label",
      prompt: "Prompt",
      nodeId: "Node ID",
      openclawAgent: "OpenClaw agent",
      position: "Position",
      model: "Model",
      runLabel: "Run label",
      openclawRun: "OpenClaw run",
      openclawSession: "OpenClaw session",
      openclawTask: "OpenClaw task",
      status: "Status",
      workflow: "Workflow",
    },
    metrics: {
      agents: (count) => `${count} agents`,
      channels: (count) => `${count} channels`,
      cost: (cost) => cost,
      models: (count) => `${count} models`,
      nodes: (count) => `${count} nodes`,
      tokens: (count) => `${count} tokens`,
      tools: (count) => `${count} tools`,
    },
    nodeTypes: {
      agent: "OpenClaw call",
      approval: "Approval",
      condition: "Condition",
      group: "Group",
      note: "Note",
      parallel_agents: "Parallel agents",
      send: "Send",
      summary: "Summary",
    },
    panels: {
      catalog: "Catalog",
      inspector: "Inspector",
      nodes: "Nodes",
      run: "Run",
    },
    status: {
      cancelled: "cancelled",
      failed: "failed",
      idle: "idle",
      queued: "queued",
      running: "running",
      skipped: "skipped",
      succeeded: "succeeded",
      waiting_approval: "waiting approval",
    },
    events: {
      "node.run.cancelled": "Node cancelled",
      "node.run.completed": "Node completed",
      "node.run.failed": "Node failed",
      "node.run.queued": "Node queued",
      "node.run.started": "Node started",
      "node.run.waiting_approval": "Waiting for approval",
      "workflow.run.completed": "Workflow completed",
      "workflow.run.failed": "Workflow failed",
      "workflow.run.started": "Workflow started",
    },
  },
  "zh-CN": {
    actions: {
      add: "添加",
      approve: "批准",
      catalog: "目录",
      refreshCatalog: "刷新 OpenClaw 目录",
      run: "运行",
      runWorkflow: "运行工作流",
      save: "保存",
      saveWorkflow: "保存工作流",
      switchLanguage: "切换语言",
    },
    defaults: {
      agentLabel: "OpenClaw 调用",
      agentName: "agent",
      agentPrompt: "通过 OpenClaw 执行这个 CUI 节点。",
      approvalInstructions: "审核合并后的输出。",
      approvalLabel: "人工批准",
      approvalOwner: "负责人",
      conditionLabel: "条件",
      groupLabel: "分组",
      noteLabel: "备注",
      parallelAgentsLabel: "并行智能体",
      sendBody: "工作流 {{workflow.name}} 已完成。摘要：{{summary}}",
      sendLabel: "发送",
      summaryLabel: "汇总",
    },
    empty: {
      noRun: "还没有运行记录",
      selectNode: "选择一个节点",
    },
    errors: {
      approve: "批准运行失败。",
      catalog: "刷新目录失败。",
      load: "加载工作区失败。",
      run: "运行工作流失败。",
      save: "保存工作流失败。",
    },
    fields: {
      label: "节点标签",
      prompt: "Prompt",
      nodeId: "节点 ID",
      openclawAgent: "OpenClaw agent",
      position: "位置",
      model: "模型",
      runLabel: "运行标签",
      openclawRun: "OpenClaw run",
      openclawSession: "OpenClaw session",
      openclawTask: "OpenClaw task",
      status: "状态",
      workflow: "工作流",
    },
    metrics: {
      agents: (count) => `${count} 个 agents`,
      channels: (count) => `${count} 个通道`,
      cost: (cost) => cost,
      models: (count) => `${count} 个模型`,
      nodes: (count) => `${count} 个节点`,
      tokens: (count) => `${count} tokens`,
      tools: (count) => `${count} 个工具`,
    },
    nodeTypes: {
      agent: "OpenClaw 调用",
      approval: "人工批准",
      condition: "条件",
      group: "分组",
      note: "备注",
      parallel_agents: "并行智能体",
      send: "发送",
      summary: "汇总",
    },
    panels: {
      catalog: "目录",
      inspector: "检查器",
      nodes: "节点",
      run: "运行",
    },
    status: {
      cancelled: "已取消",
      failed: "失败",
      idle: "空闲",
      queued: "排队中",
      running: "运行中",
      skipped: "已跳过",
      succeeded: "成功",
      waiting_approval: "等待批准",
    },
    events: {
      "node.run.cancelled": "节点已取消",
      "node.run.completed": "节点已完成",
      "node.run.failed": "节点失败",
      "node.run.queued": "节点已排队",
      "node.run.started": "节点已启动",
      "node.run.waiting_approval": "等待人工批准",
      "workflow.run.completed": "工作流已完成",
      "workflow.run.failed": "工作流失败",
      "workflow.run.started": "工作流已启动",
    },
  },
};

export function getInitialLanguage(): Language {
  const stored = localStorage.getItem("openclaw-cui-language");
  if (stored === "en" || stored === "zh-CN") return stored;
  return navigator.language.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

export function translateEventMessage(message: string, language: Language): string {
  if (language !== "zh-CN") return message;

  const patterns: Array<[RegExp, (match: RegExpMatchArray) => string]> = [
    [/^Workflow (.+) started\.$/, (match) => `工作流 ${match[1]} 已开始。`],
    [/^Workflow (.+) completed\.$/, (match) => `工作流 ${match[1]} 已完成。`],
    [/^Workflow (.+) could not continue\. Pending nodes: (.+)\.$/, (match) => `工作流 ${match[1]} 无法继续。待处理节点：${match[2]}。`],
    [/^(.+) queued\.$/, (match) => `${match[1]} 已排队。`],
    [/^(.+) started\.$/, (match) => `${match[1]} 已启动。`],
    [/^(.+) completed\.$/, (match) => `${match[1]} 已完成。`],
    [/^(.+) approved\.$/, (match) => `${match[1]} 已批准。`],
    [/^(.+) is waiting for approval\.$/, (match) => `${match[1]} 正在等待批准。`],
    [/^(.+) failed: (.+)$/, (match) => `${match[1]} 失败：${match[2]}`],
  ];

  for (const [pattern, format] of patterns) {
    const match = message.match(pattern);
    if (match) return format(match);
  }
  return message;
}
