# Execution Planning Rules

Each Skill IR phase must include difficulty, model class, desired thinking effort, validation, dependencies, and parallelism safety.

Use parallel `manager_slot` execution only when tasks are independent, share upstream input safely, do not mutate the same state, have clear output contracts, and can be merged deterministically.

## Runtime And Model Planning

- `modelProfile.runtimeId` must be one of `codex`, `claude`, `openclaw`, `hermes`, `google`, `cursor`, or `opencode`.
- Use Codex, Claude Code, OpenClaw, Hermes priority for default planning unless the source skill requires a different runtime.
- Record desired thinking effort in Skill IR, but do not claim HiveWard enforces per-node thinking effort.
- For OpenClaw phases, record `openclawAgentId` and `modelId` only when the source or user identifies them. Otherwise leave them unresolved/defaultable.
- For Hermes phases, record `profileId` only when the profile is required.

## Manager Planning

- Use sequential Manager mode when phases depend on earlier outputs and routing is simple.
- Use self-dispatch when a Manager must choose the next slot dynamically from slot results.
- Use self-iteration when the workflow needs repeated rounds with a Round Execution Plan, QA/revision, or release reporting.
- Self-dispatch and self-iteration Managers are runnable nodes and need a node-level `runtimeId`.
- Mark internal phase agents with `resultRole: "ignore"` when the final output should come from a later build, summary, or delivery node.

## Validation Planning

Every executable blueprint proposal should name the smallest useful validation:

- static review for role/reference skills
- schema or JSON validation for structured-output skills
- command or test for repo/tooling skills
- artifact inspection for generated documents, sites, videos, or files
- human approval boundary when side effects, external publication, credentials, or business governance are involved
