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
import { requireDecisionEvidenceQuality } from "./review-evidence";

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
      const [identity] = await tx
        .select()
        .from(nextMoves)
        .where(eq(nextMoves.id, input.nextMoveId))
        .limit(1);
      if (!identity) throw new Error("Next Move was not found");
      await tx.execute(
        sql`SELECT id FROM scan_requests WHERE id = ${identity.scanRequestId} FOR UPDATE`,
      );
      await tx.execute(sql`SELECT id FROM scan_runs WHERE id = ${identity.scanRunId} FOR UPDATE`);
      await tx.execute(sql`SELECT id FROM next_moves WHERE id = ${identity.id} FOR UPDATE`);
      const [locked] = await tx
        .select({ move: nextMoves, requestState: scanRequests.state, runState: scanRuns.state })
        .from(nextMoves)
        .innerJoin(scanRequests, eq(scanRequests.id, nextMoves.scanRequestId))
        .innerJoin(scanRuns, eq(scanRuns.id, nextMoves.scanRunId))
        .where(eq(nextMoves.id, identity.id))
        .limit(1);
      if (!locked) throw new Error("Next Move was not found");
      const move = locked.move;
      if (locked.requestState !== "REVIEW_REQUIRED" || locked.runState !== "REVIEW_REQUIRED") {
        throw new Error("Next Move is no longer in founder review");
      }
      if (move.state !== "DRAFT" && move.state !== "APPROVED") {
        throw new Error(`Next Move cannot be approved from ${move.state}`);
      }
      const receipts = await tx
        .select({
          bindingRole: evidenceReceipts.bindingRole,
          availability: evidenceReceipts.availability,
          verified: evidenceReceipts.verified,
          source: evidenceReceipts.source,
          canonicalUrl: evidenceReceipts.canonicalUrl,
        })
        .from(evidenceReceipts)
        .where(eq(evidenceReceipts.nextMoveId, move.id));
      const evidenceQuality = requireDecisionEvidenceQuality({
        action: move.action,
        signalClass: move.signalClass,
        receipts,
      });

      const now = new Date();
      const [approved] = await tx
        .update(nextMoves)
        .set({
          state: "APPROVED",
          founderReviewed: true,
          ...(move.action === "WAIT"
            ? {}
            : { independentSourceCount: evidenceQuality.independentSourceCount }),
          approvedAt: now,
          updatedAt: now,
        })
        .where(and(eq(nextMoves.id, move.id), inArray(nextMoves.state, ["DRAFT", "APPROVED"])))
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
      const [identity] = await tx
        .select()
        .from(nextMoves)
        .where(eq(nextMoves.id, input.nextMoveId))
        .limit(1);
      if (!identity) throw new Error("Next Move was not found");
      await tx.execute(
        sql`SELECT id FROM scan_requests WHERE id = ${identity.scanRequestId} FOR UPDATE`,
      );
      await tx.execute(sql`SELECT id FROM scan_runs WHERE id = ${identity.scanRunId} FOR UPDATE`);
      await tx.execute(sql`SELECT id FROM next_moves WHERE id = ${identity.id} FOR UPDATE`);
      const [locked] = await tx
        .select({ move: nextMoves, requestState: scanRequests.state, runState: scanRuns.state })
        .from(nextMoves)
        .innerJoin(scanRequests, eq(scanRequests.id, nextMoves.scanRequestId))
        .innerJoin(scanRuns, eq(scanRuns.id, nextMoves.scanRunId))
        .where(eq(nextMoves.id, identity.id))
        .limit(1);
      if (!locked) throw new Error("Next Move was not found");
      const move = locked.move;
      if (
        locked.requestState !== "REVIEW_REQUIRED" ||
        locked.runState !== "REVIEW_REQUIRED" ||
        move.state !== "DRAFT"
      ) {
        throw new Error("Only a founder review draft can be converted to WAIT");
      }
      const now = new Date();
      if (Number.isNaN(input.validUntil.getTime()) || input.validUntil <= now) {
        throw new Error("A converted WAIT decision requires a future validity window");
      }
      const reason = redactSecrets(input.reason).slice(0, 4_000);
      if (!reason) throw new Error("A converted WAIT decision requires a reason");
      const [updated] = await tx
        .update(nextMoves)
        .set({
          action: "WAIT",
          channel: "none",
          topic: "No move passes the quality floor",
          angle: reason,
          format: "none",
          hook: "Wait for stronger evidence.",
          outline: [reason],
          cta: "Run another scan when the evidence window changes.",
          whyNow: reason,
          signalClass: "INSUFFICIENT_SIGNAL",
          independentSourceCount: 0,
          saturation: "unknown",
          limitations: [reason],
          validUntil: input.validUntil,
          state: "APPROVED",
          founderReviewed: true,
          approvedAt: now,
          updatedAt: now,
        })
        .where(and(eq(nextMoves.id, move.id), eq(nextMoves.state, "DRAFT")))
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
        note: reason,
      });
      return updated;
    });
  }

  async rejectEvidence(input: { evidenceReceiptId: string; reviewerId: string; reason: string }) {
    return this.db.transaction(async (tx) => {
      const [identity] = await tx
        .select({
          receiptId: evidenceReceipts.id,
          nextMoveId: nextMoves.id,
          scanRequestId: nextMoves.scanRequestId,
          scanRunId: nextMoves.scanRunId,
        })
        .from(evidenceReceipts)
        .innerJoin(nextMoves, eq(nextMoves.id, evidenceReceipts.nextMoveId))
        .where(eq(evidenceReceipts.id, input.evidenceReceiptId))
        .limit(1);
      if (!identity) throw new Error("Evidence receipt was not found");
      await tx.execute(
        sql`SELECT id FROM scan_requests WHERE id = ${identity.scanRequestId} FOR UPDATE`,
      );
      await tx.execute(sql`SELECT id FROM scan_runs WHERE id = ${identity.scanRunId} FOR UPDATE`);
      await tx.execute(sql`SELECT id FROM next_moves WHERE id = ${identity.nextMoveId} FOR UPDATE`);
      await tx.execute(
        sql`SELECT id FROM evidence_receipts WHERE id = ${identity.receiptId} FOR UPDATE`,
      );
      const [locked] = await tx
        .select({
          receipt: evidenceReceipts,
          move: nextMoves,
          requestState: scanRequests.state,
          runState: scanRuns.state,
        })
        .from(evidenceReceipts)
        .innerJoin(nextMoves, eq(nextMoves.id, evidenceReceipts.nextMoveId))
        .innerJoin(scanRequests, eq(scanRequests.id, nextMoves.scanRequestId))
        .innerJoin(scanRuns, eq(scanRuns.id, nextMoves.scanRunId))
        .where(eq(evidenceReceipts.id, identity.receiptId))
        .limit(1);
      if (!locked) throw new Error("Evidence receipt was not found");
      const { receipt, move } = locked;
      if (
        locked.requestState !== "REVIEW_REQUIRED" ||
        locked.runState !== "REVIEW_REQUIRED" ||
        move.state !== "DRAFT"
      ) {
        throw new Error("Evidence can only be rejected from a founder review draft");
      }
      const [updated] = await tx
        .update(evidenceReceipts)
        .set({ availability: "REJECTED", verified: false, verifiedAt: null })
        .where(and(eq(evidenceReceipts.id, receipt.id), eq(evidenceReceipts.nextMoveId, move.id)))
        .returning();
      if (!updated) throw new Error("Could not reject evidence");
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
            eq(scanRuns.scanRequestId, input.scanRequestId),
            inArray(scanRuns.state, ["QUEUED", "RUNNING", "REVIEW_REQUIRED"]),
          ),
        )
        .returning({ id: scanRuns.id });
      if (!run) throw new Error("A delivered or missing scan run cannot be marked failed");
      await tx
        .update(nextMoves)
        .set({ state: "REJECTED", updatedAt: now })
        .where(
          and(
            eq(nextMoves.scanRequestId, input.scanRequestId),
            eq(nextMoves.scanRunId, input.scanRunId),
            inArray(nextMoves.state, ["DRAFT", "APPROVED"]),
          ),
        );
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
