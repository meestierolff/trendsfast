import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { redactSecrets } from "@trendsfast/core";
import type { SourceSlug } from "@trendsfast/schemas";

import type { TrendsFastDatabase } from "../client";
import { providerVerificationRecords } from "../schema";

export type ProviderVerificationState =
  "VERIFIED" | "DEGRADED" | "FAILED" | "UNCONFIGURED" | "FIXTURE" | "LEGAL_REVIEW";
export type ProviderVerificationHealthStatus = "HEALTHY" | "DEGRADED" | "UNCONFIGURED" | "FAILED";

const ATTEMPT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUEST_HASH_PATTERN = /^[0-9a-f]{64}$/;
const REQUEST_HASH_LIMITATION_PREFIX = "internal:verification-request-sha256:";

export class ProviderVerificationAttemptConflictError extends Error {
  constructor() {
    super("The provider verification attempt ID was reused for different inputs");
    this.name = "ProviderVerificationAttemptConflictError";
  }
}

type ProviderVerificationRecord = typeof providerVerificationRecords.$inferSelect;

type PublicProviderVerificationRow = {
  source: SourceSlug;
  provider: string;
  state: ProviderVerificationState;
  credential_mode: string;
  deployment_environment: "production";
  health_status: ProviderVerificationHealthStatus | null;
  readback_verified: boolean;
  canonical_url_count: number;
  latency_ms: number | null;
  checked_at: Date | null;
  completed_at: Date | null;
};

function requestHashMarker(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!REQUEST_HASH_PATTERN.test(normalized)) {
    throw new Error("Provider verification request hashes must be lowercase SHA-256 values");
  }
  return `${REQUEST_HASH_LIMITATION_PREFIX}${normalized}`;
}

function internalLimitations(values: readonly string[]): string[] {
  return values.filter((value) => value.startsWith(REQUEST_HASH_LIMITATION_PREFIX));
}

function publicRecord(record: ProviderVerificationRecord): ProviderVerificationRecord {
  return {
    ...record,
    limitations: record.limitations.filter(
      (value) => !value.startsWith(REQUEST_HASH_LIMITATION_PREFIX),
    ),
  };
}

function sameNullable(left: string | null, right: string | null | undefined): boolean {
  return left === (right ?? null);
}

const terminalStates: ProviderVerificationState[] = [
  "VERIFIED",
  "DEGRADED",
  "FAILED",
  "UNCONFIGURED",
  "FIXTURE",
  "LEGAL_REVIEW",
];

const SECRET_QUERY_PARAMETER =
  /(^|[_-])(api[_-]?key|access[_-]?token|token|secret|password|signature|sig|credential|authorization|auth)($|[_-])/i;

function boundedUrls(urls: readonly string[]): string[] {
  const safe: string[] = [];
  for (const value of urls.slice(0, 30)) {
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      value.length > 2_048
    ) {
      throw new Error("Provider verification canonical URL is invalid");
    }
    url.hash = "";
    for (const [name, parameterValue] of [...url.searchParams.entries()]) {
      if (SECRET_QUERY_PARAMETER.test(name) || redactSecrets(parameterValue) !== parameterValue) {
        url.searchParams.delete(name);
      }
    }
    safe.push(url.href);
  }
  return [...new Set(safe)];
}

function boundedLimitations(values: readonly string[]): string[] {
  return values
    .slice(0, 50)
    .map((value) => redactSecrets(value).trim().slice(0, 1_000))
    .filter(Boolean);
}

export class ProviderVerificationRepository {
  constructor(private readonly db: TrendsFastDatabase) {}

  /**
   * Uses the caller's bounded attempt UUID as the durable idempotency boundary.
   * The reservation and RUNNING record are committed before the caller is
   * allowed to make a provider call. A concurrent or later replay receives the
   * original record and never becomes a second effect owner.
   */
  async admitAttempt(input: {
    attemptId: string;
    requestHash: string;
    source: typeof providerVerificationRecords.$inferInsert.source;
    provider: string;
    credentialMode: "fixture" | "managed" | "byok" | "none";
    deploymentEnvironment: "local" | "preview" | "production";
    releaseSha?: string | null;
    deploymentHost?: string | null;
    deploymentId?: string | null;
    initiatedBy: string;
    estimatedCostReservationUsd: number;
    maximumCostUsd: number;
    startedAt?: Date;
  }): Promise<{
    record: ProviderVerificationRecord;
    created: boolean;
    admitted: boolean;
  }> {
    if (!ATTEMPT_ID_PATTERN.test(input.attemptId)) {
      throw new Error("Provider verification attempt IDs must be UUIDs");
    }
    if (
      !Number.isFinite(input.estimatedCostReservationUsd) ||
      input.estimatedCostReservationUsd < 0 ||
      !Number.isFinite(input.maximumCostUsd) ||
      input.maximumCostUsd < 0
    ) {
      throw new Error("Provider verification cost admission requires finite non-negative values");
    }

    const provider = redactSecrets(input.provider).trim().slice(0, 100);
    const initiatedBy = redactSecrets(input.initiatedBy).trim().slice(0, 160);
    if (!provider || !initiatedBy) {
      throw new Error("Provider verification identity is required");
    }
    const marker = requestHashMarker(input.requestHash);
    const denied = input.estimatedCostReservationUsd > input.maximumCostUsd;
    const startedAt = input.startedAt ?? new Date();

    return this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(providerVerificationRecords)
        .values({
          id: input.attemptId,
          source: input.source,
          provider,
          state: denied ? "FAILED" : "RUNNING",
          credentialMode: input.credentialMode,
          deploymentEnvironment: input.deploymentEnvironment,
          releaseSha: input.releaseSha ?? null,
          deploymentHost: input.deploymentHost ?? null,
          deploymentId: input.deploymentId ?? null,
          estimatedCostUsd: denied ? "0" : input.estimatedCostReservationUsd.toFixed(6),
          actualCostUsd: null,
          limitations: [
            marker,
            ...(denied
              ? [
                  "The conservative provider verification reservation exceeded the configured cost ceiling; no provider call was made.",
                ]
              : []),
          ],
          failureCode: denied ? "VERIFICATION_COST_LIMIT" : null,
          failureMessage: denied
            ? "Provider verification was denied before any external effect."
            : null,
          initiatedBy,
          startedAt,
          checkedAt: denied ? startedAt : null,
          completedAt: denied ? startedAt : null,
        })
        .onConflictDoNothing()
        .returning();
      if (created) {
        return {
          record: publicRecord(created),
          created: true,
          admitted: !denied,
        };
      }

      const [existing] = await tx
        .select()
        .from(providerVerificationRecords)
        .where(eq(providerVerificationRecords.id, input.attemptId))
        .limit(1)
        .for("update");
      if (!existing) throw new Error("Provider verification admission lost its attempt record");
      if (
        existing.source !== input.source ||
        existing.provider !== provider ||
        existing.credentialMode !== input.credentialMode ||
        existing.deploymentEnvironment !== input.deploymentEnvironment ||
        !sameNullable(existing.releaseSha, input.releaseSha) ||
        !sameNullable(existing.deploymentHost, input.deploymentHost) ||
        !sameNullable(existing.deploymentId, input.deploymentId) ||
        existing.initiatedBy !== initiatedBy ||
        !internalLimitations(existing.limitations).includes(marker)
      ) {
        throw new ProviderVerificationAttemptConflictError();
      }
      return {
        record: publicRecord(existing),
        created: false,
        admitted: false,
      };
    });
  }

  async begin(input: {
    source: typeof providerVerificationRecords.$inferInsert.source;
    provider: string;
    credentialMode: "fixture" | "managed" | "byok" | "none";
    deploymentEnvironment: "local" | "preview" | "production";
    releaseSha?: string | null;
    deploymentHost?: string | null;
    deploymentId?: string | null;
    initiatedBy: string;
    startedAt?: Date;
  }) {
    const [record] = await this.db
      .insert(providerVerificationRecords)
      .values({
        source: input.source,
        provider: redactSecrets(input.provider).trim().slice(0, 100),
        state: "RUNNING",
        credentialMode: input.credentialMode,
        deploymentEnvironment: input.deploymentEnvironment,
        releaseSha: input.releaseSha ?? null,
        deploymentHost: input.deploymentHost ?? null,
        deploymentId: input.deploymentId ?? null,
        initiatedBy: redactSecrets(input.initiatedBy).trim().slice(0, 160),
        startedAt: input.startedAt ?? new Date(),
      })
      .returning();
    if (!record) throw new Error("Could not start provider verification");
    return record;
  }

  async complete(input: {
    id: string;
    state: ProviderVerificationState;
    healthStatus?: ProviderVerificationHealthStatus;
    readbackVerified: boolean;
    canonicalUrls?: readonly string[];
    latencyMs?: number;
    estimatedCostUsd?: number;
    actualCostUsd?: number;
    quotaUsed?: number;
    limitations?: readonly string[];
    failureCode?: string;
    failureMessage?: string;
    checkedAt?: Date;
    completedAt?: Date;
  }) {
    const canonicalUrls = boundedUrls(input.canonicalUrls ?? []);
    const quotaUsed = input.quotaUsed ?? 0;
    if (
      (input.estimatedCostUsd !== undefined &&
        (!Number.isFinite(input.estimatedCostUsd) || input.estimatedCostUsd < 0)) ||
      (input.actualCostUsd !== undefined &&
        (!Number.isFinite(input.actualCostUsd) || input.actualCostUsd < 0)) ||
      !Number.isFinite(quotaUsed) ||
      quotaUsed < 0 ||
      (input.latencyMs !== undefined &&
        (!Number.isSafeInteger(input.latencyMs) || input.latencyMs < 0))
    ) {
      throw new Error("Provider verification accounting is invalid");
    }
    if (input.state === "VERIFIED" && (!input.readbackVerified || canonicalUrls.length === 0)) {
      throw new Error("VERIFIED requires a successful canonical source read-back");
    }
    if (input.state !== "VERIFIED" && input.readbackVerified) {
      throw new Error("Only VERIFIED records may assert a successful read-back");
    }
    const completedAt = input.completedAt ?? new Date();
    return this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(providerVerificationRecords)
        .where(eq(providerVerificationRecords.id, input.id))
        .limit(1)
        .for("update");
      if (!existing || existing.state !== "RUNNING") {
        throw new Error("Provider verification is no longer running");
      }
      const estimatedCostUsd = input.estimatedCostUsd ?? Number(existing.estimatedCostUsd);
      if (!Number.isFinite(estimatedCostUsd) || estimatedCostUsd < 0) {
        throw new Error("Provider verification accounting is invalid");
      }
      const limitations = [
        ...internalLimitations(existing.limitations),
        ...boundedLimitations(input.limitations ?? []),
      ];
      const [record] = await tx
        .update(providerVerificationRecords)
        .set({
          state: input.state,
          healthStatus: input.healthStatus ?? null,
          readbackVerified: input.readbackVerified,
          canonicalUrls,
          latencyMs: input.latencyMs ?? null,
          estimatedCostUsd: estimatedCostUsd.toFixed(6),
          actualCostUsd: input.actualCostUsd === undefined ? null : input.actualCostUsd.toFixed(6),
          quotaUsed: quotaUsed.toFixed(4),
          limitations,
          failureCode: input.failureCode
            ? redactSecrets(input.failureCode).trim().slice(0, 100)
            : null,
          failureMessage: input.failureMessage
            ? redactSecrets(input.failureMessage).trim().slice(0, 500)
            : null,
          checkedAt: input.checkedAt ?? completedAt,
          completedAt,
        })
        .where(
          and(
            eq(providerVerificationRecords.id, input.id),
            eq(providerVerificationRecords.state, "RUNNING"),
          ),
        )
        .returning();
      if (!record) throw new Error("Provider verification is no longer running");
      return publicRecord(record);
    });
  }

  async record(input: {
    source: typeof providerVerificationRecords.$inferInsert.source;
    provider: string;
    credentialMode: "fixture" | "managed" | "byok" | "none";
    deploymentEnvironment: "local" | "preview" | "production";
    releaseSha?: string | null;
    deploymentHost?: string | null;
    deploymentId?: string | null;
    initiatedBy: string;
    state: ProviderVerificationState;
    healthStatus?: ProviderVerificationHealthStatus;
    readbackVerified: boolean;
    canonicalUrls?: readonly string[];
    latencyMs?: number;
    estimatedCostUsd?: number;
    actualCostUsd?: number;
    quotaUsed?: number;
    limitations?: readonly string[];
    failureCode?: string;
    failureMessage?: string;
    checkedAt?: Date;
  }) {
    const started = await this.begin(input);
    return this.complete({
      id: started.id,
      state: input.state,
      readbackVerified: input.readbackVerified,
      ...(input.healthStatus === undefined ? {} : { healthStatus: input.healthStatus }),
      ...(input.canonicalUrls === undefined ? {} : { canonicalUrls: input.canonicalUrls }),
      ...(input.latencyMs === undefined ? {} : { latencyMs: input.latencyMs }),
      ...(input.estimatedCostUsd === undefined ? {} : { estimatedCostUsd: input.estimatedCostUsd }),
      ...(input.actualCostUsd === undefined ? {} : { actualCostUsd: input.actualCostUsd }),
      ...(input.quotaUsed === undefined ? {} : { quotaUsed: input.quotaUsed }),
      ...(input.limitations === undefined ? {} : { limitations: input.limitations }),
      ...(input.failureCode === undefined ? {} : { failureCode: input.failureCode }),
      ...(input.failureMessage === undefined ? {} : { failureMessage: input.failureMessage }),
      ...(input.checkedAt === undefined ? {} : { checkedAt: input.checkedAt }),
    });
  }

  async latestBySource() {
    const records = await this.db
      .selectDistinctOn([providerVerificationRecords.source])
      .from(providerVerificationRecords)
      .where(inArray(providerVerificationRecords.state, terminalStates))
      .orderBy(providerVerificationRecords.source, desc(providerVerificationRecords.completedAt));
    return records.map(publicRecord);
  }

  async latestProductionBySource() {
    const records = await this.db
      .selectDistinctOn([providerVerificationRecords.source])
      .from(providerVerificationRecords)
      .where(
        and(
          eq(providerVerificationRecords.deploymentEnvironment, "production"),
          inArray(providerVerificationRecords.state, terminalStates),
        ),
      )
      .orderBy(providerVerificationRecords.source, desc(providerVerificationRecords.completedAt));
    return records.map(publicRecord);
  }

  /**
   * Calls the migration-owned, exact-deployment projection. The runtime role
   * has EXECUTE only and cannot read provider_verification_records itself.
   */
  async latestPublicProductionBySource(input: {
    releaseSha: string;
    deploymentHost: string;
    deploymentId: string;
  }) {
    const result = await this.db.execute<PublicProviderVerificationRow>(sql`
      select source,
             provider,
             state,
             credential_mode,
             deployment_environment,
             health_status,
             readback_verified,
             canonical_url_count,
             latency_ms,
             checked_at,
             completed_at
        from public.trendsfast_public_provider_verifications(
          ${input.releaseSha},
          ${input.deploymentHost},
          ${input.deploymentId}
        )
    `);
    return result.rows.map((record) => ({
      source: record.source,
      provider: record.provider,
      state: record.state,
      credentialMode: record.credential_mode,
      deploymentEnvironment: record.deployment_environment,
      healthStatus: record.health_status,
      readbackVerified: record.readback_verified,
      canonicalUrlCount: record.canonical_url_count,
      latencyMs: record.latency_ms,
      checkedAt: record.checked_at,
      completedAt: record.completed_at,
    }));
  }

  async list(input: { source?: SourceSlug; limit?: number } = {}) {
    const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);
    const records = await this.db
      .select()
      .from(providerVerificationRecords)
      .where(input.source ? eq(providerVerificationRecords.source, input.source) : undefined)
      .orderBy(desc(providerVerificationRecords.createdAt))
      .limit(limit);
    return records.map(publicRecord);
  }
}
