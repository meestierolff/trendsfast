import { isIP } from "node:net";

import { redactSecrets } from "@trendsfast/core";

type JsonRecord = Record<string, unknown>;

export type ReviewBundle = {
  generatedAt: string;
  release: {
    sha: string | null;
    environment: "local" | "preview" | "production";
    host: string | null;
    deploymentId: string | null;
  };
  scan: { id: string; productUrl: string; state: string };
  context: {
    current: JsonRecord;
    corrections: Array<{
      version: number;
      createdBy: string;
      createdAt: string;
      context: JsonRecord;
    }>;
  };
  queryPlan: JsonRecord | null;
  providerRuns: Array<{
    source: string;
    provider: string;
    state: string;
    latencyMs: number | null;
    calls: number;
    maxCalls: number;
    quota: number;
    estimatedCostUsd: number;
    settledActualCostUsd: number | null;
    measurements: unknown[];
    limitations: string[];
  }>;
  cost: {
    estimatedUsd: number;
    settledActualUsd: number | null;
    quota: number;
    attempts: Array<{
      provider: string;
      operation: string;
      estimatedCostUsd: number;
      settledActualCostUsd: number | null;
      quota: number;
      usageStatus: string;
      occurredAt: string;
    }>;
  };
  evidence: Array<{
    id: string;
    signalId: string;
    moveVersion: number;
    source: string;
    provider: string;
    canonicalUrl: string;
    title: string | null;
    excerpt: string | null;
    visibleMetrics: JsonRecord;
    measurementSeries: unknown[];
    independenceKey: string;
    observedAt: string;
    publishedAt: string | null;
    reason: string;
    role: "DECISION_SUPPORT" | "SUPPLEMENTAL";
    verified: boolean;
    availability: string;
    reviewedBy: string | null;
    verifiedAt: string | null;
  }>;
  clusters: Array<{
    id: string;
    topic: string;
    summary: string | null;
    signalClass: string;
    independentSourceCount: number;
    saturation: string;
    scoreComponents: JsonRecord | null;
  }>;
  opportunities: Array<{
    id: string;
    moveVersion: number;
    rank: number;
    action: string;
    channel: string;
    format: string;
    totalScore: number;
    scoreComponents: JsonRecord;
    passesQualityFloor: boolean;
    rejectionReason: string | null;
    scoreVersion: string;
  }>;
  qualityFloor: { passed: boolean; reasons: string[] };
  nextMove: JsonRecord | null;
  versions: { model: string | null; prompt: string | null; score: string | null };
  proposalRevisions?: Array<{
    version: number;
    changeKind: string;
    reviewer: string;
    reason: string;
    promptVersion: string;
    scoreVersion: string;
    retainedEvidenceIds: string[];
    before: JsonRecord;
    after: JsonRecord;
    occurredAt: string;
  }>;
  reviewEvents: Array<{
    action: string;
    reviewer: string;
    before: JsonRecord | null;
    after: JsonRecord | null;
    reason: string | null;
    occurredAt: string;
  }>;
};

const SENSITIVE_FIELD =
  /(?:authorization|cookie|database[_-]?url|email|raw[_-]?ip|ip[_-]?address|password|secret|token|api[_-]?key|provider[_-]?payload|model[_-]?(?:input|output|prompt))/i;
const SENSITIVE_QUERY =
  /(?:authorization|auth|cookie|credential|email|key|password|secret|session|signature|token)/i;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const STRIPE_SECRET = /\b(?:(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|whsec_[A-Za-z0-9]{16,})\b/g;
const PROVIDER_CREDENTIAL =
  /(?<![A-Za-z0-9_-])(?:sk-(?:proj-)?[A-Za-z0-9_-]{16,}|xai-[A-Za-z0-9_-]{16,}|tvly-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AIza[A-Za-z0-9_-]{20,})(?![A-Za-z0-9_-])/g;
const DELIVERY_CAPABILITY =
  /(?<![A-Za-z0-9_-])scan_[A-Za-z0-9_-]{8,32}\.[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/g;
const PUBLIC_SCAN_CAPABILITY = /(?<![A-Za-z0-9_-])scan_[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/g;
const DATABASE_URL = /\bpostgres(?:ql)?:\/\/[^\s,;)}\]]+/gi;
const HTTP_URL = /https?:\/\/[^\s<>"'`]+/gi;
const IPV6_CANDIDATE =
  /(?<![A-Fa-f0-9:])(?:[A-Fa-f0-9]{0,4}:){2,7}[A-Fa-f0-9]{0,4}(?![A-Fa-f0-9:])/g;

function redactUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.username) url.username = "[REDACTED]";
    if (url.password) url.password = "[REDACTED]";
    if (isIP(url.hostname)) url.hostname = "redacted.invalid";
    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE_QUERY.test(key)) url.searchParams.set(key, "[REDACTED]");
    }
    url.hash = "";
    return url.toString();
  } catch {
    return value;
  }
}

function redactString(value: string): string {
  const urlRedacted = value.replace(HTTP_URL, (candidate) => {
    const trailing = candidate.match(/[),.;:!?\]}]+$/)?.[0] ?? "";
    const url = trailing ? candidate.slice(0, -trailing.length) : candidate;
    return `${redactUrl(url)}${trailing}`;
  });
  return redactSecrets(urlRedacted.replace(DATABASE_URL, "[REDACTED_DATABASE_URL]"))
    .replace(DELIVERY_CAPABILITY, "[REDACTED_DELIVERY_CAPABILITY]")
    .replace(PUBLIC_SCAN_CAPABILITY, "[REDACTED_SCAN_CAPABILITY]")
    .replace(STRIPE_SECRET, "[REDACTED_STRIPE_SECRET]")
    .replace(PROVIDER_CREDENTIAL, "[REDACTED_PROVIDER_CREDENTIAL]")
    .replace(EMAIL, "[REDACTED_EMAIL]")
    .replace(IPV4, (candidate) => (isIP(candidate) ? "[REDACTED_IP]" : candidate))
    .replace(IPV6_CANDIDATE, (candidate) => (isIP(candidate) === 6 ? "[REDACTED_IP]" : candidate));
}

function redactUnknown(value: unknown, key = ""): unknown {
  if (key && SENSITIVE_FIELD.test(key)) return "[REDACTED]";
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map((item) => redactUnknown(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as JsonRecord).map(([childKey, child]) => [
        childKey,
        redactUnknown(child, childKey),
      ]),
    );
  }
  return value;
}

export function redactReviewBundle(bundle: ReviewBundle): ReviewBundle {
  return redactUnknown(bundle) as ReviewBundle;
}

const MONETARY_FIELD = /(?:cost|price|currency|amount|spend|budget|margin|usd|eur)/i;

function omitPrivateCosts(value: unknown, key = ""): unknown {
  if (
    key &&
    MONETARY_FIELD.test(key) &&
    !(key === "cost" && value !== null && typeof value === "object")
  ) {
    return undefined;
  }
  if (Array.isArray(value)) {
    return value.map((item) => omitPrivateCosts(item)).filter((item) => item !== undefined);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as JsonRecord)
        .map(([childKey, child]) => [childKey, omitPrivateCosts(child, childKey)] as const)
        .filter((entry): entry is readonly [string, unknown] => entry[1] !== undefined),
    );
  }
  return value;
}

/** Public-safe is the default; private monetary fields require an explicit opt-in. */
export function exportReviewBundle(
  bundle: ReviewBundle,
  options: { includePrivateCosts?: boolean } = {},
): ReviewBundle {
  const redacted = redactReviewBundle(bundle);
  return options.includePrivateCosts ? redacted : (omitPrivateCosts(redacted) as ReviewBundle);
}

function jsonBlock(value: unknown): string {
  return `\`\`\`json\n${JSON.stringify(value, null, 2).replaceAll("```", "``\u200b`")}\n\`\`\``;
}

export function renderReviewBundleMarkdown(bundle: ReviewBundle): string {
  const lines = [
    "# TrendsFast review bundle",
    "",
    `Generated: ${bundle.generatedAt}`,
    `Release: ${bundle.release.sha ?? "not recorded"}`,
    `Deployment: ${bundle.release.environment} · ${bundle.release.host ?? "not recorded"}`,
    `Scan: ${bundle.scan.id} · ${bundle.scan.state}`,
    `Product: ${bundle.scan.productUrl}`,
    "",
    "## Context and corrections",
    "",
    jsonBlock(bundle.context),
    "",
    "## Bounded query plan",
    "",
    jsonBlock(bundle.queryPlan),
    "",
    "## Provider runs and cost",
    "",
    jsonBlock({ providerRuns: bundle.providerRuns, cost: bundle.cost }),
    "",
    "## Evidence receipts and measurement series",
    "",
    jsonBlock(bundle.evidence),
    "",
    "## Clusters, scoring, and quality floor",
    "",
    jsonBlock({
      clusters: bundle.clusters,
      opportunities: bundle.opportunities,
      qualityFloor: bundle.qualityFloor,
    }),
    "",
    "## Proposed Next Move and versions",
    "",
    jsonBlock({ nextMove: bundle.nextMove, versions: bundle.versions }),
    "",
    "## Review audit",
    "",
    jsonBlock({
      proposalRevisions: bundle.proposalRevisions ?? [],
      reviewEvents: bundle.reviewEvents,
    }),
    "",
  ];
  return lines.join("\n");
}
