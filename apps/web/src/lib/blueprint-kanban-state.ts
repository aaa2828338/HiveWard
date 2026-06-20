import type {
  BlueprintKanbanBoard,
  BlueprintKanbanCard,
  BlueprintKanbanCardLane,
  HumanActionRequestResponseIntent,
  HumanActionRequestSourceContextType
} from "@hiveward/shared";

export type BlueprintKanbanSourceFilter = "all" | HumanActionRequestSourceContextType;
export type BlueprintKanbanIntentFilter = "all" | HumanActionRequestResponseIntent;

export interface BlueprintKanbanFilters {
  sourceContextType: BlueprintKanbanSourceFilter;
  responseIntent: BlueprintKanbanIntentFilter;
}

export const blueprintKanbanLaneOrder: BlueprintKanbanCardLane[] = ["running", "waiting_user", "completed", "failed"];

export function emptyBlueprintKanbanBoard(updatedAt = new Date(0).toISOString()): BlueprintKanbanBoard {
  return {
    lanes: {
      running: [],
      waiting_user: [],
      completed: [],
      failed: []
    },
    cards: [],
    updatedAt
  };
}

export function groupBlueprintKanbanCards(
  board: BlueprintKanbanBoard,
  filters: BlueprintKanbanFilters
): Record<BlueprintKanbanCardLane, BlueprintKanbanCard[]> {
  const lanes = emptyBlueprintKanbanBoard(board.updatedAt).lanes;
  for (const card of board.cards) {
    if (!matchesFilters(card, filters)) continue;
    lanes[card.lane].push(card);
  }
  return lanes;
}

export function blueprintKanbanCardIsNavigationOnly(card: BlueprintKanbanCard): boolean {
  return card.targetRef.type === "run_room" ||
    card.targetRef.type === "human_action_queue_item" ||
    card.targetRef.type === "blueprint";
}

function matchesFilters(card: BlueprintKanbanCard, filters: BlueprintKanbanFilters): boolean {
  return (filters.sourceContextType === "all" || card.sourceContextType === filters.sourceContextType) &&
    (filters.responseIntent === "all" || card.responseIntent === filters.responseIntent);
}
