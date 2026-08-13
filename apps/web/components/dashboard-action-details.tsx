import type { ActionDetails, ContentBlueprint } from "@trendsfast/schemas";

function list(items: readonly string[]) {
  return (
    <ul>
      {items.map((item, index) => (
        <li key={`${index}-${item}`}>{item}</li>
      ))}
    </ul>
  );
}

function Blueprint({ blueprint }: { blueprint: ContentBlueprint }) {
  return (
    <div className="dashboard-grid">
      <section className="dashboard-panel">
        <p className="kicker">Premise first</p>
        <h3>{blueprint.content_premise}</h3>
        <dl>
          <dt>Audience tension</dt>
          <dd>{blueprint.audience_tension}</dd>
          <dt>Product&apos;s credible role</dt>
          <dd>{blueprint.product_role}</dd>
          <dt>Format family</dt>
          <dd>
            {blueprint.format_family} · {blueprint.format_basis.replaceAll("_", " ")}
          </dd>
          <dt>Hook family</dt>
          <dd>{blueprint.hook_family}</dd>
        </dl>
      </section>
      <section className="dashboard-panel">
        <p className="kicker">Three hooks</p>
        <ol>
          {blueprint.hook_variants.map((hook) => (
            <li key={hook.style}>
              <strong>{hook.style}</strong> — {hook.text}
            </li>
          ))}
        </ol>
        <h3>Structure</h3>
        {list(blueprint.structure)}
      </section>
      <section className="dashboard-panel">
        <p className="kicker">Production</p>
        <h3>Required assets</h3>
        {blueprint.asset_requirements.length ? list(blueprint.asset_requirements) : <p>None.</p>}
        <h3>Available production paths</h3>
        {list(blueprint.production_options.map((option) => option.replaceAll("_", " ")))}
      </section>
      <section className="dashboard-panel">
        <p className="kicker">Channel execution</p>
        <h3>Tone</h3>
        {list(blueprint.tone)}
        <h3>Instructions</h3>
        {list(blueprint.channel_instructions)}
        <h3>CTA</h3>
        <p>{blueprint.cta}</p>
      </section>
    </div>
  );
}

export function DashboardActionDetails({ details }: { details: ActionDetails }) {
  if (details.action === "PUBLISH") {
    return (
      <>
        <section className="dashboard-panel dashboard-panel-wide">
          <p className="kicker">Publish by {new Date(details.publish_by).toUTCString()}</p>
          <h2>{details.content_type}</h2>
        </section>
        <Blueprint blueprint={details.blueprint} />
      </>
    );
  }

  if (details.action === "REPLY") {
    const targets = [details.primary_target, ...details.secondary_targets];
    return (
      <section className="dashboard-panel dashboard-panel-wide">
        <p className="kicker">Exact conversation targets</p>
        <h2>
          {targets.length} bounded target{targets.length === 1 ? "" : "s"}
        </h2>
        {targets.map((target, index) => (
          <article className="dashboard-target" key={target.url}>
            <p className="kicker">{index === 0 ? "Primary target" : `Secondary ${index}`}</p>
            <h3>{target.title_or_excerpt ?? target.author ?? target.source}</h3>
            <a href={target.url} rel="noreferrer noopener" target="_blank">
              Open exact source ↗
            </a>
            <dl>
              <dt>Why this target</dt>
              <dd>{target.why_this_target}</dd>
              <dt>Credibility</dt>
              <dd>{target.credibility_reason}</dd>
              <dt>Reply objective</dt>
              <dd>{target.reply_objective}</dd>
              <dt>Reply angle</dt>
              <dd>{target.reply_angle}</dd>
              <dt>Tone</dt>
              <dd>{target.tone.join(" · ")}</dd>
              <dt>Suggested reply</dt>
              <dd>{target.suggested_reply}</dd>
              {target.short_reply_variant ? (
                <>
                  <dt>Shorter variant</dt>
                  <dd>{target.short_reply_variant}</dd>
                </>
              ) : null}
              <dt>Reply by</dt>
              <dd>{new Date(target.reply_by).toUTCString()}</dd>
            </dl>
          </article>
        ))}
        <p>
          Participation warning: contribute something useful first. A product link is optional and
          should appear only when it genuinely helps the conversation.
        </p>
      </section>
    );
  }

  if (details.action === "REMIX") {
    return (
      <>
        <section className="dashboard-panel dashboard-panel-wide">
          <p className="kicker">Transform by {new Date(details.remix_by).toUTCString()}</p>
          <h2>{details.transformed_concept}</h2>
          {details.source_content.map((source) => (
            <article className="dashboard-target" key={source.url}>
              <a href={source.url} rel="noreferrer noopener" target="_blank">
                {source.author ?? source.source} — exact source ↗
              </a>
              <p>{source.relevance_reason}</p>
              {source.observed_hook ? (
                <p>
                  <strong>Observed hook:</strong> {source.observed_hook}
                </p>
              ) : null}
              {source.observed_format_family ? (
                <p>
                  <strong>Observed format:</strong> {source.observed_format_family}
                </p>
              ) : null}
            </article>
          ))}
          <div className="dashboard-grid">
            <div className="dashboard-panel">
              <h3>Preserve</h3>
              {list(details.preserve)}
            </div>
            <div className="dashboard-panel">
              <h3>Transform</h3>
              {list(details.transform)}
            </div>
            <div className="dashboard-panel dashboard-panel-wide">
              <h3>Do not copy</h3>
              {list(details.do_not_copy)}
            </div>
          </div>
        </section>
        <Blueprint blueprint={details.blueprint} />
      </>
    );
  }

  return (
    <section className="dashboard-panel dashboard-panel-wide">
      <p className="kicker">Recheck {new Date(details.recheck_at).toUTCString()}</p>
      <h2>Wait on: {details.considered_opportunity}</h2>
      <div className="dashboard-grid">
        <div className="dashboard-panel">
          <h3>Why it failed the floor</h3>
          {list(details.failure_reasons.map((reason) => reason.replaceAll("_", " ")))}
          <h3>Do not act on</h3>
          {list(details.do_not_act_on)}
        </div>
        <div className="dashboard-panel">
          <h3>Watch for</h3>
          {list(details.watch_conditions)}
          {details.alternative ? (
            <>
              <h3>Evidence-supported alternative</h3>
              <p>{details.alternative}</p>
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}
