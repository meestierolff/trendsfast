import { createHash } from "node:crypto";

import {
  AnalyticsEventNameSchema,
  sanitizeAnalyticsDimension,
  sanitizeAnalyticsReferrer,
  sanitizeFirstPartyAnalyticsProperties,
  sanitizePublicAnalyticsPath,
  type AnalyticsEventName,
} from "@trendsfast/schemas";

import type { TrendsFastDatabase } from "../client";
import { analyticsEvents } from "../schema";

const FORBIDDEN_PROPERTY =
  /(email|api.?key|authorization|token|secret|password|evidence.?text|model.?prompt|provider.?payload|product.?url|private.?url|submitted.?url)/i;
const SECRET_VALUE = /tf_(?:test|live)_[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|Bearer\s+/i;
const ATTRIBUTION_KEYS = new Set([
  "ref",
  "source",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "first_landing",
  "landing_path",
]);

/** Stable, non-secret identifier for a server-derived event committed beside
 * its canonical business mutation. Inputs must be internal durable IDs only. */
export function durableAnalyticsDedupeKey(
  event: AnalyticsEventName,
  ...entityIds: string[]
): string {
  AnalyticsEventNameSchema.parse(event);
  if (entityIds.length === 0 || entityIds.some((value) => !/^[A-Za-z0-9:_-]{1,255}$/.test(value))) {
    throw new Error("Durable analytics dedupe identity is invalid");
  }
  return createHash("sha256")
    .update(["durable-analytics-v1", event, ...entityIds].join("\u0000"))
    .digest("hex");
}

const safeAttributionText = (
  value: string | undefined,
  maxLength: number,
  kind: "dimension" | "landing" | "referrer" = "dimension",
) => {
  if (!value || SECRET_VALUE.test(value)) return null;
  if (kind === "landing") return sanitizePublicAnalyticsPath(value).slice(0, maxLength);
  if (kind === "referrer") return sanitizeAnalyticsReferrer(value)?.slice(0, maxLength) ?? null;
  return sanitizeAnalyticsDimension(value, maxLength);
};

export function sanitizeAnalyticsAttribution(
  input: Readonly<Record<string, string>>,
): Record<string, string> {
  const safe: Record<string, string> = {};
  for (const [key, value] of Object.entries(input).slice(0, 20)) {
    if (!ATTRIBUTION_KEYS.has(key) || FORBIDDEN_PROPERTY.test(key) || SECRET_VALUE.test(value)) {
      continue;
    }
    const sanitized = /(path|landing)/i.test(key)
      ? sanitizePublicAnalyticsPath(value)
      : sanitizeAnalyticsDimension(value, 500);
    if (sanitized) safe[key] = sanitized;
  }
  return safe;
}

export function sanitizeAnalyticsProperties(
  input: Readonly<Record<string, unknown>>,
): Record<string, string | number | boolean | null> {
  const safe: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(input).slice(0, 50)) {
    if (FORBIDDEN_PROPERTY.test(key)) continue;
    if (value === null || typeof value === "number" || typeof value === "boolean") {
      safe[key.slice(0, 100)] = value;
    } else if (typeof value === "string" && value.length <= 500 && !SECRET_VALUE.test(value)) {
      safe[key.slice(0, 100)] = value;
    }
  }
  return safe;
}

export function sanitizeAnalyticsEventProperties(
  name: AnalyticsEventName,
  input: Readonly<Record<string, unknown>>,
): Record<string, string | number | boolean | null> {
  return sanitizeFirstPartyAnalyticsProperties(name, input);
}

export type AnalyticsAppendInput = {
  name: AnalyticsEventName;
  anonymousSessionHash?: string;
  scanRequestId?: string;
  nextMoveId?: string;
  apiKeyId?: string;
  referrer?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  firstLandingPath?: string;
  firstTouch?: Record<string, string>;
  currentTouch?: Record<string, string>;
  properties?: Record<string, unknown>;
  occurredAt?: Date;
};

function analyticsValues(
  input: AnalyticsAppendInput & { dedupeKey?: string },
): typeof analyticsEvents.$inferInsert {
  const name = AnalyticsEventNameSchema.parse(input.name);
  if (input.dedupeKey !== undefined && !/^[0-9a-f]{64}$/.test(input.dedupeKey)) {
    throw new Error("Analytics dedupe key must be a 64-character lowercase HMAC");
  }
  return {
    name,
    anonymousSessionHash: input.anonymousSessionHash ?? null,
    scanRequestId: input.scanRequestId ?? null,
    nextMoveId: input.nextMoveId ?? null,
    apiKeyId: input.apiKeyId ?? null,
    referrer: safeAttributionText(input.referrer, 500, "referrer"),
    utmSource: safeAttributionText(input.utmSource, 200),
    utmMedium: safeAttributionText(input.utmMedium, 200),
    utmCampaign: safeAttributionText(input.utmCampaign, 200),
    firstLandingPath: safeAttributionText(input.firstLandingPath, 500, "landing"),
    firstTouch: input.firstTouch ? sanitizeAnalyticsAttribution(input.firstTouch) : null,
    currentTouch: input.currentTouch ? sanitizeAnalyticsAttribution(input.currentTouch) : null,
    properties: input.properties ? sanitizeAnalyticsEventProperties(name, input.properties) : null,
    dedupeKey: input.dedupeKey ?? null,
    occurredAt: input.occurredAt ?? new Date(),
  };
}

export class AnalyticsRepository {
  constructor(private readonly db: TrendsFastDatabase) {}

  async append(input: AnalyticsAppendInput) {
    const [event] = await this.db
      .insert(analyticsEvents)
      .values(analyticsValues(input))
      .returning();
    if (!event) throw new Error("Could not append analytics event");
    return event;
  }

  /** Database-unique append for refresh/poll-safe analytics. */
  async appendOnce(input: AnalyticsAppendInput & { dedupeKey: string }) {
    const [event] = await this.db
      .insert(analyticsEvents)
      .values(analyticsValues(input))
      .onConflictDoNothing()
      .returning();
    return { created: Boolean(event), event: event ?? null };
  }
}
