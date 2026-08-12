"use client";

import { useState } from "react";

type BillingProject = {
  id: string;
  name: string | null;
  url: string;
  entitlementActive: boolean;
  hasCustomer: boolean;
};

export function OpsBillingManager(input: {
  csrfToken: string;
  checkoutAvailable: boolean;
  availabilityReason: string | null;
  projects: BillingProject[];
}) {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function openSession(projectId: string, kind: "checkout" | "portal") {
    setPending(`${projectId}:${kind}`);
    setError(null);
    try {
      const response = await fetch(`/api/ops/billing/${kind}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": input.csrfToken,
        },
        body: JSON.stringify({ projectId }),
      });
      const payload = (await response.json()) as { url?: string; error?: string };
      if (!response.ok || !payload.url) {
        throw new Error(payload.error ?? "The billing session could not be opened.");
      }
      window.location.assign(payload.url);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "The billing session could not be opened.",
      );
      setPending(null);
    }
  }

  return (
    <div className="ops-panel">
      {!input.checkoutAvailable ? (
        <p role="status">
          Billing controls are gated: {input.availabilityReason ?? "configuration incomplete"}.
        </p>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      {input.projects.map((project) => (
        <article className="ops-card" key={project.id}>
          <h2>{project.name ?? project.url}</h2>
          <p>{project.url}</p>
          <p>Founder entitlement: {project.entitlementActive ? "Active" : "Inactive"}</p>
          <div className="ops-actions">
            <button
              type="button"
              disabled={
                !input.checkoutAvailable ||
                project.entitlementActive ||
                pending === `${project.id}:checkout`
              }
              onClick={() => void openSession(project.id, "checkout")}
            >
              Open test checkout
            </button>
            <button
              type="button"
              disabled={
                !input.checkoutAvailable ||
                !project.hasCustomer ||
                pending === `${project.id}:portal`
              }
              onClick={() => void openSession(project.id, "portal")}
            >
              Customer Portal
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}
