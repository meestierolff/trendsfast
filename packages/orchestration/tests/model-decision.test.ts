import { describe, expect, it } from "vitest";
import type { ProjectContext, Signal } from "@trendsfast/schemas";

import { createModelAssistedDecision } from "../src/model-decision";
import type { ModelRequest } from "../src/synthesis";

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

function signal(id: string, source: Signal["source"], url: string): Signal {
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

function proposal(action: "PUBLISH" | "REPLY" | "REMIX" | "WAIT", evidenceSignalIds: string[]) {
  return {
    action,
    channel: "model_selected_channel",
    topic: "Refined topic prose",
    angle: "Refined angle prose.",
    format: "model_selected_format",
    hook: "Refined hook prose.",
    outline: ["Refined outline prose."],
    cta: "Refined CTA prose.",
    whyNowSummary: "Refined why-now prose.",
    limitations: ["Refined limitation prose."],
    confidenceRationale: "Refined confidence rationale.",
    confidence: 1,
    priority: 100,
    validUntil: "2026-08-31T00:00:00.000Z",
    evidenceSignalIds,
  };
}

function groundedProposal(request: ModelRequest, action: "PUBLISH" | "REPLY" | "REMIX" | "WAIT") {
  const data = JSON.parse(request.user.slice(request.user.indexOf("\n") + 1)) as {
    allowedSignalIds: string[];
    deterministicLimitations: string[];
    compactClusters: Array<{
      whyNow: string;
      fixedDecision: {
        channel: string;
        format: string;
        priority: number;
        confidence: number;
        validUntil: string;
      };
      deterministicProse: {
        topic: string;
        angle: string;
        hook: string;
        outline: string[];
        cta: string;
        confidenceRationale: string;
      };
    }>;
  };
  const cluster = data.compactClusters[0]!;
  return {
    ...proposal(action, data.allowedSignalIds),
    ...cluster.fixedDecision,
    topic: cluster.deterministicProse.topic,
    angle: cluster.deterministicProse.angle,
    hook: cluster.deterministicProse.hook,
    outline: cluster.deterministicProse.outline,
    cta: cluster.deterministicProse.cta,
    whyNowSummary: cluster.whyNow,
    limitations: data.deterministicLimitations,
    confidenceRationale: cluster.deterministicProse.confidenceRationale,
  };
}

describe("model-assisted decision", () => {
  it("does not let synthesis override a deterministic WAIT quality-floor result", async () => {
    const decide = createModelAssistedDecision({
      async generate() {
        return JSON.stringify(proposal("PUBLISH", ["sig_hn"]));
      },
    });
    const result = await decide({
      context,
      signals: [signal("sig_hn", "hacker_news", "https://news.ycombinator.com/item?id=1")],
      measurements: [],
      coverage: { website: "FAILED", google_trends: "FAILED", hacker_news: "SUCCEEDED" },
      now: new Date("2026-08-11T12:00:00.000Z"),
    });

    expect(result.move.action).toBe("WAIT");
    expect(result.move.priority).toBe(0);
    expect(result.evidenceSignalIds).toEqual(["sig_hn"]);
    expect(result.independentSourceCount).toBe(1);
    expect(result.promptVersion).toBe("deterministic-ranking-v3");
    expect(result.limitations).toContain(
      "Model synthesis was unavailable or failed validation; deterministic output was retained.",
    );
  });

  it("retains evidence and source count when a WAIT synthesis drops its held evidence", async () => {
    const decide = createModelAssistedDecision({
      async generate() {
        return JSON.stringify(proposal("WAIT", []));
      },
    });
    const result = await decide({
      context,
      signals: [signal("sig_hn", "hacker_news", "https://news.ycombinator.com/item?id=1")],
      measurements: [],
      coverage: { website: "FAILED", google_trends: "FAILED", hacker_news: "SUCCEEDED" },
      now: new Date("2026-08-11T12:00:00.000Z"),
    });

    expect(result.move.action).toBe("WAIT");
    expect(result.evidenceSignalIds).toEqual(["sig_hn"]);
    expect(result.independentSourceCount).toBe(1);
    expect(result.promptVersion).toBe("deterministic-ranking-v3");
  });

  it("rejects an actionable synthesis that drops deterministic evidence", async () => {
    const decide = createModelAssistedDecision({
      async generate() {
        return JSON.stringify(proposal("PUBLISH", ["sig_hn"]));
      },
    });
    const result = await decide({
      context,
      signals: [
        signal("sig_hn", "hacker_news", "https://news.ycombinator.com/item?id=1"),
        signal("sig_gh", "github", "https://github.com/example/research"),
      ],
      measurements: [],
      coverage: {
        website: "SUCCEEDED",
        google_trends: "SUCCEEDED",
        hacker_news: "SUCCEEDED",
        github: "SUCCEEDED",
      },
      now: new Date("2026-08-11T12:00:00.000Z"),
    });

    expect(result.move.action).toBe("PUBLISH");
    expect(result.evidenceSignalIds).toEqual(["sig_hn", "sig_gh"]);
    expect(result.independentSourceCount).toBe(2);
    expect(result.promptVersion).toBe("deterministic-ranking-v3");
  });

  it("accepts an exact bounded model echo without changing deterministic fields", async () => {
    const decide = createModelAssistedDecision({
      async generate(request) {
        return JSON.stringify(groundedProposal(request, "PUBLISH"));
      },
    });
    const result = await decide({
      context: {
        ...context,
        assumptions: ["No unsupported performance claim may be made."],
      },
      signals: [
        signal("sig_hn", "hacker_news", "https://news.ycombinator.com/item?id=1"),
        signal("sig_gh", "github", "https://github.com/example/research"),
      ],
      measurements: [],
      coverage: {
        website: "SUCCEEDED",
        google_trends: "SUCCEEDED",
        hacker_news: "SUCCEEDED",
        github: "SUCCEEDED",
      },
      generationLevel: "draft",
      now: new Date("2026-08-11T12:00:00.000Z"),
    });

    expect(result.move).toMatchObject({
      action: "PUBLISH",
      channel: "hacker_news",
      format: "founder_text",
    });
    expect(result.evidenceSignalIds).toEqual(["sig_hn", "sig_gh"]);
    expect(result.independentSourceCount).toBe(2);
    expect(result.promptVersion).toBe("next-move-synthesis-v1");
    expect(result.versionedMove).toMatchObject({
      details: {
        action: "PUBLISH",
      },
    });
    expect(result.versionedMove?.draftContent).toContain("Example");
    expect(result.versionedMove?.draftContent).toContain("evidence receipts");
    expect(result.versionedMove?.draftContent).toContain(
      "Technical founders discuss evidence backed distribution research",
    );
    expect(result.versionedMove?.draftContent).not.toMatch(
      /founder approval required|do not auto-publish|^- /imu,
    );
    expect(result.whyNow).not.toBe("Refined why-now prose.");
    expect(result.limitations).not.toContain("Refined limitation prose.");
    expect(result.limitations).toContain(
      "Saved assumption: No unsupported performance claim may be made.",
    );
    expect(result.confidenceRationale).not.toBe("Refined confidence rationale.");
  });

  it("keeps model-echoed TrendsFast and Halio drafts product-specific and non-interchangeable", async () => {
    const decide = createModelAssistedDecision({
      async generate(request) {
        return JSON.stringify(groundedProposal(request, "PUBLISH"));
      },
    });
    const trendsFastContext: ProjectContext = {
      ...context,
      name: "TrendsFast",
      category: "distribution intelligence",
      audience: "technical founders building APIs",
      problem: "live distribution research takes too long",
      desiredOutcome: "choose one evidence-backed distribution move",
      credibleClaims: ["immutable evidence receipts"],
      credibleTopics: ["evidence-led distribution"],
    };
    const halioContext: ProjectContext = {
      ...context,
      name: "Halio",
      category: "portfolio clarity",
      audience: "Dutch self-directed investors",
      problem: "portfolio data is fragmented and hard to interpret",
      desiredOutcome: "understand portfolio concentration without trading permissions",
      credibleClaims: ["read-only portfolio clarity"],
      credibleTopics: ["portfolio clarity"],
      assumptions: ["No buy or sell advice.", "Unknown portfolio data is not zero."],
    };
    const specificSignal = (
      id: string,
      source: Signal["source"],
      url: string,
      title: string,
      textExcerpt: string,
    ): Signal => ({
      ...signal(id, source, url),
      title,
      textExcerpt,
      provenance: {
        provider: `live:${source}`,
        retrievedAt: "2026-08-11T12:00:00.000Z",
        cached: false,
      },
    });
    const coverage = {
      website: "SUCCEEDED",
      google_trends: "SUCCEEDED",
      hacker_news: "SUCCEEDED",
      github: "SUCCEEDED",
    };
    const trendsFast = await decide({
      context: trendsFastContext,
      signals: [
        specificSignal(
          "tf_hn",
          "hacker_news",
          "https://news.ycombinator.com/item?id=501",
          "Evidence receipts for distribution decisions",
          "Technical founders building APIs discuss distribution intelligence because live distribution research takes too long and they want one evidence-backed distribution move with immutable evidence receipts.",
        ),
        specificSignal(
          "tf_gh",
          "github",
          "https://github.com/example/trendsfast-evidence",
          "Evidence receipts for distribution decisions",
          "Technical founders building APIs discuss distribution intelligence because live distribution research takes too long and they want one evidence-backed distribution move with immutable evidence receipts.",
        ),
      ],
      measurements: [],
      coverage,
      generationLevel: "draft",
      now: new Date("2026-08-11T12:00:00.000Z"),
    });
    const halio = await decide({
      context: halioContext,
      signals: [
        specificSignal(
          "halio_hn",
          "hacker_news",
          "https://news.ycombinator.com/item?id=502",
          "Read-only portfolio clarity for Dutch investors",
          "Dutch self-directed investors discuss portfolio clarity because portfolio data is fragmented and they want to understand concentration without trading permissions through read-only portfolio clarity.",
        ),
        specificSignal(
          "halio_gh",
          "github",
          "https://github.com/example/halio-clarity",
          "Read-only portfolio clarity for Dutch investors",
          "Dutch self-directed investors discuss portfolio clarity because portfolio data is fragmented and they want to understand concentration without trading permissions through read-only portfolio clarity.",
        ),
      ],
      measurements: [],
      coverage,
      generationLevel: "draft",
      now: new Date("2026-08-11T12:00:00.000Z"),
    });

    expect(trendsFast.move.action).toBe("PUBLISH");
    expect(halio.move.action).toBe("PUBLISH");
    expect(trendsFast.promptVersion).toBe("next-move-synthesis-v1");
    expect(halio.promptVersion).toBe("next-move-synthesis-v1");
    expect(trendsFast.versionedMove?.draftContent).toContain("TrendsFast");
    expect(trendsFast.versionedMove?.draftContent).toContain("immutable evidence receipts");
    expect(trendsFast.versionedMove?.draftContent).not.toContain("Halio");
    expect(halio.versionedMove?.draftContent).toContain("Halio");
    expect(halio.versionedMove?.draftContent).toContain("read-only portfolio clarity");
    expect(halio.versionedMove?.draftContent).not.toContain("TrendsFast");
    expect(trendsFast.versionedMove?.draftContent).not.toBe(halio.versionedMove?.draftContent);
  });

  it("preserves a copy-ready target- and product-specific exact REPLY after model echo", async () => {
    const target = signal(
      "sig_hn_reply_copy",
      "hacker_news",
      "https://news.ycombinator.com/item?id=510",
    );
    const decide = createModelAssistedDecision({
      async generate(request) {
        return JSON.stringify(groundedProposal(request, "REPLY"));
      },
    });
    const result = await decide({
      context,
      signals: [target],
      measurements: [],
      coverage: {
        website: "SUCCEEDED",
        google_trends: "SUCCEEDED",
        hacker_news: "SUCCEEDED",
        x: "SUCCEEDED",
      },
      generationLevel: "draft",
      now: new Date("2026-08-11T12:00:00.000Z"),
    });

    expect(result.move.action).toBe("REPLY");
    expect(result.promptVersion).toBe("next-move-synthesis-v1");
    expect(result.versionedMove).toMatchObject({
      action: "REPLY",
      details: {
        action: "REPLY",
        primary_target: { url: target.url, title_or_excerpt: target.title },
      },
    });
    if (result.versionedMove?.details.action !== "REPLY") {
      throw new Error("Expected a REPLY deliverable");
    }
    const reply = result.versionedMove.details.primary_target.suggested_reply;
    expect(reply).toContain(result.move.topic);
    expect(reply).toContain("Example");
    expect(reply).toContain("evidence receipts");
    expect(reply).toContain("technical founders");
    expect(reply).not.toContain("https://");
    expect(result.versionedMove.draftContent).toBeUndefined();
  });

  it("falls back to deterministic prose when synthesis hides an invented claim in an allowed field", async () => {
    const decide = createModelAssistedDecision({
      async generate(request) {
        return JSON.stringify({
          ...groundedProposal(request, "PUBLISH"),
          hook: "Guaranteed 42% growth at https://invented.example.",
        });
      },
    });
    const result = await decide({
      context,
      signals: [
        signal("sig_hn", "hacker_news", "https://news.ycombinator.com/item?id=1"),
        signal("sig_gh", "github", "https://github.com/example/research"),
      ],
      measurements: [],
      coverage: {
        website: "SUCCEEDED",
        google_trends: "SUCCEEDED",
        hacker_news: "SUCCEEDED",
        github: "SUCCEEDED",
      },
      generationLevel: "draft",
      now: new Date("2026-08-11T12:00:00.000Z"),
    });

    expect(result.move.hook).not.toContain("42%");
    expect(result.move.hook).not.toContain("invented.example");
    expect(result.promptVersion).toBe("deterministic-ranking-v3");
    expect(result.limitations).toContain(
      "Model synthesis was unavailable or failed validation; deterministic output was retained.",
    );
  });

  it("rejects an unsupported factual claim even when it contains no URL or metric", async () => {
    const decide = createModelAssistedDecision({
      async generate(request) {
        return JSON.stringify({
          ...groundedProposal(request, "PUBLISH"),
          hook: "Example connects directly to every broker.",
        });
      },
    });
    const result = await decide({
      context,
      signals: [
        signal("sig_hn", "hacker_news", "https://news.ycombinator.com/item?id=1"),
        signal("sig_gh", "github", "https://github.com/example/research"),
      ],
      measurements: [],
      coverage: {
        website: "SUCCEEDED",
        google_trends: "SUCCEEDED",
        hacker_news: "SUCCEEDED",
        github: "SUCCEEDED",
      },
      generationLevel: "draft",
      now: new Date("2026-08-11T12:00:00.000Z"),
    });

    expect(result.move.hook).not.toContain("broker");
    expect(result.promptVersion).toBe("deterministic-ranking-v3");
  });

  it("cannot compose financial-performance advice from individually grounded Halio terms", async () => {
    const decide = createModelAssistedDecision({
      async generate(request) {
        return JSON.stringify({
          ...groundedProposal(request, "PUBLISH"),
          angle: "Grow the investor portfolio.",
        });
      },
    });
    const result = await decide({
      context: {
        ...context,
        name: "Halio",
        audience: "Dutch investors",
        credibleTopics: ["portfolio", "product clarity"],
        assumptions: ["No buy or sell advice.", "No unsupported financial-performance claims."],
      },
      objective: "Grow qualified Dutch investor interest in Halio",
      signals: [
        signal("sig_hn", "hacker_news", "https://news.ycombinator.com/item?id=1"),
        signal("sig_gh", "github", "https://github.com/example/research"),
      ],
      measurements: [],
      coverage: {
        website: "SUCCEEDED",
        google_trends: "SUCCEEDED",
        hacker_news: "SUCCEEDED",
        github: "SUCCEEDED",
      },
      generationLevel: "draft",
      now: new Date("2026-08-11T12:00:00.000Z"),
    });

    expect(result.move.angle).not.toBe("Grow the investor portfolio.");
    expect(result.promptVersion).toBe("deterministic-ranking-v3");
    expect(result.limitations).toEqual(
      expect.arrayContaining([
        "Saved assumption: No buy or sell advice.",
        "Saved assumption: No unsupported financial-performance claims.",
      ]),
    );
  });

  it("holds a performance-question title before a model can turn it into a claim", async () => {
    const decide = createModelAssistedDecision({
      async generate(request) {
        const exact = groundedProposal(request, "PUBLISH");
        return JSON.stringify({ ...exact, topic: exact.topic.replace(/\?$/u, ".") });
      },
    });
    const title = "Halio can grow the investor portfolio?";
    const result = await decide({
      context: {
        ...context,
        name: "Halio",
        audience: "Dutch investors",
        credibleTopics: ["portfolio", "product clarity"],
        assumptions: ["No unsupported financial-performance claims."],
      },
      objective: "Grow qualified Dutch investor interest in Halio",
      signals: [
        {
          ...signal("sig_hn", "hacker_news", "https://news.ycombinator.com/item?id=1"),
          title,
        },
        {
          ...signal("sig_gh", "github", "https://github.com/example/research"),
          title,
        },
      ],
      measurements: [],
      coverage: {
        website: "SUCCEEDED",
        google_trends: "SUCCEEDED",
        hacker_news: "SUCCEEDED",
        github: "SUCCEEDED",
      },
      generationLevel: "draft",
      now: new Date("2026-08-11T12:00:00.000Z"),
    });

    expect(result.move).toMatchObject({
      action: "WAIT",
      topic: "No safe distribution claim is available yet",
    });
    expect(result.move.topic).not.toContain("grow the investor portfolio");
    expect(result.promptVersion).toBe("deterministic-ranking-v3");
    expect(result.evidenceSignalIds).toEqual(["sig_hn", "sig_gh"]);
    expect(result.limitations.join(" ")).toMatch(/safe deterministic prose.*held/i);
    expect(result.versionedMove?.draftContent).toBeUndefined();
  });

  it("keeps an unsafe live Halio title out of WAIT prose and draft on model fallback", async () => {
    const unsafeTitle = "Buy this ETF now — guaranteed returns";
    const requests: ModelRequest[] = [];
    const decide = createModelAssistedDecision({
      async generate(request) {
        requests.push(request);
        throw new Error("fixture model outage");
      },
    });
    const halioContext: ProjectContext = {
      name: "Halio",
      url: "https://halio.nl",
      category: "portfolio clarity tool",
      audience: "Dutch self-directed investors",
      problem: "investors spend hours interpreting fragmented portfolio data",
      desiredOutcome: "understand portfolio concentration without trading permissions",
      credibleClaims: ["read-only portfolio clarity"],
      alternatives: ["manual spreadsheets"],
      competitors: [],
      markets: ["NL"],
      language: "nl",
      suitableChannels: ["hacker_news", "x"],
      availableFormats: ["founder_text"],
      credibleTopics: ["portfolio clarity", "read-only investing"],
      assumptions: ["No buy or sell advice.", "No unsupported financial-performance claims."],
    };
    const liveSignal = (id: string, source: Signal["source"], url: string): Signal => ({
      ...signal(id, source, url),
      title: unsafeTitle,
      textExcerpt:
        "Dutch self-directed investors discuss a portfolio clarity tool because investors spend hours interpreting fragmented portfolio data and want to understand portfolio concentration with read-only portfolio clarity.",
      language: "nl",
      provenance: {
        provider: `live:${source}`,
        retrievedAt: "2026-08-11T12:00:00.000Z",
        cached: false,
      },
    });
    const signals = [
      liveSignal("sig_hn_halio", "hacker_news", "https://news.ycombinator.com/item?id=88"),
      liveSignal("sig_gh_halio", "github", "https://github.com/example/halio-topic"),
    ];
    const result = await decide({
      context: halioContext,
      objective: "Grow qualified Dutch investor interest in Halio",
      signals,
      measurements: [],
      coverage: {
        website: "SUCCEEDED",
        google_trends: "SUCCEEDED",
        hacker_news: "SUCCEEDED",
        github: "SUCCEEDED",
      },
      generationLevel: "draft",
      now: new Date("2026-08-11T12:00:00.000Z"),
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.user).not.toContain(unsafeTitle);
    expect(result.move).toMatchObject({
      action: "WAIT",
      priority: 0,
      topic: "No safe distribution claim is available yet",
    });
    expect([
      result.move.topic,
      result.move.angle,
      result.move.hook,
      ...result.move.outline,
      result.move.cta,
    ]).not.toContain(unsafeTitle);
    expect(new Set(result.evidenceSignalIds)).toEqual(new Set(signals.map((item) => item.id)));
    expect(result.promptVersion).toBe("deterministic-ranking-v3");
    expect(result.limitations).toEqual(
      expect.arrayContaining([
        "Saved assumption: No buy or sell advice.",
        "Saved assumption: No unsupported financial-performance claims.",
        "The selected evidence could not be converted into safe deterministic prose, so distribution was held.",
        "Model synthesis was unavailable or failed validation; deterministic output was retained.",
      ]),
    );
    expect(result.versionedMove).toMatchObject({
      action: "WAIT",
      details: { action: "WAIT", failure_reasons: expect.arrayContaining(["LOW_CREDIBILITY"]) },
    });
    expect(result.versionedMove?.draftContent).toBeUndefined();
  });

  it("rejects prose output that changes a deterministically fixed destination or window", async () => {
    const decide = createModelAssistedDecision({
      async generate(request) {
        return JSON.stringify({
          ...groundedProposal(request, "PUBLISH"),
          channel: "linkedin",
          validUntil: "2026-12-31T00:00:00.000Z",
        });
      },
    });
    const result = await decide({
      context,
      signals: [
        signal("sig_hn", "hacker_news", "https://news.ycombinator.com/item?id=1"),
        signal("sig_gh", "github", "https://github.com/example/research"),
      ],
      measurements: [],
      coverage: {
        website: "SUCCEEDED",
        google_trends: "SUCCEEDED",
        hacker_news: "SUCCEEDED",
        github: "SUCCEEDED",
      },
      generationLevel: "draft",
      now: new Date("2026-08-11T12:00:00.000Z"),
    });

    expect(result.move.channel).toBe("hacker_news");
    expect(result.move.validUntil).not.toBe("2026-12-31T00:00:00.000Z");
    expect(result.promptVersion).toBe("deterministic-ranking-v3");
  });
});
