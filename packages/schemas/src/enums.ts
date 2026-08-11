import { z } from "zod";

export const SourceSlugSchema = z.enum([
  "website",
  "x",
  "google_trends",
  "dataforseo_trends",
  "hacker_news",
  "github",
  "tavily",
  "youtube",
  "manual",
  "reddit",
]);
export type SourceSlug = z.infer<typeof SourceSlugSchema>;

export const SourceStatusSchema = z.enum([
  "LIVE",
  "BETA",
  "LEGAL_REVIEW",
  "PLANNED",
  "DEGRADED",
  "DISABLED",
]);
export type SourceStatus = z.infer<typeof SourceStatusSchema>;

export const SignalClassSchema = z.enum([
  "MEASURED_EXTERNAL_SERIES",
  "MEASURED_INTERNAL_VELOCITY",
  "CORROBORATED_SIGNAL",
  "EMERGING_SIGNAL",
  "INSUFFICIENT_SIGNAL",
]);
export type SignalClass = z.infer<typeof SignalClassSchema>;

export const NextMoveActionSchema = z.enum(["PUBLISH", "REPLY", "REMIX", "WAIT"]);
export type NextMoveAction = z.infer<typeof NextMoveActionSchema>;

/** Public API states. Internal execution details must not leak through the API. */
export const ScanStateSchema = z.enum(["QUEUED", "RUNNING", "REVIEW_REQUIRED", "READY", "FAILED"]);
export type ScanState = z.infer<typeof ScanStateSchema>;

export const SourceRunStateSchema = z.enum([
  "PENDING",
  "RUNNING",
  "SUCCEEDED",
  "DEGRADED",
  "FAILED",
  "SKIPPED",
]);
export type SourceRunState = z.infer<typeof SourceRunStateSchema>;

export const ReviewActionSchema = z.enum([
  "CONTEXT_EDITED",
  "QUERY_PLAN_EDITED",
  "EVIDENCE_REJECTED",
  "MANUAL_EVIDENCE_ADDED",
  "SOURCE_RERUN_REQUESTED",
  "SYNTHESIS_RERUN_REQUESTED",
  "APPROVED",
  "EDITED_AND_APPROVED",
  "CONVERTED_TO_WAIT",
  "DELIVERED",
  "MARKED_FAILED",
]);
export type ReviewAction = z.infer<typeof ReviewActionSchema>;

export const FeedbackKindSchema = z.enum([
  "WOULD_USE",
  "RELEVANT_WRONG_ANGLE",
  "NOT_RELEVANT",
  "USED_OR_PUBLISHED",
  "REQUEST_ANOTHER_SCAN",
]);
export type FeedbackKind = z.infer<typeof FeedbackKindSchema>;

export const ApiKeyEnvironmentSchema = z.enum(["test", "live"]);
export type ApiKeyEnvironment = z.infer<typeof ApiKeyEnvironmentSchema>;

export const ApiKeyStatusSchema = z.enum(["ACTIVE", "REVOKED"]);
export type ApiKeyStatus = z.infer<typeof ApiKeyStatusSchema>;

export const AnalyticsEventNameSchema = z.enum([
  "landing_viewed",
  "example_scan_viewed",
  "free_scan_started",
  "free_scan_submitted",
  "scan_qualified",
  "scan_processing_started",
  "scan_review_required",
  "scan_reviewed",
  "scan_delivered",
  "scan_result_viewed",
  "scan_feedback_submitted",
  "move_marked_used",
  "second_scan_requested",
  "api_key_issued",
  "api_request_succeeded",
  "pricing_viewed",
  "checkout_started",
  "subscription_started",
]);
export type AnalyticsEventName = z.infer<typeof AnalyticsEventNameSchema>;
