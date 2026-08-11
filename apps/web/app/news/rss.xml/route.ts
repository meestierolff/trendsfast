import { absoluteUrl } from "../../../lib/site";

export const dynamic = "force-static";

export function GET() {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>TrendsFast news</title>
  <link>${absoluteUrl("/news")}</link>
  <description>Verified TrendsFast releases and source additions.</description>
  <language>en</language>
</channel>
</rss>`;
  return new Response(xml, {
    headers: { "Content-Type": "application/rss+xml; charset=utf-8" },
  });
}
