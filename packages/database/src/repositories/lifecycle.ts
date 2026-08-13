import { and, count, desc, eq, gte, lt, max, sql, sum } from "drizzle-orm";

import {
  createPrefixedId,
  createPublicScanToken,
  digestNextMoveRequest,
  digestNextMoveRequestWithContext,
  hashOpaqueToken,
  redactRecord,
  redactSecrets,
} from "@trendsfast/core";
import type { NextMoveRequest, QueryPlan, ScanState, SignalClass } from "@trendsfast/schemas";

import type { TrendsFastDatabase } from "../client";
import {
  analyticsEvents,
  apiKeys,
  deliveryTokens,
  evidenceReceipts,
  founderUsageEvents,
  nextMoves,
  projectContextVersions,
  projects,
  scanRequests,
  scanRuns,
} from "../schema";
import { admitFounderUsage, lockProjectEntitlementScope } from "./founder-usage";

const USD_MICROS = 1_000_000;

function toUsdMicros(value: number, rounding: "nearest" | "floor"): number {
  const micros = value * USD_MICROS;
  return rounding === "floor" ? Math.floor(micros) : Math.round(micros);
}

function isFiniteNonnegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

const allowedTransitions = {
  QUEUED: ["RUNNING", "FAILED"],
  RUNNING: ["REVIEW_REQUIRED", "FAILED", "QUEUED"],
  REVIEW_REQUIRED: ["READY", "FAILED", "RUNNING"],
  READY: [],
  FAILED: ["QUEUED"],
} as const satisfies Record<ScanState, readonly ScanState[]>;

export function isScanStateTransitionAllowed(from: ScanState, to: ScanState): boolean {
  return (allowedTransitions[from] as readonly ScanState[]).includes(to);
}

export function assertScanStateTransition(from: ScanState, to: ScanState): void {
  if (!isScanStateTransitionAllowed(from, to)) {
    throw new Error(`Invalid scan state transition: ${from} -> ${to}`);
  }
}

export type ScanClaimDecision =
  "CLAIM_NEW_RUN" | "RESUME_RUN" | "ALREADY_CLAIMED" | "NOT_CLAIMABLE";

export class ProcessingFenceError extends Error {
  constructor(message = "The scan processing claim is no longer current") {
    super(message);
    this.name = "ProcessingFenceError";
  }
}

export function decideScanClaim(
  requestState: ScanState,
  run: { state: ScanState; hardDeadlineAt: Date | null } | null,
  now: Date,
): ScanClaimDecision {
  if (requestState === "READY" || requestState === "REVIEW_REQUIRED" || requestState === "FAILED") {
    return "NOT_CLAIMABLE";
  }
  if (requestState === "QUEUED") {
    if (!run || run.state === "FAILED") return "CLAIM_NEW_RUN";
    if (run.state === "QUEUED" || run.state === "RUNNING") return "RESUME_RUN";
    return "NOT_CLAIMABLE";
  }
  if (!run) return "CLAIM_NEW_RUN";
  if (run.state === "RUNNING" && run.hardDeadlineAt && run.hardDeadlineAt > now) {
    return "ALREADY_CLAIMED";
  }
  if (run.state === "RUNNING" || run.state === "QUEUED") return "RESUME_RUN";
  return "NOT_CLAIMABLE";
}

export function sanitizeProcessingFailure(code: string, message: string) {
  return {
    code: redactSecrets(code).slice(0, 100),
    message: redactSecrets(message).slice(0, 500),
  };
}

export function normalizeProductUrl(value: string): string {
  const url = new URL(value);
  url.hash = "";
  url.username = "";
  url.password = "";
  url.hostname = url.hostname.toLowerCase();
  if (
    (url.protocol === "https:" && url.port === "443") ||
    (url.protocol === "http:" && url.port === "80")
  ) {
    url.port = "";
  }
  if (url.pathname === "/") url.pathname = "";
  return url.toString();
}

export type CreateScanRequestInput = {
  request: NextMoveRequest;
  origin: "PUBLIC_FORM" | "API" | "OPS" | "FIXTURE" | "MONITORING";
  projectId?: string;
  apiKeyId?: string;
  idempotencyKey?: string;
  requesterFingerprintHash?: string;
  publicId?: string;
};

export type ScanRequestRecord = typeof scanRequests.$inferSelect;

export type CreateScanRequestResult =
  | { request: ScanRequestRecord; created: true; idempotencyConflict: false }
  | { request: ScanRequestRecord; created: false; idempotencyConflict: false }
  | { request: ScanRequestRecord; created: false; idempotencyConflict: true };

export type ResolveApiIdempotencyResult =
  | { request: ScanRequestRecord; idempotencyConflict: false }
  | { request: ScanRequestRecord; idempotencyConflict: true }
  | null;

export type AdmitApiScanRequestResult =
  | { status: "CREATED"; request: ScanRequestRecord }
  | { status: "REUSED"; request: ScanRequestRecord }
  | { status: "IDEMPOTENCY_CONFLICT"; request: ScanRequestRecord }
  | { status: "PROJECT_MISMATCH" }
  | { status: "KEY_INACTIVE" }
  | {
      status: "COST_LIMITED";
      committedCostUsd: number;
      projectedCostUsd: number;
      maximumCostUsd: number;
    }
  | { status: "USAGE_LIMITED"; reason: "ENTITLEMENT_INACTIVE" | "ON_DEMAND_MONTHLY_LIMIT" };

export type AdmitPublicScanRequestResult =
  | { status: "CREATED" | "REUSED"; scanRequestId: string; publicToken: string }
  | { status: "RATE_LIMITED" }
  | { status: "PROJECT_ALREADY_EXISTS" }
  | {
      status: "GLOBAL_CAPACITY_REACHED" | "GLOBAL_BUDGET_REACHED";
      admittedCount: number;
      dailyLimit: number;
      committedCostUsd: number;
      projectedCostUsd: number;
      dailyBudgetUsd: number;
    };

export type TransitionScanOptions = {
  failureCode?: string;
  failureMessage?: string;
};

type StoredRequestDigestSource = Pick<
  typeof scanRequests.$inferSelect,
  | "requestPayloadHash"
  | "submittedUrl"
  | "goal"
  | "market"
  | "language"
  | "preferredChannels"
  | "availableFormats"
  | "generationLevel"
  | "requestedContentCapabilities"
>;

function digestStoredRequest(request: StoredRequestDigestSource): string {
  return (
    request.requestPayloadHash ??
    digestNextMoveRequest({
      product_url: request.submittedUrl,
      ...(request.goal === null ? {} : { goal: request.goal }),
      ...(request.market === null ? {} : { market: request.market }),
      ...(request.language === null ? {} : { language: request.language }),
      ...(request.preferredChannels === null
        ? {}
        : { preferred_channels: request.preferredChannels }),
      ...(request.availableFormats === null ? {} : { available_formats: request.availableFormats }),
      ...(request.requestedContentCapabilities === null
        ? {}
        : { content_capabilities: request.requestedContentCapabilities }),
      generation_level: request.generationLevel,
    })
  );
}

export function isSameIdempotentRequest(
  stored: StoredRequestDigestSource,
  request: NextMoveRequest,
  projectContextVersionId?: string,
): boolean {
  return (
    digestStoredRequest(stored) ===
    digestNextMoveRequestWithContext(request, projectContextVersionId)
  );
}

function resolveStoredIdempotency(
  stored: ScanRequestRecord,
  request: NextMoveRequest,
  projectContextVersionId?: string,
): Exclude<ResolveApiIdempotencyResult, null> {
  if (isSameIdempotentRequest(stored, request, projectContextVersionId)) {
    return { request: stored, idempotencyConflict: false };
  }
  return { request: stored, idempotencyConflict: true };
}

export class ScanRepository {
  constructor(private readonly db: TrendsFastDatabase) {}

  async createRequest(input: CreateScanRequestInput): Promise<CreateScanRequestResult> {
    if (input.origin === "API") {
      throw new Error("API requests must use atomic API cost admission");
    }
    const idempotencyKeyHash = input.idempotencyKey ? hashOpaqueToken(input.idempotencyKey) : null;
    const requestPayloadHash = digestNextMoveRequest(input.request);

    if (input.apiKeyId && idempotencyKeyHash) {
      const [existing] = await this.db
        .select()
        .from(scanRequests)
        .where(
          and(
            eq(scanRequests.apiKeyId, input.apiKeyId),
            eq(scanRequests.idempotencyKeyHash, idempotencyKeyHash),
          ),
        )
        .limit(1);
      if (existing) {
        const resolved = resolveStoredIdempotency(existing, input.request);
        return {
          request: resolved.request,
          created: false as const,
          idempotencyConflict: resolved.idempotencyConflict,
        };
      }
    }

    const [created] = await this.db
      .insert(scanRequests)
      .values({
        publicId: input.publicId ?? createPublicScanToken(),
        projectId: input.projectId ?? null,
        apiKeyId: input.apiKeyId ?? null,
        origin: input.origin,
        state: "QUEUED",
        submittedUrl: input.request.product_url,
        normalizedUrl: normalizeProductUrl(input.request.product_url),
        goal: input.request.objective ?? input.request.goal ?? null,
        market: input.request.market ?? null,
        language: input.request.language ?? null,
        preferredChannels: input.request.preferred_channels ?? null,
        availableFormats: input.request.available_formats ?? null,
        generationLevel: input.request.generation_level ?? "brief",
        requestedContentCapabilities: input.request.content_capabilities ?? null,
        idempotencyKeyHash,
        requestPayloadHash,
        requesterFingerprintHash: input.requesterFingerprintHash ?? null,
      })
      .onConflictDoNothing()
      .returning();

    if (created) {
      return {
        request: created,
        created: true as const,
        idempotencyConflict: false as const,
      };
    }

    if (input.apiKeyId && idempotencyKeyHash) {
      const [raced] = await this.db
        .select()
        .from(scanRequests)
        .where(
          and(
            eq(scanRequests.apiKeyId, input.apiKeyId),
            eq(scanRequests.idempotencyKeyHash, idempotencyKeyHash),
          ),
        )
        .limit(1);
      if (raced) {
        const resolved = resolveStoredIdempotency(raced, input.request);
        return {
          request: resolved.request,
          created: false as const,
          idempotencyConflict: resolved.idempotencyConflict,
        };
      }
    }
    throw new Error("Could not create scan request");
  }

  async getByPublicId(publicId: string) {
    const [request] = await this.db
      .select()
      .from(scanRequests)
      .where(eq(scanRequests.publicId, publicId))
      .limit(1);
    return request ?? null;
  }

  /**
   * Low-level lookup that does not compare request payloads. API handlers should use
   * resolveApiIdempotency plus admitApiRequest so a reused key cannot bypass conflict
   * detection or reserve hourly cost twice.
   */
  async getByApiIdempotency(apiKeyId: string, idempotencyKey: string) {
    const idempotencyKeyHash = hashOpaqueToken(idempotencyKey);
    const [request] = await this.db
      .select()
      .from(scanRequests)
      .where(
        and(
          eq(scanRequests.apiKeyId, apiKeyId),
          eq(scanRequests.idempotencyKeyHash, idempotencyKeyHash),
        ),
      )
      .limit(1);
    return request ?? null;
  }

  async resolveApiIdempotency(input: {
    apiKeyId: string;
    idempotencyKey: string;
    request: NextMoveRequest;
    projectContextVersionId?: string;
  }): Promise<ResolveApiIdempotencyResult> {
    const request = await this.getByApiIdempotency(input.apiKeyId, input.idempotencyKey);
    return request
      ? resolveStoredIdempotency(request, input.request, input.projectContextVersionId)
      : null;
  }

  /**
   * Serializes rolling-hour cost admission per API key. The idempotency lookup,
   * conservative cost calculation, and request insert all happen while the API
   * key row is locked, so parallel submissions cannot each spend the same
   * remaining allowance. A replay returns before cost is reserved again.
   */
  async admitApiRequest(input: {
    apiKeyId: string;
    idempotencyKey: string;
    request: NextMoveRequest;
    projectId?: string;
    projectContextVersionId?: string;
    requesterFingerprintHash?: string;
    costReservationUsd: number;
    since: Date;
    now: Date;
  }): Promise<AdmitApiScanRequestResult> {
    if (!input.idempotencyKey.trim()) {
      throw new Error("API scan admission requires an idempotency key");
    }
    if (!isFiniteNonnegative(input.costReservationUsd)) {
      throw new Error("API scan cost reservations must be finite and non-negative");
    }
    if (
      Number.isNaN(input.since.getTime()) ||
      Number.isNaN(input.now.getTime()) ||
      input.since > input.now
    ) {
      throw new Error("API scan admission requires a valid rolling-hour window");
    }

    const idempotencyKeyHash = hashOpaqueToken(input.idempotencyKey);
    const requestPayloadHash = digestNextMoveRequestWithContext(
      input.request,
      input.projectContextVersionId,
    );
    const reservationMicros = toUsdMicros(input.costReservationUsd, "nearest");

    return this.db.transaction(async (tx) => {
      if (input.projectId) {
        await lockProjectEntitlementScope(tx as unknown as TrendsFastDatabase, input.projectId);
        const [project] = await tx
          .select({
            id: projects.id,
            normalizedUrl: projects.normalizedUrl,
            status: projects.status,
          })
          .from(projects)
          .where(eq(projects.id, input.projectId))
          .limit(1);
        if (
          !project ||
          project.status !== "ACTIVE" ||
          project.normalizedUrl !== normalizeProductUrl(input.request.product_url)
        ) {
          return { status: "PROJECT_MISMATCH" as const };
        }
      }
      if (input.projectContextVersionId && !input.projectId) {
        throw new Error("A pinned project context requires a project-scoped API request");
      }
      if (input.projectContextVersionId) {
        const [pinnedContext] = await tx
          .select({ id: projectContextVersions.id })
          .from(projectContextVersions)
          .where(
            and(
              eq(projectContextVersions.id, input.projectContextVersionId),
              eq(projectContextVersions.projectId, input.projectId!),
              eq(projectContextVersions.isCurrent, true),
            ),
          )
          .limit(1);
        if (!pinnedContext) {
          throw new Error("The claimed-project context changed before API admission");
        }
      }
      const [apiKey] = await tx
        .select({
          id: apiKeys.id,
          environment: apiKeys.environment,
          projectId: apiKeys.projectId,
          providerCostLimitUsd: apiKeys.providerCostLimitUsd,
          status: apiKeys.status,
          revokedAt: apiKeys.revokedAt,
          expiresAt: apiKeys.expiresAt,
        })
        .from(apiKeys)
        .where(eq(apiKeys.id, input.apiKeyId))
        .limit(1)
        .for("update");
      if (!apiKey) throw new Error("API scan admission requires an existing API key");
      if (
        apiKey.status !== "ACTIVE" ||
        apiKey.revokedAt !== null ||
        (apiKey.expiresAt !== null && apiKey.expiresAt <= input.now)
      ) {
        return { status: "KEY_INACTIVE" as const };
      }
      if ((apiKey.projectId ?? undefined) !== input.projectId) {
        throw new Error("API scan admission project does not match the API key");
      }
      if (apiKey.environment === "live" && !apiKey.projectId) {
        return { status: "USAGE_LIMITED" as const, reason: "ENTITLEMENT_INACTIVE" as const };
      }

      const [existing] = await tx
        .select()
        .from(scanRequests)
        .where(
          and(
            eq(scanRequests.apiKeyId, input.apiKeyId),
            eq(scanRequests.idempotencyKeyHash, idempotencyKeyHash),
          ),
        )
        .limit(1);
      if (existing) {
        const resolved = resolveStoredIdempotency(
          existing,
          input.request,
          input.projectContextVersionId,
        );
        return resolved.idempotencyConflict
          ? { status: "IDEMPOTENCY_CONFLICT" as const, request: existing }
          : { status: "REUSED" as const, request: existing };
      }

      const activeReservations = await tx
        .select({
          requestId: scanRequests.id,
          reservationUsd: scanRequests.apiCostReservationUsd,
        })
        .from(scanRequests)
        .where(
          and(
            eq(scanRequests.apiKeyId, input.apiKeyId),
            gte(scanRequests.submittedAt, input.since),
          ),
        );
      const recentRunCosts = await tx
        .select({
          requestId: scanRequests.id,
          committedRunCostUsd: sum(
            sql`greatest(${scanRuns.estimatedCostUsd}, ${scanRuns.actualCostUsd})`,
          ),
        })
        .from(scanRuns)
        .innerJoin(scanRequests, eq(scanRuns.scanRequestId, scanRequests.id))
        .where(and(eq(scanRequests.apiKeyId, input.apiKeyId), gte(scanRuns.createdAt, input.since)))
        .groupBy(scanRequests.id);

      const committedByRequest = new Map<string, number>();
      for (const reservation of activeReservations) {
        committedByRequest.set(
          reservation.requestId,
          toUsdMicros(Number(reservation.reservationUsd), "nearest"),
        );
      }
      for (const runCost of recentRunCosts) {
        const runCostMicros = toUsdMicros(Number(runCost.committedRunCostUsd ?? 0), "nearest");
        committedByRequest.set(
          runCost.requestId,
          Math.max(committedByRequest.get(runCost.requestId) ?? 0, runCostMicros),
        );
      }
      const committedCostMicros = [...committedByRequest.values()].reduce(
        (total, value) => total + value,
        0,
      );
      const projectedCostMicros = committedCostMicros + reservationMicros;
      if (
        !Number.isSafeInteger(committedCostMicros) ||
        !Number.isSafeInteger(projectedCostMicros)
      ) {
        throw new Error("API scan cost admission exceeded its safe numeric range");
      }
      const maximumCostUsd = Number(apiKey.providerCostLimitUsd);
      if (!isFiniteNonnegative(maximumCostUsd)) {
        throw new Error("API key cost limit must be finite and non-negative");
      }
      if (projectedCostMicros > toUsdMicros(maximumCostUsd, "floor")) {
        return {
          status: "COST_LIMITED" as const,
          committedCostUsd: committedCostMicros / USD_MICROS,
          projectedCostUsd: projectedCostMicros / USD_MICROS,
          maximumCostUsd,
        };
      }

      let founderUsageEventId: string | null = null;
      if (apiKey.environment === "live" && apiKey.projectId) {
        const usage = await admitFounderUsage(tx as unknown as TrendsFastDatabase, {
          projectId: apiKey.projectId,
          kind: "ON_DEMAND_RUN_ACCEPTED",
          idempotencyKey: `api:${input.apiKeyId}:${idempotencyKeyHash}`,
          occurredAt: input.now,
        });
        if (usage.status === "LIMITED") {
          return {
            status: "USAGE_LIMITED" as const,
            reason:
              usage.reason === "ON_DEMAND_MONTHLY_LIMIT"
                ? "ON_DEMAND_MONTHLY_LIMIT"
                : "ENTITLEMENT_INACTIVE",
          };
        }
        founderUsageEventId = usage.event.id;
      }

      const [created] = await tx
        .insert(scanRequests)
        .values({
          publicId: createPublicScanToken(),
          projectId: input.projectId ?? null,
          apiKeyId: input.apiKeyId,
          origin: "API",
          state: "QUEUED",
          submittedUrl: input.request.product_url,
          normalizedUrl: normalizeProductUrl(input.request.product_url),
          goal: input.request.objective ?? input.request.goal ?? null,
          market: input.request.market ?? null,
          language: input.request.language ?? null,
          preferredChannels: input.request.preferred_channels ?? null,
          availableFormats: input.request.available_formats ?? null,
          generationLevel: input.request.generation_level ?? "brief",
          requestedContentCapabilities: input.request.content_capabilities ?? null,
          idempotencyKeyHash,
          requestPayloadHash,
          requesterFingerprintHash: input.requesterFingerprintHash ?? null,
          apiCostReservationUsd: input.costReservationUsd.toFixed(6),
          submittedAt: input.now,
        })
        .returning();
      if (!created) throw new Error("Could not atomically admit the API scan request");
      if (founderUsageEventId) {
        await tx
          .update(founderUsageEvents)
          .set({ scanRequestId: created.id })
          .where(eq(founderUsageEvents.id, founderUsageEventId));
      }
      if (input.projectContextVersionId) {
        const [queuedRun] = await tx
          .insert(scanRuns)
          .values({
            scanRequestId: created.id,
            projectContextVersionId: input.projectContextVersionId,
            attempt: 1,
            state: "QUEUED",
          })
          .returning({ id: scanRuns.id });
        if (!queuedRun) throw new Error("Could not pin the claimed-project context version");
      }
      return { status: "CREATED" as const, request: created };
    });
  }

  async getStatusByPublicId(publicId: string) {
    const request = await this.getByPublicId(publicId);
    if (!request) return null;
    const run = await this.getLatestRun(request.id);
    const [move] = await this.db
      .select()
      .from(nextMoves)
      .where(eq(nextMoves.scanRequestId, request.id))
      .orderBy(desc(nextMoves.createdAt))
      .limit(1);
    if (!move) {
      return {
        request,
        run,
        move: null,
        context: null,
        project: null,
        delivery: null,
        evidence: [],
      };
    }
    const [contextRow] = await this.db
      .select({ context: projectContextVersions.context, project: projects })
      .from(projectContextVersions)
      .innerJoin(projects, eq(projectContextVersions.projectId, projects.id))
      .where(eq(projectContextVersions.id, move.projectContextVersionId))
      .limit(1);
    const evidence = await this.db
      .select()
      .from(evidenceReceipts)
      .where(
        and(
          eq(evidenceReceipts.nextMoveId, move.id),
          eq(evidenceReceipts.moveVersion, move.reviewVersion),
        ),
      );
    const [delivery] = await this.db
      .select()
      .from(deliveryTokens)
      .where(eq(deliveryTokens.nextMoveId, move.id))
      .orderBy(desc(deliveryTokens.createdAt))
      .limit(1);
    return {
      request,
      run,
      move,
      context: contextRow?.context ?? null,
      project: contextRow?.project ?? null,
      delivery: delivery ?? null,
      evidence,
    };
  }

  /**
   * Capability-safe status projection for the anonymous/API data plane.
   * Keep the run projection deliberately free of model payloads, failures,
   * fences, and monetary fields; founder ops uses getStatusByPublicId instead.
   */
  async getPublicStatusByPublicId(publicId: string) {
    const request = await this.getByPublicId(publicId);
    if (!request) return null;
    const [run] = await this.db
      .select({
        id: scanRuns.id,
        scanRequestId: scanRuns.scanRequestId,
        attempt: scanRuns.attempt,
        queryPlan: scanRuns.queryPlan,
      })
      .from(scanRuns)
      .where(eq(scanRuns.scanRequestId, request.id))
      .orderBy(desc(scanRuns.attempt))
      .limit(1);
    const [move] = await this.db
      .select()
      .from(nextMoves)
      .where(eq(nextMoves.scanRequestId, request.id))
      .orderBy(desc(nextMoves.createdAt))
      .limit(1);
    if (!move) {
      return {
        request,
        run: run ?? null,
        move: null,
        context: null,
        project: null,
        delivery: null,
        evidence: [],
      };
    }
    const [contextRow] = await this.db
      .select({ context: projectContextVersions.context, project: projects })
      .from(projectContextVersions)
      .innerJoin(projects, eq(projectContextVersions.projectId, projects.id))
      .where(eq(projectContextVersions.id, move.projectContextVersionId))
      .limit(1);
    const evidence = await this.db
      .select()
      .from(evidenceReceipts)
      .where(
        and(
          eq(evidenceReceipts.nextMoveId, move.id),
          eq(evidenceReceipts.moveVersion, move.reviewVersion),
        ),
      );
    const [delivery] = await this.db
      .select()
      .from(deliveryTokens)
      .where(eq(deliveryTokens.nextMoveId, move.id))
      .orderBy(desc(deliveryTokens.createdAt))
      .limit(1);
    return {
      request,
      run: run ?? null,
      move,
      context: contextRow?.context ?? null,
      project: contextRow?.project ?? null,
      delivery: delivery ?? null,
      evidence,
    };
  }

  /**
   * Serializes free-scan admission per anonymous fingerprint so parallel
   * requests cannot race the daily cap or duplicate suppression checks.
   */
  async admitPublicRequest(input: {
    submittedUrl: string;
    normalizedUrl: string;
    requesterFingerprintHash: string;
    anonymousSessionHash?: string;
    since: Date;
    dailyLimit: number;
    globalSince: Date;
    globalDailyLimit: number;
    globalDailyBudgetUsd: number;
    costReservationUsd: number;
    now: Date;
  }): Promise<AdmitPublicScanRequestResult> {
    const normalizedUrl = normalizeProductUrl(input.submittedUrl);
    if (normalizedUrl !== input.normalizedUrl) {
      throw new Error("Public scan URL normalization did not match the repository");
    }
    if (
      Number.isNaN(input.since.getTime()) ||
      Number.isNaN(input.globalSince.getTime()) ||
      Number.isNaN(input.now.getTime()) ||
      input.globalSince > input.now ||
      input.since > input.now
    ) {
      throw new Error("Public scan admission requires a valid time window");
    }
    if (!Number.isSafeInteger(input.dailyLimit) || input.dailyLimit < 1) {
      throw new Error("Public scan admission requires a positive daily limit");
    }
    if (!Number.isSafeInteger(input.globalDailyLimit) || input.globalDailyLimit < 1) {
      throw new Error("Public scan admission requires a positive global daily limit");
    }
    if (
      !isFiniteNonnegative(input.globalDailyBudgetUsd) ||
      !isFiniteNonnegative(input.costReservationUsd)
    ) {
      throw new Error("Public scan admission requires finite non-negative cost limits");
    }
    const dailyLimit = input.dailyLimit;
    const reservationMicros = toUsdMicros(input.costReservationUsd, "nearest");
    const globalUntil = new Date(input.globalSince.getTime() + 86_400_000);

    return this.db.transaction(async (tx) => {
      const recordSubmission = async (scanRequestId: string, reused: boolean) => {
        await tx.insert(analyticsEvents).values({
          name: "free_scan_submitted",
          anonymousSessionHash: input.anonymousSessionHash ?? null,
          scanRequestId,
          properties: { reused },
          occurredAt: input.now,
        });
      };
      const globalLockKey = `trendsfast:public-scan:${input.globalSince.toISOString()}`;
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${globalLockKey}, 0))`);
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${input.requesterFingerprintHash}, 0))`,
      );
      const [recent] = await tx
        .select({ value: count() })
        .from(analyticsEvents)
        .innerJoin(scanRequests, eq(analyticsEvents.scanRequestId, scanRequests.id))
        .where(
          and(
            eq(analyticsEvents.name, "free_scan_submitted"),
            gte(analyticsEvents.occurredAt, input.since),
            eq(scanRequests.requesterFingerprintHash, input.requesterFingerprintHash),
          ),
        );
      if ((recent?.value ?? 0) >= dailyLimit) return { status: "RATE_LIMITED" as const };

      const [duplicate] = input.anonymousSessionHash
        ? await tx
            .select({ id: scanRequests.id, publicId: scanRequests.publicId })
            .from(scanRequests)
            .innerJoin(
              analyticsEvents,
              and(
                eq(analyticsEvents.scanRequestId, scanRequests.id),
                eq(analyticsEvents.name, "free_scan_submitted"),
                eq(analyticsEvents.anonymousSessionHash, input.anonymousSessionHash),
              ),
            )
            .where(
              and(
                eq(scanRequests.requesterFingerprintHash, input.requesterFingerprintHash),
                eq(scanRequests.normalizedUrl, normalizedUrl),
                gte(scanRequests.submittedAt, input.since),
              ),
            )
            .orderBy(desc(scanRequests.submittedAt))
            .limit(1)
        : [];
      if (duplicate) {
        await recordSubmission(duplicate.id, true);
        return {
          status: "REUSED" as const,
          scanRequestId: duplicate.id,
          publicToken: duplicate.publicId,
        };
      }

      // A public scan is a project-creation path, not an anonymous refresh of
      // an existing workspace. The global admission lock serializes parallel
      // fingerprints so a second caller cannot queue work for the same URL.
      const [[existingRequest], [existingProject]] = await Promise.all([
        tx
          .select({ id: scanRequests.id })
          .from(scanRequests)
          .where(eq(scanRequests.normalizedUrl, normalizedUrl))
          .limit(1),
        tx
          .select({ id: projects.id })
          .from(projects)
          .where(eq(projects.normalizedUrl, normalizedUrl))
          .limit(1),
      ]);
      if (existingRequest || existingProject) {
        return { status: "PROJECT_ALREADY_EXISTS" as const };
      }

      const publicReservations = await tx
        .select({
          requestId: scanRequests.id,
          reservationUsd: scanRequests.publicCostReservationUsd,
        })
        .from(scanRequests)
        .where(
          and(
            eq(scanRequests.origin, "PUBLIC_FORM"),
            gte(scanRequests.submittedAt, input.globalSince),
            lt(scanRequests.submittedAt, globalUntil),
          ),
        );
      const admittedCount = publicReservations.length;
      const publicRunCosts = await tx
        .select({
          requestId: scanRequests.id,
          committedRunCostUsd: sum(
            sql`greatest(${scanRuns.estimatedCostUsd}, ${scanRuns.actualCostUsd})`,
          ),
        })
        .from(scanRuns)
        .innerJoin(scanRequests, eq(scanRuns.scanRequestId, scanRequests.id))
        .where(
          and(
            eq(scanRequests.origin, "PUBLIC_FORM"),
            gte(scanRequests.submittedAt, input.globalSince),
            lt(scanRequests.submittedAt, globalUntil),
          ),
        )
        .groupBy(scanRequests.id);
      const committedByRequest = new Map<string, number>();
      for (const reservation of publicReservations) {
        committedByRequest.set(
          reservation.requestId,
          toUsdMicros(Number(reservation.reservationUsd), "nearest"),
        );
      }
      for (const runCost of publicRunCosts) {
        const actualMicros = toUsdMicros(Number(runCost.committedRunCostUsd ?? 0), "nearest");
        committedByRequest.set(
          runCost.requestId,
          Math.max(committedByRequest.get(runCost.requestId) ?? 0, actualMicros),
        );
      }
      const committedMicros = [...committedByRequest.values()].reduce(
        (total, value) => total + value,
        0,
      );
      const projectedMicros = committedMicros + reservationMicros;
      const capacity = {
        admittedCount,
        dailyLimit: input.globalDailyLimit,
        committedCostUsd: committedMicros / USD_MICROS,
        projectedCostUsd: projectedMicros / USD_MICROS,
        dailyBudgetUsd: input.globalDailyBudgetUsd,
      };
      if (admittedCount >= input.globalDailyLimit) {
        return { status: "GLOBAL_CAPACITY_REACHED" as const, ...capacity };
      }
      if (projectedMicros > toUsdMicros(input.globalDailyBudgetUsd, "floor")) {
        return { status: "GLOBAL_BUDGET_REACHED" as const, ...capacity };
      }

      const [created] = await tx
        .insert(scanRequests)
        .values({
          publicId: createPublicScanToken(),
          origin: "PUBLIC_FORM",
          state: "QUEUED",
          submittedUrl: input.submittedUrl,
          normalizedUrl,
          requestPayloadHash: digestNextMoveRequest({ product_url: input.submittedUrl }),
          requesterFingerprintHash: input.requesterFingerprintHash,
          publicCostReservationUsd: input.costReservationUsd.toFixed(6),
          submittedAt: input.now,
        })
        .returning();
      if (!created) throw new Error("Could not create public scan request");
      await recordSubmission(created.id, false);
      return {
        status: "CREATED" as const,
        scanRequestId: created.id,
        publicToken: created.publicId,
      };
    });
  }

  async countRecentByFingerprint(requesterFingerprintHash: string, since: Date): Promise<number> {
    const [result] = await this.db
      .select({ value: count() })
      .from(scanRequests)
      .where(
        and(
          eq(scanRequests.requesterFingerprintHash, requesterFingerprintHash),
          gte(scanRequests.submittedAt, since),
        ),
      );
    return result?.value ?? 0;
  }

  async create(input: {
    submittedUrl: string;
    normalizedUrl: string;
    requesterFingerprintHash: string;
  }): Promise<{ scanRequestId: string; publicToken: string }> {
    const created = await this.createRequest({
      request: { product_url: input.submittedUrl },
      origin: "PUBLIC_FORM",
      requesterFingerprintHash: input.requesterFingerprintHash,
    });
    if (created.request.normalizedUrl !== input.normalizedUrl) {
      throw new Error("Public scan URL normalization did not match the repository");
    }
    return {
      scanRequestId: created.request.id,
      publicToken: created.request.publicId,
    };
  }

  async findRecentDuplicate(input: {
    fingerprintHash: string;
    normalizedUrl: string;
    since: Date;
  }) {
    const [request] = await this.db
      .select()
      .from(scanRequests)
      .where(
        and(
          eq(scanRequests.requesterFingerprintHash, input.fingerprintHash),
          eq(scanRequests.normalizedUrl, input.normalizedUrl),
          gte(scanRequests.submittedAt, input.since),
        ),
      )
      .orderBy(desc(scanRequests.submittedAt))
      .limit(1);
    return request
      ? {
          ...request,
          scanRequestId: request.id,
          publicToken: request.publicId,
        }
      : null;
  }

  async getLatestRun(scanRequestId: string) {
    const [run] = await this.db
      .select()
      .from(scanRuns)
      .where(eq(scanRuns.scanRequestId, scanRequestId))
      .orderBy(desc(scanRuns.attempt))
      .limit(1);
    return run ?? null;
  }

  async claimForProcessing(publicId: string, deadline: Date) {
    const now = new Date();
    if (Number.isNaN(deadline.getTime()) || deadline <= now) {
      throw new Error("A processing claim requires a future deadline");
    }

    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM scan_requests WHERE public_id = ${publicId} FOR UPDATE`);
      const [request] = await tx
        .select()
        .from(scanRequests)
        .where(eq(scanRequests.publicId, publicId))
        .limit(1);
      if (!request) throw new Error("Scan request was not found");

      const [latestRun] = await tx
        .select()
        .from(scanRuns)
        .where(eq(scanRuns.scanRequestId, request.id))
        .orderBy(desc(scanRuns.attempt))
        .limit(1);
      if (latestRun) {
        await tx.execute(sql`SELECT id FROM scan_runs WHERE id = ${latestRun.id} FOR UPDATE`);
      }

      const decision = decideScanClaim(request.state, latestRun ?? null, now);
      if (decision === "NOT_CLAIMABLE") {
        return {
          claimed: false as const,
          claimStatus: "NOT_CLAIMABLE" as const,
          request,
          run: latestRun ?? null,
        };
      }
      if (decision === "ALREADY_CLAIMED") {
        return {
          claimed: false as const,
          claimStatus: "ALREADY_CLAIMED" as const,
          request,
          run: latestRun,
        };
      }

      let run = latestRun;
      const processingFence = createPrefixedId("fence");
      if (decision === "CLAIM_NEW_RUN") {
        const [currentProjectContext] = request.projectId
          ? await tx
              .select({ id: projectContextVersions.id })
              .from(projectContextVersions)
              .where(
                and(
                  eq(projectContextVersions.projectId, request.projectId),
                  eq(projectContextVersions.isCurrent, true),
                ),
              )
              .limit(1)
              .for("update")
          : [];
        const [attemptRow] = await tx
          .select({ latest: max(scanRuns.attempt) })
          .from(scanRuns)
          .where(eq(scanRuns.scanRequestId, request.id));
        const [created] = await tx
          .insert(scanRuns)
          .values({
            scanRequestId: request.id,
            projectContextVersionId: currentProjectContext?.id ?? null,
            attempt: (attemptRow?.latest ?? 0) + 1,
            state: "RUNNING",
            hardDeadlineAt: deadline,
            processingFence,
            startedAt: now,
          })
          .returning();
        if (!created) throw new Error("Could not create claimed scan run");
        run = created;
      } else {
        if (!run) throw new Error("A resumable claim is missing its scan run");
        if (run.projectContextVersionId) {
          const [pinnedContext] = await tx
            .select({ id: projectContextVersions.id })
            .from(projectContextVersions)
            .where(
              and(
                eq(projectContextVersions.id, run.projectContextVersionId),
                request.projectId
                  ? eq(projectContextVersions.projectId, request.projectId)
                  : sql`true`,
              ),
            )
            .limit(1)
            .for("update");
          if (!pinnedContext) throw new Error("The pinned project context is unavailable");
        }
        const [renewed] = await tx
          .update(scanRuns)
          .set({
            state: "RUNNING",
            hardDeadlineAt: run.hardDeadlineAt ?? deadline,
            processingFence,
            startedAt: run.startedAt ?? now,
            updatedAt: now,
          })
          .where(eq(scanRuns.id, run.id))
          .returning();
        if (!renewed) throw new Error("Could not renew scan processing claim");
        run = renewed;
      }

      const [claimedRequest] = await tx
        .update(scanRequests)
        .set({
          state: "RUNNING",
          startedAt: request.startedAt ?? now,
          updatedAt: now,
          completedAt: null,
          failureCode: null,
          failureMessage: null,
        })
        .where(eq(scanRequests.id, request.id))
        .returning();
      if (!claimedRequest) throw new Error("Could not claim scan request");
      return {
        claimed: true as const,
        claimStatus: "CLAIMED" as const,
        request: claimedRequest,
        run,
      };
    });
  }

  /**
   * Holds the scan-run row lock for an entire processing mutation. Claim
   * renewal takes the same lock, so either the old mutation commits first or
   * the renewed claim rotates the fence and the stale mutation is rejected.
   */
  async withProcessingFence<T>(
    input: { requestId: string; scanRunId: string; processingFence: string },
    operation: (db: TrendsFastDatabase) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM scan_requests WHERE id = ${input.requestId} FOR UPDATE`);
      await tx.execute(sql`SELECT id FROM scan_runs WHERE id = ${input.scanRunId} FOR UPDATE`);
      const [run] = await tx
        .select()
        .from(scanRuns)
        .where(eq(scanRuns.id, input.scanRunId))
        .limit(1);
      if (
        !run ||
        run.scanRequestId !== input.requestId ||
        run.state !== "RUNNING" ||
        run.processingFence !== input.processingFence ||
        (run.hardDeadlineAt !== null && run.hardDeadlineAt <= new Date())
      ) {
        throw new ProcessingFenceError();
      }
      return operation(tx as unknown as TrendsFastDatabase);
    });
  }

  async requeueFailed(publicId: string) {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM scan_requests WHERE public_id = ${publicId} FOR UPDATE`);
      const [request] = await tx
        .update(scanRequests)
        .set({
          state: "QUEUED",
          completedAt: null,
          failureCode: null,
          failureMessage: null,
          updatedAt: new Date(),
        })
        .where(and(eq(scanRequests.publicId, publicId), eq(scanRequests.state, "FAILED")))
        .returning();
      if (!request) throw new Error("Only a failed scan can be explicitly requeued");
      return request;
    });
  }

  async requireReview(input: {
    requestId: string;
    scanRunId: string;
    processingFence: string;
    signalClass: SignalClass;
  }) {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM scan_requests WHERE id = ${input.requestId} FOR UPDATE`);
      await tx.execute(sql`SELECT id FROM scan_runs WHERE id = ${input.scanRunId} FOR UPDATE`);
      const [request] = await tx
        .select()
        .from(scanRequests)
        .where(eq(scanRequests.id, input.requestId))
        .limit(1);
      const [run] = await tx
        .select()
        .from(scanRuns)
        .where(eq(scanRuns.id, input.scanRunId))
        .limit(1);
      if (!request || !run || run.scanRequestId !== request.id) {
        throw new Error("Scan lifecycle pair was not found");
      }
      if (
        run.processingFence !== input.processingFence ||
        (run.hardDeadlineAt !== null && run.hardDeadlineAt <= new Date())
      ) {
        throw new ProcessingFenceError();
      }
      if (request.state === "REVIEW_REQUIRED" && run.state === "REVIEW_REQUIRED") {
        if (run.signalClass && run.signalClass !== input.signalClass) {
          throw new Error("Review retry used a different signal class");
        }
        return { changed: false as const, request, run };
      }
      if (
        !["RUNNING", "REVIEW_REQUIRED"].includes(request.state) ||
        !["RUNNING", "REVIEW_REQUIRED"].includes(run.state)
      ) {
        throw new Error("Only a running scan can require founder review");
      }

      const now = new Date();
      const [updatedRequest] = await tx
        .update(scanRequests)
        .set({ state: "REVIEW_REQUIRED", updatedAt: now })
        .where(eq(scanRequests.id, request.id))
        .returning();
      const [updatedRun] = await tx
        .update(scanRuns)
        .set({
          state: "REVIEW_REQUIRED",
          signalClass: input.signalClass,
          processingFence: null,
          reviewRequiredAt: run.reviewRequiredAt ?? now,
          updatedAt: now,
        })
        .where(eq(scanRuns.id, run.id))
        .returning();
      if (!updatedRequest || !updatedRun) {
        throw new Error("Could not persist the review-required transition");
      }
      return {
        changed: true as const,
        request: updatedRequest,
        run: updatedRun,
      };
    });
  }

  async failProcessing(input: {
    requestId: string;
    scanRunId: string;
    processingFence: string;
    code: string;
    message: string;
    sourceCoverage?: Record<string, string>;
  }) {
    const failure = sanitizeProcessingFailure(input.code, input.message);
    const sourceCoverage = input.sourceCoverage
      ? (redactRecord(input.sourceCoverage) as Record<string, string>)
      : undefined;
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM scan_requests WHERE id = ${input.requestId} FOR UPDATE`);
      await tx.execute(sql`SELECT id FROM scan_runs WHERE id = ${input.scanRunId} FOR UPDATE`);
      const [request] = await tx
        .select()
        .from(scanRequests)
        .where(eq(scanRequests.id, input.requestId))
        .limit(1);
      const [run] = await tx
        .select()
        .from(scanRuns)
        .where(eq(scanRuns.id, input.scanRunId))
        .limit(1);
      if (!request || !run || run.scanRequestId !== request.id) {
        throw new Error("Scan lifecycle pair was not found");
      }
      if (run.processingFence !== input.processingFence) {
        throw new ProcessingFenceError();
      }
      if (request.state === "FAILED" && run.state === "FAILED") {
        return { changed: false as const, request, run };
      }
      if (
        request.state === "READY" ||
        run.state === "READY" ||
        !["QUEUED", "RUNNING", "REVIEW_REQUIRED", "FAILED"].includes(request.state) ||
        !["QUEUED", "RUNNING", "REVIEW_REQUIRED", "FAILED"].includes(run.state)
      ) {
        throw new Error("A delivered scan cannot be failed");
      }

      const now = new Date();
      const [updatedRequest] = await tx
        .update(scanRequests)
        .set({
          state: "FAILED",
          failureCode: failure.code,
          failureMessage: failure.message,
          completedAt: now,
          updatedAt: now,
        })
        .where(eq(scanRequests.id, request.id))
        .returning();
      const [updatedRun] = await tx
        .update(scanRuns)
        .set({
          state: "FAILED",
          failureCode: failure.code,
          failureMessage: failure.message,
          sourceCoverage,
          processingFence: null,
          completedAt: now,
          updatedAt: now,
        })
        .where(eq(scanRuns.id, run.id))
        .returning();
      if (!updatedRequest || !updatedRun) {
        throw new Error("Could not persist the failed scan transition");
      }
      return {
        changed: true as const,
        request: updatedRequest,
        run: updatedRun,
      };
    });
  }

  async createRun(input: {
    scanRequestId: string;
    projectContextVersionId?: string;
    queryPlan?: QueryPlan;
    hardDeadlineAt?: Date;
  }) {
    return this.db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT id FROM scan_requests WHERE id = ${input.scanRequestId} FOR UPDATE`,
      );
      const [attemptRow] = await tx
        .select({ latest: max(scanRuns.attempt) })
        .from(scanRuns)
        .where(eq(scanRuns.scanRequestId, input.scanRequestId));
      const attempt = (attemptRow?.latest ?? 0) + 1;

      const [run] = await tx
        .insert(scanRuns)
        .values({
          scanRequestId: input.scanRequestId,
          projectContextVersionId: input.projectContextVersionId ?? null,
          attempt,
          state: "QUEUED",
          queryPlan: input.queryPlan ?? null,
          queryPlanVersion: input.queryPlan?.version ?? null,
          hardDeadlineAt: input.hardDeadlineAt ?? null,
        })
        .returning();
      if (!run) throw new Error("Could not create scan run");
      return run;
    });
  }

  async transitionRequest(
    scanRequestId: string,
    expectedState: ScanState,
    nextState: ScanState,
    options: TransitionScanOptions = {},
  ) {
    assertScanStateTransition(expectedState, nextState);
    const now = new Date();
    const [updated] = await this.db
      .update(scanRequests)
      .set({
        state: nextState,
        updatedAt: now,
        startedAt: nextState === "RUNNING" ? now : undefined,
        completedAt: nextState === "READY" || nextState === "FAILED" ? now : undefined,
        failureCode: options.failureCode,
        failureMessage: options.failureMessage
          ? redactSecrets(options.failureMessage).slice(0, 500)
          : undefined,
      })
      .where(and(eq(scanRequests.id, scanRequestId), eq(scanRequests.state, expectedState)))
      .returning();
    if (!updated) {
      throw new Error("Scan state changed concurrently or request was not found");
    }
    return updated;
  }

  async transitionRun(
    scanRunId: string,
    expectedState: ScanState,
    nextState: ScanState,
    options: TransitionScanOptions & { signalClass?: SignalClass } = {},
  ) {
    assertScanStateTransition(expectedState, nextState);
    const now = new Date();
    const [updated] = await this.db
      .update(scanRuns)
      .set({
        state: nextState,
        updatedAt: now,
        startedAt: nextState === "RUNNING" ? now : undefined,
        reviewRequiredAt: nextState === "REVIEW_REQUIRED" ? now : undefined,
        completedAt: nextState === "READY" || nextState === "FAILED" ? now : undefined,
        signalClass: options.signalClass,
        failureCode: options.failureCode,
        failureMessage: options.failureMessage
          ? redactSecrets(options.failureMessage).slice(0, 500)
          : undefined,
      })
      .where(and(eq(scanRuns.id, scanRunId), eq(scanRuns.state, expectedState)))
      .returning();
    if (!updated) {
      throw new Error("Scan run state changed concurrently or run was not found");
    }
    return updated;
  }
}
