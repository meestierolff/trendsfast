import type { MetadataRoute } from "next";
import { deploymentSurface } from "@trendsfast/config";
import { BLOG_POSTS } from "../lib/blog-posts";
import { absoluteUrl } from "../lib/site";

const UPDATED_AT = "2026-08-11T00:00:00.000Z";

const routes = [
  ["/", "daily", 1],
  ["/social-media-trend-api", "weekly", 0.9],
  ["/trend-detection-api", "weekly", 0.9],
  ["/content-distribution-api", "weekly", 0.9],
  ["/agents", "weekly", 0.9],
  ["/docs", "weekly", 0.85],
  ["/channels", "weekly", 0.8],
  ["/pricing", "weekly", 0.8],
  ["/sources", "daily", 0.8],
  ["/blog", "weekly", 0.75],
  ["/news", "weekly", 0.7],
  ["/open-source", "monthly", 0.7],
  ["/open", "weekly", 0.6],
  ["/privacy", "monthly", 0.4],
  ["/terms", "monthly", 0.4],
] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  if (deploymentSurface() === "ops") return [];
  return [
    ...routes.map(([path, changeFrequency, priority]) => ({
      url: absoluteUrl(path),
      lastModified: UPDATED_AT,
      changeFrequency,
      priority,
    })),
    ...BLOG_POSTS.map((post) => ({
      url: absoluteUrl(`/blog/${post.slug}`),
      lastModified: post.publishedAt,
      changeFrequency: "monthly" as const,
      priority: 0.7,
    })),
  ];
}
