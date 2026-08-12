import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { OpsFounderLaunchInterestManager } from "../../../components/ops-founder-launch-interest-manager";
import { getRepositories } from "../../../lib/server-database";
import { getOpsPageAuthorization } from "../_auth";

import "../ops.css";

export const metadata: Metadata = {
  title: "Founder launch interest · Founder operations",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

export default async function OpsLaunchInterestPage() {
  const authorization = await getOpsPageAuthorization();
  if (!authorization) redirect("/ops");
  const interests = await getRepositories().founderLaunchInterests.list({ limit: 500 });

  return (
    <section className="ops-shell ops-detail-shell section-pad">
      <p className="ops-detail-back">
        <Link href="/ops">← Review queue</Link>
      </p>
      <div className="ops-detail-hero">
        <div>
          <p className="ops-kicker">PRIVATE / CONSENTED CONTACT</p>
          <h1>Founder launch interest.</h1>
          <p>
            Retained addresses are visible only here, expire after 180 days, and can be hard-deleted
            without copying the address into the audit record.
          </p>
        </div>
      </div>
      <OpsFounderLaunchInterestManager
        csrfToken={authorization.csrfToken}
        initialItems={interests.map((interest) => ({
          id: interest.id,
          email: interest.email,
          source: interest.source,
          consentVersion: interest.consentVersion,
          consentedAt: interest.consentedAt.toISOString(),
          expiresAt: interest.expiresAt.toISOString(),
        }))}
      />
    </section>
  );
}
