import { evaluateNextMoveFreshness } from "@trendsfast/schemas";

import { DashboardEmpty } from "@/components/dashboard-empty";
import { DashboardProjectSwitcher } from "@/components/dashboard-project-switcher";
import {
  getDashboardHistory,
  requireDashboardSubject,
  resolveDashboardProject,
} from "@/lib/dashboard-service";

export const dynamic = "force-dynamic";

export default async function DashboardHistoryPage({
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
  const history = await getDashboardHistory({ authUserId, projectId: selected.project.id });
  const now = new Date();

  return (
    <>
      <DashboardProjectSwitcher
        projects={projects}
        selectedProjectId={selected.project.id}
        path="/dashboard/history"
      />
      <div className="dashboard-section-heading">
        <div>
          <p className="kicker">Earlier Next Moves</p>
          <h2>History</h2>
        </div>
        <p>
          Expired recommendations stay visible as history, but never masquerade as a current move.
        </p>
      </div>

      {history.length ? (
        <section className="dashboard-panel dashboard-panel-wide">
          <table className="dashboard-table">
            <thead>
              <tr>
                <th>Action</th>
                <th>Opportunity</th>
                <th>Generated / valid</th>
                <th>Freshness</th>
                <th>Outcome & feedback</th>
              </tr>
            </thead>
            <tbody>
              {history.map(({ move, outcomes, feedback }) => {
                const freshness = evaluateNextMoveFreshness({
                  validUntil: move.validUntil,
                  proposalStale: move.proposalStale,
                  now,
                });
                return (
                  <tr key={move.id}>
                    <td>
                      <strong>{move.action}</strong>
                      <br />
                      <small>{move.channel}</small>
                    </td>
                    <td>
                      {move.topic}
                      <br />
                      <small>{move.format}</small>
                    </td>
                    <td>
                      {move.createdAt.toUTCString()}
                      <br />
                      <small>valid to {move.validUntil.toUTCString()}</small>
                    </td>
                    <td>
                      <span className="dashboard-status" data-stale={freshness.state === "STALE"}>
                        {freshness.state}
                      </span>
                    </td>
                    <td>
                      {outcomes.length
                        ? outcomes.map((outcome) => outcome.kind.toLowerCase()).join(" · ")
                        : "No action reported"}
                      <br />
                      <small>
                        {feedback.length
                          ? feedback
                              .map((event) => event.kind.toLowerCase().replaceAll("_", " "))
                              .join(" · ")
                          : "No feedback"}
                      </small>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      ) : (
        <section className="dashboard-empty">
          <p className="kicker">No earlier moves</p>
          <h2>Your history starts here.</h2>
          <p>Ready, rejected, used, and skipped moves will appear after a claimed project runs.</p>
        </section>
      )}
    </>
  );
}
