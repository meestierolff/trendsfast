import { describe, expect, it, vi } from "vitest";

import { FeedbackRepository } from "../src/repositories/feedback";

function database() {
  const conflict = vi.fn<(...args: unknown[]) => { returning: () => Promise<unknown[]> }>(() => ({
    returning: vi.fn(async () => []),
  }));
  const feedbackRow = {
    id: "feedback_1",
    nextMoveId: "move_1",
    deliveryTokenId: null,
    kind: "WOULD_USE",
    freeText: null,
    visitorFingerprintHash: null,
    metadata: null,
    createdAt: new Date(),
  };
  conflict.mockReturnValueOnce({ returning: vi.fn(async () => [feedbackRow]) });
  const insert = vi.fn(() => ({
    values: vi.fn(() => ({
      onConflictDoNothing: conflict,
    })),
  }));
  const db = {
    transaction: vi.fn(async (operation: (tx: unknown) => Promise<unknown>) =>
      operation({ insert }),
    ),
  };
  return { db, conflict };
}

describe("feedback conflict call shape", () => {
  it("omits the Drizzle conflict config for feedback without a delivery token", async () => {
    const { db, conflict } = database();
    await new FeedbackRepository(db as never).record({
      nextMoveId: "move_1",
      kind: "WOULD_USE",
    });

    expect(conflict.mock.calls[0]).toEqual([]);
  });

  it("passes a concrete delivery-token target when one is present", async () => {
    const { db, conflict } = database();
    await new FeedbackRepository(db as never).record({
      nextMoveId: "move_1",
      deliveryTokenId: "delivery_1",
      kind: "WOULD_USE",
    });

    expect(conflict.mock.calls[0]?.[0]).toMatchObject({ target: expect.anything() });
  });
});
