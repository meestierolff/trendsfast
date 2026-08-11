import type { TurnstileVerifier } from "./public-scan-service";

export function createTurnstileVerifier(
  secret: string,
  fetcher: typeof fetch = fetch,
): TurnstileVerifier {
  return {
    async verify(token, address) {
      if (!token) return false;
      const body = new URLSearchParams({ secret, response: token, remoteip: address });
      const response = await fetcher("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) return false;
      const result = (await response.json()) as { success?: boolean };
      return result.success === true;
    },
  };
}
