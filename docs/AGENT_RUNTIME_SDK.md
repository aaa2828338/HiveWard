# Claude and Codex SDK Runtime Plan

This document defines the single engineering path for Claude and Codex mission execution.

## Formal Path

```text
MissionWorker -> AgentSdkRuntime -> official TypeScript SDK -> normalized node result
```

Supported providers:

- `claude`: `@anthropic-ai/claude-agent-sdk`
- `codex`: `@openai/codex-sdk`

Hiveward owns mission execution:

- Node scheduling
- Upstream input routing
- Task envelope construction
- Workspace validation
- Permission policy
- Timeout and cancellation
- Concurrency policy
- Result persistence
- UI display

The provider SDK owns only the agent loop for the selected node task.

Mission node types:

- `openclaw_agent`: existing OpenClaw execution
- `codex_agent`: Codex SDK execution
- `claude_code_agent`: Claude Code SDK execution

## Verified SDKs

Package metadata checked on 2026-05-19:

- `@anthropic-ai/claude-agent-sdk`: `0.3.144`, Node `>=18.0.0`
- `@openai/codex-sdk`: `0.131.0`, Node `>=18`

Reference docs:

- Claude Agent SDK overview: https://code.claude.com/docs/en/agent-sdk/overview
- OpenAI Codex SDK: https://developers.openai.com/codex/sdk

## Runtime Types

```ts
export type AgentSdkProvider = "claude" | "codex";

export type AgentSdkMissionNodeType = "codex_agent" | "claude_code_agent";

export type AgentPermissionProfile = "read_only" | "workspace_write";

export interface AgentSdkNodeConfig {
  label: string;
  agentName: string;
  prompt: string;
  modelId?: string;
  tools: string[];
  permissionProfile: AgentPermissionProfile;
  workingDirectory: string;
  timeoutMs: number;
  outputSchema?: Record<string, unknown>;
}

export interface StartAgentSdkTaskInput {
  missionRunId: string;
  nodeRunId: string;
  source: AgentSdkProvider;
  agentName: string;
  prompt: string;
  modelId?: string;
  input: unknown;
  tools: string[];
  permissionProfile: AgentPermissionProfile;
  workingDirectory: string;
  timeoutMs: number;
  outputSchema?: Record<string, unknown>;
}

export interface AgentSdkTaskResult {
  taskId: string;
  source: AgentSdkProvider;
  sessionKey: string;
  status: "running" | "succeeded" | "failed" | "cancelled";
  output?: string;
  error?: string;
  usage?: {
    id: string;
    modelId: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    recordedAt: string;
  };
  updatedAt: string;
}
```

## Runtime Interface

```ts
export interface AgentSdkRuntime {
  startTask(input: StartAgentSdkTaskInput): Promise<AgentSdkStartedTask>;
  waitForTask(input: WaitForAgentSdkTaskInput): Promise<AgentSdkTaskResult>;
  cancelTask(input: WaitForAgentSdkTaskInput): Promise<AgentSdkTaskResult>;
}

export interface AgentSdkStartedTask {
  taskId: string;
  source: AgentSdkProvider;
  sessionKey: string;
  status: "running";
  updatedAt: string;
}

export interface WaitForAgentSdkTaskInput {
  taskId: string;
  source: AgentSdkProvider;
  sessionKey: string;
  nodeRunId: string;
}
```

## Runtime Files

```text
packages/adapter/src/sdk-runtime/
  index.ts
  types.ts
  factory.ts
  claude-runtime.ts
  codex-runtime.ts
  permissions.ts
  prompt-envelope.ts
  task-registry.ts
  workspace.ts
  errors.ts
```

Only `packages/adapter` imports SDK packages.

## Runtime Source

Mission nodes select runtime by node type:

```ts
type: "openclaw_agent" | "codex_agent" | "claude_code_agent"
```

Mapping:

- `openclaw_agent`: OpenClaw adapter
- `codex_agent`: Codex SDK runtime
- `claude_code_agent`: Claude Code SDK runtime

`source` is runtime input derived by `MissionWorker`; it is not stored in node config.

## Prompt Envelope

All SDK providers receive the same envelope:

```text
You are executing one Hiveward mission node.

Mission run: <missionRunId>
Node run: <nodeRunId>
Agent name: <agentName>

Task:
<prompt>

Upstream input JSON:
<stable JSON>

Return only the node result.
```

`outputSchema` adds this requirement:

```text
Return JSON that matches the supplied schema.
```

Rules:

- Build the envelope in `packages/adapter/src/sdk-runtime/prompt-envelope.ts`.
- Serialize `input` with stable key ordering.
- Exclude secrets, auth files, environment values, and SDK internals.
- Store only bounded transcript metadata.

## Permission Profiles

### `read_only`

Default for new SDK nodes.

Claude mapping:

- Allow read/search tools.
- Deny edits.
- Deny command execution.

Codex mapping:

- Read-only workspace access.
- Deny file writes.

### `workspace_write`

Used for SDK nodes that intentionally edit workspace files.

Claude mapping:

- Allow read/search tools.
- Allow file edit tools.
- Allow command execution only through a narrow command allowlist.

Codex mapping:

- Workspace-write access.
- Constrain writes to `workingDirectory`.

## Workspace Rules

Every SDK task requires an absolute `workingDirectory`.

Validation:

- Directory exists.
- Directory is under the configured SDK workspace root.
- Mutating tasks run in a dedicated worktree or disposable workspace.
- Writes outside `workingDirectory` fail the task.
- Codex tasks run in a git workspace.

## Claude Runtime

Dependency:

```bash
npm install -w @hiveward/adapter @anthropic-ai/claude-agent-sdk
```

Required behavior:

- Use `@anthropic-ai/claude-agent-sdk`.
- Create one SDK query per node run.
- Apply `permissionProfile`.
- Apply `timeoutMs` through `AbortController`.
- Capture SDK session id as `sessionKey`.
- Capture final response text as `output`.
- Capture SDK usage data.
- Let the Claude SDK own authentication.

Implementation skeleton:

```ts
for await (const message of query({
  prompt: buildPromptEnvelope(input),
  options: {
    cwd: input.workingDirectory,
    model: input.modelId,
    permissionMode: mapClaudePermission(input.permissionProfile),
    allowedTools: mapClaudeTools(input.permissionProfile, input.tools)
  }
})) {
  taskRegistry.record(input.nodeRunId, message);
}
```

## Codex Runtime

Dependency:

```bash
npm install -w @hiveward/adapter @openai/codex-sdk
```

Required behavior:

- Use `@openai/codex-sdk`.
- Create one SDK thread per node run.
- Apply `permissionProfile`.
- Apply `timeoutMs` through `AbortController`.
- Capture SDK thread id as `sessionKey`.
- Capture `finalResponse` as `output`.
- Pass `outputSchema` to the SDK.
- Seal object schemas for OpenAI structured output by setting `additionalProperties: false`.
- Capture SDK usage data.
- Let the Codex SDK own authentication.

Implementation skeleton:

```ts
const codex = new Codex({
  env: buildCodexEnv()
});

const thread = codex.startThread({
  workingDirectory: input.workingDirectory
});

const turn = await thread.run(buildPromptEnvelope(input), {
  outputSchema: input.outputSchema
});
```

## Task Registry

```ts
interface AgentSdkTaskRecord {
  taskId: string;
  provider: AgentSdkProvider;
  nodeRunId: string;
  missionRunId: string;
  sessionKey: string;
  startedAt: string;
  abortController: AbortController;
  final: Promise<AgentSdkTaskResult>;
  transcript: unknown[];
}
```

Rules:

- `startTask()` creates a record and returns `running`.
- `waitForTask()` awaits the record's `final`.
- `cancelTask()` aborts the record and returns `cancelled`.
- Timeout aborts the record and returns `cancelled`.
- Completed records are evicted after result consumption.

## Error Codes

| Code | Meaning |
| --- | --- |
| `workspace_not_allowed` | Invalid working directory. |
| `permission_denied` | Requested action exceeds `permissionProfile`. |
| `timeout` | Task exceeded `timeoutMs`. |
| `cancelled` | Hiveward cancelled the task. |
| `provider_error` | SDK execution error. |
| `invalid_output` | Final output failed schema validation. |

Node run errors store concise messages. Detailed SDK events stay in bounded transcript metadata.

## Configuration

```text
Hiveward_AGENT_SDK_TASK_TIMEOUT_MS=600000
Hiveward_AGENT_SDK_MAX_CONCURRENCY=2
```

Rules:

- SDK authentication is owned by the provider SDK and CLI.
- SDK credentials are never persisted.
- Provider auth file paths are never persisted.

## Concurrency

Limits:

- Global SDK task concurrency: `2`
- Per mission run mutating SDK concurrency: `1`

Rules:

- Mutating tasks against the same workspace are serialized.
- Read-only tasks share the global SDK concurrency limit.
- Parallel SDK nodes use the shared task registry and concurrency limiter.

## UI Contract

Expose:

- Node type: `OpenClaw Agent`, `Codex Agent`, or `Claude Code Agent`
- Model id
- Permission profile
- Working directory
- Timeout
- Output schema

Hide:

- SDK class names
- SDK event names
- Provider auth file paths
- Raw SDK stack traces

## Implementation Sequence

### Phase 1: Contracts

- Add SDK provider types.
- Add SDK node config fields.
- Add SDK runtime input/result types.
- Add runtime source validation.
- Add prompt envelope tests.

Exit criteria:

- Unknown SDK sources fail validation.
- Prompt envelope excludes secrets.
- Scheduler tests pass.

### Phase 2: Runtime Core

- Add `packages/adapter/src/sdk-runtime`.
- Add task registry.
- Add timeout handling.
- Add cancellation handling.
- Add permission mapping.
- Add workspace validation.
- Add fake SDK tests.

Exit criteria:

- Fake SDK task succeeds.
- Fake SDK task times out.
- Fake SDK task cancels.
- Unsafe workspace fails before SDK execution.

### Phase 3: Claude Provider

- Add Claude SDK dependency.
- Implement `claude-runtime.ts`.
- Add mocked SDK query tests.
- Add permission tests.

Exit criteria:

- Claude read-only task returns normalized output.
- Claude workspace-write task respects workspace validation.
- SDK authentication errors return normalized node failures.

### Phase 4: Codex Provider

- Add Codex SDK dependency.
- Implement `codex-runtime.ts`.
- Add mocked SDK thread tests.
- Add output schema tests.

Exit criteria:

- Codex read-only task returns normalized output.
- Codex workspace-write task respects workspace validation.
- SDK authentication errors return normalized node failures.
- Schema mismatch returns `invalid_output`.

### Phase 5: UI Wiring

- Add separate OpenClaw, Codex, and Claude Code palette nodes.
- Add permission profile selector.
- Add working directory input.
- Add timeout input.
- Add output schema editor.
- Show normalized task/session ids in run results.

Exit criteria:

- User configures a Claude Code node.
- User configures a Codex node.
- Run results show normalized status, output, error, usage, and session key.

## Verification

Required commands:

```bash
npm run check
npm test
npm run typecheck -w @hiveward/adapter
npm run typecheck -w @hiveward/api
npm run typecheck -w @hiveward/shared
npm run typecheck -w @hiveward/web
```

Required tests:

- Runtime source validation
- Prompt envelope serialization
- Secret exclusion
- Workspace validation
- Permission mapping
- Task start/wait/cancel
- Timeout
- Claude normalized success
- Claude normalized failure
- Codex normalized success
- Codex normalized failure
- Output schema validation
- Concurrency limiting
- SDK imports restricted to `packages/adapter`

## Acceptance Criteria

- Claude mission nodes execute through `@anthropic-ai/claude-agent-sdk`.
- Codex mission nodes execute through `@openai/codex-sdk`.
- Mission scheduling remains owned by Hiveward.
- Provider code exists only under `packages/adapter`.
- SDK nodes produce normalized node results.
- Timeout, cancellation, invalid workspace, provider error, and invalid output are represented in node runs.
- SDK credentials are not persisted.
- Verification commands pass.
