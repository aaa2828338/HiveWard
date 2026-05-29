# 给工程师的实施提示词：Manager 自迭代 vNext

你现在接手 `D:\HiveWard` 仓库中的 Manager 自迭代 vNext 实施工作。请先阅读并遵守根目录 `AGENTS.md`，然后把下面两份文档作为本轮实现的产品和工程事实来源：

- `docs/manager-self-iteration-vnext-requirements.md`
- `docs/manager-self-iteration-vnext-engineering-plan.md`

## 项目背景

当前代码已经实现了 manager 自迭代的第一版主链路：每轮 preflight、research、Round Execution Plan 审批、执行、release report 审批、下一轮推进、context snapshot、artifact 落盘等能力已经跑通，并且此前已通过：

```bash
npm test
npm run check
npm run build
```

但当前版本还不是可作为下一个版本提交的最终形态。问题不是主链路完全错误，而是产品语义和工程边界还没有闭合：

- 用户批准的 Round Execution Plan 还没有成为执行阶段 manager 的正式指挥上下文。
- 全自动审批可能和 blocked request 的能力边界冲突。
- run view 默认仍偏机器语言，用户看不到每个 agent 像对话总结一样写给人的 MD 报告。
- JSON handoff 和 human Markdown report 没有清晰分层。
- `BlueprintWorker` 和 `lifecycleServices.ts` 仍承担过多职责，需要在语义修复后拆干净。

## 本轮目标

把当前“能跑”的 manager 自迭代升级成“产品语义闭合、工程结构干净、可作为下一个版本提交”的实现。

必须做到：

1. approved plan 成为 manager dispatch 的显式执行合同。
2. auto approve 不能越过 blocked request。
3. 所有有产出的 agent 在 run view 中都有 Markdown human report。
4. JSON handoff 作为 agent-to-agent 交接，不能和给人看的 MD 报告混为一层。
5. manager release report 综合 agent reports，形成用户能读懂的本轮总结。
6. run view 默认展示人能读懂的报告层，raw output / JSON / runContext 放到高级详情。
7. 语义修复稳定后，再拆 `SelfIterationOrchestrator` 和 lifecycle services。

## 非目标

本轮不要做：

- 万能 file/link artifact 归档系统。
- 向量记忆或长期记忆。
- worker harness 层跨轮 memory。
- 强制固定 agent Markdown 报告模板。
- 让下游 agent 反解析给用户看的 MD 报告。
- 在架构拆分时重写 manager dispatch 算法。

复杂文件、外部链接、截图、视频、多文件目录等产物先由 agent 在 MD 报告里说清楚，不要强行建模成通用 artifact 系统。

## 实施顺序

严格按工程文档顺序推进，不要先做大拆分：

1. 建 checkpoint commit：确认当前基线、stage 当前变更和 untracked 文件、按 Lore protocol commit、记录 commit hash。
2. 修 approved plan 注入：让 `runContext.currentPlan` 出现在执行 manager 的上下文里。
3. 修 auto approve：所有自动推进都必须尊重 approval request capabilities，blocked request 保持 pending。
4. 修 preflight blocker：关键 blocker 用结构化 `hardBlocker`，不要靠文本猜测。
5. 加 `AgentHumanReport` 和 `AgentHandoff`：MD 给人看，JSON 给下游 agent 接力。
6. 让 downstream input 使用 `AgentHandoff.payload`，保留 raw output 兼容旧逻辑。
7. 让 manager release report 综合本轮 agent reports。
8. 改 run view/UI 默认展示报告层。
9. 最后再拆 `SelfIterationOrchestrator` 和 lifecycle service 文件，保持旧导出兼容。

## 关键工程约束

- `AgentOutputEnvelope` 只是提取通道，不是 MD 模板。
- 每个有产出的 agent 最终都必须有一条 `AgentHumanReport`。
- 如果老 agent 没有提供 `humanReportMd`，平台生成 fallback report，并标记 `source: "fallback"`。
- `AgentHandoff` 必须和 `AgentHumanReport` 分开存储；不要把 JSON handoff 塞进给人看的 MD 报告。
- raw output 继续保存在 nodeRun 上，作为调试材料。
- worker 子节点不能被平台自动注入完整跨轮 runContext；跨轮关注由 manager 通过当前轮上下文分发。
- 先补测试锁行为，再改实现；每个阶段尽量做小 diff。

## 必须新增或调整的测试

至少覆盖：

- approved plan 注入 manager dispatch runContext。
- plan reply 后 revision 更新，下一次 dispatch 使用新 revision。
- worker 子节点不自动收到完整 runContext。
- auto approve 跳过 blocked request，run 停在 `waiting_approval`。
- `hardBlocker: true` 生成 blocked approval，`humanReportMd` 出现在用户可读 body。
- object envelope 创建 `AgentHumanReport` 和 `AgentHandoff`。
- legacy object output 没有 `humanReportMd` 时创建 `source: "fallback"` 的 report。
- downstream input 带 `handoffJson`，同时兼容旧 `output`。
- manager release report 输入包含本轮 agent reports。
- run view 返回并默认展示 `agentHumanReports`。
- HTML / Markdown / JSON artifact 原有能力不回归。

## 最终验收

完成后必须运行：

```bash
npm test
npm run check
npm run build
```

允许 Web build 保留既有 Vite chunk size warning；它不阻塞本轮目标。

最终交付报告必须说明：

- 实现了哪些目标。
- 改了哪些关键文件。
- 新增了哪些测试。
- 三个最终验收命令的结果。
- 还有哪些明确不做或留到后续版本的风险。
