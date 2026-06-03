import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { BlueprintDefinition, CompanyOverview, CompanyRoleDirectory, HarnessStatus, OpenClawConfigState } from "@hiveward/shared";
import { ChatPage } from "./ChatPage";

const now = "2026-06-03T00:00:00.000Z";

const blueprint: BlueprintDefinition = {
  id: "blueprint-growth",
  companyId: "company-1",
  name: "Growth Blueprint",
  description: "Grow qualified pipeline.",
  version: 1,
  nodes: [],
  edges: [],
  variables: {},
  display: {},
  createdAt: now,
  updatedAt: now
};

const company: CompanyOverview = {
  id: "company-1",
  name: "Acme",
  businessGoal: "Grow revenue",
  logoLabel: "A",
  createdAt: now,
  updatedAt: now,
  blueprintCount: 1,
  runCount: 0,
  totalTokens: 0,
  totalCostUsd: 0,
  dashboardWidgetCount: 0,
  savedViewCount: 0,
  noteCount: 0,
  activeApprovalCount: 0
};

const roleDirectory: CompanyRoleDirectory = {
  companyId: "company-1",
  ceo: {
    id: "ceo",
    companyId: "company-1",
    kind: "ceo",
    label: "CEO Executive",
    capabilities: ["read_company", "read_blueprint", "discuss"],
    createdAt: now,
    updatedAt: now
  },
  leaders: [
    {
      id: "leader-growth",
      companyId: "company-1",
      kind: "leader",
      label: "Growth Leader",
      blueprintId: blueprint.id,
      capabilities: ["read_company", "read_blueprint", "discuss"],
      createdAt: now,
      updatedAt: now
    }
  ],
  driverBindings: [],
  updatedAt: now
};

const harnessStatuses: HarnessStatus[] = [
  {
    id: "openclaw",
    label: "OpenClaw",
    defaultModelId: "model-1",
    models: [{ id: "model-1", label: "Model 1", provider: "local" }],
    installed: true,
    environmentOk: true,
    connectionState: "connected",
    summary: "connected",
    checkedAt: now,
    checks: []
  }
];

const openClawConfig: OpenClawConfigState = {
  configPath: "test",
  defaultWorkspace: "D:\\HiveWard-run-room-stack-pr1",
  defaultModelId: "model-1",
  configuredModels: [{ id: "model-1", label: "Model 1", provider: "local" }],
  configuredAgents: [],
  configuredChannels: []
};

function renderChatPage(): string {
  return renderToStaticMarkup(
    <ChatPage
      openClawConfig={openClawConfig}
      harnessStatuses={harnessStatuses}
      company={company}
      selectedCompanyId={company.id}
      blueprints={[blueprint]}
      roleDirectory={roleDirectory}
      language="en"
    />
  );
}

describe("ChatPage executive surface", () => {
  it("renders CEO executive context without direct Worker selection or scheduling actions", () => {
    const html = renderChatPage();

    expect(html).toContain("Chat");
    expect(html).toContain("CEO Executive / Acme");
    expect(html).toContain("Role");
    expect(html).toContain("CEO Executive");
    expect(html).not.toContain("Worker");
    expect(html).not.toContain("Dispatch worker");
    expect(html).not.toContain("Schedule worker");
    expect(html).not.toContain("Create WorkerTask");
  });
});
