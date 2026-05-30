# Changelog

## v0.5.9 - 2026-05-30

Public repository cleanup release.

### 中文

- 清理 README 公开介绍：CLI harness 不再标记 Beta，当前版本徽章推进到 `v0.5.9`，删除 SQLite 迁移门禁和权限提示段落，新增首次配置 Harness Skill 的注意事项，并新增 Star 趋势图。
- 将本地计划稿、施工文档和准备材料移出公开 Git 跟踪，只保留正式文档、截图资产和公开 Skill 文档。
- 调整 SQLite 迁移 CLI 测试，让它只验证 CLI 参数行为，不再要求 README 保留迁移说明。
- 将 root、workspace package、lockfile 元数据和内部依赖版本保持在 `0.5.9`。

### English

- Cleaned public README copy: CLI harnesses are no longer labeled Beta, the version badge now points to `v0.5.9`, the SQLite migration gate and permission notice sections were removed, first-run Harness Skill guidance was added, and a Star history chart was added.
- Removed local planning, implementation, and preparation notes from public Git tracking while keeping official docs, screenshot assets, and public Skill docs.
- Updated the SQLite migration CLI test so it validates CLI argument behavior without requiring migration instructions to remain in the README.
- Kept root, workspace package, lockfile metadata, and internal dependency versions at `0.5.9`.

## v0.5.8 - 2026-05-30

Manager dispatch handoff rules release.

### 中文

- 新增 Manager 调度交接规则：Manager 可以把明确的下一步任务、上下文和产物位置交给后续 Agent，蓝图运行记录会保存这类 handoff 证据。
- 将 Agent workspace 产物、交接 JSON 和审批回复路径整理进同一套运行流，降低人工批准后信息丢失或重复分派的风险。
- 将 root、workspace package、lockfile 元数据和内部依赖版本保持在 `0.5.8`。

### English

- Added Manager dispatch handoff rules so Managers can pass explicit next-step tasks, context, and artifact locations to downstream Agents, with handoff evidence preserved in run records.
- Folded Agent workspace artifacts, machine handoff JSON, and approval replies into the same execution flow to reduce lost context or duplicate dispatch after human review.
- Kept root, workspace package, lockfile metadata, and internal dependency versions at `0.5.8`.

## v0.5.7 - 2026-05-30

Manager preflight Slots release.

### 中文

- 新增 Manager 自迭代预检 Slot，让 Manager 在正式分派前可以并行收集需求、研究、风险和执行建议。
- 将预检 Slot 与普通业务 Slot 分开处理，避免预检任务被正常 dispatch 流程重复消耗。
- 补强聊天、蓝图和存储测试，覆盖预检 Slot 的运行状态、角色技能断言和默认模型复用。
- 将 root、workspace package、lockfile 元数据和内部依赖版本推进到 `0.5.7`。

### English

- Added Manager self-iteration preflight Slots so Managers can gather requirements, research, risks, and execution suggestions before formal dispatch.
- Kept preflight Slots separate from normal business Slots so normal dispatch does not consume reserved preflight work twice.
- Strengthened chat, blueprint, and storage tests around preflight Slot run state, role skill assertions, and default model reuse.
- Bumped root, workspace package, lockfile metadata, and internal dependency versions to `0.5.7`.

## v0.5.6 - 2026-05-30

Official model options release.

### 中文

- 扩展 OpenClaw 配置向导中的官方模型选项，覆盖更多 Claude、OpenAI 和 Gemini 常用模型。
- 扩展 Claude Code 预设模型映射，同时保留本地运行时发现的模型目录合并能力。
- 稳定 release-report 审批相关测试，减少默认模型和审批回复路径的回归风险。
- 将 root、workspace package、lockfile 元数据和内部依赖版本推进到 `0.5.6`。

### English

- Expanded official model options in the OpenClaw configuration wizard across common Claude, OpenAI, and Gemini models.
- Expanded Claude Code preset model mappings while preserving the ability to merge runtime-discovered local catalogs.
- Stabilized release-report approval tests to reduce regression risk around default models and approval replies.
- Bumped root, workspace package, lockfile metadata, and internal dependency versions to `0.5.6`.

## v0.5.5 - 2026-05-30

Runtime reference decoupling release.

### 中文

- 将蓝图、运行和存储中的运行时引用收敛到 `runtimeRef` / `runtimeRefs` 等中性字段，减少对 OpenClaw 命名的耦合。
- 保留旧字段兼容路径，确保已有运行记录和 SQLite / JSON 数据在升级后仍能读取。
- 更新 adapter、worker、run state 和 catalog 映射，让 OpenClaw、Codex、Claude Code 与 CLI harness 使用同一套运行时边界。
- 将 root、workspace package、lockfile 元数据和内部依赖版本推进到 `0.5.5`。

### English

- Moved blueprint, run, and storage runtime references toward neutral `runtimeRef` / `runtimeRefs` fields to reduce OpenClaw-specific coupling.
- Preserved compatibility readers for legacy fields so existing SQLite / JSON data and run records continue to load after upgrade.
- Updated adapter, worker, run state, and catalog mapping so OpenClaw, Codex, Claude Code, and CLI harnesses share one runtime boundary.
- Bumped root, workspace package, lockfile metadata, and internal dependency versions to `0.5.5`.

## v0.5.4 - 2026-05-30

Hermes compatibility release.

### 中文

- 新增 Hermes CLI harness 配置、状态检测、模型默认值、Profile 读取和聊天/蓝图运行入口。
- 将 Hermes 加入主导航、模型页、Agent/Profile 页、技能页和 channel 页，保持与 OpenClaw 风格一致的操作面。
- 扩展 API、adapter、Blueprint Studio 和 SDK runtime 测试，覆盖 Hermes profile、环境默认模型和 CLI 参数映射。
- 将 root、workspace package、lockfile 元数据和内部依赖版本推进到 `0.5.4`。

### English

- Added Hermes CLI harness configuration, status checks, model defaults, profile loading, and chat / blueprint execution entry points.
- Added Hermes to navigation, model pages, Agent/Profile pages, skills, and channels with an operation surface aligned to OpenClaw.
- Expanded API, adapter, Blueprint Studio, and SDK runtime tests around Hermes profiles, environment default models, and CLI argument mapping.
- Bumped root, workspace package, lockfile metadata, and internal dependency versions to `0.5.4`.

## v0.5.3 - 2026-05-30

Blueprint canvas contrast release.

### 中文

- 优化 Blueprint Studio 画布对比度，让节点、连线、小地图和选中状态在浅色背景下更清晰。
- 增加画布样式测试，锁住关键颜色、边框和状态样式，降低后续主题调整的回归风险。
- 将 root、workspace package、lockfile 元数据和内部依赖版本推进到 `0.5.3`。

### English

- Improved Blueprint Studio canvas contrast so nodes, edges, minimap elements, and selected states are clearer on the light surface.
- Added canvas style tests to lock key colors, borders, and state styling against future theme regressions.
- Bumped root, workspace package, lockfile metadata, and internal dependency versions to `0.5.3`.

## v0.5.2 - 2026-05-30

Blueprint edit preservation release.

### 中文

- 修复 Blueprint Studio 未保存编辑被远端刷新或运行状态覆盖的问题，保存前会保留本地改动。
- 新增蓝图编辑状态辅助模块和测试，覆盖脏状态、远端快照协调和保存后重置。
- 微调编辑中提示和画布状态样式，让用户更容易判断哪些改动仍未保存。
- 将 root、workspace package、lockfile 元数据和内部依赖版本推进到 `0.5.2`。

### English

- Fixed Blueprint Studio unsaved edits being replaced by remote refreshes or run-state updates before save.
- Added blueprint edit-state helpers and tests for dirty state, remote snapshot coordination, and reset after save.
- Polished in-progress edit hints and canvas state styling so users can see which changes are still unsaved.
- Bumped root, workspace package, lockfile metadata, and internal dependency versions to `0.5.2`.

## v0.5.1 - 2026-05-29

Blueprint Manager UI polish and Harness permission inheritance release.

### 中文

- 优化 Blueprint Studio 节点详情面板：Manager 面板对齐参考 UI 的样式、宽度和字段顺序，把系统提示词放回标准配置区。
- 将 Agent、Manager 和 Harness Summary 的前置字段统一为 Harness、模型、权限模式和系统提示词的顺序；Manager 额外保留管理器模式三段切换。
- 新增跨轮上下文配置，并在蓝图运行时把节点历史、上游输出和可选 Manager 记忆注入 Agent / Summary 执行上下文。
- 让节点权限模式继承 Harness 配置页的安全模式 / 完全访问模式；保存或运行蓝图前同步 `permissionProfile` 和 `runtimeAccessPolicy`，避免节点单独重复设置。
- 将 root、workspace package、lockfile 元数据和内部依赖版本推进到 `0.5.1`。

### English

- Polished Blueprint Studio node detail panels: the Manager panel now follows the referenced UI style, width, and field order, with the system prompt back in the standard section.
- Aligned Agent, Manager, and Harness Summary front-matter ordering around Harness, model, permission mode, and system prompt; Managers keep the three-way manager mode switch.
- Added cross-round context configuration and runtime injection for node history, upstream outputs, and optional Manager memory in Agent / Summary execution.
- Made node permission mode inherit the Harness configuration page's Safe mode / Full access setting; blueprint save/run now syncs both `permissionProfile` and `runtimeAccessPolicy`.
- Bumped root, workspace package, lockfile metadata, and internal dependency versions to `0.5.1`.

## v0.5.0 - 2026-05-29

SQLite-backed Manager self-iteration runtime release.

### 中文

- 将运行时核心状态切换到 SQLite：run、round、node、event、approval、inbox、Agent 报告、handoff 和 artifact 元信息进入统一账本。
- 新增 JSON 到 SQLite 的启动迁移、深度校验、manifest、schema migration fail-closed 和本地升级修复路径。
- 收紧 Worker 状态机、Agent 输出发布事务、审批/收件箱条件更新和 artifact object store，降低 Windows 文件锁与大 JSON 覆盖写风险。
- 将 Agent 的 Markdown 报告、人机交付位置、机器 handoff JSON 和 artifact 索引拆清楚，运行页优先展示人类可读报告和可打开产物。
- 更新 CEO / Leader skill 与 Manager 自迭代文档，记录下一版流式输出和页面布局优化方向。
- 将仓库、workspace 包和内部依赖版本推进到 `0.5.0`。

### English

- Moved runtime state to SQLite for runs, rounds, nodes, events, approvals, inbox items, agent reports, handoffs, and artifact metadata.
- Added JSON-to-SQLite startup migration, deep verification, manifests, fail-closed schema migrations, and local upgrade repair.
- Hardened the worker state machine, transactional agent output publishing, approval/inbox conditional updates, and artifact object storage to reduce Windows file-lock and large JSON rewrite failures.
- Separated human Markdown reports, delivery locations, machine handoff JSON, and artifact indexes so the runs page can prioritize readable reports and openable outputs.
- Updated CEO / Leader skills and Manager self-iteration documentation, including follow-up direction for streaming output and page layout polish.
- Bumped repository, workspace package, and internal dependency versions to `0.5.0`.

## v0.4.2 - 2026-05-28

Small Harness permission clarity release.

### 中文

- 将各个 CLI Harness 配置页的权限入口整理为“全部权限”，并把安全模式 / 完全访问模式说明收进标题旁的悬浮提示。
- “全部权限”现在覆盖聊天默认权限，以及蓝图里引用该 Harness 的 Agent / Manager 节点权限同步。
- 保存或运行蓝图前，会根据当前 Harness 权限设置同步对应节点的 `permissionProfile`。
- 将仓库、workspace 包和内部依赖版本推进到 `0.4.2`。

### English

- Reworked each CLI Harness configuration page around an “All permissions” control, moving Safe mode / Full access explanations into the title tooltip.
- “All permissions” now covers chat defaults and blueprint Agent / Manager nodes that reference the same harness.
- Before saving or running a blueprint, HiveWard syncs matching node `permissionProfile` values from the current harness permission settings.
- Bumped repository, workspace package, and internal dependency versions to `0.4.2`.

## v0.4.0 - 2026-05-28

Multi-CLI harness release.

### 中文

- 新增 Google CLI、Cursor CLI、OpenCode、Hermes harness。
- 这些新增 CLI harness 的代码路径已接入并覆盖本地测试，真实 CLI 安装、订阅、认证和上游输出格式仍可能因用户环境而变化。
- 新增 harness 已接入配置页、聊天入口、蓝图运行入口、模型默认值与状态检测、权限模式，以及技能安装入口。
- 将仓库、workspace 包和内部依赖版本推进到 `0.4.0`。

### English

- Added Google CLI, Cursor CLI, OpenCode, and Hermes harnesses.
- The local code paths for these new CLI harnesses are wired and tested, while real CLI installs, subscriptions, authentication, and upstream output formats may still vary by environment.
- The new harnesses are available through configuration pages, chat and blueprint run entry points, model default/status detection, permission modes, and skill installation entry points.
- Bumped repository, workspace package, and internal dependency versions to `0.4.0`.

## v0.3.4 - 2026-05-28

Small Blueprint Studio canvas usability release.

### 中文

- 新增蓝图画布边缘/角落自动扩展，拖动画布到边界时可以继续扩大工作区。
- 根据远处已有节点初始化画布范围，并保留两圈外部留白。
- 保持缩放限制和小地图尺寸逻辑，同时把小地图视口标记从白色描边改为半透明高亮区域。
- 将仓库、workspace 包和内部依赖版本推进到 `0.3.4`。

### English

- Added automatic Blueprint Studio canvas expansion when users pan to canvas edges or corners.
- Sized the initial canvas around existing far-away nodes with two outer rings of padding.
- Kept zoom limits and minimap sizing logic intact, while changing the minimap viewport marker from a white outline to a translucent highlight region.
- Bumped repository, workspace package, and internal dependency versions to `0.3.4`.

## v0.3.3 - 2026-05-27

Small homepage polish release for the community QR card.

### 中文

- 将首页交流群二维码换成真实图片，并把公告与二维码卡片排到同一屏内，更容易一眼看到入口。
- 将仓库、workspace 包和内部依赖版本推进到 `0.3.3`。

### English

- Replaced the homepage community QR placeholder with the real image and aligned the notice with the QR card so the entry point is easier to spot.
- Bumped repository, workspace package, and internal dependency versions to `0.3.3`.

## v0.3.2 - 2026-05-27

Small bugfix release for Blueprint Studio control usability and public project copy.

### 中文

- 修复蓝图工作台选择控件：空公司蓝图选择、Claude Code harness 切换、模型默认值显示、自定义模型保留和下拉菜单关闭行为。
- 将仓库、workspace 包和内部依赖版本推进到 `0.3.2`。
- 更新 README 和项目简介文案，突出 slogan：让101个Agent合作为你打工。

### English

- Fixed Blueprint Studio controls for empty company blueprint selection, Claude Code harness switching, default model display, custom model preservation, and select-menu closing behavior.
- Bumped repository, workspace package, and internal dependency versions to `0.3.2`.
- Updated README and project-description copy around the slogan: Put 101 agents to work together for you.

## v0.3.1 - 2026-05-27

Small bugfix release for blueprint run state cleanup.

### 中文

- 修复终态蓝图运行的清理逻辑，避免已经成功的 run 被残留清理节点误判成失败。
- 将仓库、workspace 包和内部依赖版本推进到 `0.3.1`。

### English

- Fixed terminal blueprint-run cleanup so successful runs are not misread as failed because of stale cleanup nodes.
- Bumped repository, workspace package, and internal dependency versions to `0.3.1`.

## v0.1.0-beta.1 - 2026-05-23

First public beta line for Hiveward.

### 中文

- 将仓库版本切换到标准 beta 命名：`0.1.0-beta.1`。
- 重写 GitHub README，加入中英双语项目叙事、产品理念、功能介绍、架构边界和本地运行说明。
- 增加蓝图、模型配置、运行、收件箱和历史页面截图，支撑首个 beta 展示。

### English

- Moved repository versioning to the beta semver line: `0.1.0-beta.1`.
- Rebuilt the GitHub README with bilingual positioning, narrative, feature overview, architecture boundary, and local run instructions.
- Added screenshots for the blueprint studio, model configuration, run monitor, inbox, and history surfaces.
