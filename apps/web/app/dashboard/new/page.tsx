import { DashboardNewProjectForm } from "@/components/dashboard-new-project-form";
import { requireDashboardSubject } from "@/lib/dashboard-service";

export const dynamic = "force-dynamic";

export default async function DashboardNewProjectPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireDashboardSubject("/dashboard/new");
  const query = await searchParams;
  const initialUrl = typeof query.url === "string" ? query.url.slice(0, 2_048) : "";

  return (
    <>
      <div className="dashboard-section-heading">
        <div>
          <p className="kicker">Website-first setup</p>
          <h2>Add product</h2>
        </div>
        <p>
          Active Founder and design-partner workspaces can read one bounded set of public website
          pages, then confirm the product context before research or generation.
        </p>
      </div>
      <DashboardNewProjectForm initialUrl={initialUrl} />
    </>
  );
}
