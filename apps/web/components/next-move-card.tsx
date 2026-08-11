import { TrackedEvidenceLink } from "./tracked-evidence-link";

export type NextMoveCardModel = {
  action: "PUBLISH" | "REPLY" | "REMIX" | "WAIT";
  productName?: string;
  channel: string;
  format: string;
  topic: string;
  hook: string;
  angle: string;
  whyNow: string;
  signalClass: string;
  confidence: number;
  validUntil: string;
  outline: readonly string[];
  evidence: readonly {
    source: string;
    title: string;
    note: string;
    href?: string;
    analyticsPath?: string;
  }[];
  limitations: readonly string[];
  founderReviewed: boolean;
  autoPublish: boolean;
};

function confidenceLabel(value: number): string {
  if (value >= 0.8) return "High";
  if (value >= 0.65) return "Medium";
  return "Low";
}

export function NextMoveCard({
  move,
  className = "",
}: {
  move: NextMoveCardModel;
  className?: string;
}) {
  return (
    <article className={`next-move-card action-${move.action.toLowerCase()} ${className}`.trim()}>
      <div className="move-topline">
        <div>
          <span className="eyebrow">Your next distribution move</span>
          {move.productName ? <span className="product-chip">For {move.productName}</span> : null}
        </div>
        <span className="review-chip" data-reviewed={move.founderReviewed}>
          ◆ {move.founderReviewed ? "Founder-reviewed" : "Review unconfirmed"}
        </span>
      </div>

      <div className="move-heading">
        <span className="action-badge" data-testid="example-action">
          {move.action}
        </span>
        <span className="channel-badge">{move.channel}</span>
        <span className="format-badge">{move.format}</span>
      </div>

      <h3>{move.topic}</h3>
      <blockquote>“{move.hook}”</blockquote>

      <div className="move-grid">
        <section>
          <span className="field-label">THE ANGLE</span>
          <p>{move.angle}</p>
        </section>
        <section>
          <span className="field-label">WHY NOW</span>
          <p>{move.whyNow}</p>
        </section>
      </div>

      <ol className="outline-list">
        {move.outline.map((item, index) => (
          <li key={`${index}-${item}`}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            {item}
          </li>
        ))}
      </ol>

      <div className="evidence-block">
        <div className="evidence-heading">
          <span>Evidence receipts</span>
          <span>
            {move.evidence.length} bound source{move.evidence.length === 1 ? "" : "s"}
          </span>
        </div>
        {move.evidence.length > 0 ? (
          move.evidence.map((receipt, index) => (
            <div className="receipt" key={`${index}-${receipt.source}-${receipt.title}`}>
              <span className="source-dot" />
              <strong>{receipt.source}</strong>
              {receipt.href && receipt.analyticsPath ? (
                <TrackedEvidenceLink href={receipt.href} analyticsPath={receipt.analyticsPath}>
                  {receipt.title} <span aria-hidden="true">↗</span>
                </TrackedEvidenceLink>
              ) : receipt.href ? (
                <a href={receipt.href} rel="noreferrer">
                  {receipt.title} <span aria-hidden="true">↗</span>
                </a>
              ) : (
                <span>{receipt.title}</span>
              )}
              <small>{receipt.note}</small>
            </div>
          ))
        ) : (
          <p className="empty-receipts">No evidence cleared the quality floor.</p>
        )}
      </div>

      <div className="move-footer">
        <span>
          <small>Signal truth</small>
          <strong>{move.signalClass}</strong>
        </span>
        <span>
          <small>Confidence</small>
          <strong>
            {confidenceLabel(move.confidence)} · {Math.round(move.confidence * 100)}%
          </strong>
        </span>
        <span>
          <small>Valid until</small>
          <strong>{move.validUntil}</strong>
        </span>
        <span>
          <small>Publishing</small>
          <strong>{move.autoPublish ? "Unexpectedly enabled" : "Manual only"}</strong>
          <code>auto_publish={String(move.autoPublish)}</code>
        </span>
      </div>
      <div className="move-limitations">
        <span>Limitations</span>
        <ul>
          {move.limitations.map((limitation, index) => (
            <li key={`${index}-${limitation}`}>{limitation}</li>
          ))}
        </ul>
      </div>
    </article>
  );
}
