import type { Metadata } from "next";
import Link from "next/link";
import { AnalyticsPageView } from "../../components/analytics-page-view";
import { ApiPreview } from "../../components/api-preview";
import { ScanForm } from "../../components/scan-form";
import { AGENT_TOOLS } from "../../lib/marketing-content";
import { pageMetadata } from "../../lib/site";

export const metadata: Metadata = pageMetadata({
  title: "Trend intelligence for AI agents",
  description:
    "Give ChatGPT, Claude, Codex, Cursor, OpenClaw, Hermes, n8n, Make, Zapier, and other HTTP-capable agents one evidence-backed Next Move.",
  path: "/agents",
});

const available = [
  "REST API",
  "Structured Next Move JSON",
  "Async status endpoint",
  "Project-scoped API keys for approved users",
  "HTTP workflow examples",
] as const;

const comingSoon = ["TrendsFast CLI", "MCP server", "Native connectors"] as const;

export default function AgentsPage() {
  return (
    <>
      <AnalyticsPageView event={{ event: "agents_page_viewed", placement: "agents" }} />
      <section className="intent-hero section-pad">
        <p className="section-index">AI AGENTS / HTTP API</p>
        <h1>Give every agent one evidence-backed Next Move.</h1>
        <p>
          TrendsFast turns a public product URL and bounded trend evidence into structured JSON that
          any approved, HTTP-capable agent can request and poll.
        </p>
        <div className="inline-actions">
          <Link className="button button-primary" href="/docs">
            Read the dev docs <span aria-hidden="true">→</span>
          </Link>
          <Link className="button button-secondary" href="/#scan">
            Request API access
          </Link>
        </div>
      </section>

      <section className="capability-section section-pad">
        <article>
          <p className="section-index">AVAILABLE</p>
          <h2>One ordinary HTTP contract.</h2>
          <ul>
            {available.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>
        <article>
          <p className="section-index">COMING SOON</p>
          <h2>No connector theater.</h2>
          <ul>
            {comingSoon.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p>A generic HTTP example is not a native integration.</p>
        </article>
      </section>

      <section className="automation-section section-pad">
        <div className="section-heading">
          <div>
            <p className="section-index">EXAMPLE WORKFLOWS</p>
            <h2>Use the tool already in your stack.</h2>
          </div>
          <p>Each example uses the same authenticated create, poll, and result sequence.</p>
        </div>
        <div className="agent-grid" tabIndex={0} aria-label="AI agent workflow examples">
          {AGENT_TOOLS.map((tool) => (
            <article key={tool}>
              <span aria-hidden="true">{tool.slice(0, 2).toUpperCase()}</span>
              <h3>{tool}</h3>
              <p>Example HTTP workflow</p>
            </article>
          ))}
        </div>
      </section>

      <section className="api-section section-pad">
        <div className="section-heading">
          <div>
            <p className="section-index">CREATE → POLL → DECIDE</p>
            <h2>The same result humans see.</h2>
          </div>
          <p>
            Keys are unique to an approved project, shown once, bounded by rate and provider-cost
            controls, and revocable. Result polling does not create a research run.
          </p>
        </div>
        <ApiPreview />
      </section>

      <section className="repeat-scan-section section-pad">
        <div>
          <p className="section-index">PROVE VALUE BEFORE ACCESS</p>
          <h2>Start with one founder-reviewed scan.</h2>
        </div>
        <ScanForm compact formId="agents-scan" analyticsPlacement="agents" />
      </section>
    </>
  );
}
