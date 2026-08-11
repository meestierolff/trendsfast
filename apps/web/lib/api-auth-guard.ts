import { createHmac, randomBytes } from "node:crypto";

import { parseApiKey } from "@trendsfast/core";

import { clientAddress } from "./request-security";

export const MAX_API_KEY_LENGTH = 169;

export function parseStrictBearerApiKey(header: string | undefined): string | null {
  if (!header || header.length > "Bearer ".length + MAX_API_KEY_LENGTH) return null;
  const match = /^Bearer[ \t]+([^\s]+)$/i.exec(header);
  const rawKey = match?.[1];
  if (!rawKey || rawKey.length > MAX_API_KEY_LENGTH || !parseApiKey(rawKey)) return null;
  return rawKey;
}

export function apiKeyEnvironmentMatchesProviderMode(
  environment: "test" | "live",
  mode: "fixture" | "managed" | "byok",
): boolean {
  return mode === "fixture" ? environment === "test" : environment === "live";
}

export type ApiAuthAttemptReservation = {
  markInvalid(now?: number): void;
  release(): void;
};

type AttemptBucket = {
  invalidAttemptTimes: number[];
  inFlight: number;
};

const OVERFLOW_FINGERPRINT = "__bounded_overflow__";

/**
 * A process-local sliding-window limiter for expensive API-key verification.
 * Reservations count in-flight work, so concurrent invalid requests cannot all
 * enter scrypt before completed failures are recorded. The overflow bucket
 * keeps attacker-controlled fingerprint cardinality from growing memory
 * without bound.
 */
export class InProcessInvalidApiKeyLimiter {
  private readonly buckets = new Map<string, AttemptBucket>();
  private globalInvalidAttemptTimes: number[] = [];
  private globalInFlight = 0;

  constructor(
    private readonly options: {
      maxInvalidAttempts: number;
      windowMs: number;
      maxFingerprints: number;
      maxGlobalInvalidAttempts?: number;
    } = {
      maxInvalidAttempts: 8,
      windowMs: 60_000,
      maxFingerprints: 10_000,
    },
  ) {
    if (
      !Number.isSafeInteger(options.maxInvalidAttempts) ||
      options.maxInvalidAttempts < 1 ||
      !Number.isSafeInteger(options.windowMs) ||
      options.windowMs < 1 ||
      !Number.isSafeInteger(options.maxFingerprints) ||
      options.maxFingerprints < 2 ||
      (options.maxGlobalInvalidAttempts !== undefined &&
        (!Number.isSafeInteger(options.maxGlobalInvalidAttempts) ||
          options.maxGlobalInvalidAttempts < options.maxInvalidAttempts))
    ) {
      throw new Error("Invalid API authentication limiter options");
    }
  }

  reserve(fingerprint: string, now = Date.now()): ApiAuthAttemptReservation | null {
    this.pruneOldBuckets(now);
    this.globalInvalidAttemptTimes = this.globalInvalidAttemptTimes.filter(
      (attemptedAt) => attemptedAt > now - this.options.windowMs,
    );
    const globalLimit =
      this.options.maxGlobalInvalidAttempts ?? this.options.maxInvalidAttempts * 8;
    if (this.globalInvalidAttemptTimes.length + this.globalInFlight >= globalLimit) return null;
    const existing = this.buckets.get(fingerprint);
    const bucketKey =
      existing || this.buckets.size < this.options.maxFingerprints - 1
        ? fingerprint
        : OVERFLOW_FINGERPRINT;
    const bucket = existing ??
      this.buckets.get(bucketKey) ?? {
        invalidAttemptTimes: [],
        inFlight: 0,
      };
    bucket.invalidAttemptTimes = bucket.invalidAttemptTimes.filter(
      (attemptedAt) => attemptedAt > now - this.options.windowMs,
    );
    if (bucket.invalidAttemptTimes.length + bucket.inFlight >= this.options.maxInvalidAttempts) {
      return null;
    }

    bucket.inFlight += 1;
    this.globalInFlight += 1;
    this.buckets.delete(bucketKey);
    this.buckets.set(bucketKey, bucket);
    let settled = false;
    const settle = (invalid: boolean, settledAt: number) => {
      if (settled) return;
      settled = true;
      bucket.inFlight = Math.max(0, bucket.inFlight - 1);
      this.globalInFlight = Math.max(0, this.globalInFlight - 1);
      if (invalid) {
        bucket.invalidAttemptTimes.push(settledAt);
        this.globalInvalidAttemptTimes.push(settledAt);
      }
      if (bucket.inFlight === 0 && bucket.invalidAttemptTimes.length === 0) {
        this.buckets.delete(bucketKey);
      }
    };
    return {
      markInvalid: (settledAt = Date.now()) => settle(true, settledAt),
      release: () => settle(false, Date.now()),
    };
  }

  private pruneOldBuckets(now: number) {
    let checked = 0;
    for (const [key, bucket] of this.buckets) {
      if (checked >= 32) break;
      checked += 1;
      bucket.invalidAttemptTimes = bucket.invalidAttemptTimes.filter(
        (attemptedAt) => attemptedAt > now - this.options.windowMs,
      );
      if (bucket.inFlight === 0 && bucket.invalidAttemptTimes.length === 0) {
        this.buckets.delete(key);
      }
    }
  }
}

const authGuardGlobal = globalThis as typeof globalThis & {
  trendsFastApiAuthLimiter?: InProcessInvalidApiKeyLimiter;
  trendsFastApiAuthFingerprintSecret?: string;
};

export function getApiAuthLimiter(): InProcessInvalidApiKeyLimiter {
  return (authGuardGlobal.trendsFastApiAuthLimiter ??= new InProcessInvalidApiKeyLimiter());
}

export function apiAuthRequestFingerprint(request: Request): string {
  const secret = (authGuardGlobal.trendsFastApiAuthFingerprintSecret ??=
    randomBytes(32).toString("base64url"));
  return createHmac("sha256", secret).update(clientAddress(request.headers)).digest("hex");
}
