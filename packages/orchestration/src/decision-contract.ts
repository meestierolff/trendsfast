import {
  BreakoutPotentialSchema,
  ContentBlueprintSchema,
  NEXT_MOVE_CONTRACT_VERSION,
  VersionedNextMoveSchema,
  TrendWindowSchema,
  type ActionDetails,
  type BreakoutPotential,
  type ContentBlueprint,
  type ContentCapabilities,
  type GenerationLevel,
  type VersionedNextMove,
  type ProjectContext,
  type Signal,
  type TrendWindow,
  type WaitFailureReason,
  type VoiceProfile,
} from "@trendsfast/schemas";
import type {
  NextMoveAction,
  OpportunityScoreComponents,
  TrendSignalClass,
} from "@trendsfast/scoring";
import { formatHasEnabledCapability } from "./content-capability";

const HOUR_MS = 3_600_000;

type SaturationLabel = "low" | "low_to_medium" | "medium" | "high" | "unknown";

export type DecisionContractInput = {
  action: NextMoveAction;
  context: ProjectContext;
  topic: string;
  channel: string;
  format: string;
  angle: string;
  hook: string;
  outline: string[];
  cta: string;
  priority: number;
  confidence: number;
  signalClass: TrendSignalClass;
  saturation: SaturationLabel;
  components?: OpportunityScoreComponents;
  storedSignals: Signal[];
  evidenceSignalIds: string[];
  qualityReasons: string[];
  coverage: Record<string, string>;
  generationLevel?: GenerationLevel;
  contentCapabilities?: ContentCapabilities;
  voiceProfile?: VoiceProfile;
  now: Date;
};

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function roundedDeadline(now: Date, hours: number): string {
  const roundedNow = Math.ceil(now.getTime() / HOUR_MS) * HOUR_MS;
  return new Date(roundedNow + hours * HOUR_MS).toISOString();
}

function observedTimestamp(signal: Signal): number {
  return new Date(signal.publishedAt ?? signal.observedAt).getTime();
}

function bindStoredEvidence(input: DecisionContractInput): Signal[] {
  if (new Set(input.evidenceSignalIds).size !== input.evidenceSignalIds.length) {
    throw new Error("Decision evidence identifiers must be unique");
  }
  const storedById = new Map(input.storedSignals.map((signal) => [signal.id, signal]));
  const bound = input.evidenceSignalIds.map((id) => {
    const signal = storedById.get(id);
    if (!signal) {
      throw new Error(`Decision evidence ${id} is not present in the stored signal set`);
    }
    return signal;
  });
  if (input.action !== "WAIT" && bound.length === 0) {
    throw new Error(`${input.action} requires at least one exact stored evidence signal`);
  }
  return bound;
}

function trendBasis(signalClass: TrendSignalClass): TrendWindow["basis"] {
  switch (signalClass) {
    case "MEASURED_EXTERNAL_SERIES":
      return "MEASURED_EXTERNAL_SERIES";
    case "MEASURED_INTERNAL_VELOCITY":
      return "MEASURED_INTERNAL_VELOCITY";
    case "CORROBORATED_SIGNAL":
      return "CORROBORATED_INFERENCE";
    case "EMERGING_SIGNAL":
      return "SINGLE_SIGNAL_INFERENCE";
    case "INSUFFICIENT_SIGNAL":
      return "UNKNOWN";
  }
}

function timingRange(
  action: NextMoveAction,
  basis: TrendWindow["basis"],
): { min: number; max: number } | undefined {
  if (basis === "UNKNOWN") return undefined;
  if (basis === "SINGLE_SIGNAL_INFERENCE") {
    return action === "REPLY" ? { min: 4, max: 12 } : undefined;
  }
  if (action === "REPLY") {
    if (basis === "MEASURED_EXTERNAL_SERIES") return { min: 6, max: 18 };
    if (basis === "MEASURED_INTERNAL_VELOCITY") return { min: 6, max: 12 };
    return { min: 4, max: 12 };
  }
  if (action === "REMIX") {
    if (basis === "MEASURED_EXTERNAL_SERIES") return { min: 24, max: 72 };
    if (basis === "MEASURED_INTERNAL_VELOCITY") return { min: 12, max: 48 };
    return { min: 12, max: 36 };
  }
  if (action === "PUBLISH") {
    if (basis === "MEASURED_EXTERNAL_SERIES") return { min: 24, max: 72 };
    if (basis === "MEASURED_INTERNAL_VELOCITY") return { min: 12, max: 48 };
    return { min: 12, max: 36 };
  }
  return undefined;
}

function deriveTrendWindow(input: DecisionContractInput, boundSignals: Signal[]): TrendWindow {
  const basis = trendBasis(input.signalClass);
  const remaining = timingRange(input.action, basis);
  const saturation = input.components?.saturation ?? 0;
  const timing = input.components?.remainingWindow ?? 0;
  const finiteObserved = boundSignals
    .map(observedTimestamp)
    .filter((value) => Number.isFinite(value));
  const observedSince = finiteObserved.length ? Math.min(...finiteObserved) : undefined;
  const confirmed = boundSignals
    .map((signal) => new Date(signal.observedAt).getTime())
    .filter((value) => Number.isFinite(value));
  const lastConfirmed = confirmed.length ? Math.max(...confirmed) : input.now.getTime();
  let state: TrendWindow["state"];
  if (basis === "UNKNOWN") state = "UNKNOWN";
  else if (saturation >= 0.7) state = "SATURATING";
  else if (timing < 0.25) state = "DECAYING";
  else if (basis === "SINGLE_SIGNAL_INFERENCE") state = "EARLY";
  else if (basis === "MEASURED_EXTERNAL_SERIES" || basis === "MEASURED_INTERNAL_VELOCITY")
    state = "RISING";
  else state = "ACTIVE";

  const validHours = remaining?.max ?? (input.action === "WAIT" ? 24 : 12);
  const recheckHours =
    input.action === "WAIT"
      ? basis === "UNKNOWN"
        ? 12
        : Math.max(4, remaining?.min ?? 12)
      : Math.max(4, Math.min(24, remaining?.min ?? 12));
  const validUntil = roundedDeadline(input.now, validHours);
  const confidence =
    basis === "MEASURED_EXTERNAL_SERIES"
      ? 0.86
      : basis === "MEASURED_INTERNAL_VELOCITY"
        ? 0.82
        : basis === "CORROBORATED_INFERENCE"
          ? 0.7
          : basis === "SINGLE_SIGNAL_INFERENCE"
            ? 0.55
            : 0.35;
  const basisExplanation: Record<TrendWindow["basis"], string> = {
    MEASURED_EXTERNAL_SERIES:
      "A rising external time series supports a rounded range; it does not establish a universal trend lifetime.",
    MEASURED_INTERNAL_VELOCITY:
      "Time-separated stored metric observations support rising internal velocity and a rounded range.",
    CORROBORATED_INFERENCE:
      "Independent current sources support an inferred, rounded range rather than a measured lifetime.",
    SINGLE_SIGNAL_INFERENCE:
      "One current source supports only a short, inferred conversation window.",
    UNKNOWN: "The stored evidence does not support a defensible remaining-duration estimate.",
  };

  return TrendWindowSchema.parse({
    state,
    basis,
    ...(observedSince === undefined
      ? {}
      : { observed_since: new Date(observedSince).toISOString() }),
    last_confirmed_at: new Date(lastConfirmed).toISOString(),
    ...(input.action === "WAIT" ? {} : { recommended_action_by: validUntil }),
    valid_until: validUntil,
    recheck_at: roundedDeadline(input.now, recheckHours),
    ...(remaining ? { estimated_remaining_hours: remaining } : {}),
    confidence,
    explanation: basisExplanation[basis],
  });
}

function deriveBreakoutPotential(input: DecisionContractInput): BreakoutPotential {
  const components = input.components;
  if (!components || input.signalClass === "INSUFFICIENT_SIGNAL") {
    return BreakoutPotentialSchema.parse({
      level: "unknown",
      basis: "INSUFFICIENT_DATA",
      factors: {
        audience_relevance: clamp(components?.audienceFit ?? 0),
        timing: clamp(components?.remainingWindow ?? 0),
        novelty: clamp(components?.novelty ?? 0),
        product_credibility: clamp(components?.productCredibility ?? 0),
        format_fit: clamp(components?.formatFit ?? 0),
        saturation_risk: clamp(components?.saturation ?? 0),
      },
      explanation:
        "Breakout potential is unknown because the evidence does not clear the product quality floor. This label is not a probability.",
    });
  }
  const factors = {
    audience_relevance: clamp(components.audienceFit),
    timing: clamp(components.remainingWindow),
    novelty: clamp(components.novelty),
    product_credibility: clamp(components.productCredibility),
    format_fit: clamp(components.formatFit),
    saturation_risk: clamp(components.saturation),
  };
  const composite =
    (factors.audience_relevance +
      factors.timing +
      factors.novelty +
      factors.product_credibility +
      factors.format_fit +
      (1 - factors.saturation_risk)) /
    6;
  const level = composite >= 0.72 ? "high" : composite >= 0.48 ? "medium" : "low";
  return BreakoutPotentialSchema.parse({
    level,
    basis: input.signalClass === "EMERGING_SIGNAL" ? "HEURISTIC" : "EVIDENCE_GROUNDED",
    factors,
    explanation: `${level[0]!.toUpperCase()}${level.slice(1)} is a categorical, evidence-informed opportunity label based on the listed factors. It is not a virality probability.`,
  });
}

function productionOptions(
  context: ProjectContext,
  contentCapabilities?: ContentCapabilities,
): ContentBlueprint["production_options"] {
  const mapping = new Map<string, ContentBlueprint["production_options"][number]>([
    ["founder_text", "FOUNDER_TEXT"],
    ["screen_recording", "SCREEN_RECORDING"],
    ["founder_on_camera", "FOUNDER_CAMERA"],
    ["founder_camera", "FOUNDER_CAMERA"],
    ["ai_avatar", "AI_AVATAR"],
    ["carousel", "CAROUSEL"],
    ["product_demo", "PRODUCT_DEMO"],
    ["long_form", "FOUNDER_TEXT"],
  ]);
  const formats = contentCapabilities
    ? Object.entries(contentCapabilities)
        .filter(([, enabled]) => enabled)
        .map(([name]) => name)
    : context.availableFormats;
  const selected = formats
    .map((format) => mapping.get(format.toLowerCase()))
    .filter((option): option is ContentBlueprint["production_options"][number] => Boolean(option));
  return [...new Set(selected.length ? selected : ["FOUNDER_TEXT" as const])];
}

function deriveBlueprint(input: DecisionContractInput, sourceObserved: boolean): ContentBlueprint {
  const credibleTopic = input.context.credibleTopics[0] ?? input.context.category;
  const production = productionOptions(input.context, input.contentCapabilities);
  const voiceTraits = input.voiceProfile?.traits.filter(Boolean) ?? [];
  const preferredPhrase = input.voiceProfile?.preferred_phrases[0];
  const avoidPhrase = input.voiceProfile?.avoid_phrases[0];
  const assetRequirements = production.flatMap((option) => {
    switch (option) {
      case "SCREEN_RECORDING":
        return ["A short product workflow recording with private data removed"];
      case "FOUNDER_CAMERA":
      case "AI_AVATAR":
        return ["A concise presenter script and approved visual background"];
      case "CAROUSEL":
        return ["Three to six slides with one claim per slide"];
      case "PRODUCT_DEMO":
        return ["A reproducible product example and approved screenshots"];
      case "FOUNDER_TEXT":
        return [];
    }
  });
  return ContentBlueprintSchema.parse({
    content_premise: `${input.context.name} can turn ${input.topic} into a concrete ${credibleTopic} lesson for ${input.context.audience}.`,
    audience_tension: `${input.context.audience} want ${input.context.desiredOutcome}, but ${input.context.problem}.`,
    product_role: `Use ${input.context.name} only where its credible ${credibleTopic} experience clarifies the decision or demonstrates the method.`,
    format_family: input.format,
    format_basis: sourceObserved
      ? "SOURCE_OBSERVED"
      : input.context.availableFormats.includes(input.format)
        ? "PRODUCT_FIT"
        : "HEURISTIC",
    hook_family: "recognizable tension to proof",
    hook_variants: [
      {
        style: "direct",
        text: `${preferredPhrase ? `${preferredPhrase} — ` : ""}${input.context.audience}: here is a practical way to act on ${input.topic}.`,
      },
      {
        style: "contrarian",
        text: `The hard part is not spotting ${input.topic}; it is knowing whether it changes the next decision.`,
      },
      {
        style: "proof",
        text: `We tested ${input.topic} against a simple evidence rule before choosing what to do next.`,
      },
    ],
    tone: [...new Set([...voiceTraits, "specific", "useful", "evidence-aware"])],
    structure: input.outline,
    cta: input.cta,
    asset_requirements: [...new Set(assetRequirements)],
    channel_instructions: [
      `Adapt the opening and length to ${input.channel}; preserve the evidence boundary and limitations.`,
      "Do not describe the opportunity as guaranteed or automatically publish it.",
      ...(avoidPhrase ? [`Avoid the saved phrase: ${avoidPhrase}`] : []),
    ],
    production_options: production,
  });
}

function exactAuthor(signal: Signal): string | undefined {
  return signal.author?.handle ?? signal.author?.displayName;
}

function exactTitleOrExcerpt(signal: Signal): string | undefined {
  return signal.title ?? signal.textExcerpt;
}

function observedFormat(source: Signal["source"]): string | undefined {
  switch (source) {
    case "youtube":
      return "video";
    case "x":
      return "social post";
    case "hacker_news":
    case "reddit":
      return "discussion post";
    case "github":
      return "repository or release artifact";
    case "website":
      return "web page";
    default:
      return undefined;
  }
}

function selectedFormatMatchesObservedPattern(signal: Signal, selectedFormat: string): boolean {
  if (exactTitleOrExcerpt(signal) === undefined) return false;
  const normalized = selectedFormat.trim().toLowerCase().replace(/[ -]+/g, "_");
  switch (observedFormat(signal.source)) {
    case "video":
      return [
        "video",
        "screen_recording",
        "founder_on_camera",
        "founder_camera",
        "ai_avatar",
        "product_demo",
      ].includes(normalized);
    case "social post":
    case "discussion post":
    case "web page":
      return ["founder_text", "long_form", "text", "post", "thread", "article"].includes(
        normalized,
      );
    case "repository or release artifact":
      return ["repository", "release", "release_note", "changelog"].includes(normalized);
    default:
      return false;
  }
}

function deriveReplyTarget(
  input: DecisionContractInput,
  signal: Signal,
  replyBy: string,
): Extract<ActionDetails, { action: "REPLY" }>["primary_target"] {
  const credibleTopic = input.context.credibleTopics[0] ?? input.context.category;
  const factualTitle = exactTitleOrExcerpt(signal);
  return {
    source: signal.source,
    url: signal.url,
    ...(exactAuthor(signal) === undefined ? {} : { author: exactAuthor(signal) }),
    ...(factualTitle === undefined ? {} : { title_or_excerpt: factualTitle }),
    ...(signal.publishedAt === undefined ? {} : { published_at: signal.publishedAt }),
    observed_at: signal.observedAt,
    why_this_target: `This exact stored conversation is current, relevant to ${input.context.audience}, and part of the evidence set selected by the decision engine.`,
    credibility_reason: `${input.context.name} can contribute a bounded ${credibleTopic} perspective without making unsupported claims.`,
    reply_objective:
      "Help the participants make the next decision with a concrete, evidence-aware framework.",
    reply_angle: `Separate what the available evidence supports from assumptions, then connect it to ${input.context.desiredOutcome}.`,
    suggested_reply: `A useful way to approach this is to separate the current evidence from the assumptions, then ask which finding actually changes the next decision. For ${input.context.audience}, I would make the trade-off explicit and add one reproducible example.`,
    short_reply_variant:
      "Separate the evidence from the assumptions, then show the one finding that changes the next decision.",
    tone: ["helpful", "specific", "non-promotional"],
    reply_by: replyBy,
  };
}

function waitFailureReasons(input: DecisionContractInput): WaitFailureReason[] {
  const reasons = new Set<WaitFailureReason>();
  for (const reason of input.qualityReasons) {
    if (/AUDIENCE|RELEVANCE/.test(reason)) reasons.add("WEAK_RELEVANCE");
    if (/CREDIBILITY|CONCRETE|DEFENSIBLE/.test(reason)) reasons.add("LOW_CREDIBILITY");
    if (/SATURATION/.test(reason)) reasons.add("SATURATED");
    if (/INDEPENDENT/.test(reason)) reasons.add("DEPENDENT_EVIDENCE");
    if (/RECENT|TIMING/.test(reason)) reasons.add("BAD_TIMING");
    if (/COVERAGE|PROVIDER|CAPABILITY/.test(reason)) reasons.add("MISSING_COVERAGE");
    if (/SIGNAL|EVIDENCE/.test(reason)) reasons.add("WEAK_EVIDENCE");
  }
  if (Object.values(input.coverage).some((status) => !["SUCCESS", "SUCCEEDED"].includes(status))) {
    reasons.add("MISSING_COVERAGE");
  }
  if (input.components && input.components.saturation > 0.65) reasons.add("SATURATED");
  if (input.evidenceSignalIds.length < 2) reasons.add("WEAK_EVIDENCE");
  if (reasons.size === 0) reasons.add("WEAK_EVIDENCE");
  return [...reasons];
}

function watchConditions(
  reasons: readonly WaitFailureReason[],
  input: Pick<DecisionContractInput, "coverage" | "qualityReasons">,
): string[] {
  const conditions: string[] = [];
  const capabilityMissing = input.qualityReasons.some((reason) => /CAPABILITY/.test(reason));
  const sourceCoverageMissing = Object.values(input.coverage).some(
    (status) => !["SUCCESS", "SUCCEEDED"].includes(status),
  );
  for (const reason of reasons) {
    switch (reason) {
      case "WEAK_RELEVANCE":
        conditions.push(
          "Recheck when a current source ties the topic directly to the saved audience problem.",
        );
        break;
      case "LOW_CREDIBILITY":
        conditions.push(
          "Recheck when the product has a concrete example or credible claim that adds value.",
        );
        break;
      case "SATURATED":
        conditions.push(
          "Recheck after saturation falls or a differentiated product-specific angle appears.",
        );
        break;
      case "WEAK_EVIDENCE":
        conditions.push("Recheck when a stronger current signal or measured series appears.");
        break;
      case "DEPENDENT_EVIDENCE":
        conditions.push("Recheck when an independent source confirms the opportunity.");
        break;
      case "BAD_TIMING":
        conditions.push(
          "Recheck when a new conversation or renewed movement makes the timing actionable.",
        );
        break;
      case "MISSING_COVERAGE":
        if (capabilityMissing) {
          conditions.push(
            "Recheck after enabling a saved production capability compatible with the requested format.",
          );
        }
        if (sourceCoverageMissing || !capabilityMissing) {
          conditions.push("Recheck after the missing source coverage is restored.");
        }
        break;
    }
  }
  return [...new Set(conditions)];
}

function deriveActionDetails(
  input: DecisionContractInput,
  boundSignals: Signal[],
  window: TrendWindow,
): ActionDetails {
  if (
    (input.action === "PUBLISH" || input.action === "REMIX") &&
    input.contentCapabilities &&
    !formatHasEnabledCapability(input.format, input.contentCapabilities)
  ) {
    throw new Error(`${input.action} requires an enabled capability compatible with its format`);
  }
  switch (input.action) {
    case "PUBLISH":
      return {
        action: "PUBLISH",
        content_type: input.format,
        blueprint: deriveBlueprint(
          input,
          boundSignals.some((signal) => selectedFormatMatchesObservedPattern(signal, input.format)),
        ),
        publish_by: window.valid_until,
      };
    case "REPLY": {
      const conversationSignals = boundSignals.filter((signal) =>
        ["x", "hacker_news"].includes(signal.source),
      );
      if (conversationSignals.length === 0) {
        throw new Error("REPLY requires an exact stored X or Hacker News conversation target");
      }
      const targets = conversationSignals
        .slice(0, 3)
        .map((signal) => deriveReplyTarget(input, signal, window.valid_until));
      return {
        action: "REPLY",
        primary_target: targets[0]!,
        secondary_targets: targets.slice(1),
      };
    }
    case "REMIX": {
      if (boundSignals.length === 0) throw new Error("REMIX requires exact stored source content");
      return {
        action: "REMIX",
        source_content: boundSignals.slice(0, 3).map((signal) => ({
          source: signal.source,
          url: signal.url,
          ...(exactAuthor(signal) === undefined ? {} : { author: exactAuthor(signal) }),
          ...(exactTitleOrExcerpt(signal) === undefined
            ? {}
            : { observed_hook: exactTitleOrExcerpt(signal) }),
          ...(observedFormat(signal.source) === undefined
            ? {}
            : { observed_format_family: observedFormat(signal.source) }),
          relevance_reason: `This exact stored source supports the selected pattern for ${input.context.audience}.`,
        })),
        preserve: ["The recognizable situation and the useful problem-solving pattern"],
        transform: [
          `Translate the pattern into ${input.context.name}'s credible role for ${input.context.audience}.`,
          `Use a new structure, examples, and wording suited to ${input.channel}.`,
        ],
        do_not_copy: [
          "Original wording, creator identity, creative assets, examples, or protected expression",
        ],
        transformed_concept: `${input.context.name} demonstrates how ${input.topic} changes a concrete decision for ${input.context.audience}.`,
        blueprint: deriveBlueprint(
          input,
          boundSignals.some((signal) => selectedFormatMatchesObservedPattern(signal, input.format)),
        ),
        remix_by: window.valid_until,
      };
    }
    case "WAIT": {
      const failureReasons = waitFailureReasons(input);
      return {
        action: "WAIT",
        considered_opportunity: input.topic,
        failure_reasons: failureReasons,
        do_not_act_on: [
          "Do not publish, reply, or remix this opportunity as if it were sufficiently supported yet.",
        ],
        watch_conditions: watchConditions(failureReasons, input),
        recheck_at: window.recheck_at,
      };
    }
  }
}

function draftFromBlueprint(action: "PUBLISH" | "REMIX", blueprint: ContentBlueprint): string {
  const opening = blueprint.hook_variants.find((variant) => variant.style === "direct")!.text;
  return [
    opening,
    "",
    blueprint.audience_tension,
    "",
    ...blueprint.structure.map((step) => `- ${step}`),
    "",
    blueprint.product_role,
    "",
    blueprint.cta,
    "",
    `[${action} draft — founder approval required; do not auto-publish]`,
  ].join("\n");
}

/**
 * Upgrades one immutable deterministic decision into the versioned product
 * contract. Factual target/source fields are copied only from the exact stored
 * signal allowlist. The function has no provider or model access.
 */
export function deriveVersionedNextMove(input: DecisionContractInput): VersionedNextMove {
  const boundSignals = bindStoredEvidence(input);
  const trendWindow = deriveTrendWindow(input, boundSignals);
  const breakoutPotential = deriveBreakoutPotential(input);
  const details = deriveActionDetails(input, boundSignals, trendWindow);
  const generationLevel = input.generationLevel ?? "brief";
  const draftContent =
    generationLevel === "draft" && (details.action === "PUBLISH" || details.action === "REMIX")
      ? draftFromBlueprint(details.action, details.blueprint)
      : undefined;
  return VersionedNextMoveSchema.parse({
    contractVersion: NEXT_MOVE_CONTRACT_VERSION,
    generationLevel,
    action: input.action,
    channel: input.channel,
    topic: input.topic,
    angle: input.angle,
    format: input.format,
    hook: input.hook,
    outline: input.outline,
    cta: input.cta,
    priority: input.priority,
    confidence: input.confidence,
    validUntil: trendWindow.valid_until,
    trendWindow,
    breakoutPotential,
    details,
    ...(draftContent === undefined ? {} : { draftContent }),
  });
}

export { assertActionDetailsBoundToStoredEvidence } from "@trendsfast/schemas";
