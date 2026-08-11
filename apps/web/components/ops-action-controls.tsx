"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

type ActionResponse = {
  ok?: boolean;
  error?: string;
  deliveryUrl?: string | null;
  deliveryToken?: string | null;
  created?: boolean;
  expiresAt?: string;
};

function useOpsAction(scanId: string, csrfToken: string) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "success" | "error"; message: string } | null>(null);

  async function post(
    action: string,
    body: Record<string, unknown>,
    options: { refresh?: boolean } = {},
  ): Promise<ActionResponse | null> {
    setPending(action);
    setNotice(null);
    try {
      const response = await fetch(
        `/api/ops/scans/${encodeURIComponent(scanId)}/actions/${encodeURIComponent(action)}`,
        {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": csrfToken,
          },
          body: JSON.stringify(body),
        },
      );
      const payload = (await response.json().catch(() => null)) as ActionResponse | null;
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error ?? "The action could not be completed.");
      }
      setNotice({ kind: "success", message: "Action persisted." });
      if (options.refresh !== false) router.refresh();
      return payload;
    } catch (error) {
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "The action could not be completed.",
      });
      return null;
    } finally {
      setPending(null);
    }
  }

  return { pending, notice, post };
}

export function OpsEvidenceControls({
  scanId,
  csrfToken,
  receiptId,
  canReview,
  verified,
  availability,
}: {
  scanId: string;
  csrfToken: string;
  receiptId: string;
  canReview: boolean;
  verified: boolean;
  availability: string;
}) {
  const action = useOpsAction(scanId, csrfToken);

  async function reject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await action.post("reject-evidence", {
      evidenceReceiptId: receiptId,
      reason: form.get("reason"),
    });
  }

  if (!canReview) {
    return (
      <p className="ops-evidence-locked">
        Evidence actions closed · {verified ? "verified" : "not verified"} ·{" "}
        {availability.toLowerCase()}
      </p>
    );
  }

  return (
    <div className="ops-evidence-actions">
      <button
        type="button"
        onClick={() => void action.post("verify-evidence", { evidenceReceiptId: receiptId })}
        disabled={action.pending !== null || (verified && availability === "AVAILABLE")}
      >
        {action.pending === "verify-evidence"
          ? "Verifying…"
          : verified
            ? "Verified"
            : "Verify receipt"}
      </button>
      <details>
        <summary>Reject receipt</summary>
        <form onSubmit={reject}>
          <label htmlFor={`reject-${receiptId}`}>Why this evidence cannot support the move</label>
          <textarea
            id={`reject-${receiptId}`}
            name="reason"
            required
            minLength={10}
            maxLength={4_000}
            rows={3}
          />
          <button type="submit" disabled={action.pending !== null}>
            {action.pending === "reject-evidence" ? "Rejecting…" : "Confirm rejection"}
          </button>
        </form>
      </details>
      {action.notice ? (
        <p className="ops-action-notice" data-kind={action.notice.kind} role="status">
          {action.notice.message}
        </p>
      ) : null}
    </div>
  );
}

export function OpsManualEvidenceControl({
  scanId,
  csrfToken,
  canReview,
}: {
  scanId: string;
  csrfToken: string;
  canReview: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<{ kind: "success" | "error"; message: string } | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const publishedAtValue = String(form.get("publishedAt") ?? "").trim();
    const metrics = Object.fromEntries(
      ["views", "likes", "comments", "shares", "points", "stars", "forks"].flatMap((key) => {
        const raw = String(form.get(key) ?? "").trim();
        return raw ? [[key, Number(raw)]] : [];
      }),
    );
    setPending(true);
    setNotice(null);
    try {
      const response = await fetch(
        `/api/ops/scans/${encodeURIComponent(scanId)}/manual-evidence`,
        {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
          body: JSON.stringify({
            url: form.get("url"),
            sourceLabel: form.get("sourceLabel"),
            title: form.get("title"),
            excerpt: String(form.get("excerpt") ?? "").trim() || undefined,
            ...(publishedAtValue
              ? { publishedAt: new Date(publishedAtValue).toISOString() }
              : {}),
            ...(Object.keys(metrics).length ? { visibleEngagement: metrics } : {}),
            reason: form.get("reason"),
          }),
        },
      );
      const payload = (await response.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
      } | null;
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error ?? "Manual evidence could not be stored.");
      }
      event.currentTarget.reset();
      setNotice({
        kind: "success",
        message:
          "Manual provider signal stored, bound as supplemental, and audited. It does not qualify approval or alter decision counts.",
      });
      router.refresh();
    } catch (error) {
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Manual evidence could not be stored.",
      });
    } finally {
      setPending(false);
    }
  }

  if (!canReview) return null;
  return (
    <details className="ops-fail-control">
      <summary>Add founder-observed public evidence</summary>
      <form onSubmit={submit}>
        <p>
          The manual adapter validates a public URL, stores one canonical signal, and binds the
          supplemental receipt to this exact draft. It never bypasses the evidence ledger or
          changes the prior synthesis.
        </p>
        <label htmlFor="manual-source-label">Source label</label>
        <input
          id="manual-source-label"
          name="sourceLabel"
          required
          maxLength={100}
          placeholder="Founder-observed launch post"
        />
        <label htmlFor="manual-url">Original public URL</label>
        <input id="manual-url" name="url" type="url" required maxLength={2_048} />
        <label htmlFor="manual-title">Evidence title</label>
        <input id="manual-title" name="title" required maxLength={500} />
        <label htmlFor="manual-excerpt">Optional public excerpt</label>
        <textarea id="manual-excerpt" name="excerpt" maxLength={2_000} rows={3} />
        <label htmlFor="manual-published">Optional published timestamp</label>
        <input id="manual-published" name="publishedAt" type="datetime-local" />
        <fieldset>
          <legend>Optional visible engagement (not independently fetched)</legend>
          <label>
            Views <input name="views" type="number" min={0} step={1} />
          </label>
          <label>
            Likes <input name="likes" type="number" min={0} step={1} />
          </label>
          <label>
            Comments <input name="comments" type="number" min={0} step={1} />
          </label>
        </fieldset>
        <label htmlFor="manual-reason">Why this original supports the current move</label>
        <textarea
          id="manual-reason"
          name="reason"
          required
          minLength={10}
          maxLength={1_000}
          rows={4}
        />
        <button type="submit" disabled={pending}>
          {pending ? "Validating and binding…" : "Add exact manual evidence"}
        </button>
        {notice ? (
          <p className="ops-action-notice" data-kind={notice.kind} role="status">
            {notice.message}
          </p>
        ) : null}
      </form>
    </details>
  );
}

export function OpsActionControls({
  scanId,
  csrfToken,
  requestState,
  runState,
  moveState,
  moveAction,
  founderReviewed,
  autoPublish,
  retryEnabled,
}: {
  scanId: string;
  csrfToken: string;
  requestState: string;
  runState?: string | null;
  moveState?: string | null;
  moveAction?: string | null;
  founderReviewed?: boolean;
  autoPublish?: boolean;
  retryEnabled: boolean;
}) {
  const router = useRouter();
  const action = useOpsAction(scanId, csrfToken);
  const [delivery, setDelivery] = useState<{
    url: string;
    token: string;
    expiresAt?: string;
  } | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const canReview = requestState === "REVIEW_REQUIRED" && moveState === "DRAFT" && !autoPublish;
  const canDeliver =
    requestState === "REVIEW_REQUIRED" &&
    moveState === "APPROVED" &&
    founderReviewed === true &&
    !autoPublish;
  const canFail =
    ["QUEUED", "RUNNING", "REVIEW_REQUIRED"].includes(requestState) &&
    Boolean(runState && ["QUEUED", "RUNNING", "REVIEW_REQUIRED"].includes(runState));

  async function approve(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await action.post("approve", { note: form.get("note") || undefined });
  }

  async function convertToWait(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await action.post("convert-to-wait", {
      reason: form.get("reason"),
      validForHours: Number(form.get("validForHours")),
    });
  }

  async function deliver(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await action.post(
      "deliver",
      { expiresInDays: Number(form.get("expiresInDays")) },
      { refresh: false },
    );
    if (result?.deliveryUrl && result.deliveryToken) {
      setDelivery({
        url: result.deliveryUrl,
        token: result.deliveryToken,
        ...(result.expiresAt ? { expiresAt: result.expiresAt } : {}),
      });
    }
  }

  async function markFailed(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await action.post("mark-failed", {
      failureCode: form.get("failureCode"),
      failureMessage: form.get("failureMessage"),
    });
  }

  async function copyDeliveryLink() {
    if (!delivery) return;
    try {
      await navigator.clipboard.writeText(delivery.url);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
  }

  return (
    <section className="ops-review-actions" aria-labelledby="ops-actions-title">
      <div className="ops-detail-section-heading">
        <div>
          <p className="ops-kicker">State-changing controls</p>
          <h2 id="ops-actions-title">Review, then deliver.</h2>
        </div>
        <p>Approval never publishes. Delivery creates one private, expiring link.</p>
      </div>

      <div className="ops-action-grid">
        {canReview ? (
          <form className="ops-action-card" onSubmit={approve}>
            <span>01 / APPROVE</span>
            <h3>Approve this {moveAction ?? "Next Move"}</h3>
            <p>Requires at least one available verified receipt unless the move is WAIT.</p>
            <label htmlFor="approval-note">Optional review note</label>
            <textarea id="approval-note" name="note" maxLength={4_000} rows={3} />
            <button type="submit" disabled={action.pending !== null}>
              {action.pending === "approve" ? "Approving…" : "Approve move"}
            </button>
          </form>
        ) : null}

        {canReview ? (
          <form className="ops-action-card ops-wait-card" onSubmit={convertToWait}>
            <span>02 / TRUSTWORTHY NON-ACTION</span>
            <h3>Convert to WAIT</h3>
            <p>Use when relevance, freshness, independence, or credibility is inadequate.</p>
            <label htmlFor="wait-reason">Why no move passes the floor</label>
            <textarea
              id="wait-reason"
              name="reason"
              required
              minLength={10}
              maxLength={4_000}
              rows={4}
            />
            <label htmlFor="wait-validity">Recheck window</label>
            <select id="wait-validity" name="validForHours" defaultValue="24">
              <option value="24">24 hours</option>
              <option value="48">48 hours</option>
              <option value="72">72 hours</option>
              <option value="168">7 days</option>
            </select>
            <button type="submit" disabled={action.pending !== null}>
              {action.pending === "convert-to-wait" ? "Converting…" : "Convert and approve WAIT"}
            </button>
          </form>
        ) : null}

        {canDeliver && !delivery ? (
          <form className="ops-action-card ops-deliver-card" onSubmit={deliver}>
            <span>03 / PRIVATE DELIVERY</span>
            <h3>Issue the founder link</h3>
            <p>The raw token is shown once. Copy it before refreshing this record.</p>
            <label htmlFor="delivery-expiry">Link expiry</label>
            <select id="delivery-expiry" name="expiresInDays" defaultValue="30">
              <option value="7">7 days</option>
              <option value="30">30 days</option>
              <option value="90">90 days</option>
            </select>
            <button type="submit" disabled={action.pending !== null}>
              {action.pending === "deliver" ? "Issuing…" : "Issue private link"}
            </button>
          </form>
        ) : null}

        {delivery ? (
          <div className="ops-delivery-result" role="status">
            <span>ONE-TIME DELIVERY TOKEN</span>
            <h3>Copy this private link now.</h3>
            <p>The database stores only its hash. This raw token cannot be recovered later.</p>
            <label htmlFor="issued-delivery-url">Private result URL</label>
            <input
              id="issued-delivery-url"
              readOnly
              value={delivery.url}
              onFocus={(event) => event.currentTarget.select()}
            />
            <div>
              <button type="button" onClick={() => void copyDeliveryLink()}>
                {copyState === "copied" ? "Copied" : "Copy link"}
              </button>
              <button type="button" onClick={() => router.refresh()}>
                Reload record
              </button>
            </div>
            {delivery.expiresAt ? (
              <small>Expires {new Date(delivery.expiresAt).toUTCString()}</small>
            ) : null}
            {copyState === "error" ? <small>Select and copy the URL manually.</small> : null}
          </div>
        ) : null}

        {requestState === "FAILED" ? (
          <div className="ops-action-card">
            <span>RETRY / RESUMABLE</span>
            <h3>Requeue this failed scan</h3>
            <p>
              {retryEnabled
                ? "A new fixture attempt is claimed by the same bounded state machine."
                : "Disabled outside fixture mode until paid source-level resume is available."}
            </p>
            <button
              type="button"
              onClick={() => void action.post("retry", {})}
              disabled={action.pending !== null || !retryEnabled}
            >
              {action.pending === "retry" ? "Requeueing…" : "Retry scan"}
            </button>
          </div>
        ) : null}

        {canFail ? (
          <details className="ops-fail-control">
            <summary>Mark this scan failed</summary>
            <form onSubmit={markFailed}>
              <p>Use only when the persisted run cannot safely continue or enter review.</p>
              <label htmlFor="failure-code">Failure code</label>
              <input
                id="failure-code"
                name="failureCode"
                required
                minLength={2}
                maxLength={100}
                pattern="[A-Za-z0-9_:-]+"
                placeholder="FOUNDER_REJECTED_RUN"
              />
              <label htmlFor="failure-message">Safe operator explanation</label>
              <textarea
                id="failure-message"
                name="failureMessage"
                required
                minLength={10}
                maxLength={500}
                rows={3}
              />
              <button type="submit" disabled={action.pending !== null}>
                {action.pending === "mark-failed" ? "Persisting…" : "Confirm failed state"}
              </button>
            </form>
          </details>
        ) : null}

        {!canReview && !canDeliver && requestState !== "FAILED" && requestState === "READY" ? (
          <div className="ops-action-complete">
            <span>DELIVERED</span>
            <h3>This review is closed.</h3>
            <p>
              The move is founder reviewed, private by default, and still has auto_publish=false.
            </p>
          </div>
        ) : null}
      </div>

      {action.notice ? (
        <p className="ops-action-notice" data-kind={action.notice.kind} role="status">
          {action.notice.message}
        </p>
      ) : null}
    </section>
  );
}
