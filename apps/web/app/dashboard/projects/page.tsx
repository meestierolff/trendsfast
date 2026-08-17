import { DashboardEmpty } from "@/components/dashboard-empty";
import { DashboardProjectForm } from "@/components/dashboard-project-form";
import { DashboardProjectSwitcher } from "@/components/dashboard-project-switcher";
import { isMemberConfirmedProjectContext } from "@trendsfast/database";
import Link from "next/link";
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
          <p className="kicker">Website context unavailable</p>
          <h2>Read this product website.</h2>
          <p>
            This project has no saved context. Read only its public website and review the bounded
            draft before any broader research can run.
          </p>
          <Link
            className="button button-primary"
            href={`/dashboard/new?url=${encodeURIComponent(selected.project.url)}`}
          >
            Read website <span aria-hidden="true">→</span>
          </Link>
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
        confirmed={isMemberConfirmedProjectContext(parsed.record.createdBy)}
      />
    </>
  );
}
