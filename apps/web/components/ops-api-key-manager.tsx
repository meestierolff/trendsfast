"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

type ProjectView = { id: string; name: string | null; url: string };
type KeyView = {
  id: string;
  projectId: string | null;
  name: string;
  visiblePrefix: string;
  scopes: string[];
  environment: "test" | "live";
  status: "ACTIVE" | "REVOKED";
  rateLimitPerHour: number;
  providerCostLimitUsd: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
};
type AuditView = {
  id: string;
  action: string;
  actorId: string;
  apiKeyId: string | null;
  relatedApiKeyId: string | null;
  occurredAt: string;
};
type MutationResponse = {
  ok?: boolean;
  error?: string;
  rawKey?: string;
  key?: KeyView;
};

function defaultExpiry(): string {
  const date = new Date(Date.now() + 90 * 24 * 60 * 60_000);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function OpsApiKeyManager({
  projects,
  keys,
  events,
  csrfToken,
  environment,
}: {
  projects: ProjectView[];
  keys: KeyView[];
  events: AuditView[];
  csrfToken: string;
  environment: "test" | "live";
}) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [oneTimeSecret, setOneTimeSecret] = useState<{
    rawKey: string;
    keyName: string;
  } | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");

  async function mutate(path: string, body: Record<string, unknown>, pendingId: string) {
    setPending(pendingId);
    setNotice(null);
    try {
      const response = await fetch(path, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
        body: JSON.stringify(body),
      });
      const payload = (await response.json().catch(() => null)) as MutationResponse | null;
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error ?? "The API key action could not be completed.");
      }
      if (payload.rawKey) {
        setOneTimeSecret({ rawKey: payload.rawKey, keyName: payload.key?.name ?? "Project key" });
      } else {
        setNotice("API key state persisted and audited.");
        router.refresh();
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The API key action failed.");
    } finally {
      setPending(null);
    }
  }

  async function issue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const expiresAt = new Date(String(form.get("expiresAt"))).toISOString();
    await mutate(
      "/api/ops/api-keys",
      {
        projectId: form.get("projectId"),
        name: form.get("name"),
        environment,
        scopes: form.getAll("scopes"),
        rateLimitPerHour: Number(form.get("rateLimitPerHour")),
        providerCostLimitUsd: Number(form.get("providerCostLimitUsd")),
        expiresAt,
      },
      "issue",
    );
  }

  async function copySecret() {
    if (!oneTimeSecret) return;
    try {
      await navigator.clipboard.writeText(oneTimeSecret.rawKey);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
  }

  function dismissSecret() {
    setOneTimeSecret(null);
    setCopyState("idle");
    router.refresh();
  }

  return (
    <div className="ops-review-queue">
      <div className="ops-detail-section-heading">
        <div>
          <p className="ops-kicker">Project-scoped capabilities</p>
          <h2>Issue, limit, rotate, and revoke.</h2>
        </div>
        <p>Raw secrets appear once. Only their slow hash and visible prefix are stored.</p>
      </div>

      {oneTimeSecret ? (
        <section className="ops-delivery-result" role="status" aria-live="polite">
          <span>ONE-TIME API KEY</span>
          <h3>Copy {oneTimeSecret.keyName} now.</h3>
          <p>Closing this panel permanently discards the displayed secret.</p>
          <label htmlFor="issued-api-key">Raw project key</label>
          <input
            id="issued-api-key"
            readOnly
            value={oneTimeSecret.rawKey}
            onFocus={(event) => event.currentTarget.select()}
          />
          <div>
            <button type="button" onClick={() => void copySecret()}>
              {copyState === "copied" ? "Copied" : "Copy key"}
            </button>
            <button type="button" onClick={dismissSecret}>
              I stored it safely
            </button>
          </div>
          {copyState === "error" ? <small>Select and copy the key manually.</small> : null}
        </section>
      ) : (
        <form className="ops-action-card" onSubmit={issue}>
          <span>ISSUE / {environment.toUpperCase()}</span>
          <label htmlFor="key-project">Project</label>
          <select id="key-project" name="projectId" required disabled={projects.length === 0}>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name ?? new URL(project.url).hostname}
              </option>
            ))}
          </select>
          <label htmlFor="key-name">Key name</label>
          <input id="key-name" name="name" required maxLength={200} placeholder="Founder agent" />
          <fieldset>
            <legend>Scopes</legend>
            <label>
              <input name="scopes" type="checkbox" value="next_move:read" defaultChecked /> Read
            </label>
            <label>
              <input name="scopes" type="checkbox" value="next_move:write" defaultChecked /> Write
            </label>
          </fieldset>
          <label htmlFor="key-rate">Requests per hour</label>
          <input
            id="key-rate"
            name="rateLimitPerHour"
            type="number"
            min={1}
            max={10_000}
            placeholder="Required private policy"
            required
          />
          <label htmlFor="key-cost">Provider-cost limit per hour (USD)</label>
          <input
            id="key-cost"
            name="providerCostLimitUsd"
            type="number"
            min={0}
            max={10_000}
            step="0.0001"
            placeholder="Required private policy"
            required
          />
          <label htmlFor="key-expiry">Expiry</label>
          <input
            id="key-expiry"
            name="expiresAt"
            type="datetime-local"
            defaultValue={defaultExpiry()}
            required
          />
          <button type="submit" disabled={pending !== null || projects.length === 0}>
            {pending === "issue" ? "Issuing…" : "Issue project key"}
          </button>
        </form>
      )}

      {notice ? <p className="ops-action-notice">{notice}</p> : null}

      <div className="ops-provider-runs">
        <div className="ops-detail-section-heading">
          <div>
            <p className="ops-kicker">Stored controls</p>
            <h2>{keys.length} key records</h2>
          </div>
        </div>
        {keys.map((key) => {
          const expired = Boolean(key.expiresAt && new Date(key.expiresAt) <= new Date());
          const active = key.status === "ACTIVE" && !expired;
          return (
            <article className="ops-action-card" key={key.id}>
              <span>
                {key.environment.toUpperCase()} / {key.status} {expired ? "/ EXPIRED" : ""}
              </span>
              <h3>{key.name}</h3>
              <code>{`tf_${key.environment}_${key.visiblePrefix}.••••••••`}</code>
              <p>{key.scopes.join(" · ")}</p>
              <p>
                {key.rateLimitPerHour}/hour · ${key.providerCostLimitUsd} provider cost/hour ·
                expires {key.expiresAt ? new Date(key.expiresAt).toUTCString() : "never"}
              </p>
              {active ? (
                <div>
                  <button
                    type="button"
                    disabled={pending !== null || oneTimeSecret !== null}
                    onClick={() =>
                      void mutate(
                        `/api/ops/api-keys/${encodeURIComponent(key.id)}/rotate`,
                        {
                          expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60_000).toISOString(),
                        },
                        `rotate:${key.id}`,
                      )
                    }
                  >
                    {pending === `rotate:${key.id}` ? "Rotating…" : "Rotate and revoke old"}
                  </button>
                  <button
                    type="button"
                    disabled={pending !== null}
                    onClick={() =>
                      void mutate(
                        `/api/ops/api-keys/${encodeURIComponent(key.id)}/revoke`,
                        {},
                        `revoke:${key.id}`,
                      )
                    }
                  >
                    {pending === `revoke:${key.id}` ? "Revoking…" : "Revoke"}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={pending !== null || oneTimeSecret !== null}
                  onClick={() =>
                    void mutate(
                      `/api/ops/api-keys/${encodeURIComponent(key.id)}/reissue`,
                      { expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60_000).toISOString() },
                      `reissue:${key.id}`,
                    )
                  }
                >
                  {pending === `reissue:${key.id}` ? "Reissuing…" : "Reissue replacement"}
                </button>
              )}
            </article>
          );
        })}
      </div>

      <details>
        <summary>API key management audit ({events.length})</summary>
        <ol>
          {events.map((event) => (
            <li key={event.id}>
              <strong>{event.action}</strong> · {new Date(event.occurredAt).toUTCString()} ·{" "}
              {event.actorId}
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}
