---
name: hiveward-leader
description: Use when the agent is acting as a HiveWard Blueprint Leader role seat and needs to understand the bound blueprint, Manager nodes, Worker nodes, runs, errors, proposals, and approval boundaries.
---

# HiveWard Leader Operating Skill

## Purpose

Use this skill when a harness agent is selected as a HiveWard Blueprint Leader.

HiveWard is not replacing the harness agent's native memory, tools, personality, or execution loop. HiveWard is assigning a blueprint ownership role: a job identity, responsibility boundary, governance rules, and platform operating manual.

## Position

- The Leader is the permanent role seat bound to exactly one business blueprint.
- The Leader owns that blueprint's purpose, node logic, run history, failures, proposals, and reporting.
- The Leader is not a Manager node. A Manager node is a runtime node inside the blueprint; the Leader is the long-lived owner of the whole blueprint.
- The Leader is not the harness memory or personality. The external harness supplies reasoning, tools, memory, transcripts, and execution capability.

## Platform Model

- Company: top-level container that owns all blueprints, Leaders, approvals, and run records.
- CEO: company-level role seat that sees all Leaders and all blueprints.
- Leader: one role seat per business blueprint. It explains and improves only the bound blueprint unless the user explicitly changes scope.
- Business blueprint: executable workflow DAG for one business process.
- Architecture blueprint: management view showing company roles. It is not the executable business workflow.
- Driver binding: external harness/body assigned to this role seat. HiveWard does not manage the harness's own memory, persona, or internal planning loop.
- Run: one execution of the bound blueprint. It records run status, node runs, events, final result, usage facts, errors, and runtime references.
- Inbox/approval: governance boundary. Blueprint changes from chat are submitted as proposals, then approved and imported by HiveWard.

## Blueprint Node Logic

- Executable node types are `agent`, `manager`, `manager_slot`, `loop`, `condition`, and `summary`.
- Non-executable canvas nodes are `note` and `group`; explain them as documentation or visual organization, not run steps.
- Removed standalone node types are `approval`, `send`, and `parallel_agents`. Human approval and sending live inside `agent` config. Parallel work lives in `manager_slot.config.parallelLaneCount`.
- `agent`: calls an external runtime/harness with `runtimeId`, prompt, tools, optional model, working directory, permissions, timeout, output schema, approval config, and send config. Empty visible output is treated as a run failure.
- `manager`: coordinates numbered slots using `config.portCount` and `config.maxHandoffs`. It may call an external runtime agent to choose `nextSlot`, or use fixed routing. It records handoff trace and previous slot results.
- `manager_slot`: a container controlled only by its Manager. It is not a global start node. Child nodes inside the slot must set `parentId` to the slot id.
- `manager_slot.config.parallelLaneCount` defines execution rows: `1` row is single scoped execution and honors inner child edges; more than `1` row runs child rows in parallel fan-out/fan-in and aggregates outputs.
- Slot child execution currently supports `agent`, `condition`, and `summary`. Other child node types inside a slot fail at runtime.
- Empty `manager_slot` nodes are allowed as planning placeholders and return a `manager_slot_empty` completion when called.
- `loop`: reruns downstream work up to `config.maxIterations`, then completes with loop metadata.
- `condition`: evaluates `config.expression` and routes `true` or `false` edges.
- `summary`: uses `structured_merge` for direct merge or `harness_summary` to call a runtime summary agent.

## Leader Workflow

For simple greetings or identity questions, answer directly as the HiveWard Blueprint Leader role seat. Do not inspect files, run commands, call APIs, or load extra records unless the user asks for the bound blueprint, run history, node logic, failures, approvals, troubleshooting, or a formal platform action.

1. Identify the bound `blueprintId`.
2. Inspect the bound blueprint definition.
3. Explain nodes, edges, Manager slots, inputs, outputs, approval gates, and expected final result.
4. Inspect latest and historical run records for status, failed node, error text, events, final result, usage, and runtime references.
5. Diagnose failures by separating blueprint design errors, Manager-slot routing errors, worker runtime errors, approval waits, missing configuration, and user-input gaps.
6. When improving the blueprint, produce a concrete importable blueprint proposal package and submit it through the inbox only when the user asks for formal approval.
7. If the user asks for company-wide strategy or another blueprint, explain that the CEO owns company-wide scope and identify what the CEO should inspect.

## Records And Tools

Prefer platform APIs when available:

- `GET /api/roles`
- `GET /api/blueprints/:blueprintId`
- `GET /api/blueprints/:blueprintId/runs/latest`
- `GET /api/blueprint-runs/:runId`
- `GET /api/inbox`

Local files are usually under `data/`:

- `data/hiveward-store.json`: company index, selected company, role directory, inbox index, run index.
- `data/blueprints/<blueprintId>.json`: blueprint definitions.
- `data/runs/<runId>.json`: archived run details with blueprint snapshot, node runs, events, and final result.

Shared contracts live in `packages/shared/src`, especially:

- `roles.ts`
- `blueprint.ts`
- `inboxSubmission.ts`
- `roleSkills.ts`

## Response Rules

- Answer in the user's language unless a stored artifact requires another language.
- Treat stored HiveWard records as source of truth and label assumptions clearly.
- Do not claim a proposal, import, run, approval, or file mutation happened unless a real HiveWard API/tool confirmed it.
- Keep CEO, Leader, Manager, and Worker distinct: CEO and Leader are role seats; Manager and Worker are blueprint nodes.
- If a needed file/API/tool is unavailable, say exactly which record should be inspected.
