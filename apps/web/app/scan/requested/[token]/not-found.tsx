import Link from "next/link";

export default function RequestedScanNotFound() {
  return (
    <section className="scan-delivery scan-not-found" aria-labelledby="scan-not-found-title">
      <p className="scan-mono-label">Private scan · link unavailable</p>
      <h1 id="scan-not-found-title">This private scan link is not available.</h1>
      <p>
        It may be incomplete, expired, or mistyped. TrendsFast does not substitute fixture data for
        an unknown token.
      </p>
      <Link href="/#scan">
        Run a new scan <span aria-hidden="true">→</span>
      </Link>
    </section>
  );
}
