import { portableBlueprintPackageSchema } from "./blueprint";

export const hivewardInboxSubmissionSchema = "hiveward.inbox-submission/v1";

export const hivewardBlueprintNodeTypes = [
  "agent",
  "manager",
  "manager_slot",
  "loop",
  "condition",
  "summary",
  "note",
  "group"
] as const;

export const hivewardBlueprintEdgeConditions = [
  "success",
  "failure",
  "true",
  "false"
] as const;

export const hivewardInboxSubmissionContract = [
  "HIVEWARD_INBOX_SUBMISSION_CONTRACT v1",
  "",
  "When a formal Hiveward approval is requested, the assistant response must end with exactly one fenced block named hiveward-inbox.",
  "The fenced block must contain one strict JSON object and nothing else.",
  "",
  "Fenced block form:",
  "```hiveward-inbox",
  "{ ...one JSON object... }",
  "```",
  "",
  "Top-level required fields:",
  `- schema: \"${hivewardInboxSubmissionSchema}\"`,
  "- type: \"leader_delegation\" or \"blueprint_proposal\"",
  "- title: short approval title",
  "- summary: human-readable approval summary",
  "",
  "Strict JSON rules:",
  "- No comments, markdown, trailing commas, ellipses, unquoted keys, JavaScript expressions, or multiple JSON objects.",
  "- Use double-quoted JSON strings.",
  "- The final character inside the fenced block must close the one top-level JSON object.",
  "",
  "leader_delegation fields:",
  "- leaderId: required",
  "- blueprintId: optional",
  "",
  "blueprint_proposal fields:",
  "- blueprintId: optional target/related blueprint id",
  "- diffSummary: required short summary of what will change",
  "- preview: required JSON object, use {} if no preview",
  "- blueprintPackage: required complete importable blueprint package",
  "",
  `blueprintPackage.schema must be \"${portableBlueprintPackageSchema}\".`,
  "blueprintPackage.blueprints must contain at least one blueprint.",
  "Each blueprint must include: id, name, version number, nodes array, edges array, variables object, display.viewport.",
  "",
  `Allowed node types: ${hivewardBlueprintNodeTypes.join(", ")}.`,
  "Do not use removed standalone node types approval, send, or parallel_agents.",
  "Human approval and sending are Agent config options, not separate nodes.",
  "Do not invent node types such as http.get, transform, html.render, file.write, fetch, parse, render, or save.",
  "Represent external work as agent nodes with clear prompts.",
  "",
  "Agent node required shape:",
  "- id: string",
  "- type: \"agent\"",
  "- runtimeId: \"openclaw\" | \"codex\" | \"claude\" | \"google\" | \"cursor\" | \"opencode\" | \"hermes\"",
  "- position: { \"x\": number, \"y\": number }",
  "- config.label: string",
  "- config.agentName: string",
  "- config.prompt: string",
  "- config.tools: string[]",
  "",
  "Manager and manager_slot nodes are special control structures, not normal worker-chain nodes.",
  "- A manager dispatches work through numbered slots. It must use type \"manager\" with config.portCount and config.maxHandoffs.",
  "- A manager_slot is a container for subordinate nodes. It must use type \"manager_slot\" with config.managerNodeId and config.slot.",
  "- Subordinate nodes inside a slot set parentId to the manager_slot node id.",
  "- A manager_slot may be empty when it is intentionally a planning placeholder or a phase container for later editing.",
  "- When the user asks for a complete runnable business blueprint, prefer adding one or more child agent nodes inside each concrete phase slot.",
  "- Use manager_slot config.parallelLaneCount to express slot rows: 1 row is single execution; more than 1 row executes child rows in parallel.",
  "- For requested phases such as research, collection, evaluation, QA, or report generation, create child nodes with concrete prompts unless the phase is intentionally left as a placeholder.",
  "- Do not connect a manager directly to an inner agent when manager_slot nodes exist.",
  "- Do not connect manager_slot nodes to each other as a sequence.",
  "- Correct external manager-slot edges are manager -> manager_slot and manager_slot -> manager.",
  "- manager -> slot edge handles: sourceHandle \"manager-out-N\", targetHandle \"manager-slot-in\".",
  "- slot -> manager edge handles: sourceHandle \"manager-slot-out\", targetHandle \"manager-in-N\".",
  "- Correct inner slot edges use sourceHandle \"manager-slot-inner-out\" for slot -> first child and targetHandle \"manager-slot-inner-in\" for last child -> slot.",
  "Minimal valid manager-slot pattern:",
  JSON.stringify({
    nodes: [
      {
        id: "html-manager",
        type: "manager",
        position: { x: 0, y: 0 },
        config: { label: "HTML Delivery Manager", portCount: 1, maxHandoffs: 8 }
      },
      {
        id: "research-slot",
        type: "manager_slot",
        position: { x: 360, y: 0 },
        config: { label: "Research Slot", managerNodeId: "html-manager", slot: 1 }
      },
      {
        id: "research-agent",
        type: "agent",
        parentId: "research-slot",
        runtimeId: "openclaw",
        position: { x: 72, y: 132 },
        config: {
          label: "Research Agent",
          agentName: "research-agent",
          prompt: "Research the requested topic and return structured findings.",
          tools: []
        }
      }
    ],
    edges: [
      { id: "manager-to-research-slot", source: "html-manager", sourceHandle: "manager-out-1", target: "research-slot", targetHandle: "manager-slot-in", condition: "success" },
      { id: "research-slot-to-manager", source: "research-slot", sourceHandle: "manager-slot-out", target: "html-manager", targetHandle: "manager-in-1", condition: "success" },
      { id: "research-slot-to-agent", source: "research-slot", sourceHandle: "manager-slot-inner-out", target: "research-agent", condition: "success" },
      { id: "research-agent-to-slot", source: "research-agent", target: "research-slot", targetHandle: "manager-slot-inner-in", condition: "success" }
    ]
  }),
  "",
  "Edge required shape:",
  "- id: string",
  "- source: source node id",
  "- target: target node id",
  `- condition: optional ${hivewardBlueprintEdgeConditions.join(" | ")}`,
  "",
  "Do not use from/to in new outputs. Use source/target.",
  "Do not put runtimeId inside config. runtimeId belongs at node.runtimeId.",
  "When the conversation or user selected Codex or Claude Code as the harness, use runtimeId \"codex\" or \"claude\" for runnable agent and manager nodes unless the user explicitly asks for OpenClaw.",
  "",
  "Canonical blueprint_proposal example:",
  JSON.stringify({
    schema: hivewardInboxSubmissionSchema,
    type: "blueprint_proposal",
    blueprintId: "bound-or-new-blueprint-id",
    title: "Short approval title",
    summary: "What the user will approve.",
    diffSummary: "What will change.",
    preview: {},
    blueprintPackage: {
      schema: portableBlueprintPackageSchema,
      exportedAt: "2026-05-23T00:00:00.000Z",
      blueprints: [
        {
          id: "new-blueprint-id",
          name: "Blueprint name",
          description: "What this blueprint does.",
          version: 1,
          nodes: [
            {
              id: "fetch",
              type: "agent",
              runtimeId: "openclaw",
              position: { x: 0, y: 0 },
              config: {
                label: "Fetch data",
                agentName: "fetch-agent",
                prompt: "Fetch the required data and return structured JSON.",
                tools: []
              }
            }
          ],
          edges: [],
          variables: {},
          display: { viewport: { x: 0, y: 0, zoom: 1 } }
        }
      ]
    }
  }, null, 2)
].join("\n");
