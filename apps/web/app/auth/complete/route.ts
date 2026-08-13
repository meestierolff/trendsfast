import { authRedirect, finishVerifiedAuth } from "@/lib/auth-flow";
import { getVerifiedAuthSubject } from "@/lib/auth-session";

export const runtime = "nodejs";

export async function GET() {
  try {
    if (!(await getVerifiedAuthSubject())) return authRedirect("/login");
    return finishVerifiedAuth("/dashboard");
  } catch {
    return authRedirect("/login?error=verification_failed");
  }
}
