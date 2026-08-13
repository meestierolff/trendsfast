import type { Metadata } from "next";
import { pageMetadata } from "../../lib/site";

export const metadata: Metadata = pageMetadata({
  title: "Open product metrics",
  description:
    "TrendsFast publishes denominator-backed usefulness, usage, evidence validity, review-time, WAIT, and repeat-scan metrics only when verified.",
  path: "/open",
});

const metrics = [
  "Products scanned",
  "Scans delivered",
  "Useful-move rate",
  "Moves used",
  "Evidence validity",
  "Median founder review time",
  "WAIT rate",
  "Research time replaced",
];

export default function OpenMetricsPage() {
  return (
    <>
      <section className="page-hero section-pad">
        <p className="section-index">OPEN PROOF / VERIFIED DENOMINATORS</p>
        <h1>
          Denominators
          <br />
          before celebration.
        </h1>
        <p>
          The first cohort is measured for usefulness, evidence validity, actual usage, founder
          review time—not signups or dashboard sessions.
        </p>
      </section>
      <section className="content-page section-pad">
        <div className="metric-grid">
          {metrics.map((metric) => (
            <article className="metric-card" key={metric}>
              <span>{metric}</span>
              <strong>Not enough verified data yet</strong>
            </article>
          ))}
        </div>
        <div className="prose">
          <h2>Publication rule</h2>
          <p>
            Rates appear only with a denominator and verified events. Review time uses recorded
            review timestamps. Evidence validity is checked at delivery. No fixture, internal
            dogfood, or unapproved public scan is blended into external cohort proof without a
            label. Managed-cloud economics stay private.
          </p>
        </div>
      </section>
    </>
  );
}
