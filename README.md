# Hiveward

Hiveward is a command layer for autonomous agent teams. It gives one operator a structured way to command Codex, Claude Code, OpenClaw, and other full agent harnesses through blueprints, handoffs, review gates, and auditable runs.

OpenClaw remains the execution runtime. Hiveward owns blueprint definitions, canvas state, node configuration, run views, approvals, and local display state.

## Run

```bash
npm install
npm run dev
```

- Web: `http://localhost:5173`
- API: `http://localhost:8787`

## OpenClaw Gateway

By default, `OPENCLAW_ADAPTER=auto`: Hiveward connects to a real OpenClaw Gateway when it can resolve config from `~/.openclaw/openclaw.json` or environment variables, and falls back to mock mode otherwise.

Available environment variables:

- `OPENCLAW_ADAPTER=auto|real|gateway|mock`
- `OPENCLAW_GATEWAY_URL=ws://127.0.0.1:18789`
- `OPENCLAW_GATEWAY_TOKEN=...`
- `OPENCLAW_GATEWAY_PASSWORD=...`
- `OPENCLAW_GATEWAY_ORIGIN=http://127.0.0.1:18789`
- `OPENCLAW_GATEWAY_LOCALE=zh-CN`
- `OPENCLAW_AGENT_START_TIMEOUT_MS=20000`

## Running Real Agents

1. Open `http://localhost:5173`.
2. Use the OpenClaw panel to refresh real models, agents, tools, and channels.
3. Select an agent node on the blueprint canvas.
4. Choose a real `OpenClaw agent`; the local default is usually `main`.
5. Choose a model, or keep `OpenClaw default`.
6. Edit the prompt.
7. Run the blueprint. Hiveward saves the blueprint, calls OpenClaw through the adapter, and records runtime evidence.

Node labels such as `Requirements Agent` are Hiveward display labels. Real execution identity comes from explicit fields such as `agentId`, `modelId`, `taskId`, `runId`, and `sessionKey`.

## Architecture Boundary

```text
Web -> Hiveward API -> OpenClaw Adapter -> OpenClaw Gateway / Runtime
```

- Blueprint graph, node coordinates, protocols, labels, and dashboard aggregation belong to Hiveward.
- Agent/tool/model/channel execution facts belong to OpenClaw.
- Gateway/RPC details belong inside `packages/adapter`.

Run the guardrail check:

```bash
npm run check:boundaries
```
