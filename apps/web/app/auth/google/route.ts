import { readBoundedFormBody } from "@/lib/bounded-json";
import { acceptsPrivateMutation } from "@/lib/private-scan-api";
import { authRedirect } from "@/lib/auth-flow";
import { safeDashboardDestination } from "@/lib/auth-session";
import { siteOrigin } from "@/lib/site";
import { requireSupabasePublicConfig } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!acceptsPrivateMutation(request)) return authRedirect("/login?error=request_rejected");
  const body = await readBoundedFormBody(request, 2_048);
  if (!body.ok) return authRedirect("/login?error=request_rejected");
  const next = safeDashboardDestination(
    typeof body.value.next === "string" ? body.value.next : undefined,
  );
  const redirectTo = new URL("/auth/callback", `${siteOrigin()}/`);
  redirectTo.searchParams.set("next", next);

  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: redirectTo.toString(), skipBrowserRedirect: true },
    });
    if (error || !data.url) return authRedirect("/login?error=google_unavailable");
    const destination = new URL(data.url);
    const authOrigin = requireSupabasePublicConfig().url;
    if (destination.origin !== authOrigin || destination.pathname !== "/auth/v1/authorize") {
      return authRedirect("/login?error=google_unavailable");
    }
    const response = NextResponse.redirect(destination, 303);
    for (const [name, value] of Object.entries({
      "cache-control": "private, no-store, max-age=0",
      "referrer-policy": "no-referrer",
    })) {
      response.headers.set(name, value);
    }
    return response;
  } catch {
    return authRedirect("/login?error=google_unavailable");
  }
}
