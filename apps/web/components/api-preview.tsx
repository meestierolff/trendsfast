const response = `{
  "status": "READY",
  "next_move": {
    "action": "PUBLISH",
    "channel": "x",
    "topic": "Evidence-first distribution agents",
    "confidence": 0.82
  },
  "why_now": {
    "signal_class": "CORROBORATED_SIGNAL",
    "independent_source_count": 3
  },
  "founder_reviewed": true,
  "auto_publish": false
}`;

export function ApiPreview() {
  return (
    <div className="api-window">
      <div className="api-window-bar">
        <span>POST</span>
        <code>/v1/next-move</code>
        <small>202 → READY</small>
      </div>
      <pre aria-label="Example API response" tabIndex={0}>
        <code>{response}</code>
      </pre>
    </div>
  );
}
