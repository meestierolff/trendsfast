import { NextResponse } from "next/server";

/**
 * Private bearer and founder-operations pages must not be retained by browser,
 * intermediary, or platform caches. Route handlers still enforce their own
 * authorization and mutation checks; this network boundary only hardens the
 * outgoing HTML/RSC response metadata.
 */
export function proxy() {
  const response = NextResponse.next();
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  return response;
}

export const config = {
  matcher: ["/scan/:path*", "/ops/:path*"],
};
