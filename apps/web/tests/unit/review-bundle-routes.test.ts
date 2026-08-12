import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  buildReviewBundle: vi.fn(),
  repositories: {},
}));

vi.mock("../../lib/server-database", () => ({
  getRepositories: () => mocks.repositories,
}));
vi.mock("../../lib/review-bundle-service", () => ({
  buildReviewBundle: mocks.buildReviewBundle,
}));

import { GET as getJsonBundle } from "../../app/api/ops/scans/[scanId]/review-bundle.json/route";
import { GET as getMarkdownBundle } from "../../app/api/ops/scans/[scanId]/review-bundle.md/route";
import { issueOpsSession } from "../../lib/ops-session";
import { redactReviewBundle, type ReviewBundle } from "../../lib/review-bundle";

const secret = "review-bundle-route-secret-that-is-at-least-32-characters";
const scanId = "scan_review_bundle_route";
const stripeSecretFixture = ["sk", "live", "51AbCdEfGhIjKlMnOpQrStUv"].join("_");
const bundle = redactReviewBundle({
  generatedAt: "2026-08-12T10:00:00.000Z",
  release: { sha: "abc123", environment: "preview", host: "preview.example", deploymentId: null },
  scan: {
    id: "00000000-0000-4000-8000-000000000001",
    productUrl: "https://product.example",
    state: "REVIEW_REQUIRED",
  },
  context: { current: {}, corrections: [] },
  queryPlan: null,
  providerRuns: [],
  cost: { estimatedUsd: 0, settledActualUsd: null, quota: 0, attempts: [] },
  evidence: [],
  clusters: [],
  opportunities: [],
  qualityFloor: { passed: false, reasons: [] },
  nextMove: { limitation: `bare secret ${stripeSecretFixture}` },
  versions: { model: null, prompt: "prompt-v1", score: "score-v1" },
  reviewEvents: [],
} satisfies ReviewBundle);

function request(path: string, authenticated = true): Request {
  const session = issueOpsSession({ secret, now: new Date("2026-08-12T10:00:00.000Z") });
  return new Request(`https://trendsfast.example${path}`, {
    headers: {
      "sec-fetch-site": "same-origin",
      ...(authenticated ? { cookie: `tf_ops_session=${session}` } : {}),
    },
  });
}

describe("founder review bundle routes", () => {
  beforeEach(() => {
    vi.stubEnv("SESSION_SECRET", secret);
    mocks.buildReviewBundle.mockReset();
    mocks.buildReviewBundle.mockResolvedValue(bundle);
  });

  it("rejects a read without a signed founder session", async () => {
    const response = await getJsonBundle(
      request(`/api/ops/scans/${scanId}/review-bundle.json`, false),
      { params: Promise.resolve({ scanId }) },
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.buildReviewBundle).not.toHaveBeenCalled();
  });

  it("returns a no-store redacted JSON attachment to the founder session", async () => {
    const response = await getJsonBundle(request(`/api/ops/scans/${scanId}/review-bundle.json`), {
      params: Promise.resolve({ scanId }),
    });
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("private, no-store");
    expect(response.headers.get("content-disposition")).toContain("review.json");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(body).toContain("[REDACTED_STRIPE_SECRET]");
    expect(body).not.toContain(stripeSecretFixture);
  });

  it("returns the same private truth as a Markdown attachment", async () => {
    const response = await getMarkdownBundle(request(`/api/ops/scans/${scanId}/review-bundle.md`), {
      params: Promise.resolve({ scanId }),
    });
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("private, no-store");
    expect(response.headers.get("content-type")).toContain("text/markdown");
    expect(response.headers.get("content-disposition")).toContain("review.md");
    expect(body).toContain("# TrendsFast review bundle");
    expect(body).not.toContain(stripeSecretFixture);
  });
});
