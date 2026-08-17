import Link from "next/link";

import { listDashboardProjects, requireDashboardSubject } from "@/lib/dashboard-service";

import "./dashboard.css";

export const dynamic = "force-dynamic";

const navigation = [
  ["/dashboard/today", "Today"],
  ["/dashboard/projects", "Projects"],
  ["/dashboard/history", "History"],
  ["/dashboard/agents", "Agents & API"],
  ["/dashboard/billing", "Billing"],
] as const;

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const authUserId = await requireDashboardSubject();
  const projects = await listDashboardProjects(authUserId);

  return (
    <div className="dashboard-shell">
      <header className="dashboard-header">
        <div>
          <p className="kicker">Founder workspace</p>
          <h1>{projects[0]?.project.name ?? "Your TrendsFast dashboard"}</h1>
        </div>
        <div className="dashboard-header-actions">
          <Link href="/dashboard/new">Add product</Link>
          <form action="/auth/logout" method="post">
            <button type="submit">Sign out</button>
          </form>
        </div>
      </header>
      <nav className="dashboard-nav" aria-label="Dashboard">
        {navigation.map(([href, label]) => (
          <Link key={href} href={href}>
            {label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
