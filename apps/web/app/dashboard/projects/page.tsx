import { DashboardEmpty } from "@/components/dashboard-empty";
import { DashboardProjectForm } from "@/components/dashboard-project-form";
import { DashboardProjectSwitcher } from "@/components/dashboard-project-switcher";
import { DashboardRefreshControl } from "@/components/dashboard-refresh-control";
import {
  getDashboardProject,
  parseDashboardContext,
  requireDashboardSubject,
  resolveDashboardProject,
} from "@/lib/dashboard-service";

export const dynamic = "force-dynamic";

export default async function DashboardProjectsPage({
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
  const parsed = dashboard ? parseDashboardContext(dashboard) : null;
  if (!dashboard || !parsed) {
    return (
      <>
        <DashboardProjectSwitcher
          projects={projects}
          selectedProjectId={selected.project.id}
          path="/dashboard/projects"
        />
        <section className="dashboard-empty">
          <p className="kicker">Context unavailable</p>
          <h2>Re-read this product.</h2>
          <p>
            This project has no current context. Request a founder-plan refresh to read the saved
            product URL, infer a new profile, and create a new reviewable move.
          </p>
          <DashboardRefreshControl projectId={selected.project.id} label="Re-read product" />
        </section>
      </>
    );
  }

  return (
    <>
      <DashboardProjectSwitcher
        projects={projects}
        selectedProjectId={selected.project.id}
        path="/dashboard/projects"
      />
      <div className="dashboard-section-heading">
        <div>
          <p className="kicker">Project truth</p>
          <h2>Projects</h2>
        </div>
        <p>Confirm the inferred context in one place. Corrections create a new context version.</p>
      </div>
      <DashboardProjectForm
        projectId={selected.project.id}
        projectUrl={selected.project.url}
        context={parsed.context}
        entityType={parsed.record.entityType}
        provenance={parsed.record.contextProvenance}
        voiceProfile={parsed.record.voiceProfile}
        contentCapabilities={parsed.record.contentCapabilities}
      />
    </>
  );
}
