import { NextResponse } from "next/server";

import { loadEnv } from "@trendsfast/config";

import { readBoundedFormBody, readBoundedJsonBody } from "../../../../lib/bounded-json";
import { anonymizeAddress, clientAddress } from "../../../../lib/request-security";
import { getRepositories } from "../../../../lib/server-database";
import {
  authenticateOpsLoginRequest,
  MAX_OPS_LOGIN_BODY_BYTES,
} from "../../../../lib/ops-login-guard";
import { isOpsSameOrigin } from "../_security";

const privateHeaders = {
  "cache-control": "private, no-store, max-age=0",
  pragma: "no-cache",
  "x-content-type-options": "nosniff",
} as const;

export async function POST(request: Request) {
  if (!isOpsSameOrigin(request)) {
    return NextResponse.json(
      { error: "Cross-site operations requests are not accepted." },
      { status: 403, headers: privateHeaders },
    );
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (
    contentType.includes("application/x-www-form-urlencoded") ||
    contentType.includes("multipart/form-data")
  ) {
    const form = await readBoundedFormBody(request, MAX_OPS_LOGIN_BODY_BYTES);
    if (!form.ok && form.reason === "payload_too_large") {
      return NextResponse.json(
        { error: "The operations request body is too large." },
        { status: 413, headers: privateHeaders },
      );
    }
    if (form.ok && form.value._method === "delete") return logoutResponse();
    return NextResponse.json(
      { error: "Operations login requires JSON." },
      { status: 415, headers: privateHeaders },
    );
  }
  if (!contentType.toLowerCase().includes("application/json")) {
    return NextResponse.json(
      { error: "Operations login requires JSON." },
      { status: 415, headers: privateHeaders },
    );
  }
  const parsedBody = await readBoundedJsonBody(request, MAX_OPS_LOGIN_BODY_BYTES);
  if (!parsedBody.ok) {
    return NextResponse.json(
      {
        error:
          parsedBody.reason === "payload_too_large"
            ? "The operations login body is too large."
            : "Operations login failed.",
      },
      {
        status: parsedBody.reason === "payload_too_large" ? 413 : 401,
        headers: privateHeaders,
      },
    );
  }
  const env = loadEnv();
  const fingerprintSecret = env.API_KEY_PEPPER ?? env.SESSION_SECRET;
  if (!fingerprintSecret || fingerprintSecret.length < 32) {
    return NextResponse.json(
      { error: "Operations access is unavailable." },
      { status: 503, headers: privateHeaders },
    );
  }
  const durablyAdmitted = await getRepositories().authAdmission.admit({
    namespace: "ops",
    fingerprintHash: anonymizeAddress(clientAddress(request.headers), fingerprintSecret),
    windowMs: 5 * 60_000,
    maxAttemptsPerFingerprint: 5,
    maxAttemptsGlobal: 100,
    maxFingerprintBuckets: 512,
  });
  if (!durablyAdmitted) {
    return NextResponse.json(
      { error: "Too many operations login attempts. Try again later." },
      { status: 429, headers: { ...privateHeaders, "retry-after": "300" } },
    );
  }
  const authentication = await authenticateOpsLoginRequest(request, {
    parsedBody: parsedBody.value,
  });
  if (!authentication.ok) {
    return NextResponse.json(
      { error: authentication.error },
      {
        status: authentication.status,
        headers: {
          ...privateHeaders,
          ...(authentication.status === 429 ? { "retry-after": "300" } : {}),
        },
      },
    );
  }
  const response = NextResponse.json({ ok: true }, { headers: privateHeaders });
  response.cookies.set("tf_ops_session", authentication.sessionToken, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 8 * 60 * 60,
  });
  return response;
}

function logoutResponse() {
  const response = NextResponse.redirect(
    new URL("/ops", process.env.APP_URL ?? "http://localhost:3000"),
    303,
  );
  response.headers.set("cache-control", privateHeaders["cache-control"]);
  response.headers.set("pragma", privateHeaders.pragma);
  response.cookies.set("tf_ops_session", "", {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}

export async function DELETE(request: Request) {
  if (!isOpsSameOrigin(request)) {
    return NextResponse.json(
      { error: "Cross-site operations requests are not accepted." },
      { status: 403, headers: privateHeaders },
    );
  }
  return logoutResponse();
}
