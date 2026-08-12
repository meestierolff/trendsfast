import { z } from "zod";

import {
  ConfidenceSchema,
  IdentifierSchema,
  IsoDateTimeSchema,
  LongTextSchema,
  PrioritySchema,
  PublicHttpUrlSchema,
  ShortTextSchema,
  StringListSchema,
} from "./common";
import {
  NextMoveActionSchema,
  ScanStateSchema,
  SignalClassSchema,
  SourceSlugSchema,
} from "./enums";

export const NextMoveSchema = z
  .object({
    action: NextMoveActionSchema,
    channel: z.string().trim().min(1).max(100),
    topic: ShortTextSchema,
    angle: LongTextSchema,
    format: z.string().trim().min(1).max(100),
    hook: LongTextSchema,
    outline: z.array(z.string().trim().min(1).max(1_000)).min(1).max(12),
    cta: LongTextSchema,
    priority: PrioritySchema,
    confidence: ConfidenceSchema,
    validUntil: IsoDateTimeSchema,
  })
  .strict();
export type NextMove = z.infer<typeof NextMoveSchema>;

export const WhyNowSchema = z
  .object({
    summary: LongTextSchema,
    signalClass: SignalClassSchema,
    independentSourceCount: z.number().int().nonnegative().max(20),
    saturation: z.enum(["low", "low_to_medium", "medium", "high", "unknown"]),
  })
  .strict();
export type WhyNow = z.infer<typeof WhyNowSchema>;

export const EvidenceReceiptSchema = z
  .object({
    source: SourceSlugSchema,
    url: PublicHttpUrlSchema,
    title: ShortTextSchema.optional(),
    publishedAt: IsoDateTimeSchema.optional(),
    observedAt: IsoDateTimeSchema,
    reason: LongTextSchema,
    provider: IdentifierSchema,
    role: z.enum(["DECISION_SUPPORT", "SUPPLEMENTAL"]).default("DECISION_SUPPORT"),
    verified: z.boolean(),
    availability: z
      .enum(["AVAILABLE", "SOURCE_NO_LONGER_AVAILABLE", "REJECTED"])
      .default("AVAILABLE"),
  })
  .strict();
export type EvidenceReceipt = z.infer<typeof EvidenceReceiptSchema>;

export const NextMoveRequestSchema = z
  .object({
    product_url: PublicHttpUrlSchema,
    goal: z.string().trim().min(1).max(100).optional(),
    market: z.string().trim().min(2).max(50).optional(),
    language: z.string().trim().min(2).max(35).optional(),
    preferred_channels: StringListSchema.optional(),
    available_formats: StringListSchema.optional(),
  })
  .strict();
export type NextMoveRequest = z.infer<typeof NextMoveRequestSchema>;

export const IdempotencyKeySchema = z.string().uuid();

export const NextMoveAcceptedResponseSchema = z
  .object({
    id: IdentifierSchema,
    status: z.enum(["QUEUED", "RUNNING", "REVIEW_REQUIRED"]),
    status_url: z.string().trim().min(1).max(2_048),
    poll_after_seconds: z.literal(30),
  })
  .strict();
export type NextMoveAcceptedResponse = z.infer<typeof NextMoveAcceptedResponseSchema>;

export const NextMoveFailedResponseSchema = z
  .object({
    id: IdentifierSchema,
    status: z.literal("FAILED"),
    error: z
      .object({
        code: z.string().trim().min(1).max(100),
        message: z.string().trim().min(1).max(500),
        retryable: z.boolean(),
      })
      .strict(),
  })
  .strict();
export type NextMoveFailedResponse = z.infer<typeof NextMoveFailedResponseSchema>;

const ApiProjectSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    url: PublicHttpUrlSchema,
    audience: LongTextSchema,
    problem: LongTextSchema,
    credible_topics: StringListSchema,
    assumptions: StringListSchema,
  })
  .strict();

const ApiNextMoveSchema = z
  .object({
    action: NextMoveActionSchema,
    channel: z.string().trim().min(1).max(100),
    topic: ShortTextSchema,
    angle: LongTextSchema,
    format: z.string().trim().min(1).max(100),
    hook: LongTextSchema,
    outline: z.array(z.string().trim().min(1).max(1_000)).min(1).max(12),
    cta: LongTextSchema.optional(),
    priority: PrioritySchema,
    confidence: ConfidenceSchema,
    valid_until: IsoDateTimeSchema,
  })
  .strict();

const ApiWhyNowSchema = z
  .object({
    summary: LongTextSchema,
    signal_class: SignalClassSchema,
    independent_source_count: z.number().int().nonnegative().max(20),
    saturation: z.enum(["low", "low_to_medium", "medium", "high", "unknown"]),
  })
  .strict();

const ApiEvidenceSchema = z
  .object({
    source: SourceSlugSchema,
    url: PublicHttpUrlSchema,
    title: ShortTextSchema.optional(),
    published_at: IsoDateTimeSchema.optional(),
    observed_at: IsoDateTimeSchema,
    reason: LongTextSchema,
    provider: IdentifierSchema,
    role: z.enum(["DECISION_SUPPORT", "SUPPLEMENTAL"]),
    verified: z.boolean(),
    availability: z.enum(["AVAILABLE", "SOURCE_NO_LONGER_AVAILABLE", "REJECTED"]).optional(),
  })
  .strict();

export const NextMoveReadyResponseSchema = z
  .object({
    id: IdentifierSchema,
    status: z.literal("READY"),
    project: ApiProjectSchema,
    next_move: ApiNextMoveSchema,
    why_now: ApiWhyNowSchema,
    evidence: z.array(ApiEvidenceSchema).max(50),
    limitations: StringListSchema,
    founder_reviewed: z.literal(true),
    auto_publish: z.literal(false),
  })
  .strict();
export type NextMoveReadyResponse = z.infer<typeof NextMoveReadyResponseSchema>;

export const NextMoveStatusResponseSchema = z.union([
  NextMoveAcceptedResponseSchema,
  NextMoveReadyResponseSchema,
  NextMoveFailedResponseSchema,
]);
export type NextMoveStatusResponse = z.infer<typeof NextMoveStatusResponseSchema>;

export const NextMoveApiRequestSchema = NextMoveRequestSchema;
export const NextMoveResponseSchema = NextMoveStatusResponseSchema;
export type NextMoveApiRequest = NextMoveRequest;
export type NextMoveResponse = NextMoveStatusResponse;

export const ApiErrorSchema = z
  .object({
    error: z
      .object({
        code: z.string().trim().min(1).max(100),
        message: z.string().trim().min(1).max(500),
        request_id: IdentifierSchema.optional(),
      })
      .strict(),
  })
  .strict();
export type ApiError = z.infer<typeof ApiErrorSchema>;

/** A useful assertion for exhaustive handlers importing only this package. */
export const isTerminalScanState = (state: z.infer<typeof ScanStateSchema>) =>
  state === "READY" || state === "FAILED";
