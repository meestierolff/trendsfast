import type {
  CanonicalSignal,
  ProviderExecutionContext,
  ProviderMeasurement,
  ProviderRunResult,
  ProviderSlug,
} from "../types";
import { ProviderError } from "../executor";

export async function fetchJson(
  context: ProviderExecutionContext,
  url: string | URL,
  init: RequestInit,
  timeoutMs: number,
): Promise<{ data: unknown; response: Response }> {
  const controller = new AbortController();
  const inheritedSignals = [context.abortSignal, init.signal].filter(
    (signal): signal is AbortSignal => signal !== undefined && signal !== null,
  );
  const abortFromParent = (): void => controller.abort();
  for (const signal of inheritedSignals) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", abortFromParent, { once: true });
  }
  const remainingDeadlineMs = context.deadline
    ? context.deadline.getTime() - context.now().getTime()
    : Number.POSITIVE_INFINITY;
  const effectiveTimeoutMs = Math.min(timeoutMs, remainingDeadlineMs);
  if (effectiveTimeoutMs <= 0 || controller.signal.aborted) {
    for (const signal of inheritedSignals) {
      signal.removeEventListener("abort", abortFromParent);
    }
    throw new ProviderError("Provider request deadline was exhausted", {
      code: "PROVIDER_DEADLINE_EXCEEDED",
      retryable: false,
    });
  }
  const timeout = setTimeout(() => controller.abort(), Math.max(1, effectiveTimeoutMs));
  try {
    const response = await context.fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      throw new ProviderError(`Upstream returned HTTP ${response.status}`, {
        code: `UPSTREAM_HTTP_${response.status}`,
        retryable: response.status === 408 || response.status === 429 || response.status >= 500,
      });
    }
    let data: unknown;
    try {
      data = await response.json();
    } catch (error) {
      throw new ProviderError("Upstream returned invalid JSON", {
        code: "UPSTREAM_INVALID_JSON",
        retryable: false,
        cause: error,
      });
    }
    return { data, response };
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    if (controller.signal.aborted) {
      throw new ProviderError("Provider request timed out", {
        code: "PROVIDER_TIMEOUT",
        retryable: true,
        cause: error,
      });
    }
    throw new ProviderError("Provider network request failed", {
      code: "PROVIDER_NETWORK_ERROR",
      retryable: true,
      cause: error,
    });
  } finally {
    clearTimeout(timeout);
    for (const signal of inheritedSignals) {
      signal.removeEventListener("abort", abortFromParent);
    }
  }
}

export function providerResult(input: {
  provider: ProviderSlug;
  status?: ProviderRunResult["status"];
  signals?: CanonicalSignal[];
  measurements?: ProviderMeasurement[];
  calls: number;
  quotaUsed: number;
  quotaLimit?: number;
  quotaBreakdown?: Record<string, number>;
  estimatedUsd: number;
  actualUsd?: number;
  startedAt: string;
  finishedAt: string;
  limitations?: string[];
  errors?: ProviderRunResult["errors"];
}): ProviderRunResult {
  return {
    provider: input.provider,
    status: input.status ?? "SUCCESS",
    signals: input.signals ?? [],
    measurements: input.measurements ?? [],
    calls: input.calls,
    quota: {
      used: input.quotaUsed,
      ...(input.quotaLimit === undefined ? {} : { limit: input.quotaLimit }),
      ...(input.quotaBreakdown === undefined ? {} : { breakdown: input.quotaBreakdown }),
    },
    cost: {
      estimatedUsd: input.estimatedUsd,
      ...(input.actualUsd === undefined ? {} : { actualUsd: input.actualUsd }),
    },
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    limitations: input.limitations ?? [],
    errors: input.errors ?? [],
  };
}

export function unconfiguredResult(
  provider: ProviderSlug,
  requiredEnvironmentVariables: string[],
  context: ProviderExecutionContext,
  estimatedUsd = 0,
): ProviderRunResult {
  const timestamp = context.now().toISOString();
  return providerResult({
    provider,
    status: "UNAVAILABLE",
    calls: 0,
    quotaUsed: 0,
    estimatedUsd,
    actualUsd: 0,
    startedAt: timestamp,
    finishedAt: timestamp,
    limitations: [
      `${provider} coverage unavailable: required server-side credentials are not configured.`,
    ],
    errors: [
      {
        code: "PROVIDER_UNCONFIGURED",
        message: `Missing required environment variables: ${requiredEnvironmentVariables.join(", ")}`,
        retryable: false,
      },
    ],
  });
}

export function elapsedMilliseconds(startedAt: number, context: ProviderExecutionContext): number {
  return Math.max(0, context.now().getTime() - startedAt);
}

export function numericEnvironment(
  context: ProviderExecutionContext,
  name: string,
  fallback: number,
): number {
  const value = Number(context.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

export function requiredNonnegativeEnvironment(
  context: ProviderExecutionContext,
  name: string,
): number {
  const raw = context.env[name]?.trim();
  const value = raw === undefined || raw === "" ? Number.NaN : Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new ProviderError(`${name} is required for live cost admission`, {
      code: "PROVIDER_COST_CONFIGURATION_MISSING",
      retryable: false,
    });
  }
  return value;
}

export function boundedIntegerEnvironment(
  context: ProviderExecutionContext,
  name: string,
  fallback: number,
  hardMaximum: number,
): number {
  return Math.min(
    hardMaximum,
    Math.max(0, Math.trunc(numericEnvironment(context, name, fallback))),
  );
}
