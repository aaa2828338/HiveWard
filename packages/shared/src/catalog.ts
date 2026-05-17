import type { OpenClawAgent, OpenClawChannel, OpenClawModel, OpenClawTool } from "./openclaw";

export interface CatalogSnapshot {
  id: string;
  source: "openclaw";
  sourceUpdatedAt: string;
  refreshedAt: string;
  staleAfter: string;
  models: OpenClawModel[];
  agents: OpenClawAgent[];
  tools: OpenClawTool[];
  channels: OpenClawChannel[];
}

export function isCatalogStale(snapshot: CatalogSnapshot, now = new Date()): boolean {
  return new Date(snapshot.staleAfter).getTime() <= now.getTime();
}
