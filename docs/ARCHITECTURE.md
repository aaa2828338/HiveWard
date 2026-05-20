# Architecture

`hiveward` is a product and orchestration layer, not a replacement runtime.

## Ownership

| Area | Owner |
| --- | --- |
| Blueprint canvas, graph, layout, versions | Hiveward |
| Blueprint runs, node runs, approval state | Hiveward |
| Dashboard widgets, saved views, tags, notes | Hiveward |
| Agents, tasks, tools, model routing, channel delivery | OpenClaw |
| Provider usage facts and execution transcripts | OpenClaw |

## Runtime Shape

```mermaid
graph LR
  Web[hiveward Web]
  API[Hiveward API]
  DB[(Hiveward Store)]
  Worker[Hiveward Blueprint Worker]
  Adapter[OpenClaw Adapter]
  OC[OpenClaw Gateway / Runtime]

  Web --> API
  API --> DB
  API --> Worker
  Worker --> DB
  Worker --> Adapter
  API --> Adapter
  Adapter --> OC
```

## MVP Scope

- Web canvas for blueprint editing and run observation.
- Companion API for Hiveward-owned state.
- Embedded blueprint worker for orchestration.
- Adapter interface with both mock and OpenClaw Gateway implementations.
- Boundary check script for CI.

## Gateway Adapter

The default adapter mode is `auto`. In `auto`, the API uses the real OpenClaw Gateway when it can resolve connection settings from environment variables or `~/.openclaw/openclaw.json`; otherwise it falls back to the mock adapter for local UI development.

`OPENCLAW_ADAPTER=real` or `OPENCLAW_ADAPTER=gateway` makes missing Gateway configuration a startup error. `OPENCLAW_ADAPTER=mock` forces the deterministic mock implementation.
