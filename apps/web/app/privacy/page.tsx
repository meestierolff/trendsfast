import type { Metadata } from "next";
import { pageMetadata } from "../../lib/site";

export const metadata: Metadata = pageMetadata({
  title: "Privacy",
  description:
    "How TrendsFast handles submitted product URLs, private results, provider data, analytics, retention, and sharing consent.",
  path: "/privacy",
});

export default function PrivacyPage() {
  return (
    <>
      <section className="page-hero section-pad">
        <p className="section-index">POLICY DRAFT / FOUNDER AND COUNSEL REVIEW REQUIRED</p>
        <h1>Privacy, in plain language.</h1>
      </section>
      <section className="content-page section-pad">
        <div className="prose">
          <p>
            This is an operational summary, not a substitute for founder and legal review before
            public launch.
          </p>
          <h2>What we need</h2>
          <p>
            We store the submitted product URL, inferred public product context, bounded source
            receipts, scan lifecycle and cost metadata, feedback you choose to submit, and the
            minimum security audit events needed to operate the service. If you explicitly join the
            paid launch list, we also store the normalized email address and consent record needed
            to contact you about that launch.
          </p>
          <h2>Private by default</h2>
          <p>
            Scan links use unguessable tokens and are not made public without explicit consent. We
            do not send private scan URLs, API keys, emails, free text, prompts, or evidence text to
            optional external analytics. First-party browser analytics use an HMAC-derived,
            short-lived session identity and fixed event dimensions rather than raw private URLs or
            submitted content.
          </p>
          <h2>Retention and deletion</h2>
          <p>
            The current configuration defaults to a 90-day scan and analytics retention target.
            Paid-launch interest expires after 180 days unless you consent again. The application
            includes an authenticated, dedicated-role retention job and an ops-only daily schedule
            template, but no hosted execution or self-service deletion endpoint is verified yet. A
            reviewed operator can invoke the exact-project, launch-interest, or expiry-purge
            procedure; completion and lawful retention exceptions must be verified manually. Public
            launch remains gated on owned, monitored privacy intake and scheduler workflows.
          </p>
          <h2>Providers</h2>
          <p>
            Public website content and public source metadata may be sent to configured model/data
            providers to produce a scan. Managed keys stay server-side. Provider-specific terms and
            rights remain disclosed in the source-rights matrix.
          </p>
        </div>
      </section>
    </>
  );
}
