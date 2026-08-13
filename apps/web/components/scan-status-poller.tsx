"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export type ScanSourcePlanItem = {
  name: string;
  status: string;
};

export type ScanStatusView = {
  found: true;
  state: "QUEUED" | "RUNNING" | "REVIEW_REQUIRED" | "READY" | "FAILED";
  submittedUrl: string;
  inferredProduct?: string | { name?: string } | null;
  submittedAt: string | Date;
  sourcePlan: readonly ScanSourcePlanItem[];
  founderReview: boolean;
  resultToken?: string | null;
  requiresNewScan?: boolean;
  failure?: string | { message?: string; code?: string } | null;
};

const stateCopy: Record<
  ScanStatusView["state"],
  { eyebrow: string; title: string; detail: string }
> = {
  QUEUED: {
    eyebrow: "Request accepted",
    title: "Your scan is in the queue.",
    detail: "The request is stored. Source work begins when a bounded scan slot is available.",
  },
  RUNNING: {
    eyebrow: "Scan in progress",
    title: "We’re checking the source plan.",
    detail: "Each source reports its own state below. Missing or degraded coverage stays visible.",
  },
  REVIEW_REQUIRED: {
    eyebrow: "Evidence collected",
    title: "Your move is with the founder for review.",
    detail:
      "A human is checking the product context, evidence fit, limitations, and final decision.",
  },
  READY: {
    eyebrow: "Review complete",
    title: "Your private result is ready.",
    detail: "The recommendation passed founder review. Your private delivery link is opening now.",
  },
  FAILED: {
    eyebrow: "Scan stopped",
    title: "This scan could not be completed.",
    detail:
      "No thin recommendation was delivered. The recorded reason appears below when available.",
  },
};

function readableCode(value: string): string {
  const known: Record<string, string> = {
    x: "X",
    github: "GitHub",
    youtube: "YouTube",
    hacker_news: "Hacker News",
    google_trends: "Google Trends",
  };
  const normalized = value.trim();
  return (
    known[normalized.toLowerCase()] ??
    normalized
      .toLowerCase()
      .replaceAll("_", " ")
      .replace(/^./, (character) => character.toUpperCase())
  );
}

function inferredProductName(value: ScanStatusView["inferredProduct"]): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value.name === "string") return value.name;
  return null;
}

function failureText(value: ScanStatusView["failure"]): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value.message === "string") return value.message;
  return null;
}

function utcDate(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) return "Submission time unavailable";
  return `${new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "UTC",
  }).format(date)} UTC`;
}

function dateTimeValue(value: string | Date): string | undefined {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.valueOf()) ? undefined : date.toISOString();
}

function safeHttpUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function unwrapStatusPayload(value: unknown): ScanStatusView | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const candidate =
    record.status && typeof record.status === "object"
      ? (record.status as Record<string, unknown>)
      : record;
  if (
    candidate.found !== true ||
    typeof candidate.state !== "string" ||
    !["QUEUED", "RUNNING", "REVIEW_REQUIRED", "READY", "FAILED"].includes(candidate.state)
  ) {
    return null;
  }
  return candidate as ScanStatusView;
}

export function ScanStatusPoller({
  token,
  initialStatus,
}: {
  token: string;
  initialStatus: ScanStatusView;
}) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  const [refreshState, setRefreshState] = useState<"idle" | "refreshing" | "paused">("idle");

  const refresh = useCallback(async () => {
    setRefreshState("refreshing");
    try {
      const response = await fetch(`/api/scans/${encodeURIComponent(token)}/status`, {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error("Status request failed");
      const nextStatus = unwrapStatusPayload(await response.json());
      if (!nextStatus) throw new Error("Invalid status response");
      setStatus(nextStatus);
      setRefreshState("idle");
    } catch {
      setRefreshState("paused");
    }
  }, [token]);

  useEffect(() => {
    if (status.state === "READY" && status.resultToken) {
      router.replace(`/scan/${encodeURIComponent(status.resultToken)}`);
      return;
    }
    if (status.state === "FAILED" || status.requiresNewScan) return;

    const interval = window.setInterval(() => void refresh(), 5_000);
    return () => window.clearInterval(interval);
  }, [refresh, router, status.requiresNewScan, status.resultToken, status.state]);

  const copy = stateCopy[status.state];
  const productName = inferredProductName(status.inferredProduct);
  const recordedFailure = failureText(status.failure);
  const waitingForDeliveryToken =
    status.state === "READY" && !status.resultToken && !status.requiresNewScan;
  const submittedUrl = safeHttpUrl(status.submittedUrl);

  return (
    <div className="scan-delivery scan-status-page">
      <section className="scan-status-hero" aria-labelledby="scan-status-title">
        <div className="scan-status-copy">
          <p className="scan-mono-label">
            <span className="scan-live-dot" aria-hidden="true" /> {copy.eyebrow}
          </p>
          <h1 id="scan-status-title">{copy.title}</h1>
          <p>{copy.detail}</p>
        </div>
        <div className="scan-status-orbit" aria-hidden="true">
          <span />
          <span />
          <i />
        </div>
        <div className="scan-state-readout" aria-live="polite" aria-atomic="true">
          <span>Current state</span>
          <strong>{readableCode(status.state)}</strong>
          <small>
            {refreshState === "refreshing"
              ? "Checking for a new state…"
              : "Checked automatically every 5 seconds"}
          </small>
        </div>
      </section>

      <section className="scan-request-facts" aria-label="Submitted scan details">
        <div>
          <span>Submitted URL</span>
          {submittedUrl ? (
            <a href={submittedUrl}>{status.submittedUrl}</a>
          ) : (
            <strong>{status.submittedUrl}</strong>
          )}
        </div>
        <div>
          <span>Product understood as</span>
          <strong>{productName ?? "Not inferred yet"}</strong>
        </div>
        <div>
          <span>Accepted at</span>
          <time dateTime={dateTimeValue(status.submittedAt)}>{utcDate(status.submittedAt)}</time>
        </div>
        <div>
          <span>Delivery</span>
          <strong>Private link · no auto-posting</strong>
        </div>
      </section>

      {status.state === "READY" && status.resultToken ? (
        <Link className="scan-ready-link" href={`/scan/${encodeURIComponent(status.resultToken)}`}>
          Open your private result <span aria-hidden="true">→</span>
        </Link>
      ) : null}

      {status.state === "FAILED" ? (
        <section className="scan-failure" role="alert">
          <p className="scan-mono-label">Recorded failure</p>
          <h2>No recommendation was delivered.</h2>
          <p>
            {recordedFailure ?? "The scan stopped before a trustworthy move could be delivered."}
          </p>
          <Link href="/#scan">Submit a new product URL →</Link>
        </section>
      ) : null}

      {status.requiresNewScan ? (
        <section className="scan-failure" role="status">
          <p className="scan-mono-label">Recommendation expired</p>
          <h2>This result is no longer current.</h2>
          <p>
            The decision contract is stale or unavailable. Existing projects can only be refreshed
            by their verified owner; a public scan will not replace this project.
          </p>
          <Link href="/login">Sign in to your project →</Link>
        </section>
      ) : null}

      {waitingForDeliveryToken ? (
        <p className="scan-delivery-wait" role="status">
          Review is complete. The private delivery link is being prepared; this page will keep
          checking.
        </p>
      ) : null}

      <section className="scan-source-plan" aria-labelledby="scan-source-plan-title">
        <div className="scan-section-heading">
          <div>
            <p className="scan-mono-label">Honest source plan</p>
            <h2 id="scan-source-plan-title">Coverage, source by source.</h2>
          </div>
          <p>
            No blended progress score. A source can succeed, degrade, fail, or be skipped
            independently.
          </p>
        </div>
        {status.sourcePlan.length > 0 ? (
          <ol>
            {status.sourcePlan.map((source, index) => (
              <li key={`${source.name}-${index}`} data-source-status={source.status.toLowerCase()}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <strong>{readableCode(source.name)}</strong>
                <i aria-hidden="true" />
                <small>{readableCode(source.status)}</small>
              </li>
            ))}
          </ol>
        ) : (
          <p className="scan-empty-plan">The source plan has not been persisted yet.</p>
        )}
      </section>

      <section className="scan-review-explainer" aria-labelledby="scan-review-title">
        <div className="scan-review-mark" aria-hidden="true">
          ◆
        </div>
        <div>
          <p className="scan-mono-label">
            {status.founderReview ? "Founder review required" : "Automated scan status"}
          </p>
          <h2 id="scan-review-title">
            {status.founderReview
              ? "Why a human reviews every first-cohort result."
              : "No founder review is recorded for this request."}
          </h2>
        </div>
        <p>
          {status.founderReview
            ? "Early recommendations are checked for product context, evidence relevance, source availability, realistic claims, and visible limitations. Review is a quality gate—not a claim that the move will perform. Nothing is posted for you."
            : "The current request record does not require founder review. The result page will disclose its actual review status and will never auto-publish."}
        </p>
      </section>

      <div className="scan-refresh-note">
        <p aria-live="polite">
          {refreshState === "paused"
            ? "Automatic refresh paused after a connection problem. Your scan is still stored."
            : "You can leave this tab and return with the same private link."}
        </p>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={refreshState === "refreshing"}
        >
          {refreshState === "refreshing" ? "Refreshing…" : "Refresh status"}
        </button>
      </div>
    </div>
  );
}
