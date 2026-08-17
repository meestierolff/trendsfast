import "server-only";

import {
  loadEnv,
  resolveProviderCosts,
  resolvedProviderCostEnvironment,
  type Environment,
} from "@trendsfast/config";
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

import { getWorkerRepositories } from "./server-database";
import { loadProviderExecutionEligibility } from "./provider-execution-eligibility";

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
  const costs = resolveProviderCosts(env);
  const inputUsdPerMillionTokens = costs.llmInputUsdPerMillionTokens;
  const outputUsdPerMillionTokens = costs.llmOutputUsdPerMillionTokens;
  return { provider, inputUsdPerMillionTokens, outputUsdPerMillionTokens };
}

/**
 * The current exact-deployment verification inventory has a source-level xAI
 * record, not a generic model record. Synthesis is therefore eligible only
 * when it uses the exact XAI_MODEL that the verified X adapter executed. An
 * OpenAI model or a distinct LLM_MODEL stays deterministic-only until it gets
 * its own exact-deployment readback contract.
 */
export function synthesisModelIsProductionVerified(
  env: Environment,
  providerEligibility: ReadonlyMap<ProviderSlug, { eligible: boolean }>,
): boolean {
  if (env.PROVIDER_CREDENTIAL_MODE === "fixture") return true;
  if (env.LLM_PROVIDER !== "xai") return false;
  const verifiedXModel = env.XAI_MODEL?.trim();
  const synthesisModel = (env.LLM_MODEL ?? env.XAI_MODEL)?.trim();
  return Boolean(
    verifiedXModel &&
    synthesisModel &&
    synthesisModel === verifiedXModel &&
    providerEligibility.get("x")?.eligible === true,
  );
}

async function unavailableLiveContextInference(): Promise<never> {
  throw new Error("SYNTHESIS_MODEL_NOT_PRODUCTION_VERIFIED");
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
  const fixture = env.PROVIDER_CREDENTIAL_MODE === "fixture";
  if (!fixture && !env.PROVIDER_CALLS_ENABLED) {
    throw new Error("PROVIDER_CALLS_NOT_ENABLED");
  }
  const repositories = getWorkerRepositories();
  if (!fixture) {
    if (!env.MANAGED_POLICY_REVISION) {
      throw new Error("MANAGED_POLICY_REVISION_REQUIRED");
    }
    await repositories.operations.assertManagedPolicyRevision(env.MANAGED_POLICY_REVISION);
  }
  const providerContext = createProviderContext({
    credentialMode: env.PROVIDER_CREDENTIAL_MODE,
    env: { ...process.env, ...resolvedProviderCostEnvironment(env) },
  });
  const providerRegistry = boundedProviderRegistry(env);
  const providerEligibility = await loadProviderExecutionEligibility({
    env,
    context: providerContext,
    registry: providerRegistry,
  });
  const modelVerified = synthesisModelIsProductionVerified(env, providerEligibility);
  const client = fixture || !modelVerified ? null : createConfiguredModelClient(env);
  const result = await processScan(publicId, {
    store: createDatabaseProcessingStore(repositories, {
      // Historical rows carry no exact-deployment verification identity. Live
      // decisions therefore use only current-run succeeded evidence until that
      // provenance can be represented durably.
      includeHistoricalMetricSnapshots: fixture,
    }),
    inferContext: fixture
      ? inferFixtureProjectContext
      : client
        ? createModelContextInferer(client)
        : unavailableLiveContextInference,
    planQueries(context, options) {
      return buildQueryPlan(projectContextToProductQueryContext(context), options);
    },
    providers: createProviderRunner({
      registry: providerRegistry,
      context: providerContext,
      eligibility: providerEligibility,
    }),
    decide: client ? createModelAssistedDecision(client) : decideDeterministically,
    maxCostUsd: resolveProviderCosts(env).maximumProviderCostUsdPerScan,
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
      },
    })
    .catch((error) => {
      logger.warn("scan_analytics_write_failed", {
        reason: error instanceof Error ? error.message : "unknown",
      });
    });
  return result;
}
