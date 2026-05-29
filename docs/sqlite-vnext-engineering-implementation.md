# HiveWard SQLite vNext 工程实施文档

状态：工程实施方案草案
来源：多模型同题讨论结论 + 干净 commit 代码核对
当前基线：`4b1d2f5dee8510188e9150b3b7d72f87b8fe0910` 作为干净逻辑基线，当前未提交改动只作为问题样本参考
目标版本：SQLite vNext v1
日期：2026-05-29

## 0. 基线纪律

本文档的工程事实只按 `4b1d2f5dee8510188e9150b3b7d72f87b8fe0910` 判断。当前工作区里的未提交改动、临时修补、实验性 artifacts[] 改造、UI 调整、schema 修补都不能当作已存在能力。

未提交改动只用于说明“现在为什么会乱”和“下一版必须避免什么”，不能作为工程落地的起点。

## 1. 一句话工程目标

把 HiveWard 的运行时核心状态从 JSON 文件系统迁到 `data/hiveward.sqlite`，让 SQLite 成为唯一实时权威状态源；文件系统只继续保存 artifact 正文、workspace bundle、skill source 拷贝、显式导出和迁移备份。

## 2. 必须解决的问题

当前 `FileHivewardStore` 把多个实时事实混在 JSON 文件和 run archive 里：

- 主索引：`data/hiveward-store.json`
- 聊天索引：`data/hiveward-chat-store.json`
- 蓝图定义：`data/blueprints/*.json`
- run archive：`data/runs/*.json`
- artifact 正文：`data/artifacts/**`

这导致三个根问题：

1. Windows 下大 JSON 临时文件 rename 会触发 `EPERM`，运行状态写入可能失败。
2. run、approval、inbox、agent report、artifact、manager context 分散在多处，UI 和 worker 需要扫描/拼装/反查。
3. 并行 Agent 下多个状态推进最终都会汇聚到同一个 JSON 真相源，靠全局 `operationQueue` 串行兜底，不是长期架构。

SQLite vNext 不是“加一个缓存库”，而是替换运行时权威存储。

## 3. v1 范围

v1 必须完成：

- 新增 `SqliteHivewardStore`，覆盖当前 API/worker 运行所需核心读写。
- 新增 `HivewardStore` 抽象接口，把 API、worker、services 从具体 `FileHivewardStore` 解耦。
- 新增 SQLite schema、migration runner、verify runner、manifest。
- 迁移 company、dashboard、role directory、blueprint、run、node_run、event、iteration、approval、inbox、agent report、handoff、artifact、release report、timeline、chat。
- API 对外保持现有响应形状：`BlueprintRunView`、`BlueprintRunSummary`、`ApprovalRequest`、`InboxItem` 等不做破坏式改名。
- Worker 状态推进改为短事务落库，不再写 run archive 作为主链路。
- artifact 正文仍写文件系统，但元信息必须进入 SQLite。
- 从干净基线升级 Agent 输出契约：`AgentOutputEnvelope` 必须从 `humanReportMd / handoffJson / result` 扩展到 `humanReportMd / handoffJson / result / artifacts[]`。
- 替换干净基线里的 artifact 自动推断逻辑，改为显式 `artifacts[]` 发布；兜底推断只能作为短期兼容，不能作为目标主链路。
- 默认新安装使用 SQLite。

v1 不做：

- 不上远程数据库。
- 不做云同步、多用户协同、分布式锁。
- 不把 artifact 正文存成 SQLite BLOB。
- 不重写 runtime adapter。
- 不重写 UI 大布局。
- 不长期维护 JSON/SQLite 双写。
- 不把 raw harness logs、外部凭据、完整 OpenClaw usage 明细放进核心 DB。

## 4. 干净基线代码事实

`4b1d2f5dee8510188e9150b3b7d72f87b8fe0910` 里的主要入口：

- `apps/api/src/store/fileHivewardStore.ts`
  - 当前权威 store。
  - 内部有 `operationQueue`。
  - 读写 `hiveward-store.json`、`blueprints/*.json`、`runs/*.json`。
  - 同时代理 `FileHivewardChatStore`。
- `apps/api/src/store/jsonFile.ts`
  - JSON 安全写入和 temp rename 的关键路径。
- `apps/api/src/worker/blueprintWorker.ts`
  - run、node_run、event、manager lifecycle、agent task、approval 的主要写入方。
- `apps/api/src/services/artifactService.ts`
  - 干净基线里仍从 `nodeRun.output` 自动推断 artifact：字符串里有 HTML 就发布 HTML，普通字符串发布 Markdown，其他对象发布 JSON。
  - 这是旧逻辑，不是目标逻辑。SQLite vNext 应改为显式 `artifacts[]`，不能继续从 Markdown/result 反推交付物。
- `apps/api/src/services/agentReportService.ts`
  - 负责 human report/handoff 相关落地。
  - 干净基线里 `humanReportMd` 是显式报告字段，`handoffJson` 是显式交接字段；没有独立 `agent_outputs` 表，也没有 result/artifact 规范落库表。
- `apps/api/src/services/lifecycleApprovalService.ts`
  - 负责 approval 状态推进。
- `packages/shared/src/blueprint.ts`
  - `BlueprintRun`、`BlueprintNodeRun`、`BlueprintNodeEvent`、`BlueprintRunView`、`BlueprintRunArchive`。
- `packages/shared/src/lifecycle.ts`
  - `ApprovalRequest`、`ApprovalDecision`、`IterationSession`、`IterationRound`、`ManagerContextSnapshot`、`Artifact`、`ReleaseReport`、`AgentHumanReport`、`AgentHandoff`、`AgentOutputEnvelope`、`RunTimelineItem`。
  - 干净基线里的 `AgentOutputEnvelope` 只有 `humanReportMd?: string`、`handoffJson?: unknown`、`result?: unknown`，没有 `contractVersion` 和 `artifacts[]`。
- `packages/shared/src/workspace.ts`
  - `InboxItem`、`PendingApprovalItem`。

迁移时不能先推翻这些共享类型。先保证旧 API shape 可以从 SQLite 组装出来。

## 5. 目标架构

目标结构：

```text
API / Worker / Services
        |
        v
HivewardStore interface
        |
        +-- SqliteHivewardStore       默认运行时权威源
        |
        +-- FileHivewardStore         只读迁移输入 / 显式导出 / 临时回退
        |
        v
data/hiveward.sqlite
data/artifacts/**
data/blueprint-workspaces/**
data/migration-backups/**
```

关键规则：

- 业务层不直接 import SQLite driver。
- 业务层不直接读写 `data/runs/*.json`。
- `FileHivewardStore` 不能继续作为稳定主链路。
- `blueprint_versions.definition_json` 是历史 run 的合同。
- `node_runs` 保存摘要状态；大 input/output 放 `node_run_payloads`。
- `run_events` 是 append-only；状态表保存当前快照。
- `agent_human_reports` 给 UI 人看。
- `agent_handoffs` 给 Manager 和下游 Agent 看。
- `artifacts` 是唯一交付物索引。

## 6. Driver 决策

v1 默认采用 `better-sqlite3`。

原因：

- Node 20/22 都可用，符合当前 `package.json` 的 Node 范围。
- 同步 API 简单，容易包成短事务。
- 本地桌面/单机应用场景下性能足够。
- WAL + busy_timeout 可以覆盖当前多 Agent 本地并行场景。

工程约束：

- 只有 `apps/api/src/store/sqlite/sqliteDriver.ts` 可以 import `better-sqlite3`。
- 业务 store 只能依赖内部 `SqliteDriver` 封装。
- 安装 spike 必须先在 Windows 跑通。
- 如果 Windows/CI 安装失败，允许新增第二个 driver adapter，但不能让业务层感知。

推荐依赖：

```bash
npm install better-sqlite3
npm install -D @types/better-sqlite3
```

## 7. 新增文件建议

```text
apps/api/src/store/hivewardStore.ts
apps/api/src/store/createHivewardStore.ts
apps/api/src/store/sqlite/sqliteDriver.ts
apps/api/src/store/sqlite/schema.ts
apps/api/src/store/sqlite/sqliteHivewardStore.ts
apps/api/src/store/sqlite/sqliteMigrations.ts
apps/api/src/store/sqlite/jsonToSqliteMigration.ts
apps/api/src/store/sqlite/sqliteStoreContract.test.ts
apps/api/src/store/sqlite/jsonToSqliteMigration.test.ts
apps/api/src/store/storeContractFixtures.ts
scripts/migrate-json-store-to-sqlite.mjs
scripts/verify-sqlite-store.mjs
```

`FileHivewardStore` 不要一次删除。先实现接口，然后在 v1 内变成迁移输入和只读回退来源。

## 8. Store Interface

先从 `FileHivewardStore` 的公共方法抽取 `HivewardStore` 接口。第一版不要重新设计业务方法名，避免 API/worker 大面积重写。

接口至少覆盖以下分组：

- company/dashboard/role/catalog
- blueprint/list/get/save/import/delete/skill source
- inbox/list/create/approve/reject/reply
- run/create/update/get/view/list/archive
- node_run/upsert/list
- event/append
- approval request/decision/list/get/upsert
- iteration session/round/list/upsert
- artifact/list/upsert
- release report/list/upsert
- agent human report/list/upsert
- agent handoff/list/upsert
- manager context snapshot/list/upsert
- run timeline/append/list
- manager mail projection/list/replace compatibility
- chat session/message/list/create/update/end/append

重要限制：

- v1 可以保留方法名，但 `SqliteHivewardStore` 内部不能把所有数据塞进一个 JSON 列。
- 大 payload 必须和摘要拆表。
- `listRunSummaries()` 不能加载 node output。
- `getRunView(runId)` 可以多表查询，但不能扫描所有 run。
- `listPendingApprovals()` 只能查 pending approval 表和必要 join，不能扫描 archive。

## 9. SQLite 初始化

数据库路径：

```text
data/hiveward.sqlite
```

初始化 PRAGMA：

```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
PRAGMA synchronous = NORMAL;
```

启动流程：

1. API 启动时创建 `data/`。
2. 打开 SQLite。
3. 执行 PRAGMA。
4. 获取 `schema_migrations` 当前版本。
5. 顺序执行 migration。
6. 如果无 DB 但存在 JSON store，根据环境策略进入迁移或报错。

环境变量建议：

```text
HIVEWARD_STORE_BACKEND=sqlite
HIVEWARD_SQLITE_PATH=data/hiveward.sqlite
HIVEWARD_JSON_MIGRATION_MODE=off|dry-run|auto
HIVEWARD_JSON_READONLY_FALLBACK=false
```

默认：

- 新安装：`sqlite`
- 已有 JSON 且无 SQLite：开发环境可提示/执行 dry-run；正式版本不静默覆盖。

## 10. Schema v1

下面是 v1 必须落地的逻辑表。字段类型可以根据 driver 写法微调，但语义不能变。

### 10.1 元信息

```sql
CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL,
  checksum TEXT NOT NULL
);

CREATE TABLE migration_manifests (
  id TEXT PRIMARY KEY,
  source_root TEXT NOT NULL,
  backup_root TEXT NOT NULL,
  source_manifest_json TEXT NOT NULL,
  result_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('dry_run','applied','failed')),
  created_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### 10.2 公司、角色和工作台

```sql
CREATE TABLE companies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  logo_label TEXT,
  logo_url TEXT,
  business_goal TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE workspace_dashboards (
  company_id TEXT PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  dashboard_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE role_directories (
  company_id TEXT PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  directory_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE role_driver_bindings (
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  role_id TEXT NOT NULL,
  runtime_id TEXT NOT NULL,
  model_id TEXT,
  binding_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (company_id, role_id)
);
```

`selectedCompanyId` 放 `app_settings`，key 建议为 `selected_company_id`。

### 10.3 蓝图

```sql
CREATE TABLE blueprints (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  current_version INTEGER NOT NULL,
  current_version_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE blueprint_versions (
  id TEXT PRIMARY KEY,
  blueprint_id TEXT NOT NULL REFERENCES blueprints(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  definition_json TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (blueprint_id, version)
);

CREATE TABLE blueprint_skill_sources (
  id TEXT PRIMARY KEY,
  blueprint_id TEXT NOT NULL REFERENCES blueprints(id) ON DELETE CASCADE,
  working_directory TEXT NOT NULL,
  source_completeness TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

v1 以 `blueprint_versions.definition_json` 为权威。`blueprint_nodes`、`blueprint_edges` 可以后续补做查询索引，不作为 v1 必须项。

### 10.4 Run、Node Run、Event

```sql
CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  blueprint_id TEXT NOT NULL,
  blueprint_version_id TEXT REFERENCES blueprint_versions(id),
  blueprint_name TEXT,
  blueprint_version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued','running','succeeded','failed','cancelled','skipped','waiting_approval')),
  started_by TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  duration_ms INTEGER,
  total_input_tokens INTEGER NOT NULL DEFAULT 0,
  total_output_tokens INTEGER NOT NULL DEFAULT 0,
  total_cost_usd REAL NOT NULL DEFAULT 0,
  openclaw_refs_json TEXT NOT NULL DEFAULT '[]',
  final_result_json TEXT,
  row_version INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE run_blueprint_snapshots (
  run_id TEXT PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,
  blueprint_version_id TEXT,
  definition_json TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE node_runs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  blueprint_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  node_label TEXT NOT NULL,
  node_type TEXT NOT NULL,
  iteration_round_id TEXT,
  execution_kind TEXT NOT NULL DEFAULT 'node',
  status TEXT NOT NULL CHECK (status IN ('queued','running','succeeded','failed','cancelled','waiting_approval')),
  queued_at TEXT NOT NULL,
  started_at TEXT,
  ended_at TEXT,
  error TEXT,
  usage_json TEXT,
  openclaw_ref_json TEXT,
  lease_owner TEXT,
  lease_expires_at TEXT,
  worker_epoch INTEGER NOT NULL DEFAULT 0,
  row_version INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE node_run_payloads (
  node_run_id TEXT PRIMARY KEY REFERENCES node_runs(id) ON DELETE CASCADE,
  input_json TEXT,
  output_json TEXT,
  raw_result_json TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE run_events (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  node_run_id TEXT REFERENCES node_runs(id) ON DELETE SET NULL,
  sequence INTEGER NOT NULL,
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  payload_json TEXT,
  openclaw_ref_json TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (run_id, sequence)
);
```

索引：

```sql
CREATE INDEX idx_runs_company_started ON runs(company_id, started_at DESC);
CREATE INDEX idx_runs_blueprint_started ON runs(blueprint_id, started_at DESC);
CREATE INDEX idx_runs_status_updated ON runs(status, updated_at DESC);
CREATE INDEX idx_node_runs_run_status ON node_runs(run_id, status);
CREATE INDEX idx_node_runs_run_round_node ON node_runs(run_id, iteration_round_id, node_id);
CREATE INDEX idx_run_events_run_created ON run_events(run_id, created_at);
```

### 10.5 Manager 自迭代

```sql
CREATE TABLE iteration_sessions (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  top_manager_node_id TEXT NOT NULL,
  blueprint_snapshot_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running','completed','failed','cancelled')),
  max_rounds INTEGER NOT NULL,
  current_round_id TEXT,
  created_at TEXT NOT NULL,
  ended_at TEXT
);

CREATE TABLE iteration_rounds (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES iteration_sessions(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  round_number INTEGER NOT NULL,
  status TEXT NOT NULL,
  requirement_request_id TEXT,
  approved_requirement_request_id TEXT,
  approved_requirement_revision INTEGER,
  release_report_request_id TEXT,
  artifact_ids_json TEXT NOT NULL DEFAULT '[]',
  research_status TEXT,
  research_summary TEXT,
  research_artifact_ids_json TEXT NOT NULL DEFAULT '[]',
  plan_source TEXT,
  context_snapshot_id TEXT,
  approved_plan_json TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  UNIQUE (session_id, round_number)
);

CREATE TABLE manager_dispatches (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  round_id TEXT REFERENCES iteration_rounds(id) ON DELETE CASCADE,
  manager_node_run_id TEXT REFERENCES node_runs(id) ON DELETE SET NULL,
  target_node_run_id TEXT REFERENCES node_runs(id) ON DELETE SET NULL,
  slot INTEGER,
  route_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('created','running','succeeded','failed','cancelled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE manager_context_snapshots (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES iteration_sessions(id) ON DELETE CASCADE,
  round_id TEXT NOT NULL REFERENCES iteration_rounds(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  source_report_id TEXT,
  snapshot_json TEXT NOT NULL,
  summary TEXT NOT NULL,
  recommended_next_step TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

`manager_mail` 不做主事实表。当前 API 需要兼容时，优先从 approval、artifact、release report 查询投影；如果必须缓存，只能作为可重建 projection。

### 10.6 Approval 和 Inbox

```sql
CREATE TABLE approval_requests (
  id TEXT PRIMARY KEY,
  run_id TEXT,
  round_id TEXT,
  node_run_id TEXT,
  kind TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','approved','rejected','replied','completed','terminated','superseded')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  payload_ref TEXT,
  source_type TEXT,
  source_id TEXT,
  thread_id TEXT,
  revision INTEGER NOT NULL,
  replaces_request_id TEXT,
  superseded_by_request_id TEXT,
  capabilities_json TEXT NOT NULL,
  requested_by_json TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE TABLE approval_decisions (
  id TEXT PRIMARY KEY,
  approval_request_id TEXT NOT NULL REFERENCES approval_requests(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  actor TEXT NOT NULL CHECK (actor IN ('user','system','manager')),
  comment TEXT,
  selected_reply_id TEXT,
  resulting_status TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE approval_replies (
  id TEXT PRIMARY KEY,
  approval_request_id TEXT NOT NULL REFERENCES approval_requests(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  actor TEXT NOT NULL DEFAULT 'user',
  created_at TEXT NOT NULL
);

CREATE TABLE inbox_items (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','approved','rejected')),
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  payload_json TEXT,
  source_json TEXT,
  approval_request_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE inbox_replies (
  id TEXT PRIMARY KEY,
  inbox_item_id TEXT NOT NULL REFERENCES inbox_items(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

索引：

```sql
CREATE INDEX idx_approval_requests_status_created ON approval_requests(status, requested_at DESC);
CREATE INDEX idx_approval_requests_run_round ON approval_requests(run_id, round_id);
CREATE INDEX idx_inbox_items_company_status ON inbox_items(company_id, status, created_at DESC);
```

### 10.7 Agent 输出、报告、交接和产物

```sql
CREATE TABLE agent_outputs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  round_id TEXT,
  node_run_id TEXT NOT NULL REFERENCES node_runs(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL,
  envelope_json TEXT NOT NULL,
  result_json TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (node_run_id)
);

CREATE TABLE agent_human_reports (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  round_id TEXT,
  node_run_id TEXT NOT NULL REFERENCES node_runs(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL,
  node_label TEXT NOT NULL,
  title TEXT NOT NULL,
  body_md TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('agent','fallback')),
  fallback_reason TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE agent_handoffs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  round_id TEXT,
  node_run_id TEXT NOT NULL REFERENCES node_runs(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE artifacts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  round_id TEXT,
  node_run_id TEXT REFERENCES node_runs(id) ON DELETE SET NULL,
  slot TEXT,
  title TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('html','markdown','json','file','link')),
  format TEXT,
  storage_path TEXT,
  relative_path TEXT,
  download_url TEXT,
  preview_policy TEXT NOT NULL CHECK (preview_policy IN ('none','source','sandboxed_iframe')),
  trusted INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'current' CHECK (status IN ('current','rejected','superseded','failed')),
  bytes INTEGER,
  sha256 TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE release_reports (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  round_id TEXT NOT NULL REFERENCES iteration_rounds(id) ON DELETE CASCADE,
  approval_request_id TEXT NOT NULL REFERENCES approval_requests(id),
  version INTEGER NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  supersedes_report_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE release_report_artifacts (
  release_report_id TEXT NOT NULL REFERENCES release_reports(id) ON DELETE CASCADE,
  artifact_id TEXT NOT NULL REFERENCES artifacts(id),
  title TEXT NOT NULL,
  location TEXT NOT NULL,
  current INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (release_report_id, artifact_id)
);
```

索引：

```sql
CREATE INDEX idx_reports_run_round_node ON agent_human_reports(run_id, round_id, node_run_id);
CREATE INDEX idx_handoffs_run_node ON agent_handoffs(run_id, node_run_id);
CREATE INDEX idx_artifacts_run_round_node ON artifacts(run_id, round_id, node_run_id);
CREATE INDEX idx_release_reports_run_round ON release_reports(run_id, round_id, version DESC);
```

规则：

- `node_run_payloads.output_json` 保存原始 node output。
- `agent_outputs.envelope_json` 保存规范 envelope。
- `agent_human_reports.body_md` 是 UI 默认展示。
- `agent_handoffs.payload_json` 是 Manager/下游读取。
- `artifacts` 是唯一交付物索引。
- UI 不得从 Markdown、`result.dataJson`、raw output 猜 artifact。

### 10.8 Run timeline

```sql
CREATE TABLE run_timeline_items (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  actor_node_id TEXT,
  actor_label TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  payload_ref TEXT,
  UNIQUE (run_id, sequence)
);
```

### 10.9 Chat

```sql
CREATE TABLE chat_sessions (
  id TEXT PRIMARY KEY,
  company_id TEXT,
  harness_id TEXT NOT NULL,
  native_session_id TEXT,
  title TEXT,
  role_scope_json TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  ended_at TEXT
);

CREATE TABLE chat_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL,
  native_message_id TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE chat_attachments (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  attachment_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

## 11. 写入事务边界

严禁把外部 Agent 调用包进事务。

### 11.1 创建 run

一个事务：

1. 插入 `runs`。
2. 插入 `run_blueprint_snapshots`。
3. 如果有 top manager，插入 `iteration_sessions` 和 round 1。
4. 插入 run started event。

### 11.2 Node claim/start

一个短事务：

1. `UPDATE node_runs SET status='running' ... WHERE id=? AND status='queued'`
2. 写 `node.run.started` event。
3. 写 timeline `node_started`。

如果 update affected rows 为 0，说明节点已经被其他 worker claim，不能继续执行。

### 11.3 Agent 返回

一个短事务：

1. 更新 `node_runs.status`、`ended_at`、`usage_json`、`openclaw_ref_json`、`error`。
2. upsert `node_run_payloads.output_json/raw_result_json`。
3. 解析 envelope，写 `agent_outputs`。
4. 写 `agent_human_reports`。
5. 写 `agent_handoffs`。
6. 对 `artifacts[]` 先确保文件已经写好，再写 `artifacts` 元信息。
7. 写 event 和 timeline。
8. 更新 `runs` token/cost/status 缓存。

如果 artifact 文件写入失败，本次 node 完成不能伪成功。必须失败并保留错误。

### 11.4 Approval request

一个事务：

1. 插入或更新 `approval_requests`。
2. 写 event。
3. 写 timeline。
4. 如来源是 inbox，更新 `inbox_items.approval_request_id`。

### 11.5 Approval decision/reply

一个事务：

1. 检查 request 仍是 `pending`。
2. 写 `approval_decisions`。
3. 更新 `approval_requests.status`。
4. reply 时写 `approval_replies`，必要时创建新 revision request。
5. 更新相关 run/round 状态。
6. 写 event 和 timeline。

## 12. 并发策略

SQLite 层：

- WAL。
- `busy_timeout = 5000`。
- 每次写入都是短事务。
- 失败时有限重试，重试失败必须可见报错。

应用层：

- node_run claim 必须条件更新。
- 状态推进必须检查旧状态。
- 使用 `row_version` 或 `worker_epoch` 防止晚到结果覆盖新状态。
- 并行 Agent 可以同时执行，但落库必须各自短事务。
- Manager 汇总读取当前 round 的规范表，不解析 Markdown，不遍历文件。

v1 不做分布式 worker。未来如果 worker 多进程化，优先通过 API/store writer 或 lease/epoch 扩展。

## 13. JSON 迁移流程

脚本：

```bash
node scripts/migrate-json-store-to-sqlite.mjs --data-dir data --dry-run
node scripts/migrate-json-store-to-sqlite.mjs --data-dir data --apply
node scripts/verify-sqlite-store.mjs --data-dir data
```

流程：

1. 停止 API/worker 写入，或获取迁移锁。
2. 创建备份目录：`data/migration-backups/<timestamp>/`。
3. 扫描：
   - `hiveward-store.json`
   - `hiveward-chat-store.json`
   - `blueprints/*.json`
   - `runs/*.json`
   - `artifacts/**`
4. 忽略：
   - `*.tmp`
   - 无法解析的临时文件
   - 已知无业务含义的空文件
5. 生成 source manifest：
   - path
   - size
   - mtime
   - sha256
   - parse status
6. 建 schema。
7. 按顺序导入：
   - company/app settings
   - dashboard/role/catalog
   - blueprints/versions/skill sources
   - runs/snapshots
   - node_runs/payloads/events/timeline
   - iteration sessions/rounds/context snapshots
   - approvals/decisions/inbox
   - agent reports/handoffs/artifacts/release reports
   - chat sessions/messages
8. 每个 run 单独事务导入。
9. 写 `migration_manifests`。
10. verify 通过后切换 backend。

迁移校验：

- company 数一致。
- blueprint 数一致。
- run 数一致。
- 每个 run 的 node_run 数一致。
- 每个 run 的 event 数一致。
- approval request/decision 数一致。
- artifact 数一致。
- agent report/handoff 数一致。
- latest run view 的 final result 状态一致。
- pending approvals 列表一致。
- inbox pending 列表一致。

失败规则：

- verify 不通过，不切换 backend。
- schema 版本不匹配，启动 fail closed。
- 不允许半迁移后继续写 JSON 和 SQLite 两边。

## 14. API 查询映射

保持现有 route 形状，替换数据来源。

### 14.1 `/api/blueprint-runs`

从 `runs` 查询摘要，不 join payload：

- run 基本字段
- blueprint name/version
- status
- token/cost
- started/ended

### 14.2 `/api/blueprint-runs/:runId`

批量查询：

- `runs`
- `node_runs`
- `node_run_payloads` 只在必要时取 output
- `run_events`
- `iteration_sessions`
- `iteration_rounds`
- `approval_requests`
- `approval_decisions`
- `artifacts`
- `release_reports` + `release_report_artifacts`
- `agent_human_reports`
- `agent_handoffs`
- `manager_context_snapshots`
- `run_timeline_items`

组装为 `BlueprintRunView`。

### 14.3 `/api/approvals/pending`

只查：

```sql
SELECT * FROM approval_requests WHERE status = 'pending' ORDER BY requested_at DESC;
```

需要 UI upstream 时再 join `runs`、`node_runs`、`agent_human_reports`、`artifacts`。

### 14.4 `/api/inbox`

只查 `inbox_items`，按 company/status/time 过滤。

### 14.5 artifact download

仍由 Express 静态 route 读文件系统，但路径来自 `artifacts.relative_path/storage_path`。

必须继续做 path containment 校验。

## 15. Worker 改造顺序

不要先重写 `blueprintWorker`。先让 store adapter 保持方法不变，再逐步收紧。

顺序：

1. 抽 `HivewardStore` 接口。
2. 让 `FileHivewardStore` implements `HivewardStore`。
3. 新增 `SqliteHivewardStore` implements `HivewardStore`。
4. API/worker 构造入口改走 `createHivewardStore()`。
5. `blueprintWorker` 原逻辑先不大改，只替换 store 实现。
6. 再逐步把高风险方法改成 SQLite 原子方法：
   - `claimNodeRun`
   - `completeNodeRun`
   - `failNodeRun`
   - `appendRunEvent`
   - `publishAgentOutput`
   - `applyApprovalDecision`
7. 最后删除核心 JSON archive 写路径。

这样可以避免“一边换存储，一边换调度语义”。

## 16. Artifact 改造

干净基线里的 `ArtifactService.publishFromNodeRun()` 是旧逻辑：它从 `nodeRun.output` 自动抽取 artifact。

- 如果字符串里有 `<!doctype html>`、`<html>` 或 `html` fenced code block，就发布 HTML。
- 如果是普通字符串，就发布 Markdown。
- 如果是对象，就序列化为 JSON artifact。

这套逻辑能让早期 demo 跑起来，但它把“报告内容”和“交付物”混在一起。SQLite vNext 必须把这条边界收硬：artifact 必须来自显式 `artifacts[]`，不能继续从 Markdown、result、raw output 里猜。

SQLite v1 要求：

- 文件写入路径保持：
  `data/artifacts/runs/<runId>/<roundId>/<artifactId>.<ext>`
- `AgentOutputEnvelope` 升级到 v2，新增 `artifacts?: AgentArtifactPayload[]`。
- `ArtifactService` 主路径只处理显式 `artifacts[]`。
- 旧的 HTML/Markdown/JSON 自动推断只能作为迁移兼容函数，默认不参与新 run 主链路。
- 写文件后计算：
  - bytes
  - sha256
  - relativePath
  - downloadUrl
- 在同一业务完成流程内写 `artifacts` 表。
- 如果 DB 写失败，文件变成孤儿，由维护命令清理。
- 如果文件写失败，node_run 不能标记 succeeded。

维护命令：

```bash
node scripts/verify-sqlite-store.mjs --check-artifacts
node scripts/verify-sqlite-store.mjs --list-orphan-artifacts
```

## 17. AgentOutputEnvelope 落库规则

干净基线契约：

```ts
{
  humanReportMd?: string;
  handoffJson?: unknown;
  result?: unknown;
}
```

SQLite vNext 目标契约：

输入 envelope：

```ts
{
  contractVersion?: 2;
  humanReportMd?: string;
  handoffJson?: unknown;
  result?: unknown;
  artifacts?: AgentArtifactPayload[];
}
```

落库：

- `node_run_payloads.output_json` 保存原始 output。
- `agent_outputs.envelope_json` 保存规范 envelope。
- `agent_outputs.result_json` 保存 `result`。
- `agent_human_reports.body_md` 保存 `humanReportMd`。
- `agent_handoffs.payload_json` 保存 `handoffJson`。
- `artifacts` 表保存 `artifacts[]` 发布后的元信息。

质量规则：

- Provider 成功不等于业务成功。
- 如果节点要求方案/报告，但只返回“我将要...”这类过程文本，后续应有业务质量校验。
- v1 先不阻塞所有节点，但讨论/方案类 Agent 应增加 post-validation 标记，供 Manager 汇总时降权。

## 18. 测试计划

### 18.1 Store contract

新增一组 store contract tests，同一套 fixture 跑两遍：

- `FileHivewardStore`
- `SqliteHivewardStore`

覆盖：

- company create/select/update
- blueprint save/list/get
- run create/update/view/list
- node_run upsert/list
- event append/order
- approval request/decision/reply
- inbox approve/reject/reply
- iteration session/round
- artifact upsert/list
- agent report/handoff
- chat session/message

### 18.2 Migration parity

用真实 `data/` 复制样本做 fixture：

- 正常 run
- failed run
- waiting approval run
- manager 多轮 run
- parallel Agent run
- artifact run
- inbox proposal
- chat history inbox submission

校验旧 JSON view 与 SQLite view 等价。

### 18.3 并发

测试：

- 两个 worker 同时 claim 同一 node_run，只有一个成功。
- 多个 node_run 并发完成，event sequence 不重复。
- approval reply 与 manager polling 同时发生，不丢 revision。
- artifact 发布和 run complete 同时发生，不产生孤儿 DB 记录。

### 18.4 Windows

必须验证：

- 连续运行不产生新的 `data/runs/*.tmp`。
- 核心状态不再写 `run-*.json`。
- SQLite WAL 文件正常生成/关闭。
- 运行中断后 DB 可以 reopen。
- artifact path containment 正常。

### 18.5 API/UI 回归

跑现有：

- API route tests。
- worker tests。
- lifecycle services tests。
- WorkspacePages tests。

补充：

- run list 只查摘要。
- run detail 展示 agent report。
- pending approvals 不扫描 archive。
- inbox approve/reply/reject 走 approval 链。
- artifact download URL 正确。

## 19. 实施分阶段

### Phase 0：准备和锁行为

交付：

- 新增 store contract fixtures。
- 抽 `HivewardStore` interface。
- `FileHivewardStore` implements interface。
- 现有测试仍通过。

验收：

```bash
npm test -- apps/api/src/store/fileHivewardStore.test.ts
npm test -- apps/api/src/routes/apiRouter.test.ts
npm test -- apps/api/src/worker/blueprintWorker.test.ts
npm run typecheck -w @hiveward/api
```

### Phase 1：SQLite driver 和 schema

交付：

- 安装 `better-sqlite3`。
- 新增 driver wrapper。
- 新增 schema migrations。
- 初始化空 DB。
- schema tests。

验收：

- Windows 本地安装成功。
- `schema_migrations` 正确写入。
- PRAGMA 生效。

### Phase 2：SqliteHivewardStore 核心读写

交付：

- company/dashboard/role。
- blueprint/version。
- run/node_run/event。
- approval/inbox。
- iteration。
- artifact/report/handoff/timeline。
- chat。

验收：

- store contract tests 对 File/SQLite 双实现通过。
- `getRunView` 不扫描文件。

### Phase 3：迁移器

交付：

- dry-run。
- apply。
- verify。
- manifest。
- backup。
- 忽略 `.tmp`。

验收：

- 真实 `data/` 样本迁移成功。
- parity report 无 blocker。
- 失败可重复执行。

### Phase 4：切换 API/Worker

交付：

- `createHivewardStore()` 根据 env 创建 SQLite store。
- API/worker/services 使用接口。
- 默认 backend 设为 SQLite。
- JSON backend 保留只读 fallback。

验收：

- 可以创建蓝图。
- 可以跑 manager 自迭代。
- 可以 approval reply。
- 可以并行 Agent。
- 可以发布 artifact。
- UI run detail 正常。

### Phase 5：停止核心 JSON 写路径

交付：

- 不再写 `data/runs/run-*.json` 作为运行主链路。
- 不再重写 `hiveward-store.json` 作为运行主链路。
- 显式 export/archive 另走命令。

验收：

- 新 run 不产生 run archive JSON。
- Windows 连续跑不出现 rename EPERM。
- 导出功能仍能生成 JSON archive。

## 20. 回滚策略

允许短期回滚：

```text
HIVEWARD_STORE_BACKEND=json-readonly
```

含义：

- 只允许读取旧 JSON。
- 不允许继续写旧 JSON 作为实时状态。
- 用于查看旧数据和导出，不用于新 run。

真正回滚步骤：

1. 停止服务。
2. 备份当前 SQLite。
3. 设置 backend 为 `json-readonly`。
4. 启动只读检查。
5. 修复迁移器或 schema 后重新迁移。

禁止：

- SQLite 写失败后自动落回 JSON 写。
- JSON/SQLite 长期双写。
- 静默丢弃迁移失败对象。

## 21. 验收标准

工程完成必须同时满足：

- 新 run 的核心状态只写 SQLite。
- `data/runs/*.json` 不再作为运行时写入目标。
- approval pending 查询不扫描 archive。
- run detail 可以从 SQLite 组装完整 `BlueprintRunView`。
- Agent 报告、handoff、artifact 元信息可查询。
- Manager 多轮自迭代可以完成。
- reply/reject/approve/complete/terminate 均可追溯。
- 并行 Agent 状态不会互相覆盖。
- artifact 文件路径和 download URL 正确。
- 迁移真实 data 样本 parity 通过。
- Windows smoke 不再出现 JSON rename EPERM。

## 22. 工程师注意事项

- 先写 contract test，再写 SQLite store。
- 不要先改 UI 大布局。
- 不要把所有表都设计成 `id + payload_json`。
- 不要在 Agent 执行期间持有事务。
- 不要从 Markdown 反推 artifact。
- 不要让 summary/list 查询加载大 output。
- 不要为了兼容保留长期双写。
- 不要把 `managerMail` 当主事实继续维护；它只能是 projection。
- 每个状态变更必须有 event。
- event 写失败，状态变更也必须失败。
- migration verify 失败，禁止切 backend。
