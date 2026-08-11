import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { readBoundedJsonBody } from "./bounded-json";
import { issueOpsSession } from "./ops-session";
import { clientAddress } from "./request-security";

export const MAX_OPS_LOGIN_BODY_BYTES = 4_096;

export type OpsLoginAttemptReservation = {
  markInvalid(now?: number): void;
  release(): void;
};

type AttemptBucket = { invalidAttemptTimes: number[]; inFlight: number };

const OVERFLOW_FINGERPRINT = "__bounded_overflow__";

function available(bucket: AttemptBucket, limit: number): boolean {
  return bucket.invalidAttemptTimes.length + bucket.inFlight < limit;
}

/**
 * Process-local protection for the founder token comparison. Both the caller
 * fingerprint and the entire warm process have sliding-window/in-flight caps.
 */
export class InProcessOpsLoginLimiter {
  private readonly buckets = new Map<string, AttemptBucket>();
  private readonly globalBucket: AttemptBucket = { invalidAttemptTimes: [], inFlight: 0 };

  constructor(
    private readonly options: {
      maxInvalidAttemptsPerFingerprint: number;
      maxInvalidAttemptsGlobal: number;
      windowMs: number;
      maxFingerprints: number;
    } = {
      maxInvalidAttemptsPerFingerprint: 5,
      maxInvalidAttemptsGlobal: 100,
      windowMs: 5 * 60_000,
      maxFingerprints: 512,
    },
  ) {
    if (
      !Number.isSafeInteger(options.maxInvalidAttemptsPerFingerprint) ||
      options.maxInvalidAttemptsPerFingerprint < 1 ||
      !Number.isSafeInteger(options.maxInvalidAttemptsGlobal) ||
      options.maxInvalidAttemptsGlobal < options.maxInvalidAttemptsPerFingerprint ||
      !Number.isSafeInteger(options.windowMs) ||
      options.windowMs < 1 ||
      !Number.isSafeInteger(options.maxFingerprints) ||
      options.maxFingerprints < 2
    ) {
      throw new Error("Invalid operations login limiter options");
    }
  }

  reserve(fingerprint: string, now = Date.now()): OpsLoginAttemptReservation | null {
    this.prune(now);
    const existing = this.buckets.get(fingerprint);
    const bucketKey =
      existing || this.buckets.size < this.options.maxFingerprints - 1
        ? fingerprint
        : OVERFLOW_FINGERPRINT;
    const bucket = existing ??
      this.buckets.get(bucketKey) ?? { invalidAttemptTimes: [], inFlight: 0 };
    this.pruneBucket(bucket, now);
    if (
      !available(bucket, this.options.maxInvalidAttemptsPerFingerprint) ||
      !available(this.globalBucket, this.options.maxInvalidAttemptsGlobal)
    ) {
      return null;
    }

    bucket.inFlight += 1;
    this.globalBucket.inFlight += 1;
    this.buckets.delete(bucketKey);
    this.buckets.set(bucketKey, bucket);
    let settled = false;
    const settle = (invalid: boolean, settledAt: number) => {
      if (settled) return;
      settled = true;
      bucket.inFlight = Math.max(0, bucket.inFlight - 1);
      this.globalBucket.inFlight = Math.max(0, this.globalBucket.inFlight - 1);
      if (invalid) {
        bucket.invalidAttemptTimes.push(settledAt);
        this.globalBucket.invalidAttemptTimes.push(settledAt);
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

  private pruneBucket(bucket: AttemptBucket, now: number) {
    bucket.invalidAttemptTimes = bucket.invalidAttemptTimes.filter(
      (attemptedAt) => attemptedAt > now - this.options.windowMs,
    );
  }

  private prune(now: number) {
    this.pruneBucket(this.globalBucket, now);
    let checked = 0;
    for (const [key, bucket] of this.buckets) {
      if (checked >= 32) break;
      checked += 1;
      this.pruneBucket(bucket, now);
      if (bucket.inFlight === 0 && bucket.invalidAttemptTimes.length === 0) {
        this.buckets.delete(key);
      }
    }
  }
}

const opsLoginGlobal = globalThis as typeof globalThis & {
  trendsFastOpsLoginLimiter?: InProcessOpsLoginLimiter;
  trendsFastOpsLoginFingerprintSecret?: string;
};

export function getOpsLoginLimiter(): InProcessOpsLoginLimiter {
  return (opsLoginGlobal.trendsFastOpsLoginLimiter ??= new InProcessOpsLoginLimiter());
}

export function opsLoginRequestFingerprint(request: Request): string {
  const secret = (opsLoginGlobal.trendsFastOpsLoginFingerprintSecret ??=
    randomBytes(32).toString("base64url"));
  return createHmac("sha256", secret).update(clientAddress(request.headers)).digest("hex");
}

function equalToken(left: string, right: string): boolean {
  const a = createHash("sha256").update(left).digest();
  const b = createHash("sha256").update(right).digest();
  return timingSafeEqual(a, b);
}

export type OpsLoginAuthenticationResult =
  | { ok: true; sessionToken: string }
  | { ok: false; status: 401 | 413 | 415 | 429 | 503; error: string };

export async function authenticateOpsLoginRequest(
  request: Request,
  options: {
    limiter?: InProcessOpsLoginLimiter;
    fingerprint?: string;
    expectedToken?: string;
    sessionSecret?: string;
    now?: number;
    parsedBody?: unknown;
  } = {},
): Promise<OpsLoginAuthenticationResult> {
  if (!(request.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
    return { ok: false, status: 415, error: "Operations login requires JSON." };
  }

  const now = options.now ?? Date.now();
  const reservation = (options.limiter ?? getOpsLoginLimiter()).reserve(
    options.fingerprint ?? opsLoginRequestFingerprint(request),
    now,
  );
  if (!reservation) {
    return {
      ok: false,
      status: 429,
      error: "Too many operations login attempts. Try again later.",
    };
  }

  try {
    const parsed =
      options.parsedBody === undefined
        ? await readBoundedJsonBody(request, MAX_OPS_LOGIN_BODY_BYTES)
        : ({ ok: true, value: options.parsedBody } as const);
    if (!parsed.ok && parsed.reason === "payload_too_large") {
      reservation.markInvalid(now);
      return { ok: false, status: 413, error: "The operations login body is too large." };
    }
    const body = parsed.ok ? parsed.value : null;
    const expected = options.expectedToken ?? process.env.OPS_TOKEN ?? "";
    const secret = options.sessionSecret ?? process.env.SESSION_SECRET ?? "";
    if (expected.length < 32 || secret.length < 32) {
      reservation.release();
      return { ok: false, status: 503, error: "Operations access is unavailable." };
    }
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      typeof (body as { token?: unknown }).token !== "string" ||
      !equalToken((body as { token: string }).token, expected)
    ) {
      reservation.markInvalid(now);
      return { ok: false, status: 401, error: "Operations login failed." };
    }
    reservation.release();
    return {
      ok: true,
      sessionToken: issueOpsSession({ secret, now: new Date(now) }),
    };
  } catch (error) {
    reservation.release();
    throw error;
  }
}
