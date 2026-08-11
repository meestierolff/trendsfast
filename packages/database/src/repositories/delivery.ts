import { and, eq, inArray, sql } from "drizzle-orm";

import { createDeliveryToken, parseDeliveryToken, verifyOpaqueToken } from "@trendsfast/core";

import type { TrendsFastDatabase } from "../client";
import {
  deliveryTokens,
  evidenceReceipts,
  nextMoves,
  projectContextVersions,
  projects,
  reviewEvents,
  scanRequests,
  scanRuns,
} from "../schema";

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
      await tx.execute(sql`SELECT id FROM next_moves WHERE id = ${input.nextMoveId} FOR UPDATE`);
      const [move] = await tx
        .select()
        .from(nextMoves)
        .where(eq(nextMoves.id, input.nextMoveId))
        .limit(1);
      if (!move) throw new Error("Next Move was not found");
      if (!move.founderReviewed || (move.state !== "APPROVED" && move.state !== "READY")) {
        throw new Error("Only a founder-reviewed Next Move can be delivered");
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
        return {
          created: false,
          rawToken: null,
          tokenPrefix: existing.tokenPrefix,
          expiresAt: existing.expiresAt,
        };
      }

      const now = new Date();
      if (input.expiresAt <= now) throw new Error("Delivery expiry must be future-dated");
      const issued = createDeliveryToken();
      await tx.insert(deliveryTokens).values({
        nextMoveId: move.id,
        tokenPrefix: issued.tokenPrefix,
        tokenHash: issued.tokenHash,
        status: "DELIVERED",
        expiresAt: input.expiresAt,
        deliveredAt: now,
      });
      await tx
        .update(nextMoves)
        .set({ state: "READY", deliveredAt: now, updatedAt: now })
        .where(eq(nextMoves.id, move.id));
      await tx
        .update(scanRequests)
        .set({ state: "READY", completedAt: now, updatedAt: now })
        .where(eq(scanRequests.id, move.scanRequestId));
      await tx
        .update(scanRuns)
        .set({ state: "READY", completedAt: now, updatedAt: now })
        .where(eq(scanRuns.id, move.scanRunId));
      await tx.insert(reviewEvents).values({
        scanRequestId: move.scanRequestId,
        scanRunId: move.scanRunId,
        nextMoveId: move.id,
        action: "DELIVERED",
        reviewerId: input.reviewerId,
        before: { state: move.state },
        after: { state: "READY" },
      });

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
