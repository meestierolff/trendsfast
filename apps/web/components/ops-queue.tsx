import Link from "next/link";

export type OpsQueueItemView = {
  publicId: string;
  state: "QUEUED" | "RUNNING" | "REVIEW_REQUIRED" | "READY" | "FAILED";
  origin: string;
  submittedUrl: string;
  submittedAt: string | Date;
  startedAt?: string | Date | null;
  completedAt?: string | Date | null;
  inferredProduct?: string | null;
  run: {
    attempt: number;
    state: string;
    actualCostUsd: string;
    estimatedCostUsd: string;
    sourceCoverage?: Record<string, string> | null;
    updatedAt: string | Date;
  } | null;
  nextMove: {
    action: string;
    state: string;
    signalClass: string;
    founderReviewed: boolean;
  } | null;
  providerFailure: {
    source: string;
    provider: string;
    state: string;
    failureCode?: string | null;
  } | null;
  deliveryState?: string | null;
};

function date(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.valueOf()) ? null : parsed;
}

function compactDate(value: string | Date): string {
  const parsed = date(value);
  if (!parsed) return "Unknown";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "UTC",
  }).format(parsed);
}

export function formatOpsDuration(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "Unknown";
  const totalSeconds = Math.floor(milliseconds / 1_000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return `${minutes}m ${totalSeconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

function latency(item: OpsQueueItemView, now: Date): string {
  const start = date(item.submittedAt);
  const end = date(item.completedAt) ?? now;
  if (!start) return "Unknown";
  return formatOpsDuration(Math.max(0, end.valueOf() - start.valueOf()));
}

function inferredName(item: OpsQueueItemView): string {
  if (item.inferredProduct) return item.inferredProduct;
  try {
    return new URL(item.submittedUrl).hostname;
  } catch {
    return "Product not inferred";
  }
}

const filters = [
  ["ALL", "All"],
  ["REVIEW_REQUIRED", "Needs review"],
  ["RUNNING", "Running"],
  ["FAILED", "Failed"],
  ["READY", "Delivered"],
] as const;

export function OpsQueue({
  items,
  activeFilter,
  now,
  error,
}: {
  items: readonly OpsQueueItemView[];
  activeFilter: string;
  now: Date;
  error?: string;
}) {
  const visible =
    activeFilter === "ALL" ? items : items.filter((item) => item.state === activeFilter);

  return (
    <div className="ops-review-queue">
      <div className="ops-queue-toolbar">
        <nav aria-label="Review queue filters">
          {filters.map(([value, label]) => (
            <Link
              key={value}
              href={value === "ALL" ? "/ops" : `/ops?state=${value}`}
              aria-current={activeFilter === value ? "page" : undefined}
            >
              {label}
              <span>
                {value === "ALL"
                  ? items.length
                  : items.filter((item) => item.state === value).length}
              </span>
            </Link>
          ))}
        </nav>
        <p>
          Showing <strong>{visible.length}</strong> of {items.length} persisted requests
        </p>
      </div>

      {error ? (
        <div className="ops-queue-error" role="alert">
          <span>READ ERROR</span>
          <h2>The review queue is temporarily unavailable.</h2>
          <p>{error}</p>
        </div>
      ) : visible.length === 0 ? (
        <div className="ops-empty">
          <span>QUEUE / 0</span>
          <h2>No scans match this review state.</h2>
          <p>Accepted requests appear here only after PostgreSQL has persisted them.</p>
        </div>
      ) : (
        <div className="ops-queue-list">
          <div className="ops-queue-columns" aria-hidden="true">
            <span>Request</span>
            <span>State + latency</span>
            <span>Provider health</span>
            <span>Delivery</span>
          </div>
          {visible.map((item) => (
            <article key={item.publicId} className="ops-queue-row">
              <div className="ops-queue-product">
                <span>
                  {compactDate(item.submittedAt)} UTC · {item.origin}
                </span>
                <h2>{inferredName(item)}</h2>
                <p>{item.submittedUrl}</p>
                <code>{item.publicId}</code>
              </div>
              <div className="ops-queue-state">
                <span className="ops-state-pill" data-state={item.state.toLowerCase()}>
                  {item.state.replaceAll("_", " ")}
                </span>
                <strong>{latency(item, now)}</strong>
                <small>
                  {item.run
                    ? `Attempt ${item.run.attempt} · run ${item.run.state.toLowerCase()}`
                    : "No run claimed"}
                </small>
                {item.nextMove ? (
                  <small>
                    {item.nextMove.action} · {item.nextMove.signalClass.replaceAll("_", " ")}
                  </small>
                ) : null}
              </div>
              <div className="ops-provider-health">
                {item.providerFailure ? (
                  <>
                    <span data-health="failure">{item.providerFailure.state}</span>
                    <strong>
                      {item.providerFailure.source} / {item.providerFailure.provider}
                    </strong>
                    <small>{item.providerFailure.failureCode ?? "No failure code"}</small>
                  </>
                ) : (
                  <>
                    <span data-health="clear">No recorded failure</span>
                    <strong>
                      {item.run
                        ? `$${Number(item.run.actualCostUsd).toFixed(4)} provider-reported subtotal · $${Number(item.run.estimatedCostUsd).toFixed(4)} reserved estimate`
                        : "Awaiting run"}
                    </strong>
                    {item.run ? (
                      <small>
                        Unsettled provider or model reservations are excluded from the reported
                        subtotal.
                      </small>
                    ) : null}
                    {item.run?.sourceCoverage ? (
                      <small>
                        {Object.entries(item.run.sourceCoverage)
                          .map(([source, state]) => `${source}: ${state}`)
                          .join(" · ")}
                      </small>
                    ) : null}
                  </>
                )}
              </div>
              <div className="ops-queue-delivery">
                <span>{item.deliveryState ?? "NOT ISSUED"}</span>
                <strong>
                  {item.nextMove?.founderReviewed ? "Founder reviewed" : "Review pending"}
                </strong>
                <Link href={`/ops/${encodeURIComponent(item.publicId)}`}>
                  Inspect record <span aria-hidden="true">→</span>
                </Link>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
