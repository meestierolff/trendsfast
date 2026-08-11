import type { Metadata } from "next";

export const metadata: Metadata = { title: "API docs" };

const request = `curl -X POST https://trendsfast.com/v1/next-move \\
  -H "Authorization: Bearer tf_test_<prefix>.<secret>" \\
  -H "Idempotency-Key: 4a2d1201-9666-4ef0-90a9-e5aa47786c8e" \\
  -H "Content-Type: application/json" \\
  -d '{
    "product_url": "https://example.com",
    "goal": "qualified_signups",
    "market": "US",
    "language": "en"
  }'`;

const accepted = `HTTP/1.1 202 Accepted
Location: https://trendsfast.com/v1/next-moves/scan_01J...

{
  "id": "scan_01J...",
  "status": "QUEUED",
  "status_url": "https://trendsfast.com/v1/next-moves/scan_01J..."
}`;

export default function DocsPage() {
  return (
    <>
      <section className="page-hero section-pad">
        <p className="section-index">REST API / V1</p>
        <h1>One decision-ready response.</h1>
        <p>
          The API exposes the same Next Move contract as the reviewed web result. It does not resell
          a generic source-data feed.
        </p>
      </section>
      <section className="content-page section-pad">
        <div className="prose">
          <h2>Create or reuse a Next Move</h2>
          <p>
            Only <code>product_url</code> is required. A new bounded scan returns 202. A suitable
            fresh, founder-reviewed result may return 200. Repeat the same idempotency key to
            receive the same request.
          </p>
          <pre className="code-block">
            <code>{request}</code>
          </pre>
          <pre className="code-block">
            <code>{accepted}</code>
          </pre>

          <h2>Lifecycle</h2>
          <p>
            <code>QUEUED → RUNNING → REVIEW_REQUIRED → READY</code>, with explicit{" "}
            <code>FAILED</code>.
          </p>
          <p>
            Provider work is bounded, state is persisted around every external step, and delivery is
            idempotent. A READY result is never public by default and always reports{" "}
            <code>auto_publish=false</code>.
          </p>

          <h2>Authentication</h2>
          <p>
            Design-partner keys are manually issued by the founder. Store the raw secret once;
            TrendsFast only stores its prefix and a keyed hash. The public free-scan form never
            exposes a reusable key.
          </p>

          <h2>Contract files</h2>
          <p>
            Runtime Zod schemas generate the OpenAPI artifact in the repository. API availability
            and design partner issuance remain alpha-gated until the deployed database and
            authorization checks pass.
          </p>
        </div>
      </section>
    </>
  );
}
