# openclaw-cui Engineering Principles

You are working on `openclaw-cui`, a CUI-owned visual orchestration product that delegates real execution to OpenClaw. Keep the project clean, bounded, and verifiable.

## Product Boundary

- CUI owns workflow definitions, canvas state, node configuration, run views, approval state, and local display state.
- OpenClaw owns agents, models, tools, channels, sessions, transcripts, runtime execution, usage facts, and delivery integrations.
- Runtime-specific Gateway/RPC details belong in `packages/adapter`; do not leak protocol mechanics into React components, shared workflow contracts, or the API worker.
- Node labels such as `1. Brief` or `Requirements Agent` are CUI display labels. Real execution identity must come from explicit fields such as `agentId`, `modelId`, `taskId`, `runId`, and `sessionKey`.

## Change Discipline

- Prefer small, reversible edits that preserve the existing package layout: `apps/web`, `apps/api`, `packages/shared`, `packages/adapter`.
- Do not add dependencies unless they are necessary for a concrete feature and fit the existing stack.
- Do not introduce new abstraction layers until repeated code or a real boundary problem justifies them.
- Keep mock behavior isolated. Real OpenClaw paths must keep working when `OPENCLAW_ADAPTER=auto` resolves Gateway config.
- Avoid hidden behavior. If the backend stores a run or OpenClaw reference, the UI should expose enough detail to inspect it.

## Data Hygiene

- `data/cui-store.json` must always remain valid UTF-8 JSON. Validate it after manual edits.
- Avoid writing non-ASCII seed data through PowerShell here; console encoding can corrupt JSON. Prefer ASCII seed fixtures or carefully verified UTF-8 writes.
- Do not delete user-created workflows, runs, or catalog snapshots unless explicitly asked.
- Do not store secrets, tokens, or `~/.openclaw/openclaw.json` contents in the repo.
- Do not commit or depend on generated build output. Keep source of truth in source files and `data/cui-store.json`.

## Real OpenClaw Execution

- Before claiming real execution, verify with Gateway-backed evidence: refreshed catalog, real `agentId`, real `modelId`, and OpenClaw `taskId` or `runId`.
- Avoid expensive real agent runs unless the request requires proof. Prefer `deepseek/deepseek-v4-flash` or the configured default for smoke tests.
- For chained workflows, downstream agent nodes must receive upstream outputs through structured input, not just status strings.
- If OpenClaw returns only a status summary, inspect `chat.history` and persist the assistant text so the CUI run result is useful.

## UI Principles

- Build the usable workflow surface, not a marketing shell.
- Keep controls direct: workflow selector, language toggle, catalog refresh, save, run, inspector, and run results.
- The run panel must make completed node outputs visible without requiring hidden browser state.
- Use concise labels and stable layout. Avoid UI text that misrepresents CUI nodes as registered OpenClaw agents.

## Verification Gate

Run the smallest checks that prove the change, then broaden when shared contracts are touched.

- Shared/API/adapter contract changes: `npm run check`
- Frontend behavior changes: `npm run typecheck -w @openclaw-cui/web` and `npm run build`
- Workflow semantics changes: `npm test`
- Boundary-sensitive changes: `npm run check:boundaries`
- JSON store edits: `node -e "JSON.parse(require('fs').readFileSync('data/cui-store.json','utf8')); console.log('valid json')"`

Do not claim completion without fresh verification evidence or an explicit note explaining why a check could not be run.

