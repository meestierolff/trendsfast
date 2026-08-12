"use client";

import { useState, type FormEvent, type ReactNode } from "react";

type SubmissionState = "idle" | "pending" | "success" | "error";

export function FounderLaunchInterestForm({
  source,
  consentLabel,
  submitLabel,
  successMessage,
  errorMessage,
  className,
}: {
  source: "homepage" | "pricing";
  consentLabel: ReactNode;
  submitLabel: string;
  successMessage: string;
  errorMessage: string;
  className?: string;
}) {
  const [state, setState] = useState<SubmissionState>("idle");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setState("pending");
    try {
      const response = await fetch("/api/founder-launch-interest", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: form.get("email"),
          consent: form.get("consent") === "true",
          source,
          website: form.get("website"),
        }),
      });
      const result = (await response.json()) as { joined?: unknown };
      if (!response.ok || result.joined !== true) throw new Error("Launch interest was not saved");
      formElement.reset();
      setState("success");
    } catch {
      setState("error");
    }
  }

  return (
    <form className={className} onSubmit={submit}>
      <label className="launch-interest-email">
        <span>Email address</span>
        <input
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          maxLength={254}
          required
          disabled={state === "pending" || state === "success"}
        />
      </label>
      <input
        className="honeypot"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
      />
      <label className="launch-interest-consent">
        <input
          name="consent"
          type="checkbox"
          value="true"
          required
          disabled={state === "pending" || state === "success"}
        />
        <span>{consentLabel}</span>
      </label>
      <button
        className="button button-primary"
        type="submit"
        disabled={state === "pending" || state === "success"}
      >
        {state === "pending" ? "Saving…" : submitLabel}
      </button>
      <p className="launch-interest-status" aria-live="polite">
        {state === "success" ? successMessage : null}
        {state === "error" ? errorMessage : null}
      </p>
    </form>
  );
}
