import { describe, expect, it, vi } from "vitest";

import { createDatabaseProcessingStore } from "../src/database-store";

const observedAt = new Date("2026-08-11T12:00:00.000Z");

function signal(
  id: string,
  sourceRunId: string,
  source: "github" | "x",
  state: "SUCCEEDED" | "DEGRADED" = "SUCCEEDED",
) {
  return {
    signal: {
      id,
      sourceRunId,
      source,
      sourceId: `${source}_native`,
      canonicalUrl: `https://example.com/${id}`,
      title: id,
      textExcerpt: null,
      author: null,
      publishedAt: null,
      observedAt,
      language: null,
      metrics: {},
      queryId: `query_${source}`,
      provider: source,
      providerRequestId: null,
      retrievedAt: observedAt,
      cached: false,
      rawPayloadHash: null,
    },
    sourceRun: { id: sourceRunId, state },
  };
}

function measurement(source: "github" | "x") {
  return {
    measurements: [
      {
        id: `measurement_${source}`,
        source,
        provider: source,
        queryId: `query_${source}`,
        kind: "EXTERNAL_TIME_SERIES",
        label: `${source} series`,
        points: [{ at: observedAt.toISOString(), value: 1 }],
      },
    ],
    limitations: [],
    errors: [],
  };
}

describe("database processing decision input", () => {
  it("keeps degraded and skipped sources visible in coverage but excludes their evidence", async () => {
    const repositories = {
      scanData: {
        listSignalsForRun: vi.fn(async () => [
          signal("signal_succeeded", "source_succeeded", "github"),
          signal("signal_degraded", "source_degraded", "x", "DEGRADED"),
        ]),
        listHistoricalMetricSnapshotsForRun: vi.fn(async () => [
          { signalId: "signal_succeeded", observedAt, metrics: { stars: 1 } },
          { signalId: "signal_degraded", observedAt, metrics: { likes: 1 } },
        ]),
        listSourceRuns: vi.fn(async () => [
          {
            id: "source_succeeded",
            source: "github",
            state: "SUCCEEDED",
            providerPayloadFragment: measurement("github"),
          },
          {
            id: "source_degraded",
            source: "x",
            state: "DEGRADED",
            providerPayloadFragment: measurement("x"),
          },
          {
            id: "source_skipped",
            source: "manual",
            state: "SKIPPED",
            providerPayloadFragment: null,
          },
        ]),
      },
    };
    const store = createDatabaseProcessingStore(repositories as never, {
      includeHistoricalMetricSnapshots: true,
    });

    const collected = await store.loadCollectedData("run_1");

    expect(collected.signals.map((item) => item.id)).toEqual(["signal_succeeded"]);
    expect(collected.snapshots.map((item) => item.signalId)).toEqual(["signal_succeeded"]);
    expect(collected.measurements.map((item) => item.id)).toEqual(["measurement_github"]);
    expect(collected.coverage).toEqual({
      github: "SUCCEEDED",
      x: "DEGRADED",
      manual: "SKIPPED",
    });
  });

  it("does not read unbound historical metrics when live processing disables them", async () => {
    const listHistoricalMetricSnapshotsForRun = vi.fn(async () => [
      { signalId: "signal_succeeded", observedAt, metrics: { stars: 1 } },
    ]);
    const repositories = {
      scanData: {
        listSignalsForRun: vi.fn(async () => [
          signal("signal_succeeded", "source_succeeded", "github"),
        ]),
        listHistoricalMetricSnapshotsForRun,
        listSourceRuns: vi.fn(async () => [
          {
            id: "source_succeeded",
            source: "github",
            state: "SUCCEEDED",
            providerPayloadFragment: measurement("github"),
          },
        ]),
      },
    };
    const store = createDatabaseProcessingStore(repositories as never, {
      includeHistoricalMetricSnapshots: false,
    });

    const collected = await store.loadCollectedData("run_1");

    expect(collected.signals.map((item) => item.id)).toEqual(["signal_succeeded"]);
    expect(collected.snapshots).toEqual([]);
    expect(listHistoricalMetricSnapshotsForRun).not.toHaveBeenCalled();
  });
});
