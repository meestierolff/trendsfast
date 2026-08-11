import { z, type ZodType } from "zod";

import type { ProviderRunRequest } from "./types";

const ProviderSlugSchema = z.enum([
  "website",
  "google_trends",
  "hacker_news",
  "github",
  "x",
  "tavily",
  "youtube",
  "manual",
]);

const ProviderQueryRoleSchema = z.enum([
  "product_context",
  "search_demand",
  "related_rising_query",
  "developer_pain",
  "launch_narrative",
  "repository_adoption",
  "issue_pain",
  "release_activity",
  "current_narrative",
  "reply_opportunity",
  "news_trigger",
  "independent_verification",
  "video_traction",
  "content_format",
  "manual_evidence",
]);

export const ProviderRunRequestSchema = z
  .object({
    scanId: z.string().min(1).max(200),
    productUrl: z.url().optional(),
    queries: z
      .array(
        z.object({
          id: z.string().min(1).max(200),
          provider: ProviderSlugSchema,
          role: ProviderQueryRoleSchema,
          query: z.string().min(1).max(180),
          limit: z.number().int().min(1).max(30),
          lookbackHours: z
            .number()
            .int()
            .positive()
            .max(24 * 365 * 5)
            .optional(),
          market: z.string().min(1).max(16).optional(),
          language: z.string().min(1).max(16).optional(),
        }),
      )
      .max(20),
    manualEvidence: z
      .array(
        z.object({
          url: z.url(),
          sourceLabel: z.string().min(1).max(100),
          title: z.string().min(1).max(500),
          excerpt: z.string().max(2_000).optional(),
          publishedAt: z.iso.datetime().optional(),
          visibleEngagement: z
            .object({
              views: z.number().nonnegative().optional(),
              likes: z.number().nonnegative().optional(),
              comments: z.number().nonnegative().optional(),
              shares: z.number().nonnegative().optional(),
              points: z.number().nonnegative().optional(),
              stars: z.number().nonnegative().optional(),
              forks: z.number().nonnegative().optional(),
            })
            .optional(),
          reason: z.string().min(1).max(1_000),
          reviewedBy: z.string().min(1).max(200),
        }),
      )
      .max(20)
      .optional(),
    market: z.string().min(1).max(16).optional(),
    language: z.string().min(1).max(16).optional(),
  })
  .strict() as unknown as ZodType<ProviderRunRequest>;
