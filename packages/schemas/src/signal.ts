import { z } from "zod";

import {
  IdentifierSchema,
  IsoDateTimeSchema,
  LongTextSchema,
  PublicHttpUrlSchema,
  ShortTextSchema,
} from "./common";
import { SourceSlugSchema } from "./enums";

const MetricValueSchema = z.number().int().nonnegative().safe();

export const SignalMetricsSchema = z
  .object({
    views: MetricValueSchema.optional(),
    likes: MetricValueSchema.optional(),
    comments: MetricValueSchema.optional(),
    shares: MetricValueSchema.optional(),
    points: MetricValueSchema.optional(),
    stars: MetricValueSchema.optional(),
    forks: MetricValueSchema.optional(),
  })
  .strict();
export type SignalMetrics = z.infer<typeof SignalMetricsSchema>;

export const SignalAuthorSchema = z
  .object({
    id: IdentifierSchema.optional(),
    handle: z.string().trim().min(1).max(200).optional(),
    displayName: z.string().trim().min(1).max(300).optional(),
    followerCount: MetricValueSchema.optional(),
  })
  .strict();
export type SignalAuthor = z.infer<typeof SignalAuthorSchema>;

export const SignalProvenanceSchema = z
  .object({
    provider: IdentifierSchema,
    requestId: IdentifierSchema.optional(),
    retrievedAt: IsoDateTimeSchema,
    cached: z.boolean(),
    rawPayloadHash: z.string().trim().min(8).max(200).optional(),
  })
  .strict();
export type SignalProvenance = z.infer<typeof SignalProvenanceSchema>;

/**
 * The provider-neutral evidence object. It intentionally has no velocity field:
 * velocity is a derived claim that requires time-separated snapshots.
 */
export const SignalSchema = z
  .object({
    id: IdentifierSchema,
    source: SourceSlugSchema,
    sourceId: IdentifierSchema,
    url: PublicHttpUrlSchema,
    title: ShortTextSchema.optional(),
    textExcerpt: LongTextSchema.optional(),
    author: SignalAuthorSchema.optional(),
    publishedAt: IsoDateTimeSchema.optional(),
    observedAt: IsoDateTimeSchema,
    language: z.string().trim().min(2).max(35).optional(),
    metrics: SignalMetricsSchema,
    queryId: IdentifierSchema,
    provenance: SignalProvenanceSchema,
  })
  .strict();
export type Signal = z.infer<typeof SignalSchema>;

export const SignalMetricSnapshotSchema = z
  .object({
    signalId: IdentifierSchema,
    observedAt: IsoDateTimeSchema,
    metrics: SignalMetricsSchema,
  })
  .strict();
export type SignalMetricSnapshot = z.infer<typeof SignalMetricSnapshotSchema>;
