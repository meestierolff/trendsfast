import { asc, desc, eq, gt, inArray, lte } from "drizzle-orm";

import type { TrendsFastDatabase } from "../client";
import { analyticsEvents, founderLaunchInterestEvents, founderLaunchInterests } from "../schema";
import { durableAnalyticsDedupeKey } from "./analytics";

export type FounderLaunchInterestSource = "homepage" | "pricing";
export type FounderLaunchInterestAction = "JOINED" | "RECONSENTED" | "DELETED" | "PURGED";

function validDate(value: Date, label: string): Date {
  if (Number.isNaN(value.getTime())) throw new Error(`${label} is invalid`);
  return value;
}

function boundedLimit(value: number | undefined, fallback = 200): number {
  const limit = value ?? fallback;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
    throw new Error("Founder launch-interest limit must be between 1 and 500");
  }
  return limit;
}

function exactUuid(value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error("Founder launch-interest identifier is invalid");
  }
  return value;
}

function boundedActor(value: string): string {
  const actor = value.trim();
  if (!/^[A-Za-z0-9:_-]{1,100}$/.test(actor)) {
    throw new Error("Founder launch-interest actor is invalid");
  }
  return actor;
}

function validEmail(value: string): string {
  if (
    value !== value.trim().toLowerCase() ||
    value.length < 3 ||
    value.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
  ) {
    throw new Error("Founder launch-interest email must be normalized");
  }
  return value;
}

function validEmailHash(value: string): string {
  if (!/^[0-9a-f]{64}$/.test(value)) {
    throw new Error("Founder launch-interest email hash is invalid");
  }
  return value;
}

export class FounderLaunchInterestRepository {
  constructor(private readonly db: TrendsFastDatabase) {}

  async create(input: {
    normalizedEmail: string;
    emailHash: string;
    consentVersion: string;
    consentedAt: Date;
    source: FounderLaunchInterestSource;
    expiresAt: Date;
    anonymousSessionHash: string;
  }): Promise<{ id: string; created: boolean }> {
    const email = validEmail(input.normalizedEmail);
    const emailHash = validEmailHash(input.emailHash);
    if (input.consentVersion !== "founder-launch-v1") {
      throw new Error("Founder launch-interest consent version is invalid");
    }
    if (input.source !== "homepage" && input.source !== "pricing") {
      throw new Error("Founder launch-interest source is invalid");
    }
    const consentedAt = validDate(input.consentedAt, "Founder launch-interest consent time");
    const expiresAt = validDate(input.expiresAt, "Founder launch-interest expiry");
    if (expiresAt <= consentedAt) {
      throw new Error("Founder launch-interest expiry must follow consent");
    }
    if (!/^[0-9a-f]{64}$/.test(input.anonymousSessionHash)) {
      throw new Error("Founder launch-interest session hash is invalid");
    }

    return this.db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(founderLaunchInterests)
        .values({
          email,
          emailHash,
          consentVersion: input.consentVersion,
          consentedAt,
          source: input.source,
          expiresAt,
          createdAt: consentedAt,
          updatedAt: consentedAt,
        })
        .onConflictDoNothing({ target: founderLaunchInterests.emailHash })
        .returning({ id: founderLaunchInterests.id });

      const created = Boolean(inserted);
      const interest = inserted
        ? inserted
        : (
            await tx
              .update(founderLaunchInterests)
              .set({
                email,
                consentVersion: input.consentVersion,
                consentedAt,
                source: input.source,
                expiresAt,
                updatedAt: consentedAt,
              })
              .where(eq(founderLaunchInterests.emailHash, emailHash))
              .returning({ id: founderLaunchInterests.id })
          )[0];
      if (!interest) throw new Error("Could not persist Founder launch interest");

      await tx.insert(founderLaunchInterestEvents).values({
        interestReference: interest.id,
        action: created ? "JOINED" : "RECONSENTED",
        actorId: "public:self-service",
        occurredAt: consentedAt,
      });
      if (created) {
        await tx
          .insert(analyticsEvents)
          .values({
            name: "beta_waitlist_joined",
            anonymousSessionHash: input.anonymousSessionHash,
            dedupeKey: durableAnalyticsDedupeKey("beta_waitlist_joined", "interest", interest.id),
            properties: { source: input.source },
            occurredAt: consentedAt,
          })
          .onConflictDoNothing();
      }
      return { id: interest.id, created };
    });
  }

  async list(input: { limit?: number; now?: Date } = {}) {
    const now = validDate(input.now ?? new Date(), "Founder launch-interest list time");
    return this.db
      .select()
      .from(founderLaunchInterests)
      .where(gt(founderLaunchInterests.expiresAt, now))
      .orderBy(desc(founderLaunchInterests.consentedAt))
      .limit(boundedLimit(input.limit));
  }

  async listEvents(input: { limit?: number } = {}) {
    return this.db
      .select()
      .from(founderLaunchInterestEvents)
      .orderBy(desc(founderLaunchInterestEvents.occurredAt))
      .limit(boundedLimit(input.limit));
  }

  async hardDelete(input: { id: string; actorId: string; occurredAt?: Date }) {
    const id = exactUuid(input.id);
    const actorId = boundedActor(input.actorId);
    const occurredAt = validDate(
      input.occurredAt ?? new Date(),
      "Founder launch-interest deletion time",
    );
    return this.db.transaction(async (tx) => {
      const [interest] = await tx
        .select({ id: founderLaunchInterests.id })
        .from(founderLaunchInterests)
        .where(eq(founderLaunchInterests.id, id))
        .limit(1)
        .for("update");
      if (!interest) return { deleted: false as const };
      await tx.insert(founderLaunchInterestEvents).values({
        interestReference: interest.id,
        action: "DELETED",
        actorId,
        occurredAt,
      });
      await tx.delete(founderLaunchInterests).where(eq(founderLaunchInterests.id, interest.id));
      return { deleted: true as const };
    });
  }

  async purgeExpired(input: { now?: Date; limit?: number } = {}) {
    const now = validDate(input.now ?? new Date(), "Founder launch-interest purge time");
    const limit = boundedLimit(input.limit, 500);
    return this.db.transaction(async (tx) => {
      const expired = await tx
        .select({ id: founderLaunchInterests.id })
        .from(founderLaunchInterests)
        .where(lte(founderLaunchInterests.expiresAt, now))
        .orderBy(asc(founderLaunchInterests.expiresAt))
        .limit(limit)
        .for("update", { skipLocked: true });
      if (expired.length === 0) return { deleted: 0 };
      await tx.insert(founderLaunchInterestEvents).values(
        expired.map((interest) => ({
          interestReference: interest.id,
          action: "PURGED" as const,
          actorId: "system:retention",
          occurredAt: now,
        })),
      );
      const deleted = await tx
        .delete(founderLaunchInterests)
        .where(
          inArray(
            founderLaunchInterests.id,
            expired.map((interest) => interest.id),
          ),
        )
        .returning({ id: founderLaunchInterests.id });
      return { deleted: deleted.length };
    });
  }
}
