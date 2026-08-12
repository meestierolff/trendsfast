"use client";

import { useState, type FormEvent } from "react";

type Project = { id: string; name: string; url: string };
type Grant = {
  id: string;
  projectId: string;
  issuedBy: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  revokedBy: string | null;
};

export function OpsDesignPartnerGrantManager(input: {
  projects: Project[];
  initialGrants: Grant[];
  csrfToken: string;
}) {
  const [grants, setGrants] = useState(input.initialGrants);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  async function issue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setMessage("");
    try {
      const response = await fetch("/api/ops/design-partner-grants", {
        method: "POST",
        headers: { "content-type": "application/json", "x-csrf-token": input.csrfToken },
        body: JSON.stringify({
          projectId: String(form.get("projectId")),
          durationDays: Number(form.get("durationDays")),
        }),
      });
      const result = (await response.json()) as {
        error?: string;
        grant?: Grant;
        created?: boolean;
      };
      if (!response.ok || !result.grant) throw new Error(result.error ?? "Grant issuance failed.");
      setGrants((current) => [result.grant!, ...current.filter((g) => g.id !== result.grant!.id)]);
      setMessage(result.created ? "Design-partner grant issued." : "The active grant was reused.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Grant issuance failed.");
    } finally {
      setPending(false);
    }
  }

  async function revoke(grantId: string) {
    setPending(true);
    setMessage("");
    try {
      const response = await fetch(
        `/api/ops/design-partner-grants/${encodeURIComponent(grantId)}/revoke`,
        { method: "POST", headers: { "x-csrf-token": input.csrfToken } },
      );
      const result = (await response.json()) as { error?: string; grant?: Grant };
      if (!response.ok || !result.grant)
        throw new Error(result.error ?? "Grant revocation failed.");
      setGrants((current) =>
        current.map((grant) => (grant.id === grantId ? result.grant! : grant)),
      );
      setMessage("Design-partner grant revoked.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Grant revocation failed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="ops-panel">
      <div className="ops-section-heading">
        <div>
          <p className="ops-kicker">FOUNDER-ONLY / DESIGN PARTNER</p>
          <h2>Temporary API entitlement</h2>
        </div>
        <p>Separate from Stripe. One project, at most 30 days, audited and revocable.</p>
      </div>
      <form className="ops-form" onSubmit={issue}>
        <label>
          Project
          <select name="projectId" required defaultValue="">
            <option value="" disabled>
              Select a project
            </option>
            {input.projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name} · {project.url}
              </option>
            ))}
          </select>
        </label>
        <label>
          Duration (days)
          <input name="durationDays" type="number" min="1" max="30" defaultValue="30" required />
        </label>
        <button type="submit" disabled={pending}>
          Issue design-partner grant
        </button>
      </form>
      {message ? <p role="status">{message}</p> : null}
      <div className="ops-table-wrap">
        <table className="ops-table">
          <thead>
            <tr>
              <th>Project</th>
              <th>Issued</th>
              <th>Expires</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {grants.map((grant) => {
              const active = !grant.revokedAt && new Date(grant.expiresAt) > new Date();
              return (
                <tr key={grant.id}>
                  <td>
                    {input.projects.find((project) => project.id === grant.projectId)?.name ??
                      grant.projectId}
                  </td>
                  <td>{new Date(grant.createdAt).toLocaleString()}</td>
                  <td>{new Date(grant.expiresAt).toLocaleString()}</td>
                  <td>{grant.revokedAt ? "Revoked" : active ? "Active" : "Expired"}</td>
                  <td>
                    {!grant.revokedAt ? (
                      <button type="button" disabled={pending} onClick={() => revoke(grant.id)}>
                        Revoke
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
