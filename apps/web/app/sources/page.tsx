import type { Metadata } from "next";
import { SOURCE_CATALOG, productionStatus } from "../../lib/source-catalog";

export const metadata: Metadata = { title: "Source status" };

export default function SourcesPage() {
  return (
    <>
      <section className="page-hero section-pad">
        <p className="section-index">SOURCE LEDGER / V0.1</p>
        <h1>
          Source status,
          <br />
          without theater.
        </h1>
        <p>
          A configured adapter is not the same as a verified production source. This ledger shows
          the launch role, bounded policy, and current read-back truth separately.
        </p>
      </section>
      <section className="content-page section-pad">
        <p className="source-table-scroll-hint" id="source-table-scroll-hint">
          Swipe or use the arrow keys to inspect every source column →
        </p>
        <table
          className="source-table"
          aria-label="Provider source status"
          aria-describedby="source-table-scroll-hint"
          tabIndex={0}
        >
          <thead>
            <tr>
              <th>Source</th>
              <th>Launch label</th>
              <th>Verified now</th>
              <th>Role</th>
              <th>Provider / limitation</th>
            </tr>
          </thead>
          <tbody>
            {SOURCE_CATALOG.map((source) => {
              const effective = productionStatus(source);
              return (
                <tr key={source.slug}>
                  <td>
                    <strong>{source.name}</strong>
                  </td>
                  <td>
                    <span
                      className={`status-pill ${source.status === "LEGAL_REVIEW" ? "legal" : ""}`}
                    >
                      {source.status}
                    </span>
                  </td>
                  <td>
                    <span
                      className={`status-pill ${effective === "READ_BACK_PENDING" ? "pending" : ""}`}
                    >
                      {effective}
                    </span>
                  </td>
                  <td>{source.role}</td>
                  <td>
                    <strong>{source.provider}</strong>
                    <br />
                    <small>{source.limitation}</small>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="prose">
          <h2>What LIVE means</h2>
          <p>
            LIVE is the intended v0.1 product status. A source is only production-verified after a
            successful server-side read-back using the deployed environment. Until then, this page
            says READ_BACK_PENDING. Fixture coverage never upgrades that claim.
          </p>
          <h2>What we will not claim</h2>
          <p>
            TrendsFast does not call a recent popular post a trend, compare raw engagement across
            platforms, infer star velocity from one GitHub snapshot, or present automated Reddit
            access before commercial permission and legal review.
          </p>
        </div>
      </section>
    </>
  );
}
