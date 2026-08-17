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
  recencyScore,
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
import {
  classifyUnsafeContentSet,
  hasFinancialSafetyContext,
  SAFE_DISTRIBUTION_WAIT_PROSE,
  UNSAFE_CONTENT_LIMITATION,
  UNSAFE_CONTENT_QUALITY_REASON,
} from "./content-safety";

export const DETERMINISTIC_PROMPT_VERSION = "deterministic-ranking-v3";

const REPLY_TARGET_MAX_AGE_HOURS = 72;
const MINIMUM_SNAPSHOT_SEPARATION_MS = 60_000;

function words(values: string[]): string[] {
  return values.flatMap((value) => value.split(/\s+/)).filter(Boolean);
}

function timestampAtOrBefore(value: string, now: Date): boolean {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) && timestamp <= now.getTime();
}

function signalWasAvailableAtDecisionTime(signal: Signal, now: Date): boolean {
  if (signal.source === "x" && signal.publishedAt === undefined) return false;
  return (
    timestampAtOrBefore(signal.observedAt, now) &&
    timestampAtOrBefore(signal.provenance.retrievedAt, now) &&
    (signal.publishedAt === undefined || timestampAtOrBefore(signal.publishedAt, now))
  );
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
  const ok = (slug: string) => ["SUCCESS", "SUCCEEDED"].includes(coverage[slug] ?? "");
  return (
    ok("website") && ok("google_trends") && ok("hacker_news") && ["x", "tavily", "github"].some(ok)
  );
}

function observedTimestamp(signal: ScoringSignal): number {
  return new Date(signal.publishedAt ?? signal.observedAt).getTime();
}

function isCurrentReplySignal(signal: ScoringSignal, now: Date): boolean {
  if (signal.source !== "x" && signal.source !== "hacker_news") return false;
  if (signal.source === "x" && signal.publishedAt === undefined) return false;
  if (
    !timestampAtOrBefore(signal.observedAt, now) ||
    !timestampAtOrBefore(signal.provenance.retrievedAt, now)
  ) {
    return false;
  }
  const timestamp = observedTimestamp(signal);
  if (!Number.isFinite(timestamp) || timestamp > now.getTime()) return false;
  return (now.getTime() - timestamp) / 3_600_000 <= REPLY_TARGET_MAX_AGE_HOURS;
}

function currentReplyTarget(
  cluster: SignalCluster | undefined,
  now: Date,
): ScoringSignal | undefined {
  if (!cluster) return undefined;
  return cluster.signals
    .filter((signal) => isCurrentReplySignal(signal, now))
    .sort(
      (left, right) =>
        observedTimestamp(right) - observedTimestamp(left) || left.id.localeCompare(right.id),
    )[0];
}

function remixSourceTarget(cluster: SignalCluster | undefined): ScoringSignal | undefined {
  if (!cluster) return undefined;
  return cluster.signals
    .filter((signal) => signal.source === "youtube")
    .sort(
      (left, right) =>
        observedTimestamp(right) - observedTimestamp(left) || left.id.localeCompare(right.id),
    )[0];
}

function actionFor(
  cluster: SignalCluster,
  signalClass: TrendSignalClass,
  now: Date,
): NextMoveAction {
  if (signalClass === "INSUFFICIENT_SIGNAL") return "WAIT";
  if (signalClass === "EMERGING_SIGNAL") return currentReplyTarget(cluster, now) ? "REPLY" : "WAIT";
  if (remixSourceTarget(cluster) && cluster.independentSourceCount >= 2) return "REMIX";
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

function representativeSignal(cluster: SignalCluster): ScoringSignal {
  const representative = cluster.signals.find(
    (signal) => signal.id === cluster.representativeSignalId,
  );
  if (!representative) {
    throw new Error("Selected cluster representative must be an exact stored cluster signal");
  }
  return representative;
}

function positiveExternalMeasurement(measurement: ProviderMeasurement): boolean {
  if (measurement.kind !== "EXTERNAL_TIME_SERIES" || measurement.source !== "google_trends") {
    return false;
  }
  const points = measurement.points
    .map((point) => ({ timestamp: new Date(point.at).getTime(), value: point.value }))
    .filter((point) => Number.isFinite(point.timestamp) && Number.isFinite(point.value))
    .sort((left, right) => left.timestamp - right.timestamp);
  const first = points[0];
  const last = points.at(-1);
  return Boolean(first && last && last.timestamp > first.timestamp && last.value > first.value);
}

function signalsWithPositiveSnapshotPairs(
  cluster: SignalCluster,
  snapshots: readonly SignalMetricSnapshot[],
): string[] {
  return cluster.memberIds.filter((signalId) => {
    const ordered = snapshots
      .filter((snapshot) => snapshot.signalId === signalId)
      .sort(
        (left, right) => new Date(left.observedAt).getTime() - new Date(right.observedAt).getTime(),
      );
    for (let left = 0; left < ordered.length; left += 1) {
      for (let right = left + 1; right < ordered.length; right += 1) {
        const first = ordered[left]!;
        const second = ordered[right]!;
        const separation =
          new Date(second.observedAt).getTime() - new Date(first.observedAt).getTime();
        if (!Number.isFinite(separation) || separation < MINIMUM_SNAPSHOT_SEPARATION_MS) continue;
        if (
          Object.keys(first.metrics).some((metric) => {
            const before = first.metrics[metric as keyof typeof first.metrics];
            const after = second.metrics[metric as keyof typeof second.metrics];
            return (
              typeof before === "number" &&
              Number.isFinite(before) &&
              typeof after === "number" &&
              Number.isFinite(after) &&
              after > before
            );
          })
        ) {
          return true;
        }
      }
    }
    return false;
  });
}

function truthEvidenceSignalIds(input: {
  cluster: SignalCluster;
  signalClass: TrendSignalClass;
  measurements: readonly ProviderMeasurement[];
  snapshots: readonly SignalMetricSnapshot[];
}): string[] {
  if (input.signalClass === "MEASURED_EXTERNAL_SERIES") {
    const positiveQueryIds = new Set(
      input.measurements
        .filter(positiveExternalMeasurement)
        .map((measurement) => measurement.queryId),
    );
    return input.cluster.signals
      .filter((signal) => positiveQueryIds.has(signal.queryId))
      .map((signal) => signal.id);
  }
  if (input.signalClass === "MEASURED_INTERNAL_VELOCITY") {
    return signalsWithPositiveSnapshotPairs(input.cluster, input.snapshots);
  }
  return [];
}

function selectEvidenceSignals(
  cluster: SignalCluster | undefined,
  maximum = 4,
  requiredFirst: readonly ScoringSignal[] = [],
  optionalSignalAllowed: (signal: ScoringSignal) => boolean = () => true,
): ScoringSignal[] {
  if (!cluster) return [];
  const selected: ScoringSignal[] = [];
  const selectedIds = new Set<string>();
  const independenceKeys = new Set<string>();
  for (const signal of requiredFirst) {
    if (selectedIds.has(signal.id)) continue;
    selected.push(signal);
    selectedIds.add(signal.id);
    independenceKeys.add(sourceIndependenceKey(signal));
  }
  const ordered = cluster.signals.filter(
    (signal) => !selectedIds.has(signal.id) && optionalSignalAllowed(signal),
  );
  const minimumIndependentSources = Math.min(2, cluster.independentSourceCount);
  for (const signal of ordered) {
    const key = sourceIndependenceKey(signal);
    if (independenceKeys.has(key)) continue;
    selected.push(signal);
    selectedIds.add(signal.id);
    independenceKeys.add(key);
    if (selected.length >= maximum && independenceKeys.size >= minimumIndependentSources) {
      return selected;
    }
  }
  for (const signal of ordered) {
    if (selectedIds.has(signal.id)) continue;
    selected.push(signal);
    selectedIds.add(signal.id);
    if (selected.length >= maximum) break;
  }
  return selected;
}

export function selectEvidenceSignalsForAction(
  cluster: SignalCluster | undefined,
  action: NextMoveAction,
  now: Date,
  maximum = 4,
  requiredSignalIds: readonly string[] = [],
): ScoringSignal[] {
  const replyTarget = action === "REPLY" ? currentReplyTarget(cluster, now) : undefined;
  if (action === "REPLY" && !replyTarget) {
    throw new Error("REPLY requires a current exact stored X or Hacker News primary target");
  }
  const remixTarget = action === "REMIX" ? remixSourceTarget(cluster) : undefined;
  if (action === "REMIX" && !remixTarget) {
    throw new Error("REMIX requires an exact stored YouTube source target");
  }
  const clusterSignalsById = new Map(cluster?.signals.map((signal) => [signal.id, signal]));
  const requiredSignals = requiredSignalIds.map((id) => {
    const signal = clusterSignalsById.get(id);
    if (!signal) throw new Error(`Required decision evidence ${id} is not in the selected cluster`);
    return signal;
  });
  return selectEvidenceSignals(
    cluster,
    maximum,
    [
      ...(replyTarget ? [replyTarget] : []),
      ...(remixTarget ? [remixTarget] : []),
      ...requiredSignals,
    ],
    (signal) =>
      action !== "REPLY" ||
      (signal.source !== "x" && signal.source !== "hacker_news") ||
      isCurrentReplySignal(signal, now),
  );
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
  const eligibleSignals = input.signals.filter((signal) =>
    signalWasAvailableAtDecisionTime(signal, input.now),
  );
  const eligibleSnapshots = (input.snapshots ?? []).filter((snapshot) =>
    timestampAtOrBefore(snapshot.observedAt, input.now),
  );
  const eligibleMeasurements = input.measurements.map((measurement) => ({
    ...measurement,
    points: measurement.points.filter((point) => timestampAtOrBefore(point.at, input.now)),
  }));
  const futureEvidenceExcluded =
    eligibleSignals.length !== input.signals.length ||
    eligibleSnapshots.length !== (input.snapshots ?? []).length ||
    eligibleMeasurements.some(
      (measurement, index) =>
        measurement.points.length !== input.measurements[index]?.points.length,
    );
  const clusters = clusterSignals(eligibleSignals.map(toScoringSignal));
  const evaluated = clusters
    .map((cluster) => {
      const measurement = eligibleMeasurements.filter((item) =>
        cluster.signals.some((signal) => signal.queryId === item.queryId),
      );
      const snapshots = eligibleSnapshots.filter((snapshot) =>
        cluster.memberIds.includes(snapshot.signalId),
      );
      const truth = classifyTrendTruth({
        signals: cluster.signals,
        measurements: measurement,
        snapshots: snapshots.map((snapshot) => ({
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
      const classifiedAction = actionFor(cluster, truth.signalClass, input.now);
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
      const requiredEvidenceSignalIds = [
        representativeSignal(cluster).id,
        ...truthEvidenceSignalIds({
          cluster,
          signalClass: truth.signalClass,
          measurements: measurement,
          snapshots,
        }),
      ];
      return {
        cluster,
        truth,
        components,
        score,
        requestedAction,
        quality,
        requiredEvidenceSignalIds: [...new Set(requiredEvidenceSignalIds)],
      };
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
  const selectedAction: NextMoveAction = winner?.quality.action ?? "WAIT";
  const chosen = winner ?? fallback;
  const capabilityBlockedProduction =
    !productionFormat &&
    evaluated.some((candidate) =>
      candidate.quality.reasons.includes("NO_ENABLED_PRODUCTION_CAPABILITY_MATCHES_FORMAT"),
    );
  const selectedTopic =
    chosen?.cluster.representativeTitle ?? `No credible ${input.context.category} opportunity yet`;
  const selectedAngle =
    selectedAction === "WAIT"
      ? `Hold distribution until an independent, current signal supports a claim ${input.context.name} can credibly make.`
      : `Translate the evidence into a product-specific ${input.context.credibleTopics[0] ?? input.context.category} insight for ${input.context.audience}${input.objective ? `, in service of the saved objective: ${input.objective}` : ""}.`;
  const selectedHook =
    selectedAction === "WAIT"
      ? "Do not force a move from thin evidence."
      : `The ${input.context.category} lesson most founders miss: evidence must change the decision.`;
  const selectedOutline =
    selectedAction === "WAIT"
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
  const selectedCta =
    selectedAction === "WAIT"
      ? "Re-check when the evidence window changes."
      : "Invite one relevant founder to compare the framework with their situation.";
  const unsafeContentKinds = classifyUnsafeContentSet(
    [selectedTopic, selectedAngle, selectedHook, ...selectedOutline, selectedCta],
    {
      rejectAnyNumber: false,
      financialContext: hasFinancialSafetyContext(input.context),
    },
  );
  const safetyHeld = unsafeContentKinds.length > 0;
  const effectiveAction: NextMoveAction = safetyHeld ? "WAIT" : selectedAction;
  const topic = safetyHeld ? SAFE_DISTRIBUTION_WAIT_PROSE.topic : selectedTopic;
  const angle = safetyHeld ? SAFE_DISTRIBUTION_WAIT_PROSE.angle : selectedAngle;
  const hook = safetyHeld ? SAFE_DISTRIBUTION_WAIT_PROSE.hook : selectedHook;
  const outline = safetyHeld ? [...SAFE_DISTRIBUTION_WAIT_PROSE.outline] : selectedOutline;
  const cta = safetyHeld ? SAFE_DISTRIBUTION_WAIT_PROSE.cta : selectedCta;
  const format = effectiveAction === "REPLY" ? "reply" : (productionFormat ?? "none");
  const truth = chosen?.truth ?? {
    signalClass: "INSUFFICIENT_SIGNAL" as const,
    independentSourceCount: 0,
    reason: "No stored signals were available.",
  };
  const qualityReasons = [
    ...evaluated.flatMap((candidate) => candidate.quality.reasons),
    ...(safetyHeld ? [UNSAFE_CONTENT_QUALITY_REASON] : []),
  ];
  const limitations = [
    ...coverageLimitations(input.coverage),
    ...input.context.assumptions.map((assumption) => `Saved assumption: ${assumption}`),
    ...(!winner ? ["No candidate passed the deterministic action quality floor."] : []),
    ...(capabilityBlockedProduction
      ? ["No enabled production capability matched the requested or saved formats."]
      : []),
    ...(input.signals.some((signal) => signal.provenance.provider.startsWith("fixture:"))
      ? ["Deterministic fixture evidence is not live provider evidence."]
      : []),
    ...(futureEvidenceExcluded
      ? [
          "Evidence missing an authoritative timestamp or dated after the decision time was excluded from ranking and actionability.",
        ]
      : []),
    ...(safetyHeld ? [UNSAFE_CONTENT_LIMITATION] : []),
  ];
  const evidenceSelectionAction = safetyHeld ? selectedAction : effectiveAction;
  const evidenceSignals = selectEvidenceSignalsForAction(
    effectiveAction === "WAIT" ? chosen?.cluster : winner?.cluster,
    evidenceSelectionAction,
    input.now,
    4,
    chosen?.requiredEvidenceSignalIds,
  );
  const primaryReplySignal = effectiveAction === "REPLY" ? evidenceSignals[0] : undefined;
  const channel = primaryReplySignal?.source ?? input.context.suitableChannels[0] ?? "x";
  const evidenceSignalIds = evidenceSignals.map((signal) => signal.id);
  const evidenceIndependentSourceCount = new Set(evidenceSignals.map(sourceIndependenceKey)).size;
  const score = chosen?.score;
  const contractComponents =
    primaryReplySignal && chosen?.components
      ? {
          ...chosen.components,
          remainingWindow: recencyScore(primaryReplySignal, input.now),
        }
      : chosen?.components;
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
    ...(contractComponents ? { components: contractComponents } : {}),
    storedSignals: eligibleSignals,
    evidenceSignalIds,
    ...(primaryReplySignal ? { timingSignalId: primaryReplySignal.id } : {}),
    qualityReasons,
    coverage: input.coverage,
    ...(input.generationLevel ? { generationLevel: input.generationLevel } : {}),
    ...(input.contentCapabilities ? { contentCapabilities: input.contentCapabilities } : {}),
    ...(input.voiceProfile ? { voiceProfile: input.voiceProfile } : {}),
    now: input.now,
  });
  const contractSafetyHeld = move.action === "WAIT" && effectiveAction !== "WAIT";
  const finalQualityReasons = contractSafetyHeld
    ? [...new Set([...qualityReasons, UNSAFE_CONTENT_QUALITY_REASON])]
    : [...new Set(qualityReasons)];
  const finalLimitations = contractSafetyHeld
    ? [...new Set([...limitations, UNSAFE_CONTENT_LIMITATION])]
    : [...new Set(limitations)];
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
    limitations: finalLimitations,
    evidenceSignalIds,
    promptVersion: DETERMINISTIC_PROMPT_VERSION,
    scoreVersion: score?.version ?? "opportunity-v1",
    confidenceRationale:
      move.action === "WAIT"
        ? `The quality floor rejected action: ${finalQualityReasons.join(", ") || "insufficient evidence"}.`
        : `The deterministic v1 score passed the ${move.action} quality floor.`,
  };
}
