"use client";

import Link from "next/link";
import { useRef, useState } from "react";

import type { ContentCapabilityName } from "@trendsfast/schemas";

export function DashboardTodayActions({
  projectId,
  nextMoveId,
  structuredBrief,
  agentPrompt,
  stale,
  refreshInput,
}: {
  projectId: string;
  nextMoveId: string;
  structuredBrief: Record<string, unknown>;
  agentPrompt: string;
  stale: boolean;
  refreshInput: {
    objective?: string;
    preferredChannels: string[];
    contentCapabilities: ContentCapabilityName[];
  };
}) {
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [refreshUrl, setRefreshUrl] = useState<string | null>(null);
  const refreshIdempotencyKey = useRef<string | null>(null);

  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setNotice(`${label} copied.`);
    } catch {
      setNotice(`Could not copy ${label.toLowerCase()}; select it manually.`);
    }
  }

  async function outcome(kind: "USED" | "SKIPPED") {
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
      setNotice(kind === "USED" ? "Marked as used." : "Marked as not relevant.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The outcome could not be saved.");
    } finally {
      setPending(false);
    }
  }

  async function refresh() {
    setPending(true);
    setNotice(null);
    try {
      // Keep one UUID across an ambiguous network failure. A successful
      // response retires it so a later intentional refresh is a new request.
      refreshIdempotencyKey.current ??= crypto.randomUUID();
      const response = await fetch(
        `/api/dashboard/projects/${encodeURIComponent(projectId)}/refresh`,
        {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            idempotencyKey: refreshIdempotencyKey.current,
            ...refreshInput,
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
      setRefreshUrl(body.statusUrl);
      setNotice("Fresh move queued against this project's shared plan allowance.");
      refreshIdempotencyKey.current = null;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "A fresh move could not be requested.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="dashboard-panel dashboard-panel-wide">
      <p className="kicker">Founder controls</p>
      <h2>Use, copy, or refresh—never auto-publish.</h2>
      <div className="dashboard-copy-actions">
        <button
          type="button"
          onClick={() => void copy(JSON.stringify(structuredBrief, null, 2), "Structured brief")}
        >
          Copy structured brief
        </button>
        <button type="button" onClick={() => void copy(agentPrompt, "Agent prompt")}>
          Copy agent prompt
        </button>
        <button type="button" disabled={pending} onClick={() => void refresh()}>
          {pending ? "Requesting…" : stale ? "Request a fresh move" : "Request refresh"}
        </button>
        <Link className="button button-secondary" href={`/dashboard/agents?project=${projectId}`}>
          Agent access
        </Link>
        {refreshUrl ? (
          <Link className="button button-primary" href={refreshUrl}>
            View refresh status
          </Link>
        ) : null}
      </div>
      <div className="dashboard-outcome-actions">
        <button type="button" disabled={pending} onClick={() => void outcome("USED")}>
          Mark as used
        </button>
        <button type="button" disabled={pending} onClick={() => void outcome("SKIPPED")}>
          Not relevant
        </button>
      </div>
      {notice ? (
        <p role="status" aria-live="polite">
          {notice}
        </p>
      ) : null}
    </div>
  );
}
