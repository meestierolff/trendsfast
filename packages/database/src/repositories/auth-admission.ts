import { count, eq, like, sql } from "drizzle-orm";

import type { TrendsFastDatabase } from "../client";
import { apiAuthAdmissionBuckets } from "../schema";

const GLOBAL_LOCK_KEY = "trendsfast:api-auth-admission:v1";

type AdmissionOptions = {
  fingerprintHash: string;
  namespace?: string;
  now?: Date;
  windowMs?: number;
  maxAttemptsPerFingerprint?: number;
  maxAttemptsGlobal?: number;
  maxFingerprintBuckets?: number;
};

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be positive`);
  return value;
}

function boundedScope(value: string, label: string): string {
  const normalized = value.trim();
  if (!/^[a-z0-9:_-]{1,160}$/i.test(normalized)) {
    throw new Error(`${label} is outside the bounded admission-key contract`);
  }
  return normalized;
}

/**
 * PostgreSQL-backed, fixed-cardinality admission for all syntactically valid
 * bearer-key attempts. Counting every admitted attempt (not only failures)
 * bounds scrypt work across warm processes and instances before authentication.
 */
export class AuthAdmissionRepository {
  constructor(private readonly db: TrendsFastDatabase) {}

  async admit(input: AdmissionOptions): Promise<boolean> {
    const namespace = boundedScope(input.namespace ?? "v1", "Admission namespace");
    const fingerprintHash = boundedScope(input.fingerprintHash, "Fingerprint hash");
    const now = input.now ?? new Date();
    const windowMs = positiveInteger(input.windowMs ?? 60_000, "Admission window");
    const maxPerFingerprint = positiveInteger(
      input.maxAttemptsPerFingerprint ?? 12,
      "Per-fingerprint limit",
    );
    const maxGlobal = positiveInteger(input.maxAttemptsGlobal ?? 120, "Global limit");
    const maxBuckets = positiveInteger(
      input.maxFingerprintBuckets ?? 10_000,
      "Fingerprint bucket limit",
    );
    if (maxGlobal < maxPerFingerprint || maxBuckets < 2) {
      throw new Error("Global admission limits must cover the per-fingerprint policy");
    }
    if (Number.isNaN(now.getTime())) throw new Error("Admission time is invalid");

    const windowStartedAt = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
    const prefix = `${namespace}:`;
    const globalScope = `${prefix}global`;
    const requestedScope = `${prefix}fp:${fingerprintHash}`;
    const overflowScope = `${prefix}overflow`;

    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${GLOBAL_LOCK_KEY}))`);

      const readAttempts = async (scopeHash: string): Promise<number> => {
        const [bucket] = await tx
          .select()
          .from(apiAuthAdmissionBuckets)
          .where(eq(apiAuthAdmissionBuckets.scopeHash, scopeHash))
          .limit(1);
        return bucket?.windowStartedAt.getTime() === windowStartedAt.getTime()
          ? bucket.attempts
          : 0;
      };

      if ((await readAttempts(globalScope)) >= maxGlobal) return false;

      let fingerprintScope = requestedScope;
      const [requested] = await tx
        .select({ scopeHash: apiAuthAdmissionBuckets.scopeHash })
        .from(apiAuthAdmissionBuckets)
        .where(eq(apiAuthAdmissionBuckets.scopeHash, requestedScope))
        .limit(1);
      if (!requested) {
        const [bucketCount] = await tx
          .select({ value: count() })
          .from(apiAuthAdmissionBuckets)
          .where(like(apiAuthAdmissionBuckets.scopeHash, `${prefix}%`));
        if ((bucketCount?.value ?? 0) >= maxBuckets) fingerprintScope = overflowScope;
      }
      if ((await readAttempts(fingerprintScope)) >= maxPerFingerprint) return false;

      const increment = async (scopeHash: string) => {
        await tx
          .insert(apiAuthAdmissionBuckets)
          .values({ scopeHash, windowStartedAt, attempts: 1, updatedAt: now })
          .onConflictDoUpdate({
            target: apiAuthAdmissionBuckets.scopeHash,
            set: {
              windowStartedAt,
              attempts: sql<number>`CASE WHEN ${apiAuthAdmissionBuckets.windowStartedAt} = ${windowStartedAt} THEN ${apiAuthAdmissionBuckets.attempts} + 1 ELSE 1 END`,
              updatedAt: now,
            },
          });
      };

      await increment(globalScope);
      await increment(fingerprintScope);
      return true;
    });
  }
}
