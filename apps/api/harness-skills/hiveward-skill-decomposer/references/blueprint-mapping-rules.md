# Blueprint Mapping Rules

Map Skill IR to existing HiveWard node types. Use `agent` for concrete work, `manager` and `manager_slot` for coordinated multi-phase work, `summary` for aggregation, `condition` for explicit branching, and `note` or `group` for non-executable explanation.

Use `loop` only when the skill has an explicit retry or iteration contract.
