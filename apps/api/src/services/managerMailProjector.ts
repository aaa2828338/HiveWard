import type { ApprovalRequest, ManagerMail } from "@hiveward/shared";
import type { HivewardStore } from "../store/hivewardStore";

export class ManagerMailProjector {
  constructor(private readonly store: HivewardStore) {}

  /**
   * manager_mail is a rebuildable projection for compatibility views. Approval
   * requests remain the source facts; this method replaces the projection scope.
   */
  async rebuild(runId?: string): Promise<ManagerMail[]> {
    const mail = await this.buildProjection(runId);
    await this.store.replaceManagerMail(mail, { runId });
    return mail;
  }

  async refresh(runId?: string): Promise<ManagerMail[]> {
    return this.rebuild(runId);
  }

  async verify(runId?: string): Promise<{ ok: boolean; expected: number; actual: number; mismatches: string[] }> {
    const expected = await this.buildProjection(runId);
    const actual = await this.store.listManagerMail(runId);
    const expectedById = new Map(expected.map((item) => [item.id, this.projectionSignature(item)]));
    const actualById = new Map(actual.map((item) => [item.id, this.projectionSignature(item)]));
    const mismatches: string[] = [];

    for (const [id, signature] of expectedById) {
      const actualSignature = actualById.get(id);
      if (!actualSignature) {
        mismatches.push(`missing:${id}`);
        continue;
      }
      if (actualSignature !== signature) {
        mismatches.push(`drift:${id}`);
      }
    }
    for (const id of actualById.keys()) {
      if (!expectedById.has(id)) mismatches.push(`orphan:${id}`);
    }

    return {
      ok: mismatches.length === 0,
      expected: expected.length,
      actual: actual.length,
      mismatches
    };
  }

  private async buildProjection(runId?: string): Promise<ManagerMail[]> {
    const requests = await this.store.listApprovalRequests({ runId });
    return requests.map((request) => this.fromApprovalRequest(request));
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

  private projectionSignature(mail: ManagerMail): string {
    return JSON.stringify({
      sourceType: mail.sourceType,
      sourceId: mail.sourceId,
      kind: mail.kind,
      status: mail.status,
      title: mail.title,
      body: mail.body,
      capabilities: mail.capabilities,
      relatedRunId: mail.relatedRunId,
      relatedRoundId: mail.relatedRoundId
    });
  }
}
