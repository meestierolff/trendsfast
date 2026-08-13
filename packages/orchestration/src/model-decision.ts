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

/**
 * Runs the versioned deterministic ranking and quality floor first, then gives
 * the model only the winning compact candidate. Model output may improve the
 * prose but cannot change the approved action, numeric score, truth class,
 * evidence allowlist, or validity window.
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
          audience: input.context.audience,
          credibleTopics: input.context.credibleTopics,
          ...(input.objective ? { objective: input.objective } : {}),
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
        compactClusters: [
          {
            id: "top_ranked_candidate",
            topic: ranked.move.topic,
            signalIds: ranked.evidenceSignalIds,
            requiredAction: ranked.move.action,
            whyNow: ranked.whyNow,
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
      if (proposal.action !== ranked.move.action) {
        throw new Error("Model synthesis changed the action selected by the quality floor");
      }
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
        whyNow: proposal.whyNowSummary,
        limitations: [...new Set([...ranked.limitations, ...proposal.limitations])],
        evidenceSignalIds: [...ranked.evidenceSignalIds],
        promptVersion: synthesizer.promptVersion,
        confidenceRationale: proposal.confidenceRationale,
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
