import { describe, expect, it, vi } from "vitest";

import {
  ProviderBudget,
  ProviderCircuitBreaker,
  buildQueryPlan,
  createLiveProviderRegistry,
  createProviderContext,
  executeProvider,
  usdTicksToUsd,
  validateProviderRunResult,
  type FetchLike,
  type ProductQueryContext,
  type WebsiteTransport,
} from "../src/index";

const product: ProductQueryContext = {
  category: "distribution intelligence",
  pain: "founders spend hours researching distribution",
  desiredOutcome: "choose one evidence-backed move",
  productTerminology: ["TrendsFast"],
  buyerTerminology: ["technical founders"],
  alternatives: ["social listening"],
  competitors: ["trend dashboards"],
  adjacentNarratives: ["founder-led growth"],
  credibleTopics: ["distribution research"],
  triggerEvents: ["developer tool launches"],
  repositories: ["trendsfast/trendsfast"],
};

const now = new Date("2026-08-11T08:00:00.000Z");
const plan = buildQueryPlan(product, { productUrl: "https://trendsfast.com", now });

function json(value: unknown, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("bounded live REST adapters", () => {
  it("converts only non-negative safe-integer USD ticks", () => {
    expect(usdTicksToUsd(10_000_000_000)).toBe(1);
    expect(usdTicksToUsd("35550000")).toBe(0.003555);
    expect(usdTicksToUsd(" 0 ")).toBe(0);

    for (const invalid of [
      -1,
      0.5,
      Number.MAX_SAFE_INTEGER + 1,
      "-1",
      "0.5",
      "1e10",
      String(Number.MAX_SAFE_INTEGER + 1),
      "",
      null,
      true,
    ]) {
      expect(usdTicksToUsd(invalid)).toBeUndefined();
    }
  });

  it("aborts a stalled paid fetch before returning at the scan deadline", async () => {
    let activeRequests = 0;
    const aborted = vi.fn();
    const fetch = vi.fn<FetchLike>(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          activeRequests += 1;
          const signal = init?.signal;
          expect(signal).toBeInstanceOf(AbortSignal);
          signal?.addEventListener(
            "abort",
            () => {
              activeRequests -= 1;
              aborted();
              reject(new DOMException("aborted", "AbortError"));
            },
            { once: true },
          );
        }),
    );
    const adapter = createLiveProviderRegistry().get("google_trends")!;
    const result = await executeProvider(
      adapter,
      {
        scanId: "scan_paid_deadline",
        queries: plan.entries.filter((query) => query.provider === "google_trends"),
      },
      {
        context: createProviderContext({
          credentialMode: "byok",
          env: {
            DATAFORSEO_LOGIN: "test-login",
            DATAFORSEO_PASSWORD: "test-password",
            DATAFORSEO_GOOGLE_TRENDS_MODE: "live",
            DATAFORSEO_ESTIMATED_COST_USD_PER_TASK: "7.111",
          },
          fetch,
          now: () => now,
        }),
        budget: new ProviderBudget(91.333),
        circuitBreaker: new ProviderCircuitBreaker(),
        deadline: new Date(now.getTime() + 10),
      },
    );

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(aborted).toHaveBeenCalledTimes(1);
    expect(activeRequests).toBe(0);
    expect(result.status).toBe("FAILED");
    expect(result.attempts).toBe(1);
    expect(result.errors[0]?.code).toBe("PROVIDER_DEADLINE_EXCEEDED");
  });

  it("aborts the pinned website transport at the earlier scan deadline", async () => {
    let activeRequests = 0;
    const aborted = vi.fn();
    const websiteTransport = vi.fn<WebsiteTransport>(
      ({ signal }) =>
        new Promise((_resolve, reject) => {
          activeRequests += 1;
          signal.addEventListener(
            "abort",
            () => {
              activeRequests -= 1;
              aborted();
              reject(new DOMException("aborted", "AbortError"));
            },
            { once: true },
          );
        }),
    );
    const adapter = createLiveProviderRegistry().get("website")!;
    const result = await executeProvider(
      adapter,
      {
        scanId: "scan_website_deadline",
        productUrl: "https://example.com",
        queries: plan.entries.filter((query) => query.provider === "website"),
      },
      {
        context: createProviderContext({
          credentialMode: "managed",
          websiteTransport,
          resolveDns: async () => [{ address: "93.184.216.34", family: 4 }],
          now: () => now,
        }),
        budget: new ProviderBudget(91.333),
        circuitBreaker: new ProviderCircuitBreaker(),
        deadline: new Date(now.getTime() + 10),
      },
    );

    expect(websiteTransport).toHaveBeenCalledTimes(1);
    expect(aborted).toHaveBeenCalledTimes(1);
    expect(activeRequests).toBe(0);
    expect(result.status).toBe("FAILED");
    expect(result.attempts).toBe(1);
    expect(result.errors[0]?.code).toBe("PROVIDER_DEADLINE_EXCEEDED");
  });

  it("honors stricter environment call caps without exceeding hard provider maxima", () => {
    const registry = createLiveProviderRegistry();
    const runtime = createProviderContext({
      credentialMode: "managed",
      env: {
        XAI_MAX_TOOL_CALLS_PER_SCAN: "1",
        XAI_ESTIMATED_COST_USD_PER_SEARCH: "9.333",
        TAVILY_MAX_CREDITS_PER_SCAN: "1",
        TAVILY_ESTIMATED_COST_USD_PER_CREDIT: "7.111",
        YOUTUBE_MAX_SEARCHES_PER_SCAN: "1",
        YOUTUBE_INTERNAL_QUOTA_VALUE_USD: "3.777",
      },
    });
    expect(
      registry
        .get("x")!
        .estimate(
          { scanId: "scan_caps", queries: plan.entries.filter((query) => query.provider === "x") },
          runtime,
        ).calls,
    ).toBe(1);
    expect(
      registry.get("tavily")!.estimate(
        {
          scanId: "scan_caps",
          queries: plan.entries.filter((query) => query.provider === "tavily"),
        },
        runtime,
      ).calls,
    ).toBe(1);
    expect(
      registry.get("youtube")!.estimate(
        {
          scanId: "scan_caps",
          queries: plan.entries.filter((query) => query.provider === "youtube"),
        },
        runtime,
      ).calls,
    ).toBe(2);
  });

  it("groups five Google Trends keywords into one paid DataForSEO live task", async () => {
    const fetch = vi.fn<FetchLike>(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as Array<Record<string, unknown>>;
      expect(body).toHaveLength(1);
      expect(body[0]?.keywords).toHaveLength(5);
      return json({
        cost: 3.777,
        tasks: [
          {
            id: "task-live-1",
            status_code: 20000,
            cost: 3.777,
            result: [
              {
                check_url: "https://trends.google.com/trends/explore?q=TrendsFast",
                keywords: body[0]?.keywords,
                items: [
                  {
                    type: "google_trends_graph",
                    data: [
                      { timestamp: 1785801600, values: [20, 30, 40, 50, 60] },
                      { timestamp: 1786406400, values: [40, 50, 60, 70, 80] },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      });
    });
    const registry = createLiveProviderRegistry();
    const adapter = registry.get("google_trends")!;
    const result = await adapter.collect(
      {
        scanId: "scan_google_live",
        queries: plan.entries.filter((query) => query.provider === "google_trends"),
      },
      createProviderContext({
        credentialMode: "byok",
        env: {
          DATAFORSEO_LOGIN: "test-login",
          DATAFORSEO_PASSWORD: "test-password",
          DATAFORSEO_GOOGLE_TRENDS_MODE: "live",
          DATAFORSEO_ESTIMATED_COST_USD_PER_TASK: "7.111",
        },
        fetch,
        now: () => now,
      }),
    );

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.calls).toBe(1);
    expect(result.cost.actualUsd).toBe(3.777);
    expect(result.measurements).toHaveLength(5);
    expect(validateProviderRunResult(adapter, result)).toEqual([]);
  });

  it("caps xAI at two Responses calls and stores only original X citations", async () => {
    let sequence = 0;
    const fetch = vi.fn<FetchLike>(async (_input, init) => {
      sequence += 1;
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body.max_tool_calls).toBe(1);
      return json({
        id: `resp-${sequence}`,
        output_text: "Discard this generated summary.",
        citations: [
          `https://x.com/founder/status/190000000000000000${sequence}`,
          "https://example.com/not-x",
        ],
        usage: {
          input_tokens: 80,
          output_tokens: 20,
          cost_in_usd_ticks: sequence === 1 ? 35_550_000 : "35550000",
          cost_usd: 3.555,
        },
      });
    });
    const registry = createLiveProviderRegistry();
    const adapter = registry.get("x")!;
    const result = await adapter.collect(
      {
        scanId: "scan_x_live",
        queries: plan.entries.filter((query) => query.provider === "x"),
      },
      createProviderContext({
        credentialMode: "managed",
        env: {
          XAI_API_KEY: "test-key",
          XAI_MODEL: "grok-test",
          XAI_ESTIMATED_COST_USD_PER_SEARCH: "9.333",
        },
        fetch,
        now: () => now,
      }),
    );

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result.calls).toBe(2);
    expect(result.signals).toHaveLength(2);
    expect(result.signals.every((signal) => signal.textExcerpt === undefined)).toBe(true);
    expect(result.cost.actualUsd).toBe(0.00711);
    expect(validateProviderRunResult(adapter, result)).toEqual([]);
  });

  it("falls through malformed xAI ticks to a valid legacy cost field", async () => {
    const fetch = vi.fn<FetchLike>(async () =>
      json({
        id: "resp-invalid-ticks",
        citations: ["https://x.com/founder/status/1900000000000000099"],
        usage: {
          input_tokens: 80,
          output_tokens: 20,
          cost_in_usd_ticks: "35550000.5",
          cost_usd: 0.002,
        },
      }),
    );
    const adapter = createLiveProviderRegistry().get("x")!;
    const result = await adapter.collect(
      {
        scanId: "scan_x_legacy_cost",
        queries: plan.entries.filter((query) => query.provider === "x"),
      },
      createProviderContext({
        credentialMode: "managed",
        env: {
          XAI_API_KEY: "test-key",
          XAI_MODEL: "grok-test",
          XAI_MAX_TOOL_CALLS_PER_SCAN: "1",
          XAI_ESTIMATED_COST_USD_PER_SEARCH: "9.333",
        },
        fetch,
        now: () => now,
      }),
    );

    expect(fetch).toHaveBeenCalledOnce();
    expect(result.cost.actualUsd).toBe(0.002);
    expect(validateProviderRunResult(adapter, result)).toEqual([]);
  });

  it("retains the bounded xAI estimate when every actual-cost field is unknown", async () => {
    const fetch = vi.fn<FetchLike>(async () =>
      json({
        id: "resp-unknown-cost",
        citations: ["https://x.com/founder/status/1900000000000000100"],
        usage: {
          input_tokens: 80,
          output_tokens: 20,
          cost_in_usd_ticks: Number.MAX_SAFE_INTEGER + 1,
          cost_usd: "not-a-cost",
          cost: -1,
        },
      }),
    );
    const adapter = createLiveProviderRegistry().get("x")!;
    const result = await adapter.collect(
      {
        scanId: "scan_x_unknown_cost",
        queries: plan.entries.filter((query) => query.provider === "x"),
      },
      createProviderContext({
        credentialMode: "managed",
        env: {
          XAI_API_KEY: "test-key",
          XAI_MODEL: "grok-test",
          XAI_MAX_TOOL_CALLS_PER_SCAN: "1",
          XAI_ESTIMATED_COST_USD_PER_SEARCH: "9.333",
        },
        fetch,
        now: () => now,
      }),
    );

    expect(result.cost).toEqual({ estimatedUsd: 9.333 });
    expect(result.limitations).toContain(
      "xAI did not return an actual USD cost; the bounded estimate is retained.",
    );
    expect(validateProviderRunResult(adapter, result)).toEqual([]);
  });

  it("uses two raw Tavily basic searches with answer generation disabled", async () => {
    let sequence = 0;
    const fetch = vi.fn<FetchLike>(async (_input, init) => {
      sequence += 1;
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body.search_depth).toBe("basic");
      expect(body.include_answer).toBe(false);
      return json({
        request_id: `tav-${sequence}`,
        usage: { credits: 1 },
        results: [
          {
            url: `https://news.example.org/story-${sequence}`,
            title: `Independent trigger ${sequence}`,
            content: "Independent reporting about a current developer-tool launch.",
            published_date: "2026-08-10T00:00:00.000Z",
          },
        ],
      });
    });
    const registry = createLiveProviderRegistry();
    const adapter = registry.get("tavily")!;
    const result = await adapter.collect(
      {
        scanId: "scan_tavily_live",
        queries: plan.entries.filter((query) => query.provider === "tavily"),
      },
      createProviderContext({
        credentialMode: "byok",
        env: {
          TAVILY_API_KEY: "test-key",
          TAVILY_ESTIMATED_COST_USD_PER_CREDIT: "7.111",
        },
        fetch,
        now: () => now,
      }),
    );

    expect(result.calls).toBe(2);
    expect(result.quota.used).toBe(2);
    expect(result.cost.actualUsd).toBeUndefined();
    expect(validateProviderRunResult(adapter, result)).toEqual([]);
  });

  it("uses official HN/GitHub reads and batches YouTube statistics", async () => {
    let youtubeSearch = 0;
    const fetch = vi.fn<FetchLike>(async (input) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (url.hostname === "hn.algolia.com") {
        return json({
          hits: [
            {
              objectID: `hn-${url.searchParams.get("query")?.length}`,
              title: "Ask HN: founder distribution research",
              author: "founder",
              created_at: "2026-08-11T06:00:00.000Z",
              points: 42,
              num_comments: 13,
            },
          ],
        });
      }
      if (url.hostname === "api.github.com") {
        if (url.pathname.endsWith("/releases")) {
          return json([
            {
              id: 3,
              name: "v0.1 alpha",
              tag_name: "v0.1.0-alpha",
              html_url: "https://github.com/trendsfast/trendsfast/releases/tag/v0.1.0-alpha",
              body: "Initial release.",
              author: { id: 7, login: "example" },
              published_at: "2026-08-11T03:00:00.000Z",
            },
          ]);
        }
        const issue = url.pathname.endsWith("/issues");
        return json(
          {
            items: issue
              ? [
                  {
                    id: 2,
                    title: "Distribution research workflow",
                    html_url: "https://github.com/example/tool/issues/2",
                    body: "Research takes too long.",
                    user: { id: 9, login: "founder" },
                    created_at: "2026-08-11T05:00:00.000Z",
                    comments: 4,
                  },
                ]
              : [
                  {
                    id: 1,
                    full_name: "example/distribution-tool",
                    html_url: "https://github.com/example/distribution-tool",
                    description: "A developer distribution tool.",
                    owner: { id: 7, login: "example" },
                    pushed_at: "2026-08-11T04:00:00.000Z",
                    stargazers_count: 120,
                    forks_count: 12,
                    open_issues_count: 3,
                  },
                ],
          },
          {
            "x-github-request-id": "gh-request",
            "x-ratelimit-limit": "60",
            "x-ratelimit-used": "4",
          },
        );
      }
      if (url.pathname.endsWith("/search")) {
        youtubeSearch += 1;
        return json({
          items: [
            {
              id: { videoId: `video00000${youtubeSearch}` },
              snippet: {
                title: `Founder tutorial ${youtubeSearch}`,
                description: "A practical tutorial.",
                channelId: "channel-1",
                channelTitle: "Founder",
                publishedAt: "2026-08-10T00:00:00.000Z",
              },
            },
          ],
        });
      }
      if (url.pathname.endsWith("/videos")) {
        return json({
          items: (url.searchParams.get("id") ?? "").split(",").map((id) => ({
            id,
            snippet: {
              title: `Video ${id}`,
              description: "A practical tutorial.",
              channelId: "channel-1",
              channelTitle: "Founder",
              publishedAt: "2026-08-10T00:00:00.000Z",
            },
            statistics: { viewCount: "1000", likeCount: "80", commentCount: "12" },
          })),
        });
      }
      throw new Error(`Unexpected URL ${url.href}`);
    });
    const registry = createLiveProviderRegistry();
    const runtime = createProviderContext({
      credentialMode: "byok",
      env: {
        YOUTUBE_API_KEY: "test-youtube",
        YOUTUBE_INTERNAL_QUOTA_VALUE_USD: "3.777",
      },
      fetch,
      now: () => now,
    });
    for (const slug of ["hacker_news", "github", "youtube"] as const) {
      const adapter = registry.get(slug)!;
      const result = await adapter.collect(
        {
          scanId: `scan_${slug}_live`,
          queries: plan.entries.filter((query) => query.provider === slug),
        },
        runtime,
      );
      expect(result.status).toBe("SUCCESS");
      expect(validateProviderRunResult(adapter, result)).toEqual([]);
      if (slug === "youtube") {
        expect(result.calls).toBe(3);
        expect(result.quota.used).toBe(3);
        expect(result.quota.breakdown).toEqual({ searchQueries: 2, generalUnits: 1 });
        expect(result.signals).toHaveLength(2);
      }
    }
  });

  it("keeps website and manual records on their safe, source-labelled paths", async () => {
    const fetch = vi.fn<FetchLike>(async () => {
      throw new Error("The website adapter must not use the ordinary fetch transport");
    });
    const websiteTransport = vi.fn<WebsiteTransport>(async ({ addresses }) => {
      expect(addresses).toEqual([{ address: "93.184.216.34", family: 4 }]);
      return new Response("<title>TrendsFast</title><main>Evidence-backed distribution.</main>", {
        headers: { "content-type": "text/html" },
      });
    });
    const registry = createLiveProviderRegistry();
    const runtime = createProviderContext({
      credentialMode: "byok",
      env: {},
      fetch,
      websiteTransport,
      resolveDns: async () => [{ address: "93.184.216.34", family: 4 }],
      now: () => now,
    });
    const website = registry.get("website")!;
    const websiteResult = await website.collect(
      {
        scanId: "scan_website_live",
        productUrl: "https://trendsfast.com",
        queries: plan.entries.filter((query) => query.provider === "website"),
      },
      runtime,
    );
    expect(validateProviderRunResult(website, websiteResult)).toEqual([]);
    expect(websiteTransport).toHaveBeenCalledTimes(5);
    expect(websiteResult.signals).toHaveLength(5);
    expect(fetch).not.toHaveBeenCalled();

    const manual = registry.get("manual")!;
    const manualResult = await manual.collect(
      {
        scanId: "scan_manual_live",
        queries: [],
        manualEvidence: [
          {
            url: "https://www.reddit.com/r/startups/comments/example",
            sourceLabel: "Reddit",
            title: "A founder discussion",
            excerpt: "Founders describe the same distribution research pain.",
            reason: "Directly relevant founder pain.",
            reviewedBy: "founder",
          },
        ],
      },
      runtime,
    );
    expect(manualResult.signals[0]?.provenance.provider).toBe("MANUAL_FOUNDER_EVIDENCE");
    expect(validateProviderRunResult(manual, manualResult)).toEqual([]);

    await expect(
      manual.collect(
        {
          scanId: "scan_manual_private",
          queries: [],
          manualEvidence: [
            {
              url: "http://127.0.0.1/admin",
              sourceLabel: "Private",
              title: "Private record",
              reason: "Should never be accepted.",
              reviewedBy: "founder",
            },
          ],
        },
        runtime,
      ),
    ).rejects.toThrow(/non-public/i);
  });
});
