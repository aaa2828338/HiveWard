import type { AgentPermissionProfile, ApprovalRequest, BlueprintNodeRun, RuntimeAccessPolicy } from "@hiveward/shared";
import {
  normalizeRuntimeAccessPolicy,
  resolveApprovalCapabilities,
  runtimeAccessPolicyToPermissionProfile
} from "@hiveward/shared";
import type { HivewardStore } from "../store/hivewardStore";
import {
  ApprovalService,
  buildApprovalDiscussionBindingForRequest,
  type ApprovalDiscussionBindingDraft
} from "./lifecycleApprovalService";
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
    private readonly store: HivewardStore,
    private readonly approvalService: ApprovalService
  ) {}

  async migratePendingNodeApproval(input: {
    runId: string;
    nodeRun: BlueprintNodeRun;
    requestedByLabel: string;
    threadId?: string;
    replacesRequestId?: string;
    revision?: number;
    discussionBinding?: ApprovalDiscussionBindingDraft;
  }): Promise<ApprovalRequest | undefined> {
    if (input.nodeRun.status !== "waiting_approval") return undefined;
    const pendingRequests = await this.store.listApprovalRequests({ runId: input.runId, status: "pending" });
    const existing = pendingRequests.find((request) =>
      request.nodeRunId === input.nodeRun.id &&
      (!input.replacesRequestId || request.id !== input.replacesRequestId) &&
      (!input.replacesRequestId || request.replacesRequestId === input.replacesRequestId)
    );
    const body = approvalRequestBodyFromNodeOutput(input.nodeRun.output);
    if (existing) {
      const updated: ApprovalRequest = {
        ...existing,
        body,
        sourceRef: { type: "node_run", id: input.nodeRun.id },
        threadId: input.threadId ?? existing.threadId,
        replacesRequestId: input.replacesRequestId ?? existing.replacesRequestId,
        revision: input.revision ?? existing.revision,
        capabilities: resolveApprovalCapabilities("agent_proposal", "pending"),
        updatedAt: new Date().toISOString()
      };
      await this.store.upsertApprovalRequest(updated);
      if (input.discussionBinding) {
        await upsertApprovalDiscussionBinding(this.store, buildApprovalDiscussionBindingForRequest(
          updated,
          input.discussionBinding,
          updated.updatedAt ?? new Date().toISOString()
        ));
      }
      return updated;
    }
    return this.approvalService.createRequest({
      runId: input.runId,
      nodeRunId: input.nodeRun.id,
      kind: "agent_proposal",
      title: `${input.nodeRun.nodeLabel} approval`,
      body,
      sourceRef: { type: "node_run", id: input.nodeRun.id },
      threadId: input.threadId,
      replacesRequestId: input.replacesRequestId,
      closeReplacedRequest: false,
      revision: input.revision,
      discussionBinding: input.discussionBinding,
      requestedBy: {
        type: "node",
        label: input.requestedByLabel,
        nodeId: input.nodeRun.nodeId
      }
    });
  }
}

async function upsertApprovalDiscussionBinding(
  store: HivewardStore,
  binding: ReturnType<typeof buildApprovalDiscussionBindingForRequest>
): Promise<void> {
  const existing = await store.getApprovalDiscussionBinding(binding.approvalRequestId);
  if (existing) {
    await store.updateApprovalDiscussionBinding(binding);
    return;
  }
  await store.createApprovalDiscussionBinding(binding);
}

function approvalRequestBodyFromNodeOutput(value: unknown): string {
  if (isRecord(value) && value.approvalType === "agent" && "reviewOutput" in value) {
    return stringifyHumanBody(value.reviewOutput);
  }
  return stringifyHumanBody(value);
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
