# HiveWard SQLite vNext P0 修复工程文档

状态：工程修复执行文档
日期：2026-05-29
基础：当前 SQLite vNext 实现 + 多 Agent 最终合并审查报告 + 本地只读抽查
清洁基线：`4b1d2f5dee8510188e9150b3b7d72f87b8fe0910`

## 1. 最终工程判断

当前 SQLite vNext 方向正确，但实现还不能作为主干默认运行时状态源发布。

保留当前方向，不回退重写：

- 保留 `HivewardStore` 抽象。
- 保留 `SqliteHivewardStore`、SQLite driver、schema 初稿。
- 保留 `AgentOutputEnvelope` 分层方向：`humanReportMd` 给人读，`handoffJson` 给下游机器读，`result` 存结构化结果，`artifacts[]` 显式声明交付物。
- 保留 JSON -> SQLite migration、verify、store contract test 的脚手架。

必须先修 P0：

- 启动迁移门禁。
- worker 条件状态机。
- Agent 输出发布事务。
- approval/inbox 条件事务。
- schema migration fail-closed。
- JSON 迁移深度 verify。

P0 未完成前，SQLite 不能无门禁默认启用；已有 JSON 数据的用户不能被静默切到空 SQLite。

## 2. 本文档目标

本文档不是产品需求文档，也不是重新设计 SQLite vNext。它只规定当前实现进入可合并状态前必须完成的工程修复。

工程师执行时必须遵守：

- 先修 P0，不顺手加新功能。
- 每个 P0 必须配套测试。
- 不用“现有测试通过”证明架构正确。
- 不用 retry 或全局串行队列掩盖状态机问题。
- 不长期维护 JSON/SQLite 双写。

## 3. 当前实现可保留部分

### 3.1 Store 抽象

`apps/api/src/store/hivewardStore.ts` 方向正确。API、worker、service 不应继续直接绑定 `FileHivewardStore`。

后续要扩展这个接口，让高风险写入动作成为 store 级原子方法。

### 3.2 SQLite driver 隔离

`apps/api/src/store/sqlite/sqliteDriver.ts` 只在 driver 层 import `better-sqlite3`，这个边界正确。

保留：

- `foreign_keys = ON`
- WAL
- busy timeout
- `synchronous = NORMAL`

但 migration 逻辑必须重写，见 P0-5。

### 3.3 规范化 schema 初稿

当前 schema 已把核心对象拆成表：

- `runs`
- `node_runs`
- `node_run_payloads`
- `run_events`
- `approval_requests`
- `approval_decisions`
- `inbox_items`
- `agent_outputs`
- `agent_human_reports`
- `agent_handoffs`
- `artifacts`
- `release_reports`
- `run_timeline_items`
- `manager_mail`
- `chat_sessions`
- `chat_messages`

方向正确，不要回退到大 JSON 单文件。

### 3.4 显式 artifact 方向

后端 `ArtifactService` 已开始读取 `artifacts[]`，这是正确方向。

但 UI 仍从 raw output/result/text 猜交付位置，必须删除或降级到调试层，见 P1-1。

## 4. P0 修复项

### P0-1：启动迁移门禁

#### 当前问题

`createHivewardStore()` 未设置 `HIVEWARD_STORE_BACKEND` 时默认返回 SQLite。`app.ts` 启动后直接 `store.init()`。`SqliteHivewardStore.init()` 在 companies 为空时会 seed 默认数据。

结果是：如果用户已有 `data/hiveward-store.json` 和 `data/runs/*.json`，但还没有 `data/hiveward.sqlite`，系统会打开一个空 SQLite 并创建默认公司/蓝图。用户看到的效果像历史数据、run、approval、inbox、chat 全丢了。

#### 必须实现

新增启动检测：

```ts
type RuntimeStoreState = {
  hasLegacyIndex: boolean;
  hasLegacyChat: boolean;
  hasLegacyRunArchive: boolean;
  hasSqliteDb: boolean;
  hasSqliteWal: boolean;
  hasSqliteShm: boolean;
  hasAppliedMigrationManifest: boolean;
};
```

新增函数：

```ts
detectRuntimeStoreState(dataDir: string, sqlitePath: string): Promise<RuntimeStoreState>
```

新增环境变量：

```env
HIVEWARD_STORE_BACKEND=sqlite|json-readonly|json
HIVEWARD_SQLITE_PATH=data/hiveward.sqlite
HIVEWARD_JSON_MIGRATION_MODE=off|dry-run|auto
HIVEWARD_JSON_READONLY_FALLBACK=false
```

启动策略：

- 新安装：无 JSON、无 SQLite，可以创建 SQLite 并 seed 默认数据。
- 已有 SQLite：正常启动 SQLite。
- 有 JSON、无 SQLite：
  - `HIVEWARD_JSON_MIGRATION_MODE=off`：fail-closed，拒绝启动，提示先迁移。
  - `dry-run`：执行 dry-run + verify，拒绝切换到 SQLite。
  - `auto`：dry-run 通过后 apply，apply 后 deep verify，通过才启动 SQLite。
- 有 JSON、有 SQLite、无 migration manifest：fail-closed，提示手工 verify 或迁移状态不可信。
- `json-readonly` 只能用于短期只读回退，不能写运行时状态。
- `json` 可保留为开发逃生门，但发布默认不能是可写 JSON runtime。

#### 必须删除或限制

- 禁止“有 legacy JSON 但没有迁移通过”时自动 seed SQLite。
- 禁止 SQLite 启动失败后自动回落 JSON 写入。
- 禁止长期 JSON/SQLite 双写。

#### 验收测试

必须新增测试：

- 有 JSON 无 SQLite，默认启动失败，错误信息说明迁移入口。
- 有 JSON 无 SQLite，`dry-run` 不创建正式 SQLite。
- 有 JSON 无 SQLite，`auto` 成功后启动 SQLite，并写入 migration manifest。
- SQLite 空库且无 JSON 时允许 seed。
- 有 JSON、有 SQLite、无 manifest 时 fail-closed。
- `json-readonly` 调用写方法会抛错。
- `json-readonly` 的 `init()` 不得因为缺文件而 seed 新默认数据。

## P0-2：worker 主链路接入条件状态机

#### 当前问题

worker 现在仍然创建 `running` node_run，然后用 `upsertNodeRun()` 推进状态。`SqliteHivewardStore` 里虽然存在 `claimNodeRun()`、`completeNodeRun()`，但它们没有进入 `HivewardStore` 接口，也没有被 worker 主链路使用。

这意味着：

- queued -> running 没有条件 claim。
- 多 worker 可能重复执行同一节点。
- late complete / late fail 可能覆盖终态。
- lease、epoch、row_version 字段没有形成闭环。

#### 必须实现

扩展 `HivewardStore`：

```ts
createQueuedNodeRun(input): Promise<BlueprintNodeRun>;
claimNodeRun(input: { nodeRunId: string; owner: string; leaseMs: number }): Promise<ClaimNodeRunResult>;
renewNodeRunLease(input: { nodeRunId: string; owner: string; workerEpoch: number; leaseMs: number }): Promise<boolean>;
startNodeRun(input: { nodeRunId: string; owner: string; workerEpoch: number; startedAt?: string }): Promise<boolean>;
completeNodeRun(input: CompleteNodeRunInput): Promise<boolean>;
failNodeRun(input: FailNodeRunInput): Promise<boolean>;
cancelNodeRun(input: CancelNodeRunInput): Promise<boolean>;
```

状态规则：

- worker 只能 claim `queued` 节点。
- claim 成功后设置 `status=running`、`lease_owner`、`lease_expires_at`、`worker_epoch`、`started_at`。
- complete/fail/cancel 必须校验当前状态仍是 `running`。
- terminal 更新必须校验 `lease_owner` + `worker_epoch` 或 `row_version`。
- terminal 状态不可被 late write 覆盖。
- lease 过期后的旧 worker 回写必须失败。

worker 主链路改造：

```text
create queued node_run
claim queued node_run
execute runtime task
publish output / terminal transition
```

#### 禁止继续使用

worker 主路径不得继续用 `upsertNodeRun()` 表达：

- running
- succeeded
- failed
- cancelled

`upsertNodeRun()` 可以短期保留给迁移导入或测试 fixture，但不能作为运行时状态机入口。

#### 验收测试

必须新增测试：

- 两个 worker 同时 claim 同一 node_run，只有一个成功。
- 已 running 的 node_run 不能被第二个 worker claim。
- succeeded 后 late fail 不生效。
- failed 后 late complete 不生效。
- lease 过期后旧 worker complete 失败。
- cancel 后 late complete 不生效。
- worker 重启后可以恢复 queued/running 但不能重复 terminal 节点。

## P0-3：Agent 输出发布必须成为可恢复短事务

#### 当前问题

当前 `completeNode()` 顺序是：

1. 写 artifact 文件。
2. `upsertNodeRun(succeeded)`。
3. 写 human report / handoff。
4. append event。

任一步失败都会留下半成功状态：

- artifact 文件已写，但 node 未完成。
- node 已 succeeded，但 report/handoff 缺失。
- event/timeline 缺失。
- artifact 元数据和文件不一致。

#### 必须实现

新增 store 级发布 API：

```ts
publishAgentOutput(input: {
  runId: string;
  roundId?: string;
  nodeRunId: string;
  owner: string;
  workerEpoch: number;
  output: unknown;
  rawResult?: unknown;
  usage?: unknown;
  openclawRef?: unknown;
  artifacts: PreparedArtifact[];
  humanReport?: PreparedHumanReport;
  handoff?: PreparedHandoff;
  event: PreparedRunEvent;
  timelineItems?: PreparedTimelineItem[];
}): Promise<PublishAgentOutputResult>;
```

发布流程：

```text
runtime output received
normalize AgentOutputEnvelope
prepare artifact files in staging/content-addressed path
BEGIN SQLite transaction
  conditional complete node_run
  write node_run_payloads
  write agent_outputs
  write agent_human_reports
  write agent_handoffs
  write artifacts metadata
  write run_events
  write run_timeline_items
  refresh run facts
COMMIT
finalize artifact files if needed
cleanup failed staging files
```

文件策略二选一：

- content-addressed：先写不可变文件，事务失败时标记/清理 orphan。
- staging：先写 staging，事务成功后 move 到正式路径；Windows 下 move 失败必须能补偿，不得让 node succeeded 但 artifact 不可用。

第一版建议 content-addressed，减少 Windows rename 风险。

#### 硬约束

- artifact 发布失败，node 不得标记 succeeded。
- node terminal 更新失败，report/handoff/artifact metadata 不得写入。
- humanReportMd、handoffJson、result、artifacts[] 抽取必须和 node payload 同事务。
- UI 和 Manager 只能从规范表读 report/handoff/artifact，不从 Markdown 反推。

#### 验收测试

必须新增测试：

- artifact 写文件失败时 node_run 仍不是 succeeded。
- report 写失败时 node_run 不进入 succeeded，或 outbox 能恢复到一致状态。
- event 写失败时 node_run 不进入 succeeded。
- publish 重试不会重复 artifact metadata。
- publish 重试不会重复 run event/timeline。
- `humanReportMd`、`handoffJson`、`result`、`artifacts[]` 同一次 publish 后同时可查。
- orphan artifact 检查能列出文件存在但 DB 无引用的文件。

## P0-4：approval/inbox 决策必须是条件事务

#### 当前问题

approval 决策现在是：

1. 读 pending request。
2. upsert request。
3. append decision。
4. append timeline。

inbox approve/reject/reply 又先处理 approval request，再更新 inbox item。

双击、重试、并发请求时可能出现：

- 重复 decision。
- request 状态和 inbox 状态不一致。
- timeline 写入但 request 没更新。
- request 已关闭但第二个请求仍返回成功。

#### 必须实现

新增 store 级事务 API：

```ts
applyApprovalDecision(input: {
  approvalRequestId: string;
  expectedStatus: "pending";
  action: "approve" | "reject" | "reply" | "complete" | "terminate";
  actor: "user" | "manager" | "system";
  comment?: string;
  selectedReplyId?: string;
  nextRequest?: ApprovalRequest;
  timelineItem?: PreparedTimelineItem;
}): Promise<ApplyApprovalDecisionResult>;

applyInboxDecision(input: {
  inboxItemId: string;
  approvalRequestId?: string;
  action: "approve" | "reject" | "reply";
  comment?: string;
  importedBlueprints?: BlueprintDefinition[];
}): Promise<ApplyInboxDecisionResult>;
```

事务规则：

- `UPDATE approval_requests SET ... WHERE id=? AND status='pending'`
- affected rows 为 0 时返回 conflict。
- 同一事务内写 decision、reply、timeline、inbox item、manager_mail refresh marker。
- API 层对 conflict 返回 HTTP 409。

#### 验收测试

必须新增测试：

- approve 双击，第一次成功，第二次 409。
- reject 双击，第一次成功，第二次 409。
- reply 后旧 request 关闭，新 revision request 创建。
- inbox approve 成功后 approval request 和 inbox item 状态一致。
- inbox reject 成功后 approval request 和 inbox item 状态一致。
- decision 写失败时 request 状态不变。
- timeline 写失败时 request 状态不变。

## P0-5：schema migration 必须 fail-closed

#### 当前问题

当前 migration 是执行整套 `CREATE TABLE IF NOT EXISTS`，然后对同一个 version 覆盖 `schema_migrations.checksum`。

这不能发现：

- 同版本 schema 漂移。
- 已有表缺列。
- 手工损坏。
- migration 链缺口。
- checksum 不匹配。

#### 必须实现

新增版本化 migration 列表：

```ts
type SqliteMigration = {
  version: number;
  name: string;
  checksum: string;
  up: string[];
};
```

规则：

- `schema_migrations` 只追加，不覆盖历史 checksum。
- 已存在 version 且 checksum 不匹配，拒绝启动。
- 数据库 version 高于代码支持 version，拒绝启动。
- migration 中途失败，事务回滚。
- migration 成功后写入 version、name、checksum、applied_at。
- `CREATE TABLE IF NOT EXISTS` 只能在首次建表 migration 内使用，不作为漂移修复手段。

#### 验收测试

必须新增测试：

- 空库 migration 成功。
- 已迁移同 checksum 启动成功。
- 已迁移不同 checksum 启动失败。
- DB version 高于代码支持版本启动失败。
- migration 中途失败不留下半张表或半条 migration 记录。
- 旧库缺列时不会静默通过。

## P0-6：JSON -> SQLite verify 必须证明关键视图等价

#### 当前问题

当前 verify 主要比较 counts。counts 相等不能证明视图等价。

尤其不能证明：

- run final result 等价。
- pending approval 等价。
- inbox pending 等价。
- agent human reports/handoffs 等价。
- artifact path 和文件存在性等价。
- release report 和 artifact 归属等价。
- chat session/message 等价。

#### 必须实现

verify 分三层：

1. count parity：数量一致。
2. identity parity：关键 id 集合一致。
3. view parity：旧 File store 与 SQLite store 组装出的关键 API view 一致。

最低 verify 项：

- companies id/name/selectedCompanyId。
- blueprints id/current version。
- run ids/status/finalResult。
- node_run ids/status/nodeId/roundId/error。
- events sequence/type/message。
- pending approvals id/kind/status/runId/roundId/revision。
- inbox pending id/status/source refs。
- agent human reports id/nodeRunId/body hash。
- agent handoffs id/nodeRunId/payload hash。
- artifacts id/runId/roundId/nodeRunId/kind/format/storagePath/downloadUrl/sha256/bytes。
- artifact 文件存在性。
- orphan artifact 列表。
- release reports id/roundId/approvalRequestId/artifact refs。
- chat sessions/messages。

#### CLI 要求

保留并加固：

```bash
node scripts/migrate-json-store-to-sqlite.mjs --data-dir data --dry-run
node scripts/migrate-json-store-to-sqlite.mjs --data-dir data --apply
node scripts/verify-sqlite-store.mjs --data-dir data
node scripts/verify-sqlite-store.mjs --data-dir data --check-artifacts
node scripts/verify-sqlite-store.mjs --data-dir data --list-orphan-artifacts
```

#### 验收测试

必须新增测试：

- 真实 legacy fixture 迁移后关键 view parity 通过。
- 缺 artifact 文件时 verify 失败。
- orphan artifact 文件会被列出。
- pending approval 丢失时 verify 失败。
- agent report body 不一致时 verify 失败。
- chat message 丢失时 verify 失败。
- 源 `hiveward-store.json` 缺失时 migration 命令失败，不 seed 默认数据。

## 5. P1 修复项

### P1-1：UI 删除 raw output 交付位置猜测

#### 当前问题

`WorkspacePages.tsx` 仍会从 node output、result、artifact、files、links、path、text URL 中递归猜交付位置。

这违反目标契约：artifact 表是唯一交付物索引。

#### 必须实现

- 报告层只从 `artifacts`、`agentHumanReports`、`agentHandoffs` 的规范字段渲染。
- raw output 只能放到高级调试区。
- 不从 Markdown、result、任意 `path` 字段猜 artifact。
- “打开”按钮只使用 artifact 的规范 `downloadUrl` 或受信任 preview URL。

#### 同步修复

当前文件里出现中文 mojibake，例如交付位置标题被写成乱码。必须修复为正常中文：

- `交付位置`
- `产物位置`
- `产出位置`

不得再出现 `浜や粯浣嶇疆` 一类乱码。

#### 验收测试

- human report 无 artifacts 时显示“本步骤没有产生新的交付物”。
- raw output 里有 `path` 字段但 artifacts 为空时，不显示为交付物。
- artifacts 有 `downloadUrl` 时显示打开入口。
- artifacts 有 Windows `storagePath` 时显示 Windows 原生反斜杠路径。
- 中文界面无乱码。

### P1-2：明确 `kind:file` artifact 语义

#### 当前问题

`kind:file` 现在读取 path，但最终仍要求 content/body，并默认写成 `.md`。语义不清。

#### 必须选择一种语义

推荐 v1 采用“复制文件”语义：

- agent 返回 `kind: "file"` + `path`。
- 平台校验 path 不越界。
- 平台复制文件到 artifact root。
- 计算 bytes/sha256。
- 写入 artifact metadata。

不推荐 v1 采用“引用原文件”语义，因为原文件可能被删除或覆盖。

#### 验收测试

- file artifact path 存在时复制成功。
- path 不存在时报错，node 不 succeeded。
- path 越界时报错。
- bytes/sha256 正确。
- downloadUrl 指向复制后的 artifact 文件。

### P1-3：event/timeline sequence 并发安全

#### 当前问题

`run_events` 和 `run_timeline_items` 的 sequence 使用 `MAX(sequence)+1`。多进程同 run 写入可能冲突或顺序不稳定。

#### 推荐实现

三选一：

- 用 per-run sequence 表，在 `BEGIN IMMEDIATE` 里递增。
- 用自增代理键作为物理顺序，再生成展示 sequence。
- 对 run_id 加应用层写锁，但不要成为长期主架构。

#### 验收测试

- 并发写 100 个 event，不重复、不丢失。
- 并发写 timeline，不重复、不丢失。
- sequence 排序稳定。

### P1-4：manager_mail 标注为 projection

#### 当前问题

`manager_mail` 是可漂移投影表。如果继续维护，必须有重建和校验机制。

#### 必须实现

- 明确 `manager_mail` 不是主事实。
- 主事实来自 approval、inbox、release report、run events。
- 提供 `rebuildManagerMail(runId?)`。
- 提供 verify：projection 与源事实数量和状态一致。

#### 验收测试

- 删除 manager_mail 后 rebuild 能恢复。
- approval 状态变化后 projection 可刷新。
- projection 与源事实不一致时 verify 失败。

## 6. P2 清理项

P2 不阻塞 P0 合并，但必须排期：

- `getRunView` 避免加载大 payload 和全量内存过滤。
- `SqliteHivewardStore` 清理对 `FileHivewardStore` helper 的耦合。
- `json-readonly` proxy 明确 init 语义。
- run list / run detail 增加 query plan 和索引检查。
- 文档补充升级命令、回滚方式、故障排查。
- 提供维护命令：checkpoint、backup、verify、orphan artifact cleanup。

## 7. 推荐实施顺序

### Phase 0：锁定测试夹具

先做测试，不先改实现。

必须准备：

- legacy JSON data fixture。
- 至少一个含 run、node_run、event、approval、inbox、report、handoff、artifact、chat 的 fixture。
- SQLite 空库 fixture。
- schema checksum mismatch fixture。

### Phase 1：启动门禁

完成 P0-1。目标是先保证不会静默“丢数据”。

这一阶段完成后，即使其他 P0 还没修，至少不会把已有 JSON 用户切到空 SQLite。

### Phase 2：migration fail-closed + deep verify

完成 P0-5 和 P0-6。

这一阶段完成后，SQLite 才有可信迁移入口。

### Phase 3：worker 状态机

完成 P0-2。

这一阶段完成后，node_run 生命周期才真正由 SQLite 条件状态机管理。

### Phase 4：Agent 输出发布事务

完成 P0-3。

这一阶段完成后，node output、report、handoff、artifact、event 才不会分裂。

### Phase 5：approval/inbox 条件事务

完成 P0-4。

这一阶段完成后，审批和收件箱才不会因为双击/重试产生不一致。

### Phase 6：P1 前端和 artifact 收敛

完成 P1-1、P1-2、P1-3、P1-4。

这一阶段完成后，产品体验和工程契约一致。

## 8. 合并门禁

P0 合并前必须通过：

```bash
npm test
npm run check
npm run build
```

并额外通过以下专项测试：

- startup legacy JSON gate test。
- migration dry-run/apply/deep verify test。
- schema checksum mismatch test。
- multi-worker claim race test。
- late complete/fail/cancel test。
- publishAgentOutput partial failure test。
- approval double-click conflict test。
- inbox decision consistency test。
- artifact file missing/orphan verify test。
- Windows SQLite WAL reopen smoke。

## 9. 不允许的实现方式

禁止以下做法：

- 用 retry 代替状态机。
- 用全局 operationQueue 作为长期并发架构。
- SQLite 写失败后自动落回 JSON 写。
- 长期 JSON/SQLite 双写。
- 从 Markdown、raw output、result 里反推 artifact。
- artifact 正文放入 SQLite BLOB。
- schema checksum 不匹配时自动覆盖。
- migration 源 JSON 缺失时 seed 默认数据。
- P0 未完成就把 SQLite 设为无门禁默认 runtime。

## 10. 给工程师的执行摘要

这轮不要继续扩功能。当前目标是把 SQLite vNext 从“能跑的原型”收敛成“不会丢数据、不会乱写状态、可以迁移、可以回滚、可以验证”的运行时状态源。

优先级顺序：

1. 启动门禁，防止旧 JSON 用户被静默切空库。
2. migration fail-closed，防止 schema 漂移和半迁移。
3. worker 条件状态机，防止并发重复执行和晚到覆盖。
4. publishAgentOutput 事务，防止 node/report/handoff/artifact/event 分裂。
5. approval/inbox 条件事务，防止双击和重试造成状态不一致。
6. UI 和 artifact 契约收紧，防止继续把机器输出当交付物索引。

完成标准不是测试“绿了”，而是每个 P0 都有失败场景测试证明它不会静默错。
