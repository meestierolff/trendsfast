import { createHash } from "node:crypto";

import type { TurnstileVerifier } from "./public-scan-service";
import { PUBLIC_SCAN_TURNSTILE_ACTION } from "./turnstile-contract";

export { PUBLIC_SCAN_TURNSTILE_ACTION } from "./turnstile-contract";

const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TURNSTILE_TOKEN_LIFETIME_MS = 300_000;
const MAX_TRACKED_TOKENS = 4_096;

const PUBLIC_SCAN_TURNSTILE_HOSTNAMES = new Set([
  "trendsfast.vercel.app",
  "trendsfast.com",
  "www.trendsfast.com",
]);

type TurnstileSiteverifyResult = {
  success?: unknown;
  challenge_ts?: unknown;
  hostname?: unknown;
  action?: unknown;
};

// Cloudflare enforces single use globally. This cache also closes the replay
// window inside one warm server instance without retaining raw capabilities.
const acceptedTokenExpirations = new Map<string, number>();
const pendingTokenDigests = new Set<string>();

function tokenDigest(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function pruneAcceptedTokens(nowMs: number): void {
  for (const [digest, expiresAt] of acceptedTokenExpirations) {
    if (expiresAt <= nowMs) acceptedTokenExpirations.delete(digest);
  }
  while (acceptedTokenExpirations.size >= MAX_TRACKED_TOKENS) {
    const oldest = acceptedTokenExpirations.keys().next().value as string | undefined;
    if (!oldest) break;
    acceptedTokenExpirations.delete(oldest);
  }
}

export function createTurnstileVerifier(
  secret: string,
  fetcher: typeof fetch = fetch,
  now: () => number = Date.now,
): TurnstileVerifier {
  return {
    async verify(token) {
      if (!token) return false;
      const checkedAt = now();
      const digest = tokenDigest(token);
      pruneAcceptedTokens(checkedAt);
      if (acceptedTokenExpirations.has(digest) || pendingTokenDigests.has(digest)) return false;
      if (pendingTokenDigests.size >= MAX_TRACKED_TOKENS) return false;
      pendingTokenDigests.add(digest);

      try {
        // `remoteip` is optional. Omit it so TrendsFast does not make a second
        // server-to-server disclosure of the visitor address to Cloudflare.
        const body = new URLSearchParams({ secret, response: token });
        const response = await fetcher(TURNSTILE_VERIFY_URL, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body,
          signal: AbortSignal.timeout(8_000),
        });
        if (!response.ok) return false;

        const result = (await response.json()) as TurnstileSiteverifyResult;
        if (
          result.success !== true ||
          typeof result.challenge_ts !== "string" ||
          typeof result.hostname !== "string" ||
          typeof result.action !== "string"
        ) {
          return false;
        }

        const challengedAt = Date.parse(result.challenge_ts);
        const verifiedAt = now();
        const ageMs = verifiedAt - challengedAt;
        const hostname = result.hostname.trim().toLowerCase();
        if (
          !Number.isFinite(challengedAt) ||
          !Number.isFinite(ageMs) ||
          ageMs < 0 ||
          ageMs >= TURNSTILE_TOKEN_LIFETIME_MS ||
          !PUBLIC_SCAN_TURNSTILE_HOSTNAMES.has(hostname) ||
          result.action !== PUBLIC_SCAN_TURNSTILE_ACTION
        ) {
          return false;
        }

        acceptedTokenExpirations.set(digest, challengedAt + TURNSTILE_TOKEN_LIFETIME_MS);
        return true;
      } catch {
        return false;
      } finally {
        pendingTokenDigests.delete(digest);
      }
    },
  };
}
