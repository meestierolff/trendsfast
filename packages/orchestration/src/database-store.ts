import { createPrefixedId } from "@trendsfast/core";
import { createRepositories, ProcessingFenceError } from "@trendsfast/database";
import {
  bindStoredEvidence,
  createInMemoryEvidenceStore,
  type StoredEvidenceSignal,
} from "@trendsfast/evidence";
import {
  fromStoredQueryPlan,
  PROVIDER_LIMITS,
  toStoredQueryPlan,
  type ProviderMeasurement,
  type ProviderRunResult,
  type ProviderSlug,
} from "@trendsfast/providers";
import { SignalSchema, type Signal, type SourceRunState } from "@trendsfast/schemas";
import { z } from "zod";

import {
  ScanAlreadyClaimedError,
  StaleProcessingClaimError,
  type ClaimedProcessing,
  type ProcessingClaimIdentity,
  type ProcessingStore,
} from "./state-machine";

type Repositories = ReturnType<typeof createRepositories>;

const ProviderMeasurementSchema = z
  .object({
    id: z.string().min(1).max(200),
    source: z.enum([
      "website",
      "google_trends",
      "hacker_news",
      "github",
      "x",
      "tavily",
      "youtube",
      "manual",
    ]),
    provider: z.string().min(1).max(200),
    queryId: z.string().min(1).max(200),
    kind: z.literal("EXTERNAL_TIME_SERIES"),
    label: z.string().min(1).max(500),
    points: z
      .array(
        z.object({
          at: z.string().datetime({ offset: true }),
          value: z.number().finite(),
        }),
      )
      .max(500),
    unit: z.literal("RELATIVE_INTEREST").optional(),
    requestId: z.string().min(1).max(200).optional(),
  })
  .strict();

const StoredProviderFragmentSchema = z
  .object({
    measurements: z.array(ProviderMeasurementSchema).max(50).default([]),
    limitations: z.array(z.string().max(2_000)).max(50).default([]),
    errors: z
      .array(
        z
          .object({
            code: z.string().max(100),
            message: z.string().max(500),
            retryable: z.boolean(),
          })
          .strict(),
      )
      .max(50)
      .default([]),
  })
  .strict();

function sourceState(result: ProviderRunResult): SourceRunState {
  if (result.status === "SUCCESS") return "SUCCEEDED";
  if (result.status === "BUDGET_EXCEEDED" || result.status === "CIRCUIT_OPEN") {
    return "SKIPPED";
  }
  if (result.signals.length > 0 || result.measurements.length > 0) return "DEGRADED";
  return "FAILED";
}

function storedSignal(
  row: Awaited<ReturnType<Repositories["scanData"]["listSignalsForRun"]>>[number],
): Signal {
  const { signal } = row;
  return SignalSchema.parse({
    id: signal.id,
    source: signal.source,
    sourceId: signal.sourceId,
    url: signal.canonicalUrl,
    ...(signal.title === null ? {} : { title: signal.title }),
    ...(signal.textExcerpt === null ? {} : { textExcerpt: signal.textExcerpt }),
    ...(signal.author === null ? {} : { author: signal.author }),
    ...(signal.publishedAt === null ? {} : { publishedAt: signal.publishedAt.toISOString() }),
    observedAt: signal.observedAt.toISOString(),
    ...(signal.language === null ? {} : { language: signal.language }),
    metrics: Object.fromEntries(
      Object.entries(signal.metrics).filter(
        (entry): entry is [string, number] => typeof entry[1] === "number",
      ),
    ) as StoredEvidenceSignal["metrics"],
    queryId: signal.queryId,
    provenance: {
      provider: signal.provider,
      ...(signal.providerRequestId === null ? {} : { requestId: signal.providerRequestId }),
      retrievedAt: signal.retrievedAt.toISOString(),
      cached: signal.cached,
      ...(signal.rawPayloadHash === null ? {} : { rawPayloadHash: signal.rawPayloadHash }),
    },
  });
}

function measurementFragment(value: unknown): ProviderMeasurement[] {
  const result = StoredProviderFragmentSchema.safeParse(value);
  if (!result.success) return [];
  return result.data.measurements.map((measurement) => ({
    id: measurement.id,
    source: measurement.source,
    provider: measurement.provider,
    queryId: measurement.queryId,
    kind: measurement.kind,
    label: measurement.label,
    points: measurement.points,
    ...(measurement.unit === undefined ? {} : { unit: measurement.unit }),
    ...(measurement.requestId === undefined ? {} : { requestId: measurement.requestId }),
  }));
}

function evidenceSignal(signal: Signal): StoredEvidenceSignal {
  return {
    id: signal.id,
    source: signal.source,
    sourceId: signal.sourceId,
    url: signal.url,
    ...(signal.title === undefined ? {} : { title: signal.title }),
    ...(signal.textExcerpt === undefined ? {} : { textExcerpt: signal.textExcerpt }),
    ...(signal.author === undefined
      ? {}
      : {
          author: {
            ...(signal.author.id === undefined ? {} : { id: signal.author.id }),
            ...(signal.author.handle === undefined ? {} : { handle: signal.author.handle }),
            ...(signal.author.displayName === undefined
              ? {}
              : { displayName: signal.author.displayName }),
            ...(signal.author.followerCount === undefined
              ? {}
              : { followerCount: signal.author.followerCount }),
          },
        }),
    ...(signal.publishedAt === undefined ? {} : { publishedAt: signal.publishedAt }),
    observedAt: signal.observedAt,
    ...(signal.language === undefined ? {} : { language: signal.language }),
    metrics: Object.fromEntries(
      Object.entries(signal.metrics).filter(
        (entry): entry is [string, number] => typeof entry[1] === "number",
      ),
    ) as StoredEvidenceSignal["metrics"],
    queryId: signal.queryId,
    provenance: {
      provider: signal.provenance.provider,
      ...(signal.provenance.requestId === undefined
        ? {}
        : { requestId: signal.provenance.requestId }),
      retrievedAt: signal.provenance.retrievedAt,
      cached: signal.provenance.cached,
      ...(signal.provenance.rawPayloadHash === undefined
        ? {}
        : { rawPayloadHash: signal.provenance.rawPayloadHash }),
    },
  };
}

async function sourceRunFor(repositories: Repositories, provider: ProviderSlug, scanRunId: string) {
  return repositories.scanData.createSourceRun({
    scanRunId,
    source: provider,
    provider,
    maxCalls: PROVIDER_LIMITS[provider].maxCalls,
  });
}

async function translateProcessingFence<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ProcessingFenceError) {
      throw new StaleProcessingClaimError(error.message);
    }
    throw error;
  }
}

async function fencedMutation<T>(
  repositories: Repositories,
  claim: ProcessingClaimIdentity,
  operation: (repositories: Repositories) => Promise<T>,
): Promise<T> {
  return translateProcessingFence(() =>
    repositories.scans.withProcessingFence(
      {
        requestId: claim.requestId,
        scanRunId: claim.runId,
        processingFence: claim.processingFence,
      },
      async (database) => operation(createRepositories(database)),
    ),
  );
}

/**
 * Bridges the pure, dependency-injected scan state machine to Postgres. Every
 * externally visible artifact is reconstructed from persisted rows, so retries
 * never rely on process memory and evidence can only point at stored signals.
 */
export function createDatabaseProcessingStore(repositories: Repositories): ProcessingStore {
  return {
    async load(publicId) {
      const request = await repositories.scans.getByPublicId(publicId);
      if (!request) return null;
      return {
        requestId: request.id,
        publicId: request.publicId,
        url: request.submittedUrl,
        state: request.state,
        ...(request.market === null ? {} : { market: request.market }),
        ...(request.language === null ? {} : { language: request.language }),
      };
    },

    async claim(snapshot, deadline) {
      const claimed = await repositories.scans.claimForProcessing(snapshot.publicId, deadline);
      if (!claimed.claimed || !claimed.run) {
        throw new ScanAlreadyClaimedError(claimed.claimStatus);
      }
      const contextRow = claimed.run.projectContextVersionId
        ? await repositories.scanData.getContextForRun(claimed.run.id)
        : null;
      const [sourceRuns, committedCostUsd] = await Promise.all([
        repositories.scanData.listSourceRuns(claimed.run.id),
        repositories.costs.committedCostForScan(claimed.run.id),
      ]);
      if (!claimed.run.processingFence) {
        throw new Error("A claimed scan run is missing its processing fence");
      }
      const result: ClaimedProcessing = {
        requestId: claimed.request.id,
        runId: claimed.run.id,
        processingFence: claimed.run.processingFence,
        state: "RUNNING",
        sourceStates: Object.fromEntries(
          sourceRuns.map((sourceRun) => [sourceRun.source, sourceRun.state]),
        ),
        spentUsd: committedCostUsd,
        ...(claimed.run.hardDeadlineAt === null
          ? {}
          : { hardDeadlineAt: claimed.run.hardDeadlineAt }),
      };
      if (contextRow) {
        result.context = contextRow.contextVersion.context;
        result.contextVersionId = contextRow.contextVersion.id;
      }
      if (claimed.run.queryPlan) {
        result.queryPlan = fromStoredQueryPlan(claimed.run.queryPlan);
      }
      return result;
    },

    async saveContext(ids, context) {
      return fencedMutation(repositories, ids, async (fenced) => {
        const project = await fenced.scanData.upsertProject({
          url: context.url,
          name: context.name,
        });
        const version = await fenced.scanData.addProjectContext({
          projectId: project.id,
          context,
          promptVersion: "product-context-v1",
          createdBy: "scan-orchestrator",
        });
        await fenced.scanData.attachProject({
          scanRequestId: ids.requestId,
          projectId: project.id,
          projectContextVersionId: version.id,
        });
        return { contextVersionId: version.id };
      });
    },

    async saveQueryPlan(ids, plan) {
      await fencedMutation(repositories, ids, async (fenced) => {
        const context = await fenced.scanData.getContextForRun(ids.runId);
        if (!context)
          throw new Error("A persisted project context is required before query planning");
        const stored = toStoredQueryPlan(plan, {
          id: createPrefixedId("query_plan"),
          projectContextVersionId: context.contextVersion.id,
        });
        const updated = await fenced.scanData.setQueryPlan(ids.runId, stored);
        if (!updated) throw new Error("The scan run disappeared while saving its query plan");
      });
    },

    async beginProvider(provider, ids) {
      await fencedMutation(repositories, ids, async (fenced) => {
        const run = await sourceRunFor(fenced, provider, ids.runId);
        await fenced.scanData.updateSourceRun({
          sourceRunId: run.id,
          state: "RUNNING",
          callsMade: run.callsMade,
          candidateCount: run.candidateCount,
        });
      });
    },

    async reserveProviderAttempt(ids, reservation, maximumCostUsd) {
      if (!Number.isInteger(reservation.attempt) || reservation.attempt < 1) {
        throw new Error("Provider attempt reservations require a positive attempt number");
      }
      return fencedMutation(repositories, ids, async (fenced) => {
        const run = await sourceRunFor(fenced, reservation.provider, ids.runId);
        return fenced.costs.reserveEstimatedCost({
          scanRunId: ids.runId,
          sourceRunId: run.id,
          ledgerKey: `provider:${reservation.provider}:${run.id}:collect:attempt:${reservation.attempt}`,
          provider: reservation.provider,
          operation: `collect:attempt:${reservation.attempt}`,
          estimatedCostUsd: reservation.estimatedCostUsd,
          maximumCostUsd,
          unitMetadata: {
            accounting: "conservative_pre_call_reservation",
            usage_status: "unknown_not_settled",
            attempt: reservation.attempt,
            estimated_calls: reservation.calls,
            estimated_quota_units: reservation.quotaUnits,
          },
        });
      });
    },

    async settleProviderAttempt(ids, settlement) {
      if (!Number.isInteger(settlement.attempt) || settlement.attempt < 1) {
        throw new Error("Provider attempt settlements require a positive attempt number");
      }
      return fencedMutation(repositories, ids, async (fenced) => {
        const run = await sourceRunFor(fenced, settlement.provider, ids.runId);
        return fenced.costs.settleEstimatedCost({
          scanRunId: ids.runId,
          sourceRunId: run.id,
          ledgerKey: `provider:${settlement.provider}:${run.id}:collect:attempt:${settlement.attempt}`,
          provider: settlement.provider,
          expectedOperation: `collect:attempt:${settlement.attempt}`,
          expectedUnitMetadata: { attempt: settlement.attempt },
          ...(settlement.actualCostUsd === undefined
            ? {}
            : { actualCostUsd: settlement.actualCostUsd }),
          quotaUnits: settlement.actualQuotaUnits,
          resultStatus: settlement.status,
          occurredAt: new Date(settlement.finishedAt),
        });
      });
    },

    async completeProvider(provider, ids, result) {
      if (result.provider !== provider) {
        throw new Error("A provider result cannot be persisted under a different source");
      }
      await fencedMutation(repositories, ids, async (fenced) => {
        const run = await sourceRunFor(fenced, provider, ids.runId);
        for (const signal of result.signals) {
          await fenced.scanData.upsertSignal(run.id, SignalSchema.parse(signal));
        }
        await fenced.scanData.updateSourceRun({
          sourceRunId: run.id,
          state: sourceState(result),
          callsMade: result.calls,
          candidateCount: result.signals.length,
          durationMs: Math.max(
            0,
            new Date(result.finishedAt).getTime() - new Date(result.startedAt).getTime(),
          ),
          providerPayloadFragment: {
            measurements: result.measurements.slice(0, 50),
            limitations: result.limitations.slice(0, 50),
            errors: result.errors.slice(0, 50),
          },
        });
      });
    },

    async failProvider(provider, ids, input) {
      await fencedMutation(repositories, ids, async (fenced) => {
        const run = await sourceRunFor(fenced, provider, ids.runId);
        await fenced.scanData.updateSourceRun({
          sourceRunId: run.id,
          state: input.skipped ? "SKIPPED" : "FAILED",
          callsMade: run.callsMade,
          candidateCount: run.candidateCount,
          failureCode: input.code,
          failureMessage: input.message,
        });
      });
    },

    async reserveModelCost(ids, reservation, maximumCostUsd) {
      const expectedLedgerKey = `model:${reservation.operation}:attempt:${reservation.attempt}`;
      if (reservation.ledgerKey !== expectedLedgerKey) {
        throw new Error("A model cost reservation requires its exact operation-attempt ledger key");
      }
      return fencedMutation(repositories, ids, (fenced) =>
        fenced.costs.reserveEstimatedCost({
          scanRunId: ids.runId,
          ledgerKey: reservation.ledgerKey,
          provider: reservation.provider,
          operation: `model:${reservation.operation}:attempt:${reservation.attempt}`,
          estimatedCostUsd: reservation.estimatedCostUsd,
          maximumCostUsd,
          unitMetadata: {
            accounting: "conservative_pre_call_reservation",
            usage_status: "unknown_not_settled",
            model: reservation.model,
            input_bytes: reservation.inputBytes,
            input_token_upper_bound: reservation.inputTokenUpperBound,
            output_token_upper_bound: reservation.outputTokenUpperBound,
            input_price_usd_per_million_tokens: reservation.inputUsdPerMillionTokens,
            output_price_usd_per_million_tokens: reservation.outputUsdPerMillionTokens,
          },
        }),
      );
    },

    async settleModelCost(ids, settlement) {
      const expectedLedgerKey = `model:${settlement.operation}:attempt:${settlement.attempt}`;
      if (settlement.ledgerKey !== expectedLedgerKey) {
        throw new Error("A model cost settlement requires its exact operation-attempt ledger key");
      }
      if (
        !Number.isSafeInteger(settlement.inputTokens) ||
        settlement.inputTokens < 0 ||
        !Number.isSafeInteger(settlement.outputTokens) ||
        settlement.outputTokens < 0
      ) {
        throw new Error("A model cost settlement requires non-negative integer token usage");
      }
      const finishedAt = new Date(settlement.finishedAt);
      if (!Number.isFinite(finishedAt.getTime())) {
        throw new Error("A model cost settlement requires a valid completion time");
      }
      return fencedMutation(repositories, ids, (fenced) =>
        fenced.costs.settleEstimatedCost({
          scanRunId: ids.runId,
          ledgerKey: settlement.ledgerKey,
          provider: settlement.provider,
          expectedOperation: `model:${settlement.operation}:attempt:${settlement.attempt}`,
          expectedUnitMetadata: { model: settlement.model },
          actualCostUsd: settlement.actualCostUsd,
          quotaUnits: settlement.inputTokens + settlement.outputTokens,
          resultStatus: "SUCCESS",
          usageStatus: "model_reported_settled",
          usageMetadata: {
            reported_input_tokens: settlement.inputTokens,
            reported_output_tokens: settlement.outputTokens,
            reported_total_tokens: settlement.inputTokens + settlement.outputTokens,
          },
          occurredAt: finishedAt,
        }),
      );
    },

    async loadCollectedData(scanRunId) {
      const [signalRows, sourceRuns] = await Promise.all([
        repositories.scanData.listSignalsForRun(scanRunId),
        repositories.scanData.listSourceRuns(scanRunId),
      ]);
      return {
        signals: signalRows.map(storedSignal),
        measurements: sourceRuns.flatMap((run) => measurementFragment(run.providerPayloadFragment)),
        coverage: Object.fromEntries(sourceRuns.map((run) => [run.source, run.state])),
      };
    },

    async saveDraft(ids, draft) {
      return fencedMutation(repositories, ids, async (repositories) => {
        const signalRows = await repositories.scanData.listSignalsForRun(ids.runId);
        const signals = signalRows.map(storedSignal);
        const allowedSignalIds = new Set(signals.map((signal) => signal.id));
        const evidenceSignalIds = [...new Set(draft.evidenceSignalIds)];
        const reasonBySignalId = Object.fromEntries(
          evidenceSignalIds.map((id) => [id, draft.whyNow]),
        );
        const supportBySignalId = Object.fromEntries(evidenceSignalIds.map((id) => [id, true]));
        const bound = await bindStoredEvidence({
          modelOutput: { evidenceSignalIds },
          store: createInMemoryEvidenceStore(signals.map(evidenceSignal)),
          allowedSignalIds,
          reasonBySignalId,
          supportBySignalId,
        });

        const cluster = evidenceSignalIds.length
          ? await repositories.scanData.createCluster({
              scanRunId: ids.runId,
              dedupeKey: `decision:${[...evidenceSignalIds].sort().join(":")}`,
              topic: draft.move.topic,
              summary: draft.whyNow,
              signalClass: draft.signalClass,
              independentSourceCount: draft.independentSourceCount,
              saturation: draft.saturation,
              scoreComponents: {
                priority: draft.move.priority / 100,
                confidence: draft.move.confidence,
              },
              members: evidenceSignalIds.map((signalId, index) => ({
                signalId,
                similarity: 1,
                isPrimary: index === 0,
              })),
            })
          : null;
        const opportunity = await repositories.scanData.createOpportunity({
          scanRunId: ids.runId,
          ...(cluster ? { clusterId: cluster.cluster.id } : {}),
          rank: 1,
          actionCandidate: draft.move.action,
          channel: draft.move.channel,
          format: draft.move.format,
          totalScore: draft.move.priority / 100,
          scoreComponents: {
            priority: draft.move.priority / 100,
            confidence: draft.move.confidence,
          },
          passesQualityFloor: draft.move.action !== "WAIT",
          ...(draft.move.action === "WAIT" && draft.confidenceRationale
            ? { rejectionReason: draft.confidenceRationale }
            : {}),
          validUntil: new Date(draft.move.validUntil),
          scoreVersion: draft.scoreVersion,
        });
        const move = await repositories.scanData.createDraftNextMove({
          scanRequestId: ids.requestId,
          scanRunId: ids.runId,
          projectContextVersionId: ids.contextVersionId,
          opportunityId: opportunity.id,
          move: draft.move,
          whyNow: draft.whyNow,
          signalClass: draft.signalClass,
          independentSourceCount: draft.independentSourceCount,
          saturation: draft.saturation,
          limitations: draft.limitations,
          ...(draft.confidenceRationale ? { confidenceRationale: draft.confidenceRationale } : {}),
          promptVersion: draft.promptVersion,
          scoreVersion: draft.scoreVersion,
        });
        for (const receipt of bound.evidence) {
          await repositories.scanData.bindEvidence({
            nextMoveId: move.id,
            signalId: receipt.signalId,
            reason: receipt.reason,
            verified: false,
          });
        }
        const sourceRuns = await repositories.scanData.listSourceRuns(ids.runId);
        await repositories.scanData.updateRunSummary(ids.runId, {
          scoreVersion: draft.scoreVersion,
          promptVersion: draft.promptVersion,
          modelOutput: {
            action: draft.move.action,
            channel: draft.move.channel,
            topic: draft.move.topic,
            angle: draft.move.angle,
            format: draft.move.format,
            evidenceSignalIds,
          },
          sourceCoverage: Object.fromEntries(
            sourceRuns.map((sourceRun) => [sourceRun.source, sourceRun.state]),
          ),
          signalClass: draft.signalClass,
        });
        return { nextMoveId: move.id };
      });
    },

    async requireReview(ids, signalClass) {
      await translateProcessingFence(() =>
        repositories.scans.requireReview({
          requestId: ids.requestId,
          scanRunId: ids.runId,
          processingFence: ids.processingFence,
          signalClass,
        }),
      );
    },

    async failScan(ids, code, message) {
      if (!("runId" in ids)) return;
      await translateProcessingFence(() =>
        repositories.scans.failProcessing({
          requestId: ids.requestId,
          scanRunId: ids.runId,
          processingFence: ids.processingFence,
          code,
          message,
        }),
      );
    },
  };
}
