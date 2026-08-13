import Link from "next/link";

export function DashboardEmpty() {
  return (
    <section className="dashboard-empty">
      <p className="kicker">No claimed project</p>
      <h2>Run your first scan.</h2>
      <p>
        Paste a public product URL, receive the private founder-reviewed result, then use “Save this
        scan” to claim it here. Authentication never blocks the first result.
      </p>
      <Link className="button button-primary" href="/#scan">
        Run a free scan <span aria-hidden="true">→</span>
      </Link>
    </section>
  );
}
