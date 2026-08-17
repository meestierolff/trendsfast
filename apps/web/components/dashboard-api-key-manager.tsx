"use client";

import { useState, type FormEvent } from "react";

import {
  reconcileDashboardKeys,
  type DashboardApiKeyView as KeyView,
} from "@/lib/dashboard-api-key-state";

type MutationResponse = {
  ok?: boolean;
  error?: string;
  rawKey?: string;
  key?: KeyView;
  replacedKey?: { id: string; status: "REVOKED" };
};

export function DashboardApiKeyManager({
  projectId,
  projectName,
  appUrl,
  keys: initialKeys,
}: {
  projectId: string;
  projectName: string;
  appUrl: string;
  keys: KeyView[];
}) {
  const [keys, setKeys] = useState(initialKeys);
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [secret, setSecret] = useState<{ rawKey: string; name: string } | null>(null);

  async function mutation(path: string, body: Record<string, unknown>, pendingKey: string) {
    setPending(pendingKey);
    setNotice(null);
    try {
      const response = await fetch(path, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json().catch(() => null)) as MutationResponse | null;
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error ?? "The API key action could not be completed.");
      }
      if (payload.key) {
        setKeys((current) => reconcileDashboardKeys(current, payload));
      }
      if (payload.rawKey) {
        setSecret({ rawKey: payload.rawKey, name: payload.key?.name ?? "Project key" });
      } else {
        setNotice("API key state saved.");
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
    await mutation(
      `/api/dashboard/projects/${encodeURIComponent(projectId)}/api-keys`,
      { name: form.get("name"), scopes: form.getAll("scopes") },
      "issue",
    );
  }

  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setNotice(`${label} copied.`);
    } catch {
      setNotice(`Could not copy ${label.toLowerCase()}; select it manually.`);
    }
  }

  const curl = `curl --request POST '${appUrl}/v1/projects/${projectId}/next-move' \\
  --header 'Authorization: Bearer YOUR_PROJECT_KEY' \\
  --header 'Idempotency-Key: 00000000-0000-4000-8000-000000000001' \\
  --header 'Content-Type: application/json' \\
  --data '{"objective":"Grow ${projectName.replaceAll('"', "")}","preferred_channels":["x","linkedin","youtube","blog"],"content_capabilities":["founder_text","screen_recording"],"generation_level":"draft"}'`;
  const instruction = `I want to grow ${projectName} among our saved audience. Use TrendsFast to find the strongest current opportunity. Show me the evidence and the exact PUBLISH, REPLY, REMIX, or WAIT recommendation. Draft the asset in our saved voice, but do not publish without approval.`;

  return (
    <div className="dashboard-grid">
      <section className="dashboard-panel">
        <p className="kicker">Create project key</p>
        <h2>Separate keys for each agent.</h2>
        <p>
          Keys share this project&apos;s plan allowance. Creating more keys does not create more
          research capacity.
        </p>
        <form className="dashboard-form" onSubmit={issue}>
          <label>
            Key name
            <input name="name" required maxLength={200} placeholder="Claude production" />
          </label>
          <fieldset>
            <legend>Scopes</legend>
            <div className="dashboard-checks">
              <label>
                <input name="scopes" type="checkbox" value="next_move:read" defaultChecked />
                Read results
              </label>
              <label>
                <input name="scopes" type="checkbox" value="next_move:write" defaultChecked />
                Request scans
              </label>
            </div>
          </fieldset>
          <button type="submit" disabled={pending !== null || secret !== null}>
            {pending === "issue" ? "Creating…" : "Create API key"}
          </button>
        </form>
      </section>

      <section className="dashboard-panel">
        <p className="kicker">One-time secret</p>
        <h2>{secret ? `Copy ${secret.name} now.` : "Secrets appear once."}</h2>
        {secret ? (
          <div className="dashboard-secret" role="status">
            <code>{secret.rawKey}</code>
            <div className="dashboard-key-actions">
              <button type="button" onClick={() => void copy(secret.rawKey, "Raw API key")}>
                Copy key
              </button>
              <button type="button" onClick={() => setSecret(null)}>
                I stored it safely
              </button>
            </div>
          </div>
        ) : (
          <p>
            TrendsFast stores only a slow hash and visible prefix. A lost secret must be reissued.
          </p>
        )}
        {notice ? <p role="status">{notice}</p> : null}
      </section>

      <section className="dashboard-panel dashboard-panel-wide">
        <p className="kicker">Stored keys</p>
        <h2>
          {keys.length} project key{keys.length === 1 ? "" : "s"}
        </h2>
        {keys.length ? (
          <table className="dashboard-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Prefix / scopes</th>
                <th>Last used</th>
                <th>Status</th>
                <th>Controls</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((key) => (
                <tr key={key.id}>
                  <td>{key.name}</td>
                  <td>
                    <code>{`tf_${key.environment}_${key.visiblePrefix}.••••••••`}</code>
                    <br />
                    <small>{key.scopes.join(" · ")}</small>
                  </td>
                  <td>{key.lastUsedAt ? new Date(key.lastUsedAt).toUTCString() : "Never"}</td>
                  <td>{key.status}</td>
                  <td>
                    <div className="dashboard-key-actions">
                      {key.status === "ACTIVE" ? (
                        <button
                          type="button"
                          disabled={pending !== null || secret !== null}
                          onClick={() =>
                            void mutation(
                              `/api/dashboard/projects/${projectId}/api-keys/${key.id}/reissue`,
                              {},
                              `reissue:${key.id}`,
                            )
                          }
                        >
                          Reissue
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={pending !== null || secret !== null}
                          onClick={() =>
                            void mutation(
                              `/api/dashboard/projects/${projectId}/api-keys/${key.id}/reissue`,
                              {},
                              `reissue:${key.id}`,
                            )
                          }
                        >
                          Replace
                        </button>
                      )}
                      {key.status === "ACTIVE" ? (
                        <button
                          type="button"
                          disabled={pending !== null}
                          onClick={() =>
                            void mutation(
                              `/api/dashboard/projects/${projectId}/api-keys/${key.id}/revoke`,
                              {},
                              `revoke:${key.id}`,
                            )
                          }
                        >
                          Revoke
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p>
            No keys yet. Create one for Claude, ChatGPT, Codex, OpenClaw, n8n, or another agent.
          </p>
        )}
      </section>

      <section className="dashboard-panel dashboard-panel-wide">
        <p className="kicker">Agent example</p>
        <h2>Ask for the same structured Next Move.</h2>
        <pre className="dashboard-code" tabIndex={0}>
          {curl}
        </pre>
        <div className="dashboard-copy-actions">
          <button type="button" onClick={() => void copy(curl, "cURL example")}>
            Copy cURL
          </button>
          <button type="button" onClick={() => void copy(instruction, "Agent instruction")}>
            Copy agent instruction
          </button>
        </div>
      </section>
    </div>
  );
}
