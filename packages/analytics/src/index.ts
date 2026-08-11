import {
  LAUNCH_ANALYTICS_EVENT_NAMES,
  LEGACY_ANALYTICS_EVENT_NAMES,
  sanitizeAnalyticsDimension,
  sanitizeFirstPartyAnalyticsProperties,
  sanitizePublicAnalyticsPath,
  type AnalyticsEventName,
} from "@trendsfast/schemas";

export const LAUNCH_ANALYTICS_EVENTS = LAUNCH_ANALYTICS_EVENT_NAMES;

/** Historical ledger names retained for rolling-deploy and stored-row compatibility. */
export const LEGACY_ANALYTICS_EVENTS = LEGACY_ANALYTICS_EVENT_NAMES;

export const TRACKED_EVENTS = [...LAUNCH_ANALYTICS_EVENTS, ...LEGACY_ANALYTICS_EVENTS] as const;

export type { AnalyticsEventName };
export type Attribution = {
  ref?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  first_landing?: string;
};

const EXTERNAL_ALLOWLIST = new Set([
  "ref",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "first_landing",
]);

function clean(value: string | null | undefined, max = 120): string | undefined {
  if (!value) return undefined;
  return sanitizeAnalyticsDimension(value, max) ?? undefined;
}

export function parseAttribution(url: URL): Attribution {
  const result: Attribution = { first_landing: sanitizePublicAnalyticsPath(url.pathname) };
  const values = {
    ref: clean(url.searchParams.get("ref")),
    utm_source: clean(url.searchParams.get("utm_source")),
    utm_medium: clean(url.searchParams.get("utm_medium")),
    utm_campaign: clean(url.searchParams.get("utm_campaign")),
  };
  for (const [key, value] of Object.entries(values)) {
    if (value) result[key as keyof Attribution] = value;
  }
  return result;
}

export function buildExternalAnalyticsPayload(
  event: AnalyticsEventName,
  properties: Record<string, unknown>,
): Record<string, unknown> {
  const payload: Record<string, unknown> = { event };
  for (const [key, value] of Object.entries(properties)) {
    if (!EXTERNAL_ALLOWLIST.has(key) || typeof value !== "string") continue;
    if (key === "first_landing") {
      payload[key] = sanitizePublicAnalyticsPath(value);
      continue;
    }
    const dimension = sanitizeAnalyticsDimension(value, 120);
    if (dimension) payload[key] = dimension;
  }
  return payload;
}

export type AnalyticsLedger = {
  write(event: {
    name: AnalyticsEventName;
    occurredAt: Date;
    anonymousId?: string;
    projectId?: string;
    scanRequestId?: string;
    properties: Record<string, unknown>;
  }): Promise<void>;
};

export type ExternalAnalytics = {
  send(payload: Record<string, unknown>): Promise<void>;
};

export function createAnalytics(input: {
  ledger: AnalyticsLedger;
  external?: ExternalAnalytics;
  externalEnabled?: boolean;
}) {
  return {
    async track(
      name: AnalyticsEventName,
      context: {
        anonymousId?: string;
        projectId?: string;
        scanRequestId?: string;
        properties?: Record<string, unknown>;
      } = {},
    ): Promise<void> {
      const event = {
        name,
        occurredAt: new Date(),
        ...(context.anonymousId ? { anonymousId: context.anonymousId } : {}),
        ...(context.projectId ? { projectId: context.projectId } : {}),
        ...(context.scanRequestId ? { scanRequestId: context.scanRequestId } : {}),
        properties: sanitizeFirstPartyAnalyticsProperties(name, context.properties ?? {}),
      };
      await input.ledger.write(event);
      if (input.externalEnabled && input.external) {
        await input.external.send(buildExternalAnalyticsPayload(name, event.properties));
      }
    },
  };
}
