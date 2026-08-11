import Link from "next/link";
import { ApiPreview } from "../components/api-preview";
import { ExampleExplorer } from "../components/example-explorer";
import { ScanForm } from "../components/scan-form";
import { SourceStatusStrip } from "../components/source-status-strip";

const principles = [
  {
    number: "01",
    title: "Understand",
    text: "Read the product, infer the buyer, pain, credible claims, and the formats this founder can actually make.",
  },
  {
    number: "02",
    title: "Watch",
    text: "Query each source for its specific role. Keep original URLs, freshness, costs, and provider failures visible.",
  },
  {
    number: "03",
    title: "Decide",
    text: "Rank before synthesis, bind stored evidence, apply the quality floor, and return exactly one move—or WAIT.",
  },
];

export default function HomePage() {
  return (
    <>
      <section className="hero section-pad">
        <div className="hero-radar" aria-hidden="true">
          <span />
          <span />
          <span />
          <i />
        </div>
        <p className="kicker">
          <span className="kicker-dot" /> Distribution intelligence for founders + agents
        </p>
        <h1>
          Know what to
          <br />
          distribute <em>next.</em>
        </h1>
        <p className="hero-copy">
          Paste your product URL. TrendsFast combines live conversations, search demand, developer
          adoption, news triggers, and content-performance signals to give you one evidence-backed
          move.
        </p>
        <ScanForm />
        <div className="trust-row" aria-label="Alpha promises">
          <span>Founder-reviewed alpha</span>
          <span>No card</span>
          <span>No auto-posting</span>
          <span>Open source</span>
        </div>
      </section>

      <SourceStatusStrip />

      <section className="section-pad example-section" id="example">
        <div className="section-intro split-intro">
          <div>
            <p className="section-index">01 / THE PRODUCT</p>
            <h2>
              One decision.
              <br />
              All the receipts.
            </h2>
          </div>
          <p>
            No feed to babysit. No generic calendar. The decision card tells you what to say, where
            to say it, why the window is open, and where every claim came from.
          </p>
        </div>
        <ExampleExplorer />
        <p className="example-disclosure">
          This interaction uses deterministic fixture data so you can inspect the complete contract
          without provider credentials. It is an example, not traction proof.
        </p>
      </section>

      <section className="process section-pad">
        <div className="section-intro">
          <p className="section-index">02 / HOW IT THINKS</p>
          <h2>From a URL to a defensible move.</h2>
        </div>
        <div className="process-grid">
          {principles.map((principle) => (
            <article key={principle.number}>
              <span>{principle.number}</span>
              <div className="process-glyph" aria-hidden="true">
                <i />
                <i />
                <i />
              </div>
              <h3>{principle.title}</h3>
              <p>{principle.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="truth-section section-pad">
        <div className="truth-copy">
          <p className="section-index">03 / TRUST BEFORE VOLUME</p>
          <h2>Recent is not the same as trending.</h2>
          <p>
            TrendsFast separates measured time series, internally observed velocity, cross-source
            corroboration, early signals, and insufficient evidence. It never invents a velocity
            number.
          </p>
          <Link className="text-link" href="/sources">
            Inspect every source and limitation <span>→</span>
          </Link>
        </div>
        <div className="signal-stack" aria-label="Signal truth classes">
          {[
            ["MEASURED_EXTERNAL_SERIES", "Provider-supplied time series", "01"],
            ["MEASURED_INTERNAL_VELOCITY", "Two time-separated snapshots", "02"],
            ["CORROBORATED_SIGNAL", "Independent sources, same window", "03"],
            ["EMERGING_SIGNAL", "One strong, recent opportunity", "04"],
            ["INSUFFICIENT_SIGNAL", "Return WAIT", "05"],
          ].map(([name, note, number]) => (
            <div key={name}>
              <span>{number}</span>
              <strong>{name}</strong>
              <small>{note}</small>
            </div>
          ))}
        </div>
      </section>

      <section className="api-section section-pad">
        <div className="section-intro split-intro">
          <div>
            <p className="section-index">04 / ONE CONTRACT</p>
            <h2>
              Built for humans.
              <br />
              Structured for agents.
            </h2>
          </div>
          <div>
            <p>
              The web result and REST API expose the same Next Move. One TrendsFast key for managed
              cloud; bring your own provider keys when self-hosting.
            </p>
            <Link className="text-link" href="/docs">
              Read the API contract <span>→</span>
            </Link>
          </div>
        </div>
        <ApiPreview />
      </section>

      <section className="model-section section-pad">
        <div className="section-intro">
          <p className="section-index">05 / OPEN ENGINE, MANAGED OPERATIONS</p>
          <h2>
            Same decision engine.
            <br />
            Different operational burden.
          </h2>
        </div>
        <div className="model-grid">
          <article>
            <span className="model-label">SELF-HOSTED</span>
            <h3>Bring your own keys.</h3>
            <p>
              The real engine, provider interfaces, scoring, evidence rules, and fixture demo under
              AGPL-3.0.
            </p>
            <ul>
              <li>Standard PostgreSQL</li>
              <li>Environment-based provider keys</li>
              <li>One-command fixture path</li>
              <li>Your hosting and operations</li>
            </ul>
            <Link href="/open-source">Explore self-hosting →</Link>
          </article>
          <article className="cloud-card">
            <span className="model-label">FOUNDER CLOUD BETA · HYPOTHESIS</span>
            <h3>
              $39 <small>/ month</small>
            </h3>
            <p>
              One monitored product. Provider accounts, daily checks, retries, history, and support
              managed.
            </p>
            <ul>
              <li>Billing is disabled during alpha</li>
              <li>No card for the first reviewed scan</li>
              <li>Next Moves only above the quality floor</li>
              <li>30-day history and API access later</li>
            </ul>
            <span className="disabled-cta">Not for sale yet</span>
          </article>
        </div>
      </section>

      <section className="metrics-band">
        <div>
          <p className="section-index">06 / OPEN PROOF</p>
          <h2>
            Measured publicly,
            <br />
            once there is data.
          </h2>
        </div>
        <div className="empty-metrics">
          {["Useful-move rate", "Moves actually used", "Evidence validity", "Median scan cost"].map(
            (metric) => (
              <span key={metric}>
                <small>{metric}</small>
                <strong>Not enough verified data yet</strong>
              </span>
            ),
          )}
        </div>
        <Link href="/open">See the denominator-backed ledger →</Link>
      </section>

      <section className="faq section-pad">
        <div className="section-intro">
          <p className="section-index">07 / STRAIGHT ANSWERS</p>
          <h2>Before you paste a URL.</h2>
        </div>
        <div className="faq-list">
          {[
            [
              "Will it post for me?",
              "No. auto_publish is always false in the alpha. You choose, edit, and publish.",
            ],
            [
              "Is every source live?",
              "No. Status and real read-back state are separate. Missing keys degrade coverage and remain visible.",
            ],
            [
              "Why founder review?",
              "The first cohort is for learning. A human checks context, evidence fit, limitations, and the final decision before delivery.",
            ],
            [
              "What happens to my scan?",
              "It is private by default, addressed by an unguessable token, minimized, and retained according to the documented policy.",
            ],
            [
              "Why might I receive WAIT?",
              "Because a trustworthy non-action is better than a thin trend claim or generic post idea.",
            ],
            [
              "Can I self-host it?",
              "Yes. Fixture mode needs no paid credentials; live self-hosting uses your provider keys and ordinary PostgreSQL.",
            ],
          ].map(([question, answer]) => (
            <details key={question}>
              <summary>
                {question}
                <span>+</span>
              </summary>
              <p>{answer}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="final-cta section-pad">
        <span className="orbit" aria-hidden="true" />
        <p className="section-index">YOUR PRODUCT URL IS THE ONBOARDING</p>
        <h2>
          Stop researching.
          <br />
          <em>Choose the move.</em>
        </h2>
        <ScanForm compact />
        <p>One free founder-reviewed scan · Private by default · No card</p>
      </section>
    </>
  );
}
