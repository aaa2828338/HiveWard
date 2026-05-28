import type {
  AgentHandoff,
  AgentHumanReport,
  ApprovalRequest,
  BlueprintDefinition,
  ManagerNodeConfig
} from "@hiveward/shared";

export class SelfIterationOrchestrator {
  selectNextAutoResolvableRequest(input: {
    requests: ApprovalRequest[];
    topManagerNodeId: string;
    config: ManagerNodeConfig;
  }): ApprovalRequest | undefined {
    return input.requests
      .filter((request) => request.requestedBy.nodeId === input.topManagerNodeId)
      .filter((request) => this.canAutoResolveRequest(request, input.config))
      .sort((left, right) => new Date(left.requestedAt).getTime() - new Date(right.requestedAt).getTime())[0];
  }

  canAutoResolveRequest(request: ApprovalRequest, config: ManagerNodeConfig): boolean {
    if (request.kind === "iteration_requirement_plan") {
      return config.autoApproveRequirements === true && request.capabilities.approve === true;
    }
    if (request.kind === "manager_release_report") {
      return config.autoApproveReleaseReports === true &&
        (request.capabilities.approve === true || request.capabilities.complete === true);
    }
    return false;
  }

  buildReleaseSummary(input: {
    blueprint: BlueprintDefinition;
    approvedPlan?: { title: string; revision: number; body: string };
    research?: { status?: string; summary?: string };
    artifacts: Array<{ title?: string; downloadUrl?: string; relativePath?: string; storagePath?: string; id?: string }>;
    agentReports: AgentHumanReport[];
    agentHandoffs: AgentHandoff[];
    assumptions?: string[];
    risks?: string[];
  }): string {
    const reports = input.agentReports.length
      ? input.agentReports.map((report) => `### ${report.nodeLabel}\n\n${report.bodyMd}`).join("\n\n")
      : "No agent reports were published for this round.";
    const handoffs = input.agentHandoffs.length
      ? input.agentHandoffs.map((handoff) => `- ${handoff.nodeId}: ${formatHandoffSummary(handoff.payload)}`).join("\n")
      : "";
    const artifactSummary = input.artifacts.length
      ? input.artifacts.map((artifact) => `- ${artifact.title ?? "Artifact"}${artifact.downloadUrl ?? artifact.relativePath ?? artifact.storagePath ?? artifact.id ? `: ${artifact.downloadUrl ?? artifact.relativePath ?? artifact.storagePath ?? artifact.id}` : ""}`).join("\n")
      : "- No artifacts were published.";
    const assumptions = input.assumptions?.length ? input.assumptions.map((item) => `- ${item}`).join("\n") : "- None recorded.";
    const risks = input.risks?.length ? input.risks.map((item) => `- ${item}`).join("\n") : "- None recorded.";
    return [
      `${input.blueprint.name} round execution completed.`,
      input.approvedPlan ? `Approved plan: ${input.approvedPlan.title} v${input.approvedPlan.revision}\n\n${firstLine(input.approvedPlan.body)}` : undefined,
      input.research?.summary ? `Research summary:\n\n${input.research.summary}` : undefined,
      `Agent reports:\n\n${reports}`,
      handoffs ? `Structured handoff highlights:\n${handoffs}` : undefined,
      `Artifacts:\n${artifactSummary}`,
      `Assumptions:\n${assumptions}`,
      `Risks:\n${risks}`
    ]
      .filter(Boolean)
      .join("\n\n");
  }
}

function formatHandoffSummary(payload: unknown): string {
  try {
    const serialized = JSON.stringify(payload);
    return serialized.length > 500 ? `${serialized.slice(0, 500)}...` : serialized;
  } catch {
    return String(payload);
  }
}

function firstLine(value: string): string {
  return value.split(/\r?\n/).find((line) => line.trim())?.trim() ?? value.trim();
}
