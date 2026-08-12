import {
  AnalyticsEventNameSchema,
  type AnalyticsEventName,
  FeedbackKindSchema,
  ScanStateSchema,
  SourceSlugSchema,
} from "./enums";

type AnalyticsProperty = string | number | boolean | null;
type PropertyValidator = (value: unknown) => AnalyticsProperty | undefined;

const oneOf = <const Values extends readonly string[]>(...values: Values): PropertyValidator => {
  const allowed = new Set<string>(values);
  return (value) => (typeof value === "string" && allowed.has(value) ? value : undefined);
};
const booleanValue: PropertyValidator = (value) => (typeof value === "boolean" ? value : undefined);
const nonnegativeFiniteNumber: PropertyValidator = (value) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
const feedbackKind: PropertyValidator = (value) => {
  const parsed = FeedbackKindSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
};
const scanState: PropertyValidator = (value) => {
  const parsed = ScanStateSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
};
const sourceSlug: PropertyValidator = (value) => {
  const parsed = SourceSlugSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
};

const PUBLIC_LANDING_PATHS = new Set([
  "/",
  "/agents",
  "/blog",
  "/channels",
  "/content-distribution-api",
  "/docs",
  "/news",
  "/open",
  "/open-source",
  "/pricing",
  "/privacy",
  "/social-media-trend-api",
  "/sources",
  "/terms",
  "/trend-detection-api",
]);

/** Dynamic/private/capability paths collapse to a non-identifying constant. */
export function sanitizePublicAnalyticsPath(value: string): string {
  try {
    const pathname = new URL(value, "https://analytics.invalid").pathname.replace(/\/$/, "") || "/";
    if (PUBLIC_LANDING_PATHS.has(pathname)) return pathname;
    if (pathname.startsWith("/blog/")) return "/blog/[article]";
  } catch {
    // Invalid or attacker-controlled values receive the same constant.
  }
  return "/other";
}

export function sanitizeAnalyticsDimension(value: string, maxLength = 120): string | null {
  const normalized = value.trim();
  if (
    normalized.length < 1 ||
    normalized.length > maxLength ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

/** Referrers retain only a public local route class or an HTTP(S) source origin. */
export function sanitizeAnalyticsReferrer(value: string): string | null {
  const normalized = value.trim();
  if (normalized.startsWith("/")) return sanitizePublicAnalyticsPath(normalized);
  try {
    const url = new URL(normalized);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.username = "";
    url.password = "";
    return url.origin.slice(0, 500);
  } catch {
    return null;
  }
}

const EVENT_PROPERTY_RULES: Record<
  AnalyticsEventName,
  Readonly<Record<string, PropertyValidator>>
> = {
  landing_viewed: { placement: oneOf("homepage") },
  hero_cta_clicked: {
    placement: oneOf("homepage_hero", "homepage_repeat", "homepage_final", "agents"),
  },
  demo_viewed: { placement: oneOf("homepage_demo") },
  free_scan_submitted: { reused: booleanValue },
  scan_status_viewed: { state: scanState },
  scan_delivered: { created: booleanValue },
  evidence_opened: { source: sourceSlug },
  feedback_submitted: { kind: feedbackKind },
  move_would_use: { kind: oneOf("WOULD_USE") },
  move_used: { kind: oneOf("USED_OR_PUBLISHED") },
  repeat_scan_requested: { kind: oneOf("REQUEST_ANOTHER_SCAN") },
  agents_page_viewed: { placement: oneOf("agents") },
  docs_viewed: { placement: oneOf("docs") },
  pricing_viewed: { placement: oneOf("pricing") },
  beta_waitlist_joined: { source: oneOf("homepage", "pricing") },
  checkout_started: { plan: oneOf("founder_cloud"), mode: oneOf("test", "live") },
  subscription_started: { plan: oneOf("founder_cloud"), mode: oneOf("test", "live") },

  // Historical writers remain bounded while rolling deployments age out.
  example_scan_viewed: { action: oneOf("PUBLISH", "REPLY", "REMIX", "WAIT") },
  free_scan_started: {
    placement: oneOf("homepage_hero", "homepage_repeat", "homepage_final", "agents"),
  },
  scan_qualified: { qualified: booleanValue },
  scan_processing_started: {
    state: scanState,
    credentialMode: oneOf("fixture", "managed", "byok"),
    costUsd: nonnegativeFiniteNumber,
  },
  scan_review_required: {
    state: scanState,
    credentialMode: oneOf("fixture", "managed", "byok"),
    costUsd: nonnegativeFiniteNumber,
  },
  scan_reviewed: { approved: booleanValue },
  scan_result_viewed: {},
  scan_feedback_submitted: { kind: feedbackKind },
  move_marked_used: { kind: oneOf("USED_OR_PUBLISHED") },
  second_scan_requested: { kind: oneOf("REQUEST_ANOTHER_SCAN") },
  api_key_issued: { environment: oneOf("test", "live"), projectScoped: booleanValue },
  api_request_succeeded: { created: booleanValue },
};

/**
 * Analytics properties are dimensions, never an open JSON envelope. Unknown
 * keys and values outside fixed enums/primitive bounds are dropped.
 */
export function sanitizeFirstPartyAnalyticsProperties(
  name: AnalyticsEventName,
  input: Readonly<Record<string, unknown>>,
): Record<string, AnalyticsProperty> {
  const parsedName = AnalyticsEventNameSchema.safeParse(name);
  if (!parsedName.success) return {};
  const rules = EVENT_PROPERTY_RULES[parsedName.data];
  const safe: Record<string, AnalyticsProperty> = {};
  for (const [key, validate] of Object.entries(rules)) {
    const value = validate(input[key]);
    if (value !== undefined) safe[key] = value;
  }
  return safe;
}
