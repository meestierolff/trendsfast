import Link from "next/link";

import { loadEnv } from "@trendsfast/config";

import { DashboardEmpty } from "@/components/dashboard-empty";
import { DashboardProjectSwitcher } from "@/components/dashboard-project-switcher";
import { requireDashboardSubject, resolveDashboardProject } from "@/lib/dashboard-service";

export const dynamic = "force-dynamic";

export default async function DashboardBillingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const authUserId = await requireDashboardSubject();
  const requestedProjectId = typeof query.project === "string" ? query.project : undefined;
  const { projects, selected } = await resolveDashboardProject({
    authUserId,
    ...(requestedProjectId ? { requestedProjectId } : {}),
  });
  if (!selected) return <DashboardEmpty />;
  const env = loadEnv();

  return (
    <>
      <DashboardProjectSwitcher
        projects={projects}
        selectedProjectId={selected.project.id}
        path="/dashboard/billing"
      />
      <div className="dashboard-section-heading">
        <div>
          <p className="kicker">Billing</p>
          <h2>Free scan first. Monitoring optional.</h2>
        </div>
        <p>
          TrendsFast uses Stripe-hosted Checkout and Customer Portal. Billing never blocks the first
          founder-reviewed result.
        </p>
      </div>

      <div className="dashboard-grid">
        <section className="dashboard-panel">
          <p className="kicker">On demand</p>
          <h2>Claimed project</h2>
          <p>
            Your private result and dashboard remain separate from billing. Founder-plan research
            allowances are project-level and are not multiplied by API key count.
          </p>
          <Link
            className="button button-secondary"
            href={`/dashboard/today?project=${selected.project.id}`}
          >
            Open today&apos;s move
          </Link>
        </section>

        <section className="dashboard-panel">
          <p className="kicker">Optional monitoring</p>
          <h2>€39 per month</h2>
          <p>
            One monitored product, one scheduled run per UTC day, plus the bounded on-demand
            allowance. No auto-posting and no hidden publishing credentials.
          </p>
          {env.BILLING_ENABLED && env.BILLING_CHECKOUT_ENABLED ? (
            <p>
              The private result offers the project-bound Stripe Checkout when the complete live
              billing gate is available.
            </p>
          ) : (
            <p>Checkout is not enabled on this deployment. Your free scan remains unaffected.</p>
          )}
          <Link className="button button-secondary" href="/pricing">
            Review plan details
          </Link>
        </section>

        <section className="dashboard-panel dashboard-panel-wide">
          <p className="kicker">Stripe-hosted management</p>
          <h2>Subscription and invoices</h2>
          {env.STRIPE_PORTAL_LOGIN_URL ? (
            <a
              className="button button-primary"
              href={env.STRIPE_PORTAL_LOGIN_URL}
              rel="noreferrer noopener"
            >
              Continue to Stripe Customer Portal ↗
            </a>
          ) : (
            <p>The hosted Customer Portal is not enabled on this deployment.</p>
          )}
        </section>
      </div>
    </>
  );
}
