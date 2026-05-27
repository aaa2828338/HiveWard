# Changelog

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
