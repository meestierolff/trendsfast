import type { Metadata } from "next";

export const metadata: Metadata = { title: "Privacy" };

export default function PrivacyPage() {
  return (
    <>
      <section className="page-hero section-pad">
        <p className="section-index">ALPHA POLICY / FOUNDER REVIEW REQUIRED</p>
        <h1>Privacy, in plain language.</h1>
      </section>
      <section className="content-page section-pad">
        <div className="prose">
          <p>
            This is an operational alpha summary, not a substitute for founder and legal review
            before public launch.
          </p>
          <h2>What we need</h2>
          <p>
            We store the submitted product URL, inferred public product context, bounded source
            receipts, scan lifecycle and cost metadata, feedback you choose to submit, and the
            minimum security audit events needed to operate the service.
          </p>
          <h2>Private by default</h2>
          <p>
            Scan links use unguessable tokens and are not made public without explicit consent. We
            do not send private scan URLs, API keys, emails, free text, prompts, or evidence text to
            optional external analytics.
          </p>
          <h2>Retention and deletion</h2>
          <p>
            The alpha configuration defaults to a 90-day retention target, but no automated purge
            scheduler or self-service deletion endpoint is enabled yet. A reviewed operator can
            invoke the repository&apos;s exact-project deletion or expiry-purge procedure;
            completion and lawful retention exceptions must be verified manually. Public launch
            remains gated on an owned, monitored workflow.
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
