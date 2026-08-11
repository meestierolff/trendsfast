import { BLOG_POSTS } from "../../../lib/blog-posts";
import { absoluteUrl } from "../../../lib/site";

export const dynamic = "force-static";

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function GET() {
  const items = BLOG_POSTS.map(
    (post) => `<item>
  <title>${escapeXml(post.title)}</title>
  <link>${escapeXml(absoluteUrl(`/blog/${post.slug}`))}</link>
  <guid isPermaLink="true">${escapeXml(absoluteUrl(`/blog/${post.slug}`))}</guid>
  <pubDate>${new Date(post.publishedAt).toUTCString()}</pubDate>
  <description>${escapeXml(post.description)}</description>
</item>`,
  ).join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>TrendsFast blog</title>
  <link>${escapeXml(absoluteUrl("/blog"))}</link>
  <description>Evidence-backed trend and content distribution notes for founders and AI agents.</description>
  <language>en</language>
  ${items}
</channel>
</rss>`;
  return new Response(xml, {
    headers: { "Content-Type": "application/rss+xml; charset=utf-8" },
  });
}
