"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { isoToUtcDateTimeValue, utcDateTimeValueToIso } from "../lib/utc-datetime";

type ActionResponse = {
  ok?: boolean;
  error?: string;
  deliveryUrl?: string | null;
  deliveryToken?: string | null;
  created?: boolean;
  expiresAt?: string;
};

type EditableMove = {
  reviewVersion: number;
  proposalStale: boolean;
  topic: string;
  angle: string;
  channel: string;
  format: string;
  hook: string;
  outline: readonly string[];
  cta: string;
  whyNow: string;
  limitations: readonly string[];
  validUntil: string;
  confidenceRationale: string;
};

type EditableContext = {
  productName: string;
  audience: string;
  problem: string;
  desiredOutcome: string;
  credibleClaims: readonly string[];
  credibleTopics: readonly string[];
  suitableChannels: readonly string[];
  availableFormats: readonly string[];
  assumptions: readonly string[];
};

function lines(form: FormData, name: string): string[] {
  return String(form.get(name) ?? "")
    .split("\n")
    .map((value) => value.trim())
    .filter(Boolean);
}

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
  reviewVersion,
  canReview,
  verified,
  availability,
}: {
  scanId: string;
  csrfToken: string;
  receiptId: string;
  reviewVersion: number;
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
      expectedVersion: reviewVersion,
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
        onClick={() =>
          void action.post("verify-evidence", {
            evidenceReceiptId: receiptId,
            expectedVersion: reviewVersion,
          })
        }
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
      const response = await fetch(`/api/ops/scans/${encodeURIComponent(scanId)}/manual-evidence`, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
        body: JSON.stringify({
          url: form.get("url"),
          sourceLabel: form.get("sourceLabel"),
          title: form.get("title"),
          excerpt: String(form.get("excerpt") ?? "").trim() || undefined,
          ...(publishedAtValue ? { publishedAt: new Date(publishedAtValue).toISOString() } : {}),
          ...(Object.keys(metrics).length ? { visibleEngagement: metrics } : {}),
          reason: form.get("reason"),
        }),
      });
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
          supplemental receipt to this exact draft. It never bypasses the evidence ledger or changes
          the prior synthesis.
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
  editableMove,
  editableContext,
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
  editableMove?: EditableMove;
  editableContext?: EditableContext;
}) {
  const router = useRouter();
  const action = useOpsAction(scanId, csrfToken);
  const [delivery, setDelivery] = useState<{
    url: string;
    token: string;
    expiresAt?: string;
  } | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const canReview =
    requestState === "REVIEW_REQUIRED" &&
    moveState === "DRAFT" &&
    !autoPublish &&
    editableMove?.proposalStale !== true;
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
    if (!editableMove) return;
    const form = new FormData(event.currentTarget);
    await action.post("approve", {
      expectedVersion: editableMove.reviewVersion,
      note: form.get("note") || undefined,
    });
  }

  async function convertToWait(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editableMove) return;
    const form = new FormData(event.currentTarget);
    await action.post("convert-to-wait", {
      reason: form.get("reason"),
      expectedVersion: editableMove.reviewVersion,
      validForHours: Number(form.get("validForHours")),
    });
  }

  async function editAndApprove(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editableMove) return;
    const form = new FormData(event.currentTarget);
    await action.post("edit-and-approve", {
      expectedVersion: editableMove.reviewVersion,
      reason: form.get("reason"),
      topic: form.get("topic"),
      angle: form.get("angle"),
      channel: form.get("channel"),
      format: form.get("format"),
      hook: form.get("hook"),
      outline: lines(form, "outline"),
      cta: form.get("cta"),
      whyNow: form.get("whyNow"),
      limitations: lines(form, "limitations"),
      validUntil: utcDateTimeValueToIso(String(form.get("validUntil") ?? "")),
      confidenceRationale: form.get("confidenceRationale"),
    });
  }

  async function correctContext(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editableMove || !editableContext) return;
    const form = new FormData(event.currentTarget);
    await action.post("correct-context", {
      expectedVersion: editableMove.reviewVersion,
      reason: form.get("reason"),
      productName: form.get("productName"),
      audience: form.get("audience"),
      problem: form.get("problem"),
      desiredOutcome: form.get("desiredOutcome"),
      credibleClaims: lines(form, "credibleClaims"),
      credibleTopics: lines(form, "credibleTopics"),
      suitableChannels: lines(form, "suitableChannels"),
      availableFormats: lines(form, "availableFormats"),
      assumptions: lines(form, "assumptions"),
    });
  }

  async function recomputeStored(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editableMove) return;
    const form = new FormData(event.currentTarget);
    await action.post("recompute-stored", {
      expectedVersion: editableMove.reviewVersion,
      reason: form.get("reason"),
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
        {canReview && editableMove ? (
          <details className="ops-fail-control">
            <summary>Edit recommendation</summary>
            <form onSubmit={editAndApprove}>
              <p>
                Action, evidence, truth class, score, source count, metrics, providers, and cost
                stay immutable. Saving validates the current version and approves the edited copy.
              </p>
              <label htmlFor="edit-topic">Topic</label>
              <input
                id="edit-topic"
                name="topic"
                defaultValue={editableMove.topic}
                required
                maxLength={500}
              />
              <label htmlFor="edit-angle">Angle</label>
              <textarea
                id="edit-angle"
                name="angle"
                defaultValue={editableMove.angle}
                required
                maxLength={4_000}
                rows={3}
              />
              <label htmlFor="edit-channel">Channel</label>
              <input
                id="edit-channel"
                name="channel"
                defaultValue={editableMove.channel}
                required
                maxLength={100}
              />
              <label htmlFor="edit-format">Format</label>
              <input
                id="edit-format"
                name="format"
                defaultValue={editableMove.format}
                required
                maxLength={100}
              />
              <label htmlFor="edit-hook">Hook</label>
              <textarea
                id="edit-hook"
                name="hook"
                defaultValue={editableMove.hook}
                required
                maxLength={4_000}
                rows={3}
              />
              <label htmlFor="edit-outline">Outline · one item per line</label>
              <textarea
                id="edit-outline"
                name="outline"
                defaultValue={editableMove.outline.join("\n")}
                required
                maxLength={12_000}
                rows={5}
              />
              <label htmlFor="edit-cta">CTA</label>
              <textarea
                id="edit-cta"
                name="cta"
                defaultValue={editableMove.cta}
                required
                maxLength={4_000}
                rows={2}
              />
              <label htmlFor="edit-why-now">Why now</label>
              <textarea
                id="edit-why-now"
                name="whyNow"
                defaultValue={editableMove.whyNow}
                required
                maxLength={4_000}
                rows={3}
              />
              <label htmlFor="edit-limitations">Limitations · one per line</label>
              <textarea
                id="edit-limitations"
                name="limitations"
                defaultValue={editableMove.limitations.join("\n")}
                maxLength={50_000}
                rows={4}
              />
              <label htmlFor="edit-confidence">Confidence rationale</label>
              <textarea
                id="edit-confidence"
                name="confidenceRationale"
                defaultValue={editableMove.confidenceRationale}
                required
                maxLength={4_000}
                rows={3}
              />
              <label htmlFor="edit-valid-until">Valid until · UTC</label>
              <input
                id="edit-valid-until"
                name="validUntil"
                type="datetime-local"
                step="0.001"
                defaultValue={isoToUtcDateTimeValue(editableMove.validUntil)}
                required
              />
              <label htmlFor="edit-reason">Edit reason</label>
              <textarea
                id="edit-reason"
                name="reason"
                required
                minLength={10}
                maxLength={4_000}
                rows={3}
              />
              <button type="submit" disabled={action.pending !== null}>
                {action.pending === "edit-and-approve" ? "Validating…" : "Edit and approve"}
              </button>
            </form>
          </details>
        ) : null}

        {canReview && editableMove && editableContext ? (
          <details className="ops-fail-control">
            <summary>Correct context</summary>
            <form onSubmit={correctContext}>
              <p>
                Creates an immutable context version, stales the old proposal, and reranks only
                stored evidence. No provider call or model synthesis runs; receipts require renewed
                review.
              </p>
              <label htmlFor="context-name">Product name</label>
              <input
                id="context-name"
                name="productName"
                defaultValue={editableContext.productName}
                required
                maxLength={200}
              />
              <label htmlFor="context-audience">Audience</label>
              <textarea
                id="context-audience"
                name="audience"
                defaultValue={editableContext.audience}
                required
                maxLength={4_000}
                rows={3}
              />
              <label htmlFor="context-problem">Problem</label>
              <textarea
                id="context-problem"
                name="problem"
                defaultValue={editableContext.problem}
                required
                maxLength={4_000}
                rows={3}
              />
              <label htmlFor="context-outcome">Desired outcome</label>
              <textarea
                id="context-outcome"
                name="desiredOutcome"
                defaultValue={editableContext.desiredOutcome}
                required
                maxLength={4_000}
                rows={3}
              />
              {(
                [
                  ["credibleClaims", "Credible claims", editableContext.credibleClaims],
                  ["credibleTopics", "Credible topics", editableContext.credibleTopics],
                  ["suitableChannels", "Suitable channels", editableContext.suitableChannels],
                  ["availableFormats", "Available formats", editableContext.availableFormats],
                  ["assumptions", "Assumptions", editableContext.assumptions],
                ] as const
              ).map(([name, label, values]) => (
                <label key={name}>
                  {label} · one per line
                  <textarea name={name} defaultValue={values.join("\n")} rows={3} />
                </label>
              ))}
              <label htmlFor="context-reason">Correction reason</label>
              <textarea
                id="context-reason"
                name="reason"
                required
                minLength={10}
                maxLength={4_000}
                rows={3}
              />
              <button type="submit" disabled={action.pending !== null}>
                {action.pending === "correct-context"
                  ? "Correcting and reranking…"
                  : "Correct context + recompute"}
              </button>
            </form>
          </details>
        ) : null}

        {canReview && editableMove ? (
          <details className="ops-fail-control">
            <summary>Recompute from stored evidence</summary>
            <form onSubmit={recomputeStored}>
              <p>
                Reruns deterministic ranking and the quality floor only. It makes zero provider
                calls and requires renewed evidence review.
              </p>
              <label htmlFor="recompute-reason">Why recompute</label>
              <textarea
                id="recompute-reason"
                name="reason"
                required
                minLength={10}
                maxLength={4_000}
                rows={3}
              />
              <button type="submit" disabled={action.pending !== null}>
                {action.pending === "recompute-stored"
                  ? "Recomputing…"
                  : "Recompute stored evidence"}
              </button>
            </form>
          </details>
        ) : null}

        <div className="ops-action-card">
          <span>DOGFOOD / REDACTED</span>
          <h3>Export review bundle</h3>
          <p>
            Founder-only, no-store exports exclude capabilities, secrets, raw payloads, e-mail, and
            IP addresses.
          </p>
          <a href={`/api/ops/scans/${encodeURIComponent(scanId)}/review-bundle.json`} download>
            Download JSON
          </a>
          <a href={`/api/ops/scans/${encodeURIComponent(scanId)}/review-bundle.md`} download>
            Download Markdown
          </a>
        </div>

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
