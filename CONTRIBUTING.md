# Contributing

## Repository Hygiene

Before opening a pull request or pushing a release branch, keep the repository tree focused on source code, public product documentation, and intentional assets.

Do not commit:

- Secrets, tokens, passwords, private keys, certificates, API keys, or credential files.
- `.env`, `.env.*`, `*.local`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `*.crt`, `*.csr`, `*.token`, or `*.secret` files.
- Local OpenClaw, Codex, Claude Code, or agent runtime configuration, including `~/.openclaw/openclaw.json` contents.
- Local run state such as `data/*.json`, `data/blueprints/*.json`, or `data/runs/*.json`; keep only the checked-in `.gitkeep` placeholders.
- Generated output such as `dist/`, `.vite/`, `coverage/`, `*.tsbuildinfo`, logs, temporary browser profiles, screenshots from local QA, or files under `tmp/`.
- Dependency folders such as `node_modules/` or workspace-local `node_modules/`.
- Internal agent operating instructions, personal work records, draft execution plans, or local coordination state such as `AGENTS.md`, `DESIGN.md`, `.codex/`, or `.omx/`.

Allowed public assets include source files, package metadata, README/CHANGELOG content, and intentional product screenshots under `docs/assets/screenshots/`.

## Pre-Push Checklist

Run these checks before pushing:

```bash
npm run check
npm test
npm run build
```

Then inspect the repository state:

```bash
git status --short --ignored=matching
git grep -n -I -E "(BEGIN (RSA|OPENSSH|PRIVATE)|Bearer [A-Za-z0-9._-]{20,}|OPENCLAW_GATEWAY_(TOKEN|PASSWORD)=\\S+)" HEAD -- .
```

`git status` should show no tracked changes. Ignored local dependency folders are acceptable.

## 仓库卫生规则

提交和推送前，仓库里只应该留下项目源码、公开产品文档和明确需要展示的资产。

不要提交：

- 密钥、Token、密码、私钥、证书、API Key 或任何凭据文件。
- `.env`、`.env.*`、`*.local`、`*.pem`、`*.key`、`*.p12`、`*.pfx`、`*.crt`、`*.csr`、`*.token`、`*.secret`。
- 本地 OpenClaw、Codex、Claude Code 或 Agent runtime 配置，尤其不要提交 `~/.openclaw/openclaw.json` 的内容。
- 本地运行数据，例如 `data/*.json`、`data/blueprints/*.json`、`data/runs/*.json`；这些目录只保留 `.gitkeep`。
- 构建产物和临时文件，例如 `dist/`、`.vite/`、`coverage/`、`*.tsbuildinfo`、日志、临时浏览器 profile、本地 QA 截图或 `tmp/` 下的文件。
- 依赖目录，例如 `node_modules/` 或 workspace 内的 `node_modules/`。
- 内部 Agent 操作说明、个人工作记录、草稿执行计划、本地协调状态，例如 `AGENTS.md`、`DESIGN.md`、`.codex/`、`.omx/`。

可以提交的公开资产包括源码、包元数据、README/CHANGELOG，以及明确用于项目展示的 `docs/assets/screenshots/` 截图。
