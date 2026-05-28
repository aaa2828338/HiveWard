import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { BlueprintDefinition, BlueprintRunView } from "@hiveward/shared";
import { messages } from "../lib/i18n";
import { RunsPage } from "./WorkspacePages";

describe("RunsPage", () => {
  it("renders the run report board before raw trace details", () => {
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
    const runView: BlueprintRunView = {
      run: {
        id: "run-1",
        companyId: "company-1",
        blueprintId: blueprint.id,
        blueprintName: blueprint.name,
        blueprintVersion: 1,
        status: "waiting_approval",
        startedBy: "user-1",
        startedAt: now,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCostUsd: 0,
        openclawRefs: []
      },
      nodeRuns: [
        {
          id: "node-run-1",
          blueprintRunId: "run-1",
          blueprintId: blueprint.id,
          nodeId: "agent-1",
          nodeLabel: "Reporter",
          nodeType: "agent",
          iterationRoundId: "round-1",
          status: "succeeded",
          queuedAt: now,
          startedAt: now,
          endedAt: now,
          output: "SECRET_RAW_OUTPUT"
        },
        {
          id: "node-run-2",
          blueprintRunId: "run-1",
          blueprintId: blueprint.id,
          nodeId: "agent-2",
          nodeLabel: "Legacy Reporter",
          nodeType: "agent",
          iterationRoundId: "round-1",
          status: "succeeded",
          queuedAt: now,
          startedAt: now,
          endedAt: now,
          output: { summary: "legacy output" }
        }
      ],
      events: [],
      finalResult: null,
      iterationSessions: [],
      iterationRounds: [
        {
          id: "round-1",
          sessionId: "session-1",
          runId: "run-1",
          roundNumber: 1,
          status: "report_pending",
          requirementRequestId: "request-plan-1",
          approvedRequirementRequestId: "request-plan-1",
          approvedRequirementRevision: 1,
          artifactIds: ["artifact-1"],
          researchStatus: "agent_generated",
          researchSummary: "Research facts for the round.",
          planSource: "agent_generated",
          startedAt: now
        }
      ],
      approvalRequests: [
        {
          id: "request-plan-1",
          runId: "run-1",
          roundId: "round-1",
          kind: "iteration_requirement_plan",
          status: "approved",
          title: "Round 1 Execution Plan",
          body: "Approved plan body.",
          revision: 1,
          capabilities: { approve: true, reject: true, reply: true, complete: false, terminate: false },
          requestedBy: { type: "node", label: "Top Manager", nodeId: "manager-1" },
          requestedAt: now
        }
      ],
      approvalDecisions: [],
      artifacts: [
        {
          id: "artifact-1",
          runId: "run-1",
          roundId: "round-1",
          nodeRunId: "node-run-1",
          title: "Readable artifact",
          kind: "markdown",
          downloadUrl: "/artifacts/artifact-1",
          previewPolicy: "source",
          trusted: false,
          createdAt: now
        }
      ],
      releaseReports: [
        {
          id: "release-report-1",
          runId: "run-1",
          roundId: "round-1",
          approvalRequestId: "release-request-1",
          version: 1,
          title: "Round 1 Release Report",
          summary: "Manager summary from reports.",
          artifactRefs: [
            {
              artifactId: "artifact-1",
              title: "Readable artifact",
              location: "/artifacts/artifact-1",
              current: true
            }
          ],
          createdAt: now
        }
      ],
      agentHumanReports: [
        {
          id: "human-report-1",
          runId: "run-1",
          roundId: "round-1",
          nodeRunId: "node-run-1",
          nodeId: "agent-1",
          nodeLabel: "Reporter",
          title: "Reporter report",
          bodyMd: "## Human Report\n\nReadable facts for the user.",
          source: "agent",
          createdAt: now
        },
        {
          id: "human-report-2",
          runId: "run-1",
          roundId: "round-1",
          nodeRunId: "node-run-2",
          nodeId: "agent-2",
          nodeLabel: "Legacy Reporter",
          title: "Legacy Reporter report",
          bodyMd: "legacy output",
          source: "fallback",
          fallbackReason: "Agent output did not include humanReportMd.",
          createdAt: now
        }
      ],
      agentHandoffs: [
        {
          id: "handoff-1",
          runId: "run-1",
          roundId: "round-1",
          nodeRunId: "node-run-1",
          nodeId: "agent-1",
          payload: { decision: "machine-only" },
          createdAt: now
        }
      ],
      managerContextSnapshots: [],
      runTimeline: [],
      managerMail: []
    };

    const html = renderToStaticMarkup(
      <RunsPage
        runs={[runView]}
        blueprints={[blueprint]}
        blueprint={blueprint}
        selectedRunId={runView.run.id}
        language="en"
        t={messages.en}
        onSelectBlueprint={() => undefined}
        onSelectRun={() => undefined}
      />
    );

    expect(html.indexOf("Round Execution Plan")).toBeLessThan(html.indexOf("Agent Markdown reports"));
    expect(html.indexOf("Agent Markdown reports")).toBeLessThan(html.indexOf("Manager Release Report"));
    expect(html.indexOf("Manager Release Report")).toBeLessThan(html.indexOf("Artifacts"));
    expect(html.indexOf("Artifacts")).toBeLessThan(html.indexOf("Run Advanced Details"));
    expect(html).toContain("Approved plan body.");
    expect(html).toContain("Human Report");
    expect(html).toContain("fallback");
    expect(html).toContain("Manager summary from reports.");
    expect(html).toContain("Readable artifact");
    expect(html.indexOf("SECRET_RAW_OUTPUT")).toBeGreaterThan(html.indexOf("Advanced details"));
    expect(html.indexOf("machine-only")).toBeGreaterThan(html.indexOf("Advanced details"));
  });
});
