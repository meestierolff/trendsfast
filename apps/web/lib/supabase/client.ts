"use client";

import { createBrowserClient } from "@supabase/ssr";

import { requireSupabasePublicConfig } from "./config";

/** Browser client is used for Auth only; never call `.from()` from the UI. */
export function createSupabaseBrowserClient() {
  const config = requireSupabasePublicConfig();
  return createBrowserClient(config.url, config.publishableKey, {
    auth: {
      flowType: "pkce",
      experimental: { appendPkceFlowIdToRedirects: true },
    },
  });
}
