import "server-only";

import { cookies, headers } from "next/headers";

import { ANALYTICS_SESSION_COOKIE, analyticsSessionForServerPage } from "./first-party-analytics";

export type ServerAnalyticsContext = {
  anonymousSessionHash: string;
  secret: string;
};

/** Returns null when privacy-safe hashing is not configured; tracking stays best effort. */
export async function getServerAnalyticsContext(): Promise<ServerAnalyticsContext | null> {
  const secret = process.env.SESSION_SECRET ?? "";
  if (secret.length < 32) return null;
  const [requestHeaders, cookieStore] = await Promise.all([headers(), cookies()]);
  const cookieSession = cookieStore.get(ANALYTICS_SESSION_COOKIE)?.value;
  const identity = analyticsSessionForServerPage({
    headers: new Headers(requestHeaders),
    ...(cookieSession ? { cookieSession } : {}),
    secret,
  });
  return { anonymousSessionHash: identity.anonymousSessionHash, secret };
}
