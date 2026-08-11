import type { Metadata } from "next";
import Link from "next/link";
import { ApiPreview } from "../components/api-preview";
import { DemoMedia } from "../components/demo-media";
import { ExampleExplorer } from "../components/example-explorer";
import { FaqList } from "../components/faq-list";
import { JsonLd } from "../components/json-ld";
import { PricingCards } from "../components/pricing-cards";
import { ScanForm } from "../components/scan-form";
import { SourceStatusStrip } from "../components/source-status-strip";
import { AnalyticsPageView } from "../components/analytics-page-view";
import {
  AGENT_TOOLS,
  AUDIENCES,
  EVIDENCE_SOURCES,
  FAQS,
  FEATURES,
  FOUNDER_STORY,
  HOW_IT_WORKS,
  OUTPUT_CHANNELS,
  PROOF_POINTS,
} from "../lib/marketing-content";
import { absoluteUrl, DEFAULT_DESCRIPTION, SITE_GITHUB_URL } from "../lib/site";

export const metadata: Metadata = {
  alternates: { canonical: absoluteUrl("/") },
  openGraph: { url: absoluteUrl("/") },
};

function MarketingSchema() {
  const organization = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "TrendsFast",
    url: absoluteUrl("/"),
    logo: absoluteUrl("/icon"),
    sameAs: [SITE_GITHUB_URL],
  };
  const software = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "TrendsFast",
    url: absoluteUrl("/"),
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    description: DEFAULT_DESCRIPTION,
    offers: [
      {
        "@type": "Offer",
        name: "Free Scan",
        price: "0",
        priceCurrency: "USD",
      },
      {
        "@type": "Offer",
        name: "Open Source",
        price: "0",
        priceCurrency: "USD",
        url: SITE_GITHUB_URL,
      },
    ],
  };
  const faq = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQS.map(({ question, answer }) => ({
      "@type": "Question",
      name: question,
      acceptedAnswer: { "@type": "Answer", text: answer },
    })),
  };
  return (
    <>
      <JsonLd value={organization} />
      <JsonLd value={software} />
      <JsonLd value={faq} />
    </>
  );
}

export default function HomePage() {
  const announcementVisible = process.env.NEXT_PUBLIC_ANNOUNCEMENT_ENABLED !== "false";
  const announcementText =
    process.env.NEXT_PUBLIC_ANNOUNCEMENT_TEXT?.trim() ||
    "I’m running free trend and distribution scans for technical founders.";
  const videoUrl = process.env.NEXT_PUBLIC_DEMO_VIDEO_URL;
  const captionsUrl = process.env.NEXT_PUBLIC_DEMO_CAPTIONS_URL;
  const paidHref = process.env.NEXT_PUBLIC_FOUNDER_CHECKOUT_URL;
  const paidEnabled =
    process.env.BILLING_ENABLED === "true" && process.env.PAID_MONITORING_ENABLED === "true";

  return (
    <>
      <MarketingSchema />
      <AnalyticsPageView event={{ event: "landing_viewed", placement: "homepage" }} />

      {announcementVisible ? (
        <aside className="announcement-bar" aria-label="Free scan announcement">
          <span>{announcementText}</span>
          <Link href="/#scan">Run yours →</Link>
        </aside>
      ) : null}

      <section className="hero section-pad">
        <div className="hero-copy-column">
          <p className="kicker">
            <span className="kicker-dot" /> Social media and search trend intelligence for AI agents
          </p>
          <h1>
            <span>Spot the trends your users care about.</span>
            <strong>Know what to distribute next.</strong>
          </h1>
          <p className="hero-copy">
            Paste your product URL. TrendsFast turns live social conversations, search demand,
            developer adoption, news, and content signals into one evidence-backed topic, angle,
            format, and channel for every agent in your stack.
          </p>
          <p className="hero-support">
            Reach the right users before the moment passes—without chasing irrelevant hype.
          </p>
          <ScanForm formId="scan" analyticsPlacement="homepage_hero" />
          <div className="hero-actions">
            <a className="text-link" href="#demo">
              See it in action <span aria-hidden="true">↓</span>
            </a>
            <span>One free founder-reviewed scan · No card · Private by default · Open source</span>
          </div>
        </div>

        <div className="signal-visual" aria-hidden="true">
          <div className="signal-radar">
            <span />
            <span />
            <span />
            <i />
          </div>
          <div className="signal-stream signal-stream-one">
            <small>SEARCH</small>
            <strong>+ momentum</strong>
          </div>
          <div className="signal-stream signal-stream-two">
            <small>COMMUNITY</small>
            <strong>high relevance</strong>
          </div>
          <div className="signal-stream signal-stream-three">
            <small>DECISION</small>
            <strong>PUBLISH</strong>
          </div>
        </div>
      </section>

      <section className="proof-section" aria-label="Product trust and source coverage">
        <div className="proof-strip section-pad">
          {PROOF_POINTS.map((point, index) => (
            <span key={point}>
              <i aria-hidden="true">{index === 0 ? "◆" : "◇"}</i>
              <strong>{point}</strong>
            </span>
          ))}
        </div>
        <SourceStatusStrip />
      </section>

      <section className="contrast-section section-pad">
        <p>Social listening gives you a feed.</p>
        <p>Trend dashboards give you charts.</p>
        <p>Raw APIs give you JSON.</p>
        <strong>TrendsFast gives your agents the next move.</strong>
      </section>

      <section className="demo-section section-pad" id="demo">
        <div className="section-heading">
          <div>
            <p className="section-index">01 / THE SIGNATURE OBJECT</p>
            <h2>See what your agent gets.</h2>
          </div>
          <p>
            Switch between all four honest outcomes. Each decision keeps its context, why-now
            reasoning, evidence receipts, truth class, confidence, and limitations attached.
          </p>
        </div>
        <ExampleExplorer />
        <p className="example-disclosure">Product demo using example data.</p>
      </section>

      <section className="open-proof-section section-pad">
        <div>
          <p className="section-index">02 / PROOF YOU CAN INSPECT</p>
          <h2>Open engine. Visible rules.</h2>
        </div>
        <div className="open-proof-card">
          <span>AGPL-3.0</span>
          <p>
            Inspect the provider contracts, truth classes, deterministic ranking, evidence binding,
            WAIT quality floor, API schemas, and PostgreSQL lifecycle yourself.
          </p>
          <a href={SITE_GITHUB_URL} rel="noreferrer" target="_blank">
            View the source on GitHub <span aria-hidden="true">↗</span>
          </a>
        </div>
      </section>

      <section className="audience-section section-pad">
        <div className="section-heading">
          <div>
            <p className="section-index">03 / BUILT FOR THE BUILDER</p>
            <h2>Who is TrendsFast for?</h2>
          </div>
          <p>Technical founders and small teams who build faster than they distribute.</p>
        </div>
        <div className="audience-grid">
          {AUDIENCES.map((audience, index) => (
            <article key={audience.title}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <h3>{audience.title}</h3>
              <p>{audience.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="process-section section-pad">
        <div className="section-heading compact-heading">
          <div>
            <p className="section-index">04 / HOW IT WORKS</p>
            <h2>From a URL to one defensible move.</h2>
          </div>
        </div>
        <div className="process-grid">
          {HOW_IT_WORKS.map((step) => (
            <article key={step.number}>
              <span>{step.number}</span>
              <div className="process-glyph" aria-hidden="true">
                <i />
                <i />
                <i />
              </div>
              <h3>{step.title}</h3>
              <p>{step.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="repeat-scan-section section-pad">
        <div>
          <p className="section-index">YOUR URL IS THE ONBOARDING</p>
          <h2>What trend should your product act on next?</h2>
        </div>
        <ScanForm compact formId="scan-repeat" analyticsPlacement="homepage_repeat" />
      </section>

      <section className="video-section section-pad">
        <div className="section-heading">
          <div>
            <p className="section-index">05 / SEE IT IN ACTION</p>
            <h2>From public URL to evidence-backed decision.</h2>
          </div>
          <p>
            The walkthrough follows the real contract: infer context, inspect coverage, reveal the
            move, open evidence, complete founder review, then call the API.
          </p>
        </div>
        <DemoMedia {...(videoUrl ? { videoUrl } : {})} {...(captionsUrl ? { captionsUrl } : {})} />
      </section>

      <section className="automation-section section-pad">
        <div className="section-heading">
          <div>
            <p className="section-index">06 / AGENT-READY</p>
            <h2>Power every agent with live trend intelligence.</h2>
          </div>
          <p>Give the tools you already use one structured, evidence-backed distribution move.</p>
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
        <div className="capability-legend">
          <span>Available: HTTP API</span>
          <span>Available: Example workflows</span>
          <span>Coming soon: Native integrations</span>
        </div>
      </section>

      <section className="features-section section-pad">
        <div className="section-heading compact-heading">
          <div>
            <p className="section-index">07 / IMPLEMENTED OUTCOMES</p>
            <h2>Enough signal to decide. Enough restraint to WAIT.</h2>
          </div>
        </div>
        <div className="feature-grid">
          {FEATURES.map(([title, text], index) => (
            <article key={title}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <h3>{title}</h3>
              <p>{text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="api-section section-pad">
        <div className="section-heading">
          <div>
            <p className="section-index">08 / TRENDSFAST FOR AGENTS</p>
            <h2>Create once. Poll normally. Receive the same Next Move.</h2>
          </div>
          <div>
            <p>
              Approved users receive a unique project-scoped key. Scan creation is bounded by rate
              and cost limits; normal result polling does not create a research run. Nothing
              auto-publishes.
            </p>
            <div className="inline-actions">
              <Link className="button button-primary" href="/docs">
                Read the dev docs <span aria-hidden="true">→</span>
              </Link>
              <Link className="button button-secondary" href="/#scan">
                Request API access
              </Link>
            </div>
          </div>
        </div>
        <ApiPreview />
      </section>

      <section className="channels-section section-pad">
        <div className="section-heading">
          <div>
            <p className="section-index">09 / SOURCES ARE NOT DESTINATIONS</p>
            <h2>Evidence in. Recommended channel out.</h2>
          </div>
          <p>Evidence and recommended channel do not have to be the same.</p>
        </div>
        <div className="channel-contrast">
          <article>
            <span>Evidence sources</span>
            <ul>
              {EVIDENCE_SOURCES.map((source) => (
                <li key={source}>{source}</li>
              ))}
            </ul>
          </article>
          <div className="channel-arrow" aria-hidden="true">
            <span>ONE NEXT MOVE</span>
            <i>→</i>
          </div>
          <article>
            <span>Output channels</span>
            <ul>
              {OUTPUT_CHANNELS.map((channel) => (
                <li key={channel}>{channel}</li>
              ))}
            </ul>
          </article>
        </div>
        <Link className="text-link" href="/channels">
          Explore channel guidance <span aria-hidden="true">→</span>
        </Link>
      </section>

      <section className="founder-section section-pad">
        <div className="founder-mark" aria-hidden="true">
          TF
        </div>
        <div>
          <p className="section-index">10 / WHY I BUILT IT</p>
          <h2>Building got fast. Choosing what to say did not.</h2>
          <p>{FOUNDER_STORY}</p>
          <Link className="text-link" href="/blog/recent-is-not-the-same-as-trending">
            Read the thinking <span aria-hidden="true">→</span>
          </Link>
        </div>
      </section>

      <section className="pricing-section section-pad" id="pricing">
        <div className="section-heading">
          <div>
            <p className="section-index">11 / PRICING</p>
            <h2>Start with the decision. Pay only for managed repetition.</h2>
          </div>
          <p>
            The free scan proves the product object. Open source gives you control. Managed
            monitoring stays bounded by real research and provider cost.
          </p>
        </div>
        <PricingCards paidEnabled={paidEnabled} {...(paidHref ? { paidHref } : {})} />
      </section>

      <section className="faq-section section-pad">
        <div className="section-heading compact-heading">
          <div>
            <p className="section-index">12 / STRAIGHT ANSWERS</p>
            <h2>Before you paste a URL.</h2>
          </div>
        </div>
        <FaqList />
      </section>

      <section className="final-cta section-pad">
        <div className="final-orbit" aria-hidden="true">
          <span />
          <span />
        </div>
        <p className="section-index">ONE URL. ONE DECISION.</p>
        <h2>
          Stop researching every platform.
          <strong>Spot the trend your users care about now.</strong>
        </h2>
        <ScanForm compact formId="scan-final" analyticsPlacement="homepage_final" />
        <p>One free founder-reviewed scan · Private by default · No card</p>
      </section>
    </>
  );
}
