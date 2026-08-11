import Link from "next/link";
import { SITE_GITHUB_URL } from "../lib/site";

const free = [
  "One founder-reviewed scan",
  "One public product URL",
  "One PUBLISH, REPLY, REMIX, or WAIT",
  "Evidence and limitations",
  "No card",
  "Private by default",
] as const;

const founder = [
  "One monitored product",
  "One scheduled research run per day",
  "Ten on-demand refreshes per billing month",
  "Up to one new delivered Next Move per day",
  "Next Moves only when the quality floor passes",
  "Project-scoped API key",
  "Unlimited agent/client connections to that key",
  "Result polling does not consume a research run",
  "30-day history",
  "Managed provider accounts",
] as const;

const openSource = [
  "The same decision engine",
  "Example mode",
  "PostgreSQL",
  "Bring your own provider keys",
  "Self-hosted operations",
] as const;

function FeatureList({ items }: { items: readonly string[] }) {
  return (
    <ul>
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

function safeCheckoutHref(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function PricingCards({
  paidEnabled = false,
  paidHref,
}: {
  paidEnabled?: boolean;
  paidHref?: string;
}) {
  const checkoutHref = safeCheckoutHref(paidHref);
  const checkoutAvailable = paidEnabled && checkoutHref !== null;
  return (
    <div className="pricing-grid">
      <article className="pricing-card">
        <span className="pricing-kicker">Free Scan</span>
        <h3>
          $0 <small>once</small>
        </h3>
        <p>See the complete URL-to-Next-Move loop before signup or payment.</p>
        <FeatureList items={free} />
        <Link className="button button-primary" href="/#scan">
          Run a free scan <span aria-hidden="true">→</span>
        </Link>
      </article>

      <article className="pricing-card pricing-card-featured" id="founder">
        <span className="pricing-kicker">Founder</span>
        <h3>
          $39 <small>/ month</small>
        </h3>
        <p>Planned managed monitoring for one product, with bounded research usage.</p>
        <FeatureList items={founder} />
        <p className="pricing-limit">Not unlimited scan creation.</p>
        {checkoutAvailable ? (
          <a className="button button-primary" href={checkoutHref}>
            Start Founder <span aria-hidden="true">→</span>
          </a>
        ) : (
          <span className="button button-muted" aria-disabled="true">
            Join the paid launch list
          </span>
        )}
      </article>

      <article className="pricing-card">
        <span className="pricing-kicker">Open Source</span>
        <h3>
          $0 <small>+ provider costs</small>
        </h3>
        <p>Run the real engine yourself and own the operational work.</p>
        <FeatureList items={openSource} />
        <a
          className="button button-secondary"
          href={SITE_GITHUB_URL}
          rel="noreferrer"
          target="_blank"
        >
          View on GitHub <span aria-hidden="true">↗</span>
        </a>
      </article>
    </div>
  );
}
