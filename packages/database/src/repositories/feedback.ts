import { eq } from "drizzle-orm";

import { FeedbackKindSchema, PublicHttpUrlSchema, type FeedbackKind } from "@trendsfast/schemas";
import { redactSecrets } from "@trendsfast/core";

import type { TrendsFastDatabase } from "../client";
import { feedbackEvents, outcomes } from "../schema";
import { sanitizeAnalyticsProperties } from "./analytics";

export class FeedbackRepository {
  constructor(private readonly db: TrendsFastDatabase) {}

  async record(input: {
    nextMoveId: string;
    deliveryTokenId?: string;
    kind: FeedbackKind;
    freeText?: string;
    visitorFingerprintHash?: string;
    metadata?: Record<string, unknown>;
  }) {
    const kind = FeedbackKindSchema.parse(input.kind);
    return this.db.transaction(async (tx) => {
      const [event] = await tx
        .insert(feedbackEvents)
        .values({
          nextMoveId: input.nextMoveId,
          deliveryTokenId: input.deliveryTokenId ?? null,
          kind,
          freeText: input.freeText ? redactSecrets(input.freeText).slice(0, 2_000) : null,
          visitorFingerprintHash: input.visitorFingerprintHash ?? null,
          metadata: input.metadata ? sanitizeAnalyticsProperties(input.metadata) : null,
        })
        .returning();
      if (!event) throw new Error("Could not record feedback");

      if (kind === "USED_OR_PUBLISHED") {
        await tx.insert(outcomes).values({
          nextMoveId: input.nextMoveId,
          kind: "USED",
          verified: false,
        });
      }
      return event;
    });
  }

  async listForMove(nextMoveId: string) {
    return this.db.select().from(feedbackEvents).where(eq(feedbackEvents.nextMoveId, nextMoveId));
  }

  async recordOutcome(input: {
    nextMoveId: string;
    kind: typeof outcomes.$inferInsert.kind;
    publicUrl?: string;
    notes?: string;
    verified?: boolean;
  }) {
    const publicUrl = input.publicUrl ? PublicHttpUrlSchema.parse(input.publicUrl) : null;
    const verified = input.verified ?? false;
    const [outcome] = await this.db
      .insert(outcomes)
      .values({
        nextMoveId: input.nextMoveId,
        kind: input.kind,
        publicUrl,
        notes: input.notes ? redactSecrets(input.notes).slice(0, 2_000) : null,
        verified,
        verifiedAt: verified ? new Date() : null,
      })
      .returning();
    if (!outcome) throw new Error("Could not record move outcome");
    return outcome;
  }

  async listOutcomes(nextMoveId: string) {
    return this.db.select().from(outcomes).where(eq(outcomes.nextMoveId, nextMoveId));
  }
}
