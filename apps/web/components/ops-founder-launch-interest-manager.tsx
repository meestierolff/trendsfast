"use client";

import { useState } from "react";

export type FounderLaunchInterestOpsItem = {
  id: string;
  email: string;
  source: "homepage" | "pricing";
  consentVersion: string;
  consentedAt: string;
  expiresAt: string;
};

export function OpsFounderLaunchInterestManager({
  initialItems,
  csrfToken,
}: {
  initialItems: readonly FounderLaunchInterestOpsItem[];
  csrfToken: string;
}) {
  const [items, setItems] = useState(initialItems);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function hardDelete(id: string) {
    setPendingId(id);
    setError(null);
    try {
      const response = await fetch(`/api/ops/founder-launch-interests/${encodeURIComponent(id)}`, {
        method: "DELETE",
        credentials: "same-origin",
        headers: { "x-csrf-token": csrfToken },
      });
      if (!response.ok) throw new Error("Deletion failed");
      setItems((current) => current.filter((item) => item.id !== id));
    } catch {
      setError("The launch-interest record was not deleted. Refresh before retrying.");
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div>
      {items.length === 0 ? <p>No retained Founder launch-interest records.</p> : null}
      {items.length > 0 ? (
        <table>
          <thead>
            <tr>
              <th>Email</th>
              <th>Source</th>
              <th>Consent</th>
              <th>Expires</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>{item.email}</td>
                <td>{item.source}</td>
                <td>
                  {item.consentVersion} ·{" "}
                  <time dateTime={item.consentedAt}>{item.consentedAt}</time>
                </td>
                <td>
                  <time dateTime={item.expiresAt}>{item.expiresAt}</time>
                </td>
                <td>
                  <button
                    type="button"
                    disabled={pendingId !== null}
                    onClick={() => void hardDelete(item.id)}
                  >
                    {pendingId === item.id ? "Deleting…" : "Hard-delete"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {error ? (
        <p role="alert" aria-live="polite">
          {error}
        </p>
      ) : null}
    </div>
  );
}
