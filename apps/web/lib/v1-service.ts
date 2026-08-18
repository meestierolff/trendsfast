import "server-only";

import { loadEnv, resolveApiRateLimit, resolveProviderCosts } from "@trendsfast/config";
import { isMemberConfirmedProjectContext, normalizeProductUrl } from "@trendsfast/database";
import { assertActionDetailsBoundToStoredEvidence, storedSignal } from "@trendsfast/orchestration";
import {
  ActionDetailsSchema,
  BreakoutPotentialSchema,
  ContentCapabilityNameSchema,
  GenerationLevelSchema,
  NEXT_MOVE_CONTRACT_VERSION,
  NextMoveStatusResponseSchema,
  ProjectContextSchema,
  ProjectNextMoveRequestSchema,
  TrendWindowSchema,
  VersionedNextMoveSchema,
  evaluateNextMoveFreshness,
  type NextMoveRequest,
  type NextMoveStatusResponse,
} from "@trendsfast/schemas";

import { anonymizeAddress, clientAddress } from "./request-security";
import { getAuthRepositories, getRepositories } from "./server-database";
import { ApiServiceError, type ApiPrincipal, type V1ApiDependencies } from "./v1-api";

function statusUrl(id: string): string {
  return `${loadEnv().APP_URL.replace(/\/$/, "")}/v1/next-moves/${encodeURIComponent(id)}`;
}

export const FOUNDER_RESULT_HISTORY_MS = 30 * 24 * 60 * 60 * 1_000;

export function isWithinFounderResultHistory(createdAt: Date, now = new Date()): boolean {
  return (
    !Number.isNaN(createdAt.getTime()) &&
    createdAt <= now &&
    createdAt >= new Date(now.getTime() - FOUNDER_RESULT_HISTORY_MS)
  );
}

async function responseFor(
  principal: ApiPrincipal,
  id: string,
): Promise<NextMoveStatusResponse | null> {
  if (id.length < 1 || id.length > 160) return null;
  const status = await getRepositories().scans.getPublicStatusByPublicId(id);
  if (!status) return null;
  const exactApiKey = status.request.apiKeyId === principal.apiKeyId;
  const ownerDashboardRequest =
    status.request.apiKeyId === null &&
    principal.projectId !== undefined &&
    status.request.projectId === principal.projectId;
  if (!exactApiKey && !ownerDashboardRequest) return null;
  if (principal.projectId && status.request.projectId !== principal.projectId) return null;
  if (principal.environment === "live") {
    if (
      !principal.projectId ||
      !(await getRepositories().founderUsage.isProjectEntitled(principal.projectId)) ||
      !isWithinFounderResultHistory(status.request.createdAt)
    ) {
      return null;
    }
  }

  if (status.request.state === "FAILED") {
    return NextMoveStatusResponseSchema.parse({
      id: status.request.publicId,
      status: "FAILED",
      error: {
        code: status.request.failureCode ?? "SCAN_FAILED",
        message: "The scan stopped before a trustworthy recommendation was ready.",
        retryable: false,
      },
    });
  }
  if (status.request.state !== "READY") {
    return NextMoveStatusResponseSchema.parse({
      id: status.request.publicId,
      status: status.request.state,
      status_url: statusUrl(status.request.publicId),
      poll_after_seconds: 30,
    });
  }
  if (
    !status.move ||
    status.move.state !== "READY" ||
    !status.move.founderReviewed ||
    status.move.autoPublish ||
    !status.project
  ) {
    throw new Error("A READY scan is missing its reviewed persisted result");
  }
  if (
    status.move.decisionContractVersion !== NEXT_MOVE_CONTRACT_VERSION ||
    status.move.actionDetails === null ||
    status.move.trendWindow === null ||
    status.move.breakoutPotential === null
  ) {
    return NextMoveStatusResponseSchema.parse({
      id: status.request.publicId,
      status: "FAILED",
      error: {
        code: "NEW_SCAN_REQUIRED",
        message: "This result predates the current decision contract. Request a new scan.",
        retryable: true,
      },
    });
  }
  const context = ProjectContextSchema.parse(status.context);
  const actionDetails = ActionDetailsSchema.parse(status.move.actionDetails);
  const trendWindow = TrendWindowSchema.parse(status.move.trendWindow);
  const breakoutPotential = BreakoutPotentialSchema.parse(status.move.breakoutPotential);
  const generationLevel = GenerationLevelSchema.parse(status.move.generationLevel);
  const validUntil = status.move.validUntil.toISOString();
  const versionedMove = VersionedNextMoveSchema.parse({
    contractVersion: status.move.decisionContractVersion,
    generationLevel,
    action: status.move.action,
    channel: status.move.channel,
    topic: status.move.topic,
    angle: status.move.angle,
    format: status.move.format,
    hook: status.move.hook,
    outline: status.move.outline,
    cta: status.move.cta,
    priority: status.move.priority,
    confidence: Number(status.move.confidence),
    validUntil,
    trendWindow,
    breakoutPotential,
    details: actionDetails,
    ...(status.move.draftContent === null ? {} : { draftContent: status.move.draftContent }),
  });
  const signalRows = await getRepositories().scanData.listPublicSignalsForRun(
    status.move.scanRunId,
  );
  const storedSignals = signalRows.map(storedSignal);
  const evidenceSignalIds = status.evidence
    .filter((receipt) => receipt.bindingRole === "DECISION_SUPPORT")
    .map((receipt) => receipt.signalId);
  assertActionDetailsBoundToStoredEvidence({
    details: versionedMove.details,
    evidenceSignalIds,
    storedSignals,
  });
  const freshness = evaluateNextMoveFreshness({
    validUntil,
    proposalStale: status.move.proposalStale,
  });
  return NextMoveStatusResponseSchema.parse({
    id: status.request.publicId,
    status: "READY",
    contract_version: versionedMove.contractVersion,
    generation_level: versionedMove.generationLevel,
    project: {
      name: context.name,
      url: status.project.url,
      audience: context.audience,
      problem: context.problem,
      credible_topics: context.credibleTopics,
      assumptions: context.assumptions,
    },
    next_move: {
      action: versionedMove.action,
      channel: versionedMove.channel,
      topic: versionedMove.topic,
      angle: versionedMove.angle,
      format: versionedMove.format,
      hook: versionedMove.hook,
      outline: versionedMove.outline,
      cta: versionedMove.cta,
      priority: versionedMove.priority,
      confidence: versionedMove.confidence,
      valid_until: versionedMove.validUntil,
    },
    action_details: versionedMove.details,
    trend_window: versionedMove.trendWindow,
    breakout_potential: versionedMove.breakoutPotential,
    ...(versionedMove.draftContent === undefined
      ? {}
      : { draft_content: versionedMove.draftContent }),
    freshness,
    why_now: {
      summary: status.move.whyNow,
      signal_class: status.move.signalClass,
      independent_source_count: status.move.independentSourceCount,
      saturation: status.move.saturation,
    },
    evidence: status.evidence.map((receipt) => ({
      source: receipt.source,
      url: receipt.canonicalUrl,
      ...(receipt.title === null ? {} : { title: receipt.title }),
      ...(receipt.publishedAt === null ? {} : { published_at: receipt.publishedAt.toISOString() }),
      observed_at: receipt.observedAt.toISOString(),
      reason: receipt.reason,
      provider: receipt.provider,
      role: receipt.bindingRole,
      verified: receipt.verified,
      availability: receipt.availability,
    })),
    limitations: status.move.limitations,
    founder_reviewed: true,
    auto_publish: false,
  });
}

async function enforceRateLimit(principal: ApiPrincipal, requestKind: "CREATE" | "STATUS") {
  const repositories = getAuthRepositories();
  const env = loadEnv();
  const usage = await repositories.apiKeys.usageSince({
    apiKeyId: principal.apiKeyId,
    since: new Date(Date.now() - 3_600_000),
  });
  const policyLimit = resolveApiRateLimit(
    env,
    requestKind === "CREATE" ? "API_CREATE_RATE_LIMIT_PER_HOUR" : "API_STATUS_RATE_LIMIT_PER_HOUR",
  );
  const configuredLimit =
    requestKind === "CREATE"
      ? Math.min(principal.rateLimitPerHour ?? policyLimit, policyLimit)
      : policyLimit;
  const used = requestKind === "CREATE" ? usage.createRequests : usage.statusRequests;
  const admitted = principal.requestId
    ? await repositories.apiKeys.admitAuthenticatedRequest({
        apiKeyId: principal.apiKeyId,
        requestId: principal.requestId,
        requestKind,
        since: new Date(Date.now() - 3_600_000),
        maximum: configuredLimit,
      })
    : used <= configuredLimit;
  if (admitted) return;
  if (!principal.requestId) {
    await repositories.apiKeys.recordLimited({
      apiKeyId: principal.apiKeyId,
      presentedPrefix: principal.visiblePrefix ?? "unknown",
      outcome: "RATE_LIMITED",
      requestKind,
      ...(principal.requesterFingerprintHash
        ? { requesterFingerprintHash: principal.requesterFingerprintHash }
        : {}),
    });
  }
  throw new ApiServiceError("RATE_LIMITED", "The API key hourly request limit was reached.");
}

async function assertProjectRestriction(principal: ApiPrincipal, request: NextMoveRequest) {
  if (!principal.projectId) {
    throw new ApiServiceError("FORBIDDEN", "Next Move creation requires a project-scoped API key.");
  }
  const project = await getRepositories().scanData.getProject(principal.projectId);
  if (!project || normalizeProductUrl(request.product_url) !== project.normalizedUrl) {
    throw new ApiServiceError("FORBIDDEN", "This API key is restricted to a different project.");
  }
}

export function createV1Service(input: { schedule(publicId: string): void }): V1ApiDependencies {
  const initialEnv = loadEnv();
  const providerCredentialMode = initialEnv.PROVIDER_CREDENTIAL_MODE;
  const service: V1ApiDependencies = {
    providerCredentialMode,
    liveApiCreationEnabled: initialEnv.LIVE_API_CREATION_ENABLED,
    async admitAuthenticationAttempt(request) {
      const env = loadEnv();
      let authFailureLimit: number;
      try {
        authFailureLimit = resolveApiRateLimit(env, "API_AUTH_FAILURE_LIMIT_PER_HOUR");
      } catch {
        return false;
      }
      const pepper = env.API_KEY_PEPPER ?? env.SESSION_SECRET;
      if (!pepper || pepper.length < 32) return false;
      const repositories = getAuthRepositories();
      const fingerprintHash = anonymizeAddress(clientAddress(request.headers), pepper);
      const since = new Date(Date.now() - 3_600_000);
      if (
        (await repositories.apiKeys.failedAuthenticationAttemptsSince({
          requesterFingerprintHash: fingerprintHash,
          since,
        })) >= authFailureLimit
      ) {
        return "AUTH_FAILURE_LIMITED" as const;
      }
      return repositories.authAdmission.admit({
        namespace: "v1",
        fingerprintHash,
      });
    },
    async recordAuthenticationFailure(request) {
      const env = loadEnv();
      const pepper = env.API_KEY_PEPPER ?? env.SESSION_SECRET;
      if (!pepper || pepper.length < 32) return false;
      let maximum: number;
      try {
        maximum = resolveApiRateLimit(env, "API_AUTH_FAILURE_LIMIT_PER_HOUR");
      } catch {
        return false;
      }
      return getRepositories().authAdmission.admit({
        namespace: "v1-failure",
        fingerprintHash: anonymizeAddress(clientAddress(request.headers), pepper),
        windowMs: 3_600_000,
        maxAttemptsPerFingerprint: maximum,
        maxAttemptsGlobal: Math.max(maximum, maximum * 100),
      });
    },
    async authenticate(rawKey, metadata) {
      const env = loadEnv();
      const pepper = env.API_KEY_PEPPER ?? env.SESSION_SECRET;
      const requesterFingerprintHash =
        pepper && metadata
          ? anonymizeAddress(clientAddress(metadata.request.headers), pepper)
          : undefined;
      const authenticated = await getAuthRepositories().apiKeys.authenticate({
        rawKey,
        requestKind: metadata?.requestKind ?? "OTHER",
        ...(requesterFingerprintHash ? { requesterFingerprintHash } : {}),
        ...(metadata?.requestId ? { requestId: metadata.requestId } : {}),
      });
      if (!authenticated.ok) return null;
      return {
        apiKeyId: authenticated.apiKey.id,
        environment: authenticated.apiKey.environment,
        scopes: authenticated.apiKey.scopes,
        ...(authenticated.apiKey.projectId ? { projectId: authenticated.apiKey.projectId } : {}),
        visiblePrefix: authenticated.apiKey.visiblePrefix,
        rateLimitPerHour: authenticated.apiKey.rateLimitPerHour,
        providerCostLimitUsd: Number(authenticated.apiKey.providerCostLimitUsd),
        ...(metadata?.requestId ? { requestId: metadata.requestId } : {}),
        ...(requesterFingerprintHash ? { requesterFingerprintHash } : {}),
      };
    },

    async createOrReuse({ principal, idempotencyKey, request, projectContextVersionId }) {
      const env = loadEnv();
      if (!env.LIVE_API_CREATION_ENABLED) {
        throw new ApiServiceError(
          "UNAVAILABLE",
          "New API research is disabled by the deployment policy.",
        );
      }
      if (env.PROVIDER_CREDENTIAL_MODE !== "fixture" && !env.PROVIDER_CALLS_ENABLED) {
        throw new ApiServiceError(
          "UNAVAILABLE",
          "Provider-backed scan creation is disabled by the deployment policy.",
        );
      }
      if (!principal.projectId) {
        throw new ApiServiceError(
          "FORBIDDEN",
          "Next Move creation requires a project-scoped API key.",
        );
      }
      await enforceRateLimit(principal, "CREATE");
      const repositories = getRepositories();
      const prior = await repositories.scans.resolveApiIdempotency({
        apiKeyId: principal.apiKeyId,
        idempotencyKey,
        request,
        ...(projectContextVersionId ? { projectContextVersionId } : {}),
      });
      if (prior) {
        if (prior.idempotencyConflict) {
          throw new ApiServiceError(
            "CONFLICT",
            "The Idempotency-Key was already used for a different request.",
          );
        }
        if (
          prior.request.origin === "API" &&
          prior.request.state === "QUEUED" &&
          prior.request.startedAt === null &&
          prior.request.completedAt === null &&
          prior.request.failureCode === null &&
          prior.request.failureMessage === null
        ) {
          input.schedule(prior.request.publicId);
        }
        const reused = await responseFor(principal, prior.request.publicId);
        if (!reused)
          throw new ApiServiceError("CONFLICT", "The idempotent request is unavailable.");
        return reused;
      }
      await assertProjectRestriction(principal, request);
      const now = new Date();
      const admitted = await repositories.scans.admitApiRequest({
        apiKeyId: principal.apiKeyId,
        idempotencyKey,
        request,
        ...(principal.projectId ? { projectId: principal.projectId } : {}),
        ...(projectContextVersionId ? { projectContextVersionId } : {}),
        ...(principal.requesterFingerprintHash
          ? { requesterFingerprintHash: principal.requesterFingerprintHash }
          : {}),
        costReservationUsd: resolveProviderCosts(env).maximumProviderCostUsdPerScan,
        since: new Date(now.getTime() - 3_600_000),
        now,
      });
      if (admitted.status === "COST_LIMITED") {
        await getAuthRepositories().apiKeys.recordLimited({
          apiKeyId: principal.apiKeyId,
          presentedPrefix: principal.visiblePrefix ?? "unknown",
          outcome: "COST_LIMITED",
          ...(principal.requestId ? { requestId: principal.requestId } : {}),
          ...(principal.requesterFingerprintHash
            ? { requesterFingerprintHash: principal.requesterFingerprintHash }
            : {}),
        });
        throw new ApiServiceError(
          "COST_LIMITED",
          "The API key provider-cost limit would be exceeded.",
        );
      }
      if (admitted.status === "KEY_INACTIVE") {
        throw new ApiServiceError("FORBIDDEN", "The API key is no longer active.");
      }
      if (admitted.status === "PROJECT_MISMATCH") {
        throw new ApiServiceError(
          "CONFLICT",
          "The saved project URL changed before this request could be admitted.",
        );
      }
      if (admitted.status === "PROJECT_BUSY") {
        throw new ApiServiceError(
          "CONFLICT",
          "Another Next Move request is already queued or running for this project.",
        );
      }
      if (admitted.status === "USAGE_LIMITED") {
        throw new ApiServiceError(
          "USAGE_LIMITED",
          admitted.reason === "ON_DEMAND_MONTHLY_LIMIT"
            ? "The Founder plan's ten accepted on-demand runs for this billing period have been used."
            : "This project does not currently have an active Founder entitlement.",
        );
      }
      if (admitted.status === "IDEMPOTENCY_CONFLICT") {
        throw new ApiServiceError(
          "CONFLICT",
          "The Idempotency-Key was already used for a different request.",
        );
      }
      if (admitted.status === "CREATED") input.schedule(admitted.request.publicId);
      await repositories.analytics
        .append({
          name: "api_request_succeeded",
          scanRequestId: admitted.request.id,
          apiKeyId: principal.apiKeyId,
          properties: { created: admitted.status === "CREATED" },
        })
        .catch(() => undefined);
      const response = await responseFor(principal, admitted.request.publicId);
      if (!response) throw new Error("The accepted API scan could not be reloaded");
      return response;
    },

    async createOrReuseForProject({ principal, projectId, idempotencyKey, request }) {
      if (!principal.projectId || principal.projectId !== projectId) {
        throw new ApiServiceError(
          "FORBIDDEN",
          "The API key is not restricted to this claimed project.",
        );
      }
      const profile = await getRepositories().scanData.getCurrentProjectProfile(projectId);
      if (!profile) {
        throw new ApiServiceError(
          "CONFLICT",
          "The claimed project has no active saved context profile.",
        );
      }
      if (!isMemberConfirmedProjectContext(profile.contextVersion.createdBy)) {
        throw new ApiServiceError(
          "CONFLICT",
          "The saved project context requires founder confirmation before generation.",
        );
      }
      const context = ProjectContextSchema.parse(profile.contextVersion.context);
      const savedCapabilityNames = ContentCapabilityNameSchema.options.filter(
        (name) => profile.contextVersion.contentCapabilities[name],
      );
      const requested = ProjectNextMoveRequestSchema.parse(request);
      const requestedCapabilityNames = requested.content_capabilities ?? savedCapabilityNames;
      const unavailableCapabilities = requestedCapabilityNames.filter(
        (name) => !savedCapabilityNames.includes(name),
      );
      if (unavailableCapabilities.length > 0) {
        throw new ApiServiceError(
          "INVALID_REQUEST",
          "Requested content capabilities must already be enabled in the saved project profile.",
        );
      }
      return service.createOrReuse({
        principal,
        idempotencyKey,
        projectContextVersionId: profile.contextVersion.id,
        request: {
          product_url: profile.project.url,
          objective: requested.objective ?? context.desiredOutcome,
          ...(context.markets[0] === undefined ? {} : { market: context.markets[0] }),
          language: context.language,
          preferred_channels: requested.preferred_channels ?? context.suitableChannels,
          available_formats: context.availableFormats,
          ...(requestedCapabilityNames.length === 0
            ? {}
            : { content_capabilities: requestedCapabilityNames }),
          generation_level: requested.generation_level,
        },
      });
    },

    async getStatus({ principal, id }) {
      await enforceRateLimit(principal, "STATUS");
      return responseFor(principal, id);
    },
  };
  return service;
}
