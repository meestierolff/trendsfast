import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import type {
  ProjectContext,
  QueryPlan,
  SignalAuthor,
  SignalMetrics,
  SignalProvenance,
} from "@trendsfast/schemas";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
};

export const scanStateEnum = pgEnum("scan_state", [
  "QUEUED",
  "RUNNING",
  "REVIEW_REQUIRED",
  "READY",
  "FAILED",
]);
export const scanOriginEnum = pgEnum("scan_origin", ["PUBLIC_FORM", "API", "OPS", "FIXTURE"]);
export const sourceSlugEnum = pgEnum("source_slug", [
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
export const sourceRunStateEnum = pgEnum("source_run_state", [
  "PENDING",
  "RUNNING",
  "SUCCEEDED",
  "DEGRADED",
  "FAILED",
  "SKIPPED",
]);
export const signalClassEnum = pgEnum("signal_class", [
  "MEASURED_EXTERNAL_SERIES",
  "MEASURED_INTERNAL_VELOCITY",
  "CORROBORATED_SIGNAL",
  "EMERGING_SIGNAL",
  "INSUFFICIENT_SIGNAL",
]);
export const nextMoveActionEnum = pgEnum("next_move_action", ["PUBLISH", "REPLY", "REMIX", "WAIT"]);
export const nextMoveStateEnum = pgEnum("next_move_state", [
  "DRAFT",
  "APPROVED",
  "READY",
  "REJECTED",
]);
export const saturationEnum = pgEnum("saturation", [
  "low",
  "low_to_medium",
  "medium",
  "high",
  "unknown",
]);
export const reviewActionEnum = pgEnum("review_action", [
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
export const deliveryStatusEnum = pgEnum("delivery_status", [
  "ACTIVE",
  "DELIVERED",
  "REVOKED",
  "EXPIRED",
]);
export const feedbackKindEnum = pgEnum("feedback_kind", [
  "WOULD_USE",
  "RELEVANT_WRONG_ANGLE",
  "NOT_RELEVANT",
  "USED_OR_PUBLISHED",
  "REQUEST_ANOTHER_SCAN",
]);
export const outcomeKindEnum = pgEnum("outcome_kind", [
  "USED",
  "PUBLISHED",
  "REPLIED",
  "REMIXED",
  "SKIPPED",
  "UNKNOWN",
]);
export const apiKeyEnvironmentEnum = pgEnum("api_key_environment", ["test", "live"]);
export const apiKeyStatusEnum = pgEnum("api_key_status", ["ACTIVE", "REVOKED"]);
export const apiKeyManagementActionEnum = pgEnum("api_key_management_action", [
  "ISSUED",
  "REVOKED",
  "ROTATED",
  "REISSUED",
]);
export const apiAuthOutcomeEnum = pgEnum("api_auth_outcome", [
  "SUCCESS",
  "NOT_FOUND",
  "INVALID",
  "REVOKED",
  "EXPIRED",
  "RATE_LIMITED",
  "COST_LIMITED",
]);
export const evidenceAvailabilityEnum = pgEnum("evidence_availability", [
  "AVAILABLE",
  "SOURCE_NO_LONGER_AVAILABLE",
  "REJECTED",
]);
export const evidenceBindingRoleEnum = pgEnum("evidence_binding_role", [
  "DECISION_SUPPORT",
  "SUPPLEMENTAL",
]);
export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "INCOMPLETE",
  "TRIALING",
  "ACTIVE",
  "PAST_DUE",
  "CANCELED",
  "UNPAID",
  "PAUSED",
]);
export const providerVerificationStateEnum = pgEnum("provider_verification_state", [
  "RUNNING",
  "VERIFIED",
  "DEGRADED",
  "FAILED",
  "UNCONFIGURED",
  "FIXTURE",
  "LEGAL_REVIEW",
]);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    publicId: varchar("public_id", { length: 80 }).notNull(),
    name: varchar("name", { length: 200 }),
    url: text("url").notNull(),
    normalizedUrl: text("normalized_url").notNull(),
    status: varchar("status", { length: 20 }).default("ACTIVE").notNull(),
    publicCaseStudyConsent: boolean("public_case_study_consent").default(false).notNull(),
    ...timestamps,
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("projects_public_id_uidx").on(table.publicId),
    uniqueIndex("projects_normalized_url_uidx").on(table.normalizedUrl),
    index("projects_status_created_idx").on(table.status, table.createdAt),
    check("projects_status_check", sql`${table.status} IN ('ACTIVE', 'ARCHIVED')`),
    check("projects_url_length_check", sql`length(${table.url}) <= 2048`),
  ],
);

export const projectContextVersions = pgTable(
  "project_context_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    isCurrent: boolean("is_current").default(true).notNull(),
    inferredName: varchar("inferred_name", { length: 200 }).notNull(),
    category: varchar("category", { length: 500 }).notNull(),
    audience: text("audience").notNull(),
    problem: text("problem").notNull(),
    language: varchar("language", { length: 35 }).notNull(),
    credibleTopics: jsonb("credible_topics").$type<string[]>().notNull(),
    assumptions: jsonb("assumptions").$type<string[]>().notNull(),
    context: jsonb("context").$type<ProjectContext>().notNull(),
    sourceContentHash: varchar("source_content_hash", { length: 200 }),
    promptVersion: varchar("prompt_version", { length: 100 }),
    model: varchar("model", { length: 200 }),
    createdBy: varchar("created_by", { length: 160 }).default("system").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("project_context_project_version_uidx").on(table.projectId, table.version),
    uniqueIndex("project_context_one_current_uidx")
      .on(table.projectId)
      .where(sql`${table.isCurrent} = true`),
    index("project_context_language_category_idx").on(table.language, table.category),
    check("project_context_version_positive_check", sql`${table.version} > 0`),
  ],
);

export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    name: varchar("name", { length: 200 }).notNull(),
    visiblePrefix: varchar("visible_prefix", { length: 32 }).notNull(),
    secretHash: text("secret_hash").notNull(),
    scopes: jsonb("scopes").$type<string[]>().default([]).notNull(),
    environment: apiKeyEnvironmentEnum("environment").notNull(),
    status: apiKeyStatusEnum("status").default("ACTIVE").notNull(),
    rateLimitPerHour: integer("rate_limit_per_hour").default(20).notNull(),
    providerCostLimitUsd: numeric("provider_cost_limit_usd", {
      precision: 10,
      scale: 4,
    })
      .default("5.0000")
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("api_keys_environment_prefix_uidx").on(table.environment, table.visiblePrefix),
    index("api_keys_project_status_idx").on(table.projectId, table.status),
    index("api_keys_status_expiry_idx").on(table.status, table.expiresAt),
    check("api_keys_rate_limit_positive_check", sql`${table.rateLimitPerHour} > 0`),
    check("api_keys_cost_limit_nonnegative_check", sql`${table.providerCostLimitUsd} >= 0`),
    check(
      "api_keys_expiry_after_creation_check",
      sql`${table.expiresAt} IS NULL OR ${table.expiresAt} > ${table.createdAt}`,
    ),
    check(
      "api_keys_revocation_consistency_check",
      sql`(${table.status} = 'REVOKED') = (${table.revokedAt} IS NOT NULL)`,
    ),
  ],
);

/**
 * Append-only founder actions for project key lifecycle changes. Raw key
 * material is never accepted by or persisted in this ledger.
 */
export const apiKeyManagementEvents = pgTable(
  "api_key_management_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    apiKeyId: uuid("api_key_id").references(() => apiKeys.id, {
      onDelete: "set null",
    }),
    relatedApiKeyId: uuid("related_api_key_id").references(() => apiKeys.id, {
      onDelete: "set null",
    }),
    action: apiKeyManagementActionEnum("action").notNull(),
    actorId: varchar("actor_id", { length: 160 }).notNull(),
    before: jsonb("before").$type<Record<string, unknown>>(),
    after: jsonb("after").$type<Record<string, unknown>>(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("api_key_management_project_occurred_idx").on(table.projectId, table.occurredAt),
    index("api_key_management_key_occurred_idx").on(table.apiKeyId, table.occurredAt),
    check("api_key_management_actor_check", sql`length(${table.actorId}) BETWEEN 1 AND 160`),
  ],
);

export const scanRequests = pgTable(
  "scan_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    publicId: varchar("public_id", { length: 80 }).notNull(),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    apiKeyId: uuid("api_key_id").references(() => apiKeys.id, {
      onDelete: "set null",
    }),
    origin: scanOriginEnum("origin").notNull(),
    state: scanStateEnum("state").default("QUEUED").notNull(),
    submittedUrl: text("submitted_url").notNull(),
    normalizedUrl: text("normalized_url").notNull(),
    goal: varchar("goal", { length: 100 }),
    market: varchar("market", { length: 50 }),
    language: varchar("language", { length: 35 }),
    preferredChannels: jsonb("preferred_channels").$type<string[]>(),
    availableFormats: jsonb("available_formats").$type<string[]>(),
    idempotencyKeyHash: varchar("idempotency_key_hash", { length: 200 }),
    requestPayloadHash: varchar("request_payload_hash", { length: 200 }),
    requesterFingerprintHash: varchar("requester_fingerprint_hash", { length: 200 }),
    apiCostReservationUsd: numeric("api_cost_reservation_usd", {
      precision: 10,
      scale: 6,
    })
      .default("0")
      .notNull(),
    failureCode: varchar("failure_code", { length: 100 }),
    failureMessage: varchar("failure_message", { length: 500 }),
    ...timestamps,
    submittedAt: timestamp("submitted_at", { withTimezone: true }).defaultNow().notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("scan_requests_public_id_uidx").on(table.publicId),
    uniqueIndex("scan_requests_api_idempotency_uidx")
      .on(table.apiKeyId, table.idempotencyKeyHash)
      .where(sql`${table.idempotencyKeyHash} IS NOT NULL`),
    index("scan_requests_queue_idx").on(table.state, table.submittedAt),
    index("scan_requests_project_created_idx").on(table.projectId, table.createdAt),
    index("scan_requests_api_cost_window_idx").on(table.apiKeyId, table.submittedAt),
    index("scan_requests_fingerprint_created_idx").on(
      table.requesterFingerprintHash,
      table.createdAt,
    ),
    check("scan_requests_url_length_check", sql`length(${table.submittedUrl}) <= 2048`),
    check(
      "scan_requests_api_cost_reservation_nonnegative_check",
      sql`${table.apiCostReservationUsd} >= 0`,
    ),
    check(
      "scan_requests_terminal_timestamp_check",
      sql`${table.state} NOT IN ('READY', 'FAILED') OR ${table.completedAt} IS NOT NULL`,
    ),
  ],
);

export const scanRuns = pgTable(
  "scan_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    scanRequestId: uuid("scan_request_id")
      .notNull()
      .references(() => scanRequests.id, { onDelete: "cascade" }),
    projectContextVersionId: uuid("project_context_version_id").references(
      () => projectContextVersions.id,
      { onDelete: "restrict" },
    ),
    attempt: integer("attempt").default(1).notNull(),
    state: scanStateEnum("state").default("QUEUED").notNull(),
    queryPlan: jsonb("query_plan").$type<QueryPlan>(),
    queryPlanVersion: varchar("query_plan_version", { length: 100 }),
    scoreVersion: varchar("score_version", { length: 100 }),
    promptVersion: varchar("prompt_version", { length: 100 }),
    modelInput: jsonb("model_input").$type<Record<string, unknown>>(),
    modelOutput: jsonb("model_output").$type<Record<string, unknown>>(),
    sourceCoverage: jsonb("source_coverage").$type<Record<string, string>>(),
    signalClass: signalClassEnum("signal_class"),
    estimatedCostUsd: numeric("estimated_cost_usd", { precision: 10, scale: 6 })
      .default("0")
      .notNull(),
    actualCostUsd: numeric("actual_cost_usd", { precision: 10, scale: 6 }).default("0").notNull(),
    hardDeadlineAt: timestamp("hard_deadline_at", { withTimezone: true }),
    processingFence: varchar("processing_fence", { length: 80 }),
    ...timestamps,
    startedAt: timestamp("started_at", { withTimezone: true }),
    reviewRequiredAt: timestamp("review_required_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    failureCode: varchar("failure_code", { length: 100 }),
    failureMessage: varchar("failure_message", { length: 500 }),
  },
  (table) => [
    uniqueIndex("scan_runs_request_attempt_uidx").on(table.scanRequestId, table.attempt),
    uniqueIndex("scan_runs_one_active_uidx")
      .on(table.scanRequestId)
      .where(sql`${table.state} IN ('QUEUED', 'RUNNING', 'REVIEW_REQUIRED')`),
    index("scan_runs_state_updated_idx").on(table.state, table.updatedAt),
    check("scan_runs_attempt_positive_check", sql`${table.attempt} > 0`),
    check(
      "scan_runs_cost_nonnegative_check",
      sql`${table.estimatedCostUsd} >= 0 AND ${table.actualCostUsd} >= 0`,
    ),
  ],
);

export const sourceRuns = pgTable(
  "source_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    scanRunId: uuid("scan_run_id")
      .notNull()
      .references(() => scanRuns.id, { onDelete: "cascade" }),
    source: sourceSlugEnum("source").notNull(),
    provider: varchar("provider", { length: 100 }).notNull(),
    state: sourceRunStateEnum("state").default("PENDING").notNull(),
    queryPlanFragment: jsonb("query_plan_fragment").$type<Record<string, unknown>>(),
    maxCalls: integer("max_calls").notNull(),
    callsMade: integer("calls_made").default(0).notNull(),
    candidateCount: integer("candidate_count").default(0).notNull(),
    estimatedCostUsd: numeric("estimated_cost_usd", { precision: 10, scale: 6 })
      .default("0")
      .notNull(),
    actualCostUsd: numeric("actual_cost_usd", { precision: 10, scale: 6 }).default("0").notNull(),
    quotaUsed: numeric("quota_used", { precision: 14, scale: 4 }).default("0").notNull(),
    durationMs: integer("duration_ms"),
    providerPayloadFragment: jsonb("provider_payload_fragment").$type<Record<string, unknown>>(),
    failureCode: varchar("failure_code", { length: 100 }),
    failureMessage: varchar("failure_message", { length: 500 }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("source_runs_scan_source_provider_uidx").on(
      table.scanRunId,
      table.source,
      table.provider,
    ),
    index("source_runs_state_updated_idx").on(table.state, table.updatedAt),
    check(
      "source_runs_bounds_check",
      sql`${table.maxCalls} >= 0 AND ${table.callsMade} >= 0 AND ${table.callsMade} <= ${table.maxCalls} AND ${table.candidateCount} >= 0`,
    ),
    check(
      "source_runs_cost_nonnegative_check",
      sql`${table.estimatedCostUsd} >= 0 AND ${table.actualCostUsd} >= 0 AND ${table.quotaUsed} >= 0`,
    ),
  ],
);

export const signals = pgTable(
  "signals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceRunId: uuid("source_run_id")
      .notNull()
      .references(() => sourceRuns.id, { onDelete: "cascade" }),
    source: sourceSlugEnum("source").notNull(),
    sourceId: varchar("source_id", { length: 300 }).notNull(),
    canonicalUrl: text("canonical_url").notNull(),
    title: varchar("title", { length: 500 }),
    textExcerpt: text("text_excerpt"),
    author: jsonb("author").$type<SignalAuthor>(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    language: varchar("language", { length: 35 }),
    metrics: jsonb("metrics").$type<SignalMetrics>().default({}).notNull(),
    queryId: varchar("query_id", { length: 160 }).notNull(),
    provider: varchar("provider", { length: 100 }).notNull(),
    providerRequestId: varchar("provider_request_id", { length: 200 }),
    retrievedAt: timestamp("retrieved_at", { withTimezone: true }).notNull(),
    cached: boolean("cached").default(false).notNull(),
    rawPayloadHash: varchar("raw_payload_hash", { length: 200 }),
    provenance: jsonb("provenance").$type<SignalProvenance>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("signals_run_source_source_id_uidx").on(
      table.sourceRunId,
      table.source,
      table.sourceId,
    ),
    index("signals_source_observed_idx").on(table.source, table.observedAt),
    index("signals_query_observed_idx").on(table.queryId, table.observedAt),
    index("signals_canonical_url_idx").on(table.canonicalUrl),
    check("signals_url_length_check", sql`length(${table.canonicalUrl}) <= 2048`),
    check(
      "signals_excerpt_length_check",
      sql`${table.textExcerpt} IS NULL OR length(${table.textExcerpt}) <= 4000`,
    ),
  ],
);

export const signalMetricSnapshots = pgTable(
  "signal_metric_snapshots",
  {
    signalId: uuid("signal_id")
      .notNull()
      .references(() => signals.id, { onDelete: "cascade" }),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    metrics: jsonb("metrics").$type<SignalMetrics>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({
      name: "signal_metric_snapshots_pk",
      columns: [table.signalId, table.observedAt],
    }),
    index("signal_metric_snapshots_observed_idx").on(table.observedAt),
  ],
);

export const clusters = pgTable(
  "clusters",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    scanRunId: uuid("scan_run_id")
      .notNull()
      .references(() => scanRuns.id, { onDelete: "cascade" }),
    dedupeKey: varchar("dedupe_key", { length: 200 }),
    topic: varchar("topic", { length: 500 }).notNull(),
    summary: text("summary"),
    signalClass: signalClassEnum("signal_class").notNull(),
    independentSourceCount: integer("independent_source_count").default(0).notNull(),
    saturation: saturationEnum("saturation").default("unknown").notNull(),
    scoreComponents: jsonb("score_components").$type<Record<string, number>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("clusters_scan_dedupe_uidx")
      .on(table.scanRunId, table.dedupeKey)
      .where(sql`${table.dedupeKey} IS NOT NULL`),
    index("clusters_scan_signal_class_idx").on(table.scanRunId, table.signalClass),
    check("clusters_independent_source_count_check", sql`${table.independentSourceCount} >= 0`),
  ],
);

export const clusterMembers = pgTable(
  "cluster_members",
  {
    clusterId: uuid("cluster_id")
      .notNull()
      .references(() => clusters.id, { onDelete: "cascade" }),
    signalId: uuid("signal_id")
      .notNull()
      .references(() => signals.id, { onDelete: "cascade" }),
    similarity: numeric("similarity", { precision: 6, scale: 5 }).notNull(),
    isPrimary: boolean("is_primary").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({
      name: "cluster_members_pk",
      columns: [table.clusterId, table.signalId],
    }),
    index("cluster_members_signal_idx").on(table.signalId),
    check(
      "cluster_members_similarity_check",
      sql`${table.similarity} >= 0 AND ${table.similarity} <= 1`,
    ),
  ],
);

export const opportunities = pgTable(
  "opportunities",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    scanRunId: uuid("scan_run_id")
      .notNull()
      .references(() => scanRuns.id, { onDelete: "cascade" }),
    clusterId: uuid("cluster_id").references(() => clusters.id, {
      onDelete: "set null",
    }),
    rank: integer("rank").notNull(),
    actionCandidate: nextMoveActionEnum("action_candidate").notNull(),
    channel: varchar("channel", { length: 100 }).notNull(),
    format: varchar("format", { length: 100 }).notNull(),
    totalScore: numeric("total_score", { precision: 8, scale: 6 }).notNull(),
    scoreComponents: jsonb("score_components").$type<Record<string, number>>().notNull(),
    passesQualityFloor: boolean("passes_quality_floor").default(false).notNull(),
    rejectionReason: text("rejection_reason"),
    validUntil: timestamp("valid_until", { withTimezone: true }),
    scoreVersion: varchar("score_version", { length: 100 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("opportunities_scan_rank_uidx").on(table.scanRunId, table.rank),
    index("opportunities_scan_floor_score_idx").on(
      table.scanRunId,
      table.passesQualityFloor,
      table.totalScore,
    ),
    check("opportunities_rank_positive_check", sql`${table.rank} > 0`),
    check(
      "opportunities_score_range_check",
      sql`${table.totalScore} >= -1 AND ${table.totalScore} <= 1`,
    ),
  ],
);

export const nextMoves = pgTable(
  "next_moves",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    publicId: varchar("public_id", { length: 80 }).notNull(),
    scanRequestId: uuid("scan_request_id")
      .notNull()
      .references(() => scanRequests.id, { onDelete: "cascade" }),
    scanRunId: uuid("scan_run_id")
      .notNull()
      .references(() => scanRuns.id, { onDelete: "cascade" }),
    projectContextVersionId: uuid("project_context_version_id")
      .notNull()
      .references(() => projectContextVersions.id, { onDelete: "restrict" }),
    opportunityId: uuid("opportunity_id").references(() => opportunities.id, {
      onDelete: "set null",
    }),
    state: nextMoveStateEnum("state").default("DRAFT").notNull(),
    action: nextMoveActionEnum("action").notNull(),
    channel: varchar("channel", { length: 100 }).notNull(),
    topic: varchar("topic", { length: 500 }).notNull(),
    angle: text("angle").notNull(),
    format: varchar("format", { length: 100 }).notNull(),
    hook: text("hook").notNull(),
    outline: jsonb("outline").$type<string[]>().notNull(),
    cta: text("cta").notNull(),
    priority: integer("priority").notNull(),
    confidence: numeric("confidence", { precision: 6, scale: 5 }).notNull(),
    confidenceRationale: text("confidence_rationale"),
    whyNow: text("why_now").notNull(),
    signalClass: signalClassEnum("signal_class").notNull(),
    independentSourceCount: integer("independent_source_count").notNull(),
    saturation: saturationEnum("saturation").notNull(),
    limitations: jsonb("limitations").$type<string[]>().default([]).notNull(),
    founderReviewed: boolean("founder_reviewed").default(false).notNull(),
    autoPublish: boolean("auto_publish").default(false).notNull(),
    promptVersion: varchar("prompt_version", { length: 100 }).notNull(),
    scoreVersion: varchar("score_version", { length: 100 }).notNull(),
    validUntil: timestamp("valid_until", { withTimezone: true }).notNull(),
    ...timestamps,
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("next_moves_public_id_uidx").on(table.publicId),
    uniqueIndex("next_moves_scan_run_uidx").on(table.scanRunId),
    index("next_moves_scan_request_state_idx").on(table.scanRequestId, table.state),
    check(
      "next_moves_priority_confidence_check",
      sql`${table.priority} BETWEEN 0 AND 100 AND ${table.confidence} BETWEEN 0 AND 1`,
    ),
    check("next_moves_sources_nonnegative_check", sql`${table.independentSourceCount} >= 0`),
    check("next_moves_never_autopublish_check", sql`${table.autoPublish} = false`),
    check(
      "next_moves_review_consistency_check",
      sql`${table.state} NOT IN ('APPROVED', 'READY') OR (${table.founderReviewed} = true AND ${table.approvedAt} IS NOT NULL)`,
    ),
  ],
);

export const evidenceReceipts = pgTable(
  "evidence_receipts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    nextMoveId: uuid("next_move_id")
      .notNull()
      .references(() => nextMoves.id, { onDelete: "cascade" }),
    signalId: uuid("signal_id")
      .notNull()
      .references(() => signals.id, { onDelete: "restrict" }),
    source: sourceSlugEnum("source").notNull(),
    provider: varchar("provider", { length: 100 }).notNull(),
    canonicalUrl: text("canonical_url").notNull(),
    title: varchar("title", { length: 500 }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    reason: text("reason").notNull(),
    bindingRole: evidenceBindingRoleEnum("binding_role").default("DECISION_SUPPORT").notNull(),
    verified: boolean("verified").default(false).notNull(),
    availability: evidenceAvailabilityEnum("availability").default("AVAILABLE").notNull(),
    reviewedBy: varchar("reviewed_by", { length: 160 }),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("evidence_receipts_move_signal_uidx").on(table.nextMoveId, table.signalId),
    index("evidence_receipts_move_availability_idx").on(table.nextMoveId, table.availability),
    check(
      "evidence_receipts_verified_timestamp_check",
      sql`${table.verified} = false OR ${table.verifiedAt} IS NOT NULL`,
    ),
  ],
);

export const reviewEvents = pgTable(
  "review_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    scanRequestId: uuid("scan_request_id")
      .notNull()
      .references(() => scanRequests.id, { onDelete: "cascade" }),
    scanRunId: uuid("scan_run_id").references(() => scanRuns.id, {
      onDelete: "set null",
    }),
    nextMoveId: uuid("next_move_id").references(() => nextMoves.id, {
      onDelete: "set null",
    }),
    action: reviewActionEnum("action").notNull(),
    reviewerId: varchar("reviewer_id", { length: 160 }).notNull(),
    before: jsonb("before").$type<Record<string, unknown>>(),
    after: jsonb("after").$type<Record<string, unknown>>(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("review_events_request_created_idx").on(table.scanRequestId, table.createdAt),
    index("review_events_move_created_idx").on(table.nextMoveId, table.createdAt),
    check(
      "review_events_note_length_check",
      sql`${table.note} IS NULL OR length(${table.note}) <= 4000`,
    ),
  ],
);

export const deliveryTokens = pgTable(
  "delivery_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    nextMoveId: uuid("next_move_id")
      .notNull()
      .references(() => nextMoves.id, { onDelete: "cascade" }),
    tokenPrefix: varchar("token_prefix", { length: 32 }).notNull(),
    tokenHash: varchar("token_hash", { length: 100 }).notNull(),
    status: deliveryStatusEnum("status").default("ACTIVE").notNull(),
    publicShareConsent: boolean("public_share_consent").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    firstViewedAt: timestamp("first_viewed_at", { withTimezone: true }),
    lastViewedAt: timestamp("last_viewed_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("delivery_tokens_hash_uidx").on(table.tokenHash),
    uniqueIndex("delivery_tokens_prefix_uidx").on(table.tokenPrefix),
    index("delivery_tokens_move_status_idx").on(table.nextMoveId, table.status),
    index("delivery_tokens_expiry_idx").on(table.status, table.expiresAt),
    check("delivery_tokens_expiry_check", sql`${table.expiresAt} > ${table.createdAt}`),
  ],
);

export const feedbackEvents = pgTable(
  "feedback_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    nextMoveId: uuid("next_move_id")
      .notNull()
      .references(() => nextMoves.id, { onDelete: "cascade" }),
    deliveryTokenId: uuid("delivery_token_id").references(() => deliveryTokens.id, {
      onDelete: "set null",
    }),
    kind: feedbackKindEnum("kind").notNull(),
    freeText: text("free_text"),
    visitorFingerprintHash: varchar("visitor_fingerprint_hash", { length: 200 }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("feedback_events_move_created_idx").on(table.nextMoveId, table.createdAt),
    index("feedback_events_kind_created_idx").on(table.kind, table.createdAt),
    check(
      "feedback_events_free_text_length_check",
      sql`${table.freeText} IS NULL OR length(${table.freeText}) <= 2000`,
    ),
  ],
);

export const outcomes = pgTable(
  "outcomes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    nextMoveId: uuid("next_move_id")
      .notNull()
      .references(() => nextMoves.id, { onDelete: "cascade" }),
    kind: outcomeKindEnum("kind").notNull(),
    publicUrl: text("public_url"),
    notes: text("notes"),
    reportedAt: timestamp("reported_at", { withTimezone: true }).defaultNow().notNull(),
    verified: boolean("verified").default(false).notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("outcomes_move_reported_idx").on(table.nextMoveId, table.reportedAt),
    check(
      "outcomes_verified_timestamp_check",
      sql`${table.verified} = false OR ${table.verifiedAt} IS NOT NULL`,
    ),
    check(
      "outcomes_notes_length_check",
      sql`${table.notes} IS NULL OR length(${table.notes}) <= 2000`,
    ),
  ],
);

export const providerCostLedger = pgTable(
  "provider_cost_ledger",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    scanRunId: uuid("scan_run_id")
      .notNull()
      .references(() => scanRuns.id, { onDelete: "cascade" }),
    ledgerKey: varchar("ledger_key", { length: 200 }),
    sourceRunId: uuid("source_run_id").references(() => sourceRuns.id, {
      onDelete: "set null",
    }),
    provider: varchar("provider", { length: 100 }).notNull(),
    operation: varchar("operation", { length: 160 }).notNull(),
    providerRequestId: varchar("provider_request_id", { length: 200 }),
    estimatedCostUsd: numeric("estimated_cost_usd", { precision: 10, scale: 6 })
      .default("0")
      .notNull(),
    actualCostUsd: numeric("actual_cost_usd", { precision: 10, scale: 6 }).default("0").notNull(),
    quotaUnits: numeric("quota_units", { precision: 14, scale: 4 }).default("0").notNull(),
    unitMetadata: jsonb("unit_metadata").$type<Record<string, number | string>>(),
    currency: varchar("currency", { length: 3 }).default("USD").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("provider_cost_scan_ledger_key_uidx")
      .on(table.scanRunId, table.ledgerKey)
      .where(sql`${table.ledgerKey} IS NOT NULL`),
    index("provider_cost_scan_occurred_idx").on(table.scanRunId, table.occurredAt),
    index("provider_cost_provider_occurred_idx").on(table.provider, table.occurredAt),
    check(
      "provider_cost_nonnegative_check",
      sql`${table.estimatedCostUsd} >= 0 AND ${table.actualCostUsd} >= 0 AND ${table.quotaUnits} >= 0`,
    ),
    check("provider_cost_currency_check", sql`${table.currency} = 'USD'`),
  ],
);

export const analyticsEvents = pgTable(
  "analytics_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 100 }).notNull(),
    anonymousSessionHash: varchar("anonymous_session_hash", { length: 200 }),
    scanRequestId: uuid("scan_request_id").references(() => scanRequests.id, {
      onDelete: "set null",
    }),
    nextMoveId: uuid("next_move_id").references(() => nextMoves.id, {
      onDelete: "set null",
    }),
    apiKeyId: uuid("api_key_id").references(() => apiKeys.id, {
      onDelete: "set null",
    }),
    referrer: varchar("referrer", { length: 500 }),
    utmSource: varchar("utm_source", { length: 200 }),
    utmMedium: varchar("utm_medium", { length: 200 }),
    utmCampaign: varchar("utm_campaign", { length: 200 }),
    firstLandingPath: varchar("first_landing_path", { length: 500 }),
    firstTouch: jsonb("first_touch").$type<Record<string, string>>(),
    currentTouch: jsonb("current_touch").$type<Record<string, string>>(),
    properties: jsonb("properties").$type<Record<string, unknown>>(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("analytics_events_name_occurred_idx").on(table.name, table.occurredAt),
    index("analytics_events_scan_occurred_idx").on(table.scanRequestId, table.occurredAt),
    check(
      "analytics_events_name_check",
      sql`${table.name} IN ('landing_viewed','example_scan_viewed','free_scan_started','free_scan_submitted','scan_qualified','scan_processing_started','scan_review_required','scan_reviewed','scan_delivered','scan_result_viewed','scan_feedback_submitted','move_marked_used','second_scan_requested','api_key_issued','api_request_succeeded','pricing_viewed','checkout_started','subscription_started')`,
    ),
  ],
);

export const apiKeyAuthEvents = pgTable(
  "api_key_auth_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    apiKeyId: uuid("api_key_id").references(() => apiKeys.id, {
      onDelete: "set null",
    }),
    presentedPrefix: varchar("presented_prefix", { length: 32 }),
    outcome: apiAuthOutcomeEnum("outcome").notNull(),
    requesterFingerprintHash: varchar("requester_fingerprint_hash", { length: 200 }),
    requestId: varchar("request_id", { length: 160 }),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("api_key_auth_events_key_occurred_idx").on(table.apiKeyId, table.occurredAt),
    index("api_key_auth_events_outcome_occurred_idx").on(table.outcome, table.occurredAt),
  ],
);

/**
 * A bounded, cross-instance admission gate that runs before expensive API-key
 * verification. Scope identifiers are HMACs/namespaces, never raw addresses.
 */
export const apiAuthAdmissionBuckets = pgTable(
  "api_auth_admission_buckets",
  {
    scopeHash: varchar("scope_hash", { length: 200 }).primaryKey(),
    windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull(),
    attempts: integer("attempts").default(0).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("api_auth_admission_window_idx").on(table.windowStartedAt),
    check("api_auth_admission_attempts_nonnegative_check", sql`${table.attempts} >= 0`),
  ],
);

/**
 * Append-only deployed-provider verification history. A healthy credential
 * check is deliberately distinct from a verified source read-back.
 */
export const providerVerificationRecords = pgTable(
  "provider_verification_records",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    source: sourceSlugEnum("source").notNull(),
    provider: varchar("provider", { length: 100 }).notNull(),
    state: providerVerificationStateEnum("state").notNull(),
    credentialMode: varchar("credential_mode", { length: 20 }).notNull(),
    deploymentEnvironment: varchar("deployment_environment", { length: 20 }).notNull(),
    releaseSha: varchar("release_sha", { length: 100 }),
    deploymentHost: varchar("deployment_host", { length: 255 }),
    deploymentId: varchar("deployment_id", { length: 255 }),
    healthStatus: varchar("health_status", { length: 20 }),
    readbackVerified: boolean("readback_verified").default(false).notNull(),
    canonicalUrls: jsonb("canonical_urls").$type<string[]>().default([]).notNull(),
    latencyMs: integer("latency_ms"),
    estimatedCostUsd: numeric("estimated_cost_usd", { precision: 10, scale: 6 })
      .default("0")
      .notNull(),
    actualCostUsd: numeric("actual_cost_usd", { precision: 10, scale: 6 }),
    quotaUsed: numeric("quota_used", { precision: 14, scale: 4 }).default("0").notNull(),
    limitations: jsonb("limitations").$type<string[]>().default([]).notNull(),
    failureCode: varchar("failure_code", { length: 100 }),
    failureMessage: varchar("failure_message", { length: 500 }),
    initiatedBy: varchar("initiated_by", { length: 160 }).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    checkedAt: timestamp("checked_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("provider_verification_source_completed_idx").on(table.source, table.completedAt),
    index("provider_verification_state_completed_idx").on(table.state, table.completedAt),
    check(
      "provider_verification_credential_mode_check",
      sql`${table.credentialMode} IN ('fixture', 'managed', 'byok', 'none')`,
    ),
    check(
      "provider_verification_deployment_environment_check",
      sql`${table.deploymentEnvironment} IN ('local', 'preview', 'production')`,
    ),
    check(
      "provider_verification_production_identity_check",
      sql`${table.deploymentEnvironment} <> 'production' OR (${table.releaseSha} IS NOT NULL AND length(${table.releaseSha}) >= 7 AND ${table.deploymentHost} IS NOT NULL AND length(${table.deploymentHost}) >= 3)`,
    ),
    check(
      "provider_verification_health_status_check",
      sql`${table.healthStatus} IS NULL OR ${table.healthStatus} IN ('HEALTHY', 'DEGRADED', 'UNCONFIGURED', 'FAILED')`,
    ),
    check(
      "provider_verification_cost_check",
      sql`${table.estimatedCostUsd} >= 0 AND (${table.actualCostUsd} IS NULL OR ${table.actualCostUsd} >= 0) AND ${table.quotaUsed} >= 0`,
    ),
    check(
      "provider_verification_latency_check",
      sql`${table.latencyMs} IS NULL OR ${table.latencyMs} >= 0`,
    ),
    check(
      "provider_verification_completion_check",
      sql`(${table.state} = 'RUNNING') = (${table.completedAt} IS NULL)`,
    ),
    check(
      "provider_verification_truth_check",
      sql`${table.state} <> 'VERIFIED' OR (${table.readbackVerified} = true AND jsonb_array_length(${table.canonicalUrls}) > 0)`,
    ),
  ],
);

export const stripeCustomers = pgTable(
  "stripe_customers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    stripeCustomerId: varchar("stripe_customer_id", { length: 255 }).notNull(),
    emailHash: varchar("email_hash", { length: 200 }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("stripe_customers_external_uidx").on(table.stripeCustomerId),
    index("stripe_customers_project_idx").on(table.projectId),
  ],
);

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    stripeCustomerId: uuid("stripe_customer_id")
      .notNull()
      .references(() => stripeCustomers.id, { onDelete: "cascade" }),
    stripeSubscriptionId: varchar("stripe_subscription_id", { length: 255 }).notNull(),
    stripePriceId: varchar("stripe_price_id", { length: 255 }).notNull(),
    entitlement: varchar("entitlement", { length: 100 }).default("founder_cloud").notNull(),
    status: subscriptionStatusEnum("status").notNull(),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").default(false).notNull(),
    currentPeriodStart: timestamp("current_period_start", { withTimezone: true }),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
    lastStripeEventId: varchar("last_stripe_event_id", { length: 255 }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("subscriptions_external_uidx").on(table.stripeSubscriptionId),
    uniqueIndex("subscriptions_last_event_uidx")
      .on(table.lastStripeEventId)
      .where(sql`${table.lastStripeEventId} IS NOT NULL`),
    index("subscriptions_customer_status_idx").on(table.stripeCustomerId, table.status),
    check("subscriptions_entitlement_check", sql`${table.entitlement} = 'founder_cloud'`),
  ],
);

export const databaseSchema = {
  projects,
  projectContextVersions,
  apiKeys,
  apiKeyManagementEvents,
  scanRequests,
  scanRuns,
  sourceRuns,
  signals,
  signalMetricSnapshots,
  clusters,
  clusterMembers,
  opportunities,
  nextMoves,
  evidenceReceipts,
  reviewEvents,
  deliveryTokens,
  feedbackEvents,
  outcomes,
  providerCostLedger,
  analyticsEvents,
  apiKeyAuthEvents,
  apiAuthAdmissionBuckets,
  providerVerificationRecords,
  stripeCustomers,
  subscriptions,
};
