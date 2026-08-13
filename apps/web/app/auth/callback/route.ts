import { createSupabaseServerClient } from "@/lib/supabase/server";
import { authRedirect, finishVerifiedAuth } from "@/lib/auth-flow";
import { SUPABASE_PKCE_FLOW_PARAM, validSupabasePkceFlowId } from "@/lib/magic-auth-flow";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const flowId = url.searchParams.get(SUPABASE_PKCE_FLOW_PARAM);
  if (!code || code.length > 2_048 || !validSupabasePkceFlowId(flowId)) {
    return authRedirect("/login?error=verification_failed");
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code, { flowId });
    if (error) return authRedirect("/login?error=verification_failed");
    return finishVerifiedAuth(url.searchParams.get("next"));
  } catch {
    return authRedirect("/login?error=verification_failed");
  }
}
