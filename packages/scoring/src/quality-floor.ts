import type { NextMoveAction, TrendSignalClass } from "./types";

export type ActionQualityInput = {
  id: string;
  requestedAction: NextMoveAction;
  priority: number;
  audienceFit: number;
  productCredibility: number;
  productRelevance: number;
  evidenceCount: number;
  independentSourceCount: number;
  signalClass: TrendSignalClass;
  saturation: number;
  hasDefensibleInsight: boolean;
  hasValidOriginalUrl: boolean;
  hasConcreteContribution: boolean;
  hasProvenFormatOrTopic: boolean;
  hasProductSpecificTranslation: boolean;
  criticalProviderFailure: boolean;
  coverageAdequate: boolean;
  recent: boolean;
  modelUncertain?: boolean;
  evidenceComplete?: boolean;
};

export type ActionQualityResult = {
  action: NextMoveAction;
  passed: boolean;
  reasons: string[];
};

function globalReasons(input: ActionQualityInput): string[] {
  const reasons: string[] = [];
  if (!input.coverageAdequate) reasons.push("PROVIDER_COVERAGE_INADEQUATE");
  if (input.signalClass === "INSUFFICIENT_SIGNAL") reasons.push("INSUFFICIENT_SIGNAL");
  if (input.modelUncertain === true) reasons.push("MODEL_UNCERTAIN");
  if (input.evidenceComplete === false) reasons.push("EVIDENCE_INCOMPLETE");
  if (input.saturation > 0.9) reasons.push("SATURATION_TOO_HIGH");
  return reasons;
}

export function enforceActionQualityFloor(input: ActionQualityInput): ActionQualityResult {
  if (input.requestedAction === "WAIT") return { action: "WAIT", passed: true, reasons: [] };
  const reasons = globalReasons(input);

  if (input.requestedAction === "PUBLISH") {
    if (input.audienceFit < 0.7) reasons.push("PUBLISH_REQUIRES_STRONG_AUDIENCE_FIT");
    if (input.productRelevance < 0.7) reasons.push("PUBLISH_REQUIRES_STRONG_PRODUCT_RELEVANCE");
    if (input.productCredibility < 0.7) reasons.push("PUBLISH_REQUIRES_STRONG_PRODUCT_CREDIBILITY");
    if (input.evidenceCount < 2 || input.independentSourceCount < 2) {
      reasons.push("PUBLISH_REQUIRES_TWO_INDEPENDENT_EVIDENCE_ITEMS");
    }
    if (
      !["MEASURED_EXTERNAL_SERIES", "MEASURED_INTERNAL_VELOCITY", "CORROBORATED_SIGNAL"].includes(
        input.signalClass,
      )
    ) {
      reasons.push("PUBLISH_REQUIRES_MEASURED_OR_CORROBORATED_MOMENTUM");
    }
    if (input.saturation > 0.65) reasons.push("PUBLISH_SATURATION_TOO_HIGH");
    if (!input.hasDefensibleInsight) reasons.push("PUBLISH_REQUIRES_DEFENSIBLE_INSIGHT");
    if (input.criticalProviderFailure) reasons.push("PUBLISH_BLOCKED_BY_CRITICAL_PROVIDER_FAILURE");
  }

  if (input.requestedAction === "REPLY") {
    if (input.evidenceCount < 1) reasons.push("REPLY_REQUIRES_EVIDENCE");
    if (!input.hasValidOriginalUrl) reasons.push("REPLY_REQUIRES_VALID_ORIGINAL_URL");
    if (!input.recent) reasons.push("REPLY_REQUIRES_RECENT_CONVERSATION");
    if (input.audienceFit < 0.8 || input.productRelevance < 0.8) {
      reasons.push("REPLY_REQUIRES_EXCEPTIONAL_RELEVANCE");
    }
    if (!input.hasConcreteContribution) reasons.push("REPLY_REQUIRES_CONCRETE_CONTRIBUTION");
    if (input.productCredibility < 0.65) reasons.push("REPLY_REQUIRES_PRODUCT_CREDIBILITY");
  }

  if (input.requestedAction === "REMIX") {
    if (input.evidenceCount < 1 || !input.hasValidOriginalUrl) {
      reasons.push("REMIX_REQUIRES_VALID_EVIDENCE");
    }
    if (!input.hasProvenFormatOrTopic) reasons.push("REMIX_REQUIRES_PROVEN_FORMAT_OR_TOPIC");
    if (!input.hasProductSpecificTranslation) {
      reasons.push("REMIX_REQUIRES_PRODUCT_SPECIFIC_TRANSLATION");
    }
    if (input.audienceFit < 0.65 || input.productRelevance < 0.65) {
      reasons.push("REMIX_REQUIRES_RELEVANCE");
    }
  }

  return reasons.length === 0
    ? { action: input.requestedAction, passed: true, reasons }
    : { action: "WAIT", passed: false, reasons: [...new Set(reasons)] };
}

export type SelectedMoveCandidate = {
  action: NextMoveAction;
  candidateId: string | null;
  reasons: string[];
};

export function selectNextMoveCandidate(candidates: ActionQualityInput[]): SelectedMoveCandidate {
  const ranked = [...candidates].sort(
    (left, right) => right.priority - left.priority || left.id.localeCompare(right.id),
  );
  const rejectedReasons: string[] = [];
  for (const candidate of ranked) {
    const result = enforceActionQualityFloor(candidate);
    if (result.passed && result.action !== "WAIT") {
      return { action: result.action, candidateId: candidate.id, reasons: [] };
    }
    rejectedReasons.push(...result.reasons);
  }
  return {
    action: "WAIT",
    candidateId: null,
    reasons:
      rejectedReasons.length > 0
        ? [...new Set(rejectedReasons)]
        : ["NO_ACTION_PASSES_QUALITY_FLOOR"],
  };
}
