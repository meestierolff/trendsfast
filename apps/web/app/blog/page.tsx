import type { Metadata } from "next";
import Link from "next/link";
import { BLOG_POSTS } from "../../lib/blog-posts";
import { pageMetadata } from "../../lib/site";

export const metadata: Metadata = pageMetadata({
  title: "Blog",
  description:
    "Practical notes on trend evidence, honest WAIT decisions, AI-agent workflows, and product-specific content distribution.",
  path: "/blog",
});

export default function BlogPage() {
  return (
    <>
      <section className="intent-hero section-pad">
        <p className="section-index">BLOG / DECISION NOTES</p>
        <h1>How to make trend intelligence useful.</h1>
        <p>
          Product thinking and practical evidence rules for founders building distribution workflows
          with AI agents.
        </p>
      </section>
      <section className="content-index section-pad">
        {BLOG_POSTS.map((post, index) => (
          <article key={post.slug}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <div>
              <p>
                <time dateTime={post.publishedAt}>11 August 2026</time> · {post.readTime}
              </p>
              <h2>
                <Link href={`/blog/${post.slug}`}>{post.title}</Link>
              </h2>
              <p>{post.description}</p>
              <Link className="text-link" href={`/blog/${post.slug}`}>
                Read article <span aria-hidden="true">→</span>
              </Link>
            </div>
          </article>
        ))}
      </section>
    </>
  );
}
