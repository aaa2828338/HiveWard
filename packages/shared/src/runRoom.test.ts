import { describe, expect, it } from "vitest";
import {
  assertHumanActionQueueItemDirectWrite,
  assertHumanActionRequest,
  humanActionRequestResponseIntents
} from "./runRoom";

describe("run room human action contracts", () => {
  it("keeps human action response intents to decision or reply only", () => {
    expect(humanActionRequestResponseIntents).toEqual(["decision_required", "reply_required"]);
    expect(humanActionRequestResponseIntents).not.toContain("review_required");
  });

  it("rejects removed review_required human action requests", () => {
    expect(() => assertHumanActionRequest({
      id: "human-action-removed-review",
      sourceContextType: "run_room",
      sourceContextId: "run-room-1",
      responseIntent: "review_required" as never,
      status: "pending",
      title: "Removed review",
      bodyMarkdown: "This old intent must not be accepted.",
      createdAt: "2026-06-12T00:00:00.000Z",
      updatedAt: "2026-06-12T00:00:00.000Z"
    })).toThrow(/decision_required, reply_required/);
  });

  it("keeps the human action queue as a read-only projection", () => {
    expect(() => assertHumanActionQueueItemDirectWrite({ id: "queue-item-1" }))
      .toThrow(/HumanActionQueueItem is a read-only projection/);
  });
});
