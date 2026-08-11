import { and, asc, count, desc, eq, gte, or, sum } from "drizzle-orm";

import {
  createApiKey,
  hashApiKeySecret,
  parseApiKey,
  verifyApiKeySecret,
  redactRecord,
  redactSecrets,
} from "@trendsfast/core";
import type { ApiKeyEnvironment } from "@trendsfast/schemas";

import type { TrendsFastDatabase } from "../client";
import {
  apiKeyAuthEvents,
  apiKeyManagementEvents,
  apiKeys,
  scanRequests,
  scanRuns,
} from "../schema";

export const API_KEY_SCOPES = ["next_move:read", "next_move:write"] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

export type ApiKeyControlView = Pick<
  typeof apiKeys.$inferSelect,
  | "id"
  | "projectId"
  | "name"
  | "visiblePrefix"
  | "scopes"
  | "environment"
  | "status"
  | "rateLimitPerHour"
  | "providerCostLimitUsd"
  | "createdAt"
  | "lastUsedAt"
  | "expiresAt"
  | "revokedAt"
>;

const controlSelection = {
  id: apiKeys.id,
  projectId: apiKeys.projectId,
  name: apiKeys.name,
  visiblePrefix: apiKeys.visiblePrefix,
  scopes: apiKeys.scopes,
  environment: apiKeys.environment,
  status: apiKeys.status,
  rateLimitPerHour: apiKeys.rateLimitPerHour,
  providerCostLimitUsd: apiKeys.providerCostLimitUsd,
  createdAt: apiKeys.createdAt,
  lastUsedAt: apiKeys.lastUsedAt,
  expiresAt: apiKeys.expiresAt,
  revokedAt: apiKeys.revokedAt,
} as const;

function safeScopes(input: string[] | undefined): ApiKeyScope[] {
  const requested = input ?? [...API_KEY_SCOPES];
  const unique = [...new Set(requested)];
  if (
    unique.length === 0 ||
    unique.some((scope): scope is string => !API_KEY_SCOPES.includes(scope as ApiKeyScope))
  ) {
    throw new Error("API key scopes are invalid");
  }
  return unique as ApiKeyScope[];
}

function assertLimits(input: { rateLimitPerHour?: number; providerCostLimitUsd?: number }) {
  const rate = input.rateLimitPerHour ?? 20;
  const cost = input.providerCostLimitUsd ?? 5;
  if (!Number.isSafeInteger(rate) || rate < 1 || rate > 10_000) {
    throw new Error("API key hourly rate limit is invalid");
  }
  if (!Number.isFinite(cost) || cost < 0 || cost > 10_000) {
    throw new Error("API key provider-cost limit is invalid");
  }
  return { rate, cost };
}

function auditSnapshot(record: ApiKeyControlView): Record<string, unknown> {
  return {
    id: record.id,
    projectId: record.projectId,
    name: record.name,
    visiblePrefix: record.visiblePrefix,
    scopes: record.scopes,
    environment: record.environment,
    status: record.status,
    rateLimitPerHour: record.rateLimitPerHour,
    providerCostLimitUsd: record.providerCostLimitUsd,
    expiresAt: record.expiresAt?.toISOString() ?? null,
    revokedAt: record.revokedAt?.toISOString() ?? null,
  };
}

export type ApiAuthResult =
  | { ok: true; apiKey: typeof apiKeys.$inferSelect }
  | {
      ok: false;
      reason: "NOT_FOUND" | "INVALID" | "REVOKED" | "EXPIRED";
    };

export type ApiAuthOutcome = ApiAuthResult extends infer Result
  ? Result extends { ok: false; reason: infer Reason }
    ? Reason | "SUCCESS"
    : never
  : never;

export function resolveApiAuthOutcome(
  record: Pick<typeof apiKeys.$inferSelect, "status" | "expiresAt"> | undefined,
  secretIsValid: boolean,
  now: Date,
): ApiAuthOutcome {
  if (!record) return "NOT_FOUND";
  if (!secretIsValid) return "INVALID";
  if (record.status === "REVOKED") return "REVOKED";
  if (record.expiresAt && record.expiresAt <= now) return "EXPIRED";
  return "SUCCESS";
}

export class ApiKeyRepository {
  private dummyHash: Promise<string> | undefined;

  constructor(
    private readonly db: TrendsFastDatabase,
    private readonly pepper?: string,
  ) {}

  private getDummyHash() {
    return (this.dummyHash ??= hashApiKeySecret(
      "invalid-api-key-secret".padEnd(32, "x"),
      this.pepper,
    ));
  }

  async issue(input: {
    name: string;
    environment: ApiKeyEnvironment;
    projectId?: string;
    scopes?: string[];
    rateLimitPerHour?: number;
    providerCostLimitUsd?: number;
    expiresAt?: Date;
    actorId?: string;
  }) {
    const createdAt = new Date();
    if (input.expiresAt && input.expiresAt <= createdAt) {
      throw new Error("API key expiry must be after its creation time");
    }
    const name = redactSecrets(input.name).trim().slice(0, 200);
    if (!name) throw new Error("API key name is required");
    const scopes = safeScopes(input.scopes);
    const limits = assertLimits(input);
    const actorId = redactSecrets(input.actorId ?? "system:repository").slice(0, 160);
    const issued = await createApiKey(input.environment, this.pepper);
    return this.db.transaction(async (tx) => {
      const [record] = await tx
        .insert(apiKeys)
        .values({
          name,
          environment: input.environment,
          projectId: input.projectId ?? null,
          visiblePrefix: issued.prefix,
          secretHash: issued.secretHash,
          scopes,
          rateLimitPerHour: limits.rate,
          providerCostLimitUsd: String(limits.cost),
          createdAt,
          expiresAt: input.expiresAt ?? null,
        })
        .returning(controlSelection);
      if (!record) throw new Error("Could not issue API key");
      await tx.insert(apiKeyManagementEvents).values({
        projectId: record.projectId,
        apiKeyId: record.id,
        action: "ISSUED",
        actorId,
        after: redactRecord(auditSnapshot(record)),
      });
      return { record, rawKey: issued.rawKey };
    });
  }

  async list(input: { projectId?: string; limit?: number } = {}): Promise<ApiKeyControlView[]> {
    const limit = Math.min(Math.max(input.limit ?? 100, 1), 200);
    return this.db
      .select(controlSelection)
      .from(apiKeys)
      .where(input.projectId ? eq(apiKeys.projectId, input.projectId) : undefined)
      .orderBy(desc(apiKeys.createdAt), asc(apiKeys.name))
      .limit(limit);
  }

  async getControlRecord(id: string): Promise<ApiKeyControlView | null> {
    const [record] = await this.db
      .select(controlSelection)
      .from(apiKeys)
      .where(eq(apiKeys.id, id))
      .limit(1);
    return record ?? null;
  }

  async authenticate(input: {
    rawKey: string;
    requesterFingerprintHash?: string;
    requestId?: string;
  }): Promise<ApiAuthResult> {
    const parsed = parseApiKey(input.rawKey);
    const [record] = parsed
      ? await this.db
          .select()
          .from(apiKeys)
          .where(
            and(
              eq(apiKeys.environment, parsed.environment),
              eq(apiKeys.visiblePrefix, parsed.prefix),
            ),
          )
          .limit(1)
      : [];

    const valid = await verifyApiKeySecret(
      parsed?.secret ?? "invalid-api-key-secret".padEnd(32, "x"),
      record?.secretHash ?? (await this.getDummyHash()),
      this.pepper,
    );
    const now = new Date();
    const outcome = resolveApiAuthOutcome(record, valid, now);

    await this.db.insert(apiKeyAuthEvents).values({
      apiKeyId: record?.id ?? null,
      presentedPrefix: parsed?.prefix ?? null,
      outcome,
      requesterFingerprintHash: input.requesterFingerprintHash ?? null,
      requestId: input.requestId ?? null,
    });

    if (outcome !== "SUCCESS" || !record) {
      return { ok: false, reason: outcome as Exclude<typeof outcome, "SUCCESS"> };
    }
    await this.db.update(apiKeys).set({ lastUsedAt: now }).where(eq(apiKeys.id, record.id));
    return { ok: true, apiKey: record };
  }

  async recordLimited(input: {
    apiKeyId: string;
    presentedPrefix: string;
    outcome: "RATE_LIMITED" | "COST_LIMITED";
    requesterFingerprintHash?: string;
    requestId?: string;
  }) {
    await this.db.insert(apiKeyAuthEvents).values({
      apiKeyId: input.apiKeyId,
      presentedPrefix: input.presentedPrefix,
      outcome: input.outcome,
      requesterFingerprintHash: input.requesterFingerprintHash ?? null,
      requestId: input.requestId ?? null,
    });
  }

  async usageSince(input: { apiKeyId: string; since: Date }) {
    const [auth] = await this.db
      .select({ value: count() })
      .from(apiKeyAuthEvents)
      .where(
        and(
          eq(apiKeyAuthEvents.apiKeyId, input.apiKeyId),
          eq(apiKeyAuthEvents.outcome, "SUCCESS"),
          gte(apiKeyAuthEvents.occurredAt, input.since),
        ),
      );
    const [cost] = await this.db
      .select({
        estimatedCostUsd: sum(scanRuns.estimatedCostUsd),
        actualCostUsd: sum(scanRuns.actualCostUsd),
      })
      .from(scanRuns)
      .innerJoin(scanRequests, eq(scanRuns.scanRequestId, scanRequests.id))
      .where(and(eq(scanRequests.apiKeyId, input.apiKeyId), gte(scanRuns.createdAt, input.since)));
    return {
      successfulRequests: auth?.value ?? 0,
      estimatedCostUsd: Number(cost?.estimatedCostUsd ?? 0),
      actualCostUsd: Number(cost?.actualCostUsd ?? 0),
    };
  }

  async revoke(id: string, actorId = "system:repository") {
    return this.db.transaction(async (tx) => {
      const [before] = await tx
        .select(controlSelection)
        .from(apiKeys)
        .where(eq(apiKeys.id, id))
        .for("update")
        .limit(1);
      if (!before || before.status !== "ACTIVE") return null;
      const revokedAt = new Date();
      const [record] = await tx
        .update(apiKeys)
        .set({ status: "REVOKED", revokedAt })
        .where(and(eq(apiKeys.id, id), eq(apiKeys.status, "ACTIVE")))
        .returning(controlSelection);
      if (!record) return null;
      await tx.insert(apiKeyManagementEvents).values({
        projectId: record.projectId,
        apiKeyId: record.id,
        action: "REVOKED",
        actorId: redactSecrets(actorId).slice(0, 160),
        before: redactRecord(auditSnapshot(before)),
        after: redactRecord(auditSnapshot(record)),
      });
      return record;
    });
  }

  async rotate(input: {
    apiKeyId: string;
    actorId: string;
    name?: string;
    expiresAt?: Date | null;
  }) {
    return this.replace({ ...input, action: "ROTATED", requireInactive: false });
  }

  async reissue(input: {
    apiKeyId: string;
    actorId: string;
    name?: string;
    expiresAt?: Date | null;
  }) {
    return this.replace({ ...input, action: "REISSUED", requireInactive: true });
  }

  private async replace(input: {
    apiKeyId: string;
    actorId: string;
    action: "ROTATED" | "REISSUED";
    requireInactive: boolean;
    name?: string;
    expiresAt?: Date | null;
  }) {
    const issuedAt = new Date();
    if (input.expiresAt && input.expiresAt <= issuedAt) {
      throw new Error("API key expiry must be after its creation time");
    }
    return this.db.transaction(async (tx) => {
      const [before] = await tx
        .select(controlSelection)
        .from(apiKeys)
        .where(eq(apiKeys.id, input.apiKeyId))
        .for("update")
        .limit(1);
      if (!before || !before.projectId) throw new Error("Project-scoped API key was not found");
      const expired = Boolean(before.expiresAt && before.expiresAt <= issuedAt);
      if (input.requireInactive) {
        if (before.status === "ACTIVE" && !expired) {
          throw new Error("Only a revoked or expired API key can be reissued");
        }
      } else if (before.status !== "ACTIVE" || expired) {
        throw new Error("Only an active, unexpired API key can be rotated");
      }
      if (input.expiresAt === null && before.expiresAt !== null) {
        throw new Error("Replacement expiry cannot be removed");
      }
      const replacementExpiry = input.expiresAt ?? before.expiresAt;
      if (!replacementExpiry || replacementExpiry <= issuedAt) {
        throw new Error("Replacement API key expiry must be in the future");
      }
      const replacementIssued = await createApiKey(before.environment, this.pepper);
      const [replacement] = await tx
        .insert(apiKeys)
        .values({
          projectId: before.projectId,
          name: redactSecrets(input.name ?? before.name)
            .trim()
            .slice(0, 200),
          visiblePrefix: replacementIssued.prefix,
          secretHash: replacementIssued.secretHash,
          scopes: safeScopes(before.scopes),
          environment: before.environment,
          rateLimitPerHour: before.rateLimitPerHour,
          providerCostLimitUsd: before.providerCostLimitUsd,
          createdAt: issuedAt,
          expiresAt: replacementExpiry,
        })
        .returning(controlSelection);
      if (!replacement) throw new Error("Could not create replacement API key");
      if (before.status === "ACTIVE") {
        await tx
          .update(apiKeys)
          .set({ status: "REVOKED", revokedAt: issuedAt })
          .where(and(eq(apiKeys.id, before.id), eq(apiKeys.status, "ACTIVE")));
      }
      await tx.insert(apiKeyManagementEvents).values({
        projectId: before.projectId,
        apiKeyId: replacement.id,
        relatedApiKeyId: before.id,
        action: input.action,
        actorId: redactSecrets(input.actorId).slice(0, 160),
        before: redactRecord(auditSnapshot(before)),
        after: redactRecord(auditSnapshot(replacement)),
      });
      return { record: replacement, rawKey: replacementIssued.rawKey, replaced: before };
    });
  }

  async listManagementEvents(
    input: { projectId?: string; apiKeyId?: string; limit?: number } = {},
  ) {
    const limit = Math.min(Math.max(input.limit ?? 100, 1), 200);
    const filters = [
      input.projectId ? eq(apiKeyManagementEvents.projectId, input.projectId) : undefined,
      input.apiKeyId
        ? or(
            eq(apiKeyManagementEvents.apiKeyId, input.apiKeyId),
            eq(apiKeyManagementEvents.relatedApiKeyId, input.apiKeyId),
          )
        : undefined,
    ].filter((candidate) => candidate !== undefined);
    return this.db
      .select()
      .from(apiKeyManagementEvents)
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(apiKeyManagementEvents.occurredAt))
      .limit(limit);
  }
}
