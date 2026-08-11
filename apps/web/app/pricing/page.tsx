import type { Metadata } from "next";
import { AnalyticsPageView } from "../../components/analytics-page-view";
import { FaqList } from "../../components/faq-list";
import { PricingCards } from "../../components/pricing-cards";
import { pageMetadata } from "../../lib/site";

export const metadata: Metadata = pageMetadata({
  title: "Pricing",
  description:
    "Start with one free founder-reviewed TrendsFast scan, self-host the open-source engine, or join the bounded managed-monitoring launch list.",
  path: "/pricing",
});

export default function PricingPage() {
  return (
    <>
      <AnalyticsPageView event={{ event: "pricing_viewed", placement: "pricing" }} />
      <section className="intent-hero section-pad">
        <p className="section-index">PRICING / BOUNDED BY REAL RESEARCH</p>
        <h1>See the decision free. Pay for managed repetition.</h1>
        <p>
          TrendsFast sells a composed, evidence-backed decision—not upstream tasks, model tokens,
          provider credits, or unlimited research fan-out.
        </p>
      </section>
      <section className="pricing-section section-pad">
        <PricingCards launchInterestSource="pricing" />
      </section>
      <section className="usage-truth section-pad" id="api-access">
        <div>
          <p className="section-index">USAGE TRUTH</p>
          <h2>Unlimited clients. Bounded research.</h2>
        </div>
        <p>
          “Unlimited agents” means multiple clients can use the same project-scoped key and poll
          existing results. It never means unlimited projects, full scans, provider calls, or model
          use. An accepted on-demand refresh consumes one refresh regardless of PUBLISH, REPLY,
          REMIX, or WAIT.
        </p>
      </section>
      <section className="faq-section section-pad">
        <div className="section-heading compact-heading">
          <div>
            <p className="section-index">PRICING FAQ</p>
            <h2>Limits in plain language.</h2>
          </div>
        </div>
        <FaqList />
      </section>
    </>
  );
}
