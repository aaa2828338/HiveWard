# Script Handling Rules

Scripts are controlled assets. Inspect script paths, runtime, inputs, outputs, permissions, validation commands, and side effects. Do not execute scripts during decomposition unless the user explicitly authorizes execution and the harness permits it.

Do not embed long script source into blueprint JSON. Store or reference script files by path and mark path-dependent proposals clearly.

## Blueprint Representation

- Scripts do not become custom node types.
- Represent a script step as an `agent` node whose prompt names the script path, intended working directory, command template, inputs, outputs, expected artifacts, and validation command.
- Set `permissionProfile` or `runtimeAccessPolicy` to match the side effect boundary. Prefer read-only for inspection and workspace-write only when execution or file generation is required.
- If the script needs human approval before execution, use `config.approval.enabled: true` on the agent.
- If the script produces the final deliverable, set `config.resultRole: "final"`. Otherwise mark internal script inspection or setup phases as `ignore`.
- Do not use OpenClaw `send` unless the runtime is OpenClaw and the skill explicitly requires channel delivery.

## Static Inspection Checklist

- language/runtime and entry command
- required environment variables or credentials
- file reads/writes and output locations
- network or external service use
- destructive operations
- validation command or expected observable result
- portability risks for paths, shells, OS, or package managers
