import { z } from "zod";

const DEFAULT_DATABASE_URL = "postgresql://trendsfast:trendsfast_local@localhost:54329/trendsfast";
const MONITORING_ROUTE_MAX_SECONDS = 300;
const MONITORING_ROUTE_BUFFER_SECONDS = 30;

const emptyToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const OptionalSecretSchema = z.preprocess(
  emptyToUndefined,
  z.string().min(1).max(10_000).optional(),
);
const OptionalTextSchema = z.preprocess(
  emptyToUndefined,
  z.string().trim().min(1).max(1_000).optional(),
);
const OptionalUrlSchema = z.preprocess(emptyToUndefined, z.string().url().max(2_000).optional());
const BooleanSchema = (defaultValue: boolean) =>
  z.preprocess((value) => {
    if (value === undefined || value === "") return defaultValue;
    if (typeof value === "string") {
      if (value.toLowerCase() === "true") return true;
      if (value.toLowerCase() === "false") return false;
    }
    return value;
  }, z.boolean());

const ExactYesSchema = z.preprocess(emptyToUndefined, z.literal("YES").optional());

const OptionalPriceSchema = z.preprocess((value) => {
  const normalized = emptyToUndefined(value);
  if (normalized === undefined) return undefined;
  return typeof normalized === "string" ? Number(normalized) : normalized;
}, z.number().finite().min(0).max(100_000).optional());

const NumberSchema = (options: {
  defaultValue: number;
  min: number;
  max: number;
  integer?: boolean;
}) =>
  z.preprocess(
    (value) => {
      if (value === undefined || value === "") return options.defaultValue;
      return typeof value === "string" ? Number(value) : value;
    },
    options.integer
      ? z.number().int().min(options.min).max(options.max)
      : z.number().finite().min(options.min).max(options.max),
  );

export const ProviderCredentialModeSchema = z.enum(["fixture", "managed", "byok"]);
export type ProviderCredentialMode = z.infer<typeof ProviderCredentialModeSchema>;

export const EnvironmentSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATABASE_URL: z.string().url().default(DEFAULT_DATABASE_URL),
    APP_URL: z.string().url().default("http://localhost:3000"),
    PUBLIC_SCAN_PROCESSING: z.enum(["inline", "manual"]).default("inline"),
    PUBLIC_SCAN_DAILY_LIMIT: NumberSchema({
      defaultValue: 1,
      min: 1,
      max: 10_000,
      integer: true,
    }),
    PUBLIC_SCAN_GLOBAL_DAILY_LIMIT: NumberSchema({
      defaultValue: 20,
      min: 1,
      max: 10_000,
      integer: true,
    }),
    PUBLIC_SCAN_GLOBAL_DAILY_BUDGET_USD: NumberSchema({
      defaultValue: 5,
      min: 0.01,
      max: 100_000,
    }),
    API_CREATE_RATE_LIMIT_PER_HOUR: NumberSchema({
      defaultValue: 20,
      min: 1,
      max: 10_000,
      integer: true,
    }),
    API_STATUS_RATE_LIMIT_PER_HOUR: NumberSchema({
      defaultValue: 300,
      min: 1,
      max: 100_000,
      integer: true,
    }),
    API_AUTH_FAILURE_LIMIT_PER_HOUR: NumberSchema({
      defaultValue: 20,
      min: 1,
      max: 10_000,
      integer: true,
    }),
    API_PROVIDER_COST_LIMIT_USD_PER_HOUR: OptionalPriceSchema,

    PROVIDER_CREDENTIAL_MODE: ProviderCredentialModeSchema.default("fixture"),
    BYOK_ACCEPT_CONSERVATIVE_COST_ESTIMATES: ExactYesSchema,

    XAI_API_KEY: OptionalSecretSchema,
    XAI_MODEL: OptionalTextSchema,
    XAI_ESTIMATED_COST_USD_PER_SEARCH: OptionalPriceSchema,
    XAI_MAX_TOOL_CALLS_PER_SCAN: NumberSchema({
      defaultValue: 2,
      min: 0,
      max: 2,
      integer: true,
    }),

    DATAFORSEO_LOGIN: OptionalTextSchema,
    DATAFORSEO_PASSWORD: OptionalSecretSchema,
    DATAFORSEO_GOOGLE_TRENDS_MODE: z.enum(["live", "standard"]).default("live"),
    DATAFORSEO_ESTIMATED_COST_USD_PER_TASK: OptionalPriceSchema,

    TAVILY_API_KEY: OptionalSecretSchema,
    TAVILY_ESTIMATED_COST_USD_PER_CREDIT: OptionalPriceSchema,
    TAVILY_MAX_CREDITS_PER_SCAN: NumberSchema({
      defaultValue: 2,
      min: 0,
      max: 2,
      integer: true,
    }),

    YOUTUBE_API_KEY: OptionalSecretSchema,
    YOUTUBE_INTERNAL_QUOTA_VALUE_USD: OptionalPriceSchema,
    YOUTUBE_MAX_SEARCHES_PER_SCAN: NumberSchema({
      defaultValue: 2,
      min: 0,
      max: 2,
      integer: true,
    }),

    GITHUB_TOKEN: OptionalSecretSchema,

    LLM_PROVIDER: z.enum(["xai", "openai"]).default("xai"),
    LLM_MODEL: OptionalTextSchema,
    OPENAI_API_KEY: OptionalSecretSchema,
    LLM_INPUT_PRICE_USD_PER_MILLION_TOKENS: OptionalPriceSchema,
    LLM_OUTPUT_PRICE_USD_PER_MILLION_TOKENS: OptionalPriceSchema,

    MAX_PROVIDER_COST_USD_PER_SCAN: OptionalPriceSchema,
    MAX_SCAN_DURATION_SECONDS: NumberSchema({
      defaultValue: 240,
      min: 30,
      max: 800,
      integer: true,
    }),
    PROVIDER_TIMEOUT_MS: NumberSchema({
      defaultValue: 15_000,
      min: 1_000,
      max: 60_000,
      integer: true,
    }),

    OPS_TOKEN: OptionalSecretSchema,
    SESSION_SECRET: OptionalSecretSchema,
    API_KEY_PEPPER: OptionalSecretSchema,

    TURNSTILE_ENABLED: BooleanSchema(false),
    TURNSTILE_SECRET_KEY: OptionalSecretSchema,
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: OptionalTextSchema,

    BILLING_ENABLED: BooleanSchema(false),
    PAID_MONITORING_ENABLED: BooleanSchema(false),
    FOUNDING_100_ENABLED: BooleanSchema(false),
    CLOUD_TRIAL_ENABLED: BooleanSchema(false),
    STRIPE_MODE: z.enum(["test", "live"]).default("test"),
    I_UNDERSTAND_LIVE_STRIPE: ExactYesSchema,
    STRIPE_LIVE_ENABLEMENT_APPROVED: ExactYesSchema,
    STRIPE_SECRET_KEY: OptionalSecretSchema,
    STRIPE_WEBHOOK_SECRET: OptionalSecretSchema,
    STRIPE_FOUNDER_CLOUD_PRICE_ID: OptionalTextSchema,
    STRIPE_PORTAL_LOGIN_URL: OptionalUrlSchema,
    CRON_SECRET: OptionalSecretSchema,
    MONITORING_CRON_BATCH_SIZE: NumberSchema({
      defaultValue: 1,
      min: 1,
      max: 10,
      integer: true,
    }),
    MONITORING_LEASE_SECONDS: NumberSchema({
      defaultValue: 300,
      min: 60,
      max: 900,
      integer: true,
    }),

    DATAFAST_ENABLED: BooleanSchema(false),
    DATAFAST_WEBSITE_ID: OptionalTextSchema,

    SCAN_RETENTION_DAYS: NumberSchema({
      defaultValue: 90,
      min: 1,
      max: 365,
      integer: true,
    }),
  })
  .superRefine((env, context) => {
    const requireTogether = (left: keyof typeof env, right: keyof typeof env, label: string) => {
      if (Boolean(env[left]) !== Boolean(env[right])) {
        context.addIssue({
          code: "custom",
          path: [left],
          message: `${label} must be configured as a complete pair`,
        });
      }
    };

    requireTogether("DATAFORSEO_LOGIN", "DATAFORSEO_PASSWORD", "DataForSEO credentials");

    if (env.XAI_API_KEY && !env.XAI_MODEL && env.LLM_PROVIDER !== "xai") {
      context.addIssue({
        code: "custom",
        path: ["XAI_MODEL"],
        message: "XAI_MODEL is required when X search is configured",
      });
    }

    if (env.PROVIDER_CREDENTIAL_MODE !== "fixture") {
      const acceptsByokSamples =
        env.PROVIDER_CREDENTIAL_MODE === "byok" &&
        env.BYOK_ACCEPT_CONSERVATIVE_COST_ESTIMATES === "YES";
      const requirePrice = (field: keyof typeof env, configured: boolean, message: string) => {
        if (configured && env[field] === undefined && !acceptsByokSamples) {
          context.addIssue({ code: "custom", path: [field], message });
        }
      };
      const requirePositivePrice = (
        field: keyof typeof env,
        configured: boolean,
        message: string,
      ) => {
        requirePrice(field, configured, message);
        if (configured && typeof env[field] === "number" && env[field] <= 0) {
          context.addIssue({
            code: "custom",
            path: [field],
            message: `${message}; the configured value must be greater than zero`,
          });
        }
      };

      if (env.LLM_INPUT_PRICE_USD_PER_MILLION_TOKENS === undefined && !acceptsByokSamples) {
        context.addIssue({
          code: "custom",
          path: ["LLM_INPUT_PRICE_USD_PER_MILLION_TOKENS"],
          message: "Live credential modes require explicit model input pricing",
        });
      }
      if ((env.LLM_INPUT_PRICE_USD_PER_MILLION_TOKENS ?? 1) <= 0) {
        context.addIssue({
          code: "custom",
          path: ["LLM_INPUT_PRICE_USD_PER_MILLION_TOKENS"],
          message: "Live model input pricing must be greater than zero",
        });
      }
      if (env.LLM_OUTPUT_PRICE_USD_PER_MILLION_TOKENS === undefined && !acceptsByokSamples) {
        context.addIssue({
          code: "custom",
          path: ["LLM_OUTPUT_PRICE_USD_PER_MILLION_TOKENS"],
          message: "Live credential modes require explicit model output pricing",
        });
      }
      if ((env.LLM_OUTPUT_PRICE_USD_PER_MILLION_TOKENS ?? 1) <= 0) {
        context.addIssue({
          code: "custom",
          path: ["LLM_OUTPUT_PRICE_USD_PER_MILLION_TOKENS"],
          message: "Live model output pricing must be greater than zero",
        });
      }
      if (!env.DATAFORSEO_LOGIN || !env.DATAFORSEO_PASSWORD) {
        context.addIssue({
          code: "custom",
          path: ["DATAFORSEO_LOGIN"],
          message: "Live credential modes require Google Trends credentials",
        });
      }
      requirePositivePrice(
        "DATAFORSEO_ESTIMATED_COST_USD_PER_TASK",
        Boolean(env.DATAFORSEO_LOGIN && env.DATAFORSEO_PASSWORD),
        "Live Google Trends coverage requires an explicit DataForSEO task estimate",
      );
      requirePositivePrice(
        "XAI_ESTIMATED_COST_USD_PER_SEARCH",
        Boolean(env.XAI_API_KEY && env.XAI_MODEL && env.XAI_MAX_TOOL_CALLS_PER_SCAN > 0),
        "Configured X Search requires an explicit per-search estimate",
      );
      requirePositivePrice(
        "TAVILY_ESTIMATED_COST_USD_PER_CREDIT",
        Boolean(env.TAVILY_API_KEY && env.TAVILY_MAX_CREDITS_PER_SCAN > 0),
        "Configured Tavily coverage requires an explicit per-credit estimate",
      );
      requirePrice(
        "YOUTUBE_INTERNAL_QUOTA_VALUE_USD",
        Boolean(env.YOUTUBE_API_KEY && env.YOUTUBE_MAX_SEARCHES_PER_SCAN > 0),
        "Configured YouTube coverage requires an explicit internal quota value",
      );
      requirePrice(
        "MAX_PROVIDER_COST_USD_PER_SCAN",
        true,
        "Live credential modes require an explicit per-scan provider cost ceiling",
      );
      requirePrice(
        "API_PROVIDER_COST_LIMIT_USD_PER_HOUR",
        true,
        "Live API access requires an explicit rolling-hour provider cost limit",
      );
      if (
        env.MAX_PROVIDER_COST_USD_PER_SCAN !== undefined &&
        env.MAX_PROVIDER_COST_USD_PER_SCAN <= 0
      ) {
        context.addIssue({
          code: "custom",
          path: ["MAX_PROVIDER_COST_USD_PER_SCAN"],
          message: "The live per-scan provider cost ceiling must be greater than zero",
        });
      }
      if (
        env.API_PROVIDER_COST_LIMIT_USD_PER_HOUR !== undefined &&
        env.API_PROVIDER_COST_LIMIT_USD_PER_HOUR <= 0
      ) {
        context.addIssue({
          code: "custom",
          path: ["API_PROVIDER_COST_LIMIT_USD_PER_HOUR"],
          message: "The live API rolling-hour provider cost limit must be greater than zero",
        });
      }
      const hasViableXSearch = Boolean(
        env.XAI_API_KEY && env.XAI_MODEL && env.XAI_MAX_TOOL_CALLS_PER_SCAN > 0,
      );
      const hasViableTavily = Boolean(env.TAVILY_API_KEY && env.TAVILY_MAX_CREDITS_PER_SCAN > 0);
      if (!hasViableXSearch && !hasViableTavily) {
        context.addIssue({
          code: "custom",
          path: ["TAVILY_API_KEY"],
          message:
            "Live credential modes require a usable X Search model or Tavily credential with a nonzero request cap",
        });
      }
      if (env.LLM_PROVIDER === "xai") {
        if (!env.XAI_API_KEY || (!env.LLM_MODEL && !env.XAI_MODEL)) {
          context.addIssue({
            code: "custom",
            path: ["LLM_MODEL"],
            message: "xAI synthesis requires a server-side key and model",
          });
        }
      } else if (!env.OPENAI_API_KEY || !env.LLM_MODEL) {
        context.addIssue({
          code: "custom",
          path: ["LLM_MODEL"],
          message: "OpenAI synthesis requires a server-side key and model",
        });
      }
    }

    if (env.PROVIDER_CREDENTIAL_MODE === "managed") {
      if (!env.OPS_TOKEN || env.OPS_TOKEN.length < 32) {
        context.addIssue({
          code: "custom",
          path: ["OPS_TOKEN"],
          message: "Managed mode requires OPS_TOKEN with at least 32 characters",
        });
      }
      if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) {
        context.addIssue({
          code: "custom",
          path: ["SESSION_SECRET"],
          message: "Managed mode requires SESSION_SECRET with at least 32 characters",
        });
      }
      if (!env.API_KEY_PEPPER || env.API_KEY_PEPPER.length < 32) {
        context.addIssue({
          code: "custom",
          path: ["API_KEY_PEPPER"],
          message: "Managed mode requires API_KEY_PEPPER with at least 32 characters",
        });
      }
      if (env.DATABASE_URL === DEFAULT_DATABASE_URL) {
        context.addIssue({
          code: "custom",
          path: ["DATABASE_URL"],
          message: "Managed mode cannot use the local fixture database URL",
        });
      }
      if (!env.APP_URL?.startsWith("https://")) {
        context.addIssue({
          code: "custom",
          path: ["APP_URL"],
          message: "Managed mode requires an HTTPS APP_URL",
        });
      }
    }

    if (env.BILLING_ENABLED) {
      if (env.STRIPE_MODE === "test" && env.PROVIDER_CREDENTIAL_MODE !== "fixture") {
        context.addIssue({
          code: "custom",
          path: ["PROVIDER_CREDENTIAL_MODE"],
          message: "Stripe sandbox billing is fixture-only",
        });
      }
      if (env.STRIPE_MODE === "live" && env.PROVIDER_CREDENTIAL_MODE === "fixture") {
        context.addIssue({
          code: "custom",
          path: ["PROVIDER_CREDENTIAL_MODE"],
          message: "Live Stripe billing requires a non-fixture provider mode",
        });
      }
      if (!env.STRIPE_SECRET_KEY || !env.STRIPE_WEBHOOK_SECRET) {
        context.addIssue({
          code: "custom",
          path: ["STRIPE_SECRET_KEY"],
          message: "Billing requires both Stripe server-side secrets",
        });
      }
      if (!env.STRIPE_FOUNDER_CLOUD_PRICE_ID?.startsWith("price_")) {
        context.addIssue({
          code: "custom",
          path: ["STRIPE_FOUNDER_CLOUD_PRICE_ID"],
          message: "Billing requires an explicit Stripe price_ ID",
        });
      }
      if (!env.STRIPE_PORTAL_LOGIN_URL) {
        context.addIssue({
          code: "custom",
          path: ["STRIPE_PORTAL_LOGIN_URL"],
          message: "Billing requires the Stripe-hosted no-code Customer Portal login URL",
        });
      }
      if (env.STRIPE_MODE === "live" && env.NODE_ENV !== "production") {
        context.addIssue({
          code: "custom",
          path: ["STRIPE_MODE"],
          message: "Live Stripe mode is accepted only in production",
        });
      }
      if (
        env.STRIPE_MODE === "live" &&
        (env.I_UNDERSTAND_LIVE_STRIPE !== "YES" || env.STRIPE_LIVE_ENABLEMENT_APPROVED !== "YES")
      ) {
        context.addIssue({
          code: "custom",
          path: ["STRIPE_LIVE_ENABLEMENT_APPROVED"],
          message: "Live Stripe billing requires both exact live acknowledgements",
        });
      }
    }

    if (env.STRIPE_PORTAL_LOGIN_URL) {
      const portal = new URL(env.STRIPE_PORTAL_LOGIN_URL);
      if (
        portal.origin !== "https://billing.stripe.com" ||
        !portal.pathname.startsWith("/p/login/") ||
        portal.pathname === "/p/login/" ||
        portal.username ||
        portal.password ||
        portal.search ||
        portal.hash
      ) {
        context.addIssue({
          code: "custom",
          path: ["STRIPE_PORTAL_LOGIN_URL"],
          message: "Customer Portal login must be an exact Stripe-hosted /p/login URL",
        });
      }
    }

    if (env.STRIPE_SECRET_KEY) {
      const expectedPrefixes =
        env.STRIPE_MODE === "test" ? ["sk_test_", "rk_test_"] : ["sk_live_", "rk_live_"];
      if (!expectedPrefixes.some((prefix) => env.STRIPE_SECRET_KEY?.startsWith(prefix))) {
        context.addIssue({
          code: "custom",
          path: ["STRIPE_SECRET_KEY"],
          message: "Stripe secret-key prefix must match STRIPE_MODE",
        });
      }
    }

    if (env.STRIPE_WEBHOOK_SECRET && !env.STRIPE_WEBHOOK_SECRET.startsWith("whsec_")) {
      context.addIssue({
        code: "custom",
        path: ["STRIPE_WEBHOOK_SECRET"],
        message: "Stripe webhook secret must use the whsec_ prefix",
      });
    }

    if (env.PAID_MONITORING_ENABLED && !env.BILLING_ENABLED) {
      context.addIssue({
        code: "custom",
        path: ["PAID_MONITORING_ENABLED"],
        message: "Paid monitoring requires BILLING_ENABLED",
      });
    }

    if (env.FOUNDING_100_ENABLED) {
      context.addIssue({
        code: "custom",
        path: ["FOUNDING_100_ENABLED"],
        message: "Founding 100 is not authorized for launch",
      });
    }
    if (env.CLOUD_TRIAL_ENABLED) {
      context.addIssue({
        code: "custom",
        path: ["CLOUD_TRIAL_ENABLED"],
        message: "Cloud trial is not authorized for launch",
      });
    }

    if (env.PAID_MONITORING_ENABLED && (!env.CRON_SECRET || env.CRON_SECRET.length < 32)) {
      context.addIssue({
        code: "custom",
        path: ["CRON_SECRET"],
        message: "Paid monitoring requires CRON_SECRET with at least 32 characters",
      });
    }
    if (
      env.PAID_MONITORING_ENABLED &&
      env.MONITORING_LEASE_SECONDS < env.MAX_SCAN_DURATION_SECONDS + MONITORING_ROUTE_BUFFER_SECONDS
    ) {
      context.addIssue({
        code: "custom",
        path: ["MONITORING_LEASE_SECONDS"],
        message: "Paid monitoring lease must exceed the scan deadline by at least 30 seconds",
      });
    }
    if (
      env.PAID_MONITORING_ENABLED &&
      env.MAX_SCAN_DURATION_SECONDS * env.MONITORING_CRON_BATCH_SIZE +
        MONITORING_ROUTE_BUFFER_SECONDS >
        MONITORING_ROUTE_MAX_SECONDS
    ) {
      context.addIssue({
        code: "custom",
        path: ["MONITORING_CRON_BATCH_SIZE"],
        message: "Paid monitoring batch deadlines plus cleanup must fit the 300-second cron route",
      });
    }

    if (env.DATAFAST_ENABLED && !env.DATAFAST_WEBSITE_ID) {
      context.addIssue({
        code: "custom",
        path: ["DATAFAST_WEBSITE_ID"],
        message: "DataFast requires a website ID when enabled",
      });
    }

    if (
      env.TURNSTILE_ENABLED &&
      (!env.TURNSTILE_SECRET_KEY || !env.NEXT_PUBLIC_TURNSTILE_SITE_KEY)
    ) {
      context.addIssue({
        code: "custom",
        path: ["TURNSTILE_SECRET_KEY"],
        message: "Turnstile requires both server and public site keys when enabled",
      });
    }
  });

export type Environment = z.infer<typeof EnvironmentSchema>;

/**
 * Public, deliberately conservative examples for self-hosters who explicitly
 * acknowledge that they must verify the values against their own invoices.
 * They are not TrendsFast Cloud prices, margins, or production cost data.
 */
export const BYOK_CONSERVATIVE_COST_SAMPLES = {
  xaiSearchUsd: 0.1,
  dataForSeoTaskUsd: 0.05,
  tavilyCreditUsd: 0.05,
  youtubeQuotaUnitUsd: 0.01,
  llmInputUsdPerMillionTokens: 5,
  llmOutputUsdPerMillionTokens: 20,
  maximumProviderCostUsdPerScan: 1,
  apiProviderCostLimitUsdPerHour: 5,
} as const;

export type ResolvedProviderCosts = {
  xaiSearchUsd: number;
  dataForSeoTaskUsd: number;
  tavilyCreditUsd: number;
  youtubeQuotaUnitUsd: number;
  llmInputUsdPerMillionTokens: number;
  llmOutputUsdPerMillionTokens: number;
  maximumProviderCostUsdPerScan: number;
  apiProviderCostLimitUsdPerHour: number;
};

export function resolveProviderCosts(env: Environment): ResolvedProviderCosts {
  if (env.PROVIDER_CREDENTIAL_MODE === "fixture") {
    return {
      xaiSearchUsd: 0,
      dataForSeoTaskUsd: 0,
      tavilyCreditUsd: 0,
      youtubeQuotaUnitUsd: 0,
      llmInputUsdPerMillionTokens: 0,
      llmOutputUsdPerMillionTokens: 0,
      maximumProviderCostUsdPerScan: 0,
      apiProviderCostLimitUsdPerHour: 0,
    };
  }
  const samplesAccepted =
    env.PROVIDER_CREDENTIAL_MODE === "byok" &&
    env.BYOK_ACCEPT_CONSERVATIVE_COST_ESTIMATES === "YES";
  const resolve = (value: number | undefined, sample: number, label: string): number => {
    if (value !== undefined) return value;
    if (samplesAccepted) return sample;
    throw new Error(`${label} is required by the validated live cost policy`);
  };
  return {
    xaiSearchUsd: env.XAI_API_KEY
      ? resolve(
          env.XAI_ESTIMATED_COST_USD_PER_SEARCH,
          BYOK_CONSERVATIVE_COST_SAMPLES.xaiSearchUsd,
          "X Search cost",
        )
      : 0,
    dataForSeoTaskUsd: resolve(
      env.DATAFORSEO_ESTIMATED_COST_USD_PER_TASK,
      BYOK_CONSERVATIVE_COST_SAMPLES.dataForSeoTaskUsd,
      "DataForSEO task cost",
    ),
    tavilyCreditUsd: env.TAVILY_API_KEY
      ? resolve(
          env.TAVILY_ESTIMATED_COST_USD_PER_CREDIT,
          BYOK_CONSERVATIVE_COST_SAMPLES.tavilyCreditUsd,
          "Tavily credit cost",
        )
      : 0,
    youtubeQuotaUnitUsd: env.YOUTUBE_API_KEY
      ? resolve(
          env.YOUTUBE_INTERNAL_QUOTA_VALUE_USD,
          BYOK_CONSERVATIVE_COST_SAMPLES.youtubeQuotaUnitUsd,
          "YouTube quota value",
        )
      : 0,
    llmInputUsdPerMillionTokens: resolve(
      env.LLM_INPUT_PRICE_USD_PER_MILLION_TOKENS,
      BYOK_CONSERVATIVE_COST_SAMPLES.llmInputUsdPerMillionTokens,
      "Model input price",
    ),
    llmOutputUsdPerMillionTokens: resolve(
      env.LLM_OUTPUT_PRICE_USD_PER_MILLION_TOKENS,
      BYOK_CONSERVATIVE_COST_SAMPLES.llmOutputUsdPerMillionTokens,
      "Model output price",
    ),
    maximumProviderCostUsdPerScan: resolve(
      env.MAX_PROVIDER_COST_USD_PER_SCAN,
      BYOK_CONSERVATIVE_COST_SAMPLES.maximumProviderCostUsdPerScan,
      "Per-scan provider cost ceiling",
    ),
    apiProviderCostLimitUsdPerHour: resolve(
      env.API_PROVIDER_COST_LIMIT_USD_PER_HOUR,
      BYOK_CONSERVATIVE_COST_SAMPLES.apiProviderCostLimitUsdPerHour,
      "API rolling-hour provider cost limit",
    ),
  };
}

export function resolveApiProviderCostLimitUsdPerHour(env: Environment): number {
  return resolveProviderCosts(env).apiProviderCostLimitUsdPerHour;
}

export function resolvedProviderCostEnvironment(
  env: Environment,
): Readonly<Record<string, string>> {
  const costs = resolveProviderCosts(env);
  return {
    XAI_ESTIMATED_COST_USD_PER_SEARCH: String(costs.xaiSearchUsd),
    DATAFORSEO_ESTIMATED_COST_USD_PER_TASK: String(costs.dataForSeoTaskUsd),
    TAVILY_ESTIMATED_COST_USD_PER_CREDIT: String(costs.tavilyCreditUsd),
    YOUTUBE_INTERNAL_QUOTA_VALUE_USD: String(costs.youtubeQuotaUnitUsd),
  };
}

export class EnvironmentValidationError extends Error {
  readonly issues: ReadonlyArray<{ path: string; message: string }>;

  constructor(error: z.ZodError) {
    const issues = error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    }));
    super(
      `Invalid TrendsFast environment: ${issues
        .map((issue) => `${issue.path || "environment"}: ${issue.message}`)
        .join("; ")}`,
    );
    this.name = "EnvironmentValidationError";
    this.issues = issues;
  }
}

export function tryParseEnv(
  input: Record<string, unknown>,
): { success: true; data: Environment } | { success: false; error: EnvironmentValidationError } {
  const result = EnvironmentSchema.safeParse(input);
  return result.success
    ? { success: true, data: result.data }
    : { success: false, error: new EnvironmentValidationError(result.error) };
}

export function parseEnv(input: Record<string, unknown>): Environment {
  const result = tryParseEnv(input);
  if (!result.success) throw result.error;
  return result.data;
}

export function loadEnv(): Environment {
  return parseEnv(process.env);
}

export { DEFAULT_DATABASE_URL };
