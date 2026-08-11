import type { ProviderAdapter } from "./types";
import { SignalSchema } from "@trendsfast/schemas";

import type { ProviderRunResult } from "./types";

export function assertProviderContract(adapter: ProviderAdapter): string[] {
  const errors: string[] = [];
  const metadata = adapter.metadata;
  if (!metadata.slug) errors.push("provider slug is required");
  if (!metadata.publicName.trim()) errors.push("public name is required");
  if (metadata.capabilities.length === 0) errors.push("at least one capability is required");
  if (metadata.timeoutMs < 1 || metadata.timeoutMs > 60_000) {
    errors.push("timeout must be between 1ms and 60s");
  }
  if (metadata.retryPolicy.maxAttempts < 1 || metadata.retryPolicy.maxAttempts > 3) {
    errors.push("retry maxAttempts must be between 1 and 3");
  }
  if (metadata.maxCallsPerScan < 0 || metadata.maxCallsPerScan > 5) {
    errors.push("max calls must be between 0 and 5");
  }
  if (metadata.maxResultsPerScan < 1 || metadata.maxResultsPerScan > 30) {
    errors.push("max results must be between 1 and 30");
  }
  if (
    new Set(metadata.requiredEnvironmentVariables).size !==
    metadata.requiredEnvironmentVariables.length
  ) {
    errors.push("required environment variables must be unique");
  }
  return errors;
}

export function validateProviderRunResult(
  adapter: ProviderAdapter,
  result: ProviderRunResult,
): string[] {
  const errors: string[] = [];
  if (result.provider !== adapter.metadata.slug)
    errors.push("result provider does not match adapter");
  if (result.calls > adapter.metadata.maxCallsPerScan)
    errors.push("result exceeds provider call cap");
  if (result.signals.length > adapter.metadata.maxResultsPerScan)
    errors.push("result exceeds signal cap");
  if (!Number.isFinite(result.cost.estimatedUsd) || result.cost.estimatedUsd < 0) {
    errors.push("estimated cost must be a non-negative finite number");
  }
  if (
    result.cost.actualUsd !== undefined &&
    (!Number.isFinite(result.cost.actualUsd) || result.cost.actualUsd < 0)
  ) {
    errors.push("actual cost must be a non-negative finite number when known");
  }
  if (!Number.isFinite(result.quota.used) || result.quota.used < 0) {
    errors.push("quota use must be a non-negative finite number");
  }
  for (const signal of result.signals) {
    const parsed = SignalSchema.safeParse(signal);
    if (!parsed.success) errors.push(`${signal.id}: canonical signal schema validation failed`);
  }
  for (const measurement of result.measurements) {
    if (measurement.kind !== "EXTERNAL_TIME_SERIES" || measurement.points.length < 2) {
      errors.push(`${measurement.id}: external series must contain at least two points`);
    }
  }
  return errors;
}
