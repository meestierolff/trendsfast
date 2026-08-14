import type { Metadata } from "next";

export const SITE_NAME = "TrendsFast";
export const SITE_GITHUB_URL = "https://github.com/meestierolff/trendsfast";
export const DEFAULT_TITLE = "TrendsFast — Social Media Trend API for AI Agents";
export const DEFAULT_DESCRIPTION =
  "Spot relevant social media and search trends, then turn them into evidence-backed content ideas, hooks, formats, and channels for ChatGPT, Claude, Codex, Cursor, OpenClaw, and other AI agents.";

type SiteEnvironment = Readonly<Record<string, string | undefined>>;

function vercelProjectProductionOrigin(environment: SiteEnvironment): string {
  const hostname = environment.VERCEL_PROJECT_PRODUCTION_URL?.trim().toLowerCase();
  const labels = hostname?.split(".") ?? [];
  const validHostname =
    Boolean(hostname) &&
    hostname!.length <= 253 &&
    labels.length >= 2 &&
    labels.every(
      (label) => label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
    ) &&
    /[a-z]/.test(labels.at(-1)!);

  if (environment.VERCEL !== "1" || !validHostname) {
    throw new Error(
      "APP_URL is required for hosted builds unless VERCEL_PROJECT_PRODUCTION_URL is a valid Vercel hostname",
    );
  }

  return `https://${hostname}`;
}

export function siteOrigin(environment: SiteEnvironment = process.env): string {
  const configuredOrigin = environment.APP_URL?.trim();
  const isHostedBuild = Boolean(environment.VERCEL_ENV?.trim());

  if (!configuredOrigin) {
    if (isHostedBuild) {
      return vercelProjectProductionOrigin(environment);
    }
    return "http://localhost:3000";
  }

  let parsed: URL;
  try {
    parsed = new URL(configuredOrigin);
  } catch {
    throw new Error("APP_URL must be an absolute HTTP(S) origin");
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error("APP_URL must be an absolute HTTP(S) origin without credentials or a path");
  }
  if (isHostedBuild && parsed.protocol !== "https:") {
    throw new Error("APP_URL must use HTTPS for hosted builds");
  }
  return parsed.origin;
}

export function absoluteUrl(path = "/"): string {
  return new URL(path, `${siteOrigin()}/`).toString();
}

export function pageMetadata({
  title,
  description,
  path,
}: {
  title: string;
  description: string;
  path: string;
}): Metadata {
  const canonical = absoluteUrl(path);
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      title,
      description,
      type: "website",
      siteName: SITE_NAME,
      url: canonical,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}
