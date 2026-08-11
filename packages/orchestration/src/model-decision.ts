import type { ProjectContext, Signal } from "@trendsfast/schemas";
import type { ProviderMeasurement } from "@trendsfast/providers";

import { decideDeterministically } from "./decision";
import { createStructuredSynthesizer, type ModelClient, type ReserveModelCost } from "./synthesis";
import type { DecisionDraft } from "./state-machine";

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
    measurements: ProviderMeasurement[];
    coverage: Record<string, string>;
    now: Date;
    deadline?: Date;
    reserveModelCost?: ReserveModelCost;
  }): Promise<DecisionDraft> => {
    const ranked = await decideDeterministically(input);
    try {
      const proposal = await synthesizer.synthesize({
        project: {
          name: input.context.name,
          audience: input.context.audience,
          credibleTopics: input.context.credibleTopics,
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
        ...(input.reserveModelCost ? { reserveModelCost: input.reserveModelCost } : {}),
      });
      if (proposal.action !== ranked.move.action) {
        throw new Error("Model synthesis changed the action selected by the quality floor");
      }
      return {
        ...ranked,
        move: {
          action: ranked.move.action,
          channel: ranked.move.channel,
          topic: proposal.topic,
          angle: proposal.angle,
          format: ranked.move.format,
          hook: proposal.hook,
          outline: proposal.outline,
          cta: proposal.cta,
          priority: ranked.move.priority,
          confidence: ranked.move.confidence,
          validUntil: ranked.move.validUntil,
        },
        whyNow: proposal.whyNowSummary,
        limitations: [...new Set([...ranked.limitations, ...proposal.limitations])],
        evidenceSignalIds: [...ranked.evidenceSignalIds],
        promptVersion: synthesizer.promptVersion,
        confidenceRationale: proposal.confidenceRationale,
      };
    } catch {
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
