import { and, asc, eq, sql, sum } from "drizzle-orm";

import { redactSecrets } from "@trendsfast/core";

import type { TrendsFastDatabase } from "../client";
import { providerCostLedger, scanRuns, sourceRuns } from "../schema";

function validNonnegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

const USD_MICROS = 1_000_000;

function toUsdMicros(value: number, rounding: "nearest" | "floor"): number {
  const micros = value * USD_MICROS;
  return rounding === "floor" ? Math.floor(micros) : Math.round(micros);
}

function ledgerKey(value: string): string {
  const normalized = redactSecrets(value).slice(0, 200);
  if (!normalized.trim())
    throw new Error("Provider cost ledger entries require a stable ledger key");
  return normalized;
}

export class CostRepository {
  constructor(private readonly db: TrendsFastDatabase) {}

  async record(input: {
    scanRunId: string;
    ledgerKey: string;
    sourceRunId?: string;
    provider: string;
    operation: string;
    providerRequestId?: string;
    estimatedCostUsd: number;
    actualCostUsd: number;
    quotaUnits?: number;
    unitMetadata?: Record<string, number | string>;
    occurredAt?: Date;
  }) {
    const normalizedLedgerKey = ledgerKey(input.ledgerKey);
    if (
      !validNonnegative(input.estimatedCostUsd) ||
      !validNonnegative(input.actualCostUsd) ||
      !validNonnegative(input.quotaUnits ?? 0)
    ) {
      throw new Error("Provider cost and quota values cannot be negative");
    }
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${input.scanRunId}, 0))`);
      const [entry] = await tx
        .insert(providerCostLedger)
        .values({
          scanRunId: input.scanRunId,
          ledgerKey: normalizedLedgerKey,
          sourceRunId: input.sourceRunId ?? null,
          provider: redactSecrets(input.provider).slice(0, 100),
          operation: redactSecrets(input.operation).slice(0, 160),
          providerRequestId: input.providerRequestId
            ? redactSecrets(input.providerRequestId).slice(0, 200)
            : null,
          estimatedCostUsd: input.estimatedCostUsd.toFixed(6),
          actualCostUsd: input.actualCostUsd.toFixed(6),
          quotaUnits: (input.quotaUnits ?? 0).toFixed(4),
          unitMetadata: input.unitMetadata ?? null,
          occurredAt: input.occurredAt ?? new Date(),
        })
        .onConflictDoNothing()
        .returning();
      if (!entry) {
        const [existing] = await tx
          .select()
          .from(providerCostLedger)
          .where(
            and(
              eq(providerCostLedger.scanRunId, input.scanRunId),
              eq(providerCostLedger.ledgerKey, normalizedLedgerKey),
            ),
          )
          .limit(1);
        if (!existing) throw new Error("Could not record provider cost");
        return { entry: existing, created: false as const };
      }

      await tx
        .update(scanRuns)
        .set({
          estimatedCostUsd: sql`${scanRuns.estimatedCostUsd} + ${input.estimatedCostUsd.toFixed(6)}`,
          actualCostUsd: sql`${scanRuns.actualCostUsd} + ${input.actualCostUsd.toFixed(6)}`,
          updatedAt: new Date(),
        })
        .where(eq(scanRuns.id, input.scanRunId));
      if (input.sourceRunId) {
        await tx
          .update(sourceRuns)
          .set({
            estimatedCostUsd: sql`${sourceRuns.estimatedCostUsd} + ${input.estimatedCostUsd.toFixed(6)}`,
            actualCostUsd: sql`${sourceRuns.actualCostUsd} + ${input.actualCostUsd.toFixed(6)}`,
            quotaUsed: sql`${sourceRuns.quotaUsed} + ${(input.quotaUnits ?? 0).toFixed(4)}`,
            updatedAt: new Date(),
          })
          .where(eq(sourceRuns.id, input.sourceRunId));
      }
      return { entry, created: true as const };
    });
  }

  /**
   * Atomically reserves conservative estimated spend before an external call.
   * Actual cost remains zero until truthful provider usage is available; a
   * crash therefore leaves the safe estimate committed to the scan ceiling.
   */
  async reserveEstimatedCost(input: {
    scanRunId: string;
    ledgerKey: string;
    sourceRunId?: string;
    provider: string;
    operation: string;
    estimatedCostUsd: number;
    maximumCostUsd: number;
    unitMetadata: Record<string, number | string>;
    occurredAt?: Date;
  }) {
    const normalizedLedgerKey = ledgerKey(input.ledgerKey);
    if (!validNonnegative(input.estimatedCostUsd) || !validNonnegative(input.maximumCostUsd)) {
      throw new Error("Cost reservations and scan limits must be finite and non-negative");
    }

    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${input.scanRunId}, 0))`);
      const [existing] = await tx
        .select()
        .from(providerCostLedger)
        .where(
          and(
            eq(providerCostLedger.scanRunId, input.scanRunId),
            eq(providerCostLedger.ledgerKey, normalizedLedgerKey),
          ),
        )
        .limit(1);
      const [run] = await tx
        .select({ id: scanRuns.id })
        .from(scanRuns)
        .where(eq(scanRuns.id, input.scanRunId))
        .limit(1);
      if (!run) throw new Error("Cannot reserve cost for a missing scan run");
      const [committed] = await tx
        .select({
          costUsd: sql<string>`coalesce(sum(greatest(${providerCostLedger.estimatedCostUsd}, ${providerCostLedger.actualCostUsd})), 0)`,
        })
        .from(providerCostLedger)
        .where(eq(providerCostLedger.scanRunId, input.scanRunId));
      const committedCostUsd = Number(committed?.costUsd ?? 0);
      if (existing) {
        if (input.sourceRunId && existing.sourceRunId !== input.sourceRunId) {
          throw new Error("A cost reservation cannot move between source runs");
        }
        return {
          entry: existing,
          created: false as const,
          committedCostUsd,
          projectedCostUsd: committedCostUsd,
          maximumCostUsd: input.maximumCostUsd,
        };
      }

      const projectedCostMicros =
        toUsdMicros(committedCostUsd, "nearest") + toUsdMicros(input.estimatedCostUsd, "nearest");
      const projectedCostUsd = projectedCostMicros / USD_MICROS;
      if (projectedCostMicros > toUsdMicros(input.maximumCostUsd, "floor")) {
        throw new ScanCostLimitError(projectedCostUsd, input.maximumCostUsd);
      }
      const [entry] = await tx
        .insert(providerCostLedger)
        .values({
          scanRunId: input.scanRunId,
          ledgerKey: normalizedLedgerKey,
          sourceRunId: input.sourceRunId ?? null,
          provider: redactSecrets(input.provider).slice(0, 100),
          operation: redactSecrets(input.operation).slice(0, 160),
          estimatedCostUsd: input.estimatedCostUsd.toFixed(6),
          actualCostUsd: "0",
          quotaUnits: "0",
          unitMetadata: input.unitMetadata,
          occurredAt: input.occurredAt ?? new Date(),
        })
        .returning();
      if (!entry) throw new Error("Could not persist the cost reservation");
      await tx
        .update(scanRuns)
        .set({
          estimatedCostUsd: sql`${scanRuns.estimatedCostUsd} + ${input.estimatedCostUsd.toFixed(6)}`,
          updatedAt: new Date(),
        })
        .where(eq(scanRuns.id, input.scanRunId));
      if (input.sourceRunId) {
        await tx
          .update(sourceRuns)
          .set({
            estimatedCostUsd: sql`${sourceRuns.estimatedCostUsd} + ${input.estimatedCostUsd.toFixed(6)}`,
            updatedAt: new Date(),
          })
          .where(eq(sourceRuns.id, input.sourceRunId));
      }
      return {
        entry,
        created: true as const,
        committedCostUsd,
        projectedCostUsd,
        maximumCostUsd: input.maximumCostUsd,
      };
    });
  }

  /**
   * Reconciles a pre-call reservation with usage returned by that exact
   * provider attempt. Failed/aborted attempts without reported usage retain
   * their conservative estimate and are never mislabeled as settled actuals.
   */
  async settleEstimatedCost(input: {
    scanRunId: string;
    sourceRunId?: string;
    ledgerKey: string;
    provider: string;
    expectedOperation?: string;
    expectedUnitMetadata?: Record<string, number | string>;
    actualCostUsd?: number;
    quotaUnits: number;
    resultStatus: string;
    usageStatus?: "provider_reported_settled" | "model_reported_settled";
    usageMetadata?: Record<string, number | string>;
    occurredAt?: Date;
  }) {
    const normalizedLedgerKey = ledgerKey(input.ledgerKey);
    if (
      (input.actualCostUsd !== undefined && !validNonnegative(input.actualCostUsd)) ||
      !validNonnegative(input.quotaUnits)
    ) {
      throw new Error("Settled provider cost and quota values cannot be negative");
    }
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${input.scanRunId}, 0))`);
      const [existing] = await tx
        .select()
        .from(providerCostLedger)
        .where(
          and(
            eq(providerCostLedger.scanRunId, input.scanRunId),
            eq(providerCostLedger.ledgerKey, normalizedLedgerKey),
          ),
        )
        .for("update")
        .limit(1);
      if (!existing) throw new Error("A provider attempt cannot settle without a reservation");
      if (
        existing.sourceRunId !== (input.sourceRunId ?? null) ||
        existing.provider !== input.provider ||
        (input.expectedOperation !== undefined && existing.operation !== input.expectedOperation)
      ) {
        throw new Error("A cost reservation has a mismatched operation or source identity");
      }

      const existingMetadata = existing.unitMetadata ?? {};
      for (const [key, value] of Object.entries(input.expectedUnitMetadata ?? {})) {
        if (existingMetadata[key] !== value) {
          throw new Error("A cost reservation has mismatched unit metadata");
        }
      }
      for (const value of Object.values(input.usageMetadata ?? {})) {
        if (typeof value === "number" && !Number.isFinite(value)) {
          throw new Error("Settled usage metadata must be finite");
        }
      }
      const settledUsageStatus = input.usageStatus ?? "provider_reported_settled";
      const previouslySettled =
        typeof existingMetadata.usage_status === "string" &&
        existingMetadata.usage_status.endsWith("_reported_settled");
      const reportedActualCostUsd =
        input.actualCostUsd === undefined ? undefined : Number(input.actualCostUsd.toFixed(6));
      const normalizedQuotaUnits = Number(input.quotaUnits.toFixed(4));
      const nextActualCostUsd = reportedActualCostUsd ?? Number(existing.actualCostUsd);
      if (
        previouslySettled &&
        ((reportedActualCostUsd !== undefined &&
          Number(existing.actualCostUsd) !== reportedActualCostUsd) ||
          Number(existing.quotaUnits) !== normalizedQuotaUnits ||
          existingMetadata.usage_status !== settledUsageStatus ||
          existingMetadata.result_status !== input.resultStatus ||
          Object.entries(input.usageMetadata ?? {}).some(
            ([key, value]) => existingMetadata[key] !== value,
          ))
      ) {
        throw new Error("A settled cost reservation cannot be rewritten with different usage");
      }
      if (previouslySettled) {
        const [committed] = await tx
          .select({
            costUsd: sql<string>`coalesce(sum(greatest(${providerCostLedger.estimatedCostUsd}, ${providerCostLedger.actualCostUsd})), 0)`,
          })
          .from(providerCostLedger)
          .where(eq(providerCostLedger.scanRunId, input.scanRunId));
        return { entry: existing, committedCostUsd: Number(committed?.costUsd ?? 0) };
      }
      const actualDelta = nextActualCostUsd - Number(existing.actualCostUsd);
      const quotaDelta = normalizedQuotaUnits - Number(existing.quotaUnits);
      const usageStatus =
        previouslySettled || reportedActualCostUsd !== undefined
          ? settledUsageStatus
          : "unknown_not_settled";
      const [entry] = await tx
        .update(providerCostLedger)
        .set({
          actualCostUsd: nextActualCostUsd.toFixed(6),
          quotaUnits: normalizedQuotaUnits.toFixed(4),
          unitMetadata: {
            ...existingMetadata,
            ...(input.usageMetadata ?? {}),
            usage_status: usageStatus,
            result_status: redactSecrets(input.resultStatus).slice(0, 100),
          },
          occurredAt: input.occurredAt ?? existing.occurredAt,
        })
        .where(eq(providerCostLedger.id, existing.id))
        .returning();
      if (!entry) throw new Error("Could not settle the provider attempt reservation");

      if (actualDelta !== 0) {
        await tx
          .update(scanRuns)
          .set({
            actualCostUsd: sql`${scanRuns.actualCostUsd} + ${actualDelta.toFixed(6)}`,
            updatedAt: new Date(),
          })
          .where(eq(scanRuns.id, input.scanRunId));
      }
      if (input.sourceRunId && (actualDelta !== 0 || quotaDelta !== 0)) {
        await tx
          .update(sourceRuns)
          .set({
            actualCostUsd: sql`${sourceRuns.actualCostUsd} + ${actualDelta.toFixed(6)}`,
            quotaUsed: sql`${sourceRuns.quotaUsed} + ${quotaDelta.toFixed(4)}`,
            updatedAt: new Date(),
          })
          .where(eq(sourceRuns.id, input.sourceRunId));
      }
      const [committed] = await tx
        .select({
          costUsd: sql<string>`coalesce(sum(greatest(${providerCostLedger.estimatedCostUsd}, ${providerCostLedger.actualCostUsd})), 0)`,
        })
        .from(providerCostLedger)
        .where(eq(providerCostLedger.scanRunId, input.scanRunId));
      return { entry, committedCostUsd: Number(committed?.costUsd ?? 0) };
    });
  }

  async totalsForScan(scanRunId: string) {
    const [totals] = await this.db
      .select({
        estimatedCostUsd: sum(providerCostLedger.estimatedCostUsd),
        actualCostUsd: sum(providerCostLedger.actualCostUsd),
        quotaUnits: sum(providerCostLedger.quotaUnits),
      })
      .from(providerCostLedger)
      .where(eq(providerCostLedger.scanRunId, scanRunId));
    return {
      estimatedCostUsd: Number(totals?.estimatedCostUsd ?? 0),
      actualCostUsd: Number(totals?.actualCostUsd ?? 0),
      quotaUnits: Number(totals?.quotaUnits ?? 0),
    };
  }

  async listForScan(scanRunId: string) {
    return this.db
      .select()
      .from(providerCostLedger)
      .where(eq(providerCostLedger.scanRunId, scanRunId))
      .orderBy(asc(providerCostLedger.occurredAt));
  }

  async committedCostForScan(scanRunId: string): Promise<number> {
    const [total] = await this.db
      .select({
        costUsd: sql<string>`coalesce(sum(greatest(${providerCostLedger.estimatedCostUsd}, ${providerCostLedger.actualCostUsd})), 0)`,
      })
      .from(providerCostLedger)
      .where(eq(providerCostLedger.scanRunId, scanRunId));
    return Number(total?.costUsd ?? 0);
  }

  async ensureWithinScanLimit(
    scanRunId: string,
    additionalEstimatedCostUsd: number,
    maximumCostUsd: number,
  ) {
    if (!validNonnegative(additionalEstimatedCostUsd) || !validNonnegative(maximumCostUsd)) {
      throw new Error("Cost limits cannot be negative");
    }
    const totals = await this.totalsForScan(scanRunId);
    const projectedCostUsd = totals.estimatedCostUsd + additionalEstimatedCostUsd;
    if (projectedCostUsd > maximumCostUsd) {
      throw new ProviderCostLimitError(projectedCostUsd, maximumCostUsd);
    }
    return { ...totals, projectedCostUsd, maximumCostUsd };
  }
}

export class ScanCostLimitError extends Error {
  constructor(
    readonly projectedCostUsd: number,
    readonly maximumCostUsd: number,
  ) {
    super("The scan cost ceiling would be exceeded");
    this.name = "ScanCostLimitError";
  }
}

export class ProviderCostLimitError extends ScanCostLimitError {
  constructor(projectedCostUsd: number, maximumCostUsd: number) {
    super(projectedCostUsd, maximumCostUsd);
    this.name = "ProviderCostLimitError";
  }
}
