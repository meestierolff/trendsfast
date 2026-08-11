const REQUIRED_PUBLIC_ROUTES = [
  { path: "/", contentType: "text/html" },
  { path: "/agents", contentType: "text/html" },
  { path: "/api/sources", contentType: "application/json" },
  { path: "/blog", contentType: "text/html" },
  { path: "/blog/product-url-to-one-relevant-content-move", contentType: "text/html" },
  { path: "/blog/recent-is-not-the-same-as-trending", contentType: "text/html" },
  {
    path: "/blog/why-a-trustworthy-trend-tool-sometimes-says-wait",
    contentType: "text/html",
  },
  { path: "/blog/rss.xml", contentType: "application/rss+xml" },
  { path: "/channels", contentType: "text/html" },
  { path: "/content-distribution-api", contentType: "text/html" },
  { path: "/docs", contentType: "text/html" },
  { path: "/llms.txt", contentType: "text/plain" },
  { path: "/news", contentType: "text/html" },
  { path: "/news/rss.xml", contentType: "application/rss+xml" },
  { path: "/open", contentType: "text/html" },
  { path: "/open-source", contentType: "text/html" },
  { path: "/ops", contentType: "text/html" },
  { path: "/pricing", contentType: "text/html" },
  { path: "/privacy", contentType: "text/html" },
  { path: "/robots.txt", contentType: "text/plain" },
  { path: "/sitemap.xml", contentType: "application/xml" },
  { path: "/social-media-trend-api", contentType: "text/html" },
  { path: "/sources", contentType: "text/html" },
  { path: "/terms", contentType: "text/html" },
  { path: "/trend-detection-api", contentType: "text/html" },
  { path: "/v1/openapi.json", contentType: "application/json" },
] as const;

const UNKNOWN_SCAN_TOKEN = `scan_${"A".repeat(43)}`;

function deploymentOrigin() {
  const raw = process.argv[2] ?? process.env.DEPLOYMENT_URL;
  if (!raw) throw new Error("Pass a deployment URL or set DEPLOYMENT_URL.");
  const url = new URL(raw);
  if (url.protocol !== "https:" && process.env.ALLOW_HTTP_DEPLOYMENT_VERIFY !== "1") {
    throw new Error("Deployment verification requires HTTPS unless explicitly testing localhost.");
  }
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url;
}

async function inspect(
  origin: URL,
  path: string,
  expectedStatus = 200,
  expectedContentType?: string,
) {
  const response = await fetch(new URL(path, origin), {
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
    headers: { "user-agent": "TrendsFast deployment verifier/1.0" },
  });
  const contentType = response.headers.get("content-type") ?? "";
  const body = await response.text();
  const isRedirect = response.status >= 300 && response.status < 400;
  const statusOk = response.status === expectedStatus;
  const contentTypeOk = !expectedContentType || contentType.includes(expectedContentType);
  const noSecretMarker = !/(tf_(?:live|test)_[A-Za-z0-9_-]+\.|sk_(?:live|test)_)/.test(body);
  return {
    path,
    status: response.status,
    statusOk,
    redirectLocation: isRedirect ? response.headers.get("location") : null,
    contentType,
    contentTypeOk,
    cacheControl: response.headers.get("cache-control"),
    robotsHeader: response.headers.get("x-robots-tag"),
    security: {
      contentSecurityPolicy: Boolean(response.headers.get("content-security-policy")),
      noSniff: response.headers.get("x-content-type-options") === "nosniff",
      frameDenied:
        response.headers.get("x-frame-options") === "DENY" ||
        response.headers.get("content-security-policy")?.includes("frame-ancestors 'none'") ===
          true,
      referrerPolicy: response.headers.get("referrer-policy"),
      hsts:
        origin.protocol !== "https:" || Boolean(response.headers.get("strict-transport-security")),
    },
    noSecretMarker,
  };
}

async function main() {
  const origin = deploymentOrigin();
  const canonicalHost = process.env.CANONICAL_HOST?.trim().toLowerCase();
  const results = [];
  for (const route of REQUIRED_PUBLIC_ROUTES) {
    results.push(await inspect(origin, route.path, 200, route.contentType));
  }
  const privateResults = [
    await inspect(origin, `/scan/${UNKNOWN_SCAN_TOKEN}`, 404),
    await inspect(origin, `/api/scans/${UNKNOWN_SCAN_TOKEN}/status`, 404),
  ];
  const canonicalOk = !canonicalHost || origin.hostname.toLowerCase() === canonicalHost;
  const ok =
    canonicalOk &&
    results.every(
      (result) =>
        result.statusOk &&
        result.contentTypeOk &&
        result.noSecretMarker &&
        result.security.contentSecurityPolicy &&
        result.security.noSniff &&
        result.security.frameDenied &&
        result.security.hsts,
    ) &&
    privateResults.every(
      (result) =>
        result.statusOk &&
        result.noSecretMarker &&
        result.cacheControl?.includes("no-store") === true &&
        (result.path.startsWith("/api/") || result.robotsHeader?.includes("noindex") === true),
    );
  console.info(
    JSON.stringify(
      {
        ok,
        origin: origin.origin,
        canonicalHost: canonicalHost ?? null,
        canonicalOk,
        checkedAt: new Date().toISOString(),
        routes: results,
        privateCapabilityProbes: privateResults,
      },
      null,
      2,
    ),
  );
  if (!ok) process.exitCode = 1;
}

await main();

export {};
