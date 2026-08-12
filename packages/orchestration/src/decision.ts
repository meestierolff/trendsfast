import type { ProjectContext, Signal } from "@trendsfast/schemas";
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

export const DETERMINISTIC_PROMPT_VERSION = "deterministic-ranking-v2";

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
  measurements: ProviderMeasurement[];
  coverage: Record<string, string>;
  now: Date;
}): Promise<DecisionDraft> {
  const clusters = clusterSignals(input.signals.map(toScoringSignal));
  const evaluated = clusters
    .map((cluster) => {
      const measurement = input.measurements.filter((item) =>
        cluster.signals.some((signal) => signal.queryId === item.queryId),
      );
      const truth = classifyTrendTruth({
        signals: cluster.signals,
        measurements: measurement,
        now: input.now,
        strengthBySignalId: Object.fromEntries(cluster.memberIds.map((id) => [id, 0.9])),
      });
      const components = deriveOpportunityScoreComponents({
        cluster,
        audienceTerms: words([input.context.audience]),
        productTerms: words([
          input.context.category,
          input.context.problem,
          input.context.desiredOutcome,
        ]),
        credibleTerms: words([...input.context.credibleTopics, ...input.context.credibleClaims]),
        signalClass: truth.signalClass,
        now: input.now,
        formatFit: 0.8,
      });
      const score = scoreOpportunityV1(components);
      const requestedAction = actionFor(cluster, truth.signalClass);
      const quality = enforceActionQualityFloor({
        id: cluster.id,
        requestedAction,
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
  const topic =
    chosen?.cluster.representativeTitle ?? `No credible ${input.context.category} opportunity yet`;
  const angle =
    action === "WAIT"
      ? `Hold distribution until an independent, current signal supports a claim ${input.context.name} can credibly make.`
      : `Translate the evidence into a product-specific ${input.context.credibleTopics[0] ?? input.context.category} insight for ${input.context.audience}.`;
  const effectiveAction = action;
  const channel = input.context.suitableChannels[0] ?? "x";
  const format = input.context.availableFormats[0] ?? "founder_text";
  const truth = chosen?.truth ?? {
    signalClass: "INSUFFICIENT_SIGNAL" as const,
    independentSourceCount: 0,
    reason: "No stored signals were available.",
  };
  const qualityReasons = evaluated.flatMap((candidate) => candidate.quality.reasons);
  const limitations = [
    ...coverageLimitations(input.coverage),
    ...(!winner ? ["No candidate passed the deterministic action quality floor."] : []),
    ...(input.signals.some((signal) => signal.provenance.provider.startsWith("fixture:"))
      ? ["Deterministic fixture evidence is not live provider evidence."]
      : []),
  ];
  const windowHours = effectiveAction === "REPLY" ? 12 : effectiveAction === "WAIT" ? 72 : 48;
  const evidenceSignals = selectEvidenceSignals(
    effectiveAction === "WAIT" ? chosen?.cluster : winner?.cluster,
  );
  const evidenceSignalIds = evidenceSignals.map((signal) => signal.id);
  const evidenceIndependentSourceCount = new Set(evidenceSignals.map(sourceIndependenceKey)).size;
  const score = chosen?.score;
  return {
    move: {
      action: effectiveAction,
      channel,
      topic,
      angle,
      format,
      hook:
        effectiveAction === "WAIT"
          ? "Do not force a move from thin evidence."
          : `The ${input.context.category} lesson most founders miss: evidence must change the decision.`,
      outline:
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
            ],
      cta:
        effectiveAction === "WAIT"
          ? "Re-check when the evidence window changes."
          : "Invite one relevant founder to compare the framework with their situation.",
      priority: effectiveAction === "WAIT" ? 0 : (score?.priority ?? 50),
      confidence:
        effectiveAction === "WAIT" ? 0.88 : Math.min(0.9, 0.55 + (score?.rawScore ?? 0) * 0.45),
      validUntil: new Date(input.now.getTime() + windowHours * 3_600_000).toISOString(),
    },
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
