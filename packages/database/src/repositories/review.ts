import { and, desc, eq, inArray, sql } from "drizzle-orm";

import type { ReviewAction } from "@trendsfast/schemas";
import { redactRecord, redactSecrets } from "@trendsfast/core";

import type { TrendsFastDatabase } from "../client";
import {
  evidenceReceipts,
  nextMoves,
  projects,
  reviewEvents,
  scanRequests,
  scanRuns,
  sourceRuns,
  deliveryTokens,
} from "../schema";

type AppendReviewEventInput = {
  scanRequestId: string;
  scanRunId?: string;
  nextMoveId?: string;
  action: ReviewAction;
  reviewerId: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  note?: string;
};

export class ReviewRepository {
  constructor(private readonly db: TrendsFastDatabase) {}

  async listQueue(
    input: {
      states?: Array<"QUEUED" | "RUNNING" | "REVIEW_REQUIRED" | "READY" | "FAILED">;
      limit?: number;
      offset?: number;
    } = {},
  ) {
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
    const filters = input.states?.length ? inArray(scanRequests.state, input.states) : undefined;
    const rows = await this.db
      .select({ request: scanRequests, projectName: projects.name })
      .from(scanRequests)
      .leftJoin(projects, eq(scanRequests.projectId, projects.id))
      .where(filters)
      .orderBy(desc(scanRequests.submittedAt))
      .limit(limit)
      .offset(Math.max(input.offset ?? 0, 0));

    return Promise.all(
      rows.map(async ({ request, projectName }) => {
        const [run] = await this.db
          .select()
          .from(scanRuns)
          .where(eq(scanRuns.scanRequestId, request.id))
          .orderBy(desc(scanRuns.attempt))
          .limit(1);
        const [move] = await this.db
          .select({
            id: nextMoves.id,
            publicId: nextMoves.publicId,
            state: nextMoves.state,
            action: nextMoves.action,
            signalClass: nextMoves.signalClass,
            founderReviewed: nextMoves.founderReviewed,
          })
          .from(nextMoves)
          .where(eq(nextMoves.scanRequestId, request.id))
          .orderBy(desc(nextMoves.createdAt))
          .limit(1);
        const [providerFailure] = run
          ? await this.db
              .select({
                source: sourceRuns.source,
                provider: sourceRuns.provider,
                state: sourceRuns.state,
                failureCode: sourceRuns.failureCode,
              })
              .from(sourceRuns)
              .where(
                and(
                  eq(sourceRuns.scanRunId, run.id),
                  inArray(sourceRuns.state, ["FAILED", "DEGRADED"]),
                ),
              )
              .limit(1)
          : [];
        const [delivery] = move
          ? await this.db
              .select({ status: deliveryTokens.status })
              .from(deliveryTokens)
              .where(eq(deliveryTokens.nextMoveId, move.id))
              .orderBy(desc(deliveryTokens.createdAt))
              .limit(1)
          : [];

        return {
          request,
          inferredProduct: projectName,
          run: run ?? null,
          nextMove: move ?? null,
          providerFailure: providerFailure ?? null,
          deliveryState: delivery?.status ?? null,
        };
      }),
    );
  }

  async appendEvent(input: AppendReviewEventInput) {
    const [event] = await this.db
      .insert(reviewEvents)
      .values({
        scanRequestId: input.scanRequestId,
        scanRunId: input.scanRunId ?? null,
        nextMoveId: input.nextMoveId ?? null,
        action: input.action,
        reviewerId: input.reviewerId,
        before: input.before ? redactRecord(input.before) : null,
        after: input.after ? redactRecord(input.after) : null,
        note: input.note ? redactSecrets(input.note).slice(0, 4_000) : null,
      })
      .returning();
    if (!event) throw new Error("Could not append review event");
    return event;
  }

  async approve(input: {
    nextMoveId: string;
    reviewerId: string;
    edited?: boolean;
    note?: string;
  }) {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM next_moves WHERE id = ${input.nextMoveId} FOR UPDATE`);
      const [move] = await tx
        .select()
        .from(nextMoves)
        .where(eq(nextMoves.id, input.nextMoveId))
        .limit(1);
      if (!move) throw new Error("Next Move was not found");
      if (move.state !== "DRAFT" && move.state !== "APPROVED") {
        throw new Error(`Next Move cannot be approved from ${move.state}`);
      }
      if (move.action !== "WAIT") {
        const [evidence] = await tx
          .select({ id: evidenceReceipts.id })
          .from(evidenceReceipts)
          .where(
            and(
              eq(evidenceReceipts.nextMoveId, move.id),
              eq(evidenceReceipts.bindingRole, "DECISION_SUPPORT"),
              eq(evidenceReceipts.availability, "AVAILABLE"),
              eq(evidenceReceipts.verified, true),
            ),
          )
          .limit(1);
        if (!evidence) {
          throw new Error("A non-WAIT move requires verified stored evidence");
        }
      }

      const now = new Date();
      const [approved] = await tx
        .update(nextMoves)
        .set({
          state: "APPROVED",
          founderReviewed: true,
          approvedAt: now,
          updatedAt: now,
        })
        .where(eq(nextMoves.id, move.id))
        .returning();
      if (!approved) throw new Error("Could not approve Next Move");

      await tx.insert(reviewEvents).values({
        scanRequestId: move.scanRequestId,
        scanRunId: move.scanRunId,
        nextMoveId: move.id,
        action: input.edited ? "EDITED_AND_APPROVED" : "APPROVED",
        reviewerId: input.reviewerId,
        before: { state: move.state, founderReviewed: move.founderReviewed },
        after: { state: approved.state, founderReviewed: true },
        note: input.note ? redactSecrets(input.note).slice(0, 4_000) : null,
      });
      return approved;
    });
  }

  async convertToWait(input: {
    nextMoveId: string;
    reviewerId: string;
    reason: string;
    validUntil: Date;
  }) {
    return this.db.transaction(async (tx) => {
      const [move] = await tx
        .select()
        .from(nextMoves)
        .where(eq(nextMoves.id, input.nextMoveId))
        .limit(1);
      if (!move) throw new Error("Next Move was not found");
      const now = new Date();
      const [updated] = await tx
        .update(nextMoves)
        .set({
          action: "WAIT",
          channel: "none",
          topic: "No move passes the quality floor",
          angle: input.reason,
          format: "none",
          hook: "Wait for stronger evidence.",
          outline: [input.reason],
          cta: "Run another scan when the evidence window changes.",
          whyNow: input.reason,
          signalClass: "INSUFFICIENT_SIGNAL",
          independentSourceCount: 0,
          saturation: "unknown",
          limitations: [input.reason],
          validUntil: input.validUntil,
          state: "APPROVED",
          founderReviewed: true,
          approvedAt: now,
          updatedAt: now,
        })
        .where(eq(nextMoves.id, move.id))
        .returning();
      if (!updated) throw new Error("Could not convert Next Move to WAIT");
      await tx.insert(reviewEvents).values({
        scanRequestId: move.scanRequestId,
        scanRunId: move.scanRunId,
        nextMoveId: move.id,
        action: "CONVERTED_TO_WAIT",
        reviewerId: input.reviewerId,
        before: { action: move.action, signalClass: move.signalClass },
        after: { action: "WAIT", signalClass: "INSUFFICIENT_SIGNAL" },
        note: redactSecrets(input.reason).slice(0, 4_000),
      });
      return updated;
    });
  }

  async rejectEvidence(input: { evidenceReceiptId: string; reviewerId: string; reason: string }) {
    return this.db.transaction(async (tx) => {
      const [receipt] = await tx
        .select()
        .from(evidenceReceipts)
        .where(eq(evidenceReceipts.id, input.evidenceReceiptId))
        .limit(1);
      if (!receipt) throw new Error("Evidence receipt was not found");
      const [move] = await tx
        .select()
        .from(nextMoves)
        .where(eq(nextMoves.id, receipt.nextMoveId))
        .limit(1);
      if (!move) throw new Error("Next Move was not found");
      const [updated] = await tx
        .update(evidenceReceipts)
        .set({ availability: "REJECTED", verified: false, verifiedAt: null })
        .where(eq(evidenceReceipts.id, receipt.id))
        .returning();
      await tx.insert(reviewEvents).values({
        scanRequestId: move.scanRequestId,
        scanRunId: move.scanRunId,
        nextMoveId: move.id,
        action: "EVIDENCE_REJECTED",
        reviewerId: input.reviewerId,
        before: { evidenceReceiptId: receipt.id, availability: receipt.availability },
        after: { evidenceReceiptId: receipt.id, availability: "REJECTED" },
        note: redactSecrets(input.reason).slice(0, 4_000),
      });
      return updated;
    });
  }

  async markFailed(input: {
    scanRequestId: string;
    scanRunId: string;
    reviewerId: string;
    failureCode: string;
    failureMessage: string;
  }) {
    return this.db.transaction(async (tx) => {
      const now = new Date();
      const [request] = await tx
        .update(scanRequests)
        .set({
          state: "FAILED",
          failureCode: input.failureCode,
          failureMessage: redactSecrets(input.failureMessage).slice(0, 500),
          completedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(scanRequests.id, input.scanRequestId),
            inArray(scanRequests.state, ["QUEUED", "RUNNING", "REVIEW_REQUIRED"]),
          ),
        )
        .returning({ id: scanRequests.id });
      if (!request) throw new Error("A delivered or missing scan cannot be marked failed");
      const [run] = await tx
        .update(scanRuns)
        .set({
          state: "FAILED",
          failureCode: input.failureCode,
          failureMessage: redactSecrets(input.failureMessage).slice(0, 500),
          completedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(scanRuns.id, input.scanRunId),
            inArray(scanRuns.state, ["QUEUED", "RUNNING", "REVIEW_REQUIRED"]),
          ),
        )
        .returning({ id: scanRuns.id });
      if (!run) throw new Error("A delivered or missing scan run cannot be marked failed");
      const [event] = await tx
        .insert(reviewEvents)
        .values({
          scanRequestId: input.scanRequestId,
          scanRunId: input.scanRunId,
          action: "MARKED_FAILED",
          reviewerId: input.reviewerId,
          note: redactSecrets(input.failureMessage).slice(0, 4_000),
        })
        .returning();
      return event;
    });
  }
}
