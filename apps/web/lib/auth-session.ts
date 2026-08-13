import "server-only";

import type { User } from "@supabase/supabase-js";

import { createSupabaseServerClient } from "./supabase/server";
import { readSupabasePublicConfig } from "./supabase/config";

export type VerifiedAuthIdentity = {
  authUserId: string;
  email: string;
  displayName?: string;
  avatarUrl?: string;
};

export const DASHBOARD_ROUTES = [
  "/dashboard",
  "/dashboard/today",
  "/dashboard/projects",
  "/dashboard/history",
  "/dashboard/agents",
  "/dashboard/billing",
] as const;

export function safeDashboardDestination(value: string | null | undefined): string {
  return DASHBOARD_ROUTES.includes(value as (typeof DASHBOARD_ROUTES)[number])
    ? (value as (typeof DASHBOARD_ROUTES)[number])
    : "/dashboard";
}

/** Adds a server-authorized claimed project; never use a browser project value here. */
export function claimedProjectDestination(destination: string, projectId: string): string {
  const safe = safeDashboardDestination(destination);
  if (!/^[0-9a-f-]{36}$/i.test(projectId)) return safe;
  const target = safe === "/dashboard" ? "/dashboard/today" : safe;
  return `${target}?project=${encodeURIComponent(projectId)}`;
}

function safeProfileText(value: unknown, maximum: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().replace(/\s+/g, " ").slice(0, maximum);
  return normalized || undefined;
}

function verifiedIdentityFromUser(user: User): VerifiedAuthIdentity | null {
  const email = user.email?.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email ?? "")) return null;
  const displayName = safeProfileText(
    user.user_metadata?.full_name ?? user.user_metadata?.name,
    200,
  );
  const avatarCandidate = safeProfileText(
    user.user_metadata?.avatar_url ?? user.user_metadata?.picture,
    2_048,
  );
  let avatarUrl: string | undefined;
  if (avatarCandidate) {
    try {
      const parsed = new URL(avatarCandidate);
      if (parsed.protocol === "https:") avatarUrl = parsed.toString();
    } catch {
      avatarUrl = undefined;
    }
  }
  return {
    authUserId: user.id,
    email: email!,
    ...(displayName ? { displayName } : {}),
    ...(avatarUrl ? { avatarUrl } : {}),
  };
}

export async function getVerifiedAuthSubject(): Promise<string | null> {
  if (!readSupabasePublicConfig()) return null;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();
  const subject = data?.claims.sub;
  return !error && typeof subject === "string" && /^[0-9a-f-]{36}$/i.test(subject) ? subject : null;
}

/** Callback-only identity read: getUser confirms current email/profile at Auth. */
export async function getVerifiedAuthIdentity(): Promise<VerifiedAuthIdentity | null> {
  if (!readSupabasePublicConfig()) return null;
  const supabase = await createSupabaseServerClient();
  const { data: claims, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError || !claims?.claims.sub) return null;
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user || data.user.id !== claims.claims.sub) return null;
  return verifiedIdentityFromUser(data.user);
}
