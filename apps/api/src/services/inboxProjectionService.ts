import type { HumanActionResponse, InboxProjection } from "@hiveward/shared";
import type { HivewardStore } from "../store/hivewardStore";

export class InboxProjectionService {
  constructor(private readonly store: HivewardStore) {}

  rebuild(filter: Parameters<HivewardStore["listInboxProjections"]>[0] = {}): Promise<InboxProjection[]> {
    return this.store.listInboxProjections(filter);
  }

  listResponses(requestId: string): Promise<HumanActionResponse[]> {
    return this.store.listHumanActionResponses({ requestId });
  }
}
