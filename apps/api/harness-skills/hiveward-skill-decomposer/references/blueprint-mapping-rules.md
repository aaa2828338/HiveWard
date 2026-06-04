# Blueprint Mapping Rules

Map Skill IR to current HiveWard blueprint contracts, not to imagined node types.

## Allowed Nodes

- Use `agent` for concrete work performed by a harness.
- Use `manager` plus `manager_slot` for coordinated multi-phase work, self-dispatch, or self-iteration.
- Use `summary` for aggregation.
- Use `condition` for explicit boolean branching.
- Use `loop` only when the skill has an explicit retry or iteration contract.
- Use `note` and `group` only for canvas documentation or organization.
- Never use removed standalone node types: `approval`, `send`, or `parallel_agents`.
- Never invent nodes such as `http.get`, `file.write`, `parse`, `render`, `fetch`, or `save`; represent that work as `agent` prompts with tools, permissions, validation, and output contracts.

## Runtime Mapping

- Blueprint runtime ids are `codex`, `claude`, `openclaw`, `hermes`, `google`, `cursor`, and `opencode`.
- Prefer harness order Codex, Claude Code, OpenClaw, Hermes, then other CLI harnesses unless the source skill or user specifies otherwise.
- Put `runtimeId` on the node, not inside `config`.
- Use `claude` for Claude Code blueprint nodes; `claudeCode` is a harness/status API id, not a blueprint runtime id.
- For OpenClaw nodes, `config.openclawAgentId` selects the configured OpenClaw Agent and `config.modelId` selects the configured OpenClaw model. Use them only when known or intentionally selected.
- For non-OpenClaw nodes, clear `openclawAgentId` and `send`. For Hermes, use `profileId` when a specific profile is required.
- Prefer import defaults over guessed model ids. Include `modelId` only when the model choice affects correctness or cost.

## Manager And Slots

- Sequential Manager: `lifecycleMode: "none"`, `dispatchMode: "sequential"`.
- Self-dispatch Manager: `lifecycleMode: "none"`, `dispatchMode: "self_dispatch"`, node-level `runtimeId` set to the selected real decision harness.
- Self-iteration Manager: `lifecycleMode: "self_iteration"`, `dispatchMode: "self_dispatch"`, node-level `runtimeId`, and enough slots to support planning, execution, QA, and release reporting.
- `manager_slot` nodes are containers controlled by their Manager. They are not global start nodes.
- Slot children set `parentId` to the slot id.
- Do not connect Manager directly to inner child agents when slots exist.
- Do not connect `manager_slot` nodes to each other as a sequence.
- Manager -> slot: `sourceHandle: "manager-out-N"`, `targetHandle: "manager-slot-in"`, usually `condition: "success"`.
- Slot -> Manager: `sourceHandle: "manager-slot-out"`, `targetHandle: "manager-in-N"`, usually `condition: "success"`.
- Slot -> first child: `sourceHandle: "manager-slot-inner-out"`.
- Last child -> slot: `targetHandle: "manager-slot-inner-in"`.
- `manager_slot.config.parallelLaneCount` expresses rows. Use `1` for ordered child chains and `>1` only for independent parallel rows with deterministic merge behavior.

## Result And Summary

- Set `config.resultRole: "final"` on the intended final product node.
- Set `resultRole: "ignore"` on internal research, planning, QA, or Manager-slot worker nodes that should not become the run final result.
- Leave `resultRole` omitted or `auto` for ordinary terminal outputs.
- Use `summary.config.mode: "structured_merge"` when deterministic merge is enough.
- Use `harness_summary` only when a runtime summary agent is needed; then include `config.runtimeId`, optional `modelId`, optional Hermes `profileId`, and runtime access policy.
- Use `crossRoundContextMode` only for self-iteration or long-lived workers that need previous round context.

## Portable Proposal Shape

- Formal proposals are ordinary assistant text plus the complete blueprint package proposal when approval is requested.
- `blueprintPackage.schema` must be `hiveward.blueprint-package/v1`.
- Each blueprint must include `id`, `name`, `version`, `nodes`, `edges`, `variables`, and `display.viewport`.
- Edges use `source` and `target`, not `from` and `to`.
