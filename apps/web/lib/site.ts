import type { Metadata } from "next";

export const SITE_NAME = "TrendsFast";
export const SITE_GITHUB_URL = "https://github.com/meestierolff/trendsfast";
export const DEFAULT_TITLE = "TrendsFast — Social Media Trend API for AI Agents";
export const DEFAULT_DESCRIPTION =
  "Spot relevant social media and search trends, then turn them into evidence-backed content ideas, hooks, formats, and channels for ChatGPT, Claude, Codex, Cursor, OpenClaw, and other AI agents.";

export function siteOrigin(): string {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
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
