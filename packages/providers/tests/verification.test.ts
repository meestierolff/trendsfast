import { describe, expect, it, vi } from "vitest";

import {
  createManualEvidenceAdapter,
  createProviderContext,
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
