"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  DashboardProjectNextMoveError,
  readDashboardProjectNextMove,
  requestDashboardProjectNextMove,
  type DashboardProjectNextMoveInput,
  type DashboardProjectNextMoveResult,
} from "@/lib/dashboard-project-next-move";
import { DEFAULT_SCAN_POLL_AFTER_MS } from "@/lib/retry-after";

type ActivePoll = {
  rawKey: string;
  id: string;
  statusUrl: string;
  pollAfterMs: number;
};

export function DashboardRefreshControl({
  projectId,
  request,
  label = "Request a fresh move",
}: {
  projectId: string;
  request: DashboardProjectNextMoveInput;
  label?: string;
}) {
  const router = useRouter();
  const keyInputId = useId();
  const [rawKey, setRawKey] = useState("");
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [apiStatus, setApiStatus] = useState<string | null>(null);
  const [activePoll, setActivePoll] = useState<ActivePoll | null>(null);
  const attemptId = useRef<string | null>(null);

  const applyResult = useCallback(
    (response: DashboardProjectNextMoveResult, pollingKey: string) => {
      const result = response.result;
      setApiStatus(result.status);
      if (result.status === "QUEUED" || result.status === "RUNNING") {
        setActivePoll({
          rawKey: pollingKey,
          id: result.id,
          statusUrl: result.status_url,
          pollAfterMs: response.pollAfterMs,
        });
        setNotice(
          `${result.status === "QUEUED" ? "Proposal queued" : "Research running"}. This page will refresh when founder review is ready.`,
        );
        return;
      }

      setActivePoll(null);
      setRawKey("");
      if (result.status === "FAILED") {
        setNotice(`The request stopped: ${result.error.message}`);
        return;
      }
      setNotice(
        result.status === "REVIEW_REQUIRED"
          ? "The draft proposal is ready for founder review."
          : "The reviewed proposal is ready.",
      );
      router.refresh();
    },
    [router],
  );

  useEffect(() => {
    if (!activePoll) return;
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      void readDashboardProjectNextMove({
        statusUrl: activePoll.statusUrl,
        currentOrigin: window.location.origin,
        rawKey: activePoll.rawKey,
        expectedId: activePoll.id,
      })
        .then((response) => {
          if (!cancelled) applyResult(response, activePoll.rawKey);
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          if (
            error instanceof DashboardProjectNextMoveError &&
            (error.status === 401 || error.status === 403 || error.status === 404)
          ) {
            setActivePoll(null);
            setNotice(error.message);
            return;
          }
          setNotice("The status check could not complete. Automatic polling will retry.");
          setActivePoll((current) =>
            current
              ? {
                  ...current,
                  pollAfterMs:
                    error instanceof DashboardProjectNextMoveError
                      ? (error.retryAfterMs ?? DEFAULT_SCAN_POLL_AFTER_MS)
                      : DEFAULT_SCAN_POLL_AFTER_MS,
                }
              : null,
          );
        });
    }, activePoll.pollAfterMs);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [activePoll, applyResult]);

  async function requestRefresh() {
    setPending(true);
    setNotice(null);
    try {
      attemptId.current ??= crypto.randomUUID();
      const pollingKey = rawKey.trim();
      const response = await requestDashboardProjectNextMove({
        projectId,
        rawKey: pollingKey,
        idempotencyKey: attemptId.current,
        request,
      });
      attemptId.current = null;
      setRawKey("");
      applyResult(response, pollingKey);
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "The project Next Move request could not start.",
      );
    } finally {
      setPending(false);
    }
  }

  const unavailable = request.contentCapabilities.length === 0;

  return (
    <form
      className="dashboard-form dashboard-project-next-move"
      onSubmit={(event) => {
        event.preventDefault();
        void requestRefresh();
      }}
    >
      <label htmlFor={keyInputId}>
        Live project API key
        <input
          id={keyInputId}
          type="password"
          value={rawKey}
          autoComplete="off"
          disabled={pending || activePoll !== null}
          maxLength={169}
          required
          spellCheck={false}
          onChange={(event) => setRawKey(event.currentTarget.value)}
          placeholder="tf_live_…"
        />
        <small>
          Paste a project-scoped key with read and write scopes. It stays only in this component’s
          memory and is cleared after use.
        </small>
      </label>
      <p>
        Draft request · {request.preferredChannels.join(" · ") || "no confirmed channels"} ·{" "}
        {request.contentCapabilities.join(" · ") || "no confirmed content capability"}
      </p>
      <div className="dashboard-copy-actions">
        <button type="submit" disabled={pending || activePoll !== null || unavailable}>
          {pending ? "Requesting…" : activePoll ? "Research in progress…" : label}
        </button>
        <Link className="button button-secondary" href={`/dashboard/agents?project=${projectId}`}>
          Create or manage project key
        </Link>
      </div>
      {apiStatus ? <p>REST status: {apiStatus}</p> : null}
      {unavailable ? (
        <p role="alert">Confirm at least one content capability before generation.</p>
      ) : null}
      {notice ? (
        <p role="status" aria-live="polite">
          {notice}
        </p>
      ) : null}
    </form>
  );
}
