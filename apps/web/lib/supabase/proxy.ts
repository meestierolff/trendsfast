import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

import { readSupabasePublicConfig } from "./config";

/**
 * Refreshes signed Supabase session cookies. This is session maintenance, not
 * authorization: every dashboard query still verifies claims and membership.
 */
export async function refreshSupabaseAuthSession(request: NextRequest): Promise<NextResponse> {
  const config = readSupabasePublicConfig();
  if (!config) return NextResponse.next({ request });

  let response = NextResponse.next({ request });
  const supabase = createServerClient(config.url, config.publishableKey, {
    auth: {
      flowType: "pkce",
      experimental: { appendPkceFlowIdToRedirects: true },
    },
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // getClaims verifies the JWT; getSession alone is never trusted server-side.
  await supabase.auth.getClaims();
  return response;
}
