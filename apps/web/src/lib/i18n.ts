import type { WorkflowNodeEvent, WorkflowNodeRunStatus, WorkflowNodeType, WorkflowRunStatus } from "@openclaw-cui/shared";

export type Language = "en" | "zh-CN";
export type StatusKey = WorkflowNodeRunStatus | WorkflowRunStatus | "idle";

export interface Messages {
  actions: {
    add: string;
    addNote: string;
    addAgent: string;
    addChannel: string;
    addModel: string;
    addParallelAgent: string;
    addSavedView: string;
    addSkill: string;
    addTag: string;
    addWidget: string;
    approve: string;
    catalog: string;
    createWorkflow: string;
    deleteNode: string;
    disableNode: string;
    enableNode: string;
    exportWorkflow: string;
    importWorkflow: string;
    refreshCatalog: string;
    refreshWorkspace: string;
    remove: string;
    run: string;
    runWorkflow: string;
    save: string;
    saveModel: string;
    saveWorkflow: string;
    saveWorkspace: string;
    switchLanguage: string;
  };
  common: {
    allStatuses: string;
    allWorkflows: string;
    brandTagline: string;
    defaultModel: string;
    defaultOption: string;
    dirtyWorkspace: string;
    fresh: string;
    no: string;
    noDefaultModel: string;
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
    loopLabel: string;
    managerLabel: string;
    managerInstructions: string;
    managerSlotLabel: string;
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
    noNodeOutput: string;
    noParallelAgents: string;
    noNotes: string;
    noRun: string;
    noRunHistory: string;
    noRuns: string;
    noSavedViews: string;
    noSessions: string;
    noSkills: string;
    noTags: string;
    noTasks: string;
    noWidgets: string;
    selectNode: string;
    selectRun: string;
    selectSkill: string;
    selectWorkflow: string;
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
    agentName: string;
    approver: string;
    expression: string;
    instructions: string;
    label: string;
    manager: string;
    maxHandoffs: string;
    maxIterations: string;
    model: string;
    mode: string;
    nodeId: string;
    openclawAgent: string;
    openclawRun: string;
    openclawSession: string;
    openclawTask: string;
    output: string;
    position: string;
    ports: string;
    primaryModel: string;
    prompt: string;
    provider: string;
    relatedRun: string;
    relatedWorkflow: string;
    runLabel: string;
    section: string;
    skills: string;
    slot: string;
    status: string;
    supportsTools: string;
    target: string;
    tagColor: string;
    tagLabel: string;
    title: string;
    updatedAt: string;
    waitFor: string;
    workflow: string;
    workspace: string;
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
  catalogConfig: {
    addAgentDescription: string;
    configFallback: string;
    defaultModelDescription: string;
    quickConfig: string;
    workspacePlaceholder: string;
  };
  options: {
    firstSuccess: string;
    openClawAgent: string;
    structuredMerge: string;
    waitForAll: string;
  };
  trace: {
    completed: string;
    currentIssue: (label: string) => string;
    description: string;
    flowFinished: string;
    flowStarted: string;
    inProgress: string;
    issueList: string;
    managerInputBody: string;
    managerInputPreview: string;
    managerInputWaiting: string;
    modelOutput: string;
    noOutput: string;
    pending: string;
    runOption: (runId: string, startedAt: string) => string;
    slotInputSuffix: string;
    slotOutputSuffix: string;
    title: string;
    waitingNestedNodes: string;
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
      addAgent: "Add agent",
      addChannel: "Add channel",
      addModel: "Add model",
      addParallelAgent: "Add parallel agent",
      addSavedView: "Add saved view",
      addSkill: "Add skill",
      addTag: "Add tag",
      addWidget: "Add widget",
      approve: "Approve",
      catalog: "Catalog",
      createWorkflow: "New workflow",
      deleteNode: "Delete node",
      disableNode: "Disable node",
      enableNode: "Enable node",
      exportWorkflow: "Export",
      importWorkflow: "Import",
      refreshCatalog: "Refresh config data",
      refreshWorkspace: "Refresh workspace",
      remove: "Remove",
      run: "Run",
      runWorkflow: "Run workflow",
      save: "Save",
      saveModel: "Save model",
      saveWorkflow: "Save workflow",
      saveWorkspace: "Save workspace",
      switchLanguage: "Switch language"
    },
    common: {
      allStatuses: "All statuses",
      allWorkflows: "All workflows",
      brandTagline: "CUI-owned orchestration surface",
      defaultModel: "OpenClaw default",
      defaultOption: "default",
      dirtyWorkspace: "Unsaved workspace state",
      fresh: "fresh",
      no: "No",
      noDefaultModel: "No default model configured",
      notLinked: "Not linked",
      realTime: "Runtime overview",
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
      loopLabel: "Loop",
      managerLabel: "Manager",
      managerInstructions:
        "Route work through numbered slots. Agents may return JSON with status and nextSlot or returnToSlot.",
      managerSlotLabel: "Slot",
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
      noCatalog: "Config data has not been loaded yet",
      noNodeOutput: "This node has no output yet.",
      noParallelAgents: "No parallel agents configured",
      noNotes: "No notes yet",
      noRun: "No run yet",
      noRunHistory: "This workflow has no run history yet.",
      noRuns: "No workflow runs yet",
      noSavedViews: "No saved views yet",
      noSessions: "No visible runtime sessions",
      noSkills: "No skills added",
      noTags: "No tags yet",
      noTasks: "No runtime tasks yet",
      noWidgets: "No overview widgets yet",
      selectNode: "Select a node",
      selectRun: "Select a run",
      selectSkill: "Select a skill",
      selectWorkflow: "No workflow is selected."
    },
    errors: {
      approve: "Failed to approve run.",
      catalog: "Failed to refresh config data.",
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
      agentName: "Agent name",
      approver: "Approver",
      expression: "Expression",
      instructions: "Instructions",
      label: "Label",
      manager: "Manager",
      maxHandoffs: "Max handoffs",
      maxIterations: "Max iterations",
      model: "Model",
      mode: "Mode",
      nodeId: "Node ID",
      openclawAgent: "OpenClaw Agent",
      openclawRun: "OpenClaw 运行",
      openclawSession: "OpenClaw 会话",
      openclawTask: "OpenClaw 任务",
      output: "Output",
      position: "Position",
      ports: "Ports",
      primaryModel: "Primary model",
      prompt: "提示词",
      provider: "Provider",
      relatedRun: "Related run",
      relatedWorkflow: "Related workflow",
      runLabel: "Run label",
      section: "Section",
      skills: "Skills",
      slot: "Slot",
      status: "Status",
      supportsTools: "Supports tools",
      target: "Target",
      tagColor: "Tag color",
      tagLabel: "Tag label",
      title: "Title",
      updatedAt: "Updated",
      waitFor: "Wait for",
      workflow: "Workflow",
      workspace: "Workspace"
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
      widgets: (count) => `${count} overview widgets`,
      workflows: (count) => `${count} workflows`
    },
    navigation: {
      company: "Company",
      workflow: "Workflow",
      runs: "Runs",
      approvals: "Approvals",
      models: "Models",
      agents: "Agents",
      schedule: "Schedule",
      channels: "Channels"
    },
    nodeTypes: {
      agent: "OpenClaw call",
      approval: "Approval",
      condition: "Condition",
      group: "Group",
      loop: "Loop",
      manager: "管理器",
      manager_slot: "槽位",
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
      models: {
        title: "Models",
        description: "Choose the OpenClaw default model and inspect available model capability."
      },
      agents: {
        title: "Agents",
        description: "Create configured OpenClaw agents and inspect available agents separately from workflows."
      },
      schedule: {
        title: "Schedule",
        description: "Monitor runtime sessions and task queue state for follow-up configuration."
      },
      channels: {
        title: "Channels",
        description: "Inspect delivery channels and tool availability for fast channel configuration."
      }
    },
    panels: {
      catalog: "Catalog",
      inspector: "Inspector",
      nodes: "Nodes",
      run: "Run"
    },
    catalogConfig: {
      addAgentDescription: "Creates an OpenClaw agent entry using the same config fields as `openclaw agents add`.",
      configFallback: "Read and write OpenClaw config from ~/.openclaw/openclaw.json.",
      defaultModelDescription: "Writes to the active OpenClaw config and refreshes the catalog.",
      quickConfig: "OpenClaw Quick Config",
      workspacePlaceholder: "Leave blank to auto-generate"
    },
    options: {
      firstSuccess: "first success",
      openClawAgent: "OpenClaw agent",
      structuredMerge: "structured merge",
      waitForAll: "all"
    },
    trace: {
      completed: "Completed",
      currentIssue: (label) => `Current issue: ${label}`,
      description: "Review issues in linear task order on the left, and read node output on the right.",
      flowFinished: "Flow finished",
      flowStarted: "Flow started",
      inProgress: "In progress",
      issueList: "Issue list",
      managerInputBody: "Manager handed work into this slot. The nested node outputs are shown between this input and the slot output.",
      managerInputPreview: "Manager input entered this slot.",
      managerInputWaiting: "Waiting for manager input.",
      modelOutput: "Model output",
      noOutput: "No output yet",
      pending: "Pending",
      runOption: (runId, startedAt) => `Run ${runId.slice(-6)} · ${startedAt}`,
      slotInputSuffix: "input",
      slotOutputSuffix: "output",
      title: "Flow Trace",
      waitingNestedNodes: "Waiting for nested nodes to finish."
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
      widgets: "Overview widgets"
    },
    widgetTypes: {
      approvals: "Approval queue",
      catalog: "Config health",
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
      addAgent: "添加 Agent",
      addChannel: "添加频道",
      addModel: "添加模型",
      addParallelAgent: "添加并行 Agent",
      addSavedView: "添加视图",
      addSkill: "添加 Skill",
      addTag: "添加标签",
      addWidget: "添加卡片",
      approve: "批准",
      catalog: "目录",
      createWorkflow: "新建工作流",
      deleteNode: "删除节点",
      disableNode: "禁用节点",
      enableNode: "启用节点",
      exportWorkflow: "导出",
      importWorkflow: "导入",
      refreshCatalog: "刷新配置数据",
      refreshWorkspace: "刷新工作区",
      remove: "移除",
      run: "运行",
      runWorkflow: "运行工作流",
      save: "保存",
      saveModel: "保存模型",
      saveWorkflow: "保存工作流",
      saveWorkspace: "保存工作区",
      switchLanguage: "切换语言"
    },
    common: {
      allStatuses: "全部状态",
      allWorkflows: "全部工作流",
      brandTagline: "CUI 持有的编排工作台",
      defaultModel: "OpenClaw 默认",
      defaultOption: "默认",
      dirtyWorkspace: "工作区状态未保存",
      fresh: "新鲜",
      no: "否",
      noDefaultModel: "尚未配置默认模型",
      notLinked: "未关联",
      realTime: "运行时总览",
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
      loopLabel: "循环",
      managerLabel: "管理器",
      managerInstructions: "通过编号槽位路由任务。Agent 可以返回包含 status、nextSlot 或 returnToSlot 的 JSON。",
      managerSlotLabel: "槽位",
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
      noCatalog: "配置数据尚未加载",
      noNodeOutput: "这个节点还没有输出。",
      noParallelAgents: "还没有配置并行 Agent",
      noNotes: "还没有笔记",
      noRun: "还没有运行记录",
      noRunHistory: "这个工作流还没有运行历史。",
      noRuns: "还没有工作流运行记录",
      noSavedViews: "还没有保存的视图",
      noSessions: "当前没有可见运行会话",
      noSkills: "还没有添加 Skill",
      noTags: "还没有标签",
      noTasks: "当前没有运行任务",
      noWidgets: "还没有总览卡片",
      selectNode: "请选择一个节点",
      selectRun: "请选择一条运行记录",
      selectSkill: "选择一个 Skill",
      selectWorkflow: "当前未选中工作流。"
    },
    errors: {
      approve: "批准运行失败。",
      catalog: "刷新配置数据失败。",
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
      agentName: "Agent 名称",
      approver: "审批人",
      expression: "表达式",
      instructions: "说明",
      label: "标签",
      manager: "管理器",
      maxHandoffs: "最大交接次数",
      maxIterations: "最大迭代次数",
      model: "模型",
      mode: "模式",
      nodeId: "节点 ID",
      openclawAgent: "OpenClaw agent",
      openclawRun: "OpenClaw run",
      openclawSession: "OpenClaw session",
      openclawTask: "OpenClaw task",
      output: "输出",
      position: "位置",
      ports: "端口",
      primaryModel: "主模型",
      prompt: "Prompt",
      provider: "提供方",
      relatedRun: "关联运行",
      relatedWorkflow: "关联工作流",
      runLabel: "运行标签",
      section: "页面",
      skills: "技能",
      slot: "槽位",
      status: "状态",
      supportsTools: "支持工具",
      target: "目标",
      tagColor: "标签颜色",
      tagLabel: "标签名称",
      title: "标题",
      updatedAt: "更新时间",
      waitFor: "等待条件",
      workflow: "工作流",
      workspace: "工作区"
    },
    metrics: {
      agents: (count) => `${count} 个 Agent`,
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
      widgets: (count) => `${count} 张总览卡片`,
      workflows: (count) => `${count} 个工作流`
    },
    navigation: {
      company: "公司",
      workflow: "工作流",
      runs: "运行",
      approvals: "审批",
      models: "模型",
      agents: "Agent",
      schedule: "Schedule",
      channels: "Channel"
    },
    nodeTypes: {
      agent: "OpenClaw 调用",
      approval: "人工审批",
      condition: "条件",
      group: "分组",
      loop: "循环",
      manager: "Manager",
      manager_slot: "Slot",
      note: "备注",
      parallel_agents: "并行 Agent",
      send: "发送",
      summary: "汇总"
    },
    pages: {
      company: {
        title: "公司上下文",
        description: "切换当前公司、查看公司级用量，并在同一页面维护总览卡片。"
      },
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
      models: {
        title: "模型",
        description: "选择 OpenClaw 默认模型，并查看可用模型能力。"
      },
      agents: {
        title: "Agent",
        description: "创建已配置 OpenClaw Agent，并把可用 Agent 与工作流配置分开查看。"
      },
      schedule: {
        title: "Schedule",
        description: "查看运行时会话和任务队列，为后续快速排期配置留出独立入口。"
      },
      channels: {
        title: "Channel",
        description: "查看交付通道和工具可用性，为后续快速通道配置留出独立入口。"
      }
    },
    panels: {
      catalog: "目录",
      inspector: "检查器",
      nodes: "节点",
      run: "运行"
    },
    catalogConfig: {
      addAgentDescription: "使用与 `openclaw agents add` 相同的配置字段创建 OpenClaw agent 条目。",
      configFallback: "读取并写入 ~/.openclaw/openclaw.json 中的 OpenClaw 配置。",
      defaultModelDescription: "写入当前 OpenClaw 配置，并刷新目录。",
      quickConfig: "OpenClaw 快速配置",
      workspacePlaceholder: "留空则自动生成"
    },
    options: {
      firstSuccess: "首个成功",
      openClawAgent: "OpenClaw Agent",
      structuredMerge: "结构化合并",
      waitForAll: "全部完成"
    },
    trace: {
      completed: "已完成",
      currentIssue: (label) => `当前事项：${label}`,
      description: "左侧按任务顺序查看事项，右侧查看节点输出。",
      flowFinished: "流程结束",
      flowStarted: "流程开始",
      inProgress: "进行中",
      issueList: "事项列表",
      managerInputBody: "管理器已将工作交给该槽位。嵌套节点输出会显示在槽位输入和槽位输出之间。",
      managerInputPreview: "管理器输入已进入该槽位。",
      managerInputWaiting: "等待管理器输入。",
      modelOutput: "模型输出",
      noOutput: "暂无输出",
      pending: "待处理",
      runOption: (runId, startedAt) => `运行 ${runId.slice(-6)} · ${startedAt}`,
      slotInputSuffix: "输入",
      slotOutputSuffix: "输出",
      title: "流程追踪",
      waitingNestedNodes: "等待嵌套节点完成。"
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
      agents: "Agent",
      channels: "通道",
      models: "模型",
      notes: "笔记",
      savedViews: "保存视图",
      sessions: "会话",
      tags: "标签",
      tasks: "任务",
      tools: "工具",
      widgets: "总览卡片"
    },
    widgetTypes: {
      approvals: "审批队列",
      catalog: "配置状态",
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
