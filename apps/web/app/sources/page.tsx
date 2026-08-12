import type { Metadata } from "next";
import { listPublicSourceStatuses } from "../../lib/source-projection-service";
import { pageMetadata } from "../../lib/site";

// The source ledger reflects mutable, durable provider verification records.
// Rendering it dynamically prevents a deployment build from permanently
// baking in an older Connected or degraded state.
export const dynamic = "force-dynamic";

export const metadata: Metadata = pageMetadata({
  title: "Source status and limitations",
  description:
    "See which TrendsFast evidence sources are connected, limited, coming soon, unavailable, or permission-gated, with technical read-back truth preserved.",
  path: "/sources",
});

function formatTimestamp(value: string | null): string {
  if (!value) return "No deployed read-back recorded";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toISOString();
}

export default async function SourcesPage() {
  const sources = await listPublicSourceStatuses();
  return (
    <>
      <section className="intent-hero section-pad">
        <p className="section-index">SOURCE TRUTH / DEPLOYED READ-BACKS ONLY</p>
        <h1>Every source, honestly labeled.</h1>
        <p>
          A provider adapter, example, or configured key is not production proof. Friendly labels
          stay tied to a dated deployed read-back, while exact engineering state remains available
          below.
        </p>
      </section>

      <section className="source-ledger section-pad" aria-label="Evidence source ledger">
        {sources.map((source) => (
          <article className="source-card" key={source.slug}>
            <div className="source-card-heading">
              <div>
                <span>{source.provider}</span>
                <h2>{source.name}</h2>
              </div>
              <strong data-status={source.publicLabel.toLowerCase().replaceAll(" ", "-")}>
                {source.publicLabel}
              </strong>
            </div>
            <p>{source.role}</p>
            <details>
              <summary>
                Technical source state: {source.technicalState}
                <span aria-hidden="true">+</span>
              </summary>
              <dl>
                <div>
                  <dt>Engineering state</dt>
                  <dd>{source.technicalState}</dd>
                </div>
                <div>
                  <dt>Production verified</dt>
                  <dd>{source.productionVerified ? "Yes" : "No"}</dd>
                </div>
                <div>
                  <dt>Last verified</dt>
                  <dd>{formatTimestamp(source.lastVerifiedAt)}</dd>
                </div>
                <div>
                  <dt>Example available</dt>
                  <dd>{source.exampleAvailable ? "Yes" : "No"}</dd>
                </div>
                {source.readBackEvidence ? (
                  <>
                    <div>
                      <dt>Credential mode</dt>
                      <dd>{source.readBackEvidence.credentialMode}</dd>
                    </div>
                    <div>
                      <dt>Health</dt>
                      <dd>{source.readBackEvidence.healthStatus ?? "Not reported"}</dd>
                    </div>
                    <div>
                      <dt>Latency</dt>
                      <dd>
                        {source.readBackEvidence.latencyMs === null
                          ? "Not reported"
                          : `${source.readBackEvidence.latencyMs} ms`}
                      </dd>
                    </div>
                    <div>
                      <dt>Canonical URLs</dt>
                      <dd>{source.readBackEvidence.canonicalUrlCount}</dd>
                    </div>
                    <div>
                      <dt>Actual provider cost</dt>
                      <dd>{source.readBackEvidence.actualCostUsd ?? "Unknown"}</dd>
                    </div>
                    <div>
                      <dt>Quota</dt>
                      <dd>{source.readBackEvidence.quotaUsed}</dd>
                    </div>
                  </>
                ) : null}
              </dl>
              <ul>
                {source.limitations.map((limitation) => (
                  <li key={limitation}>{limitation}</li>
                ))}
              </ul>
            </details>
          </article>
        ))}
      </section>

      <section className="usage-truth section-pad">
        <div>
          <p className="section-index">WHAT WE WILL NOT CLAIM</p>
          <h2>A popular post is not automatically a trend.</h2>
        </div>
        <p>
          TrendsFast does not compare raw engagement across platforms, infer star velocity from one
          GitHub snapshot, turn copied coverage into independent corroboration, or present Reddit
          automation before commercial permission and legal review.
        </p>
      </section>
    </>
  );
}
