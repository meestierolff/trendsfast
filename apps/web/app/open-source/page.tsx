import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Open source" };

export default function OpenSourcePage() {
  return (
    <>
      <section className="page-hero section-pad">
        <p className="section-index">AGPL-3.0 / REAL ENGINE</p>
        <h1>
          Open source,
          <br />
          without the theater.
        </h1>
        <p>
          The public repository contains the decision engine, provider contracts, scoring, truth
          rules, evidence binding, web app, API, and fixture data.
        </p>
      </section>
      <section className="content-page section-pad">
        <div className="prose">
          <h2>What self-hosters get</h2>
          <ul>
            <li>The complete fixture vertical slice without paid provider credentials.</li>
            <li>Standard PostgreSQL 15+ with committed SQL migrations and Drizzle.</li>
            <li>
              BYO provider keys through server environment variables—never stored in PostgreSQL.
            </li>
            <li>The same Next Move runtime contract used by managed cloud.</li>
            <li>Source limitations, cost controls, audit events, and security tests.</li>
          </ul>

          <h2>What managed cloud adds</h2>
          <p>
            Operator-owned provider accounts, shared signal collection, historical baselines,
            scheduling, retries, fallbacks, cost control, provider upkeep, uptime, and support. It
            does not hide a better decision algorithm.
          </p>

          <h2>License and brand</h2>
          <p>
            Application code is AGPL-3.0-only. The TrendsFast name and marks are governed separately
            by the trademark policy. Customer data, managed provider credentials, and cloud history
            are never part of the repository.
          </p>

          <h2>Start in fixture mode</h2>
          <pre className="code-block">
            <code>{`cp .env.example .env.local
docker compose up -d postgres
pnpm install
pnpm db:migrate && pnpm db:seed
pnpm dev`}</code>
          </pre>
          <p>
            See <Link href="/docs">the API contract</Link> and the repository SELF_HOSTING guide for
            the exact environment and verification commands.
          </p>
        </div>
      </section>
    </>
  );
}
