import { describe, expect, it, vi } from "vitest";
import {
  createFixtureProviderRegistry,
  createLiveProviderRegistry,
  createProviderContext,
} from "@trendsfast/providers";
import { createProviderRunner } from "../src/provider-runner";

describe("provider runner bridge", () => {
  it("requires an explicit complete eligibility gate for live providers", () => {
    const registry = createLiveProviderRegistry();
    const context = createProviderContext({ credentialMode: "managed" });
    expect(() => createProviderRunner({ registry, context })).toThrow(
      "LIVE_PROVIDER_ELIGIBILITY_REQUIRED",
    );
    expect(() => createProviderRunner({ registry, context, eligibility: new Map() })).toThrow(
      "LIVE_PROVIDER_ELIGIBILITY_MISSING:website",
    );
  });

  it("refuses estimate and execution for a denied live provider", async () => {
    const website = createLiveProviderRegistry().get("website")!;
    const collect = vi.spyOn(website, "collect");
    const runner = createProviderRunner({
      registry: new Map([["website", website]]),
      context: createProviderContext({ credentialMode: "managed" }),
      eligibility: new Map([
        [
          "website",
          {
            eligible: false as const,
            code: "PROVIDER_NOT_PRODUCTION_VERIFIED" as const,
            message: "Website is not verified for this exact deployment.",
          },
        ],
      ]),
    });

    expect(runner.requiresFreshRunEvidence).toBe(true);
    expect(runner.estimate("website", [])).toBe(0);
    await expect(
      runner.execute(
        "website",
        { scanId: "scan_denied", productUrl: "https://example.com", queries: [] },
        {
          remainingUsd: 0.317,
          deadline: new Date("2026-08-11T12:01:00.000Z"),
          reserveAttempt: vi.fn(),
          settleAttempt: vi.fn(),
        },
      ),
    ).rejects.toThrow("PROVIDER_NOT_PRODUCTION_VERIFIED");
    expect(collect).not.toHaveBeenCalled();
  });

  it("executes deterministic fixture providers inside the remaining budget", async () => {
    const runner = createProviderRunner({
      registry: createFixtureProviderRegistry(),
      context: createProviderContext({
        credentialMode: "fixture",
        now: () => new Date("2026-08-11T12:00:00.000Z"),
      }),
    });
    const queries = [
      {
        id: "query_hn",
        provider: "hacker_news" as const,
        role: "developer_pain" as const,
        query: "founder distribution",
        limit: 3,
        lookbackHours: 168,
      },
    ];
    expect(runner.requiresFreshRunEvidence).toBe(false);
    expect(runner.estimate("hacker_news", queries)).toBe(0);
    const reserveAttempt = vi.fn(async () => undefined);
    const settleAttempt = vi.fn(async () => undefined);
    const result = await runner.execute(
      "hacker_news",
      { scanId: "scan_1", productUrl: "https://example.com", queries },
      {
        remainingUsd: 0.317,
        deadline: new Date("2026-08-11T12:01:00.000Z"),
        reserveAttempt,
        settleAttempt,
      },
    );
    expect(result.status).toBe("SUCCESS");
    expect(result.signals.length).toBeGreaterThan(0);
    expect(result.cost.actualUsd).toBe(0);
    expect(reserveAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "hacker_news", attempt: 1 }),
    );
    expect(settleAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "hacker_news", attempt: 1, actualCostUsd: 0 }),
    );
  });
});
