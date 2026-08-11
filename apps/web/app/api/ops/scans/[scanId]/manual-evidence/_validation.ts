import { z } from "zod";

const MetricsSchema = z
  .object({
    views: z.number().int().nonnegative().safe().optional(),
    likes: z.number().int().nonnegative().safe().optional(),
    comments: z.number().int().nonnegative().safe().optional(),
    shares: z.number().int().nonnegative().safe().optional(),
    points: z.number().int().nonnegative().safe().optional(),
    stars: z.number().int().nonnegative().safe().optional(),
    forks: z.number().int().nonnegative().safe().optional(),
  })
  .strict();

export const ManualEvidenceBodySchema = z
  .object({
    url: z.url().max(2_048),
    sourceLabel: z.string().trim().min(1).max(100),
    title: z.string().trim().min(1).max(500),
    excerpt: z.string().trim().max(2_000).optional(),
    publishedAt: z.iso.datetime().optional(),
    visibleEngagement: MetricsSchema.optional(),
    reason: z.string().trim().min(10).max(1_000),
  })
  .strict();
