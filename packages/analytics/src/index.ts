export const TRACKED_EVENTS = [
  "landing_viewed",
  "example_scan_viewed",
  "free_scan_started",
  "free_scan_submitted",
  "scan_qualified",
  "scan_processing_started",
  "scan_review_required",
  "scan_reviewed",
  "scan_delivered",
  "scan_result_viewed",
  "scan_feedback_submitted",
  "move_marked_used",
  "second_scan_requested",
  "api_key_issued",
  "api_request_succeeded",
  "pricing_viewed",
  "checkout_started",
  "subscription_started",
] as const;

export type AnalyticsEventName = (typeof TRACKED_EVENTS)[number];
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
  const normalized = value?.trim().slice(0, max);
  return normalized ? normalized : undefined;
}

export function parseAttribution(url: URL): Attribution {
  const result: Attribution = { first_landing: url.pathname };
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
    if (EXTERNAL_ALLOWLIST.has(key) && typeof value === "string")
      payload[key] = value.slice(0, 120);
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
        properties: context.properties ?? {},
      };
      await input.ledger.write(event);
      if (input.externalEnabled && input.external) {
        await input.external.send(buildExternalAnalyticsPayload(name, event.properties));
      }
    },
  };
}
