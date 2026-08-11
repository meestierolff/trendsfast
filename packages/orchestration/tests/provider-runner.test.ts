import { describe, expect, it } from "vitest";
import { createFixtureProviderRegistry, createProviderContext } from "@trendsfast/providers";
import { createProviderRunner } from "../src/provider-runner";

describe("provider runner bridge", () => {
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
    expect(runner.estimate("hacker_news", queries)).toBe(0);
    const result = await runner.execute(
      "hacker_news",
      { scanId: "scan_1", productUrl: "https://example.com", queries },
      { remainingUsd: 0.25, deadline: new Date("2026-08-11T12:01:00.000Z") },
    );
    expect(result.status).toBe("SUCCESS");
    expect(result.signals.length).toBeGreaterThan(0);
    expect(result.cost.actualUsd).toBe(0);
  });
});
