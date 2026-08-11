const request = `curl -X POST https://trendsfast.com/v1/next-move \\
  -H "Authorization: Bearer tf_live_<prefix>.<secret>" \\
  -H "Idempotency-Key: 4a2d1201-9666-4ef0-90a9-e5aa47786c8e" \\
  -H "Content-Type: application/json" \\
  -d '{
    "product_url": "https://example.com",
    "goal": "qualified_signups",
    "market": "US",
    "language": "en",
    "preferred_channels": ["x", "linkedin"]
  }'`;

const accepted = `HTTP/1.1 202 Accepted
Location: https://trendsfast.com/v1/next-moves/scan_01J...

{
  "id": "scan_01J...",
  "status": "QUEUED",
  "status_url": "https://trendsfast.com/v1/next-moves/scan_01J..."
}`;

const ready = `GET /v1/next-moves/scan_01J...

{
  "status": "READY",
  "next_move": {
    "action": "PUBLISH",
    "channel": "x",
    "topic": "Evidence-first distribution agents",
    "confidence": 0.82,
    "valid_until": "2026-08-14T10:00:00.000Z"
  },
  "why_now": {
    "signal_class": "CORROBORATED_SIGNAL",
    "independent_source_count": 3
  },
  "evidence": [{ "url": "https://original.example/..." }],
  "founder_reviewed": true,
  "auto_publish": false
}`;

export function ApiPreview({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`api-flow ${compact ? "compact" : ""}`.trim()}>
      <section className="api-window">
        <div className="api-window-bar">
          <span>01</span>
          <code>POST /v1/next-move</code>
          <small>CREATE</small>
        </div>
        <pre aria-label="Create a Next Move request" tabIndex={0}>
          <code>{request}</code>
        </pre>
      </section>
      <section className="api-window">
        <div className="api-window-bar">
          <span>02</span>
          <code>202 Accepted</code>
          <small>POLL</small>
        </div>
        <pre aria-label="Queued Next Move response" tabIndex={0}>
          <code>{accepted}</code>
        </pre>
      </section>
      <section className="api-window final-response">
        <div className="api-window-bar">
          <span>03</span>
          <code>GET status_url</code>
          <small>READY</small>
        </div>
        <pre aria-label="Founder-reviewed Next Move response" tabIndex={0}>
          <code>{ready}</code>
        </pre>
      </section>
    </div>
  );
}
