import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { OpsProviderVerificationControl } from "../../../components/ops-provider-verification-control";
import { getRepositories } from "../../../lib/server-database";
import { getOpsPageAuthorization } from "../_auth";

import "../ops.css";

export const metadata: Metadata = {
  title: "Source verification · Founder operations",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

export default async function OpsSourcesPage() {
  const authorization = await getOpsPageAuthorization();
  if (!authorization) redirect("/ops");
  const records = await getRepositories().providerVerifications.list({ limit: 200 });

  return (
    <section className="ops-shell ops-detail-shell section-pad">
      <p className="ops-detail-back">
        <Link href="/ops">← Review queue</Link>
        <span>/</span>
        <Link href="/ops/keys">Project API keys</Link>
      </p>
      <div className="ops-detail-hero">
        <div>
          <p className="ops-kicker">PRIVATE / SOURCE TRUTH</p>
          <h1>Provider read-backs.</h1>
          <p>
            Exact engineering state stays here; public pages receive a friendly safe projection.
          </p>
        </div>
      </div>

      <OpsProviderVerificationControl csrfToken={authorization.csrfToken} />

      <section className="ops-provider-runs" aria-labelledby="provider-history-title">
        <div className="ops-detail-section-heading">
          <div>
            <p className="ops-kicker">Append-only history</p>
            <h2 id="provider-history-title">{records.length} verification records</h2>
          </div>
        </div>
        <div className="ops-provider-table-wrap">
          <table className="ops-provider-table">
            <thead>
              <tr>
                <th>Source / provider</th>
                <th>Technical state</th>
                <th>Read-back</th>
                <th>Health / latency</th>
                <th>Cost / quota</th>
                <th>Checked</th>
              </tr>
            </thead>
            <tbody>
              {records.map((record) => (
                <tr key={record.id}>
                  <td>
                    <strong>{record.source}</strong>
                    <small>{record.provider}</small>
                  </td>
                  <td>{record.state}</td>
                  <td>
                    {record.readbackVerified ? "VERIFIED" : "NO"} · {record.canonicalUrls.length}{" "}
                    canonical URL(s)
                  </td>
                  <td>
                    {record.healthStatus ?? "NOT RUN"} ·{" "}
                    {record.latencyMs === null ? "—" : `${record.latencyMs}ms`}
                  </td>
                  <td>
                    ${record.actualCostUsd ?? record.estimatedCostUsd} · {record.quotaUsed} units
                  </td>
                  <td>{(record.checkedAt ?? record.createdAt).toUTCString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {records.map((record) => (
          <details key={`detail-${record.id}`}>
            <summary>
              {record.source} · {record.state} ·{" "}
              {(record.checkedAt ?? record.createdAt).toUTCString()}
            </summary>
            <p>{record.limitations.join(" ") || "No limitations recorded."}</p>
            {record.failureCode ? (
              <p>
                {record.failureCode}: {record.failureMessage ?? "No safe message"}
              </p>
            ) : null}
            <ul>
              {record.canonicalUrls.map((url) => (
                <li key={url}>
                  <code>{url}</code>
                </li>
              ))}
            </ul>
          </details>
        ))}
      </section>
    </section>
  );
}
