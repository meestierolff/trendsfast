"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export function ScanForm({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const form = new FormData(event.currentTarget);

    try {
      const response = await fetch("/api/scan-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product_url: form.get("product_url"),
          website: form.get("website"),
          turnstile_token: form.get("turnstile_token"),
        }),
      });
      const payload = (await response.json()) as { token?: string; error?: string };
      if (!response.ok || !payload.token)
        throw new Error(payload.error ?? "The request could not be accepted.");
      router.push(`/scan/requested/${payload.token}`);
    } catch (submissionError) {
      setError(
        submissionError instanceof Error ? submissionError.message : "Something went wrong.",
      );
      setPending(false);
    }
  }

  return (
    <form className={compact ? "scan-form compact" : "scan-form"} onSubmit={submit} id="scan">
      <div className="scan-input-row">
        <span className="protocol" aria-hidden="true">
          ↗
        </span>
        <label className="sr-only" htmlFor={compact ? "product-url-compact" : "product-url"}>
          Product URL
        </label>
        <input
          id={compact ? "product-url-compact" : "product-url"}
          name="product_url"
          type="url"
          inputMode="url"
          autoComplete="url"
          placeholder="https://yourproduct.com"
          required
          maxLength={2048}
        />
        <input
          className="honeypot"
          name="website"
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
        />
        <button type="submit" disabled={pending}>
          {pending ? "Accepting…" : "Run a free scan"}
          <span aria-hidden="true">→</span>
        </button>
      </div>
      {!compact ? (
        <p className="form-privacy">
          Private by default. Public sharing is a separate opt-in after delivery.
        </p>
      ) : null}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
