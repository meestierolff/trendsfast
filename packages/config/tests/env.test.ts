import { describe, expect, it } from "vitest";

import { parseEnv, tryParseEnv } from "../src/index";

describe("environment validation", () => {
  it("uses safe, credential-free fixture defaults", () => {
    const env = parseEnv({});

    expect(env.PROVIDER_CREDENTIAL_MODE).toBe("fixture");
    expect(env.DATABASE_URL).toBe(
      "postgresql://trendsfast:trendsfast_local@localhost:54329/trendsfast",
    );
    expect(env.APP_URL).toBe("http://localhost:3000");
    expect(env.PUBLIC_SCAN_PROCESSING).toBe("inline");
    expect(env.PUBLIC_SCAN_DAILY_LIMIT).toBe(20);
    expect(env.BILLING_ENABLED).toBe(false);
    expect(env.STRIPE_MODE).toBe("test");
    expect(env.XAI_MAX_TOOL_CALLS_PER_SCAN).toBe(2);
    expect(env.TAVILY_MAX_CREDITS_PER_SCAN).toBe(2);
    expect(env.YOUTUBE_MAX_SEARCHES_PER_SCAN).toBe(2);
    expect(env.MAX_PROVIDER_COST_USD_PER_SCAN).toBe(0.25);
    expect(env.LLM_INPUT_PRICE_USD_PER_MILLION_TOKENS).toBeUndefined();
    expect(env.LLM_OUTPUT_PRICE_USD_PER_MILLION_TOKENS).toBeUndefined();
  });

  it("rejects incomplete credential pairs in every mode", () => {
    const result = tryParseEnv({ DATAFORSEO_LOGIN: "founder@example.com" });
    expect(result.success).toBe(false);
  });

  it("requires a viable provider and synthesis setup outside fixture mode", () => {
    expect(
      tryParseEnv({
        PROVIDER_CREDENTIAL_MODE: "managed",
        OPS_TOKEN: "o".repeat(32),
        SESSION_SECRET: "s".repeat(32),
      }).success,
    ).toBe(false);

    expect(
      tryParseEnv({
        PROVIDER_CREDENTIAL_MODE: "byok",
        DATAFORSEO_LOGIN: "founder@example.com",
        DATAFORSEO_PASSWORD: "provider-password",
        TAVILY_API_KEY: "tvly-key",
        LLM_PROVIDER: "openai",
        LLM_MODEL: "configured-model",
        OPENAI_API_KEY: "openai-key",
        LLM_INPUT_PRICE_USD_PER_MILLION_TOKENS: "0.25",
        LLM_OUTPUT_PRICE_USD_PER_MILLION_TOKENS: "2",
      }).success,
    ).toBe(true);
  });

  it("requires explicit input and output model prices in every live mode", () => {
    const base = {
      PROVIDER_CREDENTIAL_MODE: "byok",
      DATAFORSEO_LOGIN: "founder@example.com",
      DATAFORSEO_PASSWORD: "provider-password",
      TAVILY_API_KEY: "tvly-key",
      LLM_PROVIDER: "openai",
      LLM_MODEL: "configured-model",
      OPENAI_API_KEY: "openai-key",
    };
    expect(tryParseEnv(base).success).toBe(false);
    expect(
      tryParseEnv({
        ...base,
        LLM_INPUT_PRICE_USD_PER_MILLION_TOKENS: "0.25",
        LLM_OUTPUT_PRICE_USD_PER_MILLION_TOKENS: "2",
      }).success,
    ).toBe(true);
    expect(
      tryParseEnv({
        ...base,
        LLM_INPUT_PRICE_USD_PER_MILLION_TOKENS: "not-a-price",
        LLM_OUTPUT_PRICE_USD_PER_MILLION_TOKENS: "2",
      }).success,
    ).toBe(false);
    expect(
      tryParseEnv({
        ...base,
        LLM_INPUT_PRICE_USD_PER_MILLION_TOKENS: " ",
        LLM_OUTPUT_PRICE_USD_PER_MILLION_TOKENS: "2",
      }).success,
    ).toBe(false);
  });

  it("accepts a fully configured managed cloud environment", () => {
    expect(
      tryParseEnv({
        NODE_ENV: "production",
        APP_URL: "https://trendsfast.com",
        DATABASE_URL: "postgresql://service:password@db.example.com:5432/trendsfast",
        PROVIDER_CREDENTIAL_MODE: "managed",
        OPS_TOKEN: "o".repeat(32),
        SESSION_SECRET: "s".repeat(32),
        API_KEY_PEPPER: "p".repeat(32),
        DATAFORSEO_LOGIN: "founder@example.com",
        DATAFORSEO_PASSWORD: "provider-password",
        TAVILY_API_KEY: "tvly-key",
        LLM_PROVIDER: "openai",
        LLM_MODEL: "configured-model",
        OPENAI_API_KEY: "openai-key",
        LLM_INPUT_PRICE_USD_PER_MILLION_TOKENS: "0.25",
        LLM_OUTPUT_PRICE_USD_PER_MILLION_TOKENS: "2",
      }).success,
    ).toBe(true);
  });

  it("requires both Stripe secrets before billing can be enabled", () => {
    expect(tryParseEnv({ BILLING_ENABLED: "true", STRIPE_SECRET_KEY: "sk_test_one" }).success).toBe(
      false,
    );
  });

  it("requires both Turnstile credentials when abuse protection is enabled", () => {
    expect(tryParseEnv({ TURNSTILE_ENABLED: "true" }).success).toBe(false);
    expect(
      tryParseEnv({
        TURNSTILE_ENABLED: "true",
        TURNSTILE_SECRET_KEY: "turnstile-secret",
        NEXT_PUBLIC_TURNSTILE_SITE_KEY: "turnstile-site",
      }).success,
    ).toBe(true);
  });

  it("does not include raw secret values in validation errors", () => {
    const secret = "this-must-never-appear";
    const result = tryParseEnv({
      PROVIDER_CREDENTIAL_MODE: "managed",
      XAI_API_KEY: secret,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).not.toContain(secret);
    }
  });
});
