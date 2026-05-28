import type { ApprovalRequest, ManagerMail } from "@hiveward/shared";
import type { FileHivewardStore } from "../store/fileHivewardStore";
export class ManagerMailProjector {
  constructor(private readonly store: FileHivewardStore) {}

  async refresh(runId?: string): Promise<ManagerMail[]> {
    const requests = await this.store.listApprovalRequests({ runId });
    const mail = requests.map((request) => this.fromApprovalRequest(request));
    await this.store.replaceManagerMail(mail);
    return mail;
  }

  fromApprovalRequest(request: ApprovalRequest): ManagerMail {
    return {
      id: `mail-${request.id}`,
      sourceType: "approval_request",
      sourceId: request.id,
      kind: request.kind,
      status: request.status,
      title: request.title,
      body: request.body,
      capabilities: request.capabilities,
      relatedRunId: request.runId,
      relatedRoundId: request.roundId,
      createdAt: request.requestedAt,
      updatedAt: request.updatedAt ?? request.requestedAt
    };
  }
}
