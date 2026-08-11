import type { OpportunityScoreComponents } from "./types";

export const SCORE_VERSION = "opportunity-v1" as const;

export const SCORE_WEIGHTS = {
  audienceFit: 0.25,
  productRelevance: 0.18,
  measuredOrCorroboratedMomentum: 0.15,
  novelty: 0.12,
  productCredibility: 0.1,
  formatFit: 0.08,
  remainingWindow: 0.07,
  sourceQuality: 0.05,
  saturation: -0.2,
  evidenceDependency: -0.15,
} as const satisfies Record<keyof OpportunityScoreComponents, number>;

export type OpportunityScoreResult = {
  version: typeof SCORE_VERSION;
  rawScore: number;
  priority: number;
  components: OpportunityScoreComponents;
  breakdown: Record<keyof OpportunityScoreComponents, number>;
};

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function scoreOpportunityV1(input: OpportunityScoreComponents): OpportunityScoreResult {
  const components = Object.fromEntries(
    Object.entries(input).map(([key, value]) => [key, clamp(value)]),
  ) as OpportunityScoreComponents;
  const breakdown = Object.fromEntries(
    (Object.keys(SCORE_WEIGHTS) as Array<keyof OpportunityScoreComponents>).map((key) => [
      key,
      components[key] * SCORE_WEIGHTS[key],
    ]),
  ) as Record<keyof OpportunityScoreComponents, number>;
  const unbounded = Object.values(breakdown).reduce((sum, value) => sum + value, 0);
  const rawScore = clamp(unbounded);
  return {
    version: SCORE_VERSION,
    rawScore,
    priority: Math.round(rawScore * 100),
    components,
    breakdown,
  };
}

export function rankOpportunityScores<
  T extends { id: string; components: OpportunityScoreComponents },
>(opportunities: T[]): Array<T & OpportunityScoreResult> {
  return opportunities
    .map((opportunity) => ({ ...opportunity, ...scoreOpportunityV1(opportunity.components) }))
    .sort(
      (left, right) =>
        right.priority - left.priority ||
        right.rawScore - left.rawScore ||
        left.id.localeCompare(right.id),
    );
}
