import type { Metadata } from "next";
import type { ComponentType } from "react";
import { notFound } from "next/navigation";
import { JsonLd } from "../../../components/json-ld";
import { BLOG_POSTS, getBlogPost, type BlogSlug } from "../../../lib/blog-posts";
import { absoluteUrl, pageMetadata } from "../../../lib/site";

const loaders: Record<BlogSlug, () => Promise<{ default: ComponentType }>> = {
  "recent-is-not-the-same-as-trending": () =>
    import("../../../content/blog/recent-is-not-the-same-as-trending.mdx"),
  "why-a-trustworthy-trend-tool-sometimes-says-wait": () =>
    import("../../../content/blog/why-a-trustworthy-trend-tool-sometimes-says-wait.mdx"),
  "product-url-to-one-relevant-content-move": () =>
    import("../../../content/blog/product-url-to-one-relevant-content-move.mdx"),
};

export const dynamicParams = false;

export function generateStaticParams() {
  return BLOG_POSTS.map(({ slug }) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = getBlogPost(slug);
  if (!post) return {};
  return pageMetadata({
    title: post.title,
    description: post.description,
    path: `/blog/${post.slug}`,
  });
}

export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = getBlogPost(slug);
  if (!post) notFound();
  const loader = loaders[post.slug];
  const { default: Article } = await loader();
  const schema = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.description,
    datePublished: post.publishedAt,
    dateModified: post.publishedAt,
    mainEntityOfPage: absoluteUrl(`/blog/${post.slug}`),
    author: { "@type": "Organization", name: "TrendsFast" },
    publisher: { "@type": "Organization", name: "TrendsFast" },
  };
  return (
    <>
      <JsonLd value={schema} />
      <article className="article-page section-pad">
        <header>
          <p className="section-index">TRENDSFAST BLOG</p>
          <h1>{post.title}</h1>
          <p>{post.description}</p>
          <span>
            <time dateTime={post.publishedAt}>11 August 2026</time> · {post.readTime}
          </span>
        </header>
        <div className="article-body prose">
          <Article />
        </div>
      </article>
    </>
  );
}
