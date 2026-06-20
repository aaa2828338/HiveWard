import type { HumanActionResponse, HumanActionQueueItem } from "@hiveward/shared";
import type { HivewardStore } from "../store/hivewardStore";

export class HumanActionQueueService {
  constructor(private readonly store: HivewardStore) {}

  rebuild(filter: Parameters<HivewardStore["listHumanActionQueue"]>[0] = {}): Promise<HumanActionQueueItem[]> {
    return this.store.listHumanActionQueue(filter);
  }

  listResponses(requestId: string): Promise<HumanActionResponse[]> {
    return this.store.listHumanActionResponses({ requestId });
  }
}
