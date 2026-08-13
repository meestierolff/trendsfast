"use client";

import Link from "next/link";
import { useRef, useState } from "react";

export function DashboardRefreshControl({
  projectId,
  label = "Request a fresh move",
}: {
  projectId: string;
  label?: string;
}) {
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [statusUrl, setStatusUrl] = useState<string | null>(null);
  const attemptId = useRef<string | null>(null);

  async function requestRefresh() {
    setPending(true);
    setNotice(null);
    try {
      attemptId.current ??= crypto.randomUUID();
      const response = await fetch(
        `/api/dashboard/projects/${encodeURIComponent(projectId)}/refresh`,
        {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            idempotencyKey: attemptId.current,
            generationLevel: "brief",
          }),
        },
      );
      const body = (await response.json().catch(() => null)) as {
        error?: string;
        statusUrl?: string;
      } | null;
      if (!response.ok || !body?.statusUrl) {
        throw new Error(body?.error ?? "A fresh move could not be requested.");
      }
      attemptId.current = null;
      setStatusUrl(body.statusUrl);
      setNotice("Fresh context and move queued against this project's shared allowance.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "A fresh move could not be requested.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="dashboard-copy-actions">
      <button type="button" disabled={pending} onClick={() => void requestRefresh()}>
        {pending ? "Requesting…" : label}
      </button>
      {statusUrl ? (
        <Link className="button button-primary" href={statusUrl}>
          View refresh status
        </Link>
      ) : null}
      {notice ? (
        <p role="status" aria-live="polite">
          {notice}
        </p>
      ) : null}
    </div>
  );
}
