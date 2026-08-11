import { countIndependentSources } from "./clustering";
import type {
  ScoringMetricSnapshot,
  ScoringSignal,
  TrendMeasurement,
  TrendSignalClass,
} from "./types";

export type TrendTruthResult = {
  signalClass: TrendSignalClass;
  measured: boolean;
  independentSourceCount: number;
  reason: string;
};

type TrendTruthInput = {
  signals: ScoringSignal[];
  measurements: TrendMeasurement[];
  snapshots?: ScoringMetricSnapshot[];
  strengthBySignalId?: Readonly<Record<string, number>>;
  now?: Date;
  corroborationWindowHours?: number;
  emergingWindowHours?: number;
  minimumSnapshotSeparationMs?: number;
};

function positiveExternalSeries(measurement: TrendMeasurement): boolean {
  if (measurement.kind !== "EXTERNAL_TIME_SERIES" || measurement.source !== "google_trends")
    return false;
  const points = measurement.points
    .map((point) => ({ timestamp: new Date(point.at).getTime(), value: point.value }))
    .filter((point) => Number.isFinite(point.timestamp) && Number.isFinite(point.value))
    .sort((left, right) => left.timestamp - right.timestamp);
  const first = points[0];
  const last = points.at(-1);
  return Boolean(first && last && last.timestamp > first.timestamp && last.value > first.value);
}

function positiveSnapshotPair(
  snapshots: ScoringMetricSnapshot[],
  minimumSeparationMs: number,
): boolean {
  const bySignal = new Map<string, ScoringMetricSnapshot[]>();
  for (const snapshot of snapshots) {
    const group = bySignal.get(snapshot.signalId) ?? [];
    group.push(snapshot);
    bySignal.set(snapshot.signalId, group);
  }
  for (const group of bySignal.values()) {
    group.sort((a, b) => new Date(a.observedAt).getTime() - new Date(b.observedAt).getTime());
    for (let left = 0; left < group.length; left += 1) {
      for (let right = left + 1; right < group.length; right += 1) {
        const first = group[left]!;
        const second = group[right]!;
        const separation =
          new Date(second.observedAt).getTime() - new Date(first.observedAt).getTime();
        if (!Number.isFinite(separation) || separation < minimumSeparationMs) continue;
        const positiveMetric = Object.keys(first.metrics).some((metric) => {
          const earlier = first.metrics[metric as keyof typeof first.metrics];
          const later = second.metrics[metric as keyof typeof second.metrics];
          return (
            typeof earlier === "number" &&
            Number.isFinite(earlier) &&
            typeof later === "number" &&
            Number.isFinite(later) &&
            later > earlier
          );
        });
        if (positiveMetric) return true;
      }
    }
  }
  return false;
}

function ageHours(signal: ScoringSignal, now: Date): number {
  const timestamp = new Date(signal.publishedAt ?? signal.observedAt).getTime();
  return Number.isFinite(timestamp)
    ? Math.max(0, (now.getTime() - timestamp) / 3_600_000)
    : Number.POSITIVE_INFINITY;
}

export function classifyTrendTruth(input: TrendTruthInput): TrendTruthResult {
  const now = input.now ?? new Date();
  const independentSourceCount = countIndependentSources(input.signals);
  if (input.measurements.some(positiveExternalSeries)) {
    return {
      signalClass: "MEASURED_EXTERNAL_SERIES",
      measured: true,
      independentSourceCount,
      reason: "A provider supplied an external Google Trends series with positive movement.",
    };
  }
  if (positiveSnapshotPair(input.snapshots ?? [], input.minimumSnapshotSeparationMs ?? 60_000)) {
    return {
      signalClass: "MEASURED_INTERNAL_VELOCITY",
      measured: true,
      independentSourceCount,
      reason:
        "The same canonical signal has a metric that increased across time-separated snapshots.",
    };
  }
  const current = input.signals.filter(
    (signal) => ageHours(signal, now) <= (input.corroborationWindowHours ?? 168),
  );
  const currentIndependentCount = countIndependentSources(current);
  if (current.length >= 2 && currentIndependentCount >= 2) {
    return {
      signalClass: "CORROBORATED_SIGNAL",
      measured: false,
      independentSourceCount: currentIndependentCount,
      reason: "Two or more independent current sources support the same clustered topic.",
    };
  }
  const exceptional = input.signals.some(
    (signal) =>
      ageHours(signal, now) <= (input.emergingWindowHours ?? 72) &&
      (input.strengthBySignalId?.[signal.id] ?? 0) >= 0.8,
  );
  if (exceptional) {
    return {
      signalClass: "EMERGING_SIGNAL",
      measured: false,
      independentSourceCount,
      reason:
        "One strong, recent, highly relevant opportunity is present without measured velocity.",
    };
  }
  return {
    signalClass: "INSUFFICIENT_SIGNAL",
    measured: false,
    independentSourceCount,
    reason: "Evidence is too weak, stale, dependent, or incomplete to claim a trend.",
  };
}
