import type { MissionNodeEvent, MissionNodeRunStatus, MissionNodeType, MissionRunStatus } from "@hiveward/shared";

export type Language = "en" | "zh-CN";
export type StatusKey = MissionNodeRunStatus | MissionRunStatus | "idle";

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
    createMission: string;
    deleteNode: string;
    disableNode: string;
    enableNode: string;
    exportMission: string;
    importMission: string;
    refreshCatalog: string;
    refreshWorkspace: string;
    remove: string;
    run: string;
    runMission: string;
    save: string;
    saveModel: string;
    saveMission: string;
    saveWorkspace: string;
    switchLanguage: string;
  };
  common: {
    allStatuses: string;
    allMissions: string;
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
    agentName: string;
    openClawAgentLabel: string;
    openClawAgentPrompt: string;
    codexAgentLabel: string;
    codexAgentPrompt: string;
    claudeCodeAgentLabel: string;
    claudeCodeAgentPrompt: string;
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
    selectMission: string;
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
    advancedSettings: string;
    advancedSettingsHint: string;
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
    output: string;
    position: string;
    ports: string;
    primaryModel: string;
    prompt: string;
    provider: string;
    relatedRun: string;
    relatedMission: string;
    runLabel: string;
    section: string;
    settings: string;
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
    mission: string;
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
    missions: (count: number) => string;
  };
  navigation: Record<string, string>;
  nodeTypes: Record<MissionNodeType, string>;
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
  events: Record<MissionNodeEvent["type"], string>;
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
      createMission: "新建 Mission",
      deleteNode: "Delete node",
      disableNode: "Disable node",
      enableNode: "Enable node",
      exportMission: "导出 Mission",
      importMission: "导入 Mission",
      refreshCatalog: "Refresh config data",
      refreshWorkspace: "Refresh workspace",
      remove: "Remove",
      run: "Start task",
      runMission: "启动 Mission",
      save: "Save",
      saveModel: "Save model",
      saveMission: "保存 Mission",
      saveWorkspace: "Save workspace",
      switchLanguage: "Switch language"
    },
    common: {
      allStatuses: "All statuses",
      allMissions: "全部 Mission",
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
      agentName: "agent",
      openClawAgentLabel: "OpenClaw Agent",
      openClawAgentPrompt: "Execute this Hiveward mission node through the selected OpenClaw agent.",
      codexAgentLabel: "Codex Agent",
      codexAgentPrompt: "Execute this Hiveward mission node through Codex SDK.",
      claudeCodeAgentLabel: "Claude Code Agent",
      claudeCodeAgentPrompt: "Execute this Hiveward mission node through Claude Code SDK.",
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
      sendBody: "Mission {{mission.name}} completed. Summary: {{summary}}",
      sendLabel: "Send",
      summaryLabel: "Summary",
      tagColor: "#0f766e",
      tagLabel: "Review",
      widgetTitle: "New widget"
    },
    empty: {
      noApprovals: "Inbox is empty",
      noCatalog: "Config data has not been loaded yet",
      noNodeOutput: "This node has no output yet.",
      noParallelAgents: "No parallel agents configured",
      noNotes: "No notes yet",
      noRun: "No task yet",
      noRunHistory: "这个 Mission 还没有运行记录。",
      noRuns: "还没有 Mission 运行",
      noSavedViews: "No saved views yet",
      noSessions: "No visible runtime sessions",
      noSkills: "No skills added",
      noTags: "No tags yet",
      noTasks: "No runtime tasks yet",
      noWidgets: "No overview widgets yet",
      selectNode: "Select a node",
      selectRun: "Select a task",
      selectSkill: "Select a skill",
      selectMission: "尚未选择 Mission。"
    },
    errors: {
      approve: "Failed to approve run.",
      catalog: "Failed to refresh config data.",
      load: "Failed to load workspace.",
      run: "Failed to start task.",
      save: "Failed to save mission.",
      workspace: "Failed to save workspace state."
    },
    fields: {
      advancedSettings: "Advanced settings",
      advancedSettingsHint: "Model, identity, permission, workspace, timeout, output",
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
      output: "Output",
      position: "Position",
      ports: "Ports",
      primaryModel: "Primary model",
      prompt: "提示词",
      provider: "Provider",
      relatedRun: "Related task",
      relatedMission: "Related mission",
      runLabel: "Task label",
      section: "Section",
      settings: "Settings",
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
      mission: "Mission",
      workspace: "Workspace"
    },
    metrics: {
      agents: (count) => `${count} agents`,
      approvals: (count) => `${count} inbox items`,
      channels: (count) => `${count} channels`,
      cost: (cost) => cost,
      models: (count) => `${count} models`,
      nodes: (count) => `${count} nodes`,
      notes: (count) => `${count} notes`,
      runs: (count) => `${count} tasks`,
      savedViews: (count) => `${count} saved views`,
      tags: (count) => `${count} tags`,
      tokens: (count) => `${count} tokens`,
      tools: (count) => `${count} tools`,
      widgets: (count) => `${count} overview widgets`,
      missions: (count) => `${count} missions`
    },
    navigation: {
      company: "Company",
      mission: "Mission",
      runs: "Tasks",
      approvals: "Inbox",
      models: "Models",
      agents: "Agents",
      schedule: "Schedule",
      channels: "Channels"
    },
    nodeTypes: {
      openclaw_agent: "OpenClaw Agent",
      codex_agent: "Codex Agent",
      claude_code_agent: "Claude Code Agent",
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
        description: "Switch the active company, inspect company-level usage, and keep mission data scoped to a single operator context."
      },
      mission: {
        title: "Mission Studio",
        description: "Command agent teams through mission structure, handoffs, gates, and run evidence."
      },
      runs: {
        title: "Tasks",
        description: "Track mission runs, agent outputs, and execution evidence."
      },
      approvals: {
        title: "Inbox",
        description: "Handle mission pauses that are waiting on a human decision."
      },
      models: {
        title: "Models",
        description: "Choose the OpenClaw default model and inspect available model capability."
      },
      agents: {
        title: "Agents",
        description: "Create configured OpenClaw agents and inspect available agents separately from missions."
      },
      schedule: {
        title: "Schedule",
        description: "Pick a calendar date and review records from that day."
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
      run: "Task"
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
      currentIssue: (label) => `Current step: ${label}`,
      description: "Review mission progress on the left, and read agent output on the right.",
      flowFinished: "Mission finished",
      flowStarted: "Mission started",
      inProgress: "In progress",
      issueList: "Task steps",
      managerInputBody: "Manager handed work into this slot. The nested node outputs are shown between this input and the slot output.",
      managerInputPreview: "Manager input entered this slot.",
      managerInputWaiting: "Waiting for manager input.",
      modelOutput: "Current output",
      noOutput: "No output yet",
      pending: "Pending",
      runOption: (runId, startedAt) => `Task ${runId.slice(-6)} · ${startedAt}`,
      slotInputSuffix: "input",
      slotOutputSuffix: "output",
      title: "Task Progress",
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
      waiting_approval: "waiting for inbox"
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
      approvals: "Inbox",
      catalog: "Config health",
      notes: "Notes feed",
      runs: "Recent tasks"
    },
    events: {
      "node.run.cancelled": "Node cancelled",
      "node.run.completed": "Node completed",
      "node.run.failed": "Node failed",
      "node.run.queued": "Node queued",
      "node.run.started": "Node started",
      "node.run.waiting_approval": "Waiting for inbox",
      "mission.run.completed": "Mission completed",
      "mission.run.failed": "Mission failed",
      "mission.run.started": "Mission started"
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
      createMission: "New mission",
      deleteNode: "删除节点",
      disableNode: "禁用节点",
      enableNode: "启用节点",
      exportMission: "Export mission",
      importMission: "Import mission",
      refreshCatalog: "刷新配置数据",
      refreshWorkspace: "刷新工作区",
      remove: "移除",
      run: "启动任务",
      runMission: "Start mission",
      save: "保存",
      saveModel: "保存模型",
      saveMission: "Save mission",
      saveWorkspace: "保存工作区",
      switchLanguage: "切换语言"
    },
    common: {
      allStatuses: "全部状态",
      allMissions: "All missions",
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
      agentName: "agent",
      openClawAgentLabel: "OpenClaw Agent",
      openClawAgentPrompt: "Execute this Hiveward mission node through the selected OpenClaw agent.",
      codexAgentLabel: "Codex Agent",
      codexAgentPrompt: "Execute this Hiveward mission node through Codex SDK.",
      claudeCodeAgentLabel: "Claude Code Agent",
      claudeCodeAgentPrompt: "Execute this Hiveward mission node through Claude Code SDK.",
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
      sendBody: "Mission {{mission.name}} completed. Summary: {{summary}}",
      sendLabel: "发送",
      summaryLabel: "汇总",
      tagColor: "#0f766e",
      tagLabel: "待复核",
      widgetTitle: "新建卡片"
    },
    empty: {
      noApprovals: "收件箱为空",
      noCatalog: "配置数据尚未加载",
      noNodeOutput: "这个节点还没有输出。",
      noParallelAgents: "还没有配置并行 Agent",
      noNotes: "还没有笔记",
      noRun: "还没有任务",
      noRunHistory: "This mission has no run activity yet.",
      noRuns: "No mission runs yet",
      noSavedViews: "还没有保存的视图",
      noSessions: "当前没有可见运行会话",
      noSkills: "还没有添加 Skill",
      noTags: "还没有标签",
      noTasks: "当前没有运行任务",
      noWidgets: "还没有总览卡片",
      selectNode: "请选择一个节点",
      selectRun: "请选择一个任务",
      selectSkill: "选择一个 Skill",
      selectMission: "No mission is selected."
    },
    errors: {
      approve: "批准运行失败。",
      catalog: "刷新配置数据失败。",
      load: "加载工作区失败。",
      run: "启动任务失败。",
      save: "保存 Mission 失败。",
      workspace: "保存工作区状态失败。"
    },
    fields: {
      advancedSettings: "\u9ad8\u7ea7\u8bbe\u7f6e",
      advancedSettingsHint: "\u6a21\u578b\u3001\u8eab\u4efd\u3001\u6743\u9650\u3001\u5de5\u4f5c\u533a\u3001\u8d85\u65f6\u3001\u8f93\u51fa",
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
      output: "输出",
      position: "位置",
      ports: "端口",
      primaryModel: "主模型",
      prompt: "Prompt",
      provider: "提供方",
      relatedRun: "关联任务",
      relatedMission: "关联 Mission",
      runLabel: "任务标签",
      section: "页面",
      settings: "设置",
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
      mission: "Mission",
      workspace: "工作区"
    },
    metrics: {
      agents: (count) => `${count} 个 Agent`,
      approvals: (count) => `${count} 个收件箱项`,
      channels: (count) => `${count} 个通道`,
      cost: (cost) => cost,
      models: (count) => `${count} 个模型`,
      nodes: (count) => `${count} 个节点`,
      notes: (count) => `${count} 条笔记`,
      runs: (count) => `${count} 个任务`,
      savedViews: (count) => `${count} 个视图`,
      tags: (count) => `${count} 个标签`,
      tokens: (count) => `${count} tokens`,
      tools: (count) => `${count} 个工具`,
      widgets: (count) => `${count} 张总览卡片`,
      missions: (count) => `${count} 个 Mission`
    },
    navigation: {
      company: "公司",
      mission: "Mission",
      runs: "任务",
      approvals: "收件箱",
      models: "模型",
      agents: "Agent",
      schedule: "日程",
      channels: "Channel"
    },
    nodeTypes: {
      openclaw_agent: "OpenClaw Agent",
      codex_agent: "Codex Agent",
      claude_code_agent: "Claude Code Agent",
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
      mission: {
        title: "Mission 指挥台",
        description: "组织多 Agent Mission 结构、交接和审查关，并查看最近一次运行证据。"
      },
      runs: {
        title: "任务",
        description: "查看当前任务进展、节点输出和执行证据。"
      },
      approvals: {
        title: "收件箱",
        description: "处理因为人工决策而暂停的 Mission。"
      },
      models: {
        title: "模型",
        description: "选择 OpenClaw 默认模型，并查看可用模型能力。"
      },
      agents: {
        title: "Agent",
        description: "创建已配置 OpenClaw Agent，并把可用 Agent 与 Mission 配置分开查看。"
      },
      schedule: {
        title: "日程",
        description: "按日历选择日期，查看当天相关记录。"
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
      run: "任务"
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
      currentIssue: (label) => `当前步骤：${label}`,
      description: "左侧按任务步骤查看进度，右侧查看当前输出。",
      flowFinished: "流程结束",
      flowStarted: "流程开始",
      inProgress: "进行中",
      issueList: "任务步骤",
      managerInputBody: "管理器已将工作交给该槽位。嵌套节点输出会显示在槽位输入和槽位输出之间。",
      managerInputPreview: "管理器输入已进入该槽位。",
      managerInputWaiting: "等待管理器输入。",
      modelOutput: "当前输出",
      noOutput: "暂无输出",
      pending: "待处理",
      runOption: (runId, startedAt) => `任务 ${runId.slice(-6)} · ${startedAt}`,
      slotInputSuffix: "输入",
      slotOutputSuffix: "输出",
      title: "任务进展",
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
      waiting_approval: "等待收件箱处理"
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
      approvals: "收件箱",
      catalog: "配置状态",
      notes: "笔记流",
      runs: "最近任务"
    },
    events: {
      "node.run.cancelled": "节点已取消",
      "node.run.completed": "节点已完成",
      "node.run.failed": "节点失败",
      "node.run.queued": "节点已排队",
      "node.run.started": "节点已启动",
      "node.run.waiting_approval": "等待收件箱处理",
      "mission.run.completed": "Mission 已完成",
      "mission.run.failed": "Mission 失败",
      "mission.run.started": "Mission 已启动"
    }
  }
};

export function getInitialLanguage(): Language {
  const stored = localStorage.getItem("hiveward-language");
  if (stored === "en" || stored === "zh-CN") return stored;
  return navigator.language.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}
