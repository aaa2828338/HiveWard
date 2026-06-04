---
name: hiveward-skill-decomposer
description: Use when turning a skill package, standalone Markdown skill, SKILL.md, skill folder, or script-backed skill into a HiveWard blueprint proposal.
---

# HiveWard Skill Decomposer

## Purpose

Use this skill to turn supplied skill material into a governed HiveWard blueprint proposal. A skill can be a full package, a standalone Markdown skill, pasted Markdown, a local path, a URL, or repository material that resolves to one of those forms.

The decomposer does not install arbitrary user skills as global HiveWard skills. It analyzes the material, builds Skill IR first, maps that IR into a blueprint proposal, and submits only through HiveWard inbox approval when the user explicitly asks.

## Required Flow

1. Locate or receive the skill source.
2. Classify source completeness as `full_package`, `markdown_only`, `partial_package`, or `unknown`.
3. Inventory the package root when one exists.
4. Read the primary Markdown entry point.
5. Inspect supporting folders when available.
6. Build Skill IR.
7. Validate Skill IR.
8. Map Skill IR to a blueprint proposal.
9. Validate the proposal against the current HiveWard blueprint and inbox contracts.
10. Explain unresolved assumptions.
11. Submit to inbox only when the user asks for formal approval.

## Core Rules

- Treat a skill as a package, not only `SKILL.md`.
- If a user identifies one Markdown file as the whole skill, set source completeness to `markdown_only` and do not invent missing folders.
- If only `SKILL.md` content is available for a package-like skill, set source completeness to `partial_package` and mark sibling inventory unresolved.
- Do not execute scripts by default. Inspect scripts statically as controlled assets.
- Build Skill IR before blueprint nodes. The IR is the contract.
- Prefer a smaller correct blueprint over a large speculative one.
- Split only on real work boundaries: independent inputs/outputs, distinct tools or permissions, meaningful validation, safe parallelism, retry/failure branches, script side effects, or decision points.
- Record phase difficulty, model class, desired thinking effort, and parallelism hints in Skill IR.
- Do not claim per-node thinking effort is enforced until HiveWard runtime schema supports it.
- Preserve HiveWard platform boundaries: deterministic routing, lifecycle, persistence, permissions, and artifact publication belong to HiveWard; model judgment and content belong in prompts, role contracts, schemas, and examples.
- Do not claim a blueprint changed until inbox approval/import confirms it.

## Blueprint Mapping

Use current HiveWard node types: `agent`, `manager`, `manager_slot`, `condition`, `summary`, `note`, `group`, and `loop`.

- Role skills default to notes/groups plus an operating brief unless the user asks for an executable workflow.
- Simple process skills should stay small.
- Multi-phase or script-backed skills can use a manager with slots and a final summary.
- Scripts remain files or path references; they do not become a new node type.
- Script-aware agents must state script path, working directory, command template, inputs, outputs, permissions, validation, approval needs, and side effects.
- Runtime ids for blueprint nodes are `codex`, `claude`, `openclaw`, `hermes`, `google`, `cursor`, and `opencode`. Prefer the operator priority order Codex, Claude Code, OpenClaw, Hermes, then other CLI harnesses unless the source skill or user requires a specific harness.
- Use node-level `runtimeId`; never place `runtimeId` inside `config`. Use `claude` for Claude Code blueprint nodes and `claudeCode` only when discussing harness/status APIs.
- For OpenClaw `agent` and runnable `manager` nodes, include `config.openclawAgentId` only when the target Agent is known or intentionally selected, and include `config.modelId` only when the OpenClaw model choice is intentional. Non-OpenClaw nodes must not carry `openclawAgentId` or OpenClaw `send` config. Hermes nodes may use `profileId`.
- Manager modes are explicit field pairs: sequential is `lifecycleMode: "none"` plus `dispatchMode: "sequential"`, self-dispatch is `lifecycleMode: "none"` plus `dispatchMode: "self_dispatch"`, and self-iteration is `lifecycleMode: "self_iteration"` plus `dispatchMode: "self_dispatch"`.
- Manager slots are containers, not ordinary chain nodes. Child nodes inside a slot must set `parentId` to the slot id. Do not connect manager slots to each other as a sequence.
- Standard Manager/slot handles are `manager-out-N` -> `manager-slot-in`, `manager-slot-out` -> `manager-in-N`, `manager-slot-inner-out` from slot to first child, and `manager-slot-inner-in` from last child back to slot.
- Use `resultRole: "final"` for the intended deliverable, `resultRole: "ignore"` for internal Manager-slot workers, and omitted/`auto` for normal terminal outputs.
- Use `summary.config.mode: "structured_merge"` for deterministic aggregation and `harness_summary` only when a runtime summary agent is genuinely needed.
- A formal proposal must be returned as ordinary assistant text plus a complete blueprint package proposal; its `blueprintPackage.schema` must be `hiveward.blueprint-package/v1`.

## References

Load only the reference files needed for the current decomposition:

- `references/skill-package-model.md`
- `references/decomposition-rules.md`
- `references/blueprint-mapping-rules.md`
- `references/script-handling-rules.md`
- `references/execution-planning-rules.md`
- `references/skill-ir-schema.md`
