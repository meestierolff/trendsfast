import { anonymizeAddress, normalizePublicSubmission } from "./request-security";

export class PublicScanError extends Error {
  constructor(
    readonly code:
      | "INVALID_URL"
      | "ABUSE_REJECTED"
      | "RATE_LIMITED"
      | "PROJECT_ALREADY_EXISTS"
      | "TURNSTILE_FAILED"
      | "TODAYS_FOUNDER_REVIEW_CAPACITY_REACHED",
    message: string,
    readonly status: 400 | 409 | 429 = code === "RATE_LIMITED"
      ? 429
      : code === "PROJECT_ALREADY_EXISTS"
        ? 409
        : 400,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

export type PublicScanRepository = {
  admitPublicRequest(input: {
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
  }): Promise<
    | { status: "CREATED" | "REUSED"; scanRequestId: string; publicToken: string }
    | { status: "RATE_LIMITED" }
    | { status: "PROJECT_ALREADY_EXISTS" }
    | { status: "GLOBAL_CAPACITY_REACHED" }
    | { status: "GLOBAL_BUDGET_REACHED" }
  >;
};

export type TurnstileVerifier = {
  verify(token: string | undefined, address: string): Promise<boolean>;
};

/**
 * Fixture decisions are safe product examples, not answers for a real founder
 * URL. Permit them only on an explicit loopback origin so a hosted
 * misconfiguration fails closed before accepting a scan.
 */
export function publicScanCredentialModeAvailable(
  credentialMode: "fixture" | "managed" | "byok",
  appUrl: string,
  deploymentEnvironment?: string,
  hostedPlatform = false,
  providerCallsEnabled = false,
): boolean {
  if (credentialMode !== "fixture") return providerCallsEnabled;
  if (
    hostedPlatform ||
    deploymentEnvironment === "production" ||
    deploymentEnvironment === "preview"
  ) {
    return false;
  }
  try {
    const hostname = new URL(appUrl).hostname.toLowerCase();
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  } catch {
    return false;
  }
}

export async function acceptPublicScan(
  input: {
    productUrl: unknown;
    address: string;
    honeypot?: unknown;
    turnstileToken?: string;
  },
  dependencies: {
    repository: PublicScanRepository;
    fingerprintPepper: string;
    dailyLimit: number;
    globalDailyLimit: number;
    globalDailyBudgetUsd: number;
    costReservationUsd: number;
    turnstile?: TurnstileVerifier;
    anonymousSessionHash?: string;
    now?: Date;
  },
): Promise<{ scanRequestId: string; token: string; reused: boolean }> {
  if (typeof input.honeypot === "string" && input.honeypot.trim()) {
    throw new PublicScanError("ABUSE_REJECTED", "The request could not be accepted.");
  }
  let normalizedUrl: string;
  try {
    normalizedUrl = normalizePublicSubmission(input.productUrl);
  } catch (error) {
    throw new PublicScanError(
      "INVALID_URL",
      error instanceof Error ? error.message : "Enter a valid public product URL.",
    );
  }
  if (
    dependencies.turnstile &&
    !(await dependencies.turnstile.verify(input.turnstileToken, input.address))
  ) {
    throw new PublicScanError("TURNSTILE_FAILED", "The abuse-protection check did not pass.");
  }
  const fingerprintHash = anonymizeAddress(input.address, dependencies.fingerprintPepper);
  const now = dependencies.now ?? new Date();
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const globalSince = new Date(now);
  globalSince.setUTCHours(0, 0, 0, 0);
  const admission = await dependencies.repository.admitPublicRequest({
    submittedUrl: normalizedUrl,
    normalizedUrl,
    requesterFingerprintHash: fingerprintHash,
    ...(dependencies.anonymousSessionHash
      ? { anonymousSessionHash: dependencies.anonymousSessionHash }
      : {}),
    since,
    dailyLimit: dependencies.dailyLimit,
    globalSince,
    globalDailyLimit: dependencies.globalDailyLimit,
    globalDailyBudgetUsd: dependencies.globalDailyBudgetUsd,
    costReservationUsd: dependencies.costReservationUsd,
    now,
  });
  if (admission.status === "RATE_LIMITED") {
    throw new PublicScanError("RATE_LIMITED", "The free-scan daily limit has been reached.");
  }
  if (admission.status === "PROJECT_ALREADY_EXISTS") {
    throw new PublicScanError(
      "PROJECT_ALREADY_EXISTS",
      "A new public scan cannot be started for this product. Its owner can request a refresh after signing in.",
      409,
    );
  }
  if (
    admission.status === "GLOBAL_CAPACITY_REACHED" ||
    admission.status === "GLOBAL_BUDGET_REACHED"
  ) {
    throw new PublicScanError(
      "TODAYS_FOUNDER_REVIEW_CAPACITY_REACHED",
      "Today's free founder-reviewed scan slots are full.",
      429,
      Math.max(1, Math.ceil((globalSince.getTime() + 86_400_000 - now.getTime()) / 1_000)),
    );
  }
  return {
    scanRequestId: admission.scanRequestId,
    token: admission.publicToken,
    reused: admission.status === "REUSED",
  };
}

export function isSameOrigin(request: Request, appUrl: string): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return request.headers.get("sec-fetch-site") !== "cross-site";
  try {
    return new URL(origin).origin === new URL(appUrl).origin;
  } catch {
    return false;
  }
}
