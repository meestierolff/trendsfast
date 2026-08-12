import type { Metadata } from "next";
import Link from "next/link";
import { AnalyticsPageView } from "../../components/analytics-page-view";
import { ApiPreview } from "../../components/api-preview";
import { pageMetadata } from "../../lib/site";

export const metadata: Metadata = pageMetadata({
  title: "Next Move API documentation",
  description:
    "Authenticate, create, poll, and consume one evidence-backed TrendsFast Next Move through the REST API.",
  path: "/docs",
});

const errors = [
  ["400", "The bounded request body or fields are invalid."],
  ["401", "The project-scoped API key is missing or invalid."],
  ["403", "The key family, environment, project scope, or origin is not allowed."],
  ["409", "The idempotency key was reused with a different payload."],
  ["413", "The request body exceeds its byte limit."],
  ["429", "The request exceeds a durable rate or cost-admission limit."],
  ["503", "Required configured coverage is temporarily unavailable."],
] as const;

const workflows = ["ChatGPT", "Claude", "Codex", "OpenClaw", "n8n"] as const;

export default function DocsPage() {
  return (
    <>
      <AnalyticsPageView event={{ event: "docs_viewed", placement: "docs" }} />
      <section className="intent-hero section-pad">
        <p className="section-index">REST API / V1</p>
        <h1>Create one decision-ready Next Move.</h1>
        <p>
          The API exposes the same founder-reviewed contract as the private web result. It does not
          resell a generic source-data feed and it never auto-publishes.
        </p>
      </section>

      <section className="docs-layout section-pad">
        <aside>
          <strong>On this page</strong>
          <a href="#quickstart">Quickstart</a>
          <a href="#auth">Authentication</a>
          <a href="#lifecycle">Lifecycle</a>
          <a href="#limits">Limits</a>
          <a href="#errors">Errors</a>
          <a href="#workflows">Agent workflows</a>
        </aside>
        <div className="prose docs-prose">
          <section id="quickstart">
            <h2>Create, poll, receive</h2>
            <p>
              Only <code>product_url</code> is required. A new bounded scan returns 202. A suitable
              fresh, founder-reviewed result may return 200. Repeat the same idempotency key to
              receive the same request.
            </p>
            <ApiPreview compact />
          </section>

          <section id="auth">
            <h2>Authentication</h2>
            <p>
              Approved API users receive a unique project-scoped key with the form
              <code> tf_live_&lt;prefix&gt;.&lt;secret&gt;</code>. The raw secret is shown once;
              only a secure derived verifier and prefix are stored. Keys can expire, be
              rate-limited, revoked, and reissued.
            </p>
            <p>
              The public free-scan form never exposes a reusable API key. A test-family key cannot
              authorize managed live processing, and a live-family key cannot authorize example
              processing.
            </p>
          </section>

          <section id="lifecycle">
            <h2>Lifecycle</h2>
            <p>
              <code>QUEUED → RUNNING → REVIEW_REQUIRED → READY</code>, with explicit
              <code> FAILED</code>. Poll the returned status URL with the same Bearer key. A READY
              result is private by default, founder-reviewed, and always reports
              <code> auto_publish=false</code>.
            </p>
          </section>

          <section id="limits">
            <h2>Limits and cost admission</h2>
            <p>
              Scan creation is bounded by key, time window, provider-cost reservation, and the
              per-scan cost ceiling. Polling an existing result does not create another research
              run, but remains subject to normal abuse controls. “Unlimited agents” never means
              unlimited scan creation or provider fan-out.
            </p>
          </section>

          <section id="errors">
            <h2>Bounded errors</h2>
            <div className="error-grid">
              {errors.map(([code, text]) => (
                <div key={code}>
                  <code>{code}</code>
                  <p>{text}</p>
                </div>
              ))}
            </div>
          </section>

          <section id="workflows">
            <h2>Agent workflow examples</h2>
            <p>
              The examples below all use HTTP. They are not claims of native connectors, plugins, or
              account integrations.
            </p>
            <div className="workflow-list">
              {workflows.map((workflow) => (
                <span key={workflow}>{workflow} · HTTP example</span>
              ))}
            </div>
            <p>
              The runtime OpenAPI 3.1 document is served at <code>GET /v1/openapi.json</code>.
              Public API access remains approval-gated until a project key has been issued.
            </p>
          </section>

          <div className="inline-actions">
            <Link className="button button-primary" href="/agents">
              TrendsFast for agents <span aria-hidden="true">→</span>
            </Link>
            <Link className="button button-secondary" href="/#scan">
              Run a free scan
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
