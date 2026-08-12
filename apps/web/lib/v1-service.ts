import "server-only";

import { loadEnv, resolveProviderCosts } from "@trendsfast/config";
import { normalizeProductUrl } from "@trendsfast/database";
import {
  NextMoveStatusResponseSchema,
  ProjectContextSchema,
  type NextMoveRequest,
  type NextMoveStatusResponse,
} from "@trendsfast/schemas";

import { anonymizeAddress, clientAddress } from "./request-security";
import { getRepositories } from "./server-database";
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
  const status = await getRepositories().scans.getStatusByPublicId(id);
  if (!status || status.request.apiKeyId !== principal.apiKeyId) return null;
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
  const context = ProjectContextSchema.parse(status.context);
  return NextMoveStatusResponseSchema.parse({
    id: status.request.publicId,
    status: "READY",
    project: {
      name: context.name,
      url: status.project.url,
      audience: context.audience,
      problem: context.problem,
      credible_topics: context.credibleTopics,
      assumptions: context.assumptions,
    },
    next_move: {
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
      valid_until: status.move.validUntil.toISOString(),
    },
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
  const repositories = getRepositories();
  const env = loadEnv();
  const usage = await repositories.apiKeys.usageSince({
    apiKeyId: principal.apiKeyId,
    since: new Date(Date.now() - 3_600_000),
  });
  const configuredLimit =
    requestKind === "CREATE"
      ? Math.min(
          principal.rateLimitPerHour ?? env.API_CREATE_RATE_LIMIT_PER_HOUR,
          env.API_CREATE_RATE_LIMIT_PER_HOUR,
        )
      : env.API_STATUS_RATE_LIMIT_PER_HOUR;
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
  if (!principal.projectId) return;
  const project = await getRepositories().scanData.getProject(principal.projectId);
  if (!project || normalizeProductUrl(request.product_url) !== project.normalizedUrl) {
    throw new ApiServiceError("FORBIDDEN", "This API key is restricted to a different project.");
  }
}

export function createV1Service(input: { schedule(publicId: string): void }): V1ApiDependencies {
  const providerCredentialMode = loadEnv().PROVIDER_CREDENTIAL_MODE;
  return {
    providerCredentialMode,
    async admitAuthenticationAttempt(request) {
      const env = loadEnv();
      const pepper = env.API_KEY_PEPPER ?? env.SESSION_SECRET;
      if (!pepper || pepper.length < 32) return false;
      const repositories = getRepositories();
      const fingerprintHash = anonymizeAddress(clientAddress(request.headers), pepper);
      const since = new Date(Date.now() - 3_600_000);
      if (
        (await repositories.apiKeys.failedAuthenticationAttemptsSince({
          requesterFingerprintHash: fingerprintHash,
          since,
        })) >= env.API_AUTH_FAILURE_LIMIT_PER_HOUR
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
      const maximum = env.API_AUTH_FAILURE_LIMIT_PER_HOUR;
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
      const authenticated = await getRepositories().apiKeys.authenticate({
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

    async createOrReuse({ principal, idempotencyKey, request }) {
      await enforceRateLimit(principal, "CREATE");
      const repositories = getRepositories();
      const prior = await repositories.scans.resolveApiIdempotency({
        apiKeyId: principal.apiKeyId,
        idempotencyKey,
        request,
      });
      if (prior) {
        if (prior.idempotencyConflict) {
          throw new ApiServiceError(
            "CONFLICT",
            "The Idempotency-Key was already used for a different request.",
          );
        }
        const reused = await responseFor(principal, prior.request.publicId);
        if (!reused)
          throw new ApiServiceError("CONFLICT", "The idempotent request is unavailable.");
        return reused;
      }
      await assertProjectRestriction(principal, request);
      const env = loadEnv();
      const now = new Date();
      const admitted = await repositories.scans.admitApiRequest({
        apiKeyId: principal.apiKeyId,
        idempotencyKey,
        request,
        ...(principal.projectId ? { projectId: principal.projectId } : {}),
        ...(principal.requesterFingerprintHash
          ? { requesterFingerprintHash: principal.requesterFingerprintHash }
          : {}),
        costReservationUsd: resolveProviderCosts(env).maximumProviderCostUsdPerScan,
        since: new Date(now.getTime() - 3_600_000),
        now,
      });
      if (admitted.status === "COST_LIMITED") {
        await repositories.apiKeys.recordLimited({
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

    async getStatus({ principal, id }) {
      await enforceRateLimit(principal, "STATUS");
      return responseFor(principal, id);
    },
  };
}
