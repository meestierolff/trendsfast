import "server-only";

import { randomUUID } from "node:crypto";

import { loadEnv } from "@trendsfast/config";
import {
  createProviderContext,
  createProviderRegistry,
  verifyProviderReadback,
  type ProviderQueryRole,
  type ProviderSlug,
} from "@trendsfast/providers";

import { getRepositories } from "./server-database";
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
  provider: Exclude<ProviderSlug, "manual">;
  initiatedBy: string;
  productUrl?: string;
  query?: string;
  market?: string;
  language?: string;
}) {
  const env = loadEnv();
  const adapter = createProviderRegistry(env.PROVIDER_CREDENTIAL_MODE).get(input.provider);
  if (!adapter) throw new Error("Provider adapter is not registered");
  const startedAt = new Date();
  const repository = getRepositories().providerVerifications;
  const deployment = deploymentProvenance();
  const durable = await repository.begin({
    source: input.provider,
    provider: adapter.metadata.publicName,
    credentialMode: env.PROVIDER_CREDENTIAL_MODE,
    ...deployment,
    initiatedBy: input.initiatedBy,
    startedAt,
  });
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
  try {
    const result = await verifyProviderReadback({
      adapter,
      context: createProviderContext({
        credentialMode: env.PROVIDER_CREDENTIAL_MODE,
        env: process.env,
      }),
      ...(request ? { request } : {}),
      maximumCostUsd: env.MAX_PROVIDER_COST_USD_PER_SCAN,
      deadline: new Date(startedAt.getTime() + Math.min(60_000, env.PROVIDER_TIMEOUT_MS * 2)),
    });
    return repository.complete({
      id: durable.id,
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
  } catch (error) {
    await repository.complete({
      id: durable.id,
      state: "FAILED",
      healthStatus: "FAILED",
      readbackVerified: false,
      failureCode: "VERIFICATION_RUN_FAILED",
      failureMessage:
        error instanceof Error ? error.message : "Provider verification failed unexpectedly.",
      limitations: ["The bounded provider verification did not complete."],
    });
    throw error;
  }
}
