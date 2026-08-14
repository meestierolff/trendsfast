"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Script from "next/script";
import { sendFirstPartyAnalytics } from "../lib/analytics-client";
import {
  getBrowserTurnstile,
  removeTurnstileWidget,
  resetTurnstileWidget,
} from "../lib/turnstile-client";
import { PUBLIC_SCAN_TURNSTILE_ACTION } from "../lib/turnstile-contract";
import { FounderLaunchInterestForm } from "./founder-launch-interest-form";

export function ScanForm({
  compact = false,
  formId,
  buttonLabel = "Find my next move",
  analyticsPlacement,
}: {
  compact?: boolean;
  formId?: string;
  buttonLabel?: string;
  analyticsPlacement?: "homepage_hero" | "homepage_repeat" | "homepage_final" | "agents";
}) {
  const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim();
  const inputId = formId
    ? `${formId}-product-url`
    : compact
      ? "product-url-compact"
      : "product-url";
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [capacityReached, setCapacityReached] = useState(false);
  const [turnstileReady, setTurnstileReady] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const turnstileContainer = useRef<HTMLDivElement>(null);
  const turnstileWidgetId = useRef<string | null>(null);

  useEffect(() => {
    if (
      !turnstileSiteKey ||
      !turnstileReady ||
      !turnstileContainer.current ||
      turnstileWidgetId.current
    ) {
      return;
    }
    const client = getBrowserTurnstile();
    if (!client) return;
    const widgetId = client.render(turnstileContainer.current, {
      sitekey: turnstileSiteKey,
      action: PUBLIC_SCAN_TURNSTILE_ACTION,
      theme: "dark",
      callback: (token) => setTurnstileToken(token),
      "expired-callback": () => setTurnstileToken(null),
      "error-callback": () => setTurnstileToken(null),
    });
    turnstileWidgetId.current = widgetId;

    return () => {
      removeTurnstileWidget(client, widgetId);
      if (turnstileWidgetId.current === widgetId) turnstileWidgetId.current = null;
    };
  }, [turnstileReady, turnstileSiteKey]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (analyticsPlacement) {
      sendFirstPartyAnalytics({ event: "hero_cta_clicked", placement: analyticsPlacement });
    }
    setPending(true);
    setError(null);
    setCapacityReached(false);
    const form = new FormData(event.currentTarget);

    try {
      const response = await fetch("/api/scan-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product_url: form.get("product_url"),
          website: form.get("website"),
          turnstile_token: turnstileToken,
        }),
      });
      const payload = (await response.json()) as {
        token?: string;
        error?: string;
        message?: string;
      };
      if (!response.ok || !payload.token) {
        if (payload.error === "TODAYS_FOUNDER_REVIEW_CAPACITY_REACHED") {
          setCapacityReached(true);
        }
        throw new Error(payload.message ?? payload.error ?? "The request could not be accepted.");
      }
      router.push(`/scan/requested/${payload.token}`);
    } catch (submissionError) {
      resetTurnstileWidget(getBrowserTurnstile(), turnstileWidgetId.current);
      setTurnstileToken(null);
      setError(
        submissionError instanceof Error ? submissionError.message : "Something went wrong.",
      );
      setPending(false);
    }
  }

  return (
    <>
      {turnstileSiteKey ? (
        <Script
          src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
          strategy="afterInteractive"
          onReady={() => setTurnstileReady(true)}
        />
      ) : null}
      <form className={compact ? "scan-form compact" : "scan-form"} onSubmit={submit} id={formId}>
        <div className="scan-input-row">
          <span className="protocol" aria-hidden="true">
            ↗
          </span>
          <label className="sr-only" htmlFor={inputId}>
            Product URL
          </label>
          <input
            id={inputId}
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
            {pending ? "Accepting…" : buttonLabel}
            <span aria-hidden="true">→</span>
          </button>
        </div>
        {turnstileSiteKey ? <div className="turnstile-widget" ref={turnstileContainer} /> : null}
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
      {capacityReached ? (
        <FounderLaunchInterestForm
          source="homepage"
          consentLabel="Email me when another founder-reviewed launch slot or Founder Cloud access is available."
          submitLabel="Join launch interest"
          successMessage="You're on the launch-interest list."
          errorMessage="We could not save your interest. Please try again."
          className="launch-interest-form"
        />
      ) : null}
    </>
  );
}
