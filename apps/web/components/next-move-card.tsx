import type { ExampleMove } from "../lib/example-moves";

function confidenceLabel(value: number): string {
  if (value >= 0.8) return "High";
  if (value >= 0.65) return "Medium";
  return "Low";
}

export function NextMoveCard({ move, fixture = false }: { move: ExampleMove; fixture?: boolean }) {
  return (
    <article className={`next-move-card action-${move.action.toLowerCase()}`}>
      <div className="move-topline">
        <div>
          <span className="eyebrow">Your next distribution move</span>
          {fixture ? <span className="fixture-label">Fixture example</span> : null}
        </div>
        <span className="review-chip">◆ Founder reviewed</span>
      </div>

      <div className="move-heading">
        <span className="action-badge" data-testid="example-action">
          {move.action}
        </span>
        <span className="channel-badge">{move.channel}</span>
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
          <li key={item}>
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
        {move.evidence.map((receipt) => (
          <div className="receipt" key={`${receipt.source}-${receipt.title}`}>
            <span className="source-dot" />
            <strong>{receipt.source}</strong>
            <span>{receipt.title}</span>
            <small>{receipt.note}</small>
          </div>
        ))}
      </div>

      <div className="move-footer">
        <span>
          <small>Signal</small>
          <strong>{move.signalClass}</strong>
        </span>
        <span>
          <small>Confidence</small>
          <strong>
            {confidenceLabel(move.confidence)} · {Math.round(move.confidence * 100)}%
          </strong>
        </span>
        <span>
          <small>Window</small>
          <strong>{move.validFor}</strong>
        </span>
        <span>
          <small>Publishing</small>
          <strong>Manual only</strong>
        </span>
      </div>
      <p className="move-limitation">Limit: {move.limitation}</p>
    </article>
  );
}
