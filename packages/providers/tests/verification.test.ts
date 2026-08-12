import { describe, expect, it, vi } from "vitest";

import {
  createManualEvidenceAdapter,
  createProviderContext,
  createWebsiteAdapter,
  verifyProviderReadback,
  type ProviderAdapter,
} from "../src/index";

const now = new Date("2026-08-11T12:00:00.000Z");

describe("provider read-back verification", () => {
  it("never upgrades deterministic example mode", async () => {
    const adapter = createManualEvidenceAdapter();
    const healthCheck = vi.spyOn(adapter, "healthCheck");
    const result = await verifyProviderReadback({
      adapter,
      context: createProviderContext({ credentialMode: "fixture", now: () => now }),
      request: {
        scanId: "verify_fixture",
        queries: [],
        manualEvidence: [
          {
            url: "https://example.com/evidence",
            sourceLabel: "Founder observation",
            title: "A current public signal",
            reason: "This directly supports the proposed reply.",
            reviewedBy: "founder:test",
          },
        ],
      },
      maximumCostUsd: 0.25,
      deadline: new Date(now.getTime() + 1_000),
    });

    expect(result).toMatchObject({ state: "FIXTURE", readbackVerified: false });
    expect(healthCheck).not.toHaveBeenCalled();
  });

  it("does not call a provider when required credentials are missing", async () => {
    const collect = vi.fn();
    const healthCheck = vi.fn();
    const adapter: ProviderAdapter = {
      ...createManualEvidenceAdapter(),
      metadata: {
        ...createManualEvidenceAdapter().metadata,
        slug: "x",
        publicName: "X",
        requiredEnvironmentVariables: ["XAI_API_KEY"],
      },
      collect,
      healthCheck,
    };
    const result = await verifyProviderReadback({
      adapter,
      context: createProviderContext({ credentialMode: "managed", env: {}, now: () => now }),
      request: { scanId: "verify_unconfigured", queries: [] },
      maximumCostUsd: 0.25,
      deadline: new Date(now.getTime() + 1_000),
    });

    expect(result).toMatchObject({ state: "UNCONFIGURED", readbackVerified: false });
    expect(healthCheck).not.toHaveBeenCalled();
    expect(collect).not.toHaveBeenCalled();
  });

  it("retains conservative health cost and quota when the external outcome fails", async () => {
    const baseAdapter = createManualEvidenceAdapter();
    const collect = vi.fn();
    const adapter: ProviderAdapter = {
      ...baseAdapter,
      metadata: {
        ...baseAdapter.metadata,
        slug: "youtube",
        publicName: "YouTube",
        requiredEnvironmentVariables: ["YOUTUBE_API_KEY"],
      },
      collect,
      healthCheck: async () => ({
        status: "FAILED",
        checkedAt: now.toISOString(),
        message: "The health read outcome is unknown.",
      }),
    };
    const result = await verifyProviderReadback({
      adapter,
      context: createProviderContext({
        credentialMode: "managed",
        env: { YOUTUBE_API_KEY: "server-side-key" },
        now: () => now,
      }),
      request: { scanId: "verify_youtube_health_failed", queries: [] },
      maximumCostUsd: 0.25,
      healthCheckEstimatedCostUsd: 0.01,
      healthCheckQuotaUnits: 1,
      deadline: new Date(now.getTime() + 1_000),
    });

    expect(result).toMatchObject({
      state: "FAILED",
      estimatedCostUsd: 0.01,
      quotaUsed: 1,
    });
    expect(result.actualCostUsd).toBeUndefined();
    expect(result.limitations).toContain(
      "Quota reflects the conservative health-read reservation because the failed external outcome may be unknown.",
    );
    expect(collect).not.toHaveBeenCalled();
  });

  it("requires a bounded original URL before marking the source verified", async () => {
    const adapter = createManualEvidenceAdapter();
    const result = await verifyProviderReadback({
      adapter,
      context: createProviderContext({
        credentialMode: "managed",
        now: () => now,
        resolveDns: async () => [{ address: "93.184.216.34", family: 4 }],
      }),
      request: {
        scanId: "verify_manual",
        queries: [],
        manualEvidence: [
          {
            url: "https://example.com/evidence",
            sourceLabel: "Founder observation",
            title: "A current public signal",
            reason: "This directly supports the proposed reply.",
            reviewedBy: "founder:test",
          },
        ],
      },
      maximumCostUsd: 0.25,
      deadline: new Date(now.getTime() + 1_000),
    });

    expect(result).toMatchObject({
      state: "VERIFIED",
      readbackVerified: true,
      canonicalUrls: ["https://example.com/evidence"],
      actualCostUsd: 0,
    });
  });

  it("keeps a successful canonical read-back degraded when provider health is degraded", async () => {
    const baseAdapter = createManualEvidenceAdapter();
    const adapter: ProviderAdapter = {
      ...baseAdapter,
      healthCheck: async () => ({
        status: "DEGRADED",
        checkedAt: now.toISOString(),
        message: "Provider latency exceeded the healthy threshold.",
      }),
    };
    const result = await verifyProviderReadback({
      adapter,
      context: createProviderContext({
        credentialMode: "managed",
        now: () => now,
        resolveDns: async () => [{ address: "93.184.216.34", family: 4 }],
      }),
      request: {
        scanId: "verify_degraded",
        queries: [],
        manualEvidence: [
          {
            url: "https://example.com/evidence",
            sourceLabel: "Founder observation",
            title: "A current public signal",
            reason: "This directly supports the proposed reply.",
            reviewedBy: "founder:test",
          },
        ],
      },
      maximumCostUsd: 0.25,
      deadline: new Date(now.getTime() + 1_000),
    });

    expect(result).toMatchObject({
      state: "DEGRADED",
      healthStatus: "DEGRADED",
      readbackVerified: false,
      canonicalUrls: ["https://example.com/evidence"],
    });
    expect(result.limitations).toContain(
      "The source read-back returned canonical URLs, but provider health was degraded.",
    );
  });

  it("can verify a bounded website read-back after the safety preflight is healthy", async () => {
    const adapter = createWebsiteAdapter();
    const result = await verifyProviderReadback({
      adapter,
      context: createProviderContext({
        credentialMode: "managed",
        now: () => now,
        resolveDns: async () => [{ address: "93.184.216.34", family: 4 }],
        websiteTransport: async () =>
          new Response(
            "<title>TrendsFast</title><main>Evidence-backed distribution for founders.</main>",
            { headers: { "content-type": "text/html" } },
          ),
      }),
      request: {
        scanId: "verify_website",
        productUrl: "https://trendsfast.com",
        queries: [],
      },
      maximumCostUsd: 0.25,
      deadline: new Date(now.getTime() + 1_000),
    });

    expect(result).toMatchObject({
      state: "VERIFIED",
      healthStatus: "HEALTHY",
      readbackVerified: true,
      canonicalUrls: ["https://trendsfast.com/"],
    });
  });

  it("strips secret query values and fragments from manual and durable read-back URLs", async () => {
    const adapter = createManualEvidenceAdapter();
    const context = createProviderContext({
      credentialMode: "managed",
      now: () => now,
      resolveDns: async () => [{ address: "93.184.216.34", family: 4 }],
    });
    const request = {
      scanId: "verify_secret_url",
      queries: [],
      manualEvidence: [
        {
          url: "https://example.com/evidence?utm_source=founder&access_token=tf_live_prefix.raw-secret#private",
          sourceLabel: "Founder observation",
          title: "A current public signal",
          reason: "This directly supports the proposed reply.",
          reviewedBy: "founder:test",
        },
      ],
    };
    const collected = await adapter.collect(request, context);
    expect(collected.signals[0]?.url).toBe("https://example.com/evidence?utm_source=founder");

    const result = await verifyProviderReadback({
      adapter,
      context,
      request,
      maximumCostUsd: 0.25,
      deadline: new Date(now.getTime() + 1_000),
    });

    expect(result.canonicalUrls).toEqual(["https://example.com/evidence?utm_source=founder"]);
    expect(JSON.stringify(result)).not.toContain("raw-secret");
    expect(JSON.stringify(result)).not.toContain("private");
  });
});
