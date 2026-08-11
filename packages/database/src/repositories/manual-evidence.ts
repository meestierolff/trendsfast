import { and, count, desc, eq } from "drizzle-orm";

import { redactRecord, redactSecrets } from "@trendsfast/core";
import { SignalSchema, type Signal } from "@trendsfast/schemas";

import type { TrendsFastDatabase } from "../client";
import {
  evidenceReceipts,
  nextMoves,
  providerVerificationRecords,
  reviewEvents,
  scanRequests,
  scanRuns,
  signalMetricSnapshots,
  signals,
  sourceRuns,
} from "../schema";

export class ManualEvidenceStateError extends Error {
  constructor() {
    super("Manual evidence can only be added to a draft awaiting founder review");
    this.name = "ManualEvidenceStateError";
  }
}

const SECRET_QUERY_PARAMETER =
  /(^|[_-])(api[_-]?key|access[_-]?token|token|secret|password|signature|sig|credential|authorization|auth)($|[_-])/i;

function safeCanonicalEvidenceUrl(value: string): string {
  const url = new URL(value);
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    value.length > 2_048
  ) {
    throw new Error("Manual evidence URL is invalid");
  }
  if (redactSecrets(url.pathname) !== url.pathname) {
    throw new Error("Manual evidence URL path must not contain secret material");
  }
  for (const [name, parameterValue] of [...url.searchParams.entries()]) {
    if (SECRET_QUERY_PARAMETER.test(name) || redactSecrets(parameterValue) !== parameterValue) {
      throw new Error("Manual evidence URL must not contain secret-bearing query parameters");
    }
  }
  url.hash = "";
  return url.href;
}

/**
 * Persists one already-normalized manual-provider signal and binds the receipt
 * to that exact stored row in the same transaction. Callers cannot inject a
 * model-supplied URL directly into evidence_receipts.
 */
export class ManualEvidenceRepository {
  constructor(private readonly db: TrendsFastDatabase) {}

  async add(input: {
    scanPublicId: string;
    signal: Signal;
    reason: string;
    sourceLabel: string;
    reviewerId: string;
    observedAt?: Date;
    deployment: {
      deploymentEnvironment: "local" | "preview" | "production";
      releaseSha: string | null;
      deploymentHost: string | null;
      deploymentId: string | null;
    };
  }) {
    const signal = SignalSchema.parse(input.signal);
    if (signal.source !== "manual" || signal.provenance.provider !== "MANUAL_FOUNDER_EVIDENCE") {
      throw new Error("Manual evidence must come from the manual founder evidence adapter");
    }
    const canonicalUrl = safeCanonicalEvidenceUrl(signal.url);
    const reason = redactSecrets(input.reason).trim().slice(0, 1_000);
    const sourceLabel = redactSecrets(input.sourceLabel).trim().slice(0, 100);
    const reviewerId = redactSecrets(input.reviewerId).trim().slice(0, 160);
    if (!reason || !sourceLabel || !reviewerId) {
      throw new Error("Manual evidence metadata is incomplete");
    }
    const now = input.observedAt ?? new Date();

    return this.db.transaction(async (tx) => {
      const [record] = await tx
        .select({ request: scanRequests, run: scanRuns, move: nextMoves })
        .from(scanRequests)
        .innerJoin(scanRuns, eq(scanRuns.scanRequestId, scanRequests.id))
        .innerJoin(nextMoves, eq(nextMoves.scanRunId, scanRuns.id))
        .where(eq(scanRequests.publicId, input.scanPublicId))
        .orderBy(desc(scanRuns.attempt))
        .for("update")
        .limit(1);
      if (
        !record ||
        record.request.state !== "REVIEW_REQUIRED" ||
        record.run.state !== "REVIEW_REQUIRED" ||
        record.move.state !== "DRAFT" ||
        record.move.autoPublish
      ) {
        throw new ManualEvidenceStateError();
      }

      const [createdSourceRun] = await tx
        .insert(sourceRuns)
        .values({
          scanRunId: record.run.id,
          source: "manual",
          provider: "manual",
          state: "SUCCEEDED",
          maxCalls: 0,
          callsMade: 0,
          candidateCount: 0,
          estimatedCostUsd: "0",
          actualCostUsd: "0",
          quotaUsed: "0",
          providerPayloadFragment: {
            limitations: [
              "Founder-entered public evidence is supplemental and does not alter the synthesized decision or its independent-source count.",
            ],
          },
          startedAt: now,
          completedAt: now,
        })
        .onConflictDoNothing()
        .returning();
      const sourceRun =
        createdSourceRun ??
        (
          await tx
            .select()
            .from(sourceRuns)
            .where(
              and(
                eq(sourceRuns.scanRunId, record.run.id),
                eq(sourceRuns.source, "manual"),
                eq(sourceRuns.provider, "manual"),
              ),
            )
            .limit(1)
        )[0];
      if (!sourceRun) throw new Error("Could not create manual source run");

      const [storedSignal] = await tx
        .insert(signals)
        .values({
          sourceRunId: sourceRun.id,
          source: signal.source,
          sourceId: signal.sourceId,
          canonicalUrl,
          title: signal.title ? redactSecrets(signal.title) : null,
          textExcerpt: signal.textExcerpt ? redactSecrets(signal.textExcerpt) : null,
          author: signal.author ?? null,
          publishedAt: signal.publishedAt ? new Date(signal.publishedAt) : null,
          observedAt: new Date(signal.observedAt),
          language: signal.language ?? null,
          metrics: signal.metrics,
          queryId: signal.queryId,
          provider: signal.provenance.provider,
          providerRequestId: signal.provenance.requestId ?? null,
          retrievedAt: new Date(signal.provenance.retrievedAt),
          cached: false,
          rawPayloadHash: signal.provenance.rawPayloadHash ?? null,
          provenance: signal.provenance,
        })
        .onConflictDoUpdate({
          target: [signals.sourceRunId, signals.source, signals.sourceId],
          set: {
            canonicalUrl,
            title: signal.title ? redactSecrets(signal.title) : null,
            textExcerpt: signal.textExcerpt ? redactSecrets(signal.textExcerpt) : null,
            author: signal.author ?? null,
            publishedAt: signal.publishedAt ? new Date(signal.publishedAt) : null,
            observedAt: new Date(signal.observedAt),
            metrics: signal.metrics,
            provider: signal.provenance.provider,
            providerRequestId: signal.provenance.requestId ?? null,
            retrievedAt: new Date(signal.provenance.retrievedAt),
            cached: false,
            rawPayloadHash: signal.provenance.rawPayloadHash ?? null,
            provenance: signal.provenance,
          },
        })
        .returning();
      if (!storedSignal) throw new Error("Could not store manual evidence signal");

      await tx
        .insert(signalMetricSnapshots)
        .values({
          signalId: storedSignal.id,
          observedAt: storedSignal.observedAt,
          metrics: storedSignal.metrics,
        })
        .onConflictDoUpdate({
          target: [signalMetricSnapshots.signalId, signalMetricSnapshots.observedAt],
          set: { metrics: storedSignal.metrics },
        });

      const [receipt] = await tx
        .insert(evidenceReceipts)
        .values({
          nextMoveId: record.move.id,
          signalId: storedSignal.id,
          source: storedSignal.source,
          provider: storedSignal.provider,
          canonicalUrl: storedSignal.canonicalUrl,
          title: storedSignal.title,
          publishedAt: storedSignal.publishedAt,
          observedAt: storedSignal.observedAt,
          reason,
          bindingRole: "SUPPLEMENTAL",
          verified: false,
          availability: "AVAILABLE",
          reviewedBy: reviewerId,
          verifiedAt: null,
        })
        .onConflictDoUpdate({
          target: [evidenceReceipts.nextMoveId, evidenceReceipts.signalId],
          set: {
            canonicalUrl: storedSignal.canonicalUrl,
            title: storedSignal.title,
            publishedAt: storedSignal.publishedAt,
            observedAt: storedSignal.observedAt,
            reason,
            bindingRole: "SUPPLEMENTAL",
            verified: false,
            availability: "AVAILABLE",
            reviewedBy: reviewerId,
            verifiedAt: null,
          },
        })
        .returning();
      if (!receipt) throw new Error("Could not bind manual evidence receipt");

      const [candidateCount] = await tx
        .select({ value: count() })
        .from(signals)
        .where(eq(signals.sourceRunId, sourceRun.id));
      await tx
        .update(sourceRuns)
        .set({
          state: "SUCCEEDED",
          candidateCount: candidateCount?.value ?? 1,
          failureCode: null,
          failureMessage: null,
          completedAt: now,
          updatedAt: now,
        })
        .where(eq(sourceRuns.id, sourceRun.id));

      const [event] = await tx
        .insert(reviewEvents)
        .values({
          scanRequestId: record.request.id,
          scanRunId: record.run.id,
          nextMoveId: record.move.id,
          action: "MANUAL_EVIDENCE_ADDED",
          reviewerId,
          after: redactRecord({
            signalId: storedSignal.id,
            receiptId: receipt.id,
            sourceLabel,
            canonicalUrl: storedSignal.canonicalUrl,
            provider: storedSignal.provider,
          }),
          note: reason,
        })
        .returning();
      if (!event) throw new Error("Could not audit manual evidence entry");

      await tx.insert(providerVerificationRecords).values({
        source: "manual",
        provider: "MANUAL_FOUNDER_EVIDENCE",
        state: "DEGRADED",
        credentialMode: "none",
        deploymentEnvironment: input.deployment.deploymentEnvironment,
        releaseSha: input.deployment.releaseSha,
        deploymentHost: input.deployment.deploymentHost,
        deploymentId: input.deployment.deploymentId,
        healthStatus: "HEALTHY",
        readbackVerified: false,
        // This global capability record must never retain customer-specific evidence URLs.
        // The exact URL remains bound to the scan's signal/receipt and review audit only.
        canonicalUrls: [],
        latencyMs: 0,
        estimatedCostUsd: "0",
        actualCostUsd: "0",
        quotaUsed: "0",
        limitations: [
          "Founder-entered public evidence is supplemental until synthesis is recomputed and rebound; it cannot qualify approval or alter decision counts.",
        ],
        initiatedBy: reviewerId,
        startedAt: now,
        checkedAt: now,
        completedAt: now,
      });

      return { signal: storedSignal, receipt, event, sourceRun };
    });
  }
}
