import type { Metadata } from "next";
import Link from "next/link";
import { pageMetadata } from "../../lib/site";

export const metadata: Metadata = pageMetadata({
  title: "News",
  description:
    "Verified TrendsFast releases and source additions. No configured adapter or planned feature is published here as shipped news.",
  path: "/news",
});

export default function NewsPage() {
  return (
    <>
      <section className="intent-hero section-pad">
        <p className="section-index">NEWS / VERIFIED CHANGES ONLY</p>
        <h1>Release news without launch theater.</h1>
        <p>
          This ledger will contain verified releases and dated source additions only. Plans,
          configured adapters, and local examples do not qualify.
        </p>
      </section>
      <section className="empty-news section-pad">
        <span aria-hidden="true">◇</span>
        <h2>No verified public release has been published yet.</h2>
        <p>
          The first entry appears only after remote CI, deployment, launch-minimum source
          read-backs, and a real dogfood scan all pass.
        </p>
        <div className="inline-actions">
          <Link className="button button-primary" href="/sources">
            Inspect source truth <span aria-hidden="true">→</span>
          </Link>
          <Link className="button button-secondary" href="/blog">
            Read the blog
          </Link>
        </div>
      </section>
    </>
  );
}
