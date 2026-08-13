import { authRedirect } from "@/lib/auth-flow";
import { acceptsPrivateMutation } from "@/lib/private-scan-api";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!acceptsPrivateMutation(request)) return authRedirect("/login?error=request_rejected");
  try {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut({ scope: "local" });
  } catch {
    // A local sign-out should still return to the public login screen. Session
    // verification on protected routes remains authoritative.
  }
  return authRedirect("/login?signed_out=1");
}
