import { describe, expect, it } from "vitest";

import {
  classifyTrendTruth,
  deriveOpportunityScoreComponents,
  type ScoringSignal,
  type SignalCluster,
  type TrendMeasurement,
} from "../src/index";

function signal(
  id: string,
  source: string,
  publishedAt = "2026-08-11T07:00:00.000Z",
): ScoringSignal {
  return {
    id,
    source,
    sourceId: id,
    url:
      source === "hacker_news"
        ? `https://news.ycombinator.com/item?id=${id}`
        : `https://${source === "x" ? "x.com" : "example.com"}/${id}`,
    title: "Evidence-backed distribution for technical founders",
    textExcerpt: "The same current topic is being discussed by founders.",
    publishedAt,
    observedAt: "2026-08-11T08:00:00.000Z",
    metrics: {},
    queryId: "q1",
    provenance: {
      provider: source,
      retrievedAt: "2026-08-11T08:00:00.000Z",
      cached: false,
    },
  };
}

function measurement(values: [number, number]): TrendMeasurement {
  return {
    id: "measure_1",
    source: "google_trends",
    provider: "dataforseo_google_trends",
    queryId: "q1",
    kind: "EXTERNAL_TIME_SERIES",
    label: "distribution intelligence",
    points: [
      { at: "2026-08-04T00:00:00.000Z", value: values[0] },
      { at: "2026-08-11T00:00:00.000Z", value: values[1] },
    ],
  };
}

function oneSignalCluster(item: ScoringSignal): SignalCluster {
  return {
    id: "cluster_1",
    memberIds: [item.id],
    signals: [item],
    representativeTitle: item.title ?? "",
    topicFingerprint: ["distribution"],
    independenceKeys: [item.source],
    independentSourceCount: 1,
  };
}

describe("trend truth classification", () => {
  const now = new Date("2026-08-11T08:00:00.000Z");

  it("uses MEASURED_EXTERNAL_SERIES only for a real multi-point provider series", () => {
    expect(
      classifyTrendTruth({
        signals: [signal("g1", "google_trends")],
        measurements: [measurement([31, 57])],
        now,
      }),
    ).toMatchObject({ signalClass: "MEASURED_EXTERNAL_SERIES", measured: true });
  });

  it.each([
    ["flat", [31, 31] as [number, number]],
    ["declining", [57, 31] as [number, number]],
  ])("does not classify a %s external series as measured momentum", (_label, values) => {
    const item = signal("g_flat", "google_trends");
    const truth = classifyTrendTruth({
      signals: [item],
      measurements: [measurement(values)],
      now,
    });
    const components = deriveOpportunityScoreComponents({
      cluster: oneSignalCluster(item),
      audienceTerms: ["founders"],
      productTerms: ["distribution"],
      credibleTerms: ["evidence"],
      signalClass: truth.signalClass,
      now,
    });

    expect(truth).toMatchObject({ signalClass: "INSUFFICIENT_SIGNAL", measured: false });
    expect(components.measuredOrCorroboratedMomentum).toBe(0);
  });

  it("uses MEASURED_INTERNAL_VELOCITY only after time-separated snapshots", () => {
    expect(
      classifyTrendTruth({
        signals: [signal("x1", "x")],
        measurements: [],
        snapshots: [
          { signalId: "x1", observedAt: "2026-08-11T06:00:00.000Z", metrics: { likes: 4 } },
          { signalId: "x1", observedAt: "2026-08-11T08:00:00.000Z", metrics: { likes: 17 } },
        ],
        now,
      }),
    ).toMatchObject({ signalClass: "MEASURED_INTERNAL_VELOCITY", measured: true });
  });

  it.each([
    ["flat", 17, 17],
    ["declining", 17, 4],
  ])(
    "does not classify %s time-separated internal snapshots as measured velocity",
    (_label, earlier, later) => {
      const item = signal("x_flat", "x");
      const truth = classifyTrendTruth({
        signals: [item],
        measurements: [],
        snapshots: [
          {
            signalId: "x_flat",
            observedAt: "2026-08-11T06:00:00.000Z",
            metrics: { likes: earlier },
          },
          {
            signalId: "x_flat",
            observedAt: "2026-08-11T08:00:00.000Z",
            metrics: { likes: later },
          },
        ],
        now,
      });
      const components = deriveOpportunityScoreComponents({
        cluster: oneSignalCluster(item),
        audienceTerms: ["founders"],
        productTerms: ["distribution"],
        credibleTerms: ["evidence"],
        signalClass: truth.signalClass,
        now,
      });

      expect(truth).toMatchObject({ signalClass: "INSUFFICIENT_SIGNAL", measured: false });
      expect(components.measuredOrCorroboratedMomentum).toBe(0);
    },
  );

  it("recognizes genuinely independent current corroboration", () => {
    expect(
      classifyTrendTruth({
        signals: [signal("x2", "x"), signal("hn2", "hacker_news")],
        measurements: [],
        now,
      }),
    ).toMatchObject({ signalClass: "CORROBORATED_SIGNAL", independentSourceCount: 2 });
  });

  it("uses EMERGING_SIGNAL for one strong recent item without exposing velocity", () => {
    const result = classifyTrendTruth({
      signals: [signal("x3", "x")],
      measurements: [],
      strengthBySignalId: { x3: 0.91 },
      now,
    });

    expect(result).toMatchObject({ signalClass: "EMERGING_SIGNAL", measured: false });
    expect(result).not.toHaveProperty("velocity");
  });

  it("returns INSUFFICIENT_SIGNAL for stale or weak evidence", () => {
    expect(
      classifyTrendTruth({
        signals: [signal("x4", "x", "2026-06-01T07:00:00.000Z")],
        measurements: [],
        strengthBySignalId: { x4: 0.3 },
        now,
      }).signalClass,
    ).toBe("INSUFFICIENT_SIGNAL");
  });
});
