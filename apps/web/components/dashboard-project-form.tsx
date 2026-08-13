"use client";

import type {
  ContentCapabilities,
  ContextProvenance,
  ProjectContext,
  ProjectEntityType,
  VoiceProfile,
} from "@trendsfast/schemas";
import { useState, type FormEvent } from "react";

function lines(value: readonly string[]) {
  return value.join("\n");
}

function parseLines(value: FormDataEntryValue | null): string[] {
  return String(value ?? "")
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

const capabilityLabels: Record<keyof ContentCapabilities, string> = {
  founder_text: "Founder-written text",
  founder_on_camera: "Founder on camera",
  screen_recording: "Screen recording",
  ai_avatar: "AI avatar",
  carousel: "Carousel",
  product_demo: "Product demo",
  long_form: "Long-form article",
};

export function DashboardProjectForm({
  projectId,
  projectUrl,
  context,
  entityType,
  provenance,
  voiceProfile,
  contentCapabilities,
}: {
  projectId: string;
  projectUrl: string;
  context: ProjectContext;
  entityType: ProjectEntityType;
  provenance: ContextProvenance;
  voiceProfile: VoiceProfile;
  contentCapabilities: ContentCapabilities;
}) {
  const [pending, setPending] = useState(false);
  const [urlPending, setUrlPending] = useState(false);
  const [url, setUrl] = useState(projectUrl);
  const [contextInvalidated, setContextInvalidated] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (url.trim() !== projectUrl) {
      setNotice("Update the product URL first, or restore the saved URL before editing context.");
      return;
    }
    setPending(true);
    setNotice(null);
    const form = new FormData(event.currentTarget);
    const value = (name: string) => String(form.get(name) ?? "").trim();
    const updatedContext: ProjectContext = {
      name: value("name"),
      url: context.url,
      category: value("category"),
      audience: value("audience"),
      problem: value("problem"),
      desiredOutcome: value("desiredOutcome"),
      credibleClaims: parseLines(form.get("credibleClaims")),
      alternatives: parseLines(form.get("alternatives")),
      competitors: parseLines(form.get("competitors")),
      markets: parseLines(form.get("markets")),
      language: value("language"),
      suitableChannels: parseLines(form.get("suitableChannels")),
      availableFormats: parseLines(form.get("availableFormats")),
      credibleTopics: parseLines(form.get("credibleTopics")),
      assumptions: parseLines(form.get("assumptions")),
    };
    const updatedProvenance: Omit<ContextProvenance, "observed_facts"> = {
      inferred_context: provenance.inferred_context.map((fact, index) => ({
        field: value(`inferred.${index}.field`),
        value: value(`inferred.${index}.value`),
        rationale: value(`inferred.${index}.rationale`),
      })),
      assumptions: updatedContext.assumptions,
    };
    const updatedVoice: VoiceProfile = {
      traits: parseLines(form.get("voice.traits")),
      preferred_phrases: parseLines(form.get("voice.preferred_phrases")),
      avoid_phrases: parseLines(form.get("voice.avoid_phrases")),
      sample_texts: parseLines(form.get("voice.sample_texts")),
      sample_urls: parseLines(form.get("voice.sample_urls")),
    };
    const updatedCapabilities = Object.fromEntries(
      Object.keys(capabilityLabels).map((key) => [key, form.get(`capability.${key}`) === "on"]),
    ) as ContentCapabilities;

    try {
      const response = await fetch(
        `/api/dashboard/projects/${encodeURIComponent(projectId)}/context`,
        {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            context: updatedContext,
            entityType: value("entityType"),
            contextProvenance: updatedProvenance,
            voiceProfile: updatedVoice,
            contentCapabilities: updatedCapabilities,
          }),
        },
      );
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(body?.error ?? "The project context could not be saved.");
      setNotice(
        "Project context saved. Any unapproved move based on the old context is now stale.",
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The project context could not be saved.");
    } finally {
      setPending(false);
    }
  }

  async function updateUrl() {
    setUrlPending(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/dashboard/projects/${encodeURIComponent(projectId)}/url`, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      const body = (await response.json().catch(() => null)) as {
        error?: string;
        changed?: boolean;
        url?: string;
      } | null;
      if (!response.ok || !body?.url) {
        throw new Error(body?.error ?? "The project URL could not be updated.");
      }
      setUrl(body.url);
      if (body.changed) {
        setContextInvalidated(true);
        setNotice(
          "Product URL updated. The earlier context and move are now stale; request a fresh move to re-infer this site.",
        );
      } else {
        setNotice("The product URL is already current.");
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The project URL could not be updated.");
    } finally {
      setUrlPending(false);
    }
  }

  return (
    <form className="dashboard-form" onSubmit={submit}>
      <section className="dashboard-panel dashboard-panel-wide">
        <p className="kicker">Compact confirmation</p>
        <h2>Product and brand context</h2>
        <div className="dashboard-form-grid">
          <label>
            Product URL
            <input
              type="url"
              value={url}
              maxLength={2_048}
              required
              disabled={contextInvalidated}
              onChange={(event) => setUrl(event.currentTarget.value)}
            />
            <button
              type="button"
              disabled={pending || urlPending || contextInvalidated || url.trim() === projectUrl}
              onClick={() => void updateUrl()}
            >
              {urlPending ? "Updating URL…" : "Update product URL"}
            </button>
          </label>
          <label>
            Entity type
            <select name="entityType" defaultValue={entityType}>
              <option value="PRODUCT">Product</option>
              <option value="BRAND">Brand</option>
              <option value="CREATOR_LED_BRAND">Creator-led brand</option>
            </select>
          </label>
          <label>
            Name
            <input name="name" defaultValue={context.name} maxLength={200} required />
          </label>
          <label>
            Category
            <input name="category" defaultValue={context.category} maxLength={500} required />
          </label>
          <label>
            Audience
            <textarea name="audience" defaultValue={context.audience} required />
          </label>
          <label>
            Problem
            <textarea name="problem" defaultValue={context.problem} required />
          </label>
          <label>
            Objective / desired outcome
            <textarea name="desiredOutcome" defaultValue={context.desiredOutcome} required />
          </label>
          <label>
            Language
            <input name="language" defaultValue={context.language} maxLength={35} required />
          </label>
          {(
            [
              ["credibleClaims", "Credible claims", context.credibleClaims],
              ["alternatives", "Alternatives", context.alternatives],
              ["competitors", "Competitors", context.competitors],
              ["markets", "Markets", context.markets],
              ["suitableChannels", "Preferred channels", context.suitableChannels],
              ["availableFormats", "Available formats", context.availableFormats],
              ["credibleTopics", "Credible topics", context.credibleTopics],
              ["assumptions", "Assumptions to confirm", context.assumptions],
            ] as const
          ).map(([name, label, values]) => (
            <label key={name}>
              {label} · one per line
              <textarea name={name} defaultValue={lines(values)} />
            </label>
          ))}
        </div>
      </section>

      <section className="dashboard-panel dashboard-panel-wide">
        <p className="kicker">Context provenance</p>
        <h2>Observed facts and inferences</h2>
        <p>
          Observed website facts are source evidence and cannot be edited. Run a fresh scan to
          observe the current site; you can correct the inferred context below.
        </p>
        {provenance.observed_facts.length ? (
          provenance.observed_facts.map((fact, index) => (
            <fieldset key={`${fact.field}-${index}`}>
              <legend>Observed fact {index + 1}</legend>
              <div className="dashboard-form-grid">
                <div>
                  <p className="dashboard-field-label">Field</p>
                  <p>{fact.field}</p>
                </div>
                <div>
                  <p className="dashboard-field-label">Source URL</p>
                  <p>
                    <a href={fact.source_url} rel="noreferrer" target="_blank">
                      {fact.source_url}
                    </a>
                  </p>
                </div>
                <div>
                  <p className="dashboard-field-label">Observed value</p>
                  <p>{fact.value}</p>
                </div>
              </div>
            </fieldset>
          ))
        ) : (
          <p>No observed website facts were retained for this context version.</p>
        )}
        {provenance.inferred_context.map((fact, index) => (
          <fieldset key={`${fact.field}-${index}`}>
            <legend>Inference {index + 1}</legend>
            <div className="dashboard-form-grid">
              <label>
                Field
                <input name={`inferred.${index}.field`} defaultValue={fact.field} />
              </label>
              <label>
                Inferred value
                <textarea name={`inferred.${index}.value`} defaultValue={fact.value} />
              </label>
              <label>
                Rationale
                <textarea name={`inferred.${index}.rationale`} defaultValue={fact.rationale} />
              </label>
            </div>
          </fieldset>
        ))}
      </section>

      <section className="dashboard-panel">
        <p className="kicker">Saved voice</p>
        <h2>How this brand sounds</h2>
        {(
          [
            ["voice.traits", "Traits", voiceProfile.traits],
            ["voice.preferred_phrases", "Preferred phrases", voiceProfile.preferred_phrases],
            ["voice.avoid_phrases", "Avoid phrases", voiceProfile.avoid_phrases],
            ["voice.sample_texts", "Sample texts", voiceProfile.sample_texts],
            ["voice.sample_urls", "Optional sample URLs", voiceProfile.sample_urls],
          ] as const
        ).map(([name, label, values]) => (
          <label key={name}>
            {label} · one per line
            <textarea name={name} defaultValue={lines(values)} />
          </label>
        ))}
      </section>

      <section className="dashboard-panel">
        <p className="kicker">Content capabilities</p>
        <h2>What you can credibly produce</h2>
        <div className="dashboard-checks">
          {(Object.keys(capabilityLabels) as Array<keyof ContentCapabilities>).map((key) => (
            <label key={key}>
              <input
                name={`capability.${key}`}
                type="checkbox"
                defaultChecked={contentCapabilities[key]}
              />
              {capabilityLabels[key]}
            </label>
          ))}
        </div>
      </section>

      <button type="submit" disabled={pending || urlPending || contextInvalidated}>
        {pending ? "Saving…" : "Save project context"}
      </button>
      {notice ? <p role="status">{notice}</p> : null}
    </form>
  );
}
