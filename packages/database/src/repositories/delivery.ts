import { and, eq, inArray, sql } from "drizzle-orm";

import { createDeliveryToken, parseDeliveryToken, verifyOpaqueToken } from "@trendsfast/core";

import type { TrendsFastDatabase } from "../client";
import {
  analyticsEvents,
  deliveryTokens,
  evidenceReceipts,
  founderUsageEvents,
  monitoringRuns,
  nextMoves,
  projectContextVersions,
  projects,
  reviewEvents,
  scanRequests,
  scanRuns,
} from "../schema";
import { durableAnalyticsDedupeKey } from "./analytics";
import { admitFounderUsage } from "./founder-usage";
import { requireDecisionEvidenceQuality } from "./review-evidence";

export class FounderDeliveryAdmissionError extends Error {
  constructor(readonly reason: "ENTITLEMENT_INACTIVE" | "DELIVERY_DAILY_LIMIT") {
    super(
      reason === "DELIVERY_DAILY_LIMIT"
        ? "The Founder plan daily delivery limit has been reached"
        : "The Founder entitlement is not active",
    );
    this.name = "FounderDeliveryAdmissionError";
  }
}

export type DeliveryIssueResult =
  | {
      created: true;
      rawToken: string;
      tokenPrefix: string;
      expiresAt: Date;
    }
  | {
      created: false;
      rawToken: null;
      tokenPrefix: string;
      expiresAt: Date;
    };

export class DeliveryRepository {
  constructor(private readonly db: TrendsFastDatabase) {}

  async deliver(input: {
    nextMoveId: string;
    reviewerId: string;
    expiresAt: Date;
  }): Promise<DeliveryIssueResult> {
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
      if (
        move.action !== "WAIT" &&
        move.independentSourceCount !== evidenceQuality.independentSourceCount
      ) {
        throw new Error("The reviewed move no longer matches its exact evidence source count");
      }

      const [existing] = await tx
        .select()
        .from(deliveryTokens)
        .where(
          and(
            eq(deliveryTokens.nextMoveId, move.id),
            inArray(deliveryTokens.status, ["ACTIVE", "DELIVERED"]),
          ),
        )
        .limit(1);
      if (existing) {
        if (
          !move.founderReviewed ||
          move.autoPublish ||
          move.state !== "READY" ||
          locked.requestState !== "READY" ||
          locked.runState !== "READY"
        ) {
          throw new Error("The existing delivery is not in a consistent READY state");
        }
        await tx
          .insert(analyticsEvents)
          .values({
            name: "scan_delivered",
            scanRequestId: move.scanRequestId,
            nextMoveId: move.id,
            dedupeKey: durableAnalyticsDedupeKey("scan_delivered", "move", move.id),
            properties: { created: true },
            occurredAt: existing.deliveredAt ?? existing.createdAt,
          })
          .onConflictDoNothing();
        return {
          created: false,
          rawToken: null,
          tokenPrefix: existing.tokenPrefix,
          expiresAt: existing.expiresAt,
        };
      }
      if (
        !move.founderReviewed ||
        move.autoPublish ||
        move.state !== "APPROVED" ||
        locked.requestState !== "REVIEW_REQUIRED" ||
        locked.runState !== "REVIEW_REQUIRED"
      ) {
        throw new Error("Only a founder-reviewed move in review can be delivered");
      }

      const now = new Date();
      if (input.expiresAt <= now) throw new Error("Delivery expiry must be future-dated");
      const [paidAcceptance] = await tx
        .select({ projectId: founderUsageEvents.projectId })
        .from(founderUsageEvents)
        .where(
          and(
            eq(founderUsageEvents.scanRequestId, move.scanRequestId),
            inArray(founderUsageEvents.kind, ["SCHEDULED_RUN_ACCEPTED", "ON_DEMAND_RUN_ACCEPTED"]),
          ),
        )
        .limit(1);
      if (paidAcceptance) {
        const admission = await admitFounderUsage(tx as unknown as TrendsFastDatabase, {
          projectId: paidAcceptance.projectId,
          scanRequestId: move.scanRequestId,
          kind: "NEXT_MOVE_DELIVERED",
          idempotencyKey: `delivery:${move.id}`,
          occurredAt: now,
        });
        if (admission.status === "LIMITED") {
          throw new FounderDeliveryAdmissionError(
            admission.reason === "DELIVERY_DAILY_LIMIT"
              ? "DELIVERY_DAILY_LIMIT"
              : "ENTITLEMENT_INACTIVE",
          );
        }
      }
      const issued = createDeliveryToken();
      await tx.insert(deliveryTokens).values({
        nextMoveId: move.id,
        tokenPrefix: issued.tokenPrefix,
        tokenHash: issued.tokenHash,
        status: "DELIVERED",
        expiresAt: input.expiresAt,
        deliveredAt: now,
      });
      const [readyMove] = await tx
        .update(nextMoves)
        .set({ state: "READY", deliveredAt: now, updatedAt: now })
        .where(and(eq(nextMoves.id, move.id), eq(nextMoves.state, "APPROVED")))
        .returning({ id: nextMoves.id });
      const [readyRequest] = await tx
        .update(scanRequests)
        .set({ state: "READY", completedAt: now, updatedAt: now })
        .where(
          and(eq(scanRequests.id, move.scanRequestId), eq(scanRequests.state, "REVIEW_REQUIRED")),
        )
        .returning({ id: scanRequests.id });
      const [readyRun] = await tx
        .update(scanRuns)
        .set({ state: "READY", completedAt: now, updatedAt: now })
        .where(and(eq(scanRuns.id, move.scanRunId), eq(scanRuns.state, "REVIEW_REQUIRED")))
        .returning({ id: scanRuns.id });
      if (!readyMove || !readyRequest || !readyRun) {
        throw new Error("The reviewed scan changed before delivery could commit");
      }
      await tx
        .update(monitoringRuns)
        .set({ state: "COMPLETED", completedAt: now, updatedAt: now })
        .where(
          and(
            eq(monitoringRuns.scanRequestId, move.scanRequestId),
            eq(monitoringRuns.state, "REVIEW_REQUIRED"),
          ),
        );
      await tx.insert(reviewEvents).values({
        scanRequestId: move.scanRequestId,
        scanRunId: move.scanRunId,
        nextMoveId: move.id,
        action: "DELIVERED",
        reviewerId: input.reviewerId,
        before: { state: move.state },
        after: { state: "READY" },
      });
      await tx
        .insert(analyticsEvents)
        .values({
          name: "scan_delivered",
          scanRequestId: move.scanRequestId,
          nextMoveId: move.id,
          dedupeKey: durableAnalyticsDedupeKey("scan_delivered", "move", move.id),
          properties: { created: true },
          occurredAt: now,
        })
        .onConflictDoNothing();

      return {
        created: true,
        rawToken: issued.rawToken,
        tokenPrefix: issued.tokenPrefix,
        expiresAt: input.expiresAt,
      };
    });
  }

  async resolve(rawToken: string, markViewed = true) {
    const parsed = parseDeliveryToken(rawToken);
    if (!parsed) return null;
    const [token] = await this.db
      .select()
      .from(deliveryTokens)
      .where(eq(deliveryTokens.tokenPrefix, parsed.tokenPrefix))
      .limit(1);
    if (
      !token ||
      !verifyOpaqueToken(rawToken, token.tokenHash) ||
      token.status === "REVOKED" ||
      token.status === "EXPIRED" ||
      token.expiresAt <= new Date()
    ) {
      return null;
    }
    if (markViewed) {
      const now = new Date();
      await this.db
        .update(deliveryTokens)
        .set({ firstViewedAt: token.firstViewedAt ?? now, lastViewedAt: now })
        .where(eq(deliveryTokens.id, token.id));
    }
    return token;
  }

  async getResultByToken(rawToken: string, markViewed = true) {
    const token = await this.resolve(rawToken, markViewed);
    if (!token) return null;
    const [result] = await this.db
      .select({
        move: nextMoves,
        context: projectContextVersions.context,
        project: projects,
      })
      .from(nextMoves)
      .innerJoin(
        projectContextVersions,
        eq(nextMoves.projectContextVersionId, projectContextVersions.id),
      )
      .innerJoin(projects, eq(projectContextVersions.projectId, projects.id))
      .where(eq(nextMoves.id, token.nextMoveId))
      .limit(1);
    if (!result || result.move.state !== "READY") return null;
    const evidence = await this.db
      .select()
      .from(evidenceReceipts)
      .where(eq(evidenceReceipts.nextMoveId, result.move.id));
    return { token, ...result, evidence };
  }

  async setPublicShareConsent(tokenId: string, consent: boolean) {
    const [updated] = await this.db
      .update(deliveryTokens)
      .set({ publicShareConsent: consent })
      .where(eq(deliveryTokens.id, tokenId))
      .returning();
    return updated ?? null;
  }

  async revoke(tokenId: string) {
    const [updated] = await this.db
      .update(deliveryTokens)
      .set({ status: "REVOKED", revokedAt: new Date() })
      .where(eq(deliveryTokens.id, tokenId))
      .returning();
    return updated ?? null;
  }
}
