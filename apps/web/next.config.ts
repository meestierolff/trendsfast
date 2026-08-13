import createMDX from "@next/mdx";
import type { NextConfig } from "next";

const isProduction = process.env.NODE_ENV === "production";
const isHttpsDeployment = process.env.APP_URL?.startsWith("https://") ?? false;
const distDir = process.env.NEXT_DIST_DIR?.trim() || ".next";

function configuredMediaOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.origin : null;
  } catch {
    // Relative media URLs are already covered by 'self'.
    return null;
  }
}

const externalMediaOrigins = [
  configuredMediaOrigin(process.env.NEXT_PUBLIC_DEMO_VIDEO_URL),
  configuredMediaOrigin(process.env.NEXT_PUBLIC_DEMO_CAPTIONS_URL),
].filter(
  (origin, index, values): origin is string => Boolean(origin) && values.indexOf(origin) === index,
);

const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProduction ? "" : " 'unsafe-eval'"} https://challenges.cloudflare.com`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  `media-src 'self'${externalMediaOrigins.map((origin) => ` ${origin}`).join("")}`,
  "font-src 'self'",
  `connect-src 'self' https://challenges.cloudflare.com${isProduction ? "" : " ws: wss:"}`,
  "frame-src https://challenges.cloudflare.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  ...(isHttpsDeployment ? ["upgrade-insecure-requests"] : []),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  { key: "Origin-Agent-Cluster", value: "?1" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
  ...(isHttpsDeployment
    ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }]
    : []),
];

const nextConfig: NextConfig = {
  distDir,
  pageExtensions: ["js", "jsx", "mdx", "ts", "tsx"],
  allowedDevOrigins: ["127.0.0.1"],
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: [
    "@trendsfast/analytics",
    "@trendsfast/billing",
    "@trendsfast/config",
    "@trendsfast/core",
    "@trendsfast/database",
    "@trendsfast/evidence",
    "@trendsfast/observability",
    "@trendsfast/orchestration",
    "@trendsfast/providers",
    "@trendsfast/schemas",
    "@trendsfast/scoring",
  ],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
      {
        source: "/scan/:path*",
        headers: [
          { key: "Cache-Control", value: "private, no-store, max-age=0" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
        ],
      },
      {
        source: "/billing/:path*",
        headers: [
          { key: "Cache-Control", value: "private, no-store, max-age=0" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
        ],
      },
    ];
  },
};

const withMDX = createMDX();

export default withMDX(nextConfig);
