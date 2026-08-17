import { DashboardActionDetails } from "@/components/dashboard-action-details";
import { DashboardEmpty } from "@/components/dashboard-empty";
import { DashboardProjectSwitcher } from "@/components/dashboard-project-switcher";
import { DashboardProposalCard } from "@/components/dashboard-proposal-card";
import { DashboardRefreshControl } from "@/components/dashboard-refresh-control";
import { DashboardTodayActions } from "@/components/dashboard-today-actions";
import {
  getDashboardProject,
  parseDashboardContext,
  parseDashboardMove,
  requireDashboardSubject,
  resolveDashboardProject,
} from "@/lib/dashboard-service";
import {
  buildNextDistributionContentAgentHandoffV1,
  mapPersistedDashboardProposalV1,
} from "@/lib/next-distribution-content-proposal";
import type { ContentCapabilityName } from "@trendsfast/schemas";
import { isMemberConfirmedProjectContext } from "@trendsfast/database";
import Link from "next/link";

export const dynamic = "force-dynamic";

function label(value: string) {
  return value.replaceAll("_", " ").toLowerCase();
}

export default async function DashboardTodayPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const authUserId = await requireDashboardSubject();
  const requestedProjectId = typeof query.project === "string" ? query.project : undefined;
  const { projects, selected } = await resolveDashboardProject({
    authUserId,
    ...(requestedProjectId ? { requestedProjectId } : {}),
  });
  if (!selected) return <DashboardEmpty />;
  const dashboard = await getDashboardProject({ authUserId, projectId: selected.project.id });
  if (!dashboard) return <DashboardEmpty />;
  const current = parseDashboardMove(dashboard);
  const pendingRequest = dashboard.pendingRequest;
  const context = parseDashboardContext(dashboard);
  const contextConfirmed = context
    ? isMemberConfirmedProjectContext(context.record.createdBy)
    : false;
  const proposal = current
    ? mapPersistedDashboardProposalV1({
        versionedMove: current.versionedMove,
        whyNow: current.move.whyNow,
        evidence: current.evidence,
        limitations: current.move.limitations,
        founderReviewed: current.move.founderReviewed,
      })
    : null;
  const agentPrompt = proposal ? buildNextDistributionContentAgentHandoffV1(proposal) : null;
  const refreshInput = context
    ? {
        objective: context.context.desiredOutcome,
        preferredChannels: context.context.suitableChannels,
        contentCapabilities: Object.entries(context.record.contentCapabilities)
          .filter(([, enabled]) => enabled)
          .map(([name]) => name) as ContentCapabilityName[],
      }
    : null;

  return (
    <>
      <DashboardProjectSwitcher
        projects={projects}
        selectedProjectId={selected.project.id}
        path="/dashboard/today"
      />
      <div className="dashboard-section-heading">
        <div>
          <p className="kicker">Your next distribution move</p>
          <h2>Today</h2>
        </div>
        <p>
          One founder-reviewed decision with a channel, format, timing window, exact evidence, and
          visible limitations.
        </p>
      </div>

      {!current ? (
        <section className="dashboard-empty">
          <p className="kicker">
            {contextConfirmed ? "No current contract" : "Founder confirmation required"}
          </p>
          <h2>{contextConfirmed ? "Run a fresh scan." : "Confirm the product context."}</h2>
          <p>
            {contextConfirmed
              ? "This project has no ready result using the current action-specific contract. Older results remain in History but are not served as current recommendations."
              : "Review the bounded website observations and inferred context before any broader research can run."}
          </p>
          {contextConfirmed && pendingRequest ? (
            <div className="dashboard-panel dashboard-panel-wide" role="status">
              <p className="kicker">REST status · {pendingRequest.state}</p>
              <h3>One proposal is already in progress.</h3>
              <p>
                This project is single-flight: another request cannot reserve provider work or cost
                while this one is queued or running. Refresh this page after the returned
                Retry-After interval.
              </p>
              <Link
                className="button button-secondary"
                href={`/dashboard/today?project=${encodeURIComponent(selected.project.id)}`}
              >
                Refresh status
              </Link>
            </div>
          ) : contextConfirmed && refreshInput ? (
            <DashboardRefreshControl
              projectId={selected.project.id}
              request={refreshInput}
              label="Generate next distribution content"
            />
          ) : (
            <Link
              className="button button-primary"
              href={
                context
                  ? `/dashboard/projects?project=${encodeURIComponent(selected.project.id)}&confirm=1`
                  : `/dashboard/new?url=${encodeURIComponent(selected.project.url)}`
              }
            >
              {context ? "Review context" : "Read website"} <span aria-hidden="true">→</span>
            </Link>
          )}
        </section>
      ) : (
        <>
          <DashboardProposalCard proposal={proposal!} stale={current.freshness.state === "STALE"}>
            <DashboardTodayActions
              key={current.move.id}
              projectId={selected.project.id}
              nextMoveId={current.move.id}
              stale={current.freshness.state === "STALE"}
              proposal={proposal!}
              agentPrompt={agentPrompt!}
              refreshInput={refreshInput}
              reviewState={current.move.state as "DRAFT" | "APPROVED" | "READY"}
              reviewVersion={current.move.reviewVersion}
              evidenceReceiptIds={current.evidence
                .filter((receipt) => receipt.bindingRole === "DECISION_SUPPORT")
                .map((receipt) => receipt.id)}
              initialSkipped={dashboard.outcomes.some((outcome) => outcome.kind === "SKIPPED")}
              activeRequestState={
                pendingRequest?.state === "QUEUED" || pendingRequest?.state === "RUNNING"
                  ? pendingRequest.state
                  : null
              }
            />
          </DashboardProposalCard>

          <details className="dashboard-decision-details">
            <summary>Why TrendsFast chose this</summary>
            <div className="dashboard-decision-details-body">
              <div className="dashboard-grid">
                <section className="dashboard-panel">
                  <p className="kicker">Trend window</p>
                  <h2>{label(current.trendWindow.state)}</h2>
                  <dl>
                    <dt>Evidence basis</dt>
                    <dd>{label(current.trendWindow.basis)}</dd>
                    <dt>Act by</dt>
                    <dd>
                      {current.trendWindow.recommended_action_by
                        ? new Date(current.trendWindow.recommended_action_by).toUTCString()
                        : "No narrower deadline supported"}
                    </dd>
                    <dt>Recheck</dt>
                    <dd>{new Date(current.trendWindow.recheck_at).toUTCString()}</dd>
                    <dt>Estimated remaining window</dt>
                    <dd>
                      {current.trendWindow.estimated_remaining_hours
                        ? `${current.trendWindow.estimated_remaining_hours.min}–${current.trendWindow.estimated_remaining_hours.max} rounded hours`
                        : "Unknown; no duration claimed"}
                    </dd>
                  </dl>
                  <p>{current.trendWindow.explanation}</p>
                </section>

                <section className="dashboard-panel">
                  <p className="kicker">BreakoutPotential · not a probability</p>
                  <h2>{current.breakoutPotential.level}</h2>
                  <p>{current.breakoutPotential.explanation}</p>
                  <dl>
                    <dt>Basis</dt>
                    <dd>{label(current.breakoutPotential.basis)}</dd>
                    {Object.entries(current.breakoutPotential.factors).map(([factor, score]) => (
                      <div key={factor}>
                        <dt>{label(factor)}</dt>
                        <dd>{Number(score).toFixed(2)} / 1.00</dd>
                      </div>
                    ))}
                    <dt>Why now</dt>
                    <dd>{current.move.whyNow}</dd>
                    <dt>Founder review</dt>
                    <dd>{current.move.founderReviewed ? "Complete" : "Required"}</dd>
                  </dl>
                </section>
              </div>
              <DashboardActionDetails details={current.details} />
            </div>
          </details>
        </>
      )}
    </>
  );
}
