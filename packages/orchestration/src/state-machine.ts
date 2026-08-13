import type {
  ContentCapabilities,
  ContentCapabilityName,
  GenerationLevel,
  NextMove,
  ProjectContext,
  ScanState,
  Signal,
  SignalMetricSnapshot,
  SignalClass,
  VersionedNextMove,
  VoiceProfile,
} from "@trendsfast/schemas";
import type {
  ProviderAttemptReservation,
  ProviderAttemptSettlement,
  ProviderRunResult,
  ProviderSlug,
  QueryPlan,
} from "@trendsfast/providers";

import {
  ModelCostSettlementError,
  type ModelCostReservation,
  type ModelCostSettlement,
  type ModelCostReservationResult,
  type ReserveModelCost,
  type SettleModelCost,
} from "./synthesis";
import { deriveProjectContextProfile, type ProjectContextProfile } from "./context";
import { formatHasEnabledCapability } from "./content-capability";

export type ProcessingSnapshot = {
  requestId: string;
  publicId: string;
  url: string;
  state: ScanState;
  market?: string;
  language?: string;
  objective?: string;
  preferredChannels?: string[];
  availableFormats?: string[];
  requestedContentCapabilities?: ContentCapabilityName[];
  generationLevel?: GenerationLevel;
};

export type ProcessingClaimIdentity = {
  requestId: string;
  runId: string;
  processingFence: string;
};

export type ClaimedProcessing = ProcessingClaimIdentity & {
  state: "RUNNING";
  context?: ProjectContext;
  contextVersionId?: string;
  queryPlan?: QueryPlan;
  sourceStates: Partial<Record<ProviderSlug, string>>;
  spentUsd?: number;
  hardDeadlineAt?: Date;
  generationLevel?: GenerationLevel;
  objective?: string;
  preferredChannels?: string[];
  availableFormats?: string[];
  contentCapabilities?: ContentCapabilities;
  voiceProfile?: VoiceProfile;
};

export type DecisionDraft = {
  move: NextMove;
  versionedMove?: VersionedNextMove;
  whyNow: string;
  signalClass: SignalClass;
  independentSourceCount: number;
  saturation: "low" | "low_to_medium" | "medium" | "high" | "unknown";
  limitations: string[];
  evidenceSignalIds: string[];
  promptVersion: string;
  scoreVersion: string;
  confidenceRationale?: string;
};

export type ProcessingStore = {
  load(publicId: string): Promise<ProcessingSnapshot | null>;
  claim(snapshot: ProcessingSnapshot, deadline: Date): Promise<ClaimedProcessing>;
  saveContext(
    claim: ProcessingClaimIdentity,
    context: ProjectContext,
    profile?: ProjectContextProfile,
  ): Promise<{ contextVersionId: string }>;
  saveQueryPlan(claim: ProcessingClaimIdentity, plan: QueryPlan): Promise<void>;
  beginProvider(
    provider: ProviderSlug,
    claim: ProcessingClaimIdentity,
    queryCount: number,
  ): Promise<void>;
  completeProvider(
    provider: ProviderSlug,
    claim: ProcessingClaimIdentity,
    result: ProviderRunResult,
  ): Promise<void>;
  failProvider(
    provider: ProviderSlug,
    claim: ProcessingClaimIdentity,
    input: { code: string; message: string; skipped?: boolean },
  ): Promise<void>;
  reserveProviderAttempt(
    claim: ProcessingClaimIdentity,
    reservation: ProviderAttemptReservation,
    maximumCostUsd: number,
  ): Promise<ModelCostReservationResult>;
  settleProviderAttempt(
    claim: ProcessingClaimIdentity,
    settlement: ProviderAttemptSettlement,
  ): Promise<{ committedCostUsd: number }>;
  reserveModelCost(
    claim: ProcessingClaimIdentity,
    reservation: ModelCostReservation,
    maximumCostUsd: number,
  ): Promise<ModelCostReservationResult>;
  settleModelCost(
    claim: ProcessingClaimIdentity,
    settlement: ModelCostSettlement,
  ): Promise<{ committedCostUsd: number }>;
  loadCollectedData(runId: string): Promise<{
    signals: Signal[];
    snapshots: SignalMetricSnapshot[];
    measurements: ProviderRunResult["measurements"];
    coverage: Record<string, string>;
  }>;
  saveDraft(
    claim: ProcessingClaimIdentity & { contextVersionId: string },
    draft: DecisionDraft,
  ): Promise<{ nextMoveId: string }>;
  requireReview(claim: ProcessingClaimIdentity, signalClass: SignalClass): Promise<void>;
  failScan(
    claim: { requestId: string } | ProcessingClaimIdentity,
    code: string,
    message: string,
  ): Promise<void>;
};

export type ProviderRunner = {
  order: ProviderSlug[];
  estimate(provider: ProviderSlug, queries: QueryPlan["entries"]): number;
  execute(
    provider: ProviderSlug,
    request: { scanId: string; productUrl: string; queries: QueryPlan["entries"] },
    budget: {
      remainingUsd: number;
      deadline: Date;
      reserveAttempt(reservation: ProviderAttemptReservation): Promise<void>;
      settleAttempt(settlement: ProviderAttemptSettlement): Promise<void>;
    },
  ): Promise<ProviderRunResult>;
};

export class ScanDeadlineError extends Error {}
export class ScanAlreadyClaimedError extends Error {}
export class ProviderOutcomeUnknownError extends Error {}
export class StaleProcessingClaimError extends Error {}

function completed(state: string | undefined): boolean {
  return state === "SUCCEEDED" || state === "DEGRADED" || state === "SKIPPED";
}

function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 500) : "Unknown scan processing error";
}

export async function processScan(
  publicId: string,
  dependencies: {
    store: ProcessingStore;
    inferContext(
      url: string,
      websiteSignals: Signal[],
      controls: {
        deadline: Date;
        reserveModelCost: ReserveModelCost;
        settleModelCost: SettleModelCost;
      },
    ): Promise<ProjectContext>;
    planQueries(
      context: ProjectContext,
      options: {
        productUrl: string;
        now: Date;
        market?: string;
        language?: string;
      },
    ): QueryPlan;
    providers: ProviderRunner;
    decide(input: {
      context: ProjectContext;
      objective?: string;
      contentCapabilities?: ContentCapabilities;
      voiceProfile?: VoiceProfile;
      signals: Signal[];
      snapshots: SignalMetricSnapshot[];
      measurements: ProviderRunResult["measurements"];
      coverage: Record<string, string>;
      generationLevel?: GenerationLevel;
      now: Date;
      deadline: Date;
      reserveModelCost: ReserveModelCost;
      settleModelCost: SettleModelCost;
    }): Promise<DecisionDraft>;
    maxCostUsd: number;
    maxDurationMs: number;
    now?: () => Date;
  },
): Promise<{
  state: ScanState;
  requestId: string;
  runId?: string;
  nextMoveId?: string;
  costUsd: number;
}> {
  const now = dependencies.now ?? (() => new Date());
  const snapshot = await dependencies.store.load(publicId);
  if (!snapshot) throw new Error("Scan request was not found");
  if (
    snapshot.state === "READY" ||
    snapshot.state === "REVIEW_REQUIRED" ||
    snapshot.state === "FAILED"
  ) {
    return { state: snapshot.state, requestId: snapshot.requestId, costUsd: 0 };
  }
  const startedAt = now();
  let deadline = new Date(startedAt.getTime() + dependencies.maxDurationMs);
  let claim: ClaimedProcessing | undefined;
  let spent = 0;
  try {
    claim = await dependencies.store.claim(snapshot, deadline);
    if (claim.hardDeadlineAt) deadline = claim.hardDeadlineAt;
    spent = Math.max(0, claim.spentUsd ?? 0);
    const interruptedProvider = Object.entries(claim.sourceStates).find(
      ([, state]) => state === "RUNNING",
    )?.[0];
    if (interruptedProvider) {
      throw new ProviderOutcomeUnknownError(
        `${interruptedProvider} stopped before its external effect could be durably confirmed. Automatic replay is disabled.`,
      );
    }
    if (now() >= deadline)
      throw new ScanDeadlineError("The scan exceeded its hard duration ceiling.");
    const ids: ProcessingClaimIdentity = {
      requestId: claim.requestId,
      runId: claim.runId,
      processingFence: claim.processingFence,
    };
    const reserveModelCost: ReserveModelCost = async (reservation) => {
      const result = await dependencies.store.reserveModelCost(
        ids,
        reservation,
        dependencies.maxCostUsd,
      );
      spent = Math.max(spent, result.projectedCostUsd);
      return result;
    };
    const settleModelCost: SettleModelCost = async (settlement) => {
      try {
        const result = await dependencies.store.settleModelCost(ids, settlement);
        spent = Math.max(spent, result.committedCostUsd);
        return result;
      } catch (error) {
        if (error instanceof StaleProcessingClaimError) throw error;
        throw new ModelCostSettlementError(
          `${settlement.operation} model attempt ${settlement.attempt} returned, but its cost outcome could not be durably settled: ${safeMessage(error)}`,
          { cause: error },
        );
      }
    };
    const reserveProviderAttempt = async (reservation: ProviderAttemptReservation) => {
      const result = await dependencies.store.reserveProviderAttempt(
        ids,
        reservation,
        dependencies.maxCostUsd,
      );
      if (!result.created) {
        throw new ProviderOutcomeUnknownError(
          `${reservation.provider} attempt ${reservation.attempt} already has a durable reservation. Automatic replay is disabled.`,
        );
      }
      spent = Math.max(spent, result.projectedCostUsd);
    };
    const settleProviderAttempt = async (settlement: ProviderAttemptSettlement) => {
      try {
        const result = await dependencies.store.settleProviderAttempt(ids, settlement);
        spent = Math.max(spent, result.committedCostUsd);
      } catch (error) {
        if (error instanceof StaleProcessingClaimError) throw error;
        throw new ProviderOutcomeUnknownError(
          `${settlement.provider} attempt ${settlement.attempt} returned, but its cost outcome could not be durably settled: ${safeMessage(error)}`,
        );
      }
    };
    let context = claim.context;
    let contextVersionId = claim.contextVersionId;
    if (!context || !contextVersionId) {
      if (!completed(claim.sourceStates.website)) {
        if (now() >= deadline)
          throw new ScanDeadlineError("The scan exceeded its hard duration ceiling.");
        const websiteQueries: QueryPlan["entries"] = [
          {
            id: `context_${claim.runId}`,
            provider: "website",
            role: "product_context",
            query: snapshot.url,
            limit: 1,
          },
        ];
        const websiteEstimate = Math.max(
          0,
          dependencies.providers.estimate("website", websiteQueries),
        );
        if (spent + websiteEstimate > dependencies.maxCostUsd) {
          throw new Error("Product website collection would exceed the scan cost ceiling.");
        }
        await dependencies.store.beginProvider("website", ids, 1);
        try {
          const websiteResult = await dependencies.providers.execute(
            "website",
            { scanId: claim.runId, productUrl: snapshot.url, queries: websiteQueries },
            {
              remainingUsd: Math.max(0, dependencies.maxCostUsd - spent),
              deadline,
              reserveAttempt: reserveProviderAttempt,
              settleAttempt: settleProviderAttempt,
            },
          );
          try {
            await dependencies.store.completeProvider("website", ids, websiteResult);
          } catch (error) {
            if (error instanceof StaleProcessingClaimError) throw error;
            throw new ProviderOutcomeUnknownError(
              `website returned, but its external outcome could not be durably completed: ${safeMessage(error)}`,
            );
          }
          claim.sourceStates.website =
            websiteResult.status === "SUCCESS" ? "SUCCEEDED" : "DEGRADED";
        } catch (error) {
          if (
            error instanceof ProviderOutcomeUnknownError ||
            error instanceof StaleProcessingClaimError
          ) {
            throw error;
          }
          await dependencies.store.failProvider("website", ids, {
            code: "WEBSITE_CONTEXT_FAILED",
            message: safeMessage(error),
          });
          throw error;
        }
      }
      const websiteData = await dependencies.store.loadCollectedData(claim.runId);
      if (now() >= deadline)
        throw new ScanDeadlineError("The scan exceeded its hard duration ceiling.");
      context = await dependencies.inferContext(
        snapshot.url,
        websiteData.signals.filter((signal) => signal.source === "website"),
        { deadline, reserveModelCost, settleModelCost },
      );
      if (now() >= deadline)
        throw new ScanDeadlineError("The scan exceeded its hard duration ceiling.");
      ({ contextVersionId } = await dependencies.store.saveContext(
        ids,
        context,
        deriveProjectContextProfile(
          context,
          websiteData.signals.filter((signal) => signal.source === "website"),
        ),
      ));
    }
    if (now() >= deadline)
      throw new ScanDeadlineError("The scan exceeded its hard duration ceiling.");
    const plan =
      claim.queryPlan ??
      dependencies.planQueries(context, {
        productUrl: snapshot.url,
        now: startedAt,
        ...(snapshot.market === undefined ? {} : { market: snapshot.market }),
        ...(snapshot.language === undefined ? {} : { language: snapshot.language }),
      });
    if (!claim.queryPlan) await dependencies.store.saveQueryPlan(ids, plan);

    for (const provider of dependencies.providers.order) {
      if (provider === "website") continue;
      if (completed(claim.sourceStates[provider])) continue;
      if (now() >= deadline)
        throw new ScanDeadlineError("The scan exceeded its hard duration ceiling.");
      const queries = plan.entries.filter((entry) => entry.provider === provider);
      if (provider !== "manual" && queries.length === 0) continue;
      const estimate = Math.max(0, dependencies.providers.estimate(provider, queries));
      if (spent + estimate > dependencies.maxCostUsd) {
        await dependencies.store.failProvider(provider, ids, {
          code: "SCAN_COST_CEILING",
          message: "Source skipped because its estimate would exceed the scan cost ceiling.",
          skipped: true,
        });
        claim.sourceStates[provider] = "SKIPPED";
        continue;
      }
      await dependencies.store.beginProvider(provider, ids, queries.length);
      try {
        const result = await dependencies.providers.execute(
          provider,
          { scanId: claim.runId, productUrl: snapshot.url, queries },
          {
            remainingUsd: Math.max(0, dependencies.maxCostUsd - spent),
            deadline,
            reserveAttempt: reserveProviderAttempt,
            settleAttempt: settleProviderAttempt,
          },
        );
        try {
          await dependencies.store.completeProvider(provider, ids, result);
        } catch (error) {
          if (error instanceof StaleProcessingClaimError) throw error;
          throw new ProviderOutcomeUnknownError(
            `${provider} returned, but its external outcome could not be durably completed: ${safeMessage(error)}`,
          );
        }
        claim.sourceStates[provider] = result.status === "SUCCESS" ? "SUCCEEDED" : "DEGRADED";
      } catch (error) {
        if (
          error instanceof ProviderOutcomeUnknownError ||
          error instanceof StaleProcessingClaimError
        ) {
          throw error;
        }
        await dependencies.store.failProvider(provider, ids, {
          code: "PROVIDER_RUN_FAILED",
          message: safeMessage(error),
        });
        claim.sourceStates[provider] = "FAILED";
      }
    }

    const collected = await dependencies.store.loadCollectedData(claim.runId);
    if (now() >= deadline)
      throw new ScanDeadlineError("The scan exceeded its hard duration ceiling.");
    const contentCapabilities = claim.contentCapabilities;
    const requestedFormats = claim.availableFormats ?? context.availableFormats;
    const compatibleFormats = contentCapabilities
      ? requestedFormats.filter((format) => formatHasEnabledCapability(format, contentCapabilities))
      : requestedFormats;
    const effectiveContext: ProjectContext = {
      ...context,
      ...(claim.preferredChannels?.length ? { suitableChannels: claim.preferredChannels } : {}),
      availableFormats: compatibleFormats,
    };
    const draft = await dependencies.decide({
      context: effectiveContext,
      ...collected,
      ...(claim.objective ? { objective: claim.objective } : {}),
      ...(claim.contentCapabilities ? { contentCapabilities: claim.contentCapabilities } : {}),
      ...(claim.voiceProfile ? { voiceProfile: claim.voiceProfile } : {}),
      ...(claim.generationLevel ? { generationLevel: claim.generationLevel } : {}),
      now: now(),
      deadline,
      reserveModelCost,
      settleModelCost,
    });
    if (now() >= deadline)
      throw new ScanDeadlineError("The scan exceeded its hard duration ceiling.");
    const saved = await dependencies.store.saveDraft({ ...ids, contextVersionId }, draft);
    await dependencies.store.requireReview(ids, draft.signalClass);
    return {
      state: "REVIEW_REQUIRED",
      requestId: claim.requestId,
      runId: claim.runId,
      nextMoveId: saved.nextMoveId,
      costUsd: spent,
    };
  } catch (error) {
    if (error instanceof ScanAlreadyClaimedError || error instanceof StaleProcessingClaimError) {
      return { state: "RUNNING", requestId: snapshot.requestId, costUsd: spent };
    }
    const code =
      error instanceof ScanDeadlineError
        ? "SCAN_DEADLINE_EXCEEDED"
        : error instanceof ModelCostSettlementError
          ? "MODEL_OUTCOME_UNKNOWN"
          : error instanceof ProviderOutcomeUnknownError
            ? "PROVIDER_OUTCOME_UNKNOWN"
            : "SCAN_PROCESSING_FAILED";
    await dependencies.store.failScan(
      claim
        ? {
            requestId: claim.requestId,
            runId: claim.runId,
            processingFence: claim.processingFence,
          }
        : { requestId: snapshot.requestId },
      code,
      safeMessage(error),
    );
    throw error;
  }
}
