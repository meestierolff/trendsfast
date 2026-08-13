import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { loadEnv } from "@trendsfast/config";

import { OpsReviewDetail } from "../../../components/ops-review-detail";
import { getOpsRepositories } from "../../../lib/server-database";
import { getOpsPageAuthorization } from "../_auth";

import "../ops.css";

export const metadata: Metadata = {
  title: "Scan review · Founder operations",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

export default async function OpsScanDetailPage({
  params,
}: {
  params: Promise<{ scanId: string }>;
}) {
  const authorization = await getOpsPageAuthorization();
  if (!authorization) redirect("/ops");

  const { scanId } = await params;
  if (!/^[A-Za-z0-9_.-]{1,100}$/.test(scanId)) notFound();

  const repositories = getOpsRepositories();
  const detail = await repositories.scans.getStatusByPublicId(scanId);
  if (!detail) notFound();

  const [sourceRuns, signalRows, clusters] = detail.run
    ? await Promise.all([
        repositories.scanData.listSourceRuns(detail.run.id),
        repositories.scanData.listSignalsForRun(detail.run.id),
        repositories.scanData.listClustersForRun(detail.run.id),
      ])
    : [[], [], []];
  const matchingQueue = await repositories.reviews.listQueue({
    states: [detail.request.state],
    limit: 100,
  });
  const deliveryState = matchingQueue.find(
    (item) => item.request.id === detail.request.id,
  )?.deliveryState;

  return (
    <section className="ops-shell ops-detail-shell section-pad">
      <OpsReviewDetail
        detail={{
          request: detail.request,
          run: detail.run
            ? {
                id: detail.run.id,
                attempt: detail.run.attempt,
                state: detail.run.state,
                signalClass: detail.run.signalClass,
                actualCostUsd: detail.run.actualCostUsd,
                estimatedCostUsd: detail.run.estimatedCostUsd,
                startedAt: detail.run.startedAt,
                reviewRequiredAt: detail.run.reviewRequiredAt,
                completedAt: detail.run.completedAt,
                hardDeadlineAt: detail.run.hardDeadlineAt,
                failureCode: detail.run.failureCode,
                failureMessage: detail.run.failureMessage,
                sourceCoverage: detail.run.sourceCoverage,
                queryPlan: detail.run.queryPlan
                  ? {
                      version: detail.run.queryPlan.version,
                      generatedAt: detail.run.queryPlan.generatedAt,
                      providers: detail.run.queryPlan.providers.map((group) => ({
                        id: group.id,
                        source: group.source,
                        role: group.role,
                        terms: group.terms,
                        constraints: {
                          maxCalls: group.constraints.maxCalls,
                          maxResults: group.constraints.maxResults,
                          ...(group.constraints.lookbackHours === undefined
                            ? {}
                            : { lookbackHours: group.constraints.lookbackHours }),
                        },
                      })),
                    }
                  : null,
              }
            : null,
          project: detail.project,
          context: detail.context,
          move: detail.move,
          sourceRuns,
          evidence: detail.evidence,
          signals: signalRows.map(({ signal }) => ({
            id: signal.id,
            source: signal.source,
            provider: signal.provider,
            canonicalUrl: signal.canonicalUrl,
            title: signal.title,
            textExcerpt: signal.textExcerpt,
            publishedAt: signal.publishedAt,
            observedAt: signal.observedAt,
            queryId: signal.queryId,
            metrics: signal.metrics,
            cached: signal.cached,
          })),
          clusters,
          ...(deliveryState ? { deliveryState } : {}),
        }}
        csrfToken={authorization.csrfToken}
        now={new Date()}
        retryEnabled={loadEnv().PROVIDER_CREDENTIAL_MODE === "fixture"}
      />
    </section>
  );
}
