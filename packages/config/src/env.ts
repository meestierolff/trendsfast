import { z } from "zod";

const DEFAULT_DATABASE_URL = "postgresql://trendsfast:trendsfast_local@localhost:54329/trendsfast";

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
const BooleanSchema = (defaultValue: boolean) =>
  z.preprocess((value) => {
    if (value === undefined || value === "") return defaultValue;
    if (typeof value === "string") {
      if (value.toLowerCase() === "true") return true;
      if (value.toLowerCase() === "false") return false;
    }
    return value;
  }, z.boolean());

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
      defaultValue: 20,
      min: 1,
      max: 10_000,
      integer: true,
    }),

    PROVIDER_CREDENTIAL_MODE: ProviderCredentialModeSchema.default("fixture"),

    XAI_API_KEY: OptionalSecretSchema,
    XAI_MODEL: OptionalTextSchema,
    XAI_MAX_TOOL_CALLS_PER_SCAN: NumberSchema({
      defaultValue: 2,
      min: 0,
      max: 2,
      integer: true,
    }),

    DATAFORSEO_LOGIN: OptionalTextSchema,
    DATAFORSEO_PASSWORD: OptionalSecretSchema,
    DATAFORSEO_GOOGLE_TRENDS_MODE: z.enum(["live", "standard"]).default("live"),

    TAVILY_API_KEY: OptionalSecretSchema,
    TAVILY_MAX_CREDITS_PER_SCAN: NumberSchema({
      defaultValue: 2,
      min: 0,
      max: 2,
      integer: true,
    }),

    YOUTUBE_API_KEY: OptionalSecretSchema,
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

    MAX_PROVIDER_COST_USD_PER_SCAN: NumberSchema({
      defaultValue: 0.25,
      min: 0.01,
      max: 10,
    }),
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
    STRIPE_MODE: z.enum(["test", "live"]).default("test"),
    STRIPE_SECRET_KEY: OptionalSecretSchema,
    STRIPE_WEBHOOK_SECRET: OptionalSecretSchema,
    STRIPE_FOUNDER_CLOUD_PRICE_ID: OptionalTextSchema,

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
      if (env.LLM_INPUT_PRICE_USD_PER_MILLION_TOKENS === undefined) {
        context.addIssue({
          code: "custom",
          path: ["LLM_INPUT_PRICE_USD_PER_MILLION_TOKENS"],
          message: "Live credential modes require explicit model input pricing",
        });
      }
      if (env.LLM_OUTPUT_PRICE_USD_PER_MILLION_TOKENS === undefined) {
        context.addIssue({
          code: "custom",
          path: ["LLM_OUTPUT_PRICE_USD_PER_MILLION_TOKENS"],
          message: "Live credential modes require explicit model output pricing",
        });
      }
      if (!env.DATAFORSEO_LOGIN || !env.DATAFORSEO_PASSWORD) {
        context.addIssue({
          code: "custom",
          path: ["DATAFORSEO_LOGIN"],
          message: "Live credential modes require Google Trends credentials",
        });
      }
      if (!env.XAI_API_KEY && !env.TAVILY_API_KEY) {
        context.addIssue({
          code: "custom",
          path: ["TAVILY_API_KEY"],
          message: "Live credential modes require at least X or Tavily coverage",
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
      if (!env.STRIPE_SECRET_KEY || !env.STRIPE_WEBHOOK_SECRET) {
        context.addIssue({
          code: "custom",
          path: ["STRIPE_SECRET_KEY"],
          message: "Billing requires both Stripe server-side secrets",
        });
      }
      if (!env.STRIPE_FOUNDER_CLOUD_PRICE_ID) {
        context.addIssue({
          code: "custom",
          path: ["STRIPE_FOUNDER_CLOUD_PRICE_ID"],
          message: "Billing requires an explicit Stripe price ID",
        });
      }
      if (env.STRIPE_MODE === "live" && env.NODE_ENV !== "production") {
        context.addIssue({
          code: "custom",
          path: ["STRIPE_MODE"],
          message: "Live Stripe mode is accepted only in production",
        });
      }
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
