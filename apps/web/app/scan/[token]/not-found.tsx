import Link from "next/link";

export default function ScanResultNotFound() {
  return (
    <section className="scan-delivery scan-not-found" aria-labelledby="scan-result-not-found-title">
      <p className="scan-mono-label">Private result · link unavailable</p>
      <h1 id="scan-result-not-found-title">This private result is not available.</h1>
      <p>
        The link may be incomplete, expired, revoked, or not ready yet. No example recommendation is
        shown in place of a real delivered result.
      </p>
      <Link href="/#scan">
        Run a new scan <span aria-hidden="true">→</span>
      </Link>
    </section>
  );
}
