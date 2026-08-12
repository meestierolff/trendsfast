"use client";

import { useState } from "react";

export function DeliveredMonitoringCta({ token }: { token: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function startCheckout() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/scans/${encodeURIComponent(token)}/billing/checkout`, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
      });
      const body = (await response.json().catch(() => null)) as {
        url?: string;
        error?: string;
      } | null;
      if (!response.ok || !body?.url) {
        throw new Error(body?.error ?? "Checkout is unavailable.");
      }
      window.location.assign(body.url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Checkout is unavailable.");
      setPending(false);
    }
  }

  return (
    <section className="scan-safety-note" aria-labelledby="monitor-product-title">
      <span aria-hidden="true">↻</span>
      <div>
        <p className="scan-mono-label">Optional monitoring</p>
        <h2 id="monitor-product-title">Keep watching this product.</h2>
        <p>One monitored product, one scheduled run per UTC day, and bounded usage.</p>
        {error ? <small role="alert">{error}</small> : null}
      </div>
      <button type="button" onClick={() => void startCheckout()} disabled={pending}>
        {pending ? "Opening secure Checkout…" : "Monitor this product — $39/month"}
      </button>
    </section>
  );
}
