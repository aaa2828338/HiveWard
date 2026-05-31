# Skill IR Schema

Skill IR schema is `hiveward.skill-ir/v1`. It must include source, identity, classification, package inventory, operating model, phases, scripts, references, assets, risks, validation, and unresolved items.

Every phase needs purpose, inputs, outputs, validation, difficulty, and model profile. Script assets must always set `shouldExecuteByDefault` to `false`.

## Required Top-Level Shape

- `schema`: `hiveward.skill-ir/v1`
- `source`: source type, path or URL, completeness, and inventory status
- `identity`: name, description, and trigger/use cases
- `classification`: primary type and traits
- `operatingModel`: whether the skill is advisory, executable, script-backed, role-like, or approval-sensitive
- `phases`: ordered phase records
- `scripts`, `references`, `assets`: discovered controlled assets
- `risks`: safety, correctness, portability, and governance risks
- `validation`: checks needed before claiming the blueprint is correct
- `unresolved`: missing inputs or assumptions that must stay visible

## Phase Shape

Each phase should include:

- `id`, `label`, `purpose`
- `inputs` and `outputs`
- `dependencies`
- `runtimeProfile.runtimeId`: `codex`, `claude`, `openclaw`, `hermes`, `google`, `cursor`, or `opencode`
- `runtimeProfile.modelId` only when known or intentionally selected
- `runtimeProfile.openclawAgentId` only for OpenClaw phases that need a specific configured Agent
- `runtimeProfile.profileId` only for Hermes phases that need a specific profile
- `difficulty`, `modelClass`, and desired `thinkingEffort`
- `permissions` and side effects
- `validation`
- `parallelism`: `none`, `safe_parallel`, or `unsafe_parallel`
- `resultRole`: `final`, `ignore`, or `auto`

Do not put `runtimeId` under blueprint node `config` when mapping IR to a blueprint; it belongs on the node.
