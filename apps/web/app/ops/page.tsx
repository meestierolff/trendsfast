import type { Metadata } from "next";
import Link from "next/link";

import { OpsLoginForm } from "../../components/ops-login-form";
import { OpsQueue, type OpsQueueItemView } from "../../components/ops-queue";
import { getRepositories } from "../../lib/server-database";
import { getOpsPageAuthorization } from "./_auth";

import "./ops.css";

export const metadata: Metadata = {
  title: "Founder operations",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

const allowedFilters = new Set(["ALL", "QUEUED", "RUNNING", "REVIEW_REQUIRED", "READY", "FAILED"]);

export default async function OpsPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string | string[] }>;
}) {
  const authorization = await getOpsPageAuthorization();

  if (!authorization) {
    return (
      <section className="ops-shell section-pad">
        <p className="section-index">PRIVATE / SERVER-ONLY</p>
        <h1>Founder operations</h1>
        <p>
          This is a temporary founder control protected by a server-only token and secure cookie—not
          long-term customer authentication.
        </p>
        <OpsLoginForm />
      </section>
    );
  }

  const rawFilter = (await searchParams).state;
  const requestedFilter = typeof rawFilter === "string" ? rawFilter.toUpperCase() : "ALL";
  const activeFilter = allowedFilters.has(requestedFilter) ? requestedFilter : "ALL";
  let items: OpsQueueItemView[] = [];
  let readError: string | undefined;

  try {
    const queue = await getRepositories().reviews.listQueue({ limit: 100 });
    items = queue.map((item) => ({
      publicId: item.request.publicId,
      state: item.request.state,
      origin: item.request.origin,
      submittedUrl: item.request.submittedUrl,
      submittedAt: item.request.submittedAt,
      startedAt: item.request.startedAt,
      completedAt: item.request.completedAt,
      inferredProduct: item.inferredProduct,
      run: item.run
        ? {
            attempt: item.run.attempt,
            state: item.run.state,
            actualCostUsd: item.run.actualCostUsd,
            estimatedCostUsd: item.run.estimatedCostUsd,
            sourceCoverage: item.run.sourceCoverage,
            updatedAt: item.run.updatedAt,
          }
        : null,
      nextMove: item.nextMove
        ? {
            action: item.nextMove.action,
            state: item.nextMove.state,
            signalClass: item.nextMove.signalClass,
            founderReviewed: item.nextMove.founderReviewed,
          }
        : null,
      providerFailure: item.providerFailure,
      deliveryState: item.deliveryState,
    }));
  } catch {
    readError = "Check the PostgreSQL connection and committed migrations, then refresh.";
  }

  return (
    <section className="ops-shell section-pad">
      <div className="ops-heading">
        <div>
          <p className="section-index">PRIVATE / REVIEW QUEUE</p>
          <h1>Founder operations</h1>
        </div>
        <form action="/api/ops/session" method="post">
          <input type="hidden" name="_method" value="delete" />
          <button className="quiet-button" type="submit">
            Sign out
          </button>
        </form>
      </div>
      <nav className="ops-detail-back" aria-label="Founder operations tools">
        <Link href="/ops/keys">Project API keys</Link>
        <span>/</span>
        <Link href="/ops/sources">Source verification</Link>
        <span>/</span>
        <Link href="/ops/billing">Founder billing</Link>
        <span>/</span>
        <Link href="/ops/launch-interest">Launch interest</Link>
      </nav>
      <OpsQueue
        items={items}
        activeFilter={activeFilter}
        now={new Date()}
        {...(readError ? { error: readError } : {})}
      />
    </section>
  );
}
