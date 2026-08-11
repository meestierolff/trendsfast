import { and, count, eq, gte, sum } from "drizzle-orm";

import {
  createApiKey,
  hashApiKeySecret,
  parseApiKey,
  verifyApiKeySecret,
  redactSecrets,
} from "@trendsfast/core";
import type { ApiKeyEnvironment } from "@trendsfast/schemas";

import type { TrendsFastDatabase } from "../client";
import { apiKeyAuthEvents, apiKeys, scanRequests, scanRuns } from "../schema";

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
  }) {
    const createdAt = new Date();
    if (input.expiresAt && input.expiresAt <= createdAt) {
      throw new Error("API key expiry must be after its creation time");
    }
    const issued = await createApiKey(input.environment, this.pepper);
    const [record] = await this.db
      .insert(apiKeys)
      .values({
        name: redactSecrets(input.name).slice(0, 200),
        environment: input.environment,
        projectId: input.projectId ?? null,
        visiblePrefix: issued.prefix,
        secretHash: issued.secretHash,
        scopes: input.scopes ?? ["next_move:read", "next_move:write"],
        rateLimitPerHour: input.rateLimitPerHour ?? 20,
        providerCostLimitUsd: String(input.providerCostLimitUsd ?? 5),
        createdAt,
        expiresAt: input.expiresAt ?? null,
      })
      .returning();
    if (!record) throw new Error("Could not issue API key");
    return { record, rawKey: issued.rawKey };
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

  async revoke(id: string) {
    const [record] = await this.db
      .update(apiKeys)
      .set({ status: "REVOKED", revokedAt: new Date() })
      .where(and(eq(apiKeys.id, id), eq(apiKeys.status, "ACTIVE")))
      .returning();
    return record ?? null;
  }
}
