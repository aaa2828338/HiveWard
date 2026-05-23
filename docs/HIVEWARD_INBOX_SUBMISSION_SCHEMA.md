# Hiveward Inbox Submission Schema

Status: v1 contract

Hiveward chat has no implicit side effects. A model response creates a real approval only when the response ends with one fenced `hiveward-inbox` block containing a strict JSON object.

## Envelope

````text
```hiveward-inbox
{ ...one JSON object... }
```
````

Required top-level fields:

- `schema`: `hiveward.inbox-submission/v1`
- `type`: `leader_delegation` or `blueprint_proposal`
- `title`: short approval title
- `summary`: human-readable approval summary

Strict JSON rules:

- No comments, markdown inside JSON, trailing commas, ellipses, unquoted keys, JavaScript expressions, or multiple JSON objects.
- Use double-quoted JSON strings.
- The final character inside the fenced block must close the one top-level JSON object.

## Blueprint Proposal

Required fields:

- `blueprintId`: optional target or related blueprint id
- `diffSummary`: short summary of what will change
- `preview`: JSON object, use `{}` if no preview
- `blueprintPackage`: complete importable package

`blueprintPackage.schema` must be `hiveward.blueprint-package/v1`.

Allowed blueprint node types:

```text
agent, parallel_agents, manager, manager_slot, loop, condition, summary, approval, send, note, group
```

Do not invent node types such as `http.get`, `transform`, `html.render`, `file.write`, `fetch`, `parse`, `render`, or `save`. Represent those steps as `agent` nodes with clear prompts.

## Manager And Slot Nodes

`manager` and `manager_slot` are not ordinary left-to-right worker nodes. They are a control structure:

- `manager` dispatches work through numbered slots and receives slot results back.
- `manager_slot` is a container, not an executable worker role.
- Inner nodes inside a slot set `parentId` to the `manager_slot` node id.
- Empty `manager_slot` containers are allowed when they are intentional planning placeholders or phase containers for later editing.
- When the user asks for a complete runnable business blueprint, prefer adding one or more child `agent` or `parallel_agents` nodes inside each concrete phase slot.
- For each requested phase such as research, collection, evaluation, QA, or report generation, create concrete child nodes inside that slot with real prompts unless that phase is intentionally left as a placeholder.
- Do not connect `manager` directly to inner agents when slot nodes exist.
- Do not connect slot nodes to each other as a sequence.

Required manager config:

```json
{
  "label": "HTML Delivery Manager",
  "portCount": 2,
  "maxHandoffs": 8,
  "instructions": "Choose the next slot and stop when complete."
}
```

Required slot config:

```json
{
  "label": "Slot 1",
  "managerNodeId": "html-manager",
  "slot": 1
}
```

Canonical external edges:

```json
[
  {
    "id": "manager-to-slot-1",
    "source": "html-manager",
    "sourceHandle": "manager-out-1",
    "target": "slot-1",
    "targetHandle": "manager-slot-in",
    "condition": "success"
  },
  {
    "id": "slot-1-to-manager",
    "source": "slot-1",
    "sourceHandle": "manager-slot-out",
    "target": "html-manager",
    "targetHandle": "manager-in-1",
    "condition": "success"
  }
]
```

Canonical inner slot edges:

```json
[
  {
    "id": "slot-1-to-research",
    "source": "slot-1",
    "sourceHandle": "manager-slot-inner-out",
    "target": "research",
    "condition": "success"
  },
  {
    "id": "research-to-slot-1",
    "source": "research",
    "target": "slot-1",
    "targetHandle": "manager-slot-inner-in",
    "condition": "success"
  }
]
```

Agent nodes must use this shape:

```json
{
  "id": "fetch",
  "type": "agent",
  "runtimeId": "openclaw",
  "position": { "x": 0, "y": 0 },
  "config": {
    "label": "Fetch data",
    "agentName": "fetch-agent",
    "prompt": "Fetch the required data and return structured JSON.",
    "tools": []
  }
}
```

Edges must use `source` and `target`, not `from` and `to`.

```json
{
  "id": "fetch-to-render",
  "source": "fetch",
  "target": "render",
  "condition": "success"
}
```
