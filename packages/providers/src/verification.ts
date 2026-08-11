import { redactSecrets } from "@trendsfast/core";

import { ProviderBudget, ProviderCircuitBreaker, executeProvider } from "./executor";
import { hasRequiredCredentials } from "./runtime";
import type {
  ProviderAdapter,
  ProviderExecutionContext,
  ProviderHealthStatus,
  ProviderRunRequest,
  ProviderSlug,
} from "./types";

export type ProviderReadbackVerification = {
  source: ProviderSlug;
  provider: string;
  state: "VERIFIED" | "DEGRADED" | "FAILED" | "UNCONFIGURED" | "FIXTURE";
  credentialMode: ProviderExecutionContext["credentialMode"];
  healthStatus: ProviderHealthStatus;
  readbackVerified: boolean;
  canonicalUrls: string[];
  latencyMs?: number;
  estimatedCostUsd: number;
  actualCostUsd?: number;
  quotaUsed: number;
  limitations: string[];
  failureCode?: string;
  failureMessage?: string;
  checkedAt: string;
};

const SECRET_QUERY_PARAMETER =
  /(^|[_-])(api[_-]?key|access[_-]?token|token|secret|password|signature|sig|credential|authorization|auth)($|[_-])/i;

function safeCanonicalUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) {
      return null;
    }
    url.hash = "";
    for (const [name, parameterValue] of [...url.searchParams.entries()]) {
      if (SECRET_QUERY_PARAMETER.test(name) || redactSecrets(parameterValue) !== parameterValue) {
        url.searchParams.delete(name);
      }
    }
    return url.href.length <= 2_048 ? url.href : null;
  } catch {
    return null;
  }
}

function base(
  adapter: ProviderAdapter,
  context: ProviderExecutionContext,
): Pick<ProviderReadbackVerification, "source" | "provider" | "credentialMode" | "checkedAt"> {
  return {
    source: adapter.metadata.slug,
    provider: adapter.metadata.publicName,
    credentialMode: context.credentialMode,
    checkedAt: context.now().toISOString(),
  };
}

/**
 * Health and source read-back are intentionally separate. A fixture or a
 * healthy credential probe can never produce VERIFIED without a bounded
 * adapter result containing at least one canonical original URL.
 */
export async function verifyProviderReadback(input: {
  adapter: ProviderAdapter;
  context: ProviderExecutionContext;
  request?: ProviderRunRequest;
  maximumCostUsd: number;
  deadline: Date;
  circuitBreaker?: ProviderCircuitBreaker;
}): Promise<ProviderReadbackVerification> {
  const { adapter, context } = input;
  if (context.credentialMode === "fixture") {
    return {
      ...base(adapter, context),
      state: "FIXTURE",
      healthStatus: "HEALTHY",
      readbackVerified: false,
      canonicalUrls: [],
      estimatedCostUsd: 0,
      actualCostUsd: 0,
      quotaUsed: 0,
      limitations: ["Example data is available, but no deployed provider read-back was made."],
    };
  }
  if (!hasRequiredCredentials(adapter.metadata.requiredEnvironmentVariables, context)) {
    return {
      ...base(adapter, context),
      state: "UNCONFIGURED",
      healthStatus: "UNCONFIGURED",
      readbackVerified: false,
      canonicalUrls: [],
      estimatedCostUsd: 0,
      actualCostUsd: 0,
      quotaUsed: 0,
      limitations: ["Required server-side provider credentials are not configured."],
      failureCode: "PROVIDER_UNCONFIGURED",
      failureMessage: "Required server-side provider credentials are not configured.",
    };
  }

  const health = await adapter.healthCheck(context);
  if (health.status === "FAILED" || health.status === "UNCONFIGURED") {
    return {
      ...base(adapter, context),
      state: health.status === "UNCONFIGURED" ? "UNCONFIGURED" : "FAILED",
      healthStatus: health.status,
      readbackVerified: false,
      canonicalUrls: [],
      ...(health.latencyMs === undefined ? {} : { latencyMs: health.latencyMs }),
      estimatedCostUsd: 0,
      actualCostUsd: 0,
      quotaUsed: 0,
      limitations: [health.message ?? "Provider health check failed."],
      failureCode: "PROVIDER_HEALTH_FAILED",
      failureMessage: health.message ?? "Provider health check failed.",
      checkedAt: health.checkedAt,
    };
  }
  if (!input.request) {
    return {
      ...base(adapter, context),
      state: "DEGRADED",
      healthStatus: health.status,
      readbackVerified: false,
      canonicalUrls: [],
      ...(health.latencyMs === undefined ? {} : { latencyMs: health.latencyMs }),
      estimatedCostUsd: 0,
      actualCostUsd: 0,
      quotaUsed: 0,
      limitations: [
        health.message ?? "Provider health check succeeded.",
        "A bounded source read-back is still required before verification.",
      ],
      checkedAt: health.checkedAt,
    };
  }

  const result = await executeProvider(adapter, input.request, {
    context,
    budget: new ProviderBudget(input.maximumCostUsd),
    circuitBreaker: input.circuitBreaker ?? new ProviderCircuitBreaker(),
    deadline: input.deadline,
  });
  const canonicalUrls = [
    ...new Set(
      result.signals
        .map((signal) => safeCanonicalUrl(signal.url))
        .filter((url): url is string => url !== null),
    ),
  ].slice(0, adapter.metadata.maxResultsPerScan);
  const verified =
    health.status === "HEALTHY" && result.status === "SUCCESS" && canonicalUrls.length > 0;
  const firstError = result.errors[0];
  return {
    ...base(adapter, context),
    state: verified ? "VERIFIED" : result.status === "FAILED" ? "FAILED" : "DEGRADED",
    healthStatus: health.status,
    readbackVerified: verified,
    canonicalUrls,
    ...(health.latencyMs === undefined ? {} : { latencyMs: health.latencyMs }),
    estimatedCostUsd: result.cost.estimatedUsd,
    ...(result.cost.actualUsd === undefined ? {} : { actualCostUsd: result.cost.actualUsd }),
    quotaUsed: result.quota.used,
    limitations: [
      ...(health.message ? [health.message] : []),
      ...result.limitations,
      ...(verified
        ? []
        : health.status === "DEGRADED" && canonicalUrls.length > 0
          ? ["The source read-back returned canonical URLs, but provider health was degraded."]
          : ["No canonical original source URL was verified by this read-back."]),
    ],
    ...(firstError?.code ? { failureCode: firstError.code } : {}),
    ...(firstError?.message ? { failureMessage: firstError.message } : {}),
    checkedAt: result.finishedAt,
  };
}
