import type { AgentPermissionProfile, ApprovalRequest, BlueprintNodeRun, RuntimeAccessPolicy } from "@hiveward/shared";
import {
  normalizeRuntimeAccessPolicy,
  resolveApprovalCapabilities,
  runtimeAccessPolicyToPermissionProfile
} from "@hiveward/shared";
import type { FileHivewardStore } from "../store/fileHivewardStore";
import { ApprovalService } from "./lifecycleApprovalService";
export class RuntimeAccessPolicyService {
  static normalize(value: Partial<RuntimeAccessPolicy> | undefined, legacyPermissionProfile?: AgentPermissionProfile): RuntimeAccessPolicy {
    return normalizeRuntimeAccessPolicy(value, legacyPermissionProfile);
  }

  static toPermissionProfile(policy: RuntimeAccessPolicy): AgentPermissionProfile {
    return runtimeAccessPolicyToPermissionProfile(policy);
  }
}

export class MigrationService {
  constructor(
    private readonly store: FileHivewardStore,
    private readonly approvalService: ApprovalService
  ) {}

  async migratePendingNodeApproval(input: {
    runId: string;
    nodeRun: BlueprintNodeRun;
    requestedByLabel: string;
  }): Promise<ApprovalRequest | undefined> {
    if (input.nodeRun.status !== "waiting_approval") return undefined;
    const existing = (await this.store.listApprovalRequests({ runId: input.runId, status: "pending" }))
      .find((request) => request.nodeRunId === input.nodeRun.id);
    const body = stringifyHumanBody(input.nodeRun.output);
    if (existing) {
      const updated: ApprovalRequest = {
        ...existing,
        body,
        sourceRef: { type: "node_run", id: input.nodeRun.id },
        capabilities: resolveApprovalCapabilities("agent_proposal", "pending"),
        updatedAt: new Date().toISOString()
      };
      await this.store.upsertApprovalRequest(updated);
      return updated;
    }
    return this.approvalService.createRequest({
      runId: input.runId,
      nodeRunId: input.nodeRun.id,
      kind: "agent_proposal",
      title: `${input.nodeRun.nodeLabel} approval`,
      body,
      sourceRef: { type: "node_run", id: input.nodeRun.id },
      requestedBy: {
        type: "node",
        label: input.requestedByLabel,
        nodeId: input.nodeRun.nodeId
      }
    });
  }
}

function stringifyHumanBody(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return String(value ?? "");
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
