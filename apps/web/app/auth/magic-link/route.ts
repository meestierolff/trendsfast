import { authRedirect } from "@/lib/auth-flow";
import { safeDashboardDestination } from "@/lib/auth-session";
import { readBoundedFormBody } from "@/lib/bounded-json";
import { acceptsPrivateMutation } from "@/lib/private-scan-api";
import {
  issueMagicAuthFlow,
  magicAuthFlowCookieOptions,
  MAGIC_AUTH_FLOW_PARAM,
} from "@/lib/magic-auth-flow";
import { siteOrigin } from "@/lib/site";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

function validEmail(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
  );
}

export async function POST(request: Request) {
  if (!acceptsPrivateMutation(request)) return authRedirect("/login?error=request_rejected");
  const body = await readBoundedFormBody(request, 2_048);
  if (!body.ok || !validEmail(body.value.email)) {
    return authRedirect("/login?error=invalid_email");
  }
  const next = safeDashboardDestination(
    typeof body.value.next === "string" ? body.value.next : undefined,
  );
  const flow = issueMagicAuthFlow();
  const emailRedirectTo = new URL("/auth/confirm", `${siteOrigin()}/`);
  emailRedirectTo.searchParams.set("next", next);
  emailRedirectTo.searchParams.set(MAGIC_AUTH_FLOW_PARAM, flow.correlation);

  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.signInWithOtp({
      email: body.value.email.trim().toLowerCase(),
      options: {
        shouldCreateUser: true,
        emailRedirectTo: emailRedirectTo.toString(),
      },
    });
    if (error) return authRedirect("/login?error=email_unavailable");
    const response = authRedirect("/login?sent=1");
    response.cookies.set(flow.cookieName, flow.secret, magicAuthFlowCookieOptions());
    return response;
  } catch {
    return authRedirect("/login?error=email_unavailable");
  }
}
