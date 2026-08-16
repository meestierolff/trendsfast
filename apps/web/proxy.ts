import { deploymentSurface } from "@trendsfast/config";
import { type NextRequest, NextResponse } from "next/server";

import { refreshSupabaseAuthSession } from "./lib/supabase/proxy";

const privateHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
} as const;

function nativeMutationDocument(pathname: string): boolean {
  return (
    pathname === "/login" ||
    pathname === "/dashboard" ||
    pathname.startsWith("/dashboard/") ||
    pathname === "/scan" ||
    pathname.startsWith("/scan/") ||
    pathname === "/ops" ||
    pathname.startsWith("/ops/")
  );
}

function privateReferrerPolicy(request: NextRequest, pathname: string): string {
  const documentRead = request.method === "GET" || request.method === "HEAD";
  return documentRead && nativeMutationDocument(pathname) ? "strict-origin" : "no-referrer";
}

function responseOnlyPath(pathname: string): boolean {
  return (
    pathname === "/auth" ||
    pathname.startsWith("/auth/") ||
    pathname === "/api" ||
    pathname.startsWith("/api/") ||
    pathname === "/v1" ||
    pathname.startsWith("/v1/")
  );
}

function founderPath(pathname: string): boolean {
  return (
    pathname === "/ops" ||
    pathname.startsWith("/ops/") ||
    pathname === "/api/ops" ||
    pathname.startsWith("/api/ops/")
  );
}

function opsCronPath(pathname: string): boolean {
  return pathname === "/api/cron/retention";
}

function opsSurfacePath(pathname: string): boolean {
  return (
    founderPath(pathname) ||
    opsCronPath(pathname) ||
    pathname === "/robots.txt" ||
    pathname === "/favicon.ico" ||
    pathname === "/icon" ||
    pathname.startsWith("/_next/")
  );
}

function memberAuthPath(pathname: string): boolean {
  return (
    pathname === "/login" ||
    pathname === "/dashboard" ||
    pathname.startsWith("/dashboard/") ||
    pathname === "/auth" ||
    pathname.startsWith("/auth/") ||
    pathname === "/api/project-claims" ||
    pathname.startsWith("/api/dashboard/")
  );
}

function hiddenResponse(): NextResponse {
  return new NextResponse("Not Found", {
    status: 404,
    headers: {
      ...privateHeaders,
      "Referrer-Policy": "no-referrer",
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/**
 * Private bearer and founder-operations pages must not be retained by browser,
 * intermediary, or platform caches. Route handlers still enforce their own
 * authorization and mutation checks; this network boundary only hardens the
 * outgoing HTML/RSC response metadata.
 */
export async function proxy(request: NextRequest) {
  const surface = deploymentSurface();
  const pathname = request.nextUrl.pathname;

  // This executes before filesystem routing, database setup, and ops auth.
  if (surface === "public" && (founderPath(pathname) || opsCronPath(pathname))) {
    return hiddenResponse();
  }
  if (surface === "ops" && !opsSurfacePath(pathname)) return hiddenResponse();

  const response =
    surface === "public" && memberAuthPath(pathname)
      ? await refreshSupabaseAuthSession(request)
      : NextResponse.next();
  if (
    surface === "ops" ||
    pathname === "/scan" ||
    pathname.startsWith("/scan/") ||
    memberAuthPath(pathname)
  ) {
    for (const [name, value] of Object.entries(privateHeaders)) {
      response.headers.set(name, value);
    }
    response.headers.set("Referrer-Policy", privateReferrerPolicy(request, pathname));
  } else if (responseOnlyPath(pathname)) {
    response.headers.set("Referrer-Policy", "no-referrer");
  }
  return response;
}

export const config = {
  // Match every pathname so an ops-looking suffix (for example `/ops/a.png`)
  // cannot bypass the public control-plane boundary as if it were a static asset.
  matcher: ["/:path*"],
};
