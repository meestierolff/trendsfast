import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { loadEnv, resolveProviderCosts, resolvedProviderCostEnvironment } from "@trendsfast/config";
import {
  createProviderContext,
  createProviderRegistry,
  verifyProviderReadback,
  type ProviderQueryRole,
  type ProviderSlug,
} from "@trendsfast/providers";

import { getOpsRepositories } from "./server-database";
import { deploymentProvenance } from "./deployment-provenance";

const queryRoles: Record<Exclude<ProviderSlug, "website" | "manual">, ProviderQueryRole> = {
  google_trends: "search_demand",
  hacker_news: "developer_pain",
  github: "repository_adoption",
  x: "current_narrative",
  tavily: "news_trigger",
  youtube: "video_traction",
};

export async function runConfiguredProviderVerification(input: {
  attemptId: string;
  provider: Exclude<ProviderSlug, "manual">;
  initiatedBy: string;
  productUrl?: string;
  query?: string;
  market?: string;
  language?: string;
}) {
  const env = loadEnv();
  if (env.PROVIDER_CREDENTIAL_MODE !== "fixture" && !env.PROVIDER_CALLS_ENABLED) {
    throw new Error("PROVIDER_CALLS_NOT_ENABLED");
  }
  const adapter = createProviderRegistry(env.PROVIDER_CREDENTIAL_MODE).get(input.provider);
  if (!adapter) throw new Error("Provider adapter is not registered");
  const startedAt = new Date();
  const repository = getOpsRepositories().providerVerifications;
  const currentDeployment = deploymentProvenance();
  const deployment =
    currentDeployment.deploymentEnvironment === "production"
      ? {
          ...currentDeployment,
          deploymentHost: env.PUBLIC_DEPLOYMENT_HOST ?? null,
          deploymentId: env.PUBLIC_DEPLOYMENT_ID ?? null,
        }
      : currentDeployment;
  if (
    deployment.deploymentEnvironment === "production" &&
    (!deployment.releaseSha || !deployment.deploymentHost || !deployment.deploymentId)
  ) {
    throw new Error("PROVIDER_VERIFICATION_PUBLIC_TARGET_NOT_CONFIGURED");
  }
  const request =
    input.provider === "website"
      ? input.productUrl
        ? {
            scanId: `verification_${randomUUID()}`,
            productUrl: input.productUrl,
            queries: [
              {
                id: `verification_${randomUUID()}`,
                provider: "website" as const,
                role: "product_context" as const,
                query: input.productUrl,
                limit: 1,
              },
            ],
          }
        : undefined
      : input.query
        ? {
            scanId: `verification_${randomUUID()}`,
            ...(input.productUrl ? { productUrl: input.productUrl } : {}),
            queries: [
              {
                id: `verification_${randomUUID()}`,
                provider: input.provider,
                role: queryRoles[input.provider],
                query: input.query,
                limit: Math.min(3, adapter.metadata.maxResultsPerScan),
                ...(input.market ? { market: input.market } : {}),
                ...(input.language ? { language: input.language } : {}),
              },
            ],
          }
        : undefined;
  const context = createProviderContext({
    credentialMode: env.PROVIDER_CREDENTIAL_MODE,
    env: { ...process.env, ...resolvedProviderCostEnvironment(env) },
  });
  const costs = resolveProviderCosts(env);
  const providerEstimate = request
    ? adapter.estimate(request, context)
    : { estimatedUsd: 0, calls: 0, quotaUnits: 0 };
  const hasCredentials = adapter.metadata.requiredEnvironmentVariables.every((name) =>
    context.env[name]?.trim(),
  );
  const healthCheckEstimatedCostUsd =
    input.provider === "youtube" && hasCredentials ? costs.youtubeQuotaUnitUsd : 0;
  const healthCheckQuotaUnits = input.provider === "youtube" && hasCredentials ? 1 : 0;
  const maximumCostUsd = costs.maximumProviderCostUsdPerScan;
  const maximumCollectReservationUsd =
    providerEstimate.estimatedUsd * Math.max(1, adapter.metadata.retryPolicy.maxAttempts);
  const estimatedCostReservationUsd = healthCheckEstimatedCostUsd + maximumCollectReservationUsd;
  const requestHash = createHash("sha256")
    .update(
      JSON.stringify({
        provider: input.provider,
        productUrl: input.productUrl ?? null,
        query: input.query ?? null,
        market: input.market ?? null,
        language: input.language ?? null,
      }),
    )
    .digest("hex");
  const admission = await repository.admitAttempt({
    attemptId: input.attemptId,
    requestHash,
    source: input.provider,
    provider: adapter.metadata.publicName,
    credentialMode: env.PROVIDER_CREDENTIAL_MODE,
    ...deployment,
    initiatedBy: input.initiatedBy,
    estimatedCostReservationUsd,
    maximumCostUsd,
    startedAt,
  });
  if (!admission.admitted) {
    return { ...admission.record, reused: !admission.created };
  }

  try {
    const result = await verifyProviderReadback({
      adapter,
      context,
      ...(request ? { request } : {}),
      maximumCostUsd,
      healthCheckEstimatedCostUsd,
      healthCheckQuotaUnits,
      deadline: new Date(startedAt.getTime() + Math.min(60_000, env.PROVIDER_TIMEOUT_MS * 2)),
    });
    const record = await repository.complete({
      id: admission.record.id,
      state: result.state,
      healthStatus: result.healthStatus,
      readbackVerified: result.readbackVerified,
      canonicalUrls: result.canonicalUrls,
      ...(result.latencyMs === undefined ? {} : { latencyMs: result.latencyMs }),
      estimatedCostUsd: result.estimatedCostUsd,
      ...(result.actualCostUsd === undefined ? {} : { actualCostUsd: result.actualCostUsd }),
      quotaUsed: result.quotaUsed,
      limitations: result.limitations,
      ...(result.failureCode === undefined ? {} : { failureCode: result.failureCode }),
      ...(result.failureMessage === undefined ? {} : { failureMessage: result.failureMessage }),
      checkedAt: new Date(result.checkedAt),
    });
    return { ...record, reused: false };
  } catch (error) {
    const record = await repository.complete({
      id: admission.record.id,
      state: "FAILED",
      healthStatus: "FAILED",
      readbackVerified: false,
      failureCode: "VERIFICATION_RUN_FAILED",
      failureMessage:
        error instanceof Error ? error.message : "Provider verification failed unexpectedly.",
      limitations: [
        "The bounded provider verification did not complete. Its conservative pre-call reservation remains unsettled because external usage may be unknown.",
      ],
    });
    return { ...record, reused: false };
  }
}
