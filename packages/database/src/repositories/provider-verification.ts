import { and, desc, eq, inArray } from "drizzle-orm";

import { redactSecrets } from "@trendsfast/core";
import type { SourceSlug } from "@trendsfast/schemas";

import type { TrendsFastDatabase } from "../client";
import { providerVerificationRecords } from "../schema";

export type ProviderVerificationState =
  "VERIFIED" | "DEGRADED" | "FAILED" | "UNCONFIGURED" | "FIXTURE" | "LEGAL_REVIEW";
export type ProviderVerificationHealthStatus = "HEALTHY" | "DEGRADED" | "UNCONFIGURED" | "FAILED";

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
    const estimatedCostUsd = input.estimatedCostUsd ?? 0;
    const quotaUsed = input.quotaUsed ?? 0;
    if (
      !Number.isFinite(estimatedCostUsd) ||
      estimatedCostUsd < 0 ||
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
    const [record] = await this.db
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
        limitations: boundedLimitations(input.limitations ?? []),
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
    return record;
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
    return this.db
      .selectDistinctOn([providerVerificationRecords.source])
      .from(providerVerificationRecords)
      .where(inArray(providerVerificationRecords.state, terminalStates))
      .orderBy(providerVerificationRecords.source, desc(providerVerificationRecords.completedAt));
  }

  async latestProductionBySource() {
    return this.db
      .selectDistinctOn([providerVerificationRecords.source])
      .from(providerVerificationRecords)
      .where(
        and(
          eq(providerVerificationRecords.deploymentEnvironment, "production"),
          inArray(providerVerificationRecords.state, terminalStates),
        ),
      )
      .orderBy(providerVerificationRecords.source, desc(providerVerificationRecords.completedAt));
  }

  async list(input: { source?: SourceSlug; limit?: number } = {}) {
    const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);
    return this.db
      .select()
      .from(providerVerificationRecords)
      .where(input.source ? eq(providerVerificationRecords.source, input.source) : undefined)
      .orderBy(desc(providerVerificationRecords.createdAt))
      .limit(limit);
  }
}
