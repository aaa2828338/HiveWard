import { describe, expect, it } from "vitest";
import type { AgentHandoff, AgentHumanReport, BlueprintDefinition } from "@hiveward/shared";
import { SelfIterationOrchestrator } from "./selfIterationOrchestrator";

describe("SelfIterationOrchestrator", () => {
  it("builds release summaries from agent reports and structured handoffs instead of raw output summaries", () => {
    const now = "2026-05-28T00:00:00.000Z";
    const blueprint: BlueprintDefinition = {
      id: "blueprint-1",
      companyId: "company-1",
      name: "Self iteration blueprint",
      version: 1,
      nodes: [],
      edges: [],
      variables: {},
      display: { viewport: { x: 0, y: 0, zoom: 1 } },
      createdAt: now,
      updatedAt: now
    };
    const report: AgentHumanReport = {
      id: "report-1",
      runId: "run-1",
      roundId: "round-1",
      nodeRunId: "node-run-1",
      nodeId: "agent-1",
      nodeLabel: "Builder",
      title: "Builder report",
      bodyMd: "## Builder report\n\nReadable report body for the user.",
      source: "agent",
      createdAt: now
    };
    const handoff: AgentHandoff = {
      id: "handoff-1",
      runId: "run-1",
      roundId: "round-1",
      nodeRunId: "node-run-1",
      nodeId: "agent-1",
      payload: { conclusion: "structured handoff conclusion" },
      createdAt: now
    };

    const summary = new SelfIterationOrchestrator().buildReleaseSummary({
      blueprint,
      approvedPlan: {
        title: "Round 1 Execution Plan",
        revision: 2,
        body: "Approved plan body."
      },
      research: {
        status: "agent_generated",
        summary: "Research summary."
      },
      artifacts: [
        {
          title: "HTML artifact",
          downloadUrl: "/artifacts/html-1"
        }
      ],
      agentReports: [report],
      agentHandoffs: [handoff],
      assumptions: ["Assumption from manager context."],
      risks: ["Risk from manager context."]
    });

    expect(summary).toContain("Approved plan: Round 1 Execution Plan v2");
    expect(summary).toContain("Research summary.");
    expect(summary).toContain("Readable report body for the user.");
    expect(summary).toContain("structured handoff conclusion");
    expect(summary).toContain("HTML artifact");
    expect(summary).toContain("Assumption from manager context.");
    expect(summary).toContain("Risk from manager context.");
    expect(summary).not.toContain("Raw output summary");
  });
});
