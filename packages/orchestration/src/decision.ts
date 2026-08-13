import type {
  ContentCapabilities,
  GenerationLevel,
  ProjectContext,
  Signal,
  SignalMetricSnapshot,
  VoiceProfile,
} from "@trendsfast/schemas";
import type { ProviderMeasurement } from "@trendsfast/providers";
import {
  clusterSignals,
  classifyTrendTruth,
  deriveOpportunityScoreComponents,
  enforceActionQualityFloor,
  scoreOpportunityV1,
  sourceIndependenceKey,
  type NextMoveAction,
  type ScoringSignal,
  type SignalCluster,
  type TrendSignalClass,
} from "@trendsfast/scoring";
import type { DecisionDraft } from "./state-machine";
import { deriveVersionedNextMove } from "./decision-contract";
import { formatHasEnabledCapability } from "./content-capability";

export const DETERMINISTIC_PROMPT_VERSION = "deterministic-ranking-v3";

function words(values: string[]): string[] {
  return values.flatMap((value) => value.split(/\s+/)).filter(Boolean);
}

function toScoringSignal(signal: Signal): ScoringSignal {
  const author = signal.author
    ? {
        ...(signal.author.id === undefined ? {} : { id: signal.author.id }),
        ...(signal.author.handle === undefined ? {} : { handle: signal.author.handle }),
        ...(signal.author.displayName === undefined
          ? {}
          : { displayName: signal.author.displayName }),
        ...(signal.author.followerCount === undefined
          ? {}
          : { followerCount: signal.author.followerCount }),
      }
    : undefined;
  const metrics = Object.fromEntries(
    Object.entries(signal.metrics).filter(
      (entry): entry is [string, number] => typeof entry[1] === "number",
    ),
  );
  return {
    id: signal.id,
    source: signal.source,
    sourceId: signal.sourceId,
    url: signal.url,
    ...(signal.title === undefined ? {} : { title: signal.title }),
    ...(signal.textExcerpt === undefined ? {} : { textExcerpt: signal.textExcerpt }),
    ...(author === undefined ? {} : { author }),
    ...(signal.publishedAt === undefined ? {} : { publishedAt: signal.publishedAt }),
    observedAt: signal.observedAt,
    ...(signal.language === undefined ? {} : { language: signal.language }),
    metrics,
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

function adequateCoverage(coverage: Record<string, string>): boolean {
  const ok = (slug: string) => ["SUCCESS", "SUCCEEDED", "DEGRADED"].includes(coverage[slug] ?? "");
  return (
    ok("website") && ok("google_trends") && ok("hacker_news") && ["x", "tavily", "github"].some(ok)
  );
}

function actionFor(cluster: SignalCluster, signalClass: TrendSignalClass): NextMoveAction {
  if (signalClass === "INSUFFICIENT_SIGNAL") return "WAIT";
  if (signalClass === "EMERGING_SIGNAL")
    return cluster.signals.some((signal) => ["x", "hacker_news"].includes(signal.source))
      ? "REPLY"
      : "WAIT";
  if (
    cluster.signals.some((signal) => signal.source === "youtube") &&
    cluster.independentSourceCount >= 2
  )
    return "REMIX";
  return "PUBLISH";
}

function saturationLabel(value: number): DecisionDraft["saturation"] {
  if (value < 0.25) return "low";
  if (value < 0.5) return "low_to_medium";
  if (value < 0.7) return "medium";
  return "high";
}

function selectedProductionFormat(input: {
  context: ProjectContext;
  contentCapabilities?: ContentCapabilities;
}): string | undefined {
  const capabilities = input.contentCapabilities;
  if (!capabilities) return input.context.availableFormats[0];
  return input.context.availableFormats.find((format) =>
    formatHasEnabledCapability(format, capabilities),
  );
}

function coverageLimitations(coverage: Record<string, string>): string[] {
  return Object.entries(coverage)
    .filter(([, status]) => !["SUCCESS", "SUCCEEDED"].includes(status))
    .map(([source, status]) => `${source} coverage was ${status.toLowerCase()}.`);
}

function selectEvidenceSignals(cluster: SignalCluster | undefined, maximum = 4): ScoringSignal[] {
  if (!cluster) return [];
  const selected: ScoringSignal[] = [];
  const selectedIds = new Set<string>();
  const independenceKeys = new Set<string>();
  for (const signal of cluster.signals) {
    const key = sourceIndependenceKey(signal);
    if (independenceKeys.has(key)) continue;
    selected.push(signal);
    selectedIds.add(signal.id);
    independenceKeys.add(key);
    if (selected.length === maximum) return selected;
  }
  for (const signal of cluster.signals) {
    if (selectedIds.has(signal.id)) continue;
    selected.push(signal);
    if (selected.length === maximum) break;
  }
  return selected;
}

export async function decideDeterministically(input: {
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
}): Promise<DecisionDraft> {
  const productionFormat = selectedProductionFormat(input);
  const clusters = clusterSignals(input.signals.map(toScoringSignal));
  const evaluated = clusters
    .map((cluster) => {
      const measurement = input.measurements.filter((item) =>
        cluster.signals.some((signal) => signal.queryId === item.queryId),
      );
      const truth = classifyTrendTruth({
        signals: cluster.signals,
        measurements: measurement,
        snapshots: (input.snapshots ?? [])
          .filter((snapshot) => cluster.memberIds.includes(snapshot.signalId))
          .map((snapshot) => ({
            signalId: snapshot.signalId,
            observedAt: snapshot.observedAt,
            metrics: Object.fromEntries(
              Object.entries(snapshot.metrics).filter(
                (entry): entry is [string, number] => typeof entry[1] === "number",
              ),
            ),
          })),
        now: input.now,
        strengthBySignalId: Object.fromEntries(cluster.memberIds.map((id) => [id, 0.9])),
      });
      const classifiedAction = actionFor(cluster, truth.signalClass);
      const productionRequired = classifiedAction === "PUBLISH" || classifiedAction === "REMIX";
      const components = deriveOpportunityScoreComponents({
        cluster,
        audienceTerms: words([input.context.audience, input.objective ?? ""]),
        productTerms: words([
          input.context.category,
          input.context.problem,
          input.context.desiredOutcome,
        ]),
        credibleTerms: words([...input.context.credibleTopics, ...input.context.credibleClaims]),
        signalClass: truth.signalClass,
        now: input.now,
        formatFit: productionFormat ? 0.8 : productionRequired ? 0 : 0.7,
      });
      const score = scoreOpportunityV1(components);
      const baseQuality = enforceActionQualityFloor({
        id: cluster.id,
        requestedAction: classifiedAction,
        priority: score.priority,
        audienceFit: components.audienceFit,
        productRelevance: components.productRelevance,
        productCredibility: components.productCredibility,
        evidenceCount: cluster.signals.length,
        independentSourceCount: cluster.independentSourceCount,
        signalClass: truth.signalClass,
        saturation: components.saturation,
        hasDefensibleInsight: components.productRelevance >= 0.7,
        hasValidOriginalUrl: cluster.signals.every((signal) => /^https?:\/\//.test(signal.url)),
        hasConcreteContribution: components.productCredibility >= 0.65,
        hasProvenFormatOrTopic: cluster.signals.length >= 1,
        hasProductSpecificTranslation: components.productRelevance >= 0.65,
        criticalProviderFailure: !adequateCoverage(input.coverage),
        coverageAdequate: adequateCoverage(input.coverage),
        recent: components.remainingWindow >= 0.35,
      });
      const quality =
        productionRequired && !productionFormat
          ? {
              action: "WAIT" as const,
              passed: false,
              reasons: ["NO_ENABLED_PRODUCTION_CAPABILITY_MATCHES_FORMAT"],
            }
          : baseQuality;
      const requestedAction = classifiedAction;
      return { cluster, truth, components, score, requestedAction, quality };
    })
    .sort(
      (left, right) =>
        right.score.priority - left.score.priority ||
        left.cluster.id.localeCompare(right.cluster.id),
    );

  const winner = evaluated.find(
    (candidate) => candidate.quality.passed && candidate.quality.action !== "WAIT",
  );
  const fallback = evaluated[0];
  const action: NextMoveAction = winner?.quality.action ?? "WAIT";
  const chosen = winner ?? fallback;
  const capabilityBlockedProduction =
    !productionFormat &&
    evaluated.some((candidate) =>
      candidate.quality.reasons.includes("NO_ENABLED_PRODUCTION_CAPABILITY_MATCHES_FORMAT"),
    );
  const topic =
    chosen?.cluster.representativeTitle ?? `No credible ${input.context.category} opportunity yet`;
  const angle =
    action === "WAIT"
      ? `Hold distribution until an independent, current signal supports a claim ${input.context.name} can credibly make.`
      : `Translate the evidence into a product-specific ${input.context.credibleTopics[0] ?? input.context.category} insight for ${input.context.audience}${input.objective ? `, in service of the saved objective: ${input.objective}` : ""}.`;
  const effectiveAction = action;
  const channel = input.context.suitableChannels[0] ?? "x";
  const format = effectiveAction === "REPLY" ? "reply" : (productionFormat ?? "none");
  const truth = chosen?.truth ?? {
    signalClass: "INSUFFICIENT_SIGNAL" as const,
    independentSourceCount: 0,
    reason: "No stored signals were available.",
  };
  const qualityReasons = evaluated.flatMap((candidate) => candidate.quality.reasons);
  const limitations = [
    ...coverageLimitations(input.coverage),
    ...(!winner ? ["No candidate passed the deterministic action quality floor."] : []),
    ...(capabilityBlockedProduction
      ? ["No enabled production capability matched the requested or saved formats."]
      : []),
    ...(input.signals.some((signal) => signal.provenance.provider.startsWith("fixture:"))
      ? ["Deterministic fixture evidence is not live provider evidence."]
      : []),
  ];
  const evidenceSignals = selectEvidenceSignals(
    effectiveAction === "WAIT" ? chosen?.cluster : winner?.cluster,
  );
  if (effectiveAction === "REPLY") {
    evidenceSignals.sort((left, right) => {
      const leftEligible = ["x", "hacker_news"].includes(left.source) ? 1 : 0;
      const rightEligible = ["x", "hacker_news"].includes(right.source) ? 1 : 0;
      return rightEligible - leftEligible;
    });
  }
  const evidenceSignalIds = evidenceSignals.map((signal) => signal.id);
  const evidenceIndependentSourceCount = new Set(evidenceSignals.map(sourceIndependenceKey)).size;
  const score = chosen?.score;
  const hook =
    effectiveAction === "WAIT"
      ? "Do not force a move from thin evidence."
      : `The ${input.context.category} lesson most founders miss: evidence must change the decision.`;
  const outline =
    effectiveAction === "WAIT"
      ? [
          "Keep the strongest query cluster.",
          "Wait for independent corroboration or measured demand.",
          "Re-run before publishing the held draft.",
        ]
      : [
          "Open with the product-specific tension.",
          "Show the strongest independent evidence receipts.",
          "Give one useful framework or worked example.",
          "Close with a low-pressure next step.",
        ];
  const cta =
    effectiveAction === "WAIT"
      ? "Re-check when the evidence window changes."
      : "Invite one relevant founder to compare the framework with their situation.";
  const move = deriveVersionedNextMove({
    action: effectiveAction,
    context: input.context,
    topic,
    channel,
    format,
    angle,
    hook,
    outline,
    cta,
    priority: effectiveAction === "WAIT" ? 0 : (score?.priority ?? 50),
    confidence:
      effectiveAction === "WAIT" ? 0.88 : Math.min(0.9, 0.55 + (score?.rawScore ?? 0) * 0.45),
    signalClass: truth.signalClass,
    saturation: saturationLabel(chosen?.components.saturation ?? 0),
    ...(chosen?.components ? { components: chosen.components } : {}),
    storedSignals: input.signals,
    evidenceSignalIds,
    qualityReasons,
    coverage: input.coverage,
    ...(input.generationLevel ? { generationLevel: input.generationLevel } : {}),
    ...(input.contentCapabilities ? { contentCapabilities: input.contentCapabilities } : {}),
    ...(input.voiceProfile ? { voiceProfile: input.voiceProfile } : {}),
    now: input.now,
  });
  return {
    move: {
      action: move.action,
      channel: move.channel,
      topic: move.topic,
      angle: move.angle,
      format: move.format,
      hook: move.hook,
      outline: move.outline,
      cta: move.cta,
      priority: move.priority,
      confidence: move.confidence,
      validUntil: move.validUntil,
    },
    versionedMove: move,
    whyNow: truth.reason,
    signalClass: truth.signalClass,
    independentSourceCount: evidenceIndependentSourceCount,
    saturation: saturationLabel(chosen?.components.saturation ?? 0),
    limitations: [...new Set(limitations)],
    evidenceSignalIds,
    promptVersion: DETERMINISTIC_PROMPT_VERSION,
    scoreVersion: score?.version ?? "opportunity-v1",
    confidenceRationale:
      effectiveAction === "WAIT"
        ? `The quality floor rejected action: ${[...new Set(qualityReasons)].join(", ") || "insufficient evidence"}.`
        : `The deterministic v1 score passed the ${effectiveAction} quality floor.`,
  };
}
