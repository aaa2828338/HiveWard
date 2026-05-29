# Changelog

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

Multi-CLI harness beta release.

### 中文

- 新增 Google CLI Beta、Cursor CLI Beta、OpenCode Beta、Hermes Beta harness。
- 这些新增 CLI harness 目前标记为 Beta：代码路径已接入并覆盖本地测试，但真实 CLI 安装、订阅、认证和上游输出格式仍可能因用户环境而变化。
- 新增 harness 已接入配置页、聊天入口、蓝图运行入口、模型默认值与状态检测、权限模式，以及技能安装入口。
- 将仓库、workspace 包和内部依赖版本推进到 `0.4.0`。

### English

- Added Google CLI Beta, Cursor CLI Beta, OpenCode Beta, and Hermes Beta harnesses.
- These new CLI harnesses are currently marked Beta: the local code paths are wired and tested, while real CLI installs, subscriptions, authentication, and upstream output formats may still vary by environment.
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
