import { anonymizeAddress, normalizePublicSubmission } from "./request-security";

export class PublicScanError extends Error {
  constructor(
    readonly code: "INVALID_URL" | "ABUSE_REJECTED" | "RATE_LIMITED" | "TURNSTILE_FAILED",
    message: string,
    readonly status: 400 | 429 = code === "RATE_LIMITED" ? 429 : 400,
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
    now: Date;
  }): Promise<
    | { status: "CREATED" | "REUSED"; scanRequestId: string; publicToken: string }
    | { status: "RATE_LIMITED" }
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
): boolean {
  if (credentialMode !== "fixture") return true;
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
    turnstile?: TurnstileVerifier;
    anonymousSessionHash?: string;
    now?: Date;
  },
): Promise<{ scanRequestId: string; token: string; reused: boolean }> {
  if (typeof input.honeypot === "string" && input.honeypot.trim()) {
    throw new PublicScanError("ABUSE_REJECTED", "The request could not be accepted.");
  }
  if (
    dependencies.turnstile &&
    !(await dependencies.turnstile.verify(input.turnstileToken, input.address))
  ) {
    throw new PublicScanError("TURNSTILE_FAILED", "The abuse-protection check did not pass.");
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
  const fingerprintHash = anonymizeAddress(input.address, dependencies.fingerprintPepper);
  const now = dependencies.now ?? new Date();
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const admission = await dependencies.repository.admitPublicRequest({
    submittedUrl: normalizedUrl,
    normalizedUrl,
    requesterFingerprintHash: fingerprintHash,
    ...(dependencies.anonymousSessionHash
      ? { anonymousSessionHash: dependencies.anonymousSessionHash }
      : {}),
    since,
    dailyLimit: dependencies.dailyLimit,
    now,
  });
  if (admission.status === "RATE_LIMITED") {
    throw new PublicScanError("RATE_LIMITED", "The free-scan daily limit has been reached.");
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
