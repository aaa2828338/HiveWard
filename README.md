# Hiveward

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="apps/web/public/brand/hiveward-wordmark-on-dark.png">
    <img src="apps/web/public/brand/hiveward-wordmark.png" alt="Hiveward" width="420">
  </picture>
</p>

<h2 align="center">让101个Agent合作为你打工</h2>

<p align="center">
  开源的 Agent Company 工作台。把模型、Agent、蓝图、审批、运行和历史组织成一个可管理的数字公司。
</p>

<p align="center">
  <img alt="Beta" src="https://img.shields.io/badge/beta-v0.1.0--beta.1-f59e0b">
  <a href="https://www.npmjs.com/package/@hiveward/cli"><img alt="npm CLI" src="https://img.shields.io/npm/v/%40hiveward%2Fcli?label=npm%20cli&color=cb3837"></a>
  <img alt="Multi-agent" src="https://img.shields.io/badge/multi--agent-blueprints-0ea5e9">
  <img alt="Runtime" src="https://img.shields.io/badge/runtime-OpenClaw-111827">
</p>

<p align="center">
  <a href="#hiveward-是什么">Hiveward 是什么</a> ·
  <a href="#蓝图是什么">蓝图是什么</a> ·
  <a href="#它如何工作">它如何工作</a> ·
  <a href="#产品界面">产品界面</a> ·
  <a href="#快速开始">快速开始</a>
</p>

<p align="center">
  <a href="README.en.md">English</a> | <strong>简体中文</strong>
</p>

![Hiveward Manager 蓝图画布运行状态](docs/assets/screenshots/hiveward-manager-run-state.png)

<p align="center">
  <sub>Manager 蓝图在画布上调度 Slot 和 Agent，曲线连线展示运行中的协作路径，节点输出和证据在 Hiveward 中可追踪。更多界面截图见 <a href="docs/screenshots.md">截图页</a>。</sub>
</p>

## Hiveward 是什么？

Hiveward 是一个面向 Agent Company 的开源工作台。它不试图再造一个模型，也不把所有东西塞进一个聊天框，而是给 Agent 团队一个可视化、可审批、可复盘的组织结构。

你可以把它理解成新一代 AI 组织的操作台：公司是边界，蓝图是组织结构，模型是资源池，收件箱是治理层，历史是执行账本。

Hiveward 负责管理和展示：公司目标、蓝图结构、节点配置、模型选择、运行状态、人工审批和历史记录。底层真实执行交给 OpenClaw 等 agent runtime，确保 Hiveward 是清晰的产品层，而不是把运行时细节藏进 UI。

## 蓝图是什么？

蓝图（Blueprint）不是静态流程图，而是一份可运行的 Agent 工作定义。它描述“谁做什么、按什么顺序做、什么时候需要汇总或审批、结果如何交付”。

一张蓝图由三类核心信息组成：

- 节点：Agent、Manager、并行分工、汇总、审批、发送等工作单位。
- 连线：节点之间的先后关系、成功路径、失败路径和回退路径。
- 运行记录：每次执行时的节点状态、输入输出、OpenClaw 引用、成本和时间证据。

Manager 节点是蓝图里的调度者。它可以读取上游输入和历史结果，把任务分发到不同 Slot，让多个 Agent 按计划接力、返工或结束流程。这样，Agent 不再只是单次聊天，而是可以被组织、管理和复盘的工作单位。

## 为什么需要 Hiveward？

现在的 Agent 工具已经能写代码、查资料、跑任务，但大多数体验仍停留在“打开一个对话框，然后反复复制 prompt”。当任务变复杂，问题会很快出现：

- 任务没有组织结构，谁先做、谁复核、谁交付很难看清。
- 运行过程被藏在对话里，失败原因和中间产物难以追踪。
- 模型和 Agent 身份混在一起，很难知道真实执行者是谁。
- 需要人工决策时，没有稳定的审批入口。
- 做过的工作无法沉淀成可复用的团队能力。

Hiveward 的核心判断是：Agent 不应该只是“更聪明的聊天对象”，它应该变成可以被组织、管理和复盘的工作单位。

## 它如何工作？

1. 选择公司：每家公司拥有自己的目标、蓝图、运行记录和审批上下文。
2. 设计蓝图：把 Agent、Manager、并行分工、汇总、审批和交付节点放到同一张画布上。
3. 配置模型：从 OpenClaw 目录中查看模型、默认模型、Agent 身份和能力信息。
4. 启动运行：Hiveward 调度蓝图节点，展示每一步状态、输出和运行证据。
5. 审批与复盘：需要人类判断的节点进入收件箱，完成后的运行进入历史账本。

```mermaid
graph LR
  Company[公司上下文]
  Blueprint[蓝图]
  Models[模型和 Agent 配置]
  Run[运行监控]
  Inbox[收件箱审批]
  History[历史账本]
  Runtime[OpenClaw Runtime]

  Company --> Blueprint
  Blueprint --> Models
  Models --> Run
  Run --> Inbox
  Run --> History
  Run --> Runtime
```

## 产品界面

主 README 只保留一张最可信的运行截图，方便新用户先理解 Hiveward 的核心工作方式。完整界面截图单独维护在 [截图页](docs/screenshots.md)，包括：

- 蓝图指挥台：用画布表达 Agent 团队的协作结构。
- 模型配置：查看可用模型、默认模型、模型用量和 OpenClaw 目录能力。
- 运行监控：查看节点级状态、输出预览、失败状态和运行证据。
- 收件箱：处理需要人类判断的审批节点。
- 历史：回看成功、失败、输出摘要和运行时间。

## 核心能力

- 公司级上下文：以公司为边界组织目标、蓝图、运行和审批。
- 蓝图编排：用可视化节点表达 Agent 团队的任务结构。
- Manager 调度：让 Manager 节点根据上下文选择 Slot、分派 Agent、回退返工或结束流程。
- Agent 团队管理：区分 Hiveward 展示身份和 OpenClaw 真实执行身份。
- 模型资源池：集中查看模型、默认模型、用量和 provider 状态。
- 人工治理：通过收件箱处理需要判断的审批节点。
- 运行账本：把每一次执行沉淀为可复盘的历史记录。
- Runtime 边界：Hiveward 负责产品层，OpenClaw 负责真实执行层。

## 当前状态

当前版本是第一个 beta：`v0.1.0-beta.1`。项目大约完成正式版目标的 80%，核心产品面已经可用于本地演示和早期体验，API 与交互细节仍可能继续调整。

## 快速开始

### 产品安装（npm CLI）

```bash
npm install -g @hiveward/cli
hiveward setup
hiveward start
```

也可以不做全局安装，直接用 npx：

```bash
npx @hiveward/cli@beta setup
npx @hiveward/cli@beta start
```

常用命令：

- `hiveward doctor`：检查 Node.js、npm、安装目录、依赖和端口。
- `hiveward update`：检查 npm 上是否有新版 Hiveward CLI。

更多安装和更新规则见 [npm CLI Installation](docs/npm-cli-install.md)。

### 源码开发

```bash
npm install
npm run check:env
npm run dev
```

- Web 与 API：`http://localhost:5173`
- 健康检查：`http://localhost:5173/healthz`

默认 `OPENCLAW_ADAPTER=auto`。当本机能解析 OpenClaw Gateway 配置时，Hiveward 会连接真实 OpenClaw；否则会使用 mock 模式，方便本地演示和 UI 开发。

## 开发与仓库卫生

开发环境版本、环境变量模板和 runtime 配置见 [Development Setup](docs/development-setup.md)。

```bash
npm run check
npm test
npm run build
```

提交前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)，不要把密钥、本地运行数据、构建产物、内部工作记录或个人配置推到公开仓库。
