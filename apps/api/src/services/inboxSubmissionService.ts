import type {
  ApprovalRequest,
  CreateBlueprintProposalRequest,
  CreateLeaderDelegationRequest,
  InboxItem
} from "@hiveward/shared";
import type { HivewardStore } from "../store/hivewardStore";
import type { ApprovalService } from "./lifecycleApprovalService";
import type { ManagerMailProjector } from "./managerMailProjector";

export type InboxSubmissionApprovalKind = "leader_delegation" | "blueprint_proposal";

export interface InboxSubmissionResult {
  item: InboxItem;
  approvalRequest?: ApprovalRequest;
}

export class InboxSubmissionService {
  constructor(
    private readonly store: HivewardStore,
    private readonly approvalService: ApprovalService,
    private readonly managerMailProjector: ManagerMailProjector
  ) {}

  async submitLeaderDelegation(input: CreateLeaderDelegationRequest): Promise<InboxSubmissionResult> {
    const item = await this.store.createLeaderDelegationRequest(input);
    return {
      item,
      approvalRequest: await this.ensureApprovalRequest(item, "leader_delegation")
    };
  }

  async submitBlueprintProposal(input: CreateBlueprintProposalRequest): Promise<InboxSubmissionResult> {
    const item = await this.store.createBlueprintProposal(input);
    return {
      item,
      approvalRequest: await this.ensureApprovalRequest(item, "blueprint_proposal")
    };
  }

  async ensureApprovalRequest(
    item: InboxItem,
    kind: InboxSubmissionApprovalKind | undefined = inboxSubmissionApprovalKindForItem(item)
  ): Promise<ApprovalRequest | undefined> {
    if (!kind) return undefined;

    const existing = await this.findPendingApprovalRequest(item.id);
    if (existing) return existing;
    if (item.status !== "pending") return undefined;

    const approvalRequest = await this.approvalService.createRequest({
      kind,
      title: item.title,
      body: item.summary,
      payloadRef: item.id,
      sourceRef: { type: "inbox_item", id: item.id },
      requestedBy: {
        type: "role",
        label: item.createdByRoleId,
        roleId: item.createdByRoleId
      }
    });
    await this.managerMailProjector.refresh();
    return approvalRequest;
  }

  async findPendingApprovalRequest(itemId: string): Promise<ApprovalRequest | undefined> {
    const requests = await this.store.listApprovalRequests({ status: "pending" });
    return requests.find((request) => request.sourceRef?.type === "inbox_item" && request.sourceRef.id === itemId);
  }
}

export function inboxSubmissionApprovalKindForItem(item: InboxItem): InboxSubmissionApprovalKind | undefined {
  if (item.type === "leader_delegation" || item.type === "blueprint_proposal") return item.type;
  return undefined;
}
