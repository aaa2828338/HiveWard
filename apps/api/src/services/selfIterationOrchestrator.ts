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
    const zh = usesChineseText(input.blueprint.name) ||
      input.agentReports.some((report) => usesChineseText(report.nodeLabel) || usesChineseText(report.bodyMd));
    const reports = input.agentReports.length
      ? input.agentReports.map((report) => `### ${report.nodeLabel}\n\n${report.bodyMd}`).join("\n\n")
      : zh ? "\u672c\u8f6e\u6ca1\u6709\u53d1\u5e03 Agent \u62a5\u544a\u3002" : "No agent reports were published for this round.";
    const handoffs = input.agentHandoffs.length
      ? input.agentHandoffs.map((handoff) => `- ${handoff.nodeId}: ${formatHandoffSummary(handoff.payload)}`).join("\n")
      : "";
    const artifactSummary = input.artifacts.length
      ? input.artifacts.map((artifact) => `- ${artifact.title ?? (zh ? "\u4ea7\u7269" : "Artifact")}${formatArtifactLocation(artifact) ? `: ${formatArtifactLocation(artifact)}` : ""}`).join("\n")
      : zh ? "- \u672c\u8f6e\u6ca1\u6709\u53d1\u5e03\u4ea7\u7269\u3002" : "- No artifacts were published.";
    const assumptions = input.assumptions?.length ? input.assumptions.map((item) => `- ${item}`).join("\n") : zh ? "- \u672a\u8bb0\u5f55\u3002" : "- None recorded.";
    const risks = input.risks?.length ? input.risks.map((item) => `- ${item}`).join("\n") : zh ? "- \u672a\u8bb0\u5f55\u3002" : "- None recorded.";
    return (zh ? [
      `${input.blueprint.name} \u672c\u8f6e\u6267\u884c\u5df2\u5b8c\u6210\u3002`,
      input.approvedPlan ? `\u5df2\u6279\u51c6\u8ba1\u5212\uff1a${input.approvedPlan.title} v${input.approvedPlan.revision}\n\n${firstLine(input.approvedPlan.body)}` : undefined,
      input.research?.summary ? `\u8c03\u7814\u6458\u8981\uff1a\n\n${input.research.summary}` : undefined,
      `Agent Markdown \u62a5\u544a\uff1a\n\n${reports}`,
      handoffs ? `JSON \u4ea4\u63a5\u8981\u70b9\uff1a\n${handoffs}` : undefined,
      `\u4ea7\u7269\uff1a\n${artifactSummary}`,
      `\u5047\u8bbe\uff1a\n${assumptions}`,
      `\u98ce\u9669\uff1a\n${risks}`
    ] : [
      `${input.blueprint.name} round execution completed.`,
      input.approvedPlan ? `Approved plan: ${input.approvedPlan.title} v${input.approvedPlan.revision}\n\n${firstLine(input.approvedPlan.body)}` : undefined,
      input.research?.summary ? `Research summary:\n\n${input.research.summary}` : undefined,
      `Agent reports:\n\n${reports}`,
      handoffs ? `Structured handoff highlights:\n${handoffs}` : undefined,
      `Artifacts:\n${artifactSummary}`,
      `Assumptions:\n${assumptions}`,
      `Risks:\n${risks}`
    ])
      .filter(Boolean)
      .join("\n\n");
  }
}

function formatArtifactLocation(artifact: { downloadUrl?: string; relativePath?: string; storagePath?: string; id?: string }): string | undefined {
  return artifact.storagePath ?? artifact.downloadUrl ?? artifact.relativePath ?? artifact.id;
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

function usesChineseText(value: string | undefined): boolean {
  return /[\u3400-\u9fff]/.test(value ?? "");
}
