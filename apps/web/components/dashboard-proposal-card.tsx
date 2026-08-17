import type { NextDistributionContentProposalV1 } from "@/lib/next-distribution-content-proposal";

function utcDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "UTC",
  }).format(new Date(value));
}

function Content({ proposal }: { proposal: NextDistributionContentProposalV1 }) {
  if (proposal.action === "WAIT") {
    return (
      <div className="dashboard-proposal-wait" role="note">
        <strong>Do not force content from this signal.</strong>
        <p>The quality floor selected WAIT, so no draft or destination was created.</p>
      </div>
    );
  }
  if (typeof proposal.content === "string") {
    return <pre className="dashboard-proposal-draft">{proposal.content}</pre>;
  }
  return (
    <div className="dashboard-proposal-blueprint">
      <p>{proposal.content.content_premise}</p>
      <ol>
        {proposal.content.structure.map((step, index) => (
          <li key={`${index}-${step}`}>{step}</li>
        ))}
      </ol>
      <p>
        <strong>CTA:</strong> {proposal.content.cta}
      </p>
    </div>
  );
}

function ActionSpecifics({ proposal }: { proposal: NextDistributionContentProposalV1 }) {
  switch (proposal.action) {
    case "PUBLISH":
      return (
        <div className="dashboard-proposal-specifics">
          <div>
            <h3>Hook</h3>
            <p>{proposal.hook}</p>
          </div>
          <div>
            <h3>Structure</h3>
            <ol>
              {proposal.structure.map((step, index) => (
                <li key={`${index}-${step}`}>{step}</li>
              ))}
            </ol>
          </div>
          <div>
            <h3>CTA</h3>
            <p>{proposal.cta}</p>
          </div>
        </div>
      );
    case "REPLY":
      return (
        <div className="dashboard-proposal-specifics">
          <div>
            <h3>Exact source</h3>
            <p>
              {proposal.source}
              {proposal.author ? ` · ${proposal.author}` : ""}
            </p>
            {proposal.title_or_excerpt ? <p>{proposal.title_or_excerpt}</p> : null}
          </div>
          {proposal.short_reply_variant ? (
            <div>
              <h3>Short reply variant</h3>
              <p>{proposal.short_reply_variant}</p>
            </div>
          ) : null}
        </div>
      );
    case "REMIX":
      return (
        <div className="dashboard-proposal-specifics">
          <div>
            <h3>Exact source content</h3>
            <ul>
              {proposal.source_content.map((source) => (
                <li key={source.url}>
                  <a href={source.url} rel="noreferrer noopener" target="_blank">
                    {source.url} ↗
                  </a>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3>Preserve</h3>
            <ul>
              {proposal.preserve.map((item, index) => (
                <li key={`${index}-${item}`}>{item}</li>
              ))}
            </ul>
          </div>
          <div>
            <h3>Transform</h3>
            <ul>
              {proposal.transform.map((item, index) => (
                <li key={`${index}-${item}`}>{item}</li>
              ))}
            </ul>
          </div>
          <div>
            <h3>Do not copy</h3>
            <ul>
              {proposal.do_not_copy.map((item, index) => (
                <li key={`${index}-${item}`}>{item}</li>
              ))}
            </ul>
          </div>
        </div>
      );
    case "WAIT":
      return (
        <div className="dashboard-proposal-specifics">
          <div>
            <h3>Failure reasons</h3>
            <ul>
              {proposal.failure_reasons.map((reason) => (
                <li key={reason}>{reason.replaceAll("_", " ").toLowerCase()}</li>
              ))}
            </ul>
          </div>
          <div>
            <h3>Do not act on</h3>
            <ul>
              {proposal.do_not_act_on.map((item, index) => (
                <li key={`${index}-${item}`}>{item}</li>
              ))}
            </ul>
          </div>
          <div>
            <h3>Watch conditions</h3>
            <ul>
              {proposal.watch_conditions.map((item, index) => (
                <li key={`${index}-${item}`}>{item}</li>
              ))}
            </ul>
          </div>
        </div>
      );
  }
}

export function DashboardProposalCard({
  proposal,
  stale,
  children,
}: {
  proposal: NextDistributionContentProposalV1;
  stale: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="dashboard-proposal-card" aria-labelledby="next-content-proposal-title">
      <header className="dashboard-action-banner">
        <strong>{proposal.action}</strong>
        <div>
          <p className="kicker">Next distribution content</p>
          <h2 id="next-content-proposal-title">{proposal.topic}</h2>
          <p>
            {proposal.channel} · {proposal.format}
          </p>
        </div>
        <span className="dashboard-status" data-stale={stale}>
          {stale ? "STALE" : proposal.founder_reviewed ? "REVIEWED" : "REVIEW REQUIRED"}
        </span>
      </header>

      <div className="dashboard-proposal-body">
        <dl className="dashboard-proposal-facts">
          <div>
            <dt>Action</dt>
            <dd>{proposal.action}</dd>
          </div>
          <div>
            <dt>Channel</dt>
            <dd>{proposal.channel}</dd>
          </div>
          <div>
            <dt>Exact destination</dt>
            <dd>
              {proposal.destination === null ? (
                "None — WAIT does not create a destination"
              ) : proposal.action === "REPLY" ? (
                <a href={proposal.destination} rel="noreferrer noopener" target="_blank">
                  {proposal.destination} ↗
                </a>
              ) : (
                proposal.destination
              )}
            </dd>
          </div>
          <div>
            <dt>Act before</dt>
            <dd>
              <time dateTime={proposal.act_before}>{utcDate(proposal.act_before)} UTC</time>
            </dd>
          </div>
        </dl>

        <section className="dashboard-proposal-section">
          <p className="kicker">Why now</p>
          <p>{proposal.why_now}</p>
        </section>

        <section className="dashboard-proposal-section">
          <p className="kicker">Suggested content</p>
          <Content proposal={proposal} />
        </section>

        <section className="dashboard-proposal-section">
          <p className="kicker">Product role</p>
          <p>{proposal.product_role ?? "Not applicable to a WAIT decision."}</p>
        </section>

        <ActionSpecifics proposal={proposal} />

        <section className="dashboard-proposal-section dashboard-evidence">
          <p className="kicker">Evidence</p>
          {proposal.evidence.length ? (
            proposal.evidence.map((receipt, index) => (
              <article className="dashboard-target" key={`${receipt.url}-${index}`}>
                <h3>{receipt.title ?? receipt.source}</h3>
                <a href={receipt.url} rel="noreferrer noopener" target="_blank">
                  Open original evidence ↗
                </a>
                <p>{receipt.reason}</p>
                <small>
                  observed {utcDate(receipt.observed_at)} UTC · {receipt.role.toLowerCase()} ·{" "}
                  {receipt.availability
                    ? receipt.availability.replaceAll("_", " ").toLowerCase()
                    : "availability not recorded"}{" "}
                  · {receipt.verified ? "verified" : "awaiting owner attestation"}
                </small>
              </article>
            ))
          ) : (
            <p>No evidence receipt was present in the persisted result.</p>
          )}
        </section>

        <section className="dashboard-proposal-section">
          <p className="kicker">Limitations</p>
          {proposal.limitations.length ? (
            <ol>
              {proposal.limitations.map((limitation, index) => (
                <li key={`${index}-${limitation}`}>{limitation}</li>
              ))}
            </ol>
          ) : (
            <p>No additional limitations were recorded.</p>
          )}
        </section>

        {children}
      </div>
    </section>
  );
}
