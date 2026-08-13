import { eq } from "drizzle-orm";

import { FeedbackKindSchema, PublicHttpUrlSchema, type FeedbackKind } from "@trendsfast/schemas";
import { redactSecrets } from "@trendsfast/core";

import type { TrendsFastDatabase } from "../client";
import { analyticsEvents, feedbackEvents, outcomes } from "../schema";
import { durableAnalyticsDedupeKey, sanitizeAnalyticsProperties } from "./analytics";

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
      const values = {
        nextMoveId: input.nextMoveId,
        deliveryTokenId: input.deliveryTokenId ?? null,
        kind,
        freeText: input.freeText ? redactSecrets(input.freeText).slice(0, 2_000) : null,
        visitorFingerprintHash: input.visitorFingerprintHash ?? null,
        metadata: input.metadata ? sanitizeAnalyticsProperties(input.metadata) : null,
      };
      const insert = tx.insert(feedbackEvents).values(values);
      const returning = {
        id: feedbackEvents.id,
        nextMoveId: feedbackEvents.nextMoveId,
        deliveryTokenId: feedbackEvents.deliveryTokenId,
        kind: feedbackEvents.kind,
        createdAt: feedbackEvents.createdAt,
      };
      const inserted = input.deliveryTokenId
        ? await insert
            .onConflictDoNothing({ target: feedbackEvents.deliveryTokenId })
            .returning(returning)
        : await insert.onConflictDoNothing().returning(returning);
      let event = inserted[0];
      const created = event !== undefined;
      if (!event && input.deliveryTokenId) {
        [event] = await tx
          .select(returning)
          .from(feedbackEvents)
          .where(eq(feedbackEvents.deliveryTokenId, input.deliveryTokenId))
          .limit(1);
      }
      if (!event || event.nextMoveId !== input.nextMoveId) {
        throw new Error("Could not record feedback");
      }

      if (created && kind === "USED_OR_PUBLISHED") {
        await tx.insert(outcomes).values({
          nextMoveId: input.nextMoveId,
          kind: "USED",
          verified: false,
        });
      }
      const analyticsNames = [
        "feedback_submitted",
        ...(event.kind === "WOULD_USE"
          ? (["move_would_use"] as const)
          : event.kind === "USED_OR_PUBLISHED"
            ? (["move_used"] as const)
            : event.kind === "REQUEST_ANOTHER_SCAN"
              ? (["repeat_scan_requested"] as const)
              : []),
      ] as const;
      await tx
        .insert(analyticsEvents)
        .values(
          analyticsNames.map((name) => ({
            name,
            nextMoveId: event.nextMoveId,
            dedupeKey: durableAnalyticsDedupeKey(name, "feedback", event.id),
            properties: { kind: event.kind },
            occurredAt: event.createdAt,
          })),
        )
        .onConflictDoNothing();
      return { event, created };
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
