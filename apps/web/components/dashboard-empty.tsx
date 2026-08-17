import Link from "next/link";

export function DashboardEmpty() {
  return (
    <section className="dashboard-empty">
      <p className="kicker">No saved project</p>
      <h2>Add your first product.</h2>
      <p>
        Approved Founder and design-partner workspaces start with a claimed product, then can add a
        bounded public website context before any broader research runs.
      </p>
      <Link className="button button-primary" href="/dashboard/new">
        Add a product <span aria-hidden="true">→</span>
      </Link>
    </section>
  );
}
