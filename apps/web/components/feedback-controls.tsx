"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";

const feedbackOptions = [
  { kind: "WOULD_USE", label: "I would use this" },
  { kind: "RELEVANT_WRONG_ANGLE", label: "Relevant, wrong angle" },
  { kind: "NOT_RELEVANT", label: "Not relevant" },
  { kind: "USED_OR_PUBLISHED", label: "I used/published this" },
  { kind: "REQUEST_ANOTHER_SCAN", label: "Request another scan" },
] as const;

type FeedbackKind = (typeof feedbackOptions)[number]["kind"];
type RequestState = "idle" | "pending" | "success" | "error";

async function postJson(path: string, body: Record<string, unknown>): Promise<void> {
  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) throw new Error("Request failed");
}

export function FeedbackControls({ token }: { token: string }) {
  const encodedToken = encodeURIComponent(token);
  const [feedbackState, setFeedbackState] = useState<RequestState>("idle");
  const [selectedFeedback, setSelectedFeedback] = useState<FeedbackKind | null>(null);
  const [shareChecked, setShareChecked] = useState(false);
  const [shareState, setShareState] = useState<RequestState>("idle");

  async function submitFeedback(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    if (!(submitter instanceof HTMLButtonElement)) return;

    const kind = submitter.value as FeedbackKind;
    if (!feedbackOptions.some((option) => option.kind === kind)) return;

    setSelectedFeedback(kind);
    setFeedbackState("pending");
    try {
      await postJson(`/api/scans/${encodedToken}/feedback`, { kind });
      setFeedbackState("success");
    } catch {
      setFeedbackState("error");
    }
  }

  async function submitShareConsent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!shareChecked) return;

    setShareState("pending");
    try {
      await postJson(`/api/scans/${encodedToken}/share-consent`, { consent: true });
      setShareState("success");
    } catch {
      setShareState("error");
    }
  }

  return (
    <section className="scan-feedback-section" aria-labelledby="scan-feedback-title">
      <div className="scan-feedback-heading">
        <div>
          <p className="scan-mono-label">Your signal back to us</p>
          <h2 id="scan-feedback-title">Was this move useful?</h2>
        </div>
        <p>One tap helps tune future ranking. It does not change or publish this result.</p>
      </div>

      <form
        className="scan-feedback-form"
        action={`/api/scans/${encodedToken}/feedback`}
        method="post"
        onSubmit={submitFeedback}
      >
        <fieldset disabled={feedbackState === "pending" || feedbackState === "success"}>
          <legend className="sr-only">Choose feedback for this Next Move</legend>
          {feedbackOptions.map((option, index) => (
            <button
              key={option.kind}
              type="submit"
              name="kind"
              value={option.kind}
              data-selected={feedbackState === "success" && selectedFeedback === option.kind}
            >
              <span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
              {option.label}
              <i aria-hidden="true">→</i>
            </button>
          ))}
        </fieldset>
        <p className="scan-form-notice" aria-live="polite">
          {feedbackState === "pending" ? "Recording your feedback…" : null}
          {feedbackState === "success" && selectedFeedback !== "REQUEST_ANOTHER_SCAN"
            ? "Feedback recorded. Thank you."
            : null}
          {feedbackState === "success" && selectedFeedback === "REQUEST_ANOTHER_SCAN" ? (
            <>
              Request recorded. <Link href="/#scan">Start another scan.</Link>
            </>
          ) : null}
          {feedbackState === "error" ? "We couldn’t record that yet. Please try again." : null}
        </p>
      </form>

      <form
        className="scan-share-form"
        action={`/api/scans/${encodedToken}/share-consent`}
        method="post"
        onSubmit={submitShareConsent}
      >
        <div className="scan-share-copy">
          <p className="scan-mono-label">Private by default</p>
          <h3>Opt in to a public scan case study</h3>
          <p>
            Only opt in if you are comfortable making this product context, recommendation, and its
            evidence receipts public. Your private delivery token is never published.
          </p>
        </div>
        <div className="scan-share-action">
          <label>
            <input
              type="checkbox"
              name="consent"
              value="true"
              checked={shareChecked}
              disabled={shareState === "pending" || shareState === "success"}
              onChange={(event) => setShareChecked(event.currentTarget.checked)}
            />
            <span>I explicitly consent to public sharing</span>
          </label>
          <button
            type="submit"
            disabled={!shareChecked || shareState === "pending" || shareState === "success"}
          >
            {shareState === "pending"
              ? "Saving consent…"
              : shareState === "success"
                ? "Consent saved"
                : "Allow public sharing"}
          </button>
          <p className="scan-form-notice" aria-live="polite">
            {shareState === "success" ? "Public-share consent recorded." : null}
            {shareState === "error" ? "Consent was not saved. This result remains private." : null}
          </p>
        </div>
      </form>
    </section>
  );
}
