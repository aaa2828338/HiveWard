# Development Setup

This repository uses npm workspaces and a checked-in `package-lock.json`.

## Required Toolchain

- Node.js: `^20.19.0 || >=22.12.0`
- Known-good local Node.js: `24.13.1` from `.nvmrc`
- npm: `>=11.0.0 <12`

The root `.npmrc` enables `engine-strict=true`, so `npm install` fails early on unsupported Node.js or npm versions.

## First-Time Setup

```bash
npm install
npm run check:env
```

For a clean CI-style install, use:

```bash
npm ci
```

For the full local readiness check, use:

```bash
npm run check
npm test
npm run build
```

## Environment Files

Use `.env.example` as the public template for local configuration:

```bash
cp .env.example .env.local
```

Do not commit `.env`, `.env.*`, tokens, passwords, device identities, or local runtime state.

## Runtime Configuration

Hiveward defaults to `OPENCLAW_ADAPTER=auto`.

- If OpenClaw Gateway configuration is available through `OPENCLAW_GATEWAY_URL` or an OpenClaw config file, Hiveward connects to the real gateway.
- If no gateway configuration is available, local development falls back to mock mode.
- Use `OPENCLAW_ADAPTER=mock` to force mock mode.
- Use `OPENCLAW_ADAPTER=real` or `OPENCLAW_ADAPTER=gateway` to require a real gateway and fail when it is missing.

Common local variables:

- `PORT`: standalone API port, default `8787`
- `VITE_API_BASE_URL`: browser API base URL when serving web and API separately
- `OPENCLAW_CONFIG_FILE` / `OPENCLAW_CONFIG_PATH`: explicit OpenClaw config path
- `OPENCLAW_STATE_DIR`: OpenClaw state directory override
- `OPENCLAW_GATEWAY_URL`: WebSocket gateway URL
- `OPENCLAW_GATEWAY_TOKEN` / `OPENCLAW_GATEWAY_PASSWORD`: gateway credentials
- `CODEX_API_KEY` / `CODEX_HOME`: optional Codex SDK credential sources
- `ANTHROPIC_API_KEY` / `CLAUDE_CODE_OAUTH_TOKEN`: optional Claude SDK credential sources
