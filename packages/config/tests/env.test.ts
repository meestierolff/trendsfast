import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  paidMonitoringRuntimeEnabled,
  parseEnv,
  resolveProviderCosts,
  tryParseEnv,
} from "../src/index";

const explicitTavilyCosts = {
  PROVIDER_CALLS_ENABLED: "true",
  PUBLIC_SCAN_DAILY_LIMIT: "17",
  PUBLIC_SCAN_GLOBAL_DAILY_LIMIT: "29",
  PUBLIC_SCAN_GLOBAL_DAILY_BUDGET_USD: "113.777",
  API_CREATE_RATE_LIMIT_PER_HOUR: "31",
  API_STATUS_RATE_LIMIT_PER_HOUR: "317",
  API_AUTH_FAILURE_LIMIT_PER_HOUR: "37",
  DATAFORSEO_ESTIMATED_COST_USD_PER_TASK: "7.111",
  TAVILY_ESTIMATED_COST_USD_PER_CREDIT: "8.222",
  MAX_PROVIDER_COST_USD_PER_SCAN: "91.333",
  API_PROVIDER_COST_LIMIT_USD_PER_HOUR: "407.444",
} as const;

describe("environment validation", () => {
  it("keeps the tracked environment example parseable with launch approvals blank", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../../../.env.example", import.meta.url)),
      "utf8",
    );
    const example = Object.fromEntries(
      source
        .split(/\r?\n/u)
        .filter((line) => line && !line.startsWith("#") && line.includes("="))
        .map((line) => {
          const separator = line.indexOf("=");
          return [line.slice(0, separator), line.slice(separator + 1)];
        }),
    );

    expect(tryParseEnv(example).success).toBe(true);
  });

  it("uses safe, credential-free fixture defaults", () => {
    const env = parseEnv({});

    expect(env.PROVIDER_CREDENTIAL_MODE).toBe("fixture");
    expect(env.DATABASE_URL).toBe(
      "postgresql://trendsfast:trendsfast_local@localhost:54329/trendsfast",
    );
    expect(env.APP_URL).toBe("http://localhost:3000");
    expect(env.PUBLIC_APP_URL).toBeUndefined();
    expect(env.TRENDSFAST_SURFACE).toBe("public");
    expect(env.PROVIDER_CALLS_ENABLED).toBe(false);
    expect(env.PUBLIC_SCANS_ENABLED).toBe(false);
    expect(env.LIVE_API_CREATION_ENABLED).toBe(false);
    expect(env.PUBLIC_SCAN_PROCESSING).toBe("inline");
    expect(env.PUBLIC_SCAN_DAILY_LIMIT).toBeUndefined();
    expect(env.BILLING_ENABLED).toBe(false);
    expect(env.BILLING_CHECKOUT_ENABLED).toBe(false);
    expect(env.PAID_MONITORING_ENABLED).toBe(false);
    expect(env.MONITORING_ENABLED).toBe(false);
    expect(env.FOUNDING_100_ENABLED).toBe(false);
    expect(env.CLOUD_TRIAL_ENABLED).toBe(false);
    expect(env.CRON_SECRET).toBeUndefined();
    expect(env.MONITORING_CRON_BATCH_SIZE).toBe(1);
    expect(env.MONITORING_MAX_ATTEMPTS).toBe(3);
    expect(env.MONITORING_RETRY_BASE_SECONDS).toBe(300);
    expect(env.OPS_ALERT_WEBHOOK_URL).toBeUndefined();
    expect(env.STRIPE_MODE).toBe("test");
    expect(env.I_UNDERSTAND_LIVE_STRIPE).toBeUndefined();
    expect(env.STRIPE_SANDBOX_KEY_ROTATED).toBeUndefined();
    expect(env.STRIPE_LIVE_CATALOG_APPROVED).toBeUndefined();
    expect(env.STRIPE_LIVE_ENABLEMENT_APPROVED).toBeUndefined();
    expect(env.STRIPE_PORTAL_LOGIN_URL).toBeUndefined();
    expect(env.XAI_MAX_TOOL_CALLS_PER_SCAN).toBe(2);
    expect(env.TAVILY_MAX_CREDITS_PER_SCAN).toBe(2);
    expect(env.YOUTUBE_MAX_SEARCHES_PER_SCAN).toBe(2);
    expect(env.MAX_PROVIDER_COST_USD_PER_SCAN).toBeUndefined();
    expect(env.LLM_INPUT_PRICE_USD_PER_MILLION_TOKENS).toBeUndefined();
    expect(env.LLM_OUTPUT_PRICE_USD_PER_MILLION_TOKENS).toBeUndefined();
  });

  it("boots a managed public preview with provider work disabled and no private economics", () => {
    const result = tryParseEnv({
      NODE_ENV: "production",
      VERCEL_ENV: "preview",
      APP_URL: "https://preview.trendsfast.example",
      DATABASE_URL: "postgresql://service:password@db.example.com:5432/trendsfast",
      DATABASE_SSL_CA: "preview-test-ca",
      AUTH_DATABASE_URL: "postgresql://auth:password@db.example.com:5432/trendsfast",
      TRENDSFAST_SURFACE: "public",
      PROVIDER_CREDENTIAL_MODE: "managed",
      PROVIDER_CALLS_ENABLED: "false",
      SESSION_SECRET: "s".repeat(32),
      API_KEY_PEPPER: "p".repeat(32),
    });

    expect(result.success).toBe(true);
  });

  it("requires paired Supabase Auth browser values and a hosted member-role URL", () => {
    expect(tryParseEnv({ NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co" }).success).toBe(
      false,
    );
    const hosted = {
      NODE_ENV: "production",
      APP_URL: "https://trendsfast.example",
      DATABASE_URL: "postgresql://public:password@db.example.com:5432/trendsfast",
      DATABASE_SSL_CA: "hosted-test-ca",
      TRENDSFAST_SURFACE: "public",
      PROVIDER_CREDENTIAL_MODE: "fixture",
      NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-test-key",
    };
    const { NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, ...withoutAuth } =
      hosted;
    expect(NEXT_PUBLIC_SUPABASE_URL).toBeTruthy();
    expect(NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY).toBeTruthy();
    const missingAuth = tryParseEnv(withoutAuth);
    expect(missingAuth.success).toBe(false);
    if (!missingAuth.success) {
      expect(missingAuth.error.issues.map((issue) => issue.path)).toContain(
        "NEXT_PUBLIC_SUPABASE_URL",
      );
    }
    const missingMember = tryParseEnv(hosted);
    expect(missingMember.success).toBe(false);
    if (!missingMember.success) {
      expect(missingMember.error.issues.map((issue) => issue.path)).toContain(
        "MEMBER_DATABASE_URL",
      );
    }
    expect(
      tryParseEnv({
        ...hosted,
        MEMBER_DATABASE_URL: "postgresql://member:password@db.example.com:5432/trendsfast",
      }).success,
    ).toBe(true);
  });

  it("fails closed when managed provider work lacks the private policy and prices", () => {
    const result = tryParseEnv({
      NODE_ENV: "production",
      APP_URL: "https://trendsfast.example",
      DATABASE_URL: "postgresql://service:password@db.example.com:5432/trendsfast",
      PROVIDER_CREDENTIAL_MODE: "managed",
      PROVIDER_CALLS_ENABLED: "true",
      SESSION_SECRET: "s".repeat(32),
      API_KEY_PEPPER: "p".repeat(32),
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((issue) => issue.path === "MAX_PROVIDER_COST_USD_PER_SCAN"),
      ).toBe(true);
      expect(result.error.issues.some((issue) => issue.path === "PUBLIC_SCAN_DAILY_LIMIT")).toBe(
        true,
      );
    }
  });

  it("never accepts the founder operations bearer on the public surface", () => {
    const result = tryParseEnv({
      PROVIDER_CREDENTIAL_MODE: "managed",
      TRENDSFAST_SURFACE: "public",
      OPS_TOKEN: "o".repeat(32),
      SESSION_SECRET: "s".repeat(32),
      API_KEY_PEPPER: "p".repeat(32),
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path === "OPS_TOKEN")).toBe(true);
    }
  });

  it("rejects invalid surface values", () => {
    expect(tryParseEnv({ TRENDSFAST_SURFACE: "combined" }).success).toBe(false);
  });

  it("does not let the Checkout switch bypass the billing switch", () => {
    expect(tryParseEnv({ BILLING_CHECKOUT_ENABLED: "true" }).success).toBe(false);
  });

  it("rejects incomplete credential pairs in every mode", () => {
    const result = tryParseEnv({ DATAFORSEO_LOGIN: "founder@example.com" });
    expect(result.success).toBe(false);
  });

  it("requires a viable provider and synthesis setup outside fixture mode", () => {
    expect(
      tryParseEnv({
        PROVIDER_CREDENTIAL_MODE: "managed",
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
        LLM_INPUT_PRICE_USD_PER_MILLION_TOKENS: "11.111",
        LLM_OUTPUT_PRICE_USD_PER_MILLION_TOKENS: "22.222",
        ...explicitTavilyCosts,
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
      ...explicitTavilyCosts,
    };
    expect(tryParseEnv(base).success).toBe(false);
    expect(
      tryParseEnv({
        ...base,
        LLM_INPUT_PRICE_USD_PER_MILLION_TOKENS: "11.111",
        LLM_OUTPUT_PRICE_USD_PER_MILLION_TOKENS: "22.222",
      }).success,
    ).toBe(true);
    expect(
      tryParseEnv({
        ...base,
        LLM_INPUT_PRICE_USD_PER_MILLION_TOKENS: "not-a-price",
        LLM_OUTPUT_PRICE_USD_PER_MILLION_TOKENS: "22.222",
      }).success,
    ).toBe(false);
    expect(
      tryParseEnv({
        ...base,
        LLM_INPUT_PRICE_USD_PER_MILLION_TOKENS: " ",
        LLM_OUTPUT_PRICE_USD_PER_MILLION_TOKENS: "22.222",
      }).success,
    ).toBe(false);
  });

  it("requires executable X Search or Tavily coverage in every live mode", () => {
    const xaiSynthesisOnly = {
      PROVIDER_CALLS_ENABLED: "true",
      PUBLIC_SCAN_DAILY_LIMIT: "17",
      PUBLIC_SCAN_GLOBAL_DAILY_LIMIT: "29",
      PUBLIC_SCAN_GLOBAL_DAILY_BUDGET_USD: "113.777",
      API_CREATE_RATE_LIMIT_PER_HOUR: "31",
      API_STATUS_RATE_LIMIT_PER_HOUR: "317",
      API_AUTH_FAILURE_LIMIT_PER_HOUR: "37",
      PROVIDER_CREDENTIAL_MODE: "byok",
      DATAFORSEO_LOGIN: "founder@example.com",
      DATAFORSEO_PASSWORD: "provider-password",
      XAI_API_KEY: "xai-key",
      LLM_PROVIDER: "xai",
      LLM_MODEL: "synthesis-model",
      LLM_INPUT_PRICE_USD_PER_MILLION_TOKENS: "11.111",
      LLM_OUTPUT_PRICE_USD_PER_MILLION_TOKENS: "22.222",
      DATAFORSEO_ESTIMATED_COST_USD_PER_TASK: "7.111",
      MAX_PROVIDER_COST_USD_PER_SCAN: "91.333",
      API_PROVIDER_COST_LIMIT_USD_PER_HOUR: "407.444",
    };

    expect(tryParseEnv(xaiSynthesisOnly).success).toBe(false);
    expect(
      tryParseEnv({
        ...xaiSynthesisOnly,
        XAI_MODEL: "x-search-model",
        XAI_ESTIMATED_COST_USD_PER_SEARCH: "9.333",
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
        WORKER_DATABASE_URL: "postgresql://worker:password@db.example.com:5432/trendsfast",
        AUTH_DATABASE_URL: "postgresql://auth:password@db.example.com:5432/trendsfast",
        DATABASE_SSL_CA: "production-test-ca",
        NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-test-key",
        MEMBER_DATABASE_URL: "postgresql://member:password@db.example.com:5432/trendsfast",
        PROVIDER_CREDENTIAL_MODE: "managed",
        SESSION_SECRET: "s".repeat(32),
        API_KEY_PEPPER: "p".repeat(32),
        DATAFORSEO_LOGIN: "founder@example.com",
        DATAFORSEO_PASSWORD: "provider-password",
        TAVILY_API_KEY: "tvly-key",
        LLM_PROVIDER: "openai",
        LLM_MODEL: "configured-model",
        OPENAI_API_KEY: "openai-key",
        LLM_INPUT_PRICE_USD_PER_MILLION_TOKENS: "11.111",
        LLM_OUTPUT_PRICE_USD_PER_MILLION_TOKENS: "22.222",
        ...explicitTavilyCosts,
      }).success,
    ).toBe(true);
  });

  it("requires the worker database role when hosted operations alerts are configured", () => {
    const hosted = {
      NODE_ENV: "production",
      APP_URL: "https://trendsfast.example",
      DATABASE_URL: "postgresql://public:password@db.example.com:5432/trendsfast",
      DATABASE_SSL_CA: "production-test-ca",
      NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-test-key",
      MEMBER_DATABASE_URL: "postgresql://member:password@db.example.com:5432/trendsfast",
      PROVIDER_CREDENTIAL_MODE: "managed",
      PROVIDER_CALLS_ENABLED: "false",
      SESSION_SECRET: "s".repeat(32),
      API_KEY_PEPPER: "p".repeat(32),
      OPS_ALERT_WEBHOOK_URL: "https://alerts.example.test/trendsfast",
      OPS_ALERT_WEBHOOK_SECRET: "a".repeat(32),
    };

    expect(tryParseEnv(hosted).success).toBe(false);
    const { OPS_ALERT_WEBHOOK_URL, OPS_ALERT_WEBHOOK_SECRET, ...hostedWithoutAlerts } = hosted;
    expect(OPS_ALERT_WEBHOOK_URL).toBeTruthy();
    expect(OPS_ALERT_WEBHOOK_SECRET).toBeTruthy();
    expect(tryParseEnv({ ...hostedWithoutAlerts, CRON_SECRET: "c".repeat(32) }).success).toBe(
      false,
    );
    expect(
      tryParseEnv({
        ...hosted,
        WORKER_DATABASE_URL: "postgresql://worker:password@db.example.com:5432/trendsfast",
        AUTH_DATABASE_URL: "postgresql://auth:password@db.example.com:5432/trendsfast",
      }).success,
    ).toBe(true);
  });

  it("requires an exact public deployment target for production ops verification", () => {
    const productionOps = {
      NODE_ENV: "production",
      VERCEL_ENV: "production",
      APP_URL: "https://ops.trendsfast.example",
      PUBLIC_APP_URL: "https://trendsfast.example",
      DATABASE_URL: "postgresql://public:password@db.example.com:5432/trendsfast",
      OPS_DATABASE_URL: "postgresql://ops:password@db.example.com:5432/trendsfast",
      WORKER_DATABASE_URL: "postgresql://worker:password@db.example.com:5432/trendsfast",
      DATABASE_SSL_CA: "production-test-ca",
      TRENDSFAST_SURFACE: "ops",
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
      LLM_INPUT_PRICE_USD_PER_MILLION_TOKENS: "11.111",
      LLM_OUTPUT_PRICE_USD_PER_MILLION_TOKENS: "22.222",
      ...explicitTavilyCosts,
    };

    expect(tryParseEnv(productionOps).success).toBe(false);
    expect(
      tryParseEnv({
        ...productionOps,
        PUBLIC_DEPLOYMENT_HOST: "trendsfast.example",
        PUBLIC_DEPLOYMENT_ID: "dpl_public_123",
      }).success,
    ).toBe(true);
    expect(
      tryParseEnv({
        ...productionOps,
        PUBLIC_APP_URL: "http://trendsfast.example",
        PUBLIC_DEPLOYMENT_HOST: "trendsfast.example",
        PUBLIC_DEPLOYMENT_ID: "dpl_public_123",
      }).success,
    ).toBe(false);
    expect(
      tryParseEnv({
        ...productionOps,
        PUBLIC_DEPLOYMENT_HOST: "https://trendsfast.example/path",
        PUBLIC_DEPLOYMENT_ID: "dpl public",
      }).success,
    ).toBe(false);
  });

  it("rejects zero prices for live paid providers and model tokens", () => {
    const configured = {
      PROVIDER_CREDENTIAL_MODE: "byok",
      DATAFORSEO_LOGIN: "founder@example.com",
      DATAFORSEO_PASSWORD: "provider-password",
      TAVILY_API_KEY: "tvly-key",
      LLM_PROVIDER: "openai",
      LLM_MODEL: "configured-model",
      OPENAI_API_KEY: "openai-key",
      LLM_INPUT_PRICE_USD_PER_MILLION_TOKENS: "11.111",
      LLM_OUTPUT_PRICE_USD_PER_MILLION_TOKENS: "22.222",
      ...explicitTavilyCosts,
    };
    for (const field of [
      "DATAFORSEO_ESTIMATED_COST_USD_PER_TASK",
      "TAVILY_ESTIMATED_COST_USD_PER_CREDIT",
      "LLM_INPUT_PRICE_USD_PER_MILLION_TOKENS",
      "LLM_OUTPUT_PRICE_USD_PER_MILLION_TOKENS",
    ] as const) {
      expect(tryParseEnv({ ...configured, [field]: "0" }).success).toBe(false);
    }
    expect(resolveProviderCosts(parseEnv({})).maximumProviderCostUsdPerScan).toBe(0);
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
        MONITORING_ENABLED: "true",
        STRIPE_SECRET_KEY: "sk_test_configured",
        STRIPE_WEBHOOK_SECRET: "whsec_configured",
        STRIPE_FOUNDER_CLOUD_PRICE_ID: "price_founder",
        STRIPE_PORTAL_LOGIN_URL: "https://billing.stripe.com/p/login/test_founder",
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

  it("requires a complete, signed HTTPS operations-alert destination", () => {
    expect(
      tryParseEnv({ OPS_ALERT_WEBHOOK_URL: "https://alerts.example.test/trendsfast" }).success,
    ).toBe(false);
    expect(
      tryParseEnv({
        OPS_ALERT_WEBHOOK_URL: "https://alerts.example.test/trendsfast?token=secret",
        OPS_ALERT_WEBHOOK_SECRET: "a".repeat(32),
      }).success,
    ).toBe(false);
    expect(
      tryParseEnv({
        OPS_ALERT_WEBHOOK_URL: "https://alerts.example.test/trendsfast",
        OPS_ALERT_WEBHOOK_SECRET: "a".repeat(32),
      }).success,
    ).toBe(true);
  });

  it("denies paid monitoring on Vercel previews even with copied production gates", () => {
    const env = parseEnv({
      NODE_ENV: "production",
      APP_URL: "https://trendsfast.example",
      BILLING_ENABLED: "true",
      PAID_MONITORING_ENABLED: "true",
      MONITORING_ENABLED: "true",
      PAID_HOSTING_APPROVED: "YES",
      STRIPE_SECRET_KEY: "sk_test_configured",
      STRIPE_WEBHOOK_SECRET: "whsec_configured",
      STRIPE_FOUNDER_CLOUD_PRICE_ID: "price_founder",
      STRIPE_PORTAL_LOGIN_URL: "https://billing.stripe.com/p/login/test_founder",
      CRON_SECRET: "c".repeat(32),
      OPS_ALERT_WEBHOOK_URL: "https://alerts.example.test/trendsfast",
      OPS_ALERT_WEBHOOK_SECRET: "a".repeat(32),
    });
    expect(paidMonitoringRuntimeEnabled(env, { VERCEL: "1", VERCEL_ENV: "preview" })).toBe(false);
    expect(paidMonitoringRuntimeEnabled(env, { VERCEL: "1", VERCEL_ENV: "production" })).toBe(true);
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
        STRIPE_PORTAL_LOGIN_URL: "https://billing.stripe.com/p/login/test_founder",
      }).success,
    ).toBe(false);
    expect(
      tryParseEnv({
        BILLING_ENABLED: "true",
        STRIPE_SECRET_KEY: "sk_test_configured",
        STRIPE_WEBHOOK_SECRET: "whsec_configured",
        STRIPE_FOUNDER_CLOUD_PRICE_ID: "price_founder",
        STRIPE_PORTAL_LOGIN_URL: "https://billing.stripe.com/p/login/test_founder",
      }).success,
    ).toBe(true);
  });

  it("requires an exact Stripe-hosted no-code Portal login when billing is enabled", () => {
    const billing = {
      BILLING_ENABLED: "true",
      STRIPE_SECRET_KEY: "sk_test_configured",
      STRIPE_WEBHOOK_SECRET: "whsec_configured",
      STRIPE_FOUNDER_CLOUD_PRICE_ID: "price_founder",
    };
    expect(tryParseEnv(billing).success).toBe(false);
    expect(
      tryParseEnv({
        ...billing,
        STRIPE_PORTAL_LOGIN_URL: "https://example.com/p/login/not-stripe",
      }).success,
    ).toBe(false);
    expect(
      tryParseEnv({
        ...billing,
        STRIPE_PORTAL_LOGIN_URL: "https://billing.stripe.com/p/login/test_founder",
      }).success,
    ).toBe(true);
  });

  it("requires both exact acknowledgements before live billing is valid", () => {
    const live = {
      NODE_ENV: "production",
      APP_URL: "https://trendsfast.com",
      BILLING_ENABLED: "true",
      STRIPE_MODE: "live",
      PROVIDER_CREDENTIAL_MODE: "byok",
      SESSION_SECRET: "s".repeat(32),
      DATAFORSEO_LOGIN: "founder@example.com",
      DATAFORSEO_PASSWORD: "provider-password",
      TAVILY_API_KEY: "tvly-key",
      LLM_PROVIDER: "openai",
      LLM_MODEL: "configured-model",
      OPENAI_API_KEY: "openai-key",
      LLM_INPUT_PRICE_USD_PER_MILLION_TOKENS: "11.111",
      LLM_OUTPUT_PRICE_USD_PER_MILLION_TOKENS: "22.222",
      ...explicitTavilyCosts,
      STRIPE_SECRET_KEY: "sk_live_configured",
      STRIPE_WEBHOOK_SECRET: "whsec_configured",
      STRIPE_FOUNDER_CLOUD_PRICE_ID: "price_founder",
      STRIPE_PORTAL_LOGIN_URL: "https://billing.stripe.com/p/login/live_founder",
      WORKER_DATABASE_URL: "postgresql://worker:password@localhost:54329/trendsfast",
      CRON_SECRET: "c".repeat(32),
      OPS_ALERT_WEBHOOK_URL: "https://alerts.example.test/trendsfast",
      OPS_ALERT_WEBHOOK_SECRET: "a".repeat(32),
    };
    expect(tryParseEnv(live).success).toBe(false);
    expect(tryParseEnv({ ...live, I_UNDERSTAND_LIVE_STRIPE: "YES" }).success).toBe(false);
    expect(
      tryParseEnv({
        ...live,
        I_UNDERSTAND_LIVE_STRIPE: "YES",
        STRIPE_LIVE_ENABLEMENT_APPROVED: "yes",
      }).success,
    ).toBe(false);
    expect(
      tryParseEnv({
        ...live,
        I_UNDERSTAND_LIVE_STRIPE: "YES",
        STRIPE_LIVE_ENABLEMENT_APPROVED: "YES",
      }).success,
    ).toBe(true);
  });

  it("requires alerting, cron authentication, and the worker role for production live billing", () => {
    const productionLive = {
      NODE_ENV: "production",
      BILLING_ENABLED: "true",
      STRIPE_MODE: "live",
      PROVIDER_CREDENTIAL_MODE: "byok",
      STRIPE_SECRET_KEY: "sk_live_configured",
      STRIPE_WEBHOOK_SECRET: "whsec_configured",
      STRIPE_FOUNDER_CLOUD_PRICE_ID: "price_founder",
      STRIPE_PORTAL_LOGIN_URL: "https://billing.stripe.com/p/login/live_founder",
      I_UNDERSTAND_LIVE_STRIPE: "YES",
      STRIPE_LIVE_ENABLEMENT_APPROVED: "YES",
    };
    const result = tryParseEnv(productionLive);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path)).toEqual(
        expect.arrayContaining(["OPS_ALERT_WEBHOOK_URL", "CRON_SECRET", "WORKER_DATABASE_URL"]),
      );
    }
  });

  it("requires the dedicated retention role and policy revision for a hosted ops cron", () => {
    const hostedOps = {
      NODE_ENV: "production",
      APP_URL: "https://ops.trendsfast.example",
      PUBLIC_APP_URL: "https://trendsfast.example",
      DATABASE_URL: "postgresql://public:password@db.example.com:5432/trendsfast",
      OPS_DATABASE_URL: "postgresql://ops:password@db.example.com:5432/trendsfast",
      WORKER_DATABASE_URL: "postgresql://worker:password@db.example.com:5432/trendsfast",
      DATABASE_SSL_CA: "production-test-ca",
      TRENDSFAST_SURFACE: "ops",
      PROVIDER_CREDENTIAL_MODE: "fixture",
      PROVIDER_CALLS_ENABLED: "false",
      CRON_SECRET: "c".repeat(32),
    };
    expect(tryParseEnv(hostedOps).success).toBe(false);
    const missing = tryParseEnv(hostedOps);
    if (!missing.success) {
      expect(missing.error.issues.map((issue) => issue.path)).toEqual(
        expect.arrayContaining(["RETENTION_DATABASE_URL", "MANAGED_POLICY_REVISION"]),
      );
    }
    expect(
      tryParseEnv({
        ...hostedOps,
        RETENTION_DATABASE_URL: "postgresql://retention:password@db.example.com:5432/trendsfast",
        MANAGED_POLICY_REVISION: "r".repeat(32),
      }).success,
    ).toBe(true);
  });

  it("keeps sandbox billing fixture-only and live billing non-fixture", () => {
    const sandbox = {
      BILLING_ENABLED: "true",
      STRIPE_MODE: "test",
      STRIPE_SECRET_KEY: "sk_test_configured",
      STRIPE_WEBHOOK_SECRET: "whsec_configured",
      STRIPE_FOUNDER_CLOUD_PRICE_ID: "price_founder",
      STRIPE_PORTAL_LOGIN_URL: "https://billing.stripe.com/p/login/test_founder",
    };
    expect(
      tryParseEnv({
        ...sandbox,
        PROVIDER_CREDENTIAL_MODE: "managed",
      }).success,
    ).toBe(false);
    expect(tryParseEnv(sandbox).success).toBe(true);
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
        MONITORING_ENABLED: "true",
        STRIPE_SECRET_KEY: "sk_test_configured",
        STRIPE_WEBHOOK_SECRET: "whsec_configured",
        STRIPE_FOUNDER_CLOUD_PRICE_ID: "price_founder",
        STRIPE_PORTAL_LOGIN_URL: "https://billing.stripe.com/p/login/test_founder",
        CRON_SECRET: "c".repeat(32),
        MAX_SCAN_DURATION_SECONDS: "300",
        MONITORING_LEASE_SECONDS: "300",
      }).success,
    ).toBe(false);
    expect(
      tryParseEnv({
        BILLING_ENABLED: "true",
        PAID_MONITORING_ENABLED: "true",
        MONITORING_ENABLED: "true",
        STRIPE_SECRET_KEY: "sk_test_configured",
        STRIPE_WEBHOOK_SECRET: "whsec_configured",
        STRIPE_FOUNDER_CLOUD_PRICE_ID: "price_founder",
        STRIPE_PORTAL_LOGIN_URL: "https://billing.stripe.com/p/login/test_founder",
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
      MONITORING_ENABLED: "true",
      STRIPE_SECRET_KEY: "sk_test_configured",
      STRIPE_WEBHOOK_SECRET: "whsec_configured",
      STRIPE_FOUNDER_CLOUD_PRICE_ID: "price_founder",
      STRIPE_PORTAL_LOGIN_URL: "https://billing.stripe.com/p/login/test_founder",
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
