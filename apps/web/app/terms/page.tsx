import type { Metadata } from "next";
import { pageMetadata } from "../../lib/site";

export const metadata: Metadata = pageMetadata({
  title: "Terms",
  description:
    "TrendsFast service limitations, acceptable use, evidence handling, and no-outcome-guarantee terms.",
  path: "/terms",
});

export default function TermsPage() {
  return (
    <>
      <section className="page-hero section-pad">
        <p className="section-index">SERVICE TERMS / FOUNDER AND COUNSEL REVIEW REQUIRED</p>
        <h1>Clear limits before you act.</h1>
      </section>
      <section className="content-page section-pad">
        <div className="prose">
          <p>
            This draft must be reviewed and completed by the founder and appropriate legal counsel
            before public launch.
          </p>
          <h2>No outcome guarantee</h2>
          <p>
            TrendsFast provides research assistance. It does not guarantee virality, views,
            customers, revenue, content volume, or uninterrupted provider coverage. You remain
            responsible for reviewing and publishing any content.
          </p>
          <h2>No auto-posting</h2>
          <p>
            TrendsFast does not connect social accounts or publish on your behalf. A recommendation
            may be PUBLISH, REPLY, REMIX, or WAIT.
          </p>
          <h2>Public evidence</h2>
          <p>
            Evidence links may disappear or change. The service records observation time,
            provenance, and known limitations, and marks unavailable sources rather than silently
            replacing them.
          </p>
          <h2>Acceptable use</h2>
          <p>
            Do not submit URLs you are not permitted to analyze, attempt to access private networks,
            evade rate limits, probe secrets, resell raw provider data, or use the service for
            unlawful surveillance or spam.
          </p>
          <h2>Managed-plan usage</h2>
          <p>
            Paid monitoring is not publicly enabled yet. If it is enabled after the launch gates, an
            on-demand refresh counts when accepted even when the result is WAIT or the scan later
            fails. Scheduled WAIT decisions also count as scheduled research. The displayed daily,
            billing-period, project, history, and delivery limits apply before confirmation.
          </p>
        </div>
      </section>
    </>
  );
}
