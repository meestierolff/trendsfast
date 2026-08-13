import "server-only";

import type { createRepositories } from "@trendsfast/database";
import { measurementFragment } from "@trendsfast/orchestration";

import { deploymentProvenance } from "./deployment-provenance";
import { exportReviewBundle, type ReviewBundle } from "./review-bundle";

type Repositories = ReturnType<typeof createRepositories>;

type CostEntryForSettlement = {
  actualCostUsd: string | number;
  unitMetadata: Record<string, number | string> | null;
};

function settledUsageStatus(entry: CostEntryForSettlement): boolean {
  const status = entry.unitMetadata?.usage_status;
  return status === "provider_reported_settled" || status === "model_reported_settled";
}

export function settledActualCostForEntries(
  entries: readonly CostEntryForSettlement[],
): number | null {
  if (entries.length === 0 || entries.some((entry) => !settledUsageStatus(entry))) return null;
  return entries.reduce((total, entry) => total + Number(entry.actualCostUsd), 0);
}

function safeFragment(value: unknown): { measurements: unknown[]; limitations: string[] } {
  if (!value || typeof value !== "object") return { measurements: [], limitations: [] };
  const record = value as Record<string, unknown>;
  return {
    measurements: Array.isArray(record.measurements) ? record.measurements.slice(0, 50) : [],
    limitations: Array.isArray(record.limitations)
      ? record.limitations.filter((item): item is string => typeof item === "string").slice(0, 50)
      : [],
  };
}

function independenceKey(source: string, canonicalUrl: string): string {
  const host = new URL(canonicalUrl).hostname.toLowerCase().replace(/^www\./, "");
  if (source === "x" || host === "x.com" || host === "twitter.com") return "platform:x";
  if (source === "hacker_news" || host === "news.ycombinator.com") {
    return "platform:hacker_news";
  }
  if (source === "github" || host === "github.com") return "platform:github";
  if (source === "youtube" || host === "youtube.com" || host === "youtu.be") {
    return "platform:youtube";
  }
  if (source === "google_trends" || host === "trends.google.com") {
    return "platform:google_trends";
  }
  if (source === "reddit" || host === "reddit.com" || host.endsWith(".reddit.com")) {
    return "platform:reddit";
  }
  return `domain:${host}`;
}

function iso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

export async function buildReviewBundle(
  repositories: Repositories,
  scanPublicId: string,
  now = new Date(),
  options: { includePrivateCosts?: boolean } = {},
): Promise<ReviewBundle | null> {
  const detail = await repositories.scans.getStatusByPublicId(scanPublicId);
  if (!detail?.run || !detail.move || !detail.project || !detail.context) return null;
  const [
    sourceRuns,
    signalRows,
    snapshots,
    clusters,
    opportunities,
    costTotals,
    costEntries,
    contextVersions,
    evidenceHistory,
    proposalRevisions,
    reviewEvents,
  ] = await Promise.all([
    repositories.scanData.listSourceRuns(detail.run.id),
    repositories.scanData.listSignalsForRun(detail.run.id),
    repositories.scanData.listMetricSnapshotsForRun(detail.run.id),
    repositories.scanData.listClustersForRun(detail.run.id),
    repositories.scanData.listOpportunitiesForRun(detail.run.id),
    repositories.costs.totalsForScan(detail.run.id),
    repositories.costs.listForScan(detail.run.id),
    repositories.reviews.listContextVersions(detail.project.id),
    repositories.reviews.listEvidenceHistory(detail.move.id),
    repositories.reviews.listRevisions(detail.move.id),
    repositories.reviews.listEvents(detail.request.id),
  ]);
  const signalById = new Map(signalRows.map(({ signal }) => [signal.id, signal]));
  const snapshotsBySignal = new Map<string, unknown[]>();
  for (const { snapshot } of snapshots) {
    const values = snapshotsBySignal.get(snapshot.signalId) ?? [];
    values.push({ at: snapshot.observedAt.toISOString(), metrics: snapshot.metrics });
    snapshotsBySignal.set(snapshot.signalId, values);
  }
  const externalMeasurements = sourceRuns.flatMap((run) =>
    measurementFragment(run.providerPayloadFragment),
  );
  const provenance = deploymentProvenance();
  const modelNames = costEntries.flatMap((entry) => {
    const value = entry.unitMetadata?.model;
    return typeof value === "string" ? [value] : [];
  });
  const opportunity = detail.move.opportunityId
    ? opportunities.find((candidate) => candidate.id === detail.move!.opportunityId)
    : undefined;

  const bundle: ReviewBundle = {
    generatedAt: now.toISOString(),
    release: {
      sha: provenance.releaseSha,
      environment: provenance.deploymentEnvironment,
      host: provenance.deploymentHost,
      deploymentId: provenance.deploymentId,
    },
    scan: {
      id: detail.request.id,
      productUrl: detail.request.submittedUrl,
      state: detail.request.state,
    },
    context: {
      current: detail.context,
      corrections: contextVersions.slice(1).map((version) => ({
        version: version.version,
        createdBy: version.createdBy,
        createdAt: version.createdAt.toISOString(),
        context: version.context,
      })),
    },
    queryPlan: detail.run.queryPlan,
    providerRuns: sourceRuns.map((run) => {
      const fragment = safeFragment(run.providerPayloadFragment);
      const runCostEntries = costEntries.filter((entry) => entry.sourceRunId === run.id);
      const measurements = measurementFragment(run.providerPayloadFragment).map((measurement) => ({
        id: measurement.id,
        source: measurement.source,
        provider: measurement.provider,
        queryId: measurement.queryId,
        kind: measurement.kind,
        label: measurement.label,
        points: measurement.points,
        unit: measurement.unit ?? null,
      }));
      return {
        source: run.source,
        provider: run.provider,
        state: run.state,
        latencyMs: run.durationMs,
        calls: run.callsMade,
        maxCalls: run.maxCalls,
        quota: Number(run.quotaUsed),
        estimatedCostUsd: Number(run.estimatedCostUsd),
        settledActualCostUsd: settledActualCostForEntries(runCostEntries),
        measurements,
        limitations: fragment.limitations,
      };
    }),
    cost: {
      estimatedUsd: costTotals.estimatedCostUsd,
      settledActualUsd: settledActualCostForEntries(costEntries),
      quota: costTotals.quotaUnits,
      attempts: costEntries.map((entry) => {
        const usageStatus = String(entry.unitMetadata?.usage_status ?? "unknown_not_settled");
        return {
          provider: entry.provider,
          operation: entry.operation,
          estimatedCostUsd: Number(entry.estimatedCostUsd),
          settledActualCostUsd: settledUsageStatus(entry) ? Number(entry.actualCostUsd) : null,
          quota: Number(entry.quotaUnits),
          usageStatus,
          occurredAt: entry.occurredAt.toISOString(),
        };
      }),
    },
    evidence: evidenceHistory.map((receipt) => {
      const signal = signalById.get(receipt.signalId);
      const series = [
        ...(snapshotsBySignal.get(receipt.signalId) ?? []),
        ...externalMeasurements
          .filter((measurement) => measurement.queryId === signal?.queryId)
          .map((measurement) => ({
            kind: measurement.kind,
            label: measurement.label,
            unit: measurement.unit ?? null,
            points: measurement.points,
          })),
      ];
      return {
        id: receipt.id,
        signalId: receipt.signalId,
        moveVersion: receipt.moveVersion,
        source: receipt.source,
        provider: receipt.provider,
        canonicalUrl: receipt.canonicalUrl,
        title: receipt.title,
        excerpt: signal?.textExcerpt?.slice(0, 800) ?? null,
        visibleMetrics: signal?.metrics ?? {},
        measurementSeries: series,
        independenceKey: independenceKey(receipt.source, receipt.canonicalUrl),
        observedAt: receipt.observedAt.toISOString(),
        publishedAt: iso(receipt.publishedAt),
        reason: receipt.reason,
        role: receipt.bindingRole,
        verified: receipt.verified,
        availability: receipt.availability,
        reviewedBy: receipt.reviewedBy,
        verifiedAt: iso(receipt.verifiedAt),
      };
    }),
    clusters: clusters.map((cluster) => ({
      id: cluster.id,
      topic: cluster.topic,
      summary: cluster.summary,
      signalClass: cluster.signalClass,
      independentSourceCount: cluster.independentSourceCount,
      saturation: cluster.saturation,
      scoreComponents: cluster.scoreComponents,
    })),
    opportunities: opportunities.map((candidate) => ({
      id: candidate.id,
      moveVersion: candidate.moveVersion,
      rank: candidate.rank,
      action: candidate.actionCandidate,
      channel: candidate.channel,
      format: candidate.format,
      totalScore: Number(candidate.totalScore),
      scoreComponents: candidate.scoreComponents,
      passesQualityFloor: candidate.passesQualityFloor,
      rejectionReason: candidate.rejectionReason,
      scoreVersion: candidate.scoreVersion,
    })),
    qualityFloor: {
      passed: opportunity?.passesQualityFloor ?? false,
      reasons: opportunity?.rejectionReason ? [opportunity.rejectionReason] : [],
    },
    nextMove: {
      action: detail.move.action,
      channel: detail.move.channel,
      topic: detail.move.topic,
      angle: detail.move.angle,
      format: detail.move.format,
      hook: detail.move.hook,
      outline: detail.move.outline,
      cta: detail.move.cta,
      whyNow: detail.move.whyNow,
      priority: detail.move.priority,
      confidence: Number(detail.move.confidence),
      confidenceRationale: detail.move.confidenceRationale,
      signalClass: detail.move.signalClass,
      independentSourceCount: detail.move.independentSourceCount,
      limitations: detail.move.limitations,
      validUntil: detail.move.validUntil.toISOString(),
      state: detail.move.state,
      founderReviewed: detail.move.founderReviewed,
      autoPublish: detail.move.autoPublish,
      reviewVersion: detail.move.reviewVersion,
      proposalStale: detail.move.proposalStale,
    },
    versions: {
      model: [...new Set(modelNames)].join(", ") || contextVersions.at(-1)?.model || null,
      prompt: detail.move.promptVersion ?? detail.run.promptVersion,
      score: detail.move.scoreVersion ?? detail.run.scoreVersion,
    },
    proposalRevisions: proposalRevisions.map((revision) => ({
      version: revision.version,
      changeKind: revision.changeKind,
      reviewer: revision.reviewerId,
      reason: revision.reason,
      promptVersion: revision.promptVersion,
      scoreVersion: revision.scoreVersion,
      retainedEvidenceIds: revision.retainedEvidenceIds,
      before: revision.before,
      after: revision.after,
      occurredAt: revision.createdAt.toISOString(),
    })),
    reviewEvents: reviewEvents.map((event) => ({
      action: event.action,
      reviewer: event.reviewerId,
      before: event.before,
      after: event.after,
      reason: event.note,
      occurredAt: event.createdAt.toISOString(),
    })),
  };
  return exportReviewBundle(bundle, options);
}
