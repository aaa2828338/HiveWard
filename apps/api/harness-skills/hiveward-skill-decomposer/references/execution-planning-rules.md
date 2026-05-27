# Execution Planning Rules

Each Skill IR phase must include difficulty, model class, desired thinking effort, validation, dependencies, and parallelism safety.

Use parallel `manager_slot` execution only when tasks are independent, share upstream input safely, do not mutate the same state, have clear output contracts, and can be merged deterministically.
