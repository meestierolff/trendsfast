import { describe, expect, it, vi } from "vitest";

import {
  redactReviewBundle,
  renderReviewBundleMarkdown,
  type ReviewBundle,
} from "../../lib/review-bundle";

const deliveryCapability = `scan_AbCdEf12.${"D".repeat(43)}`;
const publicScanCapability = `scan_${"P".repeat(43)}`;
const stripeSecretFixture = ["sk", "live", "51AbCdEfGhIjKlMnOpQrStUv"].join("_");
const webhookSecretFixture = ["whsec", "AbCdEfGhIjKlMnOpQrStUvWx"].join("_");
const embeddedCredentials = [
  "sk-proj-AbCdEfGhIjKlMnOpQrStUvWx",
  "xai-AbCdEfGhIjKlMnOpQrStUvWx",
  "tvly-AbCdEfGhIjKlMnOpQrStUvWx",
  `ghp_${"G".repeat(36)}`,
  `github_pat_${"H".repeat(40)}`,
  `AIza${"I".repeat(35)}`,
];

const rawBundle = {
  generatedAt: "2026-08-12T10:00:00.000Z",
  release: {
    sha: "abcdef123456",
    environment: "preview",
    host: "preview.trendsfast.example",
    deploymentId: "deployment_1",
  },
  scan: {
    id: "scan_public_1",
    productUrl: "https://product.example/?token=private-delivery-token",
    state: "REVIEW_REQUIRED",
  },
  context: {
    current: {
      name: "Product",
      assumptions: [
        "Inspect https://downloads.example/file?token=embedded-customer-secret&X-Amz-Signature=embedded-signature before review.",
      ],
    },
    corrections: [],
  },
  queryPlan: null,
  providerRuns: [
    {
      source: "tavily",
      provider: "tavily",
      state: "SUCCEEDED",
      latencyMs: 100,
      calls: 1,
      maxCalls: 2,
      quota: 1,
      estimatedCostUsd: 0.01,
      settledActualCostUsd: 0.01,
      measurements: [],
      limitations: [
        "Bearer raw-bearer-secret",
        `bare Stripe key ${stripeSecretFixture}`,
        `bare webhook ${webhookSecretFixture}`,
        ...embeddedCredentials,
        `provider accidentally echoed ${deliveryCapability} and ${publicScanCapability}`,
        "provider peer was 2001:db8::1 during collection",
      ],
    },
  ],
  cost: { estimatedUsd: 0.01, settledActualUsd: 0.01, quota: 1, attempts: [] },
  evidence: [
    {
      id: "receipt_1",
      signalId: "signal_1",
      moveVersion: 1,
      source: "tavily",
      provider: "tavily",
      canonicalUrl: "https://evidence.example/post?api_key=raw-provider-key",
      title: "Evidence",
      excerpt: "STRIPE_SECRET_KEY=sk_test_should_not_escape",
      visibleMetrics: { views: 12 },
      measurementSeries: [],
      independenceKey: "domain:evidence.example",
      observedAt: "2026-08-12T09:00:00.000Z",
      publishedAt: null,
      reason: "Supports the move.",
      role: "DECISION_SUPPORT",
      verified: true,
      availability: "AVAILABLE",
      reviewedBy: "founder:reviewer",
      verifiedAt: "2026-08-12T09:30:00.000Z",
    },
  ],
  clusters: [],
  opportunities: [],
  qualityFloor: { passed: true, reasons: [] },
  nextMove: null,
  versions: { model: null, prompt: null, score: null },
  reviewEvents: [
    {
      action: "EDITED_AND_APPROVED",
      reviewer: "founder:reviewer",
      before: { cookie: "session-cookie-secret" },
      after: { topic: "Safe" },
      reason: "postgresql://dbuser:database-password@private-db.internal:5432/launch_truth",
      occurredAt: "2026-08-12T09:45:00.000Z",
    },
  ],
} satisfies ReviewBundle;

describe("dogfood review bundle redaction", () => {
  it("redacts secrets and sensitive URL query values in JSON and Markdown", () => {
    const redacted = redactReviewBundle(rawBundle);
    const json = JSON.stringify(redacted);
    const markdown = renderReviewBundleMarkdown(redacted);

    for (const secret of [
      "private-delivery-token",
      "raw-bearer-secret",
      "raw-provider-key",
      "sk_test_should_not_escape",
      stripeSecretFixture,
      webhookSecretFixture,
      "session-cookie-secret",
      "database-password",
      "embedded-customer-secret",
      "embedded-signature",
      deliveryCapability,
      publicScanCapability,
      "2001:db8::1",
      ...embeddedCredentials,
    ]) {
      expect(json).not.toContain(secret);
      expect(markdown).not.toContain(secret);
    }
    expect(redacted.scan.productUrl).toContain("token=%5BREDACTED%5D");
    expect(redacted.evidence[0]?.canonicalUrl).toContain("api_key=%5BREDACTED%5D");
    expect(JSON.stringify(redacted.context)).toContain("token=%5BREDACTED%5D");
    expect(JSON.stringify(redacted.context)).toContain("X-Amz-Signature=%5BREDACTED%5D");
    expect(markdown).toContain("# TrendsFast review bundle");
    expect(markdown).toContain("EDITED_AND_APPROVED");
    for (const databaseFragment of ["postgresql://", "private-db.internal", "/launch_truth"]) {
      expect(json).not.toContain(databaseFragment);
      expect(markdown).not.toContain(databaseFragment);
    }
  });

  it("does not label an unknown provider attempt as settled zero", async () => {
    vi.resetModules();
    vi.doMock("server-only", () => ({}));
    const { settledActualCostForEntries } = await import("../../lib/review-bundle-service");
    const unknown = {
      actualCostUsd: "0",
      unitMetadata: { usage_status: "unknown_not_settled" },
    };
    const settled = {
      actualCostUsd: "0.0125",
      unitMetadata: { usage_status: "provider_reported_settled" },
    };

    expect(settledActualCostForEntries([unknown])).toBeNull();
    expect(settledActualCostForEntries([settled])).toBe(0.0125);
    expect(settledActualCostForEntries([settled, unknown])).toBeNull();
  }, 15_000);
});
