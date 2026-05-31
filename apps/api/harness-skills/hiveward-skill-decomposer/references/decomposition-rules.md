# Decomposition Rules

Classify each skill with one primary type: `role`, `process`, `tooling`, `domain`, `reference`, or `composite`. Add traits such as `script_backed`, `asset_backed`, `multi_phase`, `tool_integrated`, `approval_sensitive`, `safety_sensitive`, `external_io`, and `generates_artifacts`.

Split only on real work boundaries. Do not create nodes for every heading, paragraph, bullet, or minor instruction.

## Phase Boundaries

Create a new phase only when it changes at least one of these:

- required inputs or upstream dependency
- tool or permission boundary
- harness/runtime suitability
- script or external I/O side effect
- human approval boundary
- validation or QA responsibility
- parallelism safety
- final deliverable responsibility

Keep single-reader reference skills small: often one operating `agent`, one optional `summary`, and notes are enough. Use Manager/slot structure only when a skill genuinely has coordinated phases or parallel lanes.

## Harness Selection

- Prefer Codex for repo-local coding, typed implementation, and test-focused workflows.
- Prefer Claude Code when the user or skill requires Claude Code behavior or Anthropic-specific model configuration.
- Prefer OpenClaw when the skill depends on OpenClaw Agents, OpenClaw model routing, OpenClaw channels/send behavior, or OpenClaw-native workspace skills.
- Prefer Hermes when a Hermes profile, alias, channel, or long-lived local profile is the relevant execution surface.
- Use Google CLI, Cursor CLI, or OpenCode only when the skill or user specifically calls for them.

Record the selected runtime in each phase's model profile. If the runtime is uncertain, record the uncertainty in Skill IR instead of guessing a model id.

## Non-Goals

- Do not hard-code model behavior that belongs in a prompt or output contract.
- Do not create platform validation nodes to patch weak model output. Express model output shape in prompts, schemas, examples, and validation instructions.
- Do not add compatibility phases just to normalize ordinary formatting mistakes unless the skill has a real deterministic post-processing requirement.
