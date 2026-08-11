import Link from "next/link";

export default function OpsScanNotFound() {
  return (
    <section className="ops-shell ops-not-found section-pad">
      <p className="ops-kicker">PRIVATE / RECORD NOT FOUND</p>
      <h1>This scan review record is not available.</h1>
      <p>The identifier is unknown, or the persisted request has been removed.</p>
      <Link href="/ops">Return to the review queue →</Link>
    </section>
  );
}
