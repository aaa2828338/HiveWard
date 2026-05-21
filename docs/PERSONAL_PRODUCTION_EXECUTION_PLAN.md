# HiveWard 个人生产级重构执行文档

## 目标

把 HiveWard 做成一个轻量、安静、可复盘的个人 agent 作战台。

HiveWard 负责指挥、记录、汇报；OpenClaw、Codex、Claude Code 负责真实执行。当前阶段不追求企业级平台能力，不做多租户、RBAC、复杂审计、自动恢复、智能续跑、复杂 Artifact 系统。

本轮推进不做旧数据兼容。实现时以新的底层数据模型为准，必要时重建 checked-in seed 数据。不要为了兼容旧 `hiveward-store.json` 结构把新逻辑绕复杂。

## 总原则

- 运行必须可复盘：每次 Blueprint Run 都有独立 archive JSON。
- 运行必须安静：没有 active run 时不做后台轮询。
- 运行中只观察当前 run：不要周期性 hydrate 全工作区。
- 普通节点只接收直接 incoming edges 对应的上游输出。
- 最终结果从执行图语义中解析，不靠节点 label 硬编码。
- 失败只记录，不自动续跑，不恢复工作区，不猜用户现场。
- 保持现有分层：`apps/web`、`apps/api`、`packages/shared`、`packages/adapter`。
- 不新增依赖，除非某个目标没有现有工具能可靠完成。

## 非目标

- 不做 SQLite/Postgres。
- 不做对象存储。
- 不做 workspace snapshot、rollback、patch replay。
- 不做失败后自动续跑。
- 不做企业权限系统。
- 不做新的 Artifact 表或资产库。
- 不改 OpenClaw runtime 内部协议边界。

## 新数据形态

目标文件结构：

```text
data/
  hiveward-store.json
  blueprints/
    blueprint-xxx.json
  runs/
    run-xxx.json
```

`hiveward-store.json` 只保留轻量索引和当前 UI 状态：

```json
{
  "schema": "hiveward.store-index/v1",
  "selectedCompanyId": "company-hiveward-studio",
  "companies": [],
  "blueprintIndex": [],
  "runIndex": [],
  "catalogSnapshot": {},
  "companyDashboards": {}
}
```

Blueprint 定义独立保存到 `data/blueprints/`。Run 运行事实独立保存到 `data/runs/`。

实现时允许移除旧的 `blueprints`、`blueprintRuns`、`nodeRuns`、`events` 大数组模型。旧 store 不需要兼容读取；如果本地 store 不是新 schema，可以在开发环境重新生成。

## Run Archive Schema

每次运行创建一个独立 archive：

```json
{
  "schema": "hiveward.run-archive/v1",
  "run": {
    "id": "run-xxxx",
    "companyId": "company-hiveward-studio",
    "blueprintId": "blueprint-xxxx",
    "blueprintName": "HTML Delivery Blueprint",
    "blueprintVersion": 3,
    "status": "running",
    "startedBy": "local-user",
    "startedAt": "2026-05-20T20:00:00.000Z",
    "endedAt": null,
    "durationMs": null,
    "totalInputTokens": 0,
    "totalOutputTokens": 0,
    "totalCostUsd": null,
    "openclawRefs": []
  },
  "blueprintSnapshot": {},
  "nodeRuns": [],
  "events": [],
  "finalResult": null
}
```

`blueprintSnapshot` 是运行开始时的完整 Blueprint JSON。后续用户修改 Blueprint 不影响这次 Run 的复盘。

每个 `nodeRun` 必须记录：

- `id`
- `blueprintRunId`
- `blueprintId`
- `nodeId`
- `nodeLabel`
- `nodeType`
- `status`
- `queuedAt`
- `startedAt`
- `endedAt`
- `input`
- `output`
- `error`
- `usage`
- `openclawRef`

`input` 是节点真实收到的执行输入。对普通 agent 节点，形态为：

```json
{
  "upstream": [
    {
      "nodeId": "plan",
      "nodeLabel": "2. Plan",
      "nodeRunId": "node-run-xxxx",
      "status": "succeeded",
      "output": {},
      "openclawRef": {}
    }
  ]
}
```

不要递归塞入祖先节点历史。Manager 节点和 manager slot 可以保留 `previousResults`，因为这是 manager 语义本身。

写 archive 时使用安全写入：先写临时文件，再 rename 到目标文件，保证 JSON 不被半截写坏。

## Final Result 解析规则

不要把 `Report Agent`、`Final Report` 这类 label 写死进代码。

最终结果用一个 resolver 生成 `finalResult`。resolver 每次 run 完成、失败、进入等待审批时都可以重新计算并写入 archive。

### 节点分类

结果生产节点：

- `type: "agent", runtimeId: "openclaw"`
- `type: "agent", runtimeId: "codex"`
- `type: "agent", runtimeId: "claude"`
- `parallel_agents`
- `manager`
- `summary`

控制或投递节点默认不是最终结果：

- `approval`
- `condition`
- `loop`
- `send`
- `note`
- `group`

这些节点可以影响流程，但默认不承担最终汇报。以后如果确实需要，可通过显式配置扩展。

### 显式配置优先

在节点基础配置中增加可选字段：

```ts
resultRole?: "auto" | "final" | "ignore";
```

解析优先级：

1. 成功执行且 `resultRole === "final"` 的结果生产节点。
2. 没有显式 final 时，自动选择终端结果生产节点。
3. 没有终端候选时，选择最近成功的结果生产节点。
4. 失败 run 同时显示失败节点、失败原因、失败节点 input，以及当前可解析到的最新结果候选。

`resultRole === "ignore"` 的节点不作为最终结果候选。

### 自动终端结果节点

自动候选不是“最后一个节点”，而是：

> 本次 run 中成功执行、有输出、并且后面没有成功执行的结果生产节点的结果生产节点。

这允许这些合理结构：

```text
Brief -> Plan -> Execute -> QA -> Report Agent
```

`Report Agent` 是终端结果生产节点。

```text
Brief -> Execute -> Summary -> Approval -> Send
```

`Summary` 是终端结果生产节点；后面的 `Approval` 和 `Send` 不会抢走最终结果。

```text
Research A -> Merge
Research B -> Merge
```

`Merge` 是终端结果生产节点。

```text
Research A
Research B
```

有两个终端结果生产节点，UI 不要静默合并，应并列展示。

### 风险与处理

分支图可能有多个终端结果。处理方式：顶部显示“本次结果”，下面按完成时间或拓扑顺序列出多个候选，不自动编造合并内容。

审批或发送节点可能在汇报节点之后。处理方式：终端判断只看 downstream 结果生产节点，不看 `approval`、`send` 这类控制或投递节点。

Condition 和 loop 会让“图上的最后节点”不可靠。处理方式：resolver 基于本次 run 实际成功的 nodeRuns 解析，而不是只看静态 Blueprint 图。

Manager 内部有嵌套执行。默认把 top-level manager 的输出作为候选；如果内部某个节点显式 `resultRole === "final"`，则允许它成为 final candidate。

失败 run 可能没有最终汇报。处理方式：显示失败节点上下文，不承诺有 final report。

## API 形态

保留并强化当前单 run 接口：

```http
GET /api/blueprint-runs/:runId
```

该接口读取单个 run archive，不触发 catalog、runtime overview、dashboard、usage、approvals 刷新。

Runs 列表读取 `runIndex`：

```http
GET /api/blueprint-runs
```

只返回列表摘要，不读取所有大 archive。打开某个 run 详情时再读对应 archive。

启动 run：

```http
POST /api/blueprints/:blueprintId/runs
```

流程：

1. 保存或读取最新 blueprint。
2. 创建 run id。
3. 写入 run archive 初始文件，包含 blueprint snapshot。
4. 写入 runIndex 摘要。
5. worker 开始执行。

## Worker 执行要求

`BlueprintWorker` 不直接依赖一个大 store 数组作为事实来源。它应通过 store 的 run archive 方法写入事实：

- `createRunArchive(blueprint, startedBy)`
- `updateRun(run)`
- `upsertNodeRun(nodeRun)`
- `appendEvent(event)`
- `getRunView(runId)`
- `listNodeRuns(runId)`

每个节点执行前：

1. 收集直接 incoming edges 的上游输出。
2. 构造 input。
3. 创建或更新 nodeRun，写入 `input`。
4. 执行节点。
5. 成功写 agent 的真实可见 `output`、`usage`、`openclawRef`；不要把 OpenClaw 状态回执伪装成业务输出。
6. 失败写 `error` 和已有 partial output。
7. 重算 run totals 和 `finalResult`。
8. 写 run archive。

普通节点不读取递归祖先历史。Manager 例外必须局限在 manager 执行模型内。

## 前端轮询规则

初始打开应用可以加载基础工作区状态，但不能让 heavy hydrate 成为后台循环。

运行中轮询：

```text
queued/running: 只请求 GET /api/blueprint-runs/:runId
waiting_approval: 停止自动轮询
succeeded/failed/cancelled: 停止自动轮询
```

没有 active run 时无周期请求。

用户动作触发：

- 点击刷新工作区：全量刷新。
- 打开 Runs 页面：读取 runIndex。
- 打开某个 Run：读取单 run archive。
- 打开 OpenClaw 面板：读取 runtime overview。
- 点击 Refresh Catalog：刷新 catalog。
- 打开设置：读取 config/wizard。
- approve 后：请求 approve 接口，然后读取当前 run。

不要在 blueprint 编辑页后台扫描 OpenClaw sessions。不要为了“看起来实时”周期刷新 dashboard、catalog、runtime overview。

## Run 页面展示

Run 页面按四块呈现：

1. 本次结果
2. 失败或等待审批状态
3. 节点执行时间线
4. 节点 input/output/error 详情和原始 JSON

本次结果来自 `finalResult`：

- 单个 final candidate：直接展示。
- 多个 final candidates：并列展示，不自动合并。
- failed：优先展示失败节点、失败原因、失败节点 input，再展示当前已产生的结果候选。
- waiting_approval：展示等待审批节点和其 input/context，同时展示当前结果候选。

原始 JSON 可以直接展示。当前定位是本地个人工具，暂不做脱敏、分享权限、密钥扫描等企业化能力。

## 开发顺序

### 阶段 1：Shared contract

目标：

- 增加 `BlueprintRunArchive`、`BlueprintRunSummary`、`FinalRunResult` 类型。
- 给 `BlueprintNodeRun` 增加 `input?: unknown`。
- 给 node base config 增加 `resultRole?: "auto" | "final" | "ignore"`。
- 补 `resolveFinalRunResult` 纯函数和单元测试。

验收：

- 多分支、多 terminal、approval/send 后置、failed run、manager 输出都有测试。
- 不依赖节点 label 判断最终结果。

### 阶段 2：File store 重构

目标：

- `hiveward-store.json` 变成索引。
- Blueprint 定义写入 `data/blueprints/`。
- Run archive 写入 `data/runs/`。
- 写 JSON 使用临时文件加 rename。

验收：

- 创建 Blueprint 正常。
- 保存 Blueprint 正常。
- 启动 Run 后生成 `data/runs/run-*.json`。
- `data/hiveward-store.json` 不再保存长 output。
- JSON store 和 run archive 都能被 `JSON.parse`。

### 阶段 3：Worker 改为 archive-first

目标：

- 每个节点开始时写入 nodeRun input。
- 每个节点完成/失败时更新 run archive。
- run totals 从 archive nodeRuns 计算。
- `finalResult` 随 run 状态更新。

字段归属边界：

- P0 只强制平台机械字段归属：这些字段只由 HiveWard 写入和信任，包括 `status`、`nodeRunId`、`taskId`、`runId`、`sessionKey`、`startedAt`、`endedAt`、`durationMs`、`inputTokens`、`outputTokens`、`error`、`source`、`nextNode`、`slotIndex`、`resultRole`、`artifactId`。
- 协议字段暂不做平台强制层；是否要 `outputKind`、`schemaVersion`、`requiredArtifacts`、`requiredSemanticFields`，先交给 Blueprint 文案和节点提示词。
- 语义字段是 agent 产物，平台不做系统级内容限制；限制只来自节点提示词。
- Worker 不得把 agent 返回的同名字段提升为 run、nodeRun、archive 或 artifact 的平台事实；同名内容最多作为语义输出保存。
- `resultRole` 是平台读取的节点配置，不是 agent 自报字段。
- 后续节点必须收到上游节点保存的完整可见输出；如果没有可见输出，该 agent 节点失败，不生成 `OpenClaw agent run ok` 这类替代输出。

验收：

- 成功 run 包含 blueprintSnapshot、nodeRuns、events、finalResult。
- 失败 run 包含失败节点 input/error。
- 普通节点只收到直接上游输出。
- Manager 保留 previousResults 但不污染普通节点语义。
- agent 输出中即使包含平台机械字段，也不会覆盖 HiveWard 管理的运行事实。
- output 形态不由平台强制；agent 只负责产出语义内容。

### 阶段 4：API 瘦身

目标：

- `GET /api/blueprint-runs/:runId` 只读单 archive。
- `GET /api/blueprint-runs` 只读 runIndex 摘要。
- catalog/config/runtime/dashboard 不在 run polling 路径上。

验收：

- 单 run 请求不触发 OpenClaw runtime overview。
- run list 不读取所有大 archive。

### 阶段 5：前端轮询重写

目标：

- 移除 active run 时的全量 `hydrateWorkspace` 轮询。
- queued/running 只轮询当前 run。
- waiting_approval 停止自动轮询。
- 用户打开对应页面或点击按钮才刷新 heavy 数据。

验收：

- 无 active run 时 Network 无周期请求。
- active run 时周期请求只有 `/api/blueprint-runs/:runId`。
- waiting_approval 时周期请求停止。
- catalog/config/runtime overview 不被后台刷新。

### 阶段 6：Run 页面结果展示

目标：

- 顶部展示 `finalResult`。
- 支持多个终端结果候选。
- 展示失败节点上下文。
- 展示节点 input/output/error/runtimeRef。
- 提供原始 JSON 查看。

验收：

- 有显式 `resultRole: "final"` 时优先展示。
- 没有显式 final 时展示自动终端结果生产节点。
- approval/send 后置时不抢最终结果。
- 多终端分支并列展示。

## 最小验证命令

共享/API/worker/store 改动后运行：

```bash
npm test
npm run check
node -e "JSON.parse(require('fs').readFileSync('data/hiveward-store.json','utf8')); console.log('valid store json')"
```

前端行为改动后运行：

```bash
npm run typecheck -w @hiveward/web
npm run build
```

边界敏感改动后运行：

```bash
npm run check:boundaries
```

## 完成标准

- 每次 run 都有独立 archive JSON。
- 主 store 不再被长 output 撑大。
- 节点 run 记录真实 input。
- 普通节点只吃直接上游。
- 最终结果不靠 label 硬编码。
- active run 只轮询当前 run。
- 没 active run 时无后台周期请求。
- failed/waiting approval 状态能看清原因和上下文。
- 不引入数据库、复杂 Artifact、自动恢复、自动续跑。
