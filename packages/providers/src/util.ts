import { createHash } from "node:crypto";

import type { CanonicalSignal, SignalMetrics } from "./types";

export function stableHash(value: string, length = 20): string {
  return createHash("sha256").update(value).digest("hex").slice(0, length);
}

export function stableId(prefix: string, value: string): string {
  return `${prefix}_${stableHash(value)}`;
}

export function hashPayload(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function clampInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, Math.trunc(value)));
}

export function cleanText(value: unknown, maxLength = 2_000): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text ? text.slice(0, maxLength) : undefined;
}

export function finiteMetric(value: unknown): number | undefined {
  const number = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof number === "number" && Number.isFinite(number) && number >= 0 ? number : undefined;
}

/** xAI reports billed cost in integer ticks, where 10^10 ticks equal one USD. */
export const USD_TICKS_PER_USD = 10_000_000_000;

export function usdTicksToUsd(value: unknown): number | undefined {
  const ticks =
    typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value.trim()) : value;
  return typeof ticks === "number" && Number.isSafeInteger(ticks) && ticks >= 0
    ? ticks / USD_TICKS_PER_USD
    : undefined;
}

export function compactMetrics(
  metrics: Partial<Record<keyof SignalMetrics, number | undefined>>,
): SignalMetrics {
  return Object.fromEntries(
    Object.entries(metrics).filter((entry): entry is [string, number] => entry[1] !== undefined),
  );
}

export function safeIsoDate(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

export function canonicalSignalKey(signal: Pick<CanonicalSignal, "source" | "sourceId">): string {
  return `${signal.source}:${signal.sourceId}`;
}

export function queryString(parts: Array<string | undefined>, maxLength = 180): string {
  return parts
    .map((part) => cleanText(part, maxLength))
    .filter((part): part is string => Boolean(part))
    .join(" ")
    .slice(0, maxLength)
    .trim();
}

export function redactProviderError(error: unknown): string {
  if (!(error instanceof Error)) return "Provider request failed";
  return error.message
    .replace(/(api[_-]?key|authorization|token|password|secret)=?\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/gi, "Bearer [REDACTED]")
    .slice(0, 500);
}
