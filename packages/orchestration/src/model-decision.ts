import {
  reconcileVersionedNextMove,
  type ContentCapabilities,
  type GenerationLevel,
  type ProjectContext,
  type Signal,
  type SignalMetricSnapshot,
  type VoiceProfile,
} from "@trendsfast/schemas";
import type { ProviderMeasurement } from "@trendsfast/providers";

import { decideDeterministically } from "./decision";
import {
  createStructuredSynthesizer,
  ModelCostSettlementError,
  type ModelClient,
  type ReserveModelCost,
  type SettleModelCost,
} from "./synthesis";
import { StaleProcessingClaimError, type DecisionDraft } from "./state-machine";

function assertExactProse(actual: string, deterministic: string): void {
  if (actual !== deterministic) {
    throw new Error("Model prose changed a deterministic content field");
  }
}

function assertGroundedProseRefinement(
  proposal: {
    topic: string;
    angle: string;
    hook: string;
    outline: string[];
    cta: string;
  },
  deterministic: DecisionDraft["move"],
): void {
  assertExactProse(proposal.topic, deterministic.topic);
  assertExactProse(proposal.angle, deterministic.angle);
  assertExactProse(proposal.hook, deterministic.hook);
  if (proposal.outline.length !== deterministic.outline.length) {
    throw new Error("Model prose changed the deterministic outline shape");
  }
  proposal.outline.forEach((item, index) => {
    assertExactProse(item, deterministic.outline[index]!);
  });
  assertExactProse(proposal.cta, deterministic.cta);
}

/**
 * Runs the versioned deterministic ranking and quality floor first, then gives
 * the model only the winning compact candidate. The model must echo every
 * persisted field exactly; any prose or categorical change falls back to the
 * deterministic draft. It cannot change the approved action, numeric score,
 * truth class, evidence allowlist, or validity window.
 */
export function createModelAssistedDecision(client: ModelClient) {
  const synthesizer = createStructuredSynthesizer(client);
  return async (input: {
    context: ProjectContext;
    signals: Signal[];
    snapshots?: SignalMetricSnapshot[];
    measurements: ProviderMeasurement[];
    coverage: Record<string, string>;
    objective?: string;
    generationLevel?: GenerationLevel;
    contentCapabilities?: ContentCapabilities;
    voiceProfile?: VoiceProfile;
    now: Date;
    deadline?: Date;
    reserveModelCost?: ReserveModelCost;
    settleModelCost?: SettleModelCost;
  }): Promise<DecisionDraft> => {
    const ranked = await decideDeterministically(input);
    try {
      const proposal = await synthesizer.synthesize({
        project: {
          name: input.context.name,
          url: input.context.url,
          category: input.context.category,
          audience: input.context.audience,
          alternatives: input.context.alternatives,
          competitors: input.context.competitors,
          markets: input.context.markets,
          language: input.context.language,
          suitableChannels: input.context.suitableChannels,
          availableFormats: input.context.availableFormats,
          credibleTopics: input.context.credibleTopics,
          problem: input.context.problem,
          desiredOutcome: input.context.desiredOutcome,
          credibleClaims: input.context.credibleClaims,
          assumptions: input.context.assumptions,
          ...(input.voiceProfile
            ? {
                voiceProfile: {
                  traits: input.voiceProfile.traits,
                  preferred_phrases: input.voiceProfile.preferred_phrases,
                  avoid_phrases: input.voiceProfile.avoid_phrases,
                  sample_texts: input.voiceProfile.sample_texts,
                },
              }
            : {}),
        },
        request: {
          ...(input.objective ? { objective: input.objective } : {}),
          ...(input.generationLevel ? { generationLevel: input.generationLevel } : {}),
          ...(input.contentCapabilities ? { contentCapabilities: input.contentCapabilities } : {}),
        },
        deterministicLimitations: ranked.limitations,
        compactClusters: [
          {
            id: "top_ranked_candidate",
            topic: ranked.move.topic,
            signalIds: ranked.evidenceSignalIds,
            requiredAction: ranked.move.action,
            whyNow: ranked.whyNow,
            fixedDecision: {
              channel: ranked.move.channel,
              format: ranked.move.format,
              priority: ranked.move.priority,
              confidence: ranked.move.confidence,
              validUntil: ranked.move.validUntil,
            },
            deterministicProse: {
              topic: ranked.move.topic,
              angle: ranked.move.angle,
              hook: ranked.move.hook,
              outline: ranked.move.outline,
              cta: ranked.move.cta,
              confidenceRationale: ranked.confidenceRationale,
            },
          },
        ],
        allowedSignalIds: ranked.evidenceSignalIds,
        now: input.now,
        ...(input.deadline ? { deadline: input.deadline } : {}),
        ...(input.reserveModelCost && input.settleModelCost
          ? {
              reserveModelCost: input.reserveModelCost,
              settleModelCost: input.settleModelCost,
            }
          : {}),
      });
      if (
        proposal.action !== ranked.move.action ||
        proposal.channel !== ranked.move.channel ||
        proposal.format !== ranked.move.format ||
        proposal.priority !== ranked.move.priority ||
        proposal.confidence !== ranked.move.confidence ||
        proposal.validUntil !== ranked.move.validUntil ||
        proposal.whyNowSummary !== ranked.whyNow ||
        proposal.confidenceRationale !== ranked.confidenceRationale ||
        JSON.stringify(proposal.limitations) !== JSON.stringify(ranked.limitations)
      ) {
        throw new Error("Model synthesis changed a field fixed by deterministic ranking");
      }
      assertGroundedProseRefinement(proposal, ranked.move);
      const refinedMove = {
        ...ranked.move,
        topic: proposal.topic,
        angle: proposal.angle,
        hook: proposal.hook,
        outline: proposal.outline,
        cta: proposal.cta,
      };
      const refinedVersionedMove = ranked.versionedMove
        ? reconcileVersionedNextMove({
            move: ranked.versionedMove,
            prose: {
              channel: ranked.versionedMove.channel,
              topic: proposal.topic,
              angle: proposal.angle,
              format: ranked.versionedMove.format,
              hook: proposal.hook,
              outline: proposal.outline,
              cta: proposal.cta,
            },
          })
        : undefined;
      return {
        ...ranked,
        move: refinedMove,
        ...(refinedVersionedMove ? { versionedMove: refinedVersionedMove } : {}),
        whyNow: ranked.whyNow,
        limitations: [...ranked.limitations],
        evidenceSignalIds: [...ranked.evidenceSignalIds],
        promptVersion: synthesizer.promptVersion,
        ...(ranked.confidenceRationale ? { confidenceRationale: ranked.confidenceRationale } : {}),
      };
    } catch (error) {
      if (error instanceof ModelCostSettlementError || error instanceof StaleProcessingClaimError) {
        throw error;
      }
      return {
        ...ranked,
        limitations: [
          ...new Set([
            ...ranked.limitations,
            "Model synthesis was unavailable or failed validation; deterministic output was retained.",
          ]),
        ],
      };
    }
  };
}
