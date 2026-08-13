import { DashboardApiKeyManager } from "@/components/dashboard-api-key-manager";
import { DashboardEmpty } from "@/components/dashboard-empty";
import { DashboardProjectSwitcher } from "@/components/dashboard-project-switcher";
import { requireDashboardSubject, resolveDashboardProject } from "@/lib/dashboard-service";
import { getMemberRepositories } from "@/lib/server-database";
import { siteOrigin } from "@/lib/site";

export const dynamic = "force-dynamic";

export default async function DashboardAgentsPage({
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
  const keys = await getMemberRepositories().members.listProjectApiKeys({
    authUserId,
    projectId: selected.project.id,
  });

  return (
    <>
      <DashboardProjectSwitcher
        projects={projects}
        selectedProjectId={selected.project.id}
        path="/dashboard/agents"
      />
      <div className="dashboard-section-heading">
        <div>
          <p className="kicker">Agents & API</p>
          <h2>Project-scoped access</h2>
        </div>
        <p>
          Raw secrets are shown once. Keys can request or read moves for this project only and never
          grant publishing access.
        </p>
      </div>
      <DashboardApiKeyManager
        projectId={selected.project.id}
        projectName={selected.project.name ?? new URL(selected.project.url).hostname}
        appUrl={siteOrigin()}
        keys={keys.map((key) => ({
          ...key,
          createdAt: key.createdAt.toISOString(),
          lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
          expiresAt: key.expiresAt?.toISOString() ?? null,
          revokedAt: key.revokedAt?.toISOString() ?? null,
        }))}
      />
    </>
  );
}
