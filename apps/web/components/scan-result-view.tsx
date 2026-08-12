import { FeedbackControls } from "./feedback-controls";
import { NextMoveCard, type NextMoveCardModel } from "./next-move-card";
import { TrackedEvidenceLink } from "./tracked-evidence-link";
import {
  dateTimeValue,
  formatCodeLabel,
  formatScanDate,
  type ScanDate,
} from "./scan-view-formatters";

export { confidenceLabel, formatCodeLabel, formatScanDate } from "./scan-view-formatters";

export type ReadyScanResultView = {
  tokenId: string;
  nextMoveId: string;
  product: {
    name: string;
    url: string;
    audience: string;
    problem: string;
    credibleTopics: readonly string[];
    assumptions: readonly string[];
  };
  move: {
    action: "PUBLISH" | "REPLY" | "REMIX" | "WAIT";
    channel: string;
    topic: string;
    angle: string;
    format: string;
    hook: string;
    outline: readonly string[];
    cta: string;
    priority: number;
    confidence: number;
    validUntil: ScanDate;
  };
  whyNow: {
    summary: string;
    signalClass: string;
    independentSourceCount: number;
    saturation: string;
  };
  evidence: readonly {
    id: string;
    source: string;
    url: string;
    title?: string | null;
    publishedAt?: ScanDate | null;
    observedAt: ScanDate;
    reason: string;
    provider: string;
    role: "DECISION_SUPPORT" | "SUPPLEMENTAL";
    verified: boolean;
    availability: string;
  }[];
  limitations: readonly string[];
  founderReviewed: boolean;
  autoPublish: boolean;
};

function safeHttpUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function freshestObservation(evidence: ReadyScanResultView["evidence"]): ScanDate | null {
  let freshest: { value: ScanDate; milliseconds: number } | null = null;
  for (const receipt of evidence) {
    if (receipt.role !== "DECISION_SUPPORT") continue;
    const date =
      receipt.observedAt instanceof Date ? receipt.observedAt : new Date(receipt.observedAt);
    if (Number.isNaN(date.valueOf())) continue;
    if (!freshest || date.valueOf() > freshest.milliseconds) {
      freshest = { value: receipt.observedAt, milliseconds: date.valueOf() };
    }
  }
  return freshest?.value ?? null;
}

function EvidenceReceipt({
  receipt,
  index,
  token,
}: {
  receipt: ReadyScanResultView["evidence"][number];
  index: number;
  token: string;
}) {
  const originalUrl = safeHttpUrl(receipt.url);
  return (
    <article className="scan-receipt" data-available={receipt.availability.toLowerCase()}>
      <div className="scan-receipt-index" aria-hidden="true">
        {String(index + 1).padStart(2, "0")}
      </div>
      <div className="scan-receipt-body">
        <div className="scan-receipt-topline">
          <span>{formatCodeLabel(receipt.source)}</span>
          <span>{formatCodeLabel(receipt.role)}</span>
          <span data-verified={receipt.verified}>
            {receipt.verified ? "Verified at delivery" : "Not verified at delivery"}
          </span>
          <span>{formatCodeLabel(receipt.availability)}</span>
        </div>
        <h3>{receipt.title || "Original source receipt"}</h3>
        <p>{receipt.reason}</p>
        <dl>
          <div>
            <dt>Receipt ID</dt>
            <dd>{receipt.id}</dd>
          </div>
          <div>
            <dt>Provider</dt>
            <dd>{receipt.provider}</dd>
          </div>
          <div>
            <dt>Published</dt>
            <dd>
              {receipt.publishedAt ? (
                <time dateTime={dateTimeValue(receipt.publishedAt)}>
                  {formatScanDate(receipt.publishedAt)}
                </time>
              ) : (
                "Not supplied"
              )}
            </dd>
          </div>
          <div>
            <dt>Observed</dt>
            <dd>
              <time dateTime={dateTimeValue(receipt.observedAt)}>
                {formatScanDate(receipt.observedAt)}
              </time>
            </dd>
          </div>
        </dl>
        {originalUrl ? (
          <div className="scan-receipt-link">
            <code>{receipt.url}</code>
            <TrackedEvidenceLink
              href={originalUrl}
              analyticsPath={`/api/scans/${encodeURIComponent(token)}/evidence/${encodeURIComponent(receipt.id)}`}
            >
              View original evidence <span aria-hidden="true">↗</span>
            </TrackedEvidenceLink>
          </div>
        ) : (
          <div className="scan-receipt-link">
            <code>{receipt.url}</code>
            <span className="scan-invalid-source">Original source URL unavailable</span>
          </div>
        )}
      </div>
    </article>
  );
}

export function ScanResultView({ token, result }: { token: string; result: ReadyScanResultView }) {
  const productUrl = safeHttpUrl(result.product.url);
  const freshest = freshestObservation(result.evidence);
  const signatureMove: NextMoveCardModel = {
    action: result.move.action,
    productName: result.product.name,
    channel: formatCodeLabel(result.move.channel),
    format: formatCodeLabel(result.move.format),
    topic: result.move.topic,
    hook: result.move.hook,
    angle: result.move.angle,
    whyNow: result.whyNow.summary,
    signalClass: formatCodeLabel(result.whyNow.signalClass),
    confidence: result.move.confidence,
    validUntil: formatScanDate(result.move.validUntil),
    outline: result.move.outline,
    evidence: result.evidence
      .filter((receipt) => receipt.role === "DECISION_SUPPORT")
      .map((receipt) => {
        const href = safeHttpUrl(receipt.url);
        return {
          source: formatCodeLabel(receipt.source),
          title: receipt.title || "Original source receipt",
          note: receipt.reason,
          ...(href ? { href } : {}),
          ...(href
            ? {
                analyticsPath: `/api/scans/${encodeURIComponent(token)}/evidence/${encodeURIComponent(receipt.id)}`,
              }
            : {}),
        };
      }),
    limitations: result.limitations,
    founderReviewed: result.founderReviewed,
    autoPublish: result.autoPublish,
  };

  return (
    <div className="scan-delivery scan-result-page">
      <section className="scan-result-intro" aria-labelledby="scan-result-title">
        <div>
          <p className="scan-mono-label">
            Private result <span>·</span>{" "}
            {result.founderReviewed ? "Founder-reviewed" : "Review unconfirmed"}
          </p>
          <h1 id="scan-result-title">Your next distribution move.</h1>
          <p>
            One decision for <strong>{result.product.name}</strong>, with its evidence and limits
            attached.
          </p>
        </div>
        <aside aria-label="Delivery trust status">
          <span className="scan-lock" aria-hidden="true">
            ◇
          </span>
          <strong>Private by default</strong>
          <small>Sharing requires your explicit opt-in below.</small>
        </aside>
      </section>

      <section className="scan-product-context" aria-labelledby="scan-product-title">
        <div className="scan-context-heading">
          <p className="scan-mono-label">Product context</p>
          <h2 id="scan-product-title">{result.product.name}</h2>
          {productUrl ? (
            <a href={productUrl} rel="noreferrer">
              {result.product.url} <span aria-hidden="true">↗</span>
            </a>
          ) : (
            <span>{result.product.url}</span>
          )}
        </div>
        <dl className="scan-context-grid">
          <div>
            <dt>Audience</dt>
            <dd>{result.product.audience}</dd>
          </div>
          <div>
            <dt>Problem</dt>
            <dd>{result.product.problem}</dd>
          </div>
          <div>
            <dt>Credible topics</dt>
            <dd>
              {result.product.credibleTopics.length > 0 ? (
                <ul>
                  {result.product.credibleTopics.map((topic) => (
                    <li key={topic}>{topic}</li>
                  ))}
                </ul>
              ) : (
                "None recorded"
              )}
            </dd>
          </div>
          <div>
            <dt>Assumptions to verify</dt>
            <dd>
              {result.product.assumptions.length > 0 ? (
                <ul>
                  {result.product.assumptions.map((assumption) => (
                    <li key={assumption}>{assumption}</li>
                  ))}
                </ul>
              ) : (
                "No assumptions recorded"
              )}
            </dd>
          </div>
        </dl>
      </section>

      <dl className="scan-record-identifiers" aria-label="Private delivery record identifiers">
        <div>
          <dt>Next Move ID</dt>
          <dd>
            <code>{result.nextMoveId}</code>
          </dd>
        </div>
        <div>
          <dt>Delivery record ID</dt>
          <dd>
            <code>{result.tokenId}</code>
          </dd>
        </div>
      </dl>

      <NextMoveCard move={signatureMove} className="result-signature-card" />

      <section className="scan-why-now" aria-labelledby="scan-why-now-title">
        <div>
          <p className="scan-mono-label">Why now</p>
          <h2 id="scan-why-now-title">{result.whyNow.summary}</h2>
        </div>
        <dl>
          <div>
            <dt>Signal class</dt>
            <dd>{formatCodeLabel(result.whyNow.signalClass)}</dd>
          </div>
          <div>
            <dt>Independent sources</dt>
            <dd>{result.whyNow.independentSourceCount}</dd>
          </div>
          <div>
            <dt>Saturation</dt>
            <dd>{formatCodeLabel(result.whyNow.saturation)}</dd>
          </div>
          <div>
            <dt>Freshest observation</dt>
            <dd>
              {freshest ? (
                <time dateTime={dateTimeValue(freshest)}>{formatScanDate(freshest)}</time>
              ) : (
                "Not available"
              )}
            </dd>
          </div>
        </dl>
      </section>

      <section className="scan-evidence" aria-labelledby="scan-evidence-title">
        <div className="scan-section-heading">
          <div>
            <p className="scan-mono-label">Evidence receipts</p>
            <h2 id="scan-evidence-title">The proof behind the move.</h2>
          </div>
          <p>
            {result.evidence.filter((receipt) => receipt.role === "DECISION_SUPPORT").length}{" "}
            decision-bound source(s) ·{" "}
            {result.evidence.filter((receipt) => receipt.role === "SUPPLEMENTAL").length}{" "}
            supplemental. Publication and observation times are shown separately.
          </p>
        </div>
        <div className="scan-receipts">
          {result.evidence.length > 0 ? (
            result.evidence.map((receipt, index) => (
              <EvidenceReceipt key={receipt.id} receipt={receipt} index={index} token={token} />
            ))
          ) : (
            <p className="scan-no-receipts">No evidence receipts were supplied with this result.</p>
          )}
        </div>
      </section>

      <section className="scan-limitations" aria-labelledby="scan-limitations-title">
        <div>
          <p className="scan-mono-label">Visible limitations</p>
          <h2 id="scan-limitations-title">What this move does not prove.</h2>
        </div>
        {result.limitations.length > 0 ? (
          <ol>
            {result.limitations.map((limitation, index) => (
              <li key={`${index}-${limitation}`}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <p>{limitation}</p>
              </li>
            ))}
          </ol>
        ) : (
          <p className="scan-no-limitations">No limitations were supplied with this result.</p>
        )}
      </section>

      <section className="scan-safety-note" aria-label="Publishing control">
        <span aria-hidden="true">×</span>
        <div>
          <p className="scan-mono-label">No auto-posting</p>
          <h2>You stay in control.</h2>
          <p>
            TrendsFast recommends a move; it does not publish one. Edit, verify, and decide whether
            to act.
          </p>
        </div>
        <code>auto_publish={String(result.autoPublish)}</code>
      </section>

      <FeedbackControls token={token} />
    </div>
  );
}
