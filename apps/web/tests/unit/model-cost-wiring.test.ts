import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { parseEnv, type Environment } from "@trendsfast/config";

import {
  createConfiguredModelClient,
  synthesisModelIsProductionVerified,
} from "../../lib/scan-processing";

describe("live model cost wiring", () => {
  it("permits synthesis only through the exact verified xAI source model", () => {
    const env = {
      PROVIDER_CREDENTIAL_MODE: "managed",
      PROVIDER_CALLS_ENABLED: true,
      LLM_PROVIDER: "xai",
      LLM_MODEL: "grok-exact",
      XAI_MODEL: "grok-exact",
      XAI_API_KEY: "xai-key",
    } as unknown as Environment;
    const verified = new Map([["x", { eligible: true }]] as const);
    const unverified = new Map([["x", { eligible: false }]] as const);

    expect(synthesisModelIsProductionVerified(env, verified)).toBe(true);
    expect(synthesisModelIsProductionVerified(env, unverified)).toBe(false);
    expect(
      synthesisModelIsProductionVerified(
        { ...env, LLM_MODEL: "different-unverified-model" },
        verified,
      ),
    ).toBe(false);
    expect(
      synthesisModelIsProductionVerified(
        { ...env, LLM_PROVIDER: "openai", OPENAI_API_KEY: "openai-key" },
        verified,
      ),
    ).toBe(false);
  });

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
        PROVIDER_CALLS_ENABLED: "true",
        PUBLIC_SCAN_DAILY_LIMIT: "17",
        PUBLIC_SCAN_GLOBAL_DAILY_LIMIT: "29",
        PUBLIC_SCAN_GLOBAL_DAILY_BUDGET_USD: "113.777",
        API_CREATE_RATE_LIMIT_PER_HOUR: "31",
        API_STATUS_RATE_LIMIT_PER_HOUR: "317",
        API_AUTH_FAILURE_LIMIT_PER_HOUR: "37",
        DATAFORSEO_LOGIN: "founder@example.com",
        DATAFORSEO_PASSWORD: "provider-password",
        TAVILY_API_KEY: "tvly-key",
        LLM_PROVIDER: "openai",
        LLM_MODEL: "priced-model",
        OPENAI_API_KEY: "openai-key",
        LLM_INPUT_PRICE_USD_PER_MILLION_TOKENS: "3.17",
        LLM_OUTPUT_PRICE_USD_PER_MILLION_TOKENS: "7.31",
        DATAFORSEO_ESTIMATED_COST_USD_PER_TASK: "0.113",
        TAVILY_ESTIMATED_COST_USD_PER_CREDIT: "0.271",
        MAX_PROVIDER_COST_USD_PER_SCAN: "91.333",
        API_PROVIDER_COST_LIMIT_USD_PER_HOUR: "407.444",
      }),
      { fetch: fetcher },
    );
    const reserve = vi.fn(async () => {
      events.push("reserve");
      return { created: true, projectedCostUsd: 17.111 };
    });
    const settle = vi.fn(async () => {
      events.push("settle");
      return { committedCostUsd: 17.111 };
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
        inputUsdPerMillionTokens: 3.17,
        outputUsdPerMillionTokens: 7.31,
        outputTokenUpperBound: 2_048,
      }),
    );
    expect(settle).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "openai",
        inputTokens: 40,
        outputTokens: 10,
        actualCostUsd: expect.closeTo(0.0001999, 10),
      }),
    );
  });
});
