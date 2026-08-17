import { describe, expect, it } from "vitest";

import {
  normalizeDataForSeoGoogleTrends,
  normalizeGitHubItem,
  normalizeHackerNewsHit,
  normalizeTavilyResult,
  normalizeXaiXSearchResponse,
  normalizeYouTubeVideo,
  xStatusPublishedAt,
} from "../src/index";

const normalizedAt = "2026-08-11T08:00:00.000Z";

describe("live provider normalization", () => {
  it("normalizes Hacker News canonical metadata", () => {
    const signal = normalizeHackerNewsHit(
      {
        objectID: "41234567",
        title: "Ask HN: how do you research distribution?",
        url: "https://example.com/linked-article",
        author: "founder",
        created_at: "2026-08-11T06:00:00.000Z",
        points: 81,
        num_comments: 29,
      },
      "query_hn",
      normalizedAt,
      "req_hn",
    );

    expect(signal).toMatchObject({
      source: "hacker_news",
      sourceId: "41234567",
      url: "https://news.ycombinator.com/item?id=41234567",
      metrics: { points: 81, comments: 29 },
      queryId: "query_hn",
    });
  });

  it("normalizes GitHub repositories and issues without claiming star velocity", () => {
    const repository = normalizeGitHubItem(
      {
        id: 123,
        full_name: "trendsfast/trendsfast",
        html_url: "https://github.com/trendsfast/trendsfast",
        description: "Distribution intelligence for founders",
        owner: { id: 7, login: "trendsfast" },
        pushed_at: "2026-08-10T10:00:00.000Z",
        stargazers_count: 120,
        forks_count: 14,
        open_issues_count: 8,
      },
      "repository",
      "query_gh_repo",
      normalizedAt,
      "req_gh",
    );
    expect(repository.metrics).toEqual({ stars: 120, forks: 14, comments: 8 });
    expect(repository).not.toHaveProperty("velocity");

    const issue = normalizeGitHubItem(
      {
        id: 456,
        title: "Need a better distribution research workflow",
        html_url: "https://github.com/example/tool/issues/4",
        body: "Current research takes hours.",
        user: { id: 9, login: "technical-founder" },
        created_at: "2026-08-11T04:00:00.000Z",
        comments: 6,
      },
      "issue",
      "query_gh_issue",
      normalizedAt,
      "req_gh",
    );
    expect(issue).toMatchObject({ source: "github", metrics: { comments: 6 } });

    const release = normalizeGitHubItem(
      {
        id: 789,
        name: "v0.1 alpha",
        tag_name: "v0.1.0-alpha",
        html_url: "https://github.com/trendsfast/trendsfast/releases/tag/v0.1.0-alpha",
        body: "The first evidence-backed distribution release.",
        author: { id: 11, login: "maintainer" },
        published_at: "2026-08-11T03:00:00.000Z",
      },
      "release",
      "query_gh_release",
      normalizedAt,
      "req_gh",
    );
    expect(release).toMatchObject({
      sourceId: "release:789",
      title: "v0.1 alpha",
      publishedAt: "2026-08-11T03:00:00.000Z",
      metrics: {},
    });
  });

  it("normalizes only original X post citations, never the model summary", () => {
    const result = normalizeXaiXSearchResponse(
      {
        id: "resp_x",
        output_text: "A model-written summary that must not become evidence.",
        citations: [
          "https://x.com/founder/status/1900000000000000000",
          "https://example.com/not-x",
          { url: "https://twitter.com/dev/status/1900000000000000001", title: "A developer post" },
        ],
        usage: { input_tokens: 100, output_tokens: 50, num_sources_used: 2 },
      },
      "query_x",
      normalizedAt,
    );

    expect(result.signals).toHaveLength(2);
    expect(result.signals[0]?.url).toMatch(/^https:\/\/(x|twitter)\.com\//);
    expect(result.signals[0]?.publishedAt).toBe("2025-03-13T01:44:34.949Z");
    expect(result.signals[1]?.publishedAt).toBe("2025-03-13T01:44:34.949Z");
    expect(result.signals[0]?.textExcerpt).toBeUndefined();
    expect(result.signals.map((signal) => signal.title)).not.toContain(
      "A model-written summary that must not become evidence.",
    );
    const futureStatusId = String(
      (BigInt(new Date(normalizedAt).getTime() + 60_000) - 1_288_834_974_657n) << 22n,
    );
    expect(xStatusPublishedAt(futureStatusId, normalizedAt)).toBeUndefined();
    expect(
      normalizeXaiXSearchResponse(
        { citations: [`https://x.com/founder/status/${futureStatusId}`] },
        "query_future_x",
        normalizedAt,
      ).signals,
    ).toEqual([]);
  });

  it("preserves Tavily original URLs and publication metadata", () => {
    expect(
      normalizeTavilyResult(
        {
          url: "https://example.org/news/launch",
          title: "A current developer-tool launch",
          content: "Independent reporting about the launch.",
          published_date: "2026-08-10T00:00:00.000Z",
          score: 0.91,
        },
        "query_tavily",
        normalizedAt,
        "req_tavily",
      ),
    ).toMatchObject({
      source: "tavily",
      url: "https://example.org/news/launch",
      publishedAt: "2026-08-10T00:00:00.000Z",
    });
  });

  it("combines YouTube snippet and public statistics", () => {
    expect(
      normalizeYouTubeVideo(
        {
          id: "abcdefghijk",
          snippet: {
            title: "Founder distribution research tutorial",
            description: "A practical walkthrough.",
            channelId: "channel-1",
            channelTitle: "Technical Founder",
            publishedAt: "2026-08-10T00:00:00.000Z",
          },
          statistics: { viewCount: "12000", likeCount: "640", commentCount: "72" },
        },
        "query_youtube",
        normalizedAt,
        "req_youtube",
      ),
    ).toMatchObject({
      source: "youtube",
      url: "https://www.youtube.com/watch?v=abcdefghijk",
      metrics: { views: 12000, likes: 640, comments: 72 },
    });
  });

  it("normalizes DataForSEO Google Trends graph points and reported cost", () => {
    const result = normalizeDataForSeoGoogleTrends(
      {
        cost: 0.004,
        tasks: [
          {
            id: "task-1",
            cost: 0.004,
            status_code: 20000,
            result: [
              {
                check_url: "https://trends.google.com/trends/explore?q=distribution%20intelligence",
                keywords: ["distribution intelligence"],
                items: [
                  {
                    type: "google_trends_graph",
                    data: [
                      { timestamp: 1785801600, values: [31], missing_data: false },
                      { timestamp: 1786406400, values: [57], missing_data: false },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      [{ id: "query_trends", query: "distribution intelligence" }],
      normalizedAt,
    );

    expect(result.actualCostUsd).toBe(0.004);
    expect(result.signals[0]?.provenance.provider).toBe("dataforseo_google_trends");
    expect(result.measurements[0]).toMatchObject({
      kind: "EXTERNAL_TIME_SERIES",
      label: "distribution intelligence",
    });
    expect(result.measurements[0]?.points).toHaveLength(2);
  });

  it("omits Google Trends graph data when DataForSEO supplies no canonical check URL", () => {
    const result = normalizeDataForSeoGoogleTrends(
      {
        cost: 0.004,
        tasks: [
          {
            id: "task-without-check-url",
            cost: 0.004,
            status_code: 20000,
            result: [
              {
                keywords: ["distribution intelligence"],
                items: [
                  {
                    type: "google_trends_graph",
                    data: [{ timestamp: 1785801600, values: [31], missing_data: false }],
                  },
                ],
              },
            ],
          },
        ],
      },
      [{ id: "query_trends", query: "distribution intelligence" }],
      normalizedAt,
    );

    expect(result.actualCostUsd).toBe(0.004);
    expect(result.signals).toEqual([]);
    expect(result.measurements).toEqual([]);
  });
});
