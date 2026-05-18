import type { WorkflowNodeEvent, WorkflowNodeRunStatus, WorkflowNodeType, WorkflowRunStatus } from "@openclaw-cui/shared";

export type Language = "en" | "zh-CN";
export type StatusKey = WorkflowNodeRunStatus | WorkflowRunStatus | "idle";

export interface Messages {
  actions: {
    add: string;
    addNote: string;
    addSavedView: string;
    addTag: string;
    addWidget: string;
    approve: string;
    catalog: string;
    refreshCatalog: string;
    refreshWorkspace: string;
    remove: string;
    run: string;
    runWorkflow: string;
    save: string;
    saveWorkflow: string;
    saveWorkspace: string;
    switchLanguage: string;
  };
  common: {
    allStatuses: string;
    allWorkflows: string;
    defaultModel: string;
    dirtyWorkspace: string;
    fresh: string;
    no: string;
    notLinked: string;
    realTime: string;
    stale: string;
    unknown: string;
    yes: string;
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
    noteBody: string;
    noteLabel: string;
    parallelAgentsLabel: string;
    savedViewName: string;
    sendBody: string;
    sendLabel: string;
    summaryLabel: string;
    tagColor: string;
    tagLabel: string;
    widgetTitle: string;
  };
  empty: {
    noApprovals: string;
    noCatalog: string;
    noNotes: string;
    noRun: string;
    noRuns: string;
    noSavedViews: string;
    noSessions: string;
    noTags: string;
    noTasks: string;
    noWidgets: string;
    selectNode: string;
    selectRun: string;
  };
  errors: {
    approve: string;
    catalog: string;
    load: string;
    run: string;
    save: string;
    workspace: string;
  };
  fields: {
    body: string;
    category: string;
    channels: string;
    description: string;
    label: string;
    model: string;
    nodeId: string;
    openclawAgent: string;
    openclawRun: string;
    openclawSession: string;
    openclawTask: string;
    position: string;
    prompt: string;
    provider: string;
    relatedRun: string;
    relatedWorkflow: string;
    runLabel: string;
    section: string;
    status: string;
    supportsTools: string;
    target: string;
    tagColor: string;
    tagLabel: string;
    title: string;
    updatedAt: string;
    workflow: string;
  };
  metrics: {
    agents: (count: number) => string;
    approvals: (count: number) => string;
    channels: (count: number) => string;
    cost: (cost: string) => string;
    models: (count: number) => string;
    nodes: (count: number) => string;
    notes: (count: number) => string;
    runs: (count: number) => string;
    savedViews: (count: number) => string;
    tags: (count: number) => string;
    tokens: (count: number) => string;
    tools: (count: number) => string;
    widgets: (count: number) => string;
    workflows: (count: number) => string;
  };
  navigation: Record<string, string>;
  nodeTypes: Record<WorkflowNodeType, string>;
  pages: Record<
    string,
    {
      description: string;
      title: string;
    }
  >;
  panels: {
    catalog: string;
    inspector: string;
    nodes: string;
    run: string;
  };
  status: Record<StatusKey, string>;
  tables: {
    agents: string;
    channels: string;
    models: string;
    notes: string;
    savedViews: string;
    sessions: string;
    tags: string;
    tasks: string;
    tools: string;
    widgets: string;
  };
  widgetTypes: Record<"approvals" | "catalog" | "notes" | "runs", string>;
  events: Record<WorkflowNodeEvent["type"], string>;
}

export const messages: Record<Language, Messages> = {
  en: {
    actions: {
      add: "Add",
      addNote: "Add note",
      addSavedView: "Add saved view",
      addTag: "Add tag",
      addWidget: "Add widget",
      approve: "Approve",
      catalog: "Catalog",
      refreshCatalog: "Refresh catalog",
      refreshWorkspace: "Refresh workspace",
      remove: "Remove",
      run: "Run",
      runWorkflow: "Run workflow",
      save: "Save",
      saveWorkflow: "Save workflow",
      saveWorkspace: "Save workspace",
      switchLanguage: "Switch language"
    },
    common: {
      allStatuses: "All statuses",
      allWorkflows: "All workflows",
      defaultModel: "OpenClaw default",
      dirtyWorkspace: "Unsaved workspace state",
      fresh: "fresh",
      no: "No",
      notLinked: "Not linked",
      realTime: "Live runtime view",
      stale: "stale",
      unknown: "Unknown",
      yes: "Yes"
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
      noteBody: "Capture why this run matters, what changed, or what still needs review.",
      noteLabel: "Note",
      parallelAgentsLabel: "Parallel agents",
      savedViewName: "New saved view",
      sendBody: "Workflow {{workflow.name}} completed. Summary: {{summary}}",
      sendLabel: "Send",
      summaryLabel: "Summary",
      tagColor: "#0f766e",
      tagLabel: "Review",
      widgetTitle: "New widget"
    },
    empty: {
      noApprovals: "No pending approvals",
      noCatalog: "Catalog has not been loaded yet",
      noNotes: "No notes yet",
      noRun: "No run yet",
      noRuns: "No workflow runs yet",
      noSavedViews: "No saved views yet",
      noSessions: "No visible runtime sessions",
      noTags: "No tags yet",
      noTasks: "No runtime tasks yet",
      noWidgets: "No dashboard widgets yet",
      selectNode: "Select a node",
      selectRun: "Select a run"
    },
    errors: {
      approve: "Failed to approve run.",
      catalog: "Failed to refresh catalog.",
      load: "Failed to load workspace.",
      run: "Failed to run workflow.",
      save: "Failed to save workflow.",
      workspace: "Failed to save workspace state."
    },
    fields: {
      body: "Body",
      category: "Category",
      channels: "Channels",
      description: "Description",
      label: "Label",
      model: "Model",
      nodeId: "Node ID",
      openclawAgent: "OpenClaw agent",
      openclawRun: "OpenClaw run",
      openclawSession: "OpenClaw session",
      openclawTask: "OpenClaw task",
      position: "Position",
      prompt: "Prompt",
      provider: "Provider",
      relatedRun: "Related run",
      relatedWorkflow: "Related workflow",
      runLabel: "Run label",
      section: "Section",
      status: "Status",
      supportsTools: "Supports tools",
      target: "Target",
      tagColor: "Tag color",
      tagLabel: "Tag label",
      title: "Title",
      updatedAt: "Updated",
      workflow: "Workflow"
    },
    metrics: {
      agents: (count) => `${count} agents`,
      approvals: (count) => `${count} approvals`,
      channels: (count) => `${count} channels`,
      cost: (cost) => cost,
      models: (count) => `${count} models`,
      nodes: (count) => `${count} nodes`,
      notes: (count) => `${count} notes`,
      runs: (count) => `${count} runs`,
      savedViews: (count) => `${count} saved views`,
      tags: (count) => `${count} tags`,
      tokens: (count) => `${count} tokens`,
      tools: (count) => `${count} tools`,
      widgets: (count) => `${count} widgets`,
      workflows: (count) => `${count} workflows`
    },
    navigation: {
      company: "Company",
      workflow: "Workflow",
      runs: "Runs",
      approvals: "Approvals",
      dashboard: "Dashboard",
      views: "Saved views",
      notes: "Notes",
      catalog: "Catalog"
    },
    nodeTypes: {
      agent: "OpenClaw call",
      approval: "Approval",
      condition: "Condition",
      group: "Group",
      note: "Note",
      parallel_agents: "Parallel agents",
      send: "Send",
      summary: "Summary"
    },
    pages: {
      company: {
        title: "Company Context",
        description: "Switch the active company, inspect company-level usage, and keep workflow data scoped to a single operator context."
      },
      workflow: {
        title: "Workflow Studio",
        description: "Edit graph structure, configure node execution, and inspect the latest run."
      },
      runs: {
        title: "Run Center",
        description: "Browse workflow run history, node outputs, and execution evidence."
      },
      approvals: {
        title: "Approval Queue",
        description: "Handle workflow pauses that are waiting on a human decision."
      },
      dashboard: {
        title: "Dashboard Widgets",
        description: "Curate the overview surface that CUI owns for runs, catalog health, and notes."
      },
      views: {
        title: "Saved Views",
        description: "Persist reusable run or workflow filters so operators can jump to common slices."
      },
      notes: {
        title: "Notes and Tags",
        description: "Keep CUI-owned annotations, tags, and review context separate from OpenClaw execution facts."
      },
      catalog: {
        title: "Catalog and Runtime",
        description: "Inspect the latest OpenClaw catalog snapshot and visible runtime sessions."
      }
    },
    panels: {
      catalog: "Catalog",
      inspector: "Inspector",
      nodes: "Nodes",
      run: "Run"
    },
    status: {
      cancelled: "cancelled",
      failed: "failed",
      idle: "idle",
      queued: "queued",
      running: "running",
      skipped: "skipped",
      succeeded: "succeeded",
      waiting_approval: "waiting approval"
    },
    tables: {
      agents: "Agents",
      channels: "Channels",
      models: "Models",
      notes: "Notes",
      savedViews: "Saved views",
      sessions: "Sessions",
      tags: "Tags",
      tasks: "Tasks",
      tools: "Tools",
      widgets: "Widgets"
    },
    widgetTypes: {
      approvals: "Approval queue",
      catalog: "Catalog health",
      notes: "Notes feed",
      runs: "Recent runs"
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
      "workflow.run.started": "Workflow started"
    }
  },
  "zh-CN": {
    actions: {
      add: "添加",
      addNote: "添加笔记",
      addSavedView: "添加视图",
      addTag: "添加标签",
      addWidget: "添加卡片",
      approve: "批准",
      catalog: "目录",
      refreshCatalog: "刷新目录",
      refreshWorkspace: "刷新工作区",
      remove: "移除",
      run: "运行",
      runWorkflow: "运行工作流",
      save: "保存",
      saveWorkflow: "保存工作流",
      saveWorkspace: "保存工作区",
      switchLanguage: "切换语言"
    },
    common: {
      allStatuses: "全部状态",
      allWorkflows: "全部工作流",
      defaultModel: "OpenClaw 默认",
      dirtyWorkspace: "工作区状态未保存",
      fresh: "新鲜",
      no: "否",
      notLinked: "未关联",
      realTime: "运行时视图",
      stale: "过期",
      unknown: "未知",
      yes: "是"
    },
    defaults: {
      agentLabel: "OpenClaw 调用",
      agentName: "agent",
      agentPrompt: "通过 OpenClaw 执行这个 CUI 节点。",
      approvalInstructions: "审核汇总后的输出。",
      approvalLabel: "人工审批",
      approvalOwner: "负责人",
      conditionLabel: "条件",
      groupLabel: "分组",
      noteBody: "记录这次运行为什么重要、发生了什么变化，或还需要谁复核。",
      noteLabel: "备注",
      parallelAgentsLabel: "并行代理",
      savedViewName: "新建视图",
      sendBody: "工作流 {{workflow.name}} 已完成。摘要：{{summary}}",
      sendLabel: "发送",
      summaryLabel: "汇总",
      tagColor: "#0f766e",
      tagLabel: "待复核",
      widgetTitle: "新建卡片"
    },
    empty: {
      noApprovals: "当前没有待审批项",
      noCatalog: "目录尚未加载",
      noNotes: "还没有笔记",
      noRun: "还没有运行记录",
      noRuns: "还没有工作流运行记录",
      noSavedViews: "还没有保存的视图",
      noSessions: "当前没有可见运行会话",
      noTags: "还没有标签",
      noTasks: "当前没有运行任务",
      noWidgets: "还没有仪表板卡片",
      selectNode: "请选择一个节点",
      selectRun: "请选择一条运行记录"
    },
    errors: {
      approve: "批准运行失败。",
      catalog: "刷新目录失败。",
      load: "加载工作区失败。",
      run: "运行工作流失败。",
      save: "保存工作流失败。",
      workspace: "保存工作区状态失败。"
    },
    fields: {
      body: "内容",
      category: "分类",
      channels: "通道",
      description: "说明",
      label: "标签",
      model: "模型",
      nodeId: "节点 ID",
      openclawAgent: "OpenClaw agent",
      openclawRun: "OpenClaw run",
      openclawSession: "OpenClaw session",
      openclawTask: "OpenClaw task",
      position: "位置",
      prompt: "Prompt",
      provider: "提供方",
      relatedRun: "关联运行",
      relatedWorkflow: "关联工作流",
      runLabel: "运行标签",
      section: "页面",
      status: "状态",
      supportsTools: "支持工具",
      target: "目标",
      tagColor: "标签颜色",
      tagLabel: "标签名称",
      title: "标题",
      updatedAt: "更新时间",
      workflow: "工作流"
    },
    metrics: {
      agents: (count) => `${count} 个 agents`,
      approvals: (count) => `${count} 个审批`,
      channels: (count) => `${count} 个通道`,
      cost: (cost) => cost,
      models: (count) => `${count} 个模型`,
      nodes: (count) => `${count} 个节点`,
      notes: (count) => `${count} 条笔记`,
      runs: (count) => `${count} 次运行`,
      savedViews: (count) => `${count} 个视图`,
      tags: (count) => `${count} 个标签`,
      tokens: (count) => `${count} tokens`,
      tools: (count) => `${count} 个工具`,
      widgets: (count) => `${count} 张卡片`,
      workflows: (count) => `${count} 个工作流`
    },
    navigation: {
      workflow: "工作流",
      runs: "运行",
      approvals: "审批",
      dashboard: "仪表板",
      views: "视图",
      notes: "笔记",
      catalog: "目录"
    },
    nodeTypes: {
      agent: "OpenClaw 调用",
      approval: "人工审批",
      condition: "条件",
      group: "分组",
      note: "备注",
      parallel_agents: "并行代理",
      send: "发送",
      summary: "汇总"
    },
    pages: {
      workflow: {
        title: "工作流工作台",
        description: "编辑图结构、配置节点执行方式，并查看该工作流最近一次运行。"
      },
      runs: {
        title: "运行中心",
        description: "查看工作流运行历史、节点输出和执行证据。"
      },
      approvals: {
        title: "审批队列",
        description: "处理因为人工决策而暂停的工作流。"
      },
      dashboard: {
        title: "仪表板卡片",
        description: "维护由 CUI 持有的总览界面，包括运行概览、目录健康度和笔记卡片。"
      },
      views: {
        title: "保存视图",
        description: "保存可复用的工作流或运行筛选条件，方便快速回到常用观察切片。"
      },
      notes: {
        title: "笔记与标签",
        description: "把 CUI 自有的标注、标签和复核上下文与 OpenClaw 的执行事实分离。"
      },
      catalog: {
        title: "目录与运行时",
        description: "查看最新 OpenClaw 目录快照，以及当前可见的运行会话和任务。"
      }
    },
    panels: {
      catalog: "目录",
      inspector: "检查器",
      nodes: "节点",
      run: "运行"
    },
    status: {
      cancelled: "已取消",
      failed: "失败",
      idle: "空闲",
      queued: "排队中",
      running: "运行中",
      skipped: "已跳过",
      succeeded: "成功",
      waiting_approval: "等待审批"
    },
    tables: {
      agents: "Agents",
      channels: "通道",
      models: "模型",
      notes: "笔记",
      savedViews: "保存视图",
      sessions: "会话",
      tags: "标签",
      tasks: "任务",
      tools: "工具",
      widgets: "卡片"
    },
    widgetTypes: {
      approvals: "审批队列",
      catalog: "目录健康度",
      notes: "笔记流",
      runs: "最近运行"
    },
    events: {
      "node.run.cancelled": "节点已取消",
      "node.run.completed": "节点已完成",
      "node.run.failed": "节点失败",
      "node.run.queued": "节点已排队",
      "node.run.started": "节点已启动",
      "node.run.waiting_approval": "等待人工审批",
      "workflow.run.completed": "工作流已完成",
      "workflow.run.failed": "工作流失败",
      "workflow.run.started": "工作流已启动"
    }
  }
};

export function getInitialLanguage(): Language {
  const stored = localStorage.getItem("openclaw-cui-language");
  if (stored === "en" || stored === "zh-CN") return stored;
  return navigator.language.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

export function translateEventMessage(message: string, language: Language): string {
  if (language !== "zh-CN") return message;

  const patterns: Array<[RegExp, (match: RegExpMatchArray) => string]> = [
    [/^Workflow (.+) started\.$/, (match) => `工作流 ${match[1]} 已启动。`],
    [/^Workflow (.+) completed\.$/, (match) => `工作流 ${match[1]} 已完成。`],
    [/^Workflow (.+) could not continue\. Pending nodes: (.+)\.$/, (match) => `工作流 ${match[1]} 无法继续。待处理节点：${match[2]}。`],
    [/^(.+) queued\.$/, (match) => `${match[1]} 已排队。`],
    [/^(.+) started\.$/, (match) => `${match[1]} 已启动。`],
    [/^(.+) completed\.$/, (match) => `${match[1]} 已完成。`],
    [/^(.+) approved\.$/, (match) => `${match[1]} 已批准。`],
    [/^(.+) is waiting for approval\.$/, (match) => `${match[1]} 正在等待审批。`],
    [/^(.+) failed: (.+)$/, (match) => `${match[1]} 失败：${match[2]}`]
  ];

  for (const [pattern, format] of patterns) {
    const match = message.match(pattern);
    if (match) return format(match);
  }
  return message;
}
