import { describe, expect, it } from "vitest";
import type { ContentCapabilities, ProjectContext, Signal } from "@trendsfast/schemas";
import type { ScoringSignal } from "@trendsfast/scoring";
import { decideDeterministically, selectEvidenceSignalsForAction } from "../src/decision";
import { DOGFOOD_FIXTURES } from "../src/dogfood";

const context: ProjectContext = {
  name: "Example",
  url: "https://example.com",
  category: "distribution research tool",
  audience: "technical founders building developer tools",
  problem: "founders spend hours on distribution research",
  desiredOutcome: "choose an evidence-backed distribution action",
  credibleClaims: ["evidence receipts"],
  alternatives: ["manual research"],
  competitors: [],
  markets: ["US"],
  language: "en",
  suitableChannels: ["hacker_news", "x"],
  availableFormats: ["founder_text"],
  credibleTopics: ["distribution research", "developer distribution"],
  assumptions: [],
};

const textOnlyCapabilities: ContentCapabilities = {
  founder_text: true,
  founder_on_camera: false,
  screen_recording: false,
  ai_avatar: false,
  carousel: false,
  product_demo: false,
  long_form: false,
};

function signal(id: string, source: Signal["source"], url: string): Signal & ScoringSignal {
  return {
    id,
    source,
    sourceId: id,
    url,
    title: "Technical founders discuss evidence backed distribution research",
    textExcerpt:
      "Technical founders building developer tools discuss a distribution research tool because founders spend hours on distribution research and want to choose an evidence-backed distribution action with evidence receipts for developer distribution.",
    observedAt: "2026-08-11T12:00:00.000Z",
    publishedAt: "2026-08-11T09:00:00.000Z",
    language: "en",
    metrics: source === "hacker_news" ? { points: 90, comments: 35 } : { stars: 500 },
    queryId: `query_${source}`,
    provenance: {
      provider: `fixture:${source}`,
      retrievedAt: "2026-08-11T12:00:00.000Z",
      cached: true,
    },
  };
}

describe("deterministic decision engine", () => {
  it("can publish only with independent current evidence and binds stored ids", async () => {
    const signals = [
      signal("sig_hn", "hacker_news", "https://news.ycombinator.com/item?id=1"),
      signal("sig_gh", "github", "https://github.com/example/research"),
    ];
    const draft = await decideDeterministically({
      context,
      signals,
      measurements: [],
      coverage: {
        website: "SUCCEEDED",
        hacker_news: "SUCCEEDED",
        github: "SUCCEEDED",
        google_trends: "SUCCEEDED",
      },
      now: new Date("2026-08-11T12:00:00.000Z"),
    });
    expect(draft.move.action).toBe("PUBLISH");
    expect(new Set(draft.evidenceSignalIds)).toEqual(new Set(["sig_hn", "sig_gh"]));
  });

  it("binds a REPLY channel to the exact selected primary target instead of channel preference", async () => {
    const target = signal("sig_hn_reply", "hacker_news", "https://news.ycombinator.com/item?id=9");
    const draft = await decideDeterministically({
      context: { ...context, suitableChannels: ["linkedin", "x"] },
      signals: [target],
      measurements: [],
      coverage: {
        website: "SUCCEEDED",
        hacker_news: "SUCCEEDED",
        x: "SUCCEEDED",
        google_trends: "SUCCEEDED",
      },
      now: new Date("2026-08-11T12:00:00.000Z"),
    });

    expect(draft.move).toMatchObject({ action: "REPLY", channel: "hacker_news" });
    expect(draft.versionedMove).toMatchObject({
      action: "REPLY",
      channel: "hacker_news",
      details: {
        action: "REPLY",
        primary_target: {
          source: "hacker_news",
          url: target.url,
        },
      },
    });
  });

  it("retains the exact REPLY target when it sorts after four independent non-reply signals", () => {
    const nonReply = [
      signal("a_website", "website", "https://example.com/research"),
      signal("b_trends", "google_trends", "https://trends.google.com/trends/explore"),
      signal("c_github", "github", "https://github.com/example/research"),
      signal("d_youtube", "youtube", "https://youtube.com/watch?v=fixture"),
    ];
    const target = signal("z_x_reply", "x", "https://x.com/example/status/1");
    const signals = [...nonReply, target];
    const selected = selectEvidenceSignalsForAction(
      {
        id: "cluster_reply_target_after_cutoff",
        memberIds: signals.map((item) => item.id),
        signals,
        representativeSignalId: target.id,
        representativeTitle: target.title!,
        topicFingerprint: ["distribution"],
        independenceKeys: [],
        independentSourceCount: 5,
      },
      "REPLY",
      new Date("2026-08-11T12:00:00.000Z"),
    );

    expect(selected).toHaveLength(4);
    expect(selected[0]).toMatchObject({ id: target.id, source: "x", url: target.url });
    expect(selected.map((item) => item.id)).toContain(target.id);
  });

  it("retains the action-defining YouTube source before the REMIX evidence cutoff", async () => {
    const youtube = signal(
      "z_youtube_remix_source",
      "youtube",
      "https://youtube.com/watch?v=stored-remix-source",
    );
    const signals = [
      signal("a_website", "website", "https://example.com/research"),
      signal("b_trends", "google_trends", "https://trends.google.com/trends/explore"),
      signal("c_github", "github", "https://github.com/example/research"),
      signal("d_hn", "hacker_news", "https://news.ycombinator.com/item?id=17"),
      youtube,
    ];

    const draft = await decideDeterministically({
      context,
      signals,
      measurements: [],
      coverage: {
        website: "SUCCEEDED",
        google_trends: "SUCCEEDED",
        hacker_news: "SUCCEEDED",
        github: "SUCCEEDED",
        youtube: "SUCCEEDED",
      },
      generationLevel: "draft",
      contentCapabilities: textOnlyCapabilities,
      now: new Date("2026-08-11T12:00:00.000Z"),
    });

    expect(draft.move.action).toBe("REMIX");
    expect(draft.evidenceSignalIds).toHaveLength(4);
    expect(draft.evidenceSignalIds[0]).toBe(youtube.id);
    if (draft.versionedMove?.action !== "REMIX") throw new Error("Expected REMIX details");
    expect(draft.versionedMove.details.source_content[0]).toMatchObject({
      source: "youtube",
      url: youtube.url,
    });
  });

  it("does not reply to a stale thread because a different clustered signal is current", async () => {
    const staleTarget = {
      ...signal("sig_hn_stale", "hacker_news", "https://news.ycombinator.com/item?id=41"),
      publishedAt: "2026-07-01T09:00:00.000Z",
    };
    const currentNonTarget = signal(
      "sig_github_current",
      "github",
      "https://github.com/example/current-research",
    );
    const draft = await decideDeterministically({
      context,
      signals: [staleTarget, currentNonTarget],
      measurements: [],
      coverage: {
        website: "SUCCEEDED",
        hacker_news: "SUCCEEDED",
        github: "SUCCEEDED",
        google_trends: "SUCCEEDED",
      },
      now: new Date("2026-08-11T12:00:00.000Z"),
    });

    expect(draft.move.action).toBe("WAIT");
    expect(draft.versionedMove?.details.action).toBe("WAIT");
  });

  it("never treats an X status without authoritative publishedAt as a current REPLY target", async () => {
    const oldStatusObservedNow = signal(
      "sig_x_missing_published",
      "x",
      "https://x.com/example/status/100000000000000000",
    );
    delete oldStatusObservedNow.publishedAt;
    const draft = await decideDeterministically({
      context,
      signals: [oldStatusObservedNow],
      measurements: [],
      coverage: {
        website: "SUCCEEDED",
        hacker_news: "SUCCEEDED",
        x: "SUCCEEDED",
        google_trends: "SUCCEEDED",
      },
      now: new Date("2026-08-11T12:00:00.000Z"),
    });

    expect(draft.signalClass).toBe("INSUFFICIENT_SIGNAL");
    expect(draft.move.action).toBe("WAIT");
    expect(draft.versionedMove?.details.action).toBe("WAIT");
    expect(draft.evidenceSignalIds).toEqual([]);
    expect(draft.limitations.join(" ")).toMatch(/missing an authoritative timestamp/i);
  });

  it("binds REPLY evidence and timing to the same current conversation target", async () => {
    const target = {
      ...signal("z_hn_target", "hacker_news", "https://news.ycombinator.com/item?id=60"),
      publishedAt: "2026-08-09T00:00:00.000Z",
      observedAt: "2026-08-09T01:00:00.000Z",
    };
    const fresherNonTarget = {
      ...signal("a_search_result", "tavily", "https://news.ycombinator.com/item?id=61"),
      publishedAt: "2026-08-11T11:00:00.000Z",
      observedAt: "2026-08-11T12:00:00.000Z",
    };
    const draft = await decideDeterministically({
      context,
      signals: [fresherNonTarget, target],
      measurements: [],
      coverage: {
        website: "SUCCEEDED",
        hacker_news: "SUCCEEDED",
        tavily: "SUCCEEDED",
        google_trends: "SUCCEEDED",
      },
      now: new Date("2026-08-11T12:00:00.000Z"),
    });

    expect(draft.move).toMatchObject({ action: "REPLY", channel: "hacker_news" });
    expect(draft.evidenceSignalIds[0]).toBe(target.id);
    expect(draft.versionedMove).toMatchObject({
      trendWindow: {
        observed_since: target.publishedAt,
        last_confirmed_at: target.observedAt,
      },
      breakoutPotential: {
        factors: { timing: expect.closeTo(Math.exp(-60 / 96), 5) },
      },
      details: {
        action: "REPLY",
        primary_target: { url: target.url },
      },
    });
  });

  it("never turns a stale bound conversation receipt into a secondary REPLY target", async () => {
    const current = {
      ...signal("z_current_x", "x", "https://x.com/example/status/42"),
      publishedAt: "2026-08-11T11:00:00.000Z",
    };
    const staleRepresentative = {
      ...signal("a_stale_hn", "hacker_news", "https://news.ycombinator.com/item?id=41"),
      title:
        "Technical founders discuss evidence backed distribution research with a detailed stale example",
      publishedAt: "2026-07-01T09:00:00.000Z",
    };
    const draft = await decideDeterministically({
      context,
      signals: [staleRepresentative, current],
      measurements: [],
      coverage: {
        website: "SUCCEEDED",
        hacker_news: "SUCCEEDED",
        x: "SUCCEEDED",
        google_trends: "SUCCEEDED",
      },
      now: new Date("2026-08-11T12:00:00.000Z"),
    });

    expect(draft.move).toMatchObject({ action: "REPLY", channel: "x" });
    expect(draft.move.topic).toBe(staleRepresentative.title);
    expect(draft.evidenceSignalIds).toEqual(
      expect.arrayContaining([current.id, staleRepresentative.id]),
    );
    expect(draft.versionedMove).toMatchObject({
      details: {
        action: "REPLY",
        primary_target: { url: current.url },
        secondary_targets: [],
      },
    });
  });

  it("excludes a future-dated reply candidate and binds timing to the valid current target", async () => {
    const future = {
      ...signal("a_future_x", "x", "https://x.com/example/status/99"),
      publishedAt: "2026-08-11T13:00:00.000Z",
      observedAt: "2026-08-11T13:01:00.000Z",
    };
    const current = {
      ...signal("z_current_x", "x", "https://x.com/example/status/42"),
      publishedAt: "2026-08-11T11:00:00.000Z",
      observedAt: "2026-08-11T11:30:00.000Z",
    };
    const draft = await decideDeterministically({
      context,
      signals: [future, current],
      measurements: [],
      coverage: {
        website: "SUCCEEDED",
        hacker_news: "SUCCEEDED",
        x: "SUCCEEDED",
        google_trends: "SUCCEEDED",
      },
      now: new Date("2026-08-11T12:00:00.000Z"),
    });

    expect(draft.move).toMatchObject({ action: "REPLY", channel: "x" });
    expect(draft.evidenceSignalIds[0]).toBe(current.id);
    expect(draft.evidenceSignalIds).not.toContain(future.id);
    expect(draft.limitations.join(" ")).toMatch(/dated after the decision time.*excluded/i);
    expect(draft.versionedMove).toMatchObject({
      trendWindow: {
        observed_since: current.publishedAt,
        last_confirmed_at: current.observedAt,
      },
      details: {
        action: "REPLY",
        primary_target: { url: current.url },
      },
    });
    expect(draft.versionedMove?.details).not.toMatchObject({
      primary_target: { url: future.url },
    });
  });

  it("does not let future GitHub or YouTube evidence drive PUBLISH or REMIX", async () => {
    const current = signal("sig_current_web", "website", "https://example.com/current");
    const future = [
      {
        ...signal("sig_future_gh", "github", "https://github.com/example/future"),
        publishedAt: "2026-08-11T13:00:00.000Z",
        observedAt: "2026-08-11T13:01:00.000Z",
        provenance: {
          provider: "live:github",
          retrievedAt: "2026-08-11T13:02:00.000Z",
          cached: false,
        },
      },
      {
        ...signal("sig_future_yt", "youtube", "https://youtube.com/watch?v=future"),
        publishedAt: "2026-08-11T14:00:00.000Z",
        observedAt: "2026-08-11T14:01:00.000Z",
        provenance: {
          provider: "live:youtube",
          retrievedAt: "2026-08-11T14:02:00.000Z",
          cached: false,
        },
      },
    ];
    const draft = await decideDeterministically({
      context,
      signals: [current, ...future],
      measurements: [],
      coverage: {
        website: "SUCCEEDED",
        hacker_news: "SUCCEEDED",
        github: "SUCCEEDED",
        youtube: "SUCCEEDED",
        google_trends: "SUCCEEDED",
      },
      generationLevel: "draft",
      now: new Date("2026-08-11T12:00:00.000Z"),
    });

    expect(draft.move.action).toBe("WAIT");
    expect(draft.evidenceSignalIds).toEqual([current.id]);
    expect(draft.evidenceSignalIds).not.toEqual(
      expect.arrayContaining(future.map((item) => item.id)),
    );
    expect(draft.limitations.join(" ")).toMatch(/dated after the decision time.*excluded/i);
    expect(draft.versionedMove?.draftContent).toBeUndefined();
  });

  it("excludes future measurement points and snapshots from measured truth", async () => {
    const current = signal(
      "sig_current_hn",
      "hacker_news",
      "https://news.ycombinator.com/item?id=211",
    );
    const draft = await decideDeterministically({
      context,
      signals: [current],
      snapshots: [
        {
          signalId: current.id,
          observedAt: "2026-08-11T11:00:00.000Z",
          metrics: { points: 10 },
        },
        {
          signalId: current.id,
          observedAt: "2026-08-11T13:00:00.000Z",
          metrics: { points: 100 },
        },
      ],
      measurements: [
        {
          id: "future_rising_series",
          source: "google_trends",
          provider: "live:google_trends",
          queryId: current.queryId,
          kind: "EXTERNAL_TIME_SERIES",
          label: "Series whose apparent rise is in the future",
          points: [
            { at: "2026-08-11T11:00:00.000Z", value: 10 },
            { at: "2026-08-11T13:00:00.000Z", value: 100 },
          ],
        },
      ],
      coverage: {
        website: "SUCCEEDED",
        hacker_news: "SUCCEEDED",
        x: "SUCCEEDED",
        google_trends: "SUCCEEDED",
      },
      now: new Date("2026-08-11T12:00:00.000Z"),
    });

    expect(draft.signalClass).toBe("EMERGING_SIGNAL");
    expect(draft.whyNow).not.toMatch(/external Google Trends|time-separated/i);
    expect(draft.limitations.join(" ")).toMatch(/dated after the decision time.*excluded/i);
  });

  it("retains every saved assumption as a deduplicated deterministic limitation", async () => {
    const draft = await decideDeterministically({
      context: {
        ...context,
        assumptions: [
          "No buy or sell advice.",
          "Unknown portfolio data is not zero.",
          "No buy or sell advice.",
        ],
      },
      signals: [],
      measurements: [],
      coverage: {},
      now: new Date("2026-08-11T12:00:00.000Z"),
    });

    expect(draft.limitations).toContain("Saved assumption: No buy or sell advice.");
    expect(draft.limitations).toContain("Saved assumption: Unknown portfolio data is not zero.");
    expect(
      draft.limitations.filter(
        (limitation) => limitation === "Saved assumption: No buy or sell advice.",
      ),
    ).toHaveLength(1);
  });

  it("holds an unsafe live title as WAIT without copying it into proposal prose", async () => {
    const unsafeTitle = "Buy X now — guaranteed returns";
    const signals = [
      {
        ...signal("sig_hn_unsafe", "hacker_news", "https://news.ycombinator.com/item?id=77"),
        title: unsafeTitle,
        provenance: {
          provider: "live:hacker_news",
          retrievedAt: "2026-08-11T12:00:00.000Z",
          cached: false,
        },
      },
      {
        ...signal("sig_gh_unsafe", "github", "https://github.com/example/unsafe-title"),
        title: unsafeTitle,
        provenance: {
          provider: "live:github",
          retrievedAt: "2026-08-11T12:00:00.000Z",
          cached: false,
        },
      },
    ];
    const draft = await decideDeterministically({
      context,
      signals,
      measurements: [],
      coverage: {
        website: "SUCCEEDED",
        hacker_news: "SUCCEEDED",
        github: "SUCCEEDED",
        google_trends: "SUCCEEDED",
      },
      generationLevel: "draft",
      now: new Date("2026-08-11T12:00:00.000Z"),
    });

    expect(draft.move).toMatchObject({
      action: "WAIT",
      priority: 0,
      topic: "No safe distribution claim is available yet",
    });
    expect([
      draft.move.topic,
      draft.move.angle,
      draft.move.hook,
      ...draft.move.outline,
      draft.move.cta,
    ]).not.toContain(unsafeTitle);
    expect(new Set(draft.evidenceSignalIds)).toEqual(new Set(signals.map((item) => item.id)));
    expect(draft.limitations.join(" ")).toMatch(/safe deterministic prose.*held/i);
    expect(draft.confidenceRationale).toContain("UNSAFE_PRODUCT_CREDIBILITY_BOUNDARY");
    expect(draft.versionedMove).toMatchObject({
      action: "WAIT",
      topic: "No safe distribution claim is available yet",
      details: {
        action: "WAIT",
        considered_opportunity: "No safe distribution claim is available yet",
        failure_reasons: expect.arrayContaining(["LOW_CREDIBILITY"]),
      },
    });
    expect(draft.versionedMove?.draftContent).toBeUndefined();
  });

  it.each(["Hold TSLA", "Trade Nvidia", "Positive returns ahead"])(
    "holds the contextually unsafe financial title %s in the fully derived draft",
    async (unsafeTitle) => {
      const financialContext: ProjectContext = {
        ...context,
        name: "Halio",
        category: "portfolio analytics",
        audience: "self-directed investors",
        problem: "investors lack clear portfolio context",
        desiredOutcome: "understand portfolio concentration without trading permissions",
        credibleClaims: ["read-only portfolio clarity"],
        credibleTopics: ["portfolio clarity"],
        assumptions: ["No buy or sell advice."],
      };
      const financeSignal = (id: string, source: Signal["source"], url: string) => ({
        ...signal(id, source, url),
        title: unsafeTitle,
        textExcerpt:
          "Self-directed investors discuss portfolio analytics because investors lack clear portfolio context and want to understand portfolio concentration with read-only portfolio clarity.",
        provenance: {
          provider: `live:${source}`,
          retrievedAt: "2026-08-11T12:00:00.000Z",
          cached: false,
        },
      });
      const draft = await decideDeterministically({
        context: financialContext,
        signals: [
          financeSignal("sig_hn_finance", "hacker_news", "https://news.ycombinator.com/item?id=90"),
          financeSignal("sig_gh_finance", "github", "https://github.com/example/halio-finance"),
        ],
        measurements: [],
        coverage: {
          website: "SUCCEEDED",
          hacker_news: "SUCCEEDED",
          github: "SUCCEEDED",
          google_trends: "SUCCEEDED",
        },
        generationLevel: "draft",
        now: new Date("2026-08-11T12:00:00.000Z"),
      });

      expect(draft.move).toMatchObject({
        action: "WAIT",
        topic: "No safe distribution claim is available yet",
      });
      expect(draft.confidenceRationale).toContain("UNSAFE_PRODUCT_CREDIBILITY_BOUNDARY");
      expect(draft.versionedMove?.draftContent).toBeUndefined();
    },
  );

  it("holds an unsafe product claim introduced only while deriving finished copy", async () => {
    const draft = await decideDeterministically({
      context: {
        ...context,
        credibleClaims: ["guaranteed results", "evidence receipts"],
      },
      signals: [
        signal("sig_hn_copy_safety", "hacker_news", "https://news.ycombinator.com/item?id=93"),
        signal("sig_gh_copy_safety", "github", "https://github.com/example/copy-safety"),
      ],
      measurements: [],
      coverage: {
        website: "SUCCEEDED",
        hacker_news: "SUCCEEDED",
        github: "SUCCEEDED",
        google_trends: "SUCCEEDED",
      },
      generationLevel: "draft",
      now: new Date("2026-08-11T12:00:00.000Z"),
    });

    expect(draft.move).toMatchObject({
      action: "WAIT",
      topic: "No safe distribution claim is available yet",
      priority: 0,
    });
    expect(draft.evidenceSignalIds).toEqual(
      expect.arrayContaining(["sig_hn_copy_safety", "sig_gh_copy_safety"]),
    );
    expect(draft.limitations).toContain(
      "The selected evidence could not be converted into safe deterministic prose, so distribution was held.",
    );
    expect(draft.confidenceRationale).toContain("UNSAFE_PRODUCT_CREDIBILITY_BOUNDARY");
    expect(draft.versionedMove?.draftContent).toBeUndefined();
  });

  it("skips a disabled first format and keeps the decision and blueprint capability-aligned", async () => {
    const draft = await decideDeterministically({
      context: { ...context, availableFormats: ["screen_recording", "founder_text"] },
      contentCapabilities: textOnlyCapabilities,
      signals: [
        signal("sig_hn", "hacker_news", "https://news.ycombinator.com/item?id=1"),
        signal("sig_gh", "github", "https://github.com/example/research"),
      ],
      measurements: [],
      coverage: {
        website: "SUCCEEDED",
        hacker_news: "SUCCEEDED",
        github: "SUCCEEDED",
        google_trends: "SUCCEEDED",
      },
      now: new Date("2026-08-11T12:00:00.000Z"),
    });

    expect(draft.move).toMatchObject({ action: "PUBLISH", format: "founder_text" });
    expect(draft.versionedMove).toMatchObject({
      format: "founder_text",
      details: {
        action: "PUBLISH",
        content_type: "founder_text",
        blueprint: {
          format_family: "founder_text",
          production_options: ["FOUNDER_TEXT"],
        },
      },
    });
  });

  it("returns an explicit WAIT when no production capability supports an actionable format", async () => {
    const draft = await decideDeterministically({
      context: { ...context, availableFormats: ["screen_recording"] },
      contentCapabilities: { ...textOnlyCapabilities, founder_text: false },
      signals: [
        signal("sig_hn", "hacker_news", "https://news.ycombinator.com/item?id=1"),
        signal("sig_gh", "github", "https://github.com/example/research"),
      ],
      measurements: [],
      coverage: {
        website: "SUCCEEDED",
        hacker_news: "SUCCEEDED",
        github: "SUCCEEDED",
        google_trends: "SUCCEEDED",
      },
      now: new Date("2026-08-11T12:00:00.000Z"),
    });

    expect(draft.move).toMatchObject({ action: "WAIT", format: "none" });
    expect(draft.versionedMove).toMatchObject({
      details: { action: "WAIT", failure_reasons: ["MISSING_COVERAGE"] },
    });
    const watchConditions =
      draft.versionedMove?.details.action === "WAIT"
        ? draft.versionedMove.details.watch_conditions.join(" ")
        : "";
    expect(watchConditions).toMatch(/enabling a saved production capability/i);
    expect(watchConditions).not.toMatch(/source coverage/i);
    expect(draft.limitations.join(" ")).toMatch(/no enabled production capability/i);
  });

  it("returns WAIT under inadequate critical coverage", async () => {
    const draft = await decideDeterministically({
      context,
      signals: [signal("sig_hn", "hacker_news", "https://news.ycombinator.com/item?id=1")],
      measurements: [],
      coverage: { website: "FAILED", google_trends: "FAILED", hacker_news: "SUCCEEDED" },
      now: new Date("2026-08-11T12:00:00.000Z"),
    });
    expect(draft.move.action).toBe("WAIT");
    expect(draft.limitations.join(" ")).toMatch(/coverage|quality floor/i);
  });

  it("does not count degraded critical sources as adequate coverage", async () => {
    const draft = await decideDeterministically({
      context,
      signals: [
        signal("sig_hn", "hacker_news", "https://news.ycombinator.com/item?id=1"),
        signal("sig_gh", "github", "https://github.com/example/research"),
      ],
      measurements: [],
      coverage: {
        website: "SUCCEEDED",
        hacker_news: "SUCCEEDED",
        github: "SUCCEEDED",
        google_trends: "DEGRADED",
      },
      now: new Date("2026-08-11T12:00:00.000Z"),
    });

    expect(draft.move.action).toBe("WAIT");
    expect(draft.limitations).toContain("google_trends coverage was degraded.");
  });

  it("never includes an evidence id that was not supplied", async () => {
    const draft = await decideDeterministically({
      context,
      signals: [signal("sig_hn", "hacker_news", "https://news.ycombinator.com/item?id=1")],
      measurements: [],
      coverage: { website: "SUCCEEDED", hacker_news: "SUCCEEDED" },
      now: new Date("2026-08-11T12:00:00.000Z"),
    });
    expect(draft.evidenceSignalIds.every((id) => id === "sig_hn")).toBe(true);
  });

  it("selects independent evidence before filling the bounded receipt set", async () => {
    const samePlatform = Array.from({ length: 5 }, (_, index) =>
      signal(
        `sig_hn_${index}`,
        "hacker_news",
        `https://news.ycombinator.com/item?id=${index + 10}`,
      ),
    );
    const github = signal("sig_gh_independent", "github", "https://github.com/example/independent");
    const draft = await decideDeterministically({
      context,
      signals: [...samePlatform, github],
      measurements: [],
      coverage: {
        website: "SUCCEEDED",
        hacker_news: "SUCCEEDED",
        github: "SUCCEEDED",
        google_trends: "SUCCEEDED",
      },
      now: new Date("2026-08-11T12:00:00.000Z"),
    });
    expect(draft.move.action).toBe("PUBLISH");
    expect(draft.evidenceSignalIds).toContain("sig_gh_independent");
    expect(draft.independentSourceCount).toBe(2);
  });

  it("binds both the representative topic receipt and its rising external-series receipt", async () => {
    const representative = {
      ...signal("y_representative_hn", "hacker_news", "https://news.ycombinator.com/item?id=310"),
      title:
        "Technical founders discuss evidence backed distribution research with one detailed decision framework",
    };
    const measured = {
      ...signal(
        "z_measured_trends",
        "google_trends",
        "https://trends.google.com/trends/explore?q=distribution",
      ),
      queryId: "query_measured_distribution",
    };
    const draft = await decideDeterministically({
      context,
      signals: [
        signal("a_hn", "hacker_news", "https://news.ycombinator.com/item?id=300"),
        signal("b_gh", "github", "https://github.com/example/bound-research"),
        signal("c_web", "website", "https://example.com/bound-research"),
        signal(
          "d_other_trends",
          "google_trends",
          "https://trends.google.com/trends/explore?q=other",
        ),
        representative,
        measured,
      ],
      measurements: [
        {
          id: "measurement_rising_bound",
          source: "google_trends",
          provider: "fixture:google_trends",
          queryId: measured.queryId,
          kind: "EXTERNAL_TIME_SERIES",
          label: "Bound rising distribution interest",
          points: [
            { at: "2026-08-10T12:00:00.000Z", value: 10 },
            { at: "2026-08-11T12:00:00.000Z", value: 90 },
          ],
        },
      ],
      coverage: {
        website: "SUCCEEDED",
        hacker_news: "SUCCEEDED",
        github: "SUCCEEDED",
        google_trends: "SUCCEEDED",
      },
      now: new Date("2026-08-11T12:00:00.000Z"),
    });

    expect(draft.signalClass).toBe("MEASURED_EXTERNAL_SERIES");
    expect(draft.move.topic).toBe(representative.title);
    expect(draft.evidenceSignalIds).toEqual(
      expect.arrayContaining([representative.id, measured.id]),
    );
    expect(draft.whyNow).toMatch(/external Google Trends series/i);
  });

  it("binds every signal whose snapshots establish measured internal velocity", async () => {
    const measured = {
      ...signal("z_snapshot_hn", "hacker_news", "https://news.ycombinator.com/item?id=401"),
    };
    const draft = await decideDeterministically({
      context,
      signals: [
        signal("a_hn", "hacker_news", "https://news.ycombinator.com/item?id=400"),
        signal("b_gh", "github", "https://github.com/example/snapshot-research"),
        signal("c_web", "website", "https://example.com/snapshot-research"),
        signal("d_trends", "google_trends", "https://trends.google.com/trends/explore?q=snapshot"),
        measured,
      ],
      snapshots: [
        {
          signalId: measured.id,
          observedAt: "2026-08-11T06:00:00.000Z",
          metrics: { points: 12 },
        },
        {
          signalId: measured.id,
          observedAt: "2026-08-11T12:00:00.000Z",
          metrics: { points: 90 },
        },
      ],
      measurements: [],
      coverage: {
        website: "SUCCEEDED",
        hacker_news: "SUCCEEDED",
        github: "SUCCEEDED",
        google_trends: "SUCCEEDED",
      },
      now: new Date("2026-08-11T12:00:00.000Z"),
    });

    expect(draft.signalClass).toBe("MEASURED_INTERNAL_VELOCITY");
    expect(draft.evidenceSignalIds).toContain(measured.id);
    expect(draft.whyNow).toMatch(/time-separated snapshots/i);
  });

  it("does not attach a rising measurement from an unrelated query to a cluster", async () => {
    const draft = await decideDeterministically({
      context,
      signals: [
        signal("sig_hn", "hacker_news", "https://news.ycombinator.com/item?id=1"),
        signal("sig_gh", "github", "https://github.com/example/research"),
      ],
      measurements: [
        {
          id: "measurement_flat_hn",
          source: "google_trends",
          provider: "fixture:google_trends",
          queryId: "query_hacker_news",
          kind: "EXTERNAL_TIME_SERIES",
          label: "Flat measurement for the clustered query",
          points: [
            { at: "2026-08-10T12:00:00.000Z", value: 50 },
            { at: "2026-08-11T12:00:00.000Z", value: 50 },
          ],
        },
        {
          id: "measurement_rising_unrelated",
          source: "google_trends",
          provider: "fixture:google_trends",
          queryId: "query_unrelated",
          kind: "EXTERNAL_TIME_SERIES",
          label: "Rising measurement for an unrelated query",
          points: [
            { at: "2026-08-10T12:00:00.000Z", value: 10 },
            { at: "2026-08-11T12:00:00.000Z", value: 90 },
          ],
        },
      ],
      coverage: {
        website: "SUCCEEDED",
        hacker_news: "SUCCEEDED",
        github: "SUCCEEDED",
        google_trends: "SUCCEEDED",
      },
      now: new Date("2026-08-11T12:00:00.000Z"),
    });

    expect(draft.signalClass).toBe("CORROBORATED_SIGNAL");
    expect(draft.whyNow).not.toMatch(/external Google Trends series/i);
  });

  it("uses only cluster-bound time-separated snapshots for measured internal velocity", async () => {
    const current = signal(
      "sig_velocity",
      "hacker_news",
      "https://news.ycombinator.com/item?id=77",
    );
    const draft = await decideDeterministically({
      context,
      signals: [current],
      snapshots: [
        {
          signalId: "sig_velocity",
          observedAt: "2026-08-11T06:00:00.000Z",
          metrics: { points: 12 },
        },
        {
          signalId: "sig_velocity",
          observedAt: "2026-08-11T12:00:00.000Z",
          metrics: { points: 90 },
        },
        {
          signalId: "unrelated_signal",
          observedAt: "2026-08-11T12:00:00.000Z",
          metrics: { points: 9_999 },
        },
      ],
      measurements: [],
      coverage: {
        website: "SUCCEEDED",
        hacker_news: "SUCCEEDED",
        google_trends: "SUCCEEDED",
        x: "SUCCEEDED",
      },
      now: new Date("2026-08-11T12:00:00.000Z"),
    });

    expect(draft.signalClass).toBe("MEASURED_INTERNAL_VELOCITY");
    expect(draft.versionedMove?.trendWindow).toMatchObject({
      state: "RISING",
      basis: "MEASURED_INTERNAL_VELOCITY",
    });
  });

  it("never injects dogfood fixture moves into evidence-derived decisions", async () => {
    const targets = DOGFOOD_FIXTURES.filter((fixture) =>
      ["trendsfast", "halio", "ship-to-users"].includes(fixture.slug),
    );

    for (const fixture of targets) {
      const draft = await decideDeterministically({
        context: fixture.context,
        signals: [
          signal(
            `sig_hn_${fixture.slug}`,
            "hacker_news",
            `https://news.ycombinator.com/item?id=${fixture.slug.length + 100}`,
          ),
          signal(`sig_gh_${fixture.slug}`, "github", `https://github.com/example/${fixture.slug}`),
        ],
        measurements: [],
        coverage: {
          website: "SUCCEEDED",
          hacker_news: "SUCCEEDED",
          github: "SUCCEEDED",
          google_trends: "SUCCEEDED",
        },
        now: new Date("2026-08-11T12:00:00.000Z"),
      });

      expect(draft.move.topic).not.toBe(fixture.move.topic);
      expect(draft.move.angle).not.toBe(fixture.move.angle);
      expect(draft.limitations).not.toEqual(expect.arrayContaining(fixture.limitations));
    }
  });
});
