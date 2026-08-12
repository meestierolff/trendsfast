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
    expect(env.PAID_MONITORING_ENABLED).toBe(false);
    expect(env.FOUNDING_100_ENABLED).toBe(false);
    expect(env.CLOUD_TRIAL_ENABLED).toBe(false);
    expect(env.CRON_SECRET).toBeUndefined();
    expect(env.MONITORING_CRON_BATCH_SIZE).toBe(1);
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

  it("requires executable X Search or Tavily coverage in every live mode", () => {
    const xaiSynthesisOnly = {
      PROVIDER_CREDENTIAL_MODE: "byok",
      DATAFORSEO_LOGIN: "founder@example.com",
      DATAFORSEO_PASSWORD: "provider-password",
      XAI_API_KEY: "xai-key",
      LLM_PROVIDER: "xai",
      LLM_MODEL: "synthesis-model",
      LLM_INPUT_PRICE_USD_PER_MILLION_TOKENS: "0.25",
      LLM_OUTPUT_PRICE_USD_PER_MILLION_TOKENS: "2",
    };

    expect(tryParseEnv(xaiSynthesisOnly).success).toBe(false);
    expect(
      tryParseEnv({
        ...xaiSynthesisOnly,
        XAI_MODEL: "x-search-model",
      }).success,
    ).toBe(true);
    expect(
      tryParseEnv({
        ...xaiSynthesisOnly,
        XAI_MODEL: "x-search-model",
        XAI_MAX_TOOL_CALLS_PER_SCAN: "0",
        TAVILY_API_KEY: "tvly-key",
        TAVILY_MAX_CREDITS_PER_SCAN: "0",
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

  it("requires a strong cron secret before paid monitoring can run", () => {
    expect(tryParseEnv({ PAID_MONITORING_ENABLED: "true" }).success).toBe(false);
    expect(
      tryParseEnv({
        BILLING_ENABLED: "true",
        PAID_MONITORING_ENABLED: "true",
        STRIPE_SECRET_KEY: "sk_test_configured",
        STRIPE_WEBHOOK_SECRET: "whsec_configured",
        STRIPE_FOUNDER_CLOUD_PRICE_ID: "price_founder",
        CRON_SECRET: "c".repeat(32),
      }).success,
    ).toBe(true);
  });

  it("rejects paid monitoring without the billing gate", () => {
    expect(
      tryParseEnv({
        PAID_MONITORING_ENABLED: "true",
        CRON_SECRET: "c".repeat(32),
      }).success,
    ).toBe(false);
  });

  it("fails closed when an unimplemented commercial offer is toggled on", () => {
    expect(tryParseEnv({ FOUNDING_100_ENABLED: "true" }).success).toBe(false);
    expect(tryParseEnv({ CLOUD_TRIAL_ENABLED: "true" }).success).toBe(false);
  });

  it("rejects Stripe keys whose mode prefix does not match STRIPE_MODE", () => {
    expect(tryParseEnv({ STRIPE_MODE: "test", STRIPE_SECRET_KEY: "sk_live_wrong" }).success).toBe(
      false,
    );
    expect(tryParseEnv({ STRIPE_MODE: "live", STRIPE_SECRET_KEY: "rk_test_wrong" }).success).toBe(
      false,
    );
    expect(tryParseEnv({ STRIPE_MODE: "test", STRIPE_SECRET_KEY: "rk_test_valid" }).success).toBe(
      true,
    );
  });

  it("rejects malformed Stripe webhook secrets and enabled billing price IDs", () => {
    expect(tryParseEnv({ STRIPE_WEBHOOK_SECRET: "not-a-webhook-secret" }).success).toBe(false);
    expect(
      tryParseEnv({
        BILLING_ENABLED: "true",
        STRIPE_SECRET_KEY: "sk_test_configured",
        STRIPE_WEBHOOK_SECRET: "whsec_configured",
        STRIPE_FOUNDER_CLOUD_PRICE_ID: "prod_not_a_price",
      }).success,
    ).toBe(false);
    expect(
      tryParseEnv({
        BILLING_ENABLED: "true",
        STRIPE_SECRET_KEY: "sk_test_configured",
        STRIPE_WEBHOOK_SECRET: "whsec_configured",
        STRIPE_FOUNDER_CLOUD_PRICE_ID: "price_founder",
      }).success,
    ).toBe(true);
  });

  it("keeps the monitoring cron batch bounded", () => {
    expect(parseEnv({ MONITORING_CRON_BATCH_SIZE: "5" }).MONITORING_CRON_BATCH_SIZE).toBe(5);
    expect(tryParseEnv({ MONITORING_CRON_BATCH_SIZE: "11" }).success).toBe(false);
  });

  it("requires a monitoring lease longer than the configured scan deadline", () => {
    expect(
      tryParseEnv({
        BILLING_ENABLED: "true",
        PAID_MONITORING_ENABLED: "true",
        STRIPE_SECRET_KEY: "sk_test_configured",
        STRIPE_WEBHOOK_SECRET: "whsec_configured",
        STRIPE_FOUNDER_CLOUD_PRICE_ID: "price_founder",
        CRON_SECRET: "c".repeat(32),
        MAX_SCAN_DURATION_SECONDS: "300",
        MONITORING_LEASE_SECONDS: "300",
      }).success,
    ).toBe(false);
    expect(
      tryParseEnv({
        BILLING_ENABLED: "true",
        PAID_MONITORING_ENABLED: "true",
        STRIPE_SECRET_KEY: "sk_test_configured",
        STRIPE_WEBHOOK_SECRET: "whsec_configured",
        STRIPE_FOUNDER_CLOUD_PRICE_ID: "price_founder",
        CRON_SECRET: "c".repeat(32),
        MAX_SCAN_DURATION_SECONDS: "300",
        MONITORING_LEASE_SECONDS: "330",
      }).success,
    ).toBe(false);
  });

  it("keeps the worst-case sequential monitoring batch inside the cron route", () => {
    const billing = {
      BILLING_ENABLED: "true",
      PAID_MONITORING_ENABLED: "true",
      STRIPE_SECRET_KEY: "sk_test_configured",
      STRIPE_WEBHOOK_SECRET: "whsec_configured",
      STRIPE_FOUNDER_CLOUD_PRICE_ID: "price_founder",
      CRON_SECRET: "c".repeat(32),
    };
    expect(
      tryParseEnv({
        ...billing,
        MONITORING_CRON_BATCH_SIZE: "2",
      }).success,
    ).toBe(false);
    expect(
      tryParseEnv({
        ...billing,
        MAX_SCAN_DURATION_SECONDS: "120",
        MONITORING_CRON_BATCH_SIZE: "2",
        MONITORING_LEASE_SECONDS: "150",
      }).success,
    ).toBe(true);
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
