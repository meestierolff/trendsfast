import { describe, expect, it } from "vitest";

import { enforceActionQualityFloor, selectNextMoveCandidate } from "../src/index";

const strongPublish = {
  id: "opp_publish",
  requestedAction: "PUBLISH" as const,
  priority: 86,
  audienceFit: 0.9,
  productCredibility: 0.85,
  productRelevance: 0.9,
  evidenceCount: 3,
  independentSourceCount: 3,
  signalClass: "CORROBORATED_SIGNAL" as const,
  saturation: 0.35,
  hasDefensibleInsight: true,
  hasValidOriginalUrl: true,
  hasConcreteContribution: true,
  hasProvenFormatOrTopic: true,
  hasProductSpecificTranslation: true,
  criticalProviderFailure: false,
  coverageAdequate: true,
  recent: true,
};

describe("action quality floors", () => {
  it("allows PUBLISH only when corroboration, independence, credibility and coverage pass", () => {
    expect(enforceActionQualityFloor(strongPublish)).toEqual({
      action: "PUBLISH",
      passed: true,
      reasons: [],
    });

    const dependent = enforceActionQualityFloor({
      ...strongPublish,
      independentSourceCount: 1,
    });
    expect(dependent.action).toBe("WAIT");
    expect(dependent.reasons).toContain("PUBLISH_REQUIRES_TWO_INDEPENDENT_EVIDENCE_ITEMS");
  });

  it("allows one exceptional recent conversation to support REPLY", () => {
    expect(
      enforceActionQualityFloor({
        ...strongPublish,
        requestedAction: "REPLY",
        evidenceCount: 1,
        independentSourceCount: 1,
        signalClass: "EMERGING_SIGNAL",
        audienceFit: 0.92,
        productRelevance: 0.91,
      }),
    ).toMatchObject({ action: "REPLY", passed: true });
  });

  it("requires a proven topic and product-specific translation for REMIX", () => {
    const result = enforceActionQualityFloor({
      ...strongPublish,
      requestedAction: "REMIX",
      hasProductSpecificTranslation: false,
    });

    expect(result.action).toBe("WAIT");
    expect(result.reasons).toContain("REMIX_REQUIRES_PRODUCT_SPECIFIC_TRANSLATION");
  });

  it("returns WAIT when provider coverage is inadequate", () => {
    const result = enforceActionQualityFloor({ ...strongPublish, coverageAdequate: false });
    expect(result.action).toBe("WAIT");
    expect(result.reasons).toContain("PROVIDER_COVERAGE_INADEQUATE");
  });

  it("treats model uncertainty and incomplete evidence as explicit WAIT reasons", () => {
    const result = enforceActionQualityFloor({
      ...strongPublish,
      modelUncertain: true,
      evidenceComplete: false,
    });
    expect(result.action).toBe("WAIT");
    expect(result.reasons).toEqual(
      expect.arrayContaining(["MODEL_UNCERTAIN", "EVIDENCE_INCOMPLETE"]),
    );
  });

  it("selects the highest-ranked passing move, or an explicit WAIT", () => {
    const rejected = { ...strongPublish, id: "opp_rejected", priority: 99, saturation: 0.95 };
    expect(selectNextMoveCandidate([rejected, strongPublish])).toMatchObject({
      action: "PUBLISH",
      candidateId: "opp_publish",
    });

    expect(selectNextMoveCandidate([rejected])).toMatchObject({
      action: "WAIT",
      candidateId: null,
    });
  });
});
