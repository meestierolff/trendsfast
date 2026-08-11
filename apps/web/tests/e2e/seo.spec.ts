import { expect, test } from "@playwright/test";

test("home metadata and structured data match the public proposition", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle("TrendsFast — Social Media Trend API for AI Agents");
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    "content",
    "Spot relevant social media and search trends, then turn them into evidence-backed content ideas, hooks, formats, and channels for ChatGPT, Claude, Codex, Cursor, OpenClaw, and other AI agents.",
  );
  const canonical = await page.locator('link[rel="canonical"]').getAttribute("href");
  expect(canonical).not.toBeNull();
  expect(new URL(canonical!).pathname).toBe("/");

  const jsonLd = await page.locator('script[type="application/ld+json"]').allTextContents();
  const combined = jsonLd.join("\n");
  expect(combined).toContain('"Organization"');
  expect(combined).toContain('"SoftwareApplication"');
  expect(combined).toContain('"FAQPage"');
  expect(combined).not.toContain("AggregateRating");
  expect(combined).not.toContain('"Review"');
});

test("high-intent pages declare self canonicals", async ({ page }) => {
  for (const path of [
    "/social-media-trend-api",
    "/trend-detection-api",
    "/content-distribution-api",
    "/agents",
  ]) {
    await page.goto(path);
    await expect(page.locator('link[rel="canonical"]'), path).toHaveAttribute(
      "href",
      new RegExp(`${path.replaceAll("/", "\\/")}$`),
    );
  }
});

test("machine-readable discovery surfaces are valid and public", async ({ request }) => {
  const robots = await request.get("/robots.txt");
  expect(robots.status()).toBe(200);
  expect(robots.headers()["content-type"]).toContain("text/plain");
  expect(await robots.text()).toContain("Sitemap:");

  const sitemap = await request.get("/sitemap.xml");
  expect(sitemap.status()).toBe(200);
  expect(sitemap.headers()["content-type"]).toContain("application/xml");
  const sitemapBody = await sitemap.text();
  expect(sitemapBody).toContain("/social-media-trend-api");
  expect(sitemapBody).not.toContain("/scan/");
  expect(sitemapBody).not.toContain("/ops");

  const llms = await request.get("/llms.txt");
  expect(llms.status()).toBe(200);
  expect(llms.headers()["content-type"]).toContain("text/plain");
  expect(await llms.text()).toContain("TrendsFast");

  for (const path of ["/blog/rss.xml", "/news/rss.xml"]) {
    const feed = await request.get(path);
    expect(feed.status(), path).toBe(200);
    expect(feed.headers()["content-type"], path).toContain("application/rss+xml");
    expect(await feed.text(), path).toContain("<rss");
  }
});

test("code-native social and app images render", async ({ request }) => {
  for (const path of ["/opengraph-image", "/twitter-image", "/icon"]) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
    expect(response.headers()["content-type"], path).toContain("image/png");
  }
});
