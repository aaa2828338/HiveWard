# Manager 自迭代 vNext 工程文档：基于当前实现的施工图

## 当前阶段判断

当前代码已经不是空白状态，也不是只停在方案层。它已经实现了 manager 自迭代的第一版主链路，并且通过过：

```bash
npm test
npm run check
npm run build
```

当前实现可以作为一个可运行基线，但还不适合作为下一个版本的最终形态。原因不是主链路错了，而是还有几个产品语义没有闭合，工程职责也还偏集中。

本工程文档基于当前代码状态写，不按绿地项目设计。

## 当前代码里已经有的东西

### Shared 类型层

当前已经新增或扩展了这些能力：

- `packages/shared/src/lifecycle.ts`
  - `ApprovalRequest`
  - `ApprovalDecision`
  - `IterationSession`
  - `IterationRound`
  - `ReleaseReport`
  - `Artifact`
  - `ManagerContextSnapshot`
  - `ManagerMail`
  - approval capabilities
- `packages/shared/src/blueprint.ts`
  - `ManagerNodeConfig.lifecycleMode`
  - `dispatchMode`
  - `maxRounds`
  - `researchAgentNodeId`
  - `requirementAgentNodeId`
  - `maxPreparationAttempts`
  - auto approve config
- `packages/shared/src/api.ts`
  - approval request API response types
- `packages/shared/src/workspace.ts`
  - pending approval item 兼容 approvalRequestId / capabilities

这说明 lifecycle 数据模型已经初步成型。vNext 不需要重建 lifecycle，而是在现有模型上补字段、补报告、补上下文合同。

### API 服务层

当前已有：

- `apps/api/src/services/roundPreflightService.ts`
  - research resolution
  - requirement resolution
  - preflight judgment
  - blocked preflight result
- `apps/api/src/services/managerContextService.ts`
  - round start context
  - manager injected context
  - manager context snapshot
  - rejected artifact index
- `apps/api/src/services/lifecycleServices.ts`
  - `ApprovalService`
  - `IterationService`
  - `ArtifactService`
  - `ManagerMailProjector`
  - migration/runtime policy helpers
- `apps/api/src/store/fileHivewardStore.ts`
  - lifecycle entities 持久化
  - artifacts
  - release reports
  - manager context snapshots
  - approval requests/decisions

这说明服务边界已经拆了第一层，但还不够干净。尤其 `lifecycleServices.ts` 是多个服务塞在一个文件里，`BlueprintWorker` 也仍然承载大量 self-iteration orchestration。

### Worker 层

当前 `apps/api/src/worker/blueprintWorker.ts` 已经接入：

- self-iteration session start。
- round preflight。
- approval request apply。
- approve next 后 prepare next round。
- manager dispatch runContext 注入。
- release report publish。
- manager context snapshot 生成。
- research artifact publish。
- auto approve / auto complete。

这说明主链路已经跑通。vNext 的重点不是继续往 worker 里堆逻辑，而是把 self-iteration orchestration 从 worker 中收出去。

### UI/API 层

当前已有：

- `/api/approval-requests/*` approval request 操作接口。
- `/artifacts/*` artifact serving。
- Run view 中能看到 lifecycle 对象。
- Web 端支持 approval request approve / reject / reply / complete。
- `iteration_requirement_plan` 显示成 `Round Execution Plan`。
- manager 配置中已有 research agent / requirement agent / preparation attempts。

这说明用户操作链路已经打通。vNext 的重点是看板表达：默认展示人能读懂的 agent MD 报告，而不是 raw output。

### 测试层

当前 `apps/api/src/worker/blueprintWorker.test.ts` 已经覆盖很多关键链路：

- 三轮 self-iteration。
- 无 research agent / 无 requirement agent 时 manager fallback。
- 配置 research agent 和 requirement agent。
- configured research agent fail 时 blocked，不静默 fallback。
- manager semantic judgment 触发更多 research。
- dispatch runContext 注入，worker 不自动拿完整 runContext。
- release report reject 后重跑当前 round。
- cancelled run 冻结 pending lifecycle approval。
- release report reply 生成版本。
- requirement reply rerun requirement agent。
- auto approve 自迭代审批。

这说明 vNext 要补的是当前测试没有覆盖的产品缺口，而不是重复测试已有路径。

## 当前明确缺口

### 缺口 1：approved plan 没有成为 dispatch 的执行合同

当前代码会创建 Round Execution Plan approval request，并在 approve 后把 round 切到 executing。

但执行阶段 manager 的 `runContext` 主要包含：

- research status / summary
- previous release report
- previous snapshot
- artifact index
- rejected artifact index

缺少当前 round 已批准的 plan 正文。

产品后果：

用户批准了“这一轮怎么干”，但执行 manager 不一定拿着这份正式计划去调度 worker。

工程结论：

这是 vNext 第一优先级修复。必须把 approved plan 加入 `ManagerInjectedContext`，并有测试证明 dispatch manager 看得到。

### 缺口 2：auto approve 与 blocked request 可能冲突

当前 blocked preflight 会生成 pending approval，且 `approve: false, reply: true`。

但 auto advance 选 request 时主要按 kind 和 manager config 判断。如果开启 `autoApproveRequirements`，blocked request 仍可能被 auto resolve 尝试处理。

产品后果：

全自动运行遇到真实阻塞时，必须停成用户能理解的阻塞卡片，而不是异常。

工程结论：

auto advance 必须尊重 request capabilities。不能 approve 的 request 必须留在 pending。

### 缺口 3：用户看板缺少 agent 人话报告层

当前 run view 里能看到 node output、approval body、artifact、release report，但 agent 自己给人的 Markdown 报告不是一等对象。

产品后果：

用户看到的是机器状态和 raw output，不像和一个 agent 协作时看到“我做了什么、结论是什么、风险是什么”的报告。

工程结论：

需要新增 agent human report 数据模型和持久化。所有有产出的 agent 都必须能发布 MD 报告。MD 给人看，JSON handoff 给下一个 agent 用。

### 缺口 4：JSON handoff 与 human report 没有明确分层

当前 agent output 既可能是 string，也可能是 object。平台把 raw output 作为主要数据源。

产品后果：

人看的内容和机器交接内容混在一起。

工程结论：

需要定义一个轻量输出 envelope，但不强制 Markdown 模板。

### 缺口 5：架构边界还没收干净

当前文件体量：

- `BlueprintWorker` 约 3000 行。
- `lifecycleServices.ts` 约 1000 行。
- `roundPreflightService.ts` 已经相对独立。
- `managerContextService.ts` 已经相对独立。

工程结论：

先修语义闭环，再拆文件。拆分目标是减少 worker 和 lifecycleServices 的混合职责，而不是为了行数好看。

## vNext 工程目标

1. approved plan 成为 manager dispatch 的显式上下文合同。
2. auto approve 不能越过 blocked request。
3. 所有有产出的 agent 都能生成 Markdown human report。
4. JSON handoff 与 Markdown report 明确分层。
5. manager release report 能综合 agent reports。
6. run view 默认显示人能读懂的报告层。
7. self-iteration orchestration 从 `BlueprintWorker` 中拆出。
8. lifecycle 服务按职责拆文件。

## 实施顺序

### Step 0. Checkpoint commit

当前基线已通过测试和构建。开始大改前先 commit。

要求：

- stage 当前所有已改文件和 untracked 新文件。
- commit message 使用 Lore protocol。
- commit 后记录 commit hash。

回退语义：

- commit 之后可以通过 checkout 查看这个状态。
- 如果后续改坏并且确认要回退，可以用 `git reset --hard <commit>` 回到这个基线。
- 这个 checkpoint 只保存 commit 时已经 stage 并提交的内容；之后新增但未 commit 的文件不会被这个 checkpoint 保存。

### Step 1. Approved plan 注入 dispatch context

#### 当前落点

相关文件：

- `packages/shared/src/lifecycle.ts`
- `apps/api/src/services/lifecycleServices.ts`
- `apps/api/src/services/managerContextService.ts`
- `apps/api/src/worker/blueprintWorker.ts`
- `apps/api/src/worker/blueprintWorker.test.ts`

当前函数/路径：

- `IterationService.requestRoundPlan(...)`
- `IterationService.handleRequirementDecision(...)`
- `ManagerContextService.buildRoundStartContext(...)`
- `ManagerContextService.buildManagerInjectedContext(...)`
- `BlueprintWorker.buildDispatchRunContext(...)`

#### 设计

给 round 增加 approved plan 引用：

```ts
interface IterationRound {
  requirementRequestId?: string;
  approvedRequirementRequestId?: string;
  approvedRequirementRevision?: number;
}
```

给 injected context 增加 current plan：

```ts
interface ManagerInjectedContext {
  currentPlan?: {
    requestId: string;
    title: string;
    revision: number;
    body: string;
    approvedAt?: string;
  };
}
```

`approvedAt` 从对应 `ApprovalDecision` 读取；如果历史数据没有 decision 记录，再退回到 approval request 的更新时间，避免旧数据迁移失败。

#### 施工步骤

1. 扩展 shared 类型。
2. `handleRequirementDecision` 在 approve / auto_approve 时写入 approved request id 和 revision。
3. `buildRoundStartContext` 根据 `round.approvedRequirementRequestId` 读取 approval request。
4. `buildManagerInjectedContext` 注入 `currentPlan`。
5. `buildDispatchRunContext` 不做特殊拼接，只依赖 context service 统一构造。
6. 保持 worker 子节点 input 不自动注入完整 runContext。

#### 测试

新增或调整 `blueprintWorker.test.ts`：

- approve plan 后，manager dispatch / manager decision input 包含 `runContext.currentPlan.body`。
- `runContext.currentPlan.revision` 等于批准的 request revision。
- 第二轮 dispatch 用第二轮 approved plan。
- builder node input 不包含完整 `runContext`。

### Step 2. Auto approve 尊重 blocked capabilities

#### 当前落点

相关文件：

- `apps/api/src/worker/blueprintWorker.ts`
- `apps/api/src/services/lifecycleServices.ts`
- `apps/api/src/worker/blueprintWorker.test.ts`

当前函数：

- `BlueprintWorker.autoAdvanceSelfIterationApprovals(...)`
- `BlueprintWorker.nextAutoResolvableRequest(...)`
- `ApprovalService.autoResolve(...)`

#### 设计

auto advance 不能自行推断能不能点。它必须看 request capabilities。

规则：

- requirement plan：只有 `capabilities.approve === true` 才能 auto approve。
- release report：如果 `capabilities.approve === true`，auto approve next。
- final release report：如果 `capabilities.complete === true` 且 `approve === false`，auto complete。
- blocked request：保持 pending。

#### 施工步骤

1. 修改 `nextAutoResolvableRequest`，过滤不可 auto resolve 的 request。
2. 如果没有可 auto resolve 的 request，正常返回 undefined，不抛错。
3. 保持 blocked request 在 manager mail / approval list 可见。

#### 测试

新增测试：

- blueprint 开启 `autoApproveRequirements`。
- research fallback 或 configured agent 返回 `hardBlocker: true`。
- run 最终保持 `waiting_approval`。
- pending blocked request 存在。
- approval capabilities 为 `approve: false, reply: true`。
- adapter calls 不进入 execution builder。

### Step 3. 关键 preflight 输出使用结构化 blocker

#### 当前落点

相关文件：

- `apps/api/src/services/roundPreflightService.ts`
- `apps/api/src/worker/blueprintWorker.ts`
- `apps/api/src/worker/blueprintWorker.test.ts`

当前函数：

- `RoundPreflightService.parsePreflightOutput(...)`
- `assertNoHardBlocker(...)`
- `BlueprintWorker.resolveManagerPreflightPrompt(...)`

#### 设计

不要靠文本魔法字符串识别 blocker。

关键 preflight 输出使用最小 envelope：

```ts
interface PreflightEnvelope {
  hardBlocker?: boolean;
  reason?: string;
  humanReportMd?: string;
  body?: string;
  assumptions?: string[];
  risks?: string[];
  needsMoreResearch?: boolean;
  researchBrief?: string;
}
```

Markdown 仍然自由，但 blocker 必须结构化。

#### 施工步骤

1. 更新 manager preflight prompt：要求关键字段结构化。
2. adapter 支持结构化输出约束时，给关键 preflight 调用传最小 output schema。
3. `parsePreflightObject` 支持 `humanReportMd`，优先作为人类报告文本。
4. blocked approval body 使用 `humanReportMd || reason || body`。
5. 不增加“包含 credential 就自动 blocked”这种文本猜测。

#### 测试

- `hardBlocker: true` 生成 blocked request。
- `humanReportMd` 出现在 blocked approval body。
- 纯文本输出不会因为包含某个词被误判为 blocker。

### Step 4. Agent human report / JSON handoff 数据模型

#### 当前落点

相关文件：

- `packages/shared/src/lifecycle.ts`
- `packages/shared/src/blueprint.ts`
- `apps/api/src/store/fileHivewardStore.ts`
- `apps/api/src/worker/blueprintWorker.ts`
- 新文件：`apps/api/src/services/agentReportService.ts`

#### 设计

新增一等实体：

```ts
interface AgentHumanReport {
  id: string;
  runId: string;
  roundId?: string;
  nodeRunId: string;
  nodeId: string;
  nodeLabel: string;
  title: string;
  bodyMd: string;
  source: "agent" | "fallback";
  fallbackReason?: string;
  createdAt: string;
}
```

新增机器交接实体：

```ts
interface AgentHandoff {
  id: string;
  runId: string;
  roundId?: string;
  nodeRunId: string;
  nodeId: string;
  payload: unknown;
  createdAt: string;
}
```

新增轻量输出 envelope：

```ts
interface AgentOutputEnvelope {
  humanReportMd?: string;
  handoffJson?: unknown;
  result?: unknown;
}
```

注意：

- envelope 是平台提取通道，不是 Markdown 模板。
- 不要求 agent 必须固定 Markdown 模板。
- 不要求 agent 输出一定是 envelope；要兼容现有 string/object 输出。
- raw output 继续保存在 nodeRun.output。
- 对所有有产出的 agent，平台最终都必须写入一条 `AgentHumanReport`。如果 agent 没有主动提供 `humanReportMd`，平台生成 fallback report，并把 `source` 标记为 `"fallback"`。

#### 施工步骤

1. shared 增加 `AgentHumanReport` 类型。
2. shared 增加 `AgentHandoff` 类型。
3. store index 增加：
   - `agentHumanReports: AgentHumanReport[]`
   - `agentHandoffs: AgentHandoff[]`
4. store 增加：
   - `listAgentHumanReports(runId?: string)`
   - `upsertAgentHumanReport(report)`
   - `listAgentHandoffs(runId?: string)`
   - `upsertAgentHandoff(handoff)`
5. 新建 `AgentReportService`：
   - `extractHumanReport(output)`，返回 `bodyMd/source/fallbackReason`
   - `extractHandoffJson(output)`
   - `publishFromNodeRun(...)`
6. `BlueprintWorker.executeAgentNodeWithInput` 完成 agent 后发布 human report 和 handoff。
7. preflight research / requirement / snapshot 这些 manager fallback 也走同样 report 提取。

#### 输出兼容规则

如果 output 是 object：

- `humanReportMd` 是 MD 报告。
- `handoffJson` 是交接 JSON。
- `result` 是业务结果。
- 没有 `humanReportMd` 时，平台必须从 `summary` / `body` / `markdown` / `result` 做 fallback human report，并标记 `source: "fallback"`。
- `source: "agent"` 只用于 agent 显式提供 `humanReportMd` 的情况。

如果 output 是 string：

- 非空 string 保存为 fallback human report，并标记 `source: "fallback"`。
- raw output 原样保留。
- 不把 string 当 handoff JSON，除非它是可解析 JSON object。

#### 测试

- object envelope 保存 MD report。
- object envelope 提取 handoffJson。
- string output 保存为 fallback MD report。
- object output 没有 humanReportMd 时创建 fallback report，且 `source === "fallback"`。
- raw output 保持在 nodeRun.output。
- 普通老 agent 不因为没有 envelope 失败。

### Step 5. 下游 agent 使用 JSON handoff，而不是反解析 MD

#### 当前落点

相关文件：

- `apps/api/src/worker/blueprintWorker.ts`
- `apps/api/src/services/agentReportService.ts`
- `apps/api/src/worker/blueprintWorker.test.ts`

当前相关路径：

- `collectUpstreamOutputs(...)`
- `executeAgentNodeWithInput(...)`
- manager slot context / upstream context

#### 设计

上游 nodeRun 的 raw output 继续存在，但给下游 agent 的 input 必须附加结构化 handoff。

扩展 upstream item：

```ts
interface UpstreamOutputItem {
  output: unknown;
  handoffJson?: unknown;
  humanReportId?: string;
  humanReportMd?: string;
}
```

默认下游 agent 可以看到：

- 上游 raw output。
- 上游 handoffJson。
- 上游 human report 引用或摘要。

但机器接力优先使用 handoffJson。

#### 施工步骤

1. `AgentReportService` 暴露 handoff extraction。
2. node completion 后把 `handoffJson` 写成 `AgentHandoff` 记录。
3. `collectUpstreamOutputs` 组装 upstream 时按 `nodeRunId` 读取 `AgentHandoff.payload`。
4. 不破坏现有依赖 `output` 的测试和逻辑。

#### 测试

- A agent 输出 envelope，B agent input upstream 包含 `handoffJson`。
- B agent input 仍兼容原来的 `output`。
- humanReportMd 不作为唯一交接源。

### Step 6. Manager release report 综合 agent reports

#### 当前落点

相关文件：

- `apps/api/src/worker/blueprintWorker.ts`
- `apps/api/src/services/managerContextService.ts`
- `apps/api/src/services/agentReportService.ts`
- `apps/api/src/services/lifecycleServices.ts`

当前函数：

- `publishSelfIterationRoundIfNeeded(...)`
- `buildReleaseSummary(...)`
- `buildManagerSnapshotDraft(...)`
- `IterationService.requestReleaseReport(...)`

#### 设计

当前 release summary 主要从 artifact-producing nodeRun 和 artifact title 拼出来。vNext 要把本轮 agent human reports 注入 manager，让 manager 生成更像给用户看的报告。

#### 施工步骤

1. 在 `publishSelfIterationRoundIfNeeded` 中读取当前 round 的 agent reports。
2. 修改 `buildReleaseSummary`，至少包含 agent reports 摘要或引用。
3. `buildManagerSnapshotDraft` input 加入 agent reports。
4. release report approval body 展示 manager 总结，artifact 和 raw details 放后面。

#### 测试

- 一个 round 中两个 agent 都有 MD report。
- release report prompt/input 能看到这两个 report。
- release report body 默认不是 raw node output 拼接。

### Step 7. Run view / UI 分层展示

#### 当前落点

相关文件：

- `packages/shared/src/blueprint.ts` 或相关 run view 类型
- `apps/api/src/store/fileHivewardStore.ts`
- `apps/web/src/lib/run-state.ts`
- `apps/web/src/components/WorkspacePages.tsx`
- `apps/web/src/components/BlueprintStudioPage.tsx`

#### 设计

Run view 返回：

- approvalRequests
- releaseReports
- artifacts
- managerContextSnapshots
- agentHumanReports
- raw nodeRuns

UI 默认顺序：

1. Round Execution Plan / approved plan。
2. Agent Markdown reports。
3. Manager Release Report。
4. Artifacts。
5. Advanced details。

#### 施工步骤

1. `BlueprintRunView` 加 `agentHumanReports`。
2. `FileHivewardStore.getRunView` 组装 reports。
3. `syncApprovalsForRun` 保持兼容 approval request。
4. `WorkspacePages` run detail 默认显示 report cards。
5. raw output / JSON / runContext 放 `<details>` 或高级 tab。
6. blocked approval 显示成“缺什么 / 怎么继续”。

#### 测试

- run view API 返回 agentHumanReports。
- UI typecheck 通过。
- old approval 仍可读不可操作。
- pending blocked request 仍显示 reply 操作。

### Step 8. 架构拆分

这个步骤放在语义修复之后做，避免一边换语义一边搬文件导致 diff 失控。

#### 当前要拆的文件

- `apps/api/src/worker/blueprintWorker.ts`
- `apps/api/src/services/lifecycleServices.ts`

#### 目标文件结构

```text
apps/api/src/worker/blueprintWorker.ts
  - 普通 run scheduling
  - 普通 node execution
  - 调用 selfIterationOrchestrator

apps/api/src/services/selfIterationOrchestrator.ts
  - start self-iteration session
  - prepare round plan
  - apply approval result
  - prepare next round
  - auto advance
  - publish round result

apps/api/src/services/roundPreflightService.ts
  - 保留当前职责
  - 加 PreflightEnvelope / humanReportMd 支持

apps/api/src/services/managerContextService.ts
  - 保留当前职责
  - 加 approved plan / currentPlan 注入

apps/api/src/services/agentReportService.ts
  - humanReportMd / handoffJson extraction
  - report persistence

apps/api/src/services/lifecycleApprovalService.ts
  - 从 lifecycleServices.ts 拆出 ApprovalService

apps/api/src/services/iterationLifecycleService.ts
  - 从 lifecycleServices.ts 拆出 IterationService
  - session / round / release report 状态推进

apps/api/src/services/artifactService.ts
  - 从 lifecycleServices.ts 拆出 ArtifactService

apps/api/src/services/managerMailProjector.ts
  - 从 lifecycleServices.ts 拆出 ManagerMailProjector

apps/api/src/services/runtimeAccessPolicyService.ts
  - 从 lifecycleServices.ts 拆出 RuntimeAccessPolicyService
```

#### 拆分策略

1. 先抽 `AgentReportService`，因为它是新能力。
2. 再抽 `SelfIterationOrchestrator`，从 `BlueprintWorker` 搬 self-iteration 专用流程。
3. 最后拆 `lifecycleServices.ts`，按类移动文件，保持导出兼容。
4. 每次移动后跑 targeted tests，再跑全量。

#### 不要做的事

- 不在拆分时重写 manager dispatch 算法。
- 不改变 artifact file/link 范围。
- 不强制 agent MD 模板。
- 不把 worker 子节点改成平台级跨轮 memory。

## 最终验收命令

必须通过：

```bash
npm test
npm run check
npm run build
```

允许 Web build 继续出现 Vite chunk size warning。这个 warning 属于后续前端 code splitting，不阻塞本轮。

## 新增测试清单

### Worker / lifecycle

- Approved plan injected into manager dispatch runContext.
- Approved plan revision updates after plan reply.
- Round 2 dispatch sees Round 2 approved plan.
- Worker nodes do not receive full cross-round runContext automatically.
- Auto approve skips blocked requirement request.
- Blocked requirement stays pending and replyable.
- JSON hardBlocker generates blocked approval.
- hardBlocker humanReportMd appears in blocked approval body.

### Agent report / handoff

- Productive agent object envelope creates AgentHumanReport.
- Productive agent string output creates AgentHumanReport.
- handoffJson is attached to downstream upstream input.
- AgentHandoff is stored separately from AgentHumanReport.
- fallback AgentHumanReport is created for legacy object outputs without humanReportMd.
- raw output remains available on nodeRun.
- legacy agent outputs still run without envelope.

### Release report / run view

- manager release report receives agent reports.
- run view includes agentHumanReports.
- UI defaults to report cards.
- raw output remains accessible in details.
- old approvals remain readable and non-operable.

### Existing regression

- three-round self-iteration still passes.
- configured research / requirement agents still pass.
- missing research / requirement agent fallback still passes.
- release report reject reruns current round.
- terminal close freezes pending approvals.
- HTML / markdown / JSON artifacts still persist and serve.

## 风险与控制

### 风险：输出 envelope 破坏老 agent

控制：

- envelope 是可选兼容层。
- string output 继续支持。
- object output 没有 `humanReportMd` 时不失败，但必须生成 `source: "fallback"` 的 AgentHumanReport。

### 风险：MD 报告被做成死模板

控制：

- prompt 只要求“写给用户看的 Markdown 报告”。
- 不要求固定标题、字段或顺序。
- UI 只负责展示，不解析 MD 语义。

### 风险：JSON handoff 不够规范

控制：

- 先支持任意 JSON object。
- 对 preflight blocker 这类关键路径要求最小结构字段。
- 后续再按 agent 类型收紧 schema。

### 风险：架构拆分造成大面积回归

控制：

- 先语义修复，再搬文件。
- 一次只拆一个服务。
- 保持旧导出兼容，降低 route/worker 改动面。

## 推荐交付切分

1. Checkpoint commit。
2. Approved plan context + auto blocked 修复。
3. Preflight envelope / hardBlocker 结构化。
4. AgentHumanReport + handoffJson 数据模型。
5. Release report 综合 agent reports。
6. Run view / UI 报告分层。
7. SelfIterationOrchestrator 和 lifecycle 文件拆分。
8. 全量验证。
