# Manager 自迭代工程执行文档

## 目标

基于 `origin/main` 和当前 PR 分支，把 manager 自迭代改成真实多轮推进链路。

本次工程重点：

- 每轮开始先解决调研和提需两个问题。
- 调研 agent / 提需 agent 都是可选增强项。
- 未配置专门 agent 时由 manager 兜底。
- approve next 不再模板生成下一轮计划。
- manager 只做 run-context prompt injection，不做 harness memory。
- worker 子节点不做平台级跨轮上下文管理。

## 基线对照

### `origin/main` 已有能力

`origin/main` 已经有：

- `packages/shared/src/blueprint.ts` 中的 `manager`、`manager_slot`、`ManagerNodeConfig`、`ManagerSlotNodeConfig`。
- `ManagerSlotExecutionMode`，支持 manager slot 手动/并行执行。
- `apps/api/src/worker/blueprintWorker.ts` 中的 `executeManagerNode`、`executeManagerSlotNode`、`runManagerDecisionTask`。
- agent approval 的 nodeRun 级等待、reply、select、approve/reject。

`origin/main` 没有：

- `packages/shared/src/lifecycle.ts`。
- `apps/api/src/services/lifecycleServices.ts`。
- iteration session / round / release report / manager mail / artifact lifecycle。
- self-iteration lifecycle mode。
- `requirementAgentNodeId`。
- approvalRequestId 级 lifecycle approval。

### 当前 PR 分支已新增能力

当前 PR 分支新增了：

- `packages/shared/src/lifecycle.ts`：ApprovalRequest、IterationSession、IterationRound、ReleaseReport、Artifact、ManagerMail。
- `packages/shared/src/blueprint.ts`：`lifecycleMode`、`dispatchMode`、`maxRounds`、`requirementAgentNodeId`、auto approve 配置。
- `apps/api/src/services/lifecycleServices.ts`：`ApprovalService`、`IterationService`、`ArtifactService`、`ManagerMailProjector`、`MigrationService`。
- `apps/api/src/worker/blueprintWorker.ts`：self-iteration start、`generateRequirementPlan`、release report publish、approvalRequestId 应用。
- `apps/api/src/routes/apiRouter.ts`：新的 approval request API 和 artifact serving。
- `apps/web/src/components/BlueprintStudioPage.tsx`：manager lifecycle / runtime policy 相关 UI。

当前 PR 分支主要断点：

- `handleReleaseReportDecision` approve next 后仍在服务层模板拼下一轮 requirement。
- 只有 `requirementAgentNodeId`，没有 `researchAgentNodeId`。
- `generateRequirementPlan` 只解决 plan，没有 research resolution。
- manager preflight/dispatch 没有统一 `runContext` 注入。
- 没有 manager context snapshot。
- markdown/json artifact 仍是 metadata-only。
- lifecycle 决策是多次写入，不是一个组合 mutation。

## 产品逻辑落地方式

本期不要把调研做成必须连接的 manager_slot。

更贴合当前 PR 的方式是：

```text
ManagerNodeConfig
  requirementAgentNodeId?: string
  researchAgentNodeId?: string

Round preflight
  resolve research
  resolve round plan

Execution phase
  use existing manager/manager_slot dispatch
```

也就是说：

- 调研和提需是每轮 preflight resolver。
- 实际工作仍走现有 manager/manager_slot。
- worker 子节点只吃 manager 分发给它的局部上下文。

## 类型调整

### `ManagerNodeConfig`

文件：`packages/shared/src/blueprint.ts`

在当前 PR 已有字段基础上新增：

```ts
researchAgentNodeId?: string;
maxPreparationAttempts?: number;
```

保留：

```ts
requirementAgentNodeId?: string;
```

`maxPreparationAttempts` 默认建议为 3，用于限制 research -> plan -> research 的 preflight 循环。

### `IterationRound`

文件：`packages/shared/src/lifecycle.ts`

当前 PR 的状态里有 `requirement_pending` / `requirement_approved`。工程上有两种选择：

1. 稳妥实现：保留现有状态枚举，新增可选 metadata 表达 preflight。
2. 清理实现：把文案和状态升级为 `plan_pending` / `plan_approved`。

为了降低一次构建风险，建议本轮采用方案 1：

```ts
interface IterationRound {
  ...
  researchStatus?: "not_required" | "user_provided" | "context_sufficient" | "agent_generated" | "manager_fallback" | "assumption_based" | "blocked";
  researchSummary?: string;
  researchArtifactIds?: string[];
  planSource?: "user_provided" | "agent_generated" | "manager_fallback" | "revised_from_reply";
  contextSnapshotId?: string;
}
```

UI 文案把 `iteration_requirement_plan` 显示为 “Round Execution Plan”。内部 kind 可以先保留，避免大迁移。

### `ManagerContextSnapshot`

文件：`packages/shared/src/lifecycle.ts`

新增：

```ts
interface ManagerContextSnapshot {
  id: string;
  runId: string;
  sessionId: string;
  roundId: string;
  version: number;
  sourceReportId?: string;
  completedItems: string[];
  rejectedOptions: string[];
  keyDecisions: string[];
  validatedFacts: string[];
  openQuestions: string[];
  activeRisks: string[];
  assumptions: string[];
  artifactRefs: Array<{
    artifactId: string;
    title: string;
    current: boolean;
  }>;
  recommendedNextStep: "research" | "plan" | "execute" | "complete";
  summary: string;
  createdAt: string;
}
```

需要在 `FileHivewardStore` 增加 list/upsert 方法。

### `RoundStartContext`

运行时结构，可以先不持久化：

```ts
interface RoundStartContext {
  runId: string;
  sessionId: string;
  roundId: string;
  roundNumber: number;
  originalGoal?: string;
  managerInstructions?: string;
  previousSnapshot?: ManagerContextSnapshot;
  previousReleaseReport?: ReleaseReport;
  humanFeedback?: string;
  artifactIndex: Artifact[];
}
```

### `ManagerInjectedContext`

所有 manager preflight 和 dispatch 都使用：

```ts
interface ManagerInjectedContext {
  mode: "research_resolution" | "requirement_resolution" | "dispatch" | "revise_plan" | "revise_report";
  round: {
    id: string;
    number: number;
    status: string;
  };
  fixedBase: {
    originalGoal?: string;
    hardConstraints: string[];
    successCriteria: string[];
  };
  runMemory: ManagerContextSnapshot | null;
  lastRound: {
    report?: ReleaseReport;
    humanFeedback?: string;
  };
  research: {
    status?: string;
    summary?: string;
    source?: string;
  };
  artifactIndex: Artifact[];
  assumptions: string[];
  risks: string[];
}
```

## 服务拆分

### 新增 `ManagerContextService`

文件：`apps/api/src/services/managerContextService.ts`

职责：

- `buildRoundStartContext(...)`
- `buildManagerInjectedContext(...)`
- `createSnapshotFromRoundResult(...)`
- `compactSnapshot(...)`

只负责聚合和压缩上下文，不推进 run 状态，不执行 agent。

### 新增 `RoundPreflightService`

文件：`apps/api/src/services/roundPreflightService.ts`

职责：

- 判断 research 是否已满足。
- 调用 research agent 或 manager fallback。
- 调用 requirement agent 或 manager fallback。
- 生成 round execution plan body。
- 返回 researchStatus、planSource、artifactIds、plan body。

它不直接调用 runtime。需要通过 `BlueprintWorker` 传入 executor：

```ts
interface RoundPreflightExecutors {
  runAgentNode(...): Promise<AgentTaskResult>;
  runManagerFallback(...): Promise<AgentTaskResult>;
}
```

### 收缩 `IterationService`

文件：`apps/api/src/services/lifecycleServices.ts`

保留：

- session/round 创建。
- approval request 创建。
- release report 创建。
- terminal 状态收口。

移除：

- approve next 后拼 `nextRequirementBody`。
- 构造 fake manager node。

`handleReleaseReportDecision` 在 approve next 后只返回 intent：

```ts
{
  resumeExecution: false,
  completeRun: false,
  prepareNextRound: {
    sessionId,
    roundId,
    previousReportRequestId,
    humanFeedback
  }
}
```

由 `BlueprintWorker` 接到 intent 后，调用 `RoundPreflightService`。

### `BlueprintWorker` 保留职责

文件：`apps/api/src/worker/blueprintWorker.ts`

保留：

- `startRun`
- `runUntilBlockedOrDone`
- `executeManagerNode`
- `executeManagerSlotNode`
- `runAgentTask`
- cancel / terminal totals

改动：

- `generateRequirementPlan` 替换为 `prepareRoundPlan` 或移入 `RoundPreflightService`。
- `startRun` 不再直接生成 requirement body，而是创建 session/round 后跑 preflight。
- `applyApprovalRequest` 处理 approve next intent 后启动下一轮 preflight。
- `runManagerDecisionTask` input 增加 `runContext`。

## Preflight 详细算法

### `prepareRoundPlan`

伪代码：

```ts
async function prepareRoundPlan(blueprint, run, session, round, topManager, humanFeedback?) {
  const context = await managerContextService.buildRoundStartContext(...);

  const research = await resolveResearch({
    blueprint,
    run,
    topManager,
    context,
    humanFeedback
  });

  const plan = await resolveRequirement({
    blueprint,
    run,
    topManager,
    context,
    research,
    humanFeedback
  });

  await iterationService.requestRoundPlan({
    session,
    round,
    managerNode: topManager,
    body: plan.body,
    metadata: {
      researchStatus: research.status,
      researchSummary: research.summary,
      researchArtifactIds: research.artifactIds,
      planSource: plan.source,
      assumptions: plan.assumptions,
      risks: plan.risks
    }
  });
}
```

### `resolveResearch`

顺序：

1. 如果用户输入或上一轮上下文已经足够，返回 `context_sufficient`。
2. 如果配置了 `researchAgentNodeId`，调用该 agent。
3. 如果没有配置，调用 top manager fallback。
4. 如果信息仍不完美但不是硬阻塞，返回 `assumption_based`，并把假设写入 plan。
5. 如果是硬阻塞，返回 `blocked`，不进入执行。

硬阻塞只包括：

- 凭证/权限缺失。
- 外部事实不可获取且不能合理假设。
- 生产破坏性操作。
- 用户明确要求等待。

### `resolveRequirement`

顺序：

1. 如果用户已经明确给出本轮计划，标准化为 round execution plan。
2. 如果配置了 `requirementAgentNodeId`，调用该 agent。
3. 如果没有配置，调用 top manager fallback。
4. plan 必须带 research source、assumptions、risks、acceptance criteria、expected artifacts。

### Manager fallback

manager fallback 不等于普通 manager_slot 执行。

它是直接调用 top manager runtime：

- research fallback：让 manager 基于上下文做调研判断/轻量调研/假设整理。
- requirement fallback：让 manager 生成 round execution plan。

这可以复用当前 PR 的 `runAgentTask` 模式。即使 `dispatchMode` 不是 `self_dispatch`，self-iteration manager 也应该能作为 preflight fallback 被调用。

## 替换当前断点

### 断点 1：`startRun`

当前：

```text
startRun -> generateRequirementPlan -> startSession(requirementBody)
```

改成：

```text
startRun
-> create session + round
-> prepareRoundPlan
-> request round execution plan approval
-> run status waiting_approval
```

### 断点 2：`handleReleaseReportDecision`

当前：

```text
approve report
-> startNextRound
-> template nextRequirementBody
-> requestRequirement
```

改成：

```text
approve report
-> mark current round completed
-> startNextRound
-> return prepareNextRound intent
-> BlueprintWorker.prepareRoundPlan
```

### 断点 3：`buildRequirementReplyRevision`

当前 reply 只重新 `generateRequirementPlan`。

改成：

```text
reply on plan
-> rebuild round start context with feedback
-> optionally refresh research if feedback changes facts
-> regenerate plan vN
```

### 断点 4：manager dispatch context

当前 `runManagerDecisionTask` input：

```ts
{
  manager,
  upstream,
  previousResults,
  delegationRoster,
  decisionContract
}
```

改成：

```ts
{
  manager,
  runContext,
  upstream,
  previousResults,
  delegationRoster,
  decisionContract
}
```

worker 子节点不自动拿完整 `runContext`。只有 manager 明确分发给它的局部任务上下文可以包含必要摘要。

## Artifact 改造

文件：`apps/api/src/services/lifecycleServices.ts`

当前 `ArtifactService.extractArtifacts`：

- HTML 写文件。
- markdown/json 只建 metadata。

改成：

- string markdown 写 `.md`。
- object/json 写 `.json`。
- HTML 继续 sandboxed iframe。
- markdown/json 使用 source preview。
- 所有 artifact 都有 `storagePath`、`relativePath`、`downloadUrl`。

research agent 输出如果是 markdown，也应该作为 artifact 保存，并被 round plan metadata 引用。

## UI 改造

文件：`apps/web/src/components/BlueprintStudioPage.tsx`

Manager 配置区：

- 保留现有提需 agent 下拉，文案改为 “提需 agent / Round plan agent”。
- 新增 “调研 agent / Research agent” 下拉。
- 两个下拉都允许为空。
- 为空时显示提示：

```text
建议选择专门的调研 / 提需 agent。未选择时由 Manager 兜底完成，全自动运行仍会继续。
```

Run / Inbox UI：

- `iteration_requirement_plan` 显示为 “Round Execution Plan”。
- plan 详情显示：
  - 调研来源。
  - 提需来源。
  - 假设。
  - 风险。
  - 版本号。
- 旧审批按钮禁用，但详情可读。
- report vN 和 plan vN 都要清楚。

## 测试计划

### API / worker 测试

文件：`apps/api/src/worker/blueprintWorker.test.ts`

必须新增或调整：

1. 无调研 agent、无提需 agent：
   - start run。
   - manager fallback 完成 research resolution。
   - manager fallback 生成 round execution plan。
   - run 进入 waiting_approval。

2. 有调研 agent、有提需 agent：
   - research agent 先运行。
   - requirement agent 接收到 research summary。
   - plan body 标注 research source 和 plan source。

3. 用户上下文已足够：
   - 不运行 research agent。
   - plan 标注 `context_sufficient`。

4. approve next 不再模板生成：
   - report approve next。
   - 下一轮调用 preflight。
   - plan body 不包含旧模板语句 `Use the previous round outcome to define the next execution round.`

5. 三轮自迭代：
   - Round 1 approve -> execute -> report approve next。
   - Round 2 使用 snapshot/context。
   - Round 3 complete。

6. plan reply：
   - 生成 vN。
   - 旧 plan 可读不可操作。
   - 新 plan 保持 pending capabilities。

7. report reject：
   - 不创建 next round。
   - 当前 round 回到执行阶段。

8. terminal close：
   - complete/cancel 后 pending approvals capabilities 全部 false。
   - 详情仍可读。

9. worker context 边界：
   - manager task input 有 `runContext`。
   - 普通 worker node input 没有完整 `runContext`，除非 manager 分发内容里显式包含局部摘要。

10. artifact persistence：
   - HTML、markdown、json 都有 artifact record。
   - 都有 downloadUrl。

### Route 测试

文件：`apps/api/src/routes/apiRouter.test.ts`

- approvalRequestId approve/reply/reject/complete 仍通过。
- artifact route 可读取 html/md/json。
- path traversal 防护仍通过。
- 旧 runId/nodeRunId bridge 保持兼容。

### Shared / UI 测试

- `researchAgentNodeId` normalize。
- `maxPreparationAttempts` normalize。
- Manager 配置弹窗显示两个下拉。
- 两个下拉为空时显示 warning，但允许保存。

## 验证命令

必须通过：

```bash
npm test
npm run check
npm run build -w @hiveward/web
```

允许存在 Vite chunk size warning。这个 warning 不属于本任务阻塞项。

## 推荐实施顺序

1. 在 `ManagerNodeConfig` 加 `researchAgentNodeId` 和 `maxPreparationAttempts`。
2. UI 加调研 agent 下拉和空配置 warning。
3. 新增 `ManagerContextService`。
4. 新增 `RoundPreflightService`。
5. 把 `startRun -> generateRequirementPlan` 改成 `startRun -> prepareRoundPlan`。
6. 把 release report approve next 改成返回 prepareNextRound intent。
7. 给 manager preflight/dispatch 注入 `runContext`。
8. 生成并保存 manager context snapshot。
9. markdown/json artifact 落盘。
10. 补齐 worker/API/UI 测试。
11. 跑全量验证。

## 完成标准

- 调研 agent 和提需 agent 都可选。
- 两者为空时 manager 兜底，全自动链路不断。
- 每轮都有 research resolution 和 round execution plan。
- approve next 不再由服务层模板生成下一轮计划。
- 下一轮一定经过 round start context + preflight。
- manager task input 有 runContext。
- worker 子节点不被平台注入完整跨轮上下文。
- 三轮自迭代测试通过。
- 无调研 agent / 无提需 agent 兜底测试通过。
- HTML/markdown/json artifact 测试通过。
- `npm test`、`npm run check`、web build 通过。

