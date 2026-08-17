"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { DashboardRefreshControl } from "@/components/dashboard-refresh-control";
import type { DashboardProjectNextMoveInput } from "@/lib/dashboard-project-next-move";
import type { NextDistributionContentProposalV1 } from "@/lib/next-distribution-content-proposal";

type OutcomeKind = "PUBLISHED" | "REPLIED" | "REMIXED";

function completionFor(action: NextDistributionContentProposalV1["action"]): {
  kind: OutcomeKind;
  label: string;
} | null {
  switch (action) {
    case "PUBLISH":
      return { kind: "PUBLISHED", label: "Mark as posted" };
    case "REPLY":
      return { kind: "REPLIED", label: "Mark as replied" };
    case "REMIX":
      return { kind: "REMIXED", label: "Mark as remixed" };
    case "WAIT":
      return null;
  }
}

function copyableContent(proposal: NextDistributionContentProposalV1): string | null {
  if (proposal.content === null) return null;
  return typeof proposal.content === "string"
    ? proposal.content
    : JSON.stringify(proposal.content, null, 2);
}

function safeDestination(proposal: NextDistributionContentProposalV1): string | null {
  if (proposal.destination === null) return null;
  try {
    const url = new URL(proposal.destination);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function DashboardTodayActions({
  projectId,
  nextMoveId,
  proposal,
  agentPrompt,
  stale,
  refreshInput,
  reviewState,
  reviewVersion,
  evidenceReceiptIds,
  initialSkipped,
  activeRequestState,
}: {
  projectId: string;
  nextMoveId: string;
  proposal: NextDistributionContentProposalV1;
  agentPrompt: string;
  stale: boolean;
  refreshInput: DashboardProjectNextMoveInput | null;
  reviewState: "DRAFT" | "APPROVED" | "READY";
  reviewVersion: number;
  evidenceReceiptIds: string[];
  initialSkipped: boolean;
  activeRequestState: "QUEUED" | "RUNNING" | null;
}) {
  const router = useRouter();
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [skipped, setSkipped] = useState(initialSkipped);
  const [currentReviewState, setCurrentReviewState] = useState<
    "DRAFT" | "APPROVED" | "READY" | "REJECTED"
  >(reviewState);
  const [evidenceAttested, setEvidenceAttested] = useState(false);
  const [completed, setCompleted] = useState(false);

  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setNotice(`${label} copied.`);
    } catch {
      setNotice(`Could not copy ${label.toLowerCase()}; select it manually.`);
    }
  }

  async function outcome(kind: OutcomeKind): Promise<boolean> {
    setPending(true);
    setNotice(null);
    try {
      const response = await fetch(
        `/api/dashboard/projects/${encodeURIComponent(projectId)}/outcomes`,
        {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ nextMoveId, kind }),
        },
      );
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(body?.error ?? "The outcome could not be saved.");
      setNotice("Outcome saved.");
      return true;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The outcome could not be saved.");
      return false;
    } finally {
      setPending(false);
    }
  }

  const content = copyableContent(proposal);
  const destination = safeDestination(proposal);
  const completion = completionFor(proposal.action);

  async function submitReview(reviewDecision: "APPROVE" | "SKIP"): Promise<boolean> {
    setPending(true);
    setNotice(null);
    try {
      const response = await fetch(
        `/api/dashboard/projects/${encodeURIComponent(projectId)}/review`,
        {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            nextMoveId,
            expectedVersion: reviewVersion,
            decision: reviewDecision,
            evidenceReceiptIds,
            evidenceAttested: true,
          }),
        },
      );
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        throw new Error(body?.error ?? "The reviewed proposal could not be completed.");
      }
      if (reviewDecision === "SKIP") {
        setCurrentReviewState("REJECTED");
        setSkipped(true);
        setNotice("Reviewed and skipped. Nothing has been published.");
        router.refresh();
      } else {
        setCurrentReviewState("READY");
        setNotice("Review complete. The proposal is ready to use; nothing was auto-published.");
        router.refresh();
      }
      return true;
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "The reviewed proposal could not be completed.",
      );
      return false;
    } finally {
      setPending(false);
    }
  }

  async function complete() {
    if (completion && (await outcome(completion.kind))) setCompleted(true);
  }

  return (
    <div className="dashboard-proposal-controls">
      <p className="kicker">Founder controls</p>
      <h2>
        {currentReviewState === "DRAFT"
          ? "Review the exact evidence before this proposal can be used."
          : currentReviewState === "APPROVED"
            ? "Approval is saved. Finish the interrupted delivery."
            : skipped
              ? "This proposal was reviewed and skipped."
              : "Reviewed and ready—nothing was auto-published."}
      </h2>

      {currentReviewState === "DRAFT" || currentReviewState === "APPROVED" ? (
        <div className="dashboard-review-boundary">
          <label className="dashboard-evidence-attestation">
            <input
              type="checkbox"
              checked={evidenceAttested}
              disabled={pending || stale}
              onChange={(event) => setEvidenceAttested(event.currentTarget.checked)}
            />
            <span>
              {proposal.action === "WAIT"
                ? "I reviewed every decision-support receipt shown above, the limitations, and the no-action rationale for this WAIT proposal."
                : "I checked every decision-support receipt shown above and confirm it supports this exact proposal."}
            </span>
          </label>
          <div className="dashboard-outcome-actions">
            <button
              type="button"
              disabled={pending || stale || !evidenceAttested}
              onClick={() => void submitReview("APPROVE")}
            >
              {pending
                ? "Completing review…"
                : currentReviewState === "APPROVED"
                  ? "Finish reviewed delivery"
                  : "Approve proposal"}
            </button>
            {currentReviewState === "DRAFT" ? (
              <button
                type="button"
                disabled={pending || stale || !evidenceAttested}
                onClick={() => void submitReview("SKIP")}
              >
                Review and skip
              </button>
            ) : null}
          </div>
          <p>
            Approval records your review and creates the private READY delivery. It never posts,
            replies, or publishes for you.
          </p>
        </div>
      ) : null}

      {currentReviewState === "READY" && !skipped ? (
        <div className="dashboard-copy-actions">
          {content ? (
            <button
              type="button"
              disabled={stale}
              onClick={() => void copy(content, "Suggested content")}
            >
              Copy
            </button>
          ) : null}
          {proposal.action !== "WAIT" ? (
            destination && !stale ? (
              <a
                className="button button-secondary"
                href={destination}
                rel="noreferrer noopener"
                target="_blank"
              >
                Open destination
              </a>
            ) : (
              <button
                type="button"
                disabled
                title={
                  stale
                    ? "Request a fresh move before opening this destination."
                    : "This result identifies a channel but does not contain a destination URL."
                }
              >
                {stale ? "Destination stale" : "Open destination unavailable"}
              </button>
            )
          ) : null}
          <button
            type="button"
            disabled={stale}
            onClick={() => void copy(agentPrompt, "Agent continuation")}
          >
            Continue in my agent
          </button>
          {completion ? (
            <button
              type="button"
              disabled={pending || completed || stale}
              onClick={() => void complete()}
            >
              {completed ? "Outcome saved" : completion.label}
            </button>
          ) : null}
        </div>
      ) : null}

      {activeRequestState ? (
        <div className="dashboard-panel dashboard-panel-wide" role="status">
          <p className="kicker">REST status · {activeRequestState}</p>
          <p>
            A fresh proposal is already in progress. Project single-flight admission prevents a
            second provider-cost reservation; refresh the page after Retry-After.
          </p>
        </div>
      ) : refreshInput ? (
        <DashboardRefreshControl
          projectId={projectId}
          request={refreshInput}
          label={stale ? "Request a fresh move" : "Request refresh"}
        />
      ) : (
        <div className="dashboard-copy-actions">
          <Link
            className="button button-secondary"
            href={`/dashboard/projects?project=${projectId}`}
          >
            Confirm project context before refresh
          </Link>
        </div>
      )}
      {notice ? (
        <p role="status" aria-live="polite">
          {notice}
        </p>
      ) : null}
    </div>
  );
}
