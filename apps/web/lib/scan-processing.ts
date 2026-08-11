import "server-only";

import { loadEnv, type Environment } from "@trendsfast/config";
import { createLogger } from "@trendsfast/observability";
import {
  buildQueryPlan,
  createProviderContext,
  createProviderRegistry,
  projectContextToProductQueryContext,
  type ProviderAdapter,
  type ProviderSlug,
} from "@trendsfast/providers";
import {
  createDatabaseProcessingStore,
  createModelAssistedDecision,
  createModelContextInferer,
  createOpenAiCompatibleModelClient,
  createProviderRunner,
  decideDeterministically,
  inferFixtureProjectContext,
  processScan,
  type ModelClient,
} from "@trendsfast/orchestration";

import { getRepositories } from "./server-database";

const logger = createLogger({});

function boundedProviderRegistry(env: Environment) {
  const registry = createProviderRegistry(env.PROVIDER_CREDENTIAL_MODE);
  return new Map(
    [...registry].map(([slug, adapter]): [ProviderSlug, ProviderAdapter] => [
      slug,
      {
        ...adapter,
        metadata: {
          ...adapter.metadata,
          timeoutMs: Math.min(adapter.metadata.timeoutMs, env.PROVIDER_TIMEOUT_MS),
        },
      },
    ]),
  );
}

function modelPricing(env: Environment, provider: "xai" | "openai") {
  const inputUsdPerMillionTokens = env.LLM_INPUT_PRICE_USD_PER_MILLION_TOKENS;
  const outputUsdPerMillionTokens = env.LLM_OUTPUT_PRICE_USD_PER_MILLION_TOKENS;
  if (inputUsdPerMillionTokens === undefined || outputUsdPerMillionTokens === undefined) {
    throw new Error("Live model input and output pricing is not fully configured");
  }
  return { provider, inputUsdPerMillionTokens, outputUsdPerMillionTokens };
}

export function createConfiguredModelClient(
  env: Environment,
  options: { fetch?: typeof fetch } = {},
): ModelClient {
  if (env.LLM_PROVIDER === "xai") {
    const model = env.LLM_MODEL ?? env.XAI_MODEL;
    if (!env.XAI_API_KEY || !model) {
      throw new Error("xAI synthesis is not fully configured");
    }
    return createOpenAiCompatibleModelClient({
      apiKey: env.XAI_API_KEY,
      model,
      baseUrl: "https://api.x.ai/v1",
      timeoutMs: Math.min(60_000, env.MAX_SCAN_DURATION_SECONDS * 1_000),
      pricing: modelPricing(env, "xai"),
      ...(options.fetch ? { fetch: options.fetch } : {}),
    });
  }
  if (!env.OPENAI_API_KEY || !env.LLM_MODEL) {
    throw new Error("OpenAI synthesis is not fully configured");
  }
  return createOpenAiCompatibleModelClient({
    apiKey: env.OPENAI_API_KEY,
    model: env.LLM_MODEL,
    baseUrl: "https://api.openai.com/v1",
    timeoutMs: Math.min(60_000, env.MAX_SCAN_DURATION_SECONDS * 1_000),
    pricing: modelPricing(env, "openai"),
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
}

export async function runPersistedScan(publicId: string) {
  const env = loadEnv();
  const repositories = getRepositories();
  const fixture = env.PROVIDER_CREDENTIAL_MODE === "fixture";
  const client = fixture ? null : createConfiguredModelClient(env);
  const providerContext = createProviderContext({
    credentialMode: env.PROVIDER_CREDENTIAL_MODE,
    env: process.env,
  });
  const result = await processScan(publicId, {
    store: createDatabaseProcessingStore(repositories),
    inferContext: fixture ? inferFixtureProjectContext : createModelContextInferer(client!),
    planQueries(context, options) {
      return buildQueryPlan(projectContextToProductQueryContext(context), options);
    },
    providers: createProviderRunner({
      registry: boundedProviderRegistry(env),
      context: providerContext,
    }),
    decide: fixture ? decideDeterministically : createModelAssistedDecision(client!),
    maxCostUsd: env.MAX_PROVIDER_COST_USD_PER_SCAN,
    maxDurationMs: env.MAX_SCAN_DURATION_SECONDS * 1_000,
  }).catch((error) => {
    logger.error("scan_processing_failed", error);
    throw error;
  });

  await repositories.analytics
    .append({
      name: result.state === "REVIEW_REQUIRED" ? "scan_review_required" : "scan_processing_started",
      scanRequestId: result.requestId,
      ...(result.nextMoveId ? { nextMoveId: result.nextMoveId } : {}),
      properties: {
        state: result.state,
        credentialMode: env.PROVIDER_CREDENTIAL_MODE,
        costUsd: result.costUsd,
      },
    })
    .catch((error) => {
      logger.warn("scan_analytics_write_failed", {
        reason: error instanceof Error ? error.message : "unknown",
      });
    });
  return result;
}
