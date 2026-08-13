import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { requireSupabasePublicConfig } from "./config";

/** A new cookie-backed PKCE client is created for every server request. */
export async function createSupabaseServerClient() {
  const config = requireSupabasePublicConfig();
  const cookieStore = await cookies();

  return createServerClient(config.url, config.publishableKey, {
    auth: {
      flowType: "pkce",
      experimental: { appendPkceFlowIdToRedirects: true },
    },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot emit Set-Cookie. The proxy refreshes the
          // session before render; Route Handlers can write these cookies.
        }
      },
    },
  });
}
