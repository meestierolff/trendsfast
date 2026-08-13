import { redirect } from "next/navigation";

import { DashboardEmpty } from "@/components/dashboard-empty";
import { requireDashboardSubject, resolveDashboardProject } from "@/lib/dashboard-service";

export default async function DashboardPage() {
  const authUserId = await requireDashboardSubject();
  const { selected } = await resolveDashboardProject({ authUserId });
  if (selected) redirect(`/dashboard/today?project=${encodeURIComponent(selected.project.id)}`);
  return <DashboardEmpty />;
}
