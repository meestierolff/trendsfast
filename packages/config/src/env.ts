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
const OptionalDeploymentHostSchema = z.preprocess(
  (value) => (typeof value === "string" && value.trim() ? value.trim().toLowerCase() : undefined),
  z
    .string()
    .min(3)
    .max(255)
    .regex(
      /^(?!.*\.\.)(?:[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)(?::[0-9]{1,5})?$/,
      "PUBLIC_DEPLOYMENT_HOST must be a clean hostname with an optional port",
    )
    .optional(),
);
const OptionalDeploymentIdSchema = z.preprocess(
  emptyToUndefined,
  z
    .string()
    .trim()
    .min(1)
    .max(255)
    .regex(/^[A-Za-z0-9._:-]+$/, "PUBLIC_DEPLOYMENT_ID contains invalid characters")
    .optional(),
);
const OptionalManagedPolicyRevisionSchema = z.preprocess(
  emptyToUndefined,
  z
    .string()
    .trim()
    .min(32)
    .max(200)
    .regex(/^[A-Za-z0-9_-]+$/, "MANAGED_POLICY_REVISION contains invalid characters")
    .optional(),
);
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

const OptionalNumberSchema = (options: { min: number; max: number; integer?: boolean }) =>
  z.preprocess(
    (value) => {
      const normalized = emptyToUndefined(value);
      if (normalized === undefined) return undefined;
      return typeof normalized === "string" ? Number(normalized) : normalized;
    },
    (options.integer
      ? z.number().int().min(options.min).max(options.max)
      : z.number().finite().min(options.min).max(options.max)
    ).optional(),
  );

export const ProviderCredentialModeSchema = z.enum(["fixture", "managed", "byok"]);
export type ProviderCredentialMode = z.infer<typeof ProviderCredentialModeSchema>;

export const EnvironmentSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATABASE_URL: z.string().url().default(DEFAULT_DATABASE_URL),
    MEMBER_DATABASE_URL: OptionalUrlSchema,
    OPS_DATABASE_URL: OptionalUrlSchema,
    WORKER_DATABASE_URL: OptionalUrlSchema,
    BILLING_DATABASE_URL: OptionalUrlSchema,
    AUTH_DATABASE_URL: OptionalUrlSchema,
    RETENTION_DATABASE_URL: OptionalUrlSchema,
    DATABASE_SSL_CA: OptionalSecretSchema,
    APP_URL: z.string().url().default("http://localhost:3000"),
    PUBLIC_APP_URL: OptionalUrlSchema,
    TRENDSFAST_SURFACE: z.enum(["public", "ops"]).default("public"),
    VERCEL_ENV: z.enum(["development", "preview", "production"]).optional(),
    TRENDSFAST_DEPLOYMENT_ENV: z.enum(["local", "preview", "production"]).optional(),
    PUBLIC_DEPLOYMENT_HOST: OptionalDeploymentHostSchema,
    PUBLIC_DEPLOYMENT_ID: OptionalDeploymentIdSchema,
    MANAGED_POLICY_REVISION: OptionalManagedPolicyRevisionSchema,
    PROVIDER_CALLS_ENABLED: BooleanSchema(false),
    PUBLIC_SCANS_ENABLED: BooleanSchema(false),
    LIVE_API_CREATION_ENABLED: BooleanSchema(false),
    PUBLIC_SCAN_PROCESSING: z.enum(["inline", "manual"]).default("inline"),
    PUBLIC_SCAN_DAILY_LIMIT: OptionalNumberSchema({
      min: 1,
      max: 10_000,
      integer: true,
    }),
    PUBLIC_SCAN_GLOBAL_DAILY_LIMIT: OptionalNumberSchema({
      min: 1,
      max: 10_000,
      integer: true,
    }),
    PUBLIC_SCAN_GLOBAL_DAILY_BUDGET_USD: OptionalNumberSchema({
      min: 0.01,
      max: 100_000,
    }),
    API_CREATE_RATE_LIMIT_PER_HOUR: OptionalNumberSchema({
      min: 1,
      max: 10_000,
      integer: true,
    }),
    API_STATUS_RATE_LIMIT_PER_HOUR: OptionalNumberSchema({
      min: 1,
      max: 100_000,
      integer: true,
    }),
    API_AUTH_FAILURE_LIMIT_PER_HOUR: OptionalNumberSchema({
      min: 1,
      max: 10_000,
      integer: true,
    }),
    API_PROVIDER_COST_LIMIT_USD_PER_HOUR: OptionalPriceSchema,

    PROVIDER_CREDENTIAL_MODE: ProviderCredentialModeSchema.default("fixture"),

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
    NEXT_PUBLIC_SUPABASE_URL: OptionalUrlSchema,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: OptionalSecretSchema,

    BILLING_ENABLED: BooleanSchema(false),
    BILLING_CHECKOUT_ENABLED: BooleanSchema(false),
    PAID_MONITORING_ENABLED: BooleanSchema(false),
    MONITORING_ENABLED: BooleanSchema(false),
    PAID_HOSTING_APPROVED: ExactYesSchema,
    FOUNDING_100_ENABLED: BooleanSchema(false),
    CLOUD_TRIAL_ENABLED: BooleanSchema(false),
    STRIPE_MODE: z.enum(["test", "live"]).default("test"),
    STRIPE_SANDBOX_KEY_ROTATED: ExactYesSchema,
    I_UNDERSTAND_LIVE_STRIPE: ExactYesSchema,
    STRIPE_LIVE_CATALOG_APPROVED: ExactYesSchema,
    STRIPE_LIVE_ENABLEMENT_APPROVED: ExactYesSchema,
    STRIPE_SECRET_KEY: OptionalSecretSchema,
    STRIPE_WEBHOOK_SECRET: OptionalSecretSchema,
    STRIPE_FOUNDER_CLOUD_PRICE_ID: OptionalTextSchema,
    STRIPE_PORTAL_LOGIN_URL: OptionalUrlSchema,
    CRON_SECRET: OptionalSecretSchema,
    OPS_ALERT_WEBHOOK_URL: OptionalUrlSchema,
    OPS_ALERT_WEBHOOK_SECRET: OptionalSecretSchema,
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
    MONITORING_MAX_ATTEMPTS: NumberSchema({
      defaultValue: 3,
      min: 1,
      max: 10,
      integer: true,
    }),
    MONITORING_RETRY_BASE_SECONDS: NumberSchema({
      defaultValue: 300,
      min: 30,
      max: 86_400,
      integer: true,
    }),
    MONITORING_REVIEW_ALERT_AGE_SECONDS: NumberSchema({
      defaultValue: 86_400,
      min: 60,
      max: 31_536_000,
      integer: true,
    }),
    OPS_HEALTH_MAX_AGE_SECONDS: NumberSchema({
      defaultValue: 129_600,
      min: 60,
      max: 31_536_000,
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
    requireTogether(
      "OPS_ALERT_WEBHOOK_URL",
      "OPS_ALERT_WEBHOOK_SECRET",
      "Operations alert webhook",
    );

    const productionOpsProviderVerification =
      env.TRENDSFAST_SURFACE === "ops" &&
      env.PROVIDER_CALLS_ENABLED &&
      (env.VERCEL_ENV === "production" || env.TRENDSFAST_DEPLOYMENT_ENV === "production");
    const hostedOpsSurface =
      env.TRENDSFAST_SURFACE === "ops" &&
      (env.VERCEL_ENV === "production" ||
        env.TRENDSFAST_DEPLOYMENT_ENV === "production" ||
        env.NODE_ENV === "production");
    if (hostedOpsSurface && !env.PUBLIC_APP_URL) {
      context.addIssue({
        code: "custom",
        path: ["PUBLIC_APP_URL"],
        message: "The hosted operations surface requires the exact public application origin",
      });
    }
    if (env.TRENDSFAST_SURFACE === "ops" && env.PUBLIC_APP_URL) {
      try {
        const publicOrigin = new URL(env.PUBLIC_APP_URL);
        const opsOrigin = new URL(env.APP_URL);
        if (
          !["http:", "https:"].includes(publicOrigin.protocol) ||
          (hostedOpsSurface && publicOrigin.protocol !== "https:") ||
          publicOrigin.username ||
          publicOrigin.password ||
          publicOrigin.pathname !== "/" ||
          publicOrigin.search ||
          publicOrigin.hash ||
          publicOrigin.origin === opsOrigin.origin
        ) {
          context.addIssue({
            code: "custom",
            path: ["PUBLIC_APP_URL"],
            message:
              "PUBLIC_APP_URL must be a distinct clean public origin and must use HTTPS on hosted operations",
          });
        }
      } catch {
        // PUBLIC_APP_URL and APP_URL report their own URL issues.
      }
    }
    if (productionOpsProviderVerification && !env.PUBLIC_DEPLOYMENT_HOST) {
      context.addIssue({
        code: "custom",
        path: ["PUBLIC_DEPLOYMENT_HOST"],
        message:
          "Production operations verification requires the exact public deployment host target",
      });
    }
    if (productionOpsProviderVerification && !env.PUBLIC_DEPLOYMENT_ID) {
      context.addIssue({
        code: "custom",
        path: ["PUBLIC_DEPLOYMENT_ID"],
        message:
          "Production operations verification requires the exact public deployment identifier",
      });
    }

    if (env.XAI_API_KEY && !env.XAI_MODEL && env.LLM_PROVIDER !== "xai") {
      context.addIssue({
        code: "custom",
        path: ["XAI_MODEL"],
        message: "XAI_MODEL is required when X search is configured",
      });
    }

    if (env.PROVIDER_CALLS_ENABLED && env.PROVIDER_CREDENTIAL_MODE === "fixture") {
      context.addIssue({
        code: "custom",
        path: ["PROVIDER_CALLS_ENABLED"],
        message: "External provider calls require managed or BYOK credential mode",
      });
    }

    if (env.PROVIDER_CREDENTIAL_MODE !== "fixture" && env.PROVIDER_CALLS_ENABLED) {
      const requirePrice = (field: keyof typeof env, configured: boolean, message: string) => {
        if (configured && env[field] === undefined) {
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

      if (env.LLM_INPUT_PRICE_USD_PER_MILLION_TOKENS === undefined) {
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
      if (env.LLM_OUTPUT_PRICE_USD_PER_MILLION_TOKENS === undefined) {
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

      for (const field of [
        "PUBLIC_SCAN_DAILY_LIMIT",
        "PUBLIC_SCAN_GLOBAL_DAILY_LIMIT",
        "PUBLIC_SCAN_GLOBAL_DAILY_BUDGET_USD",
        "API_CREATE_RATE_LIMIT_PER_HOUR",
        "API_STATUS_RATE_LIMIT_PER_HOUR",
        "API_AUTH_FAILURE_LIMIT_PER_HOUR",
      ] as const) {
        if (env[field] === undefined) {
          context.addIssue({
            code: "custom",
            path: [field],
            message:
              "Enabled managed/BYOK provider work requires an explicit private operating policy",
          });
        }
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
      if (env.TRENDSFAST_SURFACE === "ops" && (!env.OPS_TOKEN || env.OPS_TOKEN.length < 32)) {
        context.addIssue({
          code: "custom",
          path: ["OPS_TOKEN"],
          message: "Managed mode requires OPS_TOKEN with at least 32 characters",
        });
      }
      if (env.TRENDSFAST_SURFACE === "public" && env.OPS_TOKEN) {
        context.addIssue({
          code: "custom",
          path: ["OPS_TOKEN"],
          message: "The public deployment must not receive the founder operations bearer",
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
      if (env.TRENDSFAST_SURFACE === "public" && env.DATABASE_URL === DEFAULT_DATABASE_URL) {
        context.addIssue({
          code: "custom",
          path: ["DATABASE_URL"],
          message: "The managed public surface cannot use the local fixture database URL",
        });
      }
      if (hostedOpsSurface && !env.OPS_DATABASE_URL) {
        context.addIssue({
          code: "custom",
          path: ["OPS_DATABASE_URL"],
          message: "The hosted operations surface requires its dedicated database role URL",
        });
      }
      const surfaceDatabaseUrl =
        env.TRENDSFAST_SURFACE === "ops" ? env.OPS_DATABASE_URL : env.DATABASE_URL;
      let databaseHost = "";
      try {
        databaseHost = surfaceDatabaseUrl ? new URL(surfaceDatabaseUrl).hostname.toLowerCase() : "";
      } catch {
        // The selected surface URL reports its own validation issue.
      }
      if (
        databaseHost &&
        !["localhost", "127.0.0.1", "[::1]", "::1"].includes(databaseHost) &&
        !env.DATABASE_SSL_CA
      ) {
        context.addIssue({
          code: "custom",
          path: ["DATABASE_SSL_CA"],
          message: "Managed hosted PostgreSQL requires an explicit certificate authority",
        });
      }
      const hostedDatabase =
        databaseHost && !["localhost", "127.0.0.1", "[::1]", "::1"].includes(databaseHost);
      if (
        hostedDatabase &&
        env.TRENDSFAST_SURFACE === "public" &&
        (env.PROVIDER_CALLS_ENABLED ||
          env.MONITORING_ENABLED ||
          Boolean(env.CRON_SECRET) ||
          Boolean(env.OPS_ALERT_WEBHOOK_URL) ||
          Boolean(env.OPS_ALERT_WEBHOOK_SECRET)) &&
        !env.WORKER_DATABASE_URL
      ) {
        context.addIssue({
          code: "custom",
          path: ["WORKER_DATABASE_URL"],
          message:
            "Hosted scan execution and operations-alert draining require the dedicated worker database role URL",
        });
      }
      if (hostedDatabase && env.BILLING_ENABLED && !env.BILLING_DATABASE_URL) {
        context.addIssue({
          code: "custom",
          path: ["BILLING_DATABASE_URL"],
          message: "Hosted billing requires its dedicated database role URL",
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

    const runtimeDatabaseUrl =
      env.TRENDSFAST_SURFACE === "ops"
        ? (env.OPS_DATABASE_URL ?? env.DATABASE_URL)
        : env.DATABASE_URL;
    let runtimeDatabaseHost = "";
    try {
      runtimeDatabaseHost = new URL(runtimeDatabaseUrl).hostname.toLowerCase();
    } catch {
      // DATABASE_URL reports its own validation issue.
    }
    const hostedRuntimeDatabase =
      runtimeDatabaseHost &&
      !["localhost", "127.0.0.1", "[::1]", "::1"].includes(runtimeDatabaseHost);
    const explicitDeploymentEnvironment = env.VERCEL_ENV ?? env.TRENDSFAST_DEPLOYMENT_ENV;
    const hostedProductionPublic =
      env.TRENDSFAST_SURFACE === "public" &&
      (explicitDeploymentEnvironment === "production" ||
        (!explicitDeploymentEnvironment &&
          env.NODE_ENV === "production" &&
          Boolean(hostedRuntimeDatabase)));
    if (
      Boolean(env.NEXT_PUBLIC_SUPABASE_URL) !== Boolean(env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)
    ) {
      context.addIssue({
        code: "custom",
        path: ["NEXT_PUBLIC_SUPABASE_URL"],
        message: "Supabase Auth requires both the project URL and publishable browser key",
      });
    }
    if (
      hostedProductionPublic &&
      (!env.NEXT_PUBLIC_SUPABASE_URL || !env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)
    ) {
      context.addIssue({
        code: "custom",
        path: ["NEXT_PUBLIC_SUPABASE_URL"],
        message: "The hosted production public surface requires Supabase Auth configuration",
      });
    }
    if (hostedProductionPublic && !env.MEMBER_DATABASE_URL) {
      context.addIssue({
        code: "custom",
        path: ["MEMBER_DATABASE_URL"],
        message:
          "Hosted member Auth and dashboard routes require their dedicated database role URL",
      });
    }
    if (
      hostedRuntimeDatabase &&
      env.TRENDSFAST_SURFACE === "public" &&
      env.PROVIDER_CREDENTIAL_MODE !== "fixture" &&
      !env.AUTH_DATABASE_URL
    ) {
      context.addIssue({
        code: "custom",
        path: ["AUTH_DATABASE_URL"],
        message: "Hosted live API authentication requires its dedicated database role URL",
      });
    }
    if (
      hostedRuntimeDatabase &&
      env.TRENDSFAST_SURFACE === "ops" &&
      Boolean(env.CRON_SECRET) &&
      !env.RETENTION_DATABASE_URL
    ) {
      context.addIssue({
        code: "custom",
        path: ["RETENTION_DATABASE_URL"],
        message: "The hosted operations retention cron requires its dedicated database role URL",
      });
    }
    if (
      hostedRuntimeDatabase &&
      env.TRENDSFAST_SURFACE === "ops" &&
      Boolean(env.CRON_SECRET) &&
      !env.MANAGED_POLICY_REVISION
    ) {
      context.addIssue({
        code: "custom",
        path: ["MANAGED_POLICY_REVISION"],
        message: "The hosted operations retention cron requires the managed policy revision",
      });
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
      if (
        env.STRIPE_MODE === "live" &&
        env.NODE_ENV === "production" &&
        (!env.OPS_ALERT_WEBHOOK_URL || !env.OPS_ALERT_WEBHOOK_SECRET)
      ) {
        context.addIssue({
          code: "custom",
          path: ["OPS_ALERT_WEBHOOK_URL"],
          message: "Production live billing requires the signed operations alert webhook pair",
        });
      }
      if (
        env.STRIPE_MODE === "live" &&
        env.NODE_ENV === "production" &&
        (!env.CRON_SECRET || env.CRON_SECRET.length < 32)
      ) {
        context.addIssue({
          code: "custom",
          path: ["CRON_SECRET"],
          message: "Production live billing requires CRON_SECRET with at least 32 characters",
        });
      }
      if (env.STRIPE_MODE === "live" && env.NODE_ENV === "production" && !env.WORKER_DATABASE_URL) {
        context.addIssue({
          code: "custom",
          path: ["WORKER_DATABASE_URL"],
          message:
            "Production live billing requires the dedicated worker role for reconciliation and alert delivery",
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

    if (env.OPS_ALERT_WEBHOOK_URL) {
      const alert = new URL(env.OPS_ALERT_WEBHOOK_URL);
      if (
        alert.protocol !== "https:" ||
        alert.username ||
        alert.password ||
        alert.search ||
        alert.hash
      ) {
        context.addIssue({
          code: "custom",
          path: ["OPS_ALERT_WEBHOOK_URL"],
          message:
            "Operations alerts require a clean HTTPS webhook URL without credentials or query data",
        });
      }
      if ((env.OPS_ALERT_WEBHOOK_SECRET?.length ?? 0) < 32) {
        context.addIssue({
          code: "custom",
          path: ["OPS_ALERT_WEBHOOK_SECRET"],
          message: "Operations alert signing requires at least 32 secret characters",
        });
      }
    }

    if (env.PAID_MONITORING_ENABLED && !env.BILLING_ENABLED) {
      context.addIssue({
        code: "custom",
        path: ["PAID_MONITORING_ENABLED"],
        message: "Paid monitoring requires BILLING_ENABLED",
      });
    }
    if (env.BILLING_CHECKOUT_ENABLED && !env.BILLING_ENABLED) {
      context.addIssue({
        code: "custom",
        path: ["BILLING_CHECKOUT_ENABLED"],
        message: "Checkout cannot bypass the billing kill switch",
      });
    }
    if (env.PAID_MONITORING_ENABLED && !env.MONITORING_ENABLED) {
      context.addIssue({
        code: "custom",
        path: ["MONITORING_ENABLED"],
        message: "Paid monitoring requires the independent monitoring kill switch",
      });
    }
    if (env.MONITORING_ENABLED && !env.PAID_MONITORING_ENABLED) {
      context.addIssue({
        code: "custom",
        path: ["MONITORING_ENABLED"],
        message: "The monitoring kill switch cannot bypass paid-monitoring admission",
      });
    }
    if (env.MONITORING_ENABLED && env.TRENDSFAST_SURFACE !== "public") {
      context.addIssue({
        code: "custom",
        path: ["TRENDSFAST_SURFACE"],
        message: "The monitoring worker route belongs only on the public deployment surface",
      });
    }
    if (
      env.PAID_MONITORING_ENABLED &&
      env.NODE_ENV === "production" &&
      env.PAID_HOSTING_APPROVED !== "YES"
    ) {
      context.addIssue({
        code: "custom",
        path: ["PAID_HOSTING_APPROVED"],
        message: "Production monitoring requires exact approval of the commercial hosting plan",
      });
    }
    if (
      env.PAID_MONITORING_ENABLED &&
      env.NODE_ENV === "production" &&
      (!env.OPS_ALERT_WEBHOOK_URL || !env.OPS_ALERT_WEBHOOK_SECRET)
    ) {
      context.addIssue({
        code: "custom",
        path: ["OPS_ALERT_WEBHOOK_URL"],
        message: "Production monitoring requires the signed operations alert webhook pair",
      });
    }
    if (
      env.PAID_MONITORING_ENABLED &&
      env.PROVIDER_CREDENTIAL_MODE !== "fixture" &&
      !env.PROVIDER_CALLS_ENABLED
    ) {
      context.addIssue({
        code: "custom",
        path: ["PROVIDER_CALLS_ENABLED"],
        message: "Paid live monitoring requires the explicit provider-calls gate",
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
export type TrendsFastSurface = Environment["TRENDSFAST_SURFACE"];

/** Only the exact ops value can expose founder routes; missing/invalid values stay public. */
export function deploymentSurface(
  input: Readonly<Record<string, string | undefined>> = process.env,
): TrendsFastSurface {
  return input.TRENDSFAST_SURFACE === "ops" ? "ops" : "public";
}

/**
 * Paid monitoring is a separate runtime gate. Vercel previews are denied even
 * when production variables are accidentally copied into the preview scope.
 */
export function paidMonitoringRuntimeEnabled(
  env: Environment,
  runtime: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  if (
    !env.BILLING_ENABLED ||
    !env.PAID_MONITORING_ENABLED ||
    !env.MONITORING_ENABLED ||
    env.TRENDSFAST_SURFACE !== "public"
  ) {
    return false;
  }
  if (env.NODE_ENV !== "production") return true;
  if (env.PAID_HOSTING_APPROVED !== "YES") return false;
  if (runtime.VERCEL === "1" && runtime.VERCEL_ENV !== "production") return false;
  if (runtime.VERCEL_ENV && runtime.VERCEL_ENV !== "production") return false;
  return true;
}

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
  if (!env.PROVIDER_CALLS_ENABLED) {
    throw new Error("Provider calls are disabled by the deployment policy");
  }
  const resolve = (value: number | undefined, label: string): number => {
    if (value !== undefined) return value;
    throw new Error(`${label} is required by the validated live cost policy`);
  };
  return {
    xaiSearchUsd: env.XAI_API_KEY
      ? resolve(env.XAI_ESTIMATED_COST_USD_PER_SEARCH, "X Search cost")
      : 0,
    dataForSeoTaskUsd: resolve(env.DATAFORSEO_ESTIMATED_COST_USD_PER_TASK, "DataForSEO task cost"),
    tavilyCreditUsd: env.TAVILY_API_KEY
      ? resolve(env.TAVILY_ESTIMATED_COST_USD_PER_CREDIT, "Tavily credit cost")
      : 0,
    youtubeQuotaUnitUsd: env.YOUTUBE_API_KEY
      ? resolve(env.YOUTUBE_INTERNAL_QUOTA_VALUE_USD, "YouTube quota value")
      : 0,
    llmInputUsdPerMillionTokens: resolve(
      env.LLM_INPUT_PRICE_USD_PER_MILLION_TOKENS,
      "Model input price",
    ),
    llmOutputUsdPerMillionTokens: resolve(
      env.LLM_OUTPUT_PRICE_USD_PER_MILLION_TOKENS,
      "Model output price",
    ),
    maximumProviderCostUsdPerScan: resolve(
      env.MAX_PROVIDER_COST_USD_PER_SCAN,
      "Per-scan provider cost ceiling",
    ),
    apiProviderCostLimitUsdPerHour: resolve(
      env.API_PROVIDER_COST_LIMIT_USD_PER_HOUR,
      "API rolling-hour provider cost limit",
    ),
  };
}

export type PublicScanAdmissionPolicy = {
  dailyLimit: number;
  globalDailyLimit: number;
  globalDailyBudgetUsd: number;
};

/** Runtime admission is unavailable until the operator supplies private policy. */
export function resolvePublicScanAdmissionPolicy(env: Environment): PublicScanAdmissionPolicy {
  if (env.PROVIDER_CREDENTIAL_MODE !== "fixture" && !env.PROVIDER_CALLS_ENABLED) {
    throw new Error("Provider calls are disabled by the deployment policy");
  }
  if (
    env.PUBLIC_SCAN_DAILY_LIMIT === undefined ||
    env.PUBLIC_SCAN_GLOBAL_DAILY_LIMIT === undefined ||
    env.PUBLIC_SCAN_GLOBAL_DAILY_BUDGET_USD === undefined
  ) {
    throw new Error("Public scan admission requires the private operating policy");
  }
  return {
    dailyLimit: env.PUBLIC_SCAN_DAILY_LIMIT,
    globalDailyLimit: env.PUBLIC_SCAN_GLOBAL_DAILY_LIMIT,
    globalDailyBudgetUsd: env.PUBLIC_SCAN_GLOBAL_DAILY_BUDGET_USD,
  };
}

export function resolveApiRateLimit(
  env: Environment,
  field:
    | "API_CREATE_RATE_LIMIT_PER_HOUR"
    | "API_STATUS_RATE_LIMIT_PER_HOUR"
    | "API_AUTH_FAILURE_LIMIT_PER_HOUR",
): number {
  const configured = env[field];
  if (configured !== undefined) return configured;
  throw new Error(`${field} is required by the private operating policy`);
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
