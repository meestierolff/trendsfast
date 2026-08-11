import Link from "next/link";
import { ApiPreview } from "./api-preview";
import { ExampleExplorer } from "./example-explorer";
import { ScanForm } from "./scan-form";

export type IntentPageProps = {
  eyebrow: string;
  title: string;
  intro: string;
  points: readonly { title: string; text: string }[];
};

export function IntentPage({ eyebrow, title, intro, points }: IntentPageProps) {
  return (
    <>
      <section className="intent-hero section-pad">
        <p className="section-index">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{intro}</p>
        <ScanForm formId="intent-scan" />
        <p className="intent-trust">
          One free founder-reviewed scan · No card · Private by default
        </p>
      </section>

      <section className="intent-demo section-pad">
        <div className="section-heading compact-heading">
          <div>
            <p className="section-index">URL → NEXT MOVE</p>
            <h2>See the same decision object.</h2>
          </div>
          <p>Product demo using example data.</p>
        </div>
        <ExampleExplorer />
      </section>

      <section className="intent-points section-pad">
        {points.map((point, index) => (
          <article key={point.title}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <h2>{point.title}</h2>
            <p>{point.text}</p>
          </article>
        ))}
      </section>

      <section className="intent-api section-pad">
        <div className="section-heading compact-heading">
          <div>
            <p className="section-index">ONE HTTP CONTRACT</p>
            <h2>Built for every agent that can call an API.</h2>
          </div>
          <p>
            Evidence sources inform the decision. The recommended output channel tells the founder
            where to act. TrendsFast does not publish.
          </p>
        </div>
        <ApiPreview compact />
        <div className="inline-actions">
          <Link className="button button-primary" href="/docs">
            Read the dev docs <span aria-hidden="true">→</span>
          </Link>
          <Link className="button button-secondary" href="/#scan">
            Run a free scan
          </Link>
        </div>
      </section>
    </>
  );
}
