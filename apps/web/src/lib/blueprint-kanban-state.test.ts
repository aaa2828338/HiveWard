import { describe, expect, it } from "vitest";
import type { BlueprintKanbanBoard, BlueprintKanbanCard } from "@hiveward/shared";
import {
  blueprintKanbanCardIsNavigationOnly,
  emptyBlueprintKanbanBoard,
  groupBlueprintKanbanCards
} from "./blueprint-kanban-state";

describe("blueprint-kanban-state", () => {
  it("groups cards into PR7 lanes and filters by HumanActionRequest facts", () => {
    const board: BlueprintKanbanBoard = {
      ...emptyBlueprintKanbanBoard("2026-06-04T00:00:00.000Z"),
      cards: [
        createCard({ id: "running", lane: "running", sourceContextType: "run_room" }),
        createCard({
          id: "waiting",
          lane: "waiting_user",
          sourceContextType: "run_room",
          responseIntent: "decision_required"
        }),
        createCard({ id: "completed", lane: "completed", sourceContextType: "executive_chat" })
      ]
    };

    const lanes = groupBlueprintKanbanCards(board, {
      sourceContextType: "run_room",
      responseIntent: "all"
    });

    expect(lanes.running.map((card) => card.id)).toEqual(["running"]);
    expect(lanes.waiting_user.map((card) => card.id)).toEqual(["waiting"]);
    expect(lanes.completed).toEqual([]);
  });

  it("treats cards as navigation-only and does not expose mutation capabilities", () => {
    const waitingCard = createCard({
      id: "waiting",
      lane: "waiting_user",
      humanActionRequestId: "human-action-request-1",
      inboxProjectionId: "inbox-projection-human-action-request-1",
      targetRef: {
        type: "inbox_projection",
        inboxProjectionId: "inbox-projection-human-action-request-1",
        humanActionRequestId: "human-action-request-1"
      }
    }) as BlueprintKanbanCard & {
      approve?: unknown;
      reject?: unknown;
      reply?: unknown;
      dispatch?: unknown;
      mutateState?: unknown;
    };

    expect(blueprintKanbanCardIsNavigationOnly(waitingCard)).toBe(true);
    expect(waitingCard.approve).toBeUndefined();
    expect(waitingCard.reject).toBeUndefined();
    expect(waitingCard.reply).toBeUndefined();
    expect(waitingCard.dispatch).toBeUndefined();
    expect(waitingCard.mutateState).toBeUndefined();
  });
});

function createCard(overrides: Partial<BlueprintKanbanCard> = {}): BlueprintKanbanCard {
  return {
    id: "blueprint-kanban-card",
    runRoomId: "run-room-1",
    companyId: "company-1",
    blueprintId: "blueprint-1",
    runId: "run-1",
    lane: "running",
    title: "Card",
    updatedAt: "2026-06-04T00:00:00.000Z",
    targetRef: {
      type: "run_room",
      runRoomId: "run-room-1",
      runId: "run-1",
      blueprintId: "blueprint-1"
    },
    ...overrides
  };
}
