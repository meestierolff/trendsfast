import { describe, expect, it } from "vitest";

import { SCORE_VERSION, rankOpportunityScores, scoreOpportunityV1 } from "../src/index";

describe("score v1", () => {
  it("implements the published versioned hypothesis exactly", () => {
    const result = scoreOpportunityV1({
      audienceFit: 0.8,
      productRelevance: 0.7,
      measuredOrCorroboratedMomentum: 0.6,
      novelty: 0.5,
      productCredibility: 0.9,
      formatFit: 0.75,
      remainingWindow: 0.8,
      sourceQuality: 0.7,
      saturation: 0.2,
      evidenceDependency: 0.25,
    });

    const expected =
      0.25 * 0.8 +
      0.18 * 0.7 +
      0.15 * 0.6 +
      0.12 * 0.5 +
      0.1 * 0.9 +
      0.08 * 0.75 +
      0.07 * 0.8 +
      0.05 * 0.7 -
      0.2 * 0.2 -
      0.15 * 0.25;

    expect(SCORE_VERSION).toBe("opportunity-v1");
    expect(result.rawScore).toBeCloseTo(expected, 10);
    expect(result.priority).toBe(Math.round(expected * 100));
    expect(result.version).toBe(SCORE_VERSION);
    expect(result.breakdown.saturation).toBeCloseTo(-0.04, 10);
  });

  it("clamps invalid component values and the final priority", () => {
    const result = scoreOpportunityV1({
      audienceFit: 5,
      productRelevance: 5,
      measuredOrCorroboratedMomentum: 5,
      novelty: 5,
      productCredibility: 5,
      formatFit: 5,
      remainingWindow: 5,
      sourceQuality: 5,
      saturation: -2,
      evidenceDependency: -1,
    });

    expect(result.priority).toBe(100);
    expect(result.components.audienceFit).toBe(1);
  });

  it("ranks deterministically by score and then stable ID", () => {
    const components = {
      audienceFit: 0.5,
      productRelevance: 0.5,
      measuredOrCorroboratedMomentum: 0.5,
      novelty: 0.5,
      productCredibility: 0.5,
      formatFit: 0.5,
      remainingWindow: 0.5,
      sourceQuality: 0.5,
      saturation: 0.5,
      evidenceDependency: 0.5,
    };

    expect(
      rankOpportunityScores([
        { id: "opp_b", components },
        { id: "opp_a", components },
      ]).map((entry) => entry.id),
    ).toEqual(["opp_a", "opp_b"]);
  });
});
