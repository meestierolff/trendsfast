import { AnalyticsEventNameSchema, type AnalyticsEventName } from "@trendsfast/schemas";

import type { TrendsFastDatabase } from "../client";
import { analyticsEvents } from "../schema";

const FORBIDDEN_PROPERTY =
  /(email|api.?key|authorization|token|secret|password|evidence.?text|model.?prompt|provider.?payload|product.?url|private.?url|submitted.?url)/i;
const SECRET_VALUE = /tf_(?:test|live)_[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|Bearer\s+/i;

const stripQuery = (value: string) => {
  try {
    const url = new URL(value, "https://local.invalid");
    url.search = "";
    url.hash = "";
    url.username = "";
    url.password = "";
    return url.origin === "https://local.invalid" ? url.pathname : url.toString();
  } catch {
    return value.split(/[?#]/, 1)[0] ?? "";
  }
};

const safeAttributionText = (value: string | undefined, maxLength: number, removeQuery = false) => {
  if (!value || SECRET_VALUE.test(value)) return null;
  const sanitized = removeQuery ? stripQuery(value) : value;
  return sanitized.slice(0, maxLength);
};

export function sanitizeAnalyticsAttribution(
  input: Readonly<Record<string, string>>,
): Record<string, string> {
  const safe: Record<string, string> = {};
  for (const [key, value] of Object.entries(input).slice(0, 20)) {
    if (FORBIDDEN_PROPERTY.test(key) || SECRET_VALUE.test(value)) continue;
    safe[key.slice(0, 100)] = /(url|path|landing|referrer)/i.test(key)
      ? stripQuery(value).slice(0, 500)
      : value.slice(0, 500);
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

export class AnalyticsRepository {
  constructor(private readonly db: TrendsFastDatabase) {}

  async append(input: {
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
  }) {
    const name = AnalyticsEventNameSchema.parse(input.name);
    const [event] = await this.db
      .insert(analyticsEvents)
      .values({
        name,
        anonymousSessionHash: input.anonymousSessionHash ?? null,
        scanRequestId: input.scanRequestId ?? null,
        nextMoveId: input.nextMoveId ?? null,
        apiKeyId: input.apiKeyId ?? null,
        referrer: safeAttributionText(input.referrer, 500, true),
        utmSource: safeAttributionText(input.utmSource, 200),
        utmMedium: safeAttributionText(input.utmMedium, 200),
        utmCampaign: safeAttributionText(input.utmCampaign, 200),
        firstLandingPath: safeAttributionText(input.firstLandingPath, 500, true),
        firstTouch: input.firstTouch ? sanitizeAnalyticsAttribution(input.firstTouch) : null,
        currentTouch: input.currentTouch ? sanitizeAnalyticsAttribution(input.currentTouch) : null,
        properties: input.properties ? sanitizeAnalyticsProperties(input.properties) : null,
        occurredAt: input.occurredAt ?? new Date(),
      })
      .returning();
    if (!event) throw new Error("Could not append analytics event");
    return event;
  }
}
