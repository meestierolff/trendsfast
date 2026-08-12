"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";

export function OpsProviderVerificationControl({ csrfToken }: { csrfToken: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const attempt = useRef<{ payload: string; id: string } | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const provider = String(form.get("provider"));
    setPending(true);
    setNotice(null);
    try {
      const requestPayload = JSON.stringify({
        productUrl: String(form.get("productUrl") ?? "").trim() || undefined,
        query: String(form.get("query") ?? "").trim() || undefined,
        market: String(form.get("market") ?? "").trim() || undefined,
        language: String(form.get("language") ?? "").trim() || undefined,
      });
      const attemptPayload = `${provider}\n${requestPayload}`;
      if (!attempt.current || attempt.current.payload !== attemptPayload) {
        attempt.current = { payload: attemptPayload, id: crypto.randomUUID() };
      }
      const response = await fetch(`/api/ops/providers/${encodeURIComponent(provider)}/verify`, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": csrfToken,
          "idempotency-key": attempt.current.id,
        },
        body: requestPayload,
      });
      const payload = (await response.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
        state?: string;
      } | null;
      if (payload?.state && payload.state !== "RUNNING") attempt.current = null;
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error ?? "Provider verification failed.");
      }
      setNotice(
        payload.state === "RUNNING"
          ? "This durable verification attempt is already running. Submit again to read its final state without starting another provider call."
          : `Durable verification completed with technical state ${payload.state}.`,
      );
      router.refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Provider verification failed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="ops-action-card" onSubmit={submit}>
      <span>BOUNDED / EXPLICIT EXTERNAL READ</span>
      <p>
        The runner checks configuration and health first, then performs one bounded source read.
        Fixture or credential-only checks never become VERIFIED.
      </p>
      <label htmlFor="verification-provider">Provider</label>
      <select id="verification-provider" name="provider" defaultValue="website">
        <option value="website">Product website</option>
        <option value="hacker_news">Hacker News</option>
        <option value="google_trends">DataForSEO Google Trends</option>
        <option value="tavily">Tavily</option>
        <option value="x">xAI X Search</option>
        <option value="github">GitHub</option>
        <option value="youtube">YouTube</option>
      </select>
      <label htmlFor="verification-url">Product / target URL (required for website)</label>
      <input id="verification-url" name="productUrl" type="url" maxLength={2_048} />
      <label htmlFor="verification-query">Bounded query (required for other sources)</label>
      <input id="verification-query" name="query" maxLength={180} />
      <label htmlFor="verification-market">Market</label>
      <input id="verification-market" name="market" maxLength={16} defaultValue="US" />
      <label htmlFor="verification-language">Language</label>
      <input id="verification-language" name="language" maxLength={16} defaultValue="en" />
      <button type="submit" disabled={pending}>
        {pending ? "Running bounded verification…" : "Run and persist verification"}
      </button>
      {notice ? <p className="ops-action-notice">{notice}</p> : null}
    </form>
  );
}
