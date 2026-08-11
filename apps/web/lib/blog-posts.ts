export const BLOG_POSTS = [
  {
    slug: "recent-is-not-the-same-as-trending",
    title: "Recent is not the same as trending",
    description:
      "A practical evidence grammar for separating a recent post, measured momentum, corroboration, and a genuinely useful content window.",
    publishedAt: "2026-08-11T08:00:00.000Z",
    readTime: "6 min read",
  },
  {
    slug: "why-a-trustworthy-trend-tool-sometimes-says-wait",
    title: "Why a trustworthy trend tool sometimes says WAIT",
    description:
      "Why insufficient evidence is a successful product outcome—and how a quality floor protects founder credibility.",
    publishedAt: "2026-08-11T08:05:00.000Z",
    readTime: "5 min read",
  },
  {
    slug: "product-url-to-one-relevant-content-move",
    title: "How AI agents can turn a product URL into one relevant content move",
    description:
      "A URL-first workflow for grounding content direction in product context, current evidence, and one bounded decision.",
    publishedAt: "2026-08-11T08:10:00.000Z",
    readTime: "7 min read",
  },
] as const;

export type BlogSlug = (typeof BLOG_POSTS)[number]["slug"];

export function getBlogPost(slug: string) {
  return BLOG_POSTS.find((post) => post.slug === slug);
}
