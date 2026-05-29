import type {
  AgentHandoff,
  AgentHumanReport,
  ApprovalDecision,
  ApprovalRequest,
  Artifact,
  BlueprintDefinition,
  BlueprintNode,
  BlueprintNodeEvent,
  BlueprintNodeRun,
  BlueprintRun,
  IterationRound,
  IterationSession,
  ManagerContextSnapshot,
  PortableBlueprintPackage,
  ReleaseReport,
  RunTimelineItem
} from "@hiveward/shared";
import { createBlankBlueprint, portableBlueprintPackageSchema, resolveApprovalCapabilities } from "@hiveward/shared";

export const contractNow = "2026-05-29T00:00:00.000Z";

export function createContractBlueprint(companyId = "company-hiveward-studio"): BlueprintDefinition {
  return {
    ...createBlankBlueprint({
      id: "contract-blueprint",
      companyId,
      now: contractNow,
      name: "Contract Blueprint",
      description: "Exercises the HivewardStore runtime contract."
    }),
    nodes: [createAgentNode("contract-agent", "Contract Agent")],
    edges: []
  };
}

export function createAgentNode(id: string, label: string): BlueprintNode {
  return {
    id,
    type: "agent",
    runtimeId: "openclaw",
    position: { x: 0, y: 0 },
    config: {
      label,
      openclawAgentId: "main",
      agentName: "contract-agent",
      prompt: "Return a contract result.",
      resultRole: "final",
      tools: []
    }
  };
}

export function createContractNodeRun(run: BlueprintRun, output: unknown, status: BlueprintNodeRun["status"] = "succeeded"): BlueprintNodeRun {
  return {
    id: "node-run-contract-agent",
    blueprintRunId: run.id,
    blueprintId: run.blueprintId,
    nodeId: "contract-agent",
    nodeLabel: "Contract Agent",
    nodeType: "agent",
    status,
    queuedAt: contractNow,
    startedAt: contractNow,
    ...(status === "succeeded" ? { endedAt: contractNow, output } : {}),
    ...(status === "running" ? { input: { upstream: [] } } : {})
  };
}

export function createContractEvent(runId: string, nodeRunId: string, index: number): BlueprintNodeEvent {
  return {
    id: `event-contract-${index}`,
    blueprintRunId: runId,
    nodeRunId,
    type: index === 1 ? "node.run.started" : "node.run.completed",
    message: `Contract event ${index}.`,
    createdAt: new Date(Date.parse(contractNow) + index * 1000).toISOString()
  };
}

export function createContractApproval(runId: string, nodeRunId: string, status: ApprovalRequest["status"] = "pending"): ApprovalRequest {
  return {
    id: "approval-contract",
    runId,
    nodeRunId,
    kind: "agent_proposal",
    status,
    title: "Review contract output",
    body: "Approve the contract output.",
    revision: 1,
    capabilities: resolveApprovalCapabilities("agent_proposal", status),
    requestedBy: {
      type: "node",
      label: "Contract Agent",
      nodeId: "contract-agent"
    },
    requestedAt: contractNow,
    updatedAt: contractNow
  };
}

export function createContractDecision(approvalRequestId: string): ApprovalDecision {
  return {
    id: "approval-decision-contract",
    approvalRequestId,
    action: "reply",
    actor: "user",
    comment: "Please tighten the report.",
    resultingStatus: "replied",
    createdAt: contractNow
  };
}

export function createContractIteration(runId: string): {
  session: IterationSession;
  round: IterationRound;
} {
  return {
    session: {
      id: "iteration-session-contract",
      runId,
      topManagerNodeId: "contract-manager",
      blueprintSnapshotId: "contract-blueprint:v1",
      status: "running",
      maxRounds: 2,
      currentRoundId: "iteration-round-contract",
      createdAt: contractNow
    },
    round: {
      id: "iteration-round-contract",
      sessionId: "iteration-session-contract",
      runId,
      roundNumber: 1,
      status: "executing",
      artifactIds: ["artifact-contract"],
      startedAt: contractNow
    }
  };
}

export function createContractArtifact(runId: string, nodeRunId: string, roundId?: string): Artifact {
  return {
    id: "artifact-contract",
    runId,
    roundId,
    nodeRunId,
    slot: "deliverable",
    title: "Contract Markdown",
    kind: "markdown",
    format: "text/markdown",
    storagePath: "data/artifacts/runs/contract.md",
    relativePath: "runs/contract.md",
    downloadUrl: "/artifacts/runs/contract.md",
    previewPolicy: "source",
    trusted: true,
    status: "current",
    bytes: 12,
    sha256: "a".repeat(64),
    createdAt: contractNow
  };
}

export function createContractReleaseReport(runId: string, roundId: string, approvalRequestId: string): ReleaseReport {
  return {
    id: "release-report-contract",
    runId,
    roundId,
    approvalRequestId,
    version: 1,
    title: "Contract release report",
    summary: "The contract output is ready.",
    artifactRefs: [{
      artifactId: "artifact-contract",
      title: "Contract Markdown",
      location: "/artifacts/runs/contract.md",
      current: true
    }],
    createdAt: contractNow
  };
}

export function createContractHumanReport(runId: string, nodeRunId: string, roundId?: string): AgentHumanReport {
  return {
    id: "agent-human-report-contract",
    runId,
    roundId,
    nodeRunId,
    nodeId: "contract-agent",
    nodeLabel: "Contract Agent",
    title: "Contract Agent report",
    bodyMd: "## Contract Report\n\nDone.",
    source: "agent",
    createdAt: contractNow
  };
}

export function createContractHandoff(runId: string, nodeRunId: string, roundId?: string): AgentHandoff {
  return {
    id: "agent-handoff-contract",
    runId,
    roundId,
    nodeRunId,
    nodeId: "contract-agent",
    payload: { next: "manager", facts: ["contract complete"] },
    createdAt: contractNow
  };
}

export function createContractManagerContext(runId: string, sessionId: string, roundId: string): ManagerContextSnapshot {
  return {
    id: "manager-context-contract",
    runId,
    sessionId,
    roundId,
    version: 1,
    completedItems: ["Contract output completed."],
    rejectedOptions: [],
    keyDecisions: ["Keep the contract shape stable."],
    validatedFacts: ["SQLite can rebuild the run view."],
    openQuestions: [],
    activeRisks: [],
    assumptions: [],
    artifactRefs: [{ artifactId: "artifact-contract", title: "Contract Markdown", current: true }],
    recommendedNextStep: "complete",
    summary: "Contract snapshot.",
    createdAt: contractNow
  };
}

export function createContractTimelineItem(runId: string): Omit<RunTimelineItem, "sequence"> {
  return {
    id: "timeline-contract",
    runId,
    createdAt: contractNow,
    actorLabel: "Contract Agent",
    kind: "node_output",
    title: "Contract output",
    body: "Contract output published.",
    payloadRef: "node-run-contract-agent"
  };
}

export function createContractPortablePackage(now = contractNow): PortableBlueprintPackage {
  const blueprint = createBlankBlueprint({
    id: "portable-contract-blueprint",
    now,
    name: "Portable Contract Blueprint",
    description: "Imported from an inbox proposal."
  });
  return {
    schema: portableBlueprintPackageSchema,
    exportedAt: now,
    blueprints: [blueprint]
  };
}
