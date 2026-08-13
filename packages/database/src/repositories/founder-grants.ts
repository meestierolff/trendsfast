import { and, desc, eq, gt, isNull, lte } from "drizzle-orm";

import { redactRecord, redactSecrets } from "@trendsfast/core";

import type { TrendsFastDatabase } from "../client";
import { founderEntitlementGrantEvents, founderEntitlementGrants, projects } from "../schema";
import { lockProjectEntitlementScope } from "./founder-usage";

const MAX_GRANT_MS = 30 * 24 * 60 * 60 * 1_000;

export type FounderEntitlementGrant = typeof founderEntitlementGrants.$inferSelect;

function actorId(value: string): string {
  const normalized = redactSecrets(value).trim().slice(0, 160);
  if (!normalized) throw new Error("Founder grant mutations require an actor");
  return normalized;
}

function snapshot(grant: FounderEntitlementGrant): Record<string, unknown> {
  return redactRecord({
    id: grant.id,
    projectId: grant.projectId,
    entitlementSource: grant.entitlementSource,
    grantReason: grant.grantReason,
    issuedBy: grant.issuedBy,
    createdAt: grant.createdAt.toISOString(),
    expiresAt: grant.expiresAt.toISOString(),
    revokedAt: grant.revokedAt?.toISOString() ?? null,
    revokedBy: grant.revokedBy,
  });
}

export class FounderGrantRepository {
  constructor(private readonly db: TrendsFastDatabase) {}

  async issueDesignPartnerGrant(input: {
    projectId: string;
    issuedBy: string;
    expiresAt: Date;
    now?: Date;
  }): Promise<{ grant: FounderEntitlementGrant; created: boolean }> {
    const now = input.now ?? new Date();
    const issuedBy = actorId(input.issuedBy);
    if (
      Number.isNaN(now.getTime()) ||
      Number.isNaN(input.expiresAt.getTime()) ||
      input.expiresAt <= now ||
      input.expiresAt.getTime() - now.getTime() > MAX_GRANT_MS
    ) {
      throw new Error("Design-partner grants must expire within 30 days");
    }

    return this.db.transaction(async (tx) => {
      await lockProjectEntitlementScope(tx as unknown as TrendsFastDatabase, input.projectId);
      const [project] = await tx
        .select({ id: projects.id, status: projects.status })
        .from(projects)
        .where(eq(projects.id, input.projectId))
        .limit(1)
        .for("update");
      if (!project || project.status !== "ACTIVE") {
        throw new Error("An active project is required for a design-partner grant");
      }

      const [open] = await tx
        .select()
        .from(founderEntitlementGrants)
        .where(
          and(
            eq(founderEntitlementGrants.projectId, input.projectId),
            isNull(founderEntitlementGrants.revokedAt),
          ),
        )
        .orderBy(desc(founderEntitlementGrants.createdAt))
        .limit(1)
        .for("update");
      if (open && open.expiresAt > now) return { grant: open, created: false };
      if (open) {
        const [closed] = await tx
          .update(founderEntitlementGrants)
          .set({ revokedAt: now, revokedBy: issuedBy })
          .where(
            and(
              eq(founderEntitlementGrants.id, open.id),
              isNull(founderEntitlementGrants.revokedAt),
            ),
          )
          .returning();
        if (!closed) throw new Error("The expired design-partner grant could not be closed");
        await tx.insert(founderEntitlementGrantEvents).values({
          grantId: closed.id,
          projectId: closed.projectId,
          action: "REVOKED",
          actorId: issuedBy,
          snapshot: snapshot(closed),
          occurredAt: now,
        });
      }

      const [grant] = await tx
        .insert(founderEntitlementGrants)
        .values({
          projectId: input.projectId,
          issuedBy,
          createdAt: now,
          expiresAt: input.expiresAt,
        })
        .returning();
      if (!grant) throw new Error("The design-partner grant could not be issued");
      await tx.insert(founderEntitlementGrantEvents).values({
        grantId: grant.id,
        projectId: grant.projectId,
        action: "ISSUED",
        actorId: issuedBy,
        snapshot: snapshot(grant),
        occurredAt: now,
      });
      return { grant, created: true };
    });
  }

  async revoke(input: { grantId: string; revokedBy: string; now?: Date }) {
    const now = input.now ?? new Date();
    const revokedBy = actorId(input.revokedBy);
    if (Number.isNaN(now.getTime())) throw new Error("Founder grant revocation time is invalid");
    return this.db.transaction(async (tx) => {
      const [identity] = await tx
        .select()
        .from(founderEntitlementGrants)
        .where(eq(founderEntitlementGrants.id, input.grantId))
        .limit(1);
      if (!identity) return null;
      await lockProjectEntitlementScope(tx as unknown as TrendsFastDatabase, identity.projectId);
      const [before] = await tx
        .select()
        .from(founderEntitlementGrants)
        .where(eq(founderEntitlementGrants.id, input.grantId))
        .limit(1)
        .for("update");
      if (!before) return null;
      if (before.revokedAt) return { grant: before, revoked: false };
      const [grant] = await tx
        .update(founderEntitlementGrants)
        .set({ revokedAt: now, revokedBy })
        .where(
          and(
            eq(founderEntitlementGrants.id, input.grantId),
            isNull(founderEntitlementGrants.revokedAt),
          ),
        )
        .returning();
      if (!grant) throw new Error("The design-partner grant could not be revoked");
      await tx.insert(founderEntitlementGrantEvents).values({
        grantId: grant.id,
        projectId: grant.projectId,
        action: "REVOKED",
        actorId: revokedBy,
        snapshot: snapshot(grant),
        occurredAt: now,
      });
      return { grant, revoked: true };
    });
  }

  async getActiveForProject(projectId: string, now = new Date()) {
    const [grant] = await this.db
      .select()
      .from(founderEntitlementGrants)
      .where(
        and(
          eq(founderEntitlementGrants.projectId, projectId),
          isNull(founderEntitlementGrants.revokedAt),
          lte(founderEntitlementGrants.createdAt, now),
          gt(founderEntitlementGrants.expiresAt, now),
        ),
      )
      .limit(1);
    return grant ?? null;
  }

  async list(input: { projectId?: string; limit?: number } = {}) {
    const limit = Math.min(Math.max(input.limit ?? 100, 1), 200);
    return this.db
      .select()
      .from(founderEntitlementGrants)
      .where(input.projectId ? eq(founderEntitlementGrants.projectId, input.projectId) : undefined)
      .orderBy(desc(founderEntitlementGrants.createdAt))
      .limit(limit);
  }

  async listEvents(input: { projectId?: string; limit?: number } = {}) {
    const limit = Math.min(Math.max(input.limit ?? 100, 1), 200);
    return this.db
      .select()
      .from(founderEntitlementGrantEvents)
      .where(
        input.projectId ? eq(founderEntitlementGrantEvents.projectId, input.projectId) : undefined,
      )
      .orderBy(desc(founderEntitlementGrantEvents.occurredAt))
      .limit(limit);
  }
}
