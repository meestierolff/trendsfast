import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { siteOrigin } from "./site";

export const PROJECT_CLAIM_COOKIE = "tf_project_claim";
export const PROJECT_CLAIM_TTL_SECONDS = 15 * 60;

export function projectClaimHash(rawClaim: string): string | null {
  if (!/^[A-Za-z0-9_-]{43}$/.test(rawClaim)) return null;
  return `sha256:${createHash("sha256").update(rawClaim, "utf8").digest("hex")}`;
}

export function issueProjectClaimSecret(): { rawClaim: string; claimHash: string } {
  const rawClaim = randomBytes(32).toString("base64url");
  return { rawClaim, claimHash: projectClaimHash(rawClaim)! };
}

export function projectClaimCookieOptions(production = process.env.NODE_ENV === "production") {
  const secure = production || siteOrigin().startsWith("https://");
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
    path: "/",
    maxAge: PROJECT_CLAIM_TTL_SECONDS,
  };
}

export function clearProjectClaimCookie(response: {
  cookies: {
    set: (
      name: string,
      value: string,
      options: ReturnType<typeof projectClaimCookieOptions>,
    ) => unknown;
  };
}): void {
  response.cookies.set(PROJECT_CLAIM_COOKIE, "", {
    ...projectClaimCookieOptions(),
    maxAge: 0,
  });
}
