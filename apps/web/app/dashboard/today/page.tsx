import { DashboardActionDetails } from "@/components/dashboard-action-details";
import { DashboardEmpty } from "@/components/dashboard-empty";
import { DashboardProjectSwitcher } from "@/components/dashboard-project-switcher";
import { DashboardRefreshControl } from "@/components/dashboard-refresh-control";
import { DashboardTodayActions } from "@/components/dashboard-today-actions";
import {
  getDashboardProject,
  parseDashboardContext,
  parseDashboardMove,
  requireDashboardSubject,
  resolveDashboardProject,
} from "@/lib/dashboard-service";
import type { ContentCapabilityName } from "@trendsfast/schemas";

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
  const context = parseDashboardContext(dashboard);

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
          <p className="kicker">No current contract</p>
          <h2>Run a fresh scan.</h2>
          <p>
            This project has no ready result using the current action-specific contract. Older
            results remain in History but are not served as current recommendations.
          </p>
          <DashboardRefreshControl projectId={selected.project.id} />
        </section>
      ) : (
        <>
          <section className="dashboard-action-banner">
            <strong>{current.move.action}</strong>
            <div>
              <h2>{current.move.topic}</h2>
              <p>
                {current.move.channel} · {current.move.format} · valid until{" "}
                {current.move.validUntil.toUTCString()}
              </p>
            </div>
            <span className="dashboard-status" data-stale={current.freshness.state === "STALE"}>
              {current.freshness.state}
            </span>
          </section>

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

          <section className="dashboard-panel dashboard-panel-wide dashboard-evidence">
            <p className="kicker">Original evidence</p>
            <h2>
              {current.evidence.length} stored receipt{current.evidence.length === 1 ? "" : "s"}
            </h2>
            {current.evidence.map((receipt) => (
              <article className="dashboard-target" key={receipt.id}>
                <h3>{receipt.title ?? receipt.source}</h3>
                <a href={receipt.canonicalUrl} rel="noreferrer noopener" target="_blank">
                  Open original evidence ↗
                </a>
                <p>{receipt.reason}</p>
                <small>
                  observed {receipt.observedAt.toUTCString()} · {receipt.bindingRole.toLowerCase()}
                </small>
              </article>
            ))}
          </section>

          <section className="dashboard-panel dashboard-panel-wide">
            <p className="kicker">Visible limitations</p>
            <h2>What this move does not prove</h2>
            {current.move.limitations.length ? (
              <ol>
                {current.move.limitations.map((limitation, index) => (
                  <li key={`${index}-${limitation}`}>{limitation}</li>
                ))}
              </ol>
            ) : (
              <p>No additional limitations were recorded.</p>
            )}
          </section>

          <DashboardTodayActions
            projectId={selected.project.id}
            nextMoveId={current.move.id}
            stale={current.freshness.state === "STALE"}
            structuredBrief={{
              contract_version: current.move.decisionContractVersion,
              project: context?.context ?? {
                name: selected.project.name,
                url: selected.project.url,
              },
              action: current.move.action,
              channel: current.move.channel,
              topic: current.move.topic,
              action_details: current.details,
              trend_window: current.trendWindow,
              breakout_potential: current.breakoutPotential,
              evidence: current.evidence.map((receipt) => ({
                source: receipt.source,
                url: receipt.canonicalUrl,
                title: receipt.title,
                observed_at: receipt.observedAt.toISOString(),
                reason: receipt.reason,
              })),
              limitations: current.move.limitations,
              founder_reviewed: current.move.founderReviewed,
              auto_publish: false,
            }}
            agentPrompt={`I want to grow ${context?.context.name ?? selected.project.name ?? "this brand"} among ${context?.context.audience ?? "its saved audience"}. Use TrendsFast to find the strongest current opportunity. Show me the evidence and the exact PUBLISH, REPLY, REMIX, or WAIT recommendation. Draft the asset in our saved voice, but do not publish without approval.`}
            refreshInput={{
              ...(context?.context.desiredOutcome
                ? { objective: context.context.desiredOutcome }
                : {}),
              preferredChannels: context?.context.suitableChannels ?? [],
              contentCapabilities: context
                ? (Object.entries(context.record.contentCapabilities)
                    .filter(([, enabled]) => enabled)
                    .map(([name]) => name) as ContentCapabilityName[])
                : [],
            }}
          />
        </>
      )}
    </>
  );
}
