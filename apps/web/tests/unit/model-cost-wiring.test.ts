import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { parseEnv } from "@trendsfast/config";

import { createConfiguredModelClient } from "../../lib/scan-processing";

describe("live model cost wiring", () => {
  it("reserves operator-priced worst-case spend before the model network call", async () => {
    const events: string[] = [];
    const fetcher = vi.fn<typeof fetch>(async () => {
      events.push("network");
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"name":"Example"}' } }],
          usage: { prompt_tokens: 40, completion_tokens: 10 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    const client = createConfiguredModelClient(
      parseEnv({
        PROVIDER_CREDENTIAL_MODE: "byok",
        DATAFORSEO_LOGIN: "founder@example.com",
        DATAFORSEO_PASSWORD: "provider-password",
        TAVILY_API_KEY: "tvly-key",
        LLM_PROVIDER: "openai",
        LLM_MODEL: "priced-model",
        OPENAI_API_KEY: "openai-key",
        LLM_INPUT_PRICE_USD_PER_MILLION_TOKENS: "0.25",
        LLM_OUTPUT_PRICE_USD_PER_MILLION_TOKENS: "2",
        DATAFORSEO_ESTIMATED_COST_USD_PER_TASK: "0.05",
        TAVILY_ESTIMATED_COST_USD_PER_CREDIT: "0.05",
        MAX_PROVIDER_COST_USD_PER_SCAN: "1",
        API_PROVIDER_COST_LIMIT_USD_PER_HOUR: "5",
      }),
      { fetch: fetcher },
    );
    const reserve = vi.fn(async () => {
      events.push("reserve");
      return { created: true, projectedCostUsd: 0.01 };
    });
    const settle = vi.fn(async () => {
      events.push("settle");
      return { committedCostUsd: 0.01 };
    });

    await expect(
      client.generate({
        system: "bounded system",
        user: "bounded user",
        temperature: 0,
        responseFormat: "json",
        schemaName: "context",
        cost: {
          ledgerKey: "model:context:attempt:1",
          operation: "context",
          attempt: 1,
          reserve,
          settle,
        },
      }),
    ).resolves.toBe('{"name":"Example"}');

    expect(events).toEqual(["reserve", "network", "settle"]);
    expect(reserve).toHaveBeenCalledWith(
      expect.objectContaining({
        ledgerKey: "model:context:attempt:1",
        provider: "openai",
        model: "priced-model",
        operation: "context",
        attempt: 1,
        inputUsdPerMillionTokens: 0.25,
        outputUsdPerMillionTokens: 2,
        outputTokenUpperBound: 2_048,
      }),
    );
    expect(settle).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "openai",
        inputTokens: 40,
        outputTokens: 10,
        actualCostUsd: 0.00003,
      }),
    );
  });
});
