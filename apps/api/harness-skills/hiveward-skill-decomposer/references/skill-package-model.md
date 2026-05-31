# Skill Package Model

A standard skill package has `SKILL.md` as its required entry point and may also include `references/`, `scripts/`, `assets/`, and `agents/openai.yaml`.

Always inspect `SKILL.md`. Inventory sibling folders before finalizing when a package root is available. For Markdown-only input, do not treat missing package folders as defects.

## Inventory Rules

- `SKILL.md` is always the authority for trigger, scope, and primary workflow.
- `references/` contains detailed guidance that should become phase context or note material only when relevant.
- `scripts/` contains controlled executable assets; inventory paths and side effects without executing by default.
- `assets/` contains output resources or templates; reference them by path and describe portability constraints.
- `agents/openai.yaml` is UI metadata for the skill, not an execution phase by itself.

## Completeness Labels

- `full_package`: package root and sibling folders were inspected.
- `markdown_only`: the provided Markdown is the whole source; do not invent missing siblings.
- `partial_package`: `SKILL.md` or a subset was available, but package inventory is incomplete.
- `unknown`: source cannot be classified yet.

Record missing inventory in Skill IR `unresolved`; do not compensate by adding speculative blueprint nodes.
