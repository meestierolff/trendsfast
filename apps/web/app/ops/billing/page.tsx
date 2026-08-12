import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { billingAvailability } from "@trendsfast/billing";
import { loadEnv } from "@trendsfast/config";

import { OpsBillingManager } from "../../../components/ops-billing-manager";
import { getRepositories } from "../../../lib/server-database";
import { deploymentProvenance } from "../../../lib/deployment-provenance";
import { getOpsPageAuthorization } from "../_auth";

import "../ops.css";

export const metadata: Metadata = {
  title: "Billing · Founder operations",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

export default async function OpsBillingPage() {
  const authorization = await getOpsPageAuthorization();
  if (!authorization) redirect("/ops");
  const env = loadEnv();
  const availability = billingAvailability({
    billingEnabled: env.BILLING_ENABLED,
    paidMonitoringEnabled: env.PAID_MONITORING_ENABLED,
    mode: env.STRIPE_MODE,
    providerCredentialMode: env.PROVIDER_CREDENTIAL_MODE,
    deploymentEnvironment: deploymentProvenance().deploymentEnvironment,
  });
  const repositories = getRepositories();
  const projects = await repositories.scanData.listProjects({ activeOnly: true, limit: 100 });
  const projectViews = await Promise.all(
    projects.map(async (project) => {
      const [entitlement, customer] = await Promise.all([
        repositories.billing.entitlementForProject(project.id),
        repositories.billing.customerForProject(project.id),
      ]);
      return {
        id: project.id,
        name: project.name,
        url: project.url,
        entitlementActive: entitlement?.active ?? false,
        hasCustomer: Boolean(customer),
      };
    }),
  );

  return (
    <section className="ops-shell ops-detail-shell section-pad">
      <p className="ops-detail-back">
        <Link href="/ops">← Review queue</Link>
      </p>
      <div className="ops-detail-hero">
        <div>
          <p className="ops-kicker">PRIVATE / STRIPE BILLING</p>
          <h1>Founder billing.</h1>
          <p>
            Customer Portal sessions are project-bound and available through this authenticated
            founder control. Checkout starts only from a private delivered Next Move.
          </p>
        </div>
      </div>
      <OpsBillingManager
        csrfToken={authorization.csrfToken}
        checkoutAvailable={availability.checkoutAvailable}
        availabilityReason={availability.reason}
        projects={projectViews}
      />
    </section>
  );
}
