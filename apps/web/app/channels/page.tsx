import type { Metadata } from "next";
import Link from "next/link";
import { ScanForm } from "../../components/scan-form";
import { EVIDENCE_SOURCES, OUTPUT_CHANNELS } from "../../lib/marketing-content";
import { pageMetadata } from "../../lib/site";

export const metadata: Metadata = pageMetadata({
  title: "Trend evidence and content distribution channels",
  description:
    "See how TrendsFast separates evidence sources from the channel recommended for one founder-reviewed distribution move.",
  path: "/channels",
});

const guidance = [
  {
    name: "X",
    use: "A concise founder point of view or timely reply when the product has a credible contribution.",
  },
  {
    name: "LinkedIn",
    use: "A practical B2B lesson, teardown, or product-specific operator story with enough context to stand alone.",
  },
  {
    name: "Reddit",
    use: "A manual, community-rule-compliant founder answer or story. TrendsFast does not automate Reddit ingestion or posting.",
  },
  {
    name: "YouTube",
    use: "A short workflow demonstration, tutorial, or evidence-led teardown the founder can credibly show.",
  },
  {
    name: "TikTok",
    use: "A concise visual explanation when the format fits the product and founder—not because a topic is broadly popular.",
  },
  {
    name: "Blog or newsletter",
    use: "A durable explanation when the evidence supports depth, search intent, or an owned-audience follow-up.",
  },
] as const;

export default function ChannelsPage() {
  return (
    <>
      <section className="intent-hero section-pad">
        <p className="section-index">CHANNEL GUIDANCE / NO AUTO-POSTING</p>
        <h1>Evidence can come from one place and point somewhere else.</h1>
        <p>
          TrendsFast uses source evidence to decide where a founder can make the most credible
          contribution. Evidence and recommended channel do not have to be the same.
        </p>
        <ScanForm formId="channels-scan" />
      </section>

      <section className="channels-section section-pad">
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
            <span>DECISION, NOT INGESTION PARITY</span>
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
      </section>

      <section className="channel-guidance section-pad">
        <div className="section-heading compact-heading">
          <div>
            <p className="section-index">OUTPUT GUIDANCE</p>
            <h2>One move, shaped for its destination.</h2>
          </div>
        </div>
        <div className="feature-grid">
          {guidance.map((item, index) => (
            <article key={item.name}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <h3>{item.name}</h3>
              <p>{item.use}</p>
            </article>
          ))}
        </div>
        <p className="channel-disclaimer">
          TrendsFast does not connect social accounts or publish. You remain responsible for
          community rules, review, editing, and the final action.
        </p>
        <Link className="text-link" href="/sources">
          Inspect source status and limitations <span aria-hidden="true">→</span>
        </Link>
      </section>
    </>
  );
}
