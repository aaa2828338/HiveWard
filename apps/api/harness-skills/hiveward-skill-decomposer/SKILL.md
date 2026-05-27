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
9. Explain unresolved assumptions.
10. Submit to inbox only when the user asks for formal approval.

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
- Do not claim a blueprint changed until inbox approval/import confirms it.

## Blueprint Mapping

Use current HiveWard node types: `agent`, `manager`, `manager_slot`, `condition`, `summary`, `note`, `group`, and `loop`.

- Role skills default to notes/groups plus an operating brief unless the user asks for an executable workflow.
- Simple process skills should stay small.
- Multi-phase or script-backed skills can use a manager with slots and a final summary.
- Scripts remain files or path references; they do not become a new node type.
- Script-aware agents must state script path, working directory, command template, inputs, outputs, permissions, validation, approval needs, and side effects.

## References

Load only the reference files needed for the current decomposition:

- `references/skill-package-model.md`
- `references/decomposition-rules.md`
- `references/blueprint-mapping-rules.md`
- `references/script-handling-rules.md`
- `references/execution-planning-rules.md`
- `references/skill-ir-schema.md`
