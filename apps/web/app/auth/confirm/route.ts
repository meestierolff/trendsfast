import type { EmailOtpType } from "@supabase/supabase-js";

import { authRedirect, finishVerifiedAuth } from "@/lib/auth-flow";
import { safeDashboardDestination } from "@/lib/auth-session";
import {
  clearMagicAuthFlowCookie,
  hasValidMagicAuthFlow,
  MAGIC_AUTH_FLOW_PARAM,
  SUPABASE_PKCE_FLOW_PARAM,
  validSupabasePkceFlowId,
} from "@/lib/magic-auth-flow";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  const correlation = url.searchParams.get(MAGIC_AUTH_FLOW_PARAM) ?? "";
  const flowId = url.searchParams.get(SUPABASE_PKCE_FLOW_PARAM);
  const boundToBrowser = hasValidMagicAuthFlow(request, correlation);
  if (
    !tokenHash ||
    tokenHash.length > 2_048 ||
    type !== "email" ||
    !validSupabasePkceFlowId(flowId) ||
    !boundToBrowser
  ) {
    const response = authRedirect("/login?error=verification_failed");
    clearMagicAuthFlowCookie(response, correlation);
    return response;
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: type as EmailOtpType,
    });
    if (error) {
      const response = authRedirect("/login?error=verification_failed");
      clearMagicAuthFlowCookie(response, correlation);
      return response;
    }
    const response = await finishVerifiedAuth(
      safeDashboardDestination(url.searchParams.get("next")),
    );
    clearMagicAuthFlowCookie(response, correlation);
    return response;
  } catch {
    const response = authRedirect("/login?error=verification_failed");
    clearMagicAuthFlowCookie(response, correlation);
    return response;
  }
}
