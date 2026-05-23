# Hiveward

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="apps/web/public/brand/hiveward-wordmark-on-dark.png">
    <img src="apps/web/public/brand/hiveward-wordmark.png" alt="Hiveward" width="420">
  </picture>
</p>

<p align="center">
  <strong>Put 101 agents to work for you overnight.</strong>
</p>

<p align="center">
  An open-source Agent Company workspace that organizes models, agents, blueprints, approvals, runs, and history into one managed operating system.
</p>

<p align="center">
  <img alt="Beta" src="https://img.shields.io/badge/beta-v0.1.0--beta.1-f59e0b">
  <a href="https://www.npmjs.com/package/@hiveward/cli"><img alt="npm CLI" src="https://img.shields.io/npm/v/%40hiveward%2Fcli?label=npm%20cli&color=cb3837"></a>
  <img alt="Multi-agent" src="https://img.shields.io/badge/multi--agent-blueprints-0ea5e9">
  <img alt="Runtime" src="https://img.shields.io/badge/runtime-OpenClaw-111827">
</p>

<p align="center">
  <a href="#what-is-hiveward">What is Hiveward?</a> ·
  <a href="#what-is-a-blueprint">What is a blueprint?</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#product-surfaces">Product surfaces</a> ·
  <a href="#quick-start">Quick start</a>
</p>

<p align="center">
  <strong>English</strong> | <a href="README.md">简体中文</a>
</p>

![Hiveward Manager blueprint canvas run state](docs/assets/screenshots/hiveward-manager-run-state.png)

<p align="center">
  <sub>A Manager blueprint dispatches Slots and agents on the canvas, with curved links showing the active coordination path while Hiveward tracks outputs and evidence. More product screenshots live on the <a href="docs/screenshots.md">screenshots page</a>.</sub>
</p>

## What is Hiveward?

Hiveward is an open-source workspace for Agent Companies. It does not try to become another model, and it does not hide all work inside a chat box. It gives agent teams a visible, governable, reviewable operating structure.

Think of it as an operations desk for the next generation of AI organizations: company as scope, blueprint as organization chart, models as resource pool, inbox as governance layer, and history as execution ledger.

Hiveward manages and displays company goals, blueprint structure, node configuration, model selection, run state, human approvals, and history. Real execution remains owned by OpenClaw and other agent runtimes, keeping Hiveward as a clean product layer instead of leaking runtime mechanics into the UI.

## What is a blueprint?

A blueprint is not a static diagram. It is a runnable agent work definition that describes who does what, in which order, when work must be summarized or approved, and how results are delivered.

A blueprint has three core parts:

- Nodes: agents, managers, parallel lanes, summaries, approvals, and delivery steps.
- Edges: success paths, failure paths, sequencing, and rollback routes between nodes.
- Run records: node status, inputs, outputs, OpenClaw references, cost, and timing evidence for each execution.

Manager nodes act as dispatchers inside a blueprint. They read upstream input and previous results, choose the next Slot, assign work to agents, request rework, or finish the workflow. This turns agents from one-off chat sessions into organized, managed, reviewable work units.

## Why Hiveward?

Modern agent tools can write code, research, and execute tasks, but the product experience is still often a chat window plus repeated prompt copying. Once work becomes complex, the limits appear quickly:

- There is no clear operating structure for who starts, reviews, and delivers.
- Execution is hidden inside conversations, making failures and intermediate outputs hard to inspect.
- Model choice and agent identity blur together.
- Human decisions have no stable approval surface.
- Finished work does not become reusable team capability.

Hiveward starts from a different assumption: agents should not only be smarter chat partners. They should become organized, managed, and auditable work units.

## How it works

1. Choose a company: every company owns its own goals, blueprints, run records, and approval context.
2. Design a blueprint: place agents, managers, parallel lanes, summaries, approvals, and delivery nodes on one canvas.
3. Configure models: inspect models, defaults, agent identity, and capability information from the OpenClaw catalog.
4. Start a run: Hiveward orchestrates blueprint nodes and shows each step's state, output, and evidence.
5. Approve and review: human decisions land in the inbox, while completed work becomes execution history.

```mermaid
graph LR
  Company[Company Context]
  Blueprint[Blueprint]
  Models[Model and Agent Config]
  Run[Run Monitor]
  Inbox[Approval Inbox]
  History[History Ledger]
  Runtime[OpenClaw Runtime]

  Company --> Blueprint
  Blueprint --> Models
  Models --> Run
  Run --> Inbox
  Run --> History
  Run --> Runtime
```

## Product surfaces

The main README keeps one trusted run-state screenshot so new users see the core product loop first. Additional screenshots are maintained on the [screenshots page](docs/screenshots.md), including:

- Blueprint Studio: express how an agent team works on a runnable canvas.
- Model Configuration: inspect models, defaults, usage, and OpenClaw catalog capabilities.
- Run Monitor: watch node-level status, output previews, failure state, and execution evidence.
- Inbox: handle workflow steps that require human judgment.
- History: review successful runs, failed runs, output summaries, and timing.

## Core capabilities

- Company context: organize goals, blueprints, runs, and approvals by company.
- Blueprint orchestration: describe agent team structure with visual nodes.
- Manager dispatch: let Manager nodes choose Slots, assign agents, request rework, or finish a workflow.
- Agent team management: separate Hiveward display identity from real OpenClaw runtime identity.
- Model resource pool: inspect models, defaults, usage, and provider state.
- Human governance: handle judgment points through the inbox.
- Run ledger: turn every execution into reviewable history.
- Runtime boundary: Hiveward owns the product layer; OpenClaw owns real execution.

## Current status

Current beta: `v0.1.0-beta.1`. The project is roughly 80% of the way to the intended formal release. Core product surfaces are ready for local demos and early use, while APIs and interaction details may still evolve.

## Quick start

### npm CLI install

Hiveward can be installed as a product command:

```bash
npm install -g @hiveward/cli
hiveward setup
hiveward start
```

You can also run it without a global install:

```bash
npx @hiveward/cli@beta setup
npx @hiveward/cli@beta start
```

See [npm CLI Installation](docs/npm-cli-install.md) for `hiveward doctor`, `hiveward update`, and install directory options.

### Source checkout

```bash
npm install
npm run check:env
npm run dev
```

- Web and API: `http://localhost:5173`
- Health check: `http://localhost:5173/healthz`

The default adapter mode is `OPENCLAW_ADAPTER=auto`. Hiveward connects to a real OpenClaw Gateway when local Gateway configuration is available, and falls back to mock mode otherwise.

## Development and repository hygiene

See [Development Setup](docs/development-setup.md) for the supported Node.js/npm versions, local environment template, and runtime configuration variables.

```bash
npm run check
npm test
npm run build
```

Read [CONTRIBUTING.md](CONTRIBUTING.md) before pushing. Do not commit secrets, local run data, generated output, internal working notes, or personal configuration.
