import { after, NextResponse } from "next/server";
import { loadEnv } from "@trendsfast/config";
import { readBoundedJsonBody } from "../../../lib/bounded-json";
import {
  analyticsSessionCookie,
  analyticsSessionForRequest,
} from "../../../lib/first-party-analytics";
import { getRepositories } from "../../../lib/server-database";
import { acceptPublicScan, isSameOrigin, PublicScanError } from "../../../lib/public-scan-service";
import { clientAddress } from "../../../lib/request-security";
import { runPersistedScan } from "../../../lib/scan-processing";
import { createTurnstileVerifier } from "../../../lib/turnstile";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  const env = loadEnv();
  if (!isSameOrigin(request, env.APP_URL)) {
    return NextResponse.json(
      { error: "Cross-site scan requests are not accepted." },
      { status: 403 },
    );
  }
  const parsedBody = await readBoundedJsonBody(request, 8_192);
  if (!parsedBody.ok && parsedBody.reason === "payload_too_large") {
    return NextResponse.json({ error: "The request body is too large." }, { status: 413 });
  }
  if (!parsedBody.ok || typeof parsedBody.value !== "object" || parsedBody.value === null) {
    return NextResponse.json({ error: "A JSON request body is required." }, { status: 400 });
  }
  const body = parsedBody.value as {
    product_url?: unknown;
    website?: unknown;
    turnstile_token?: unknown;
  };

  const fingerprintPepper = env.API_KEY_PEPPER ?? env.SESSION_SECRET;
  if (!fingerprintPepper || fingerprintPepper.length < 32) {
    return NextResponse.json(
      { error: "Public scans are temporarily unavailable." },
      { status: 503 },
    );
  }
  const repositories = getRepositories();
  const address = clientAddress(request.headers);
  try {
    const accepted = await acceptPublicScan(
      {
        productUrl: body.product_url,
        address,
        honeypot: body.website,
        ...(typeof body.turnstile_token === "string"
          ? { turnstileToken: body.turnstile_token }
          : {}),
      },
      {
        repository: repositories.scans,
        fingerprintPepper,
        dailyLimit: env.PUBLIC_SCAN_DAILY_LIMIT,
        ...(env.TURNSTILE_ENABLED && env.TURNSTILE_SECRET_KEY
          ? { turnstile: createTurnstileVerifier(env.TURNSTILE_SECRET_KEY) }
          : {}),
      },
    );
    const analyticsSession =
      env.SESSION_SECRET && env.SESSION_SECRET.length >= 32
        ? analyticsSessionForRequest(request, env.SESSION_SECRET)
        : null;
    await repositories.analytics
      .append({
        name: "free_scan_submitted",
        ...(analyticsSession
          ? { anonymousSessionHash: analyticsSession.anonymousSessionHash }
          : {}),
        scanRequestId: accepted.scanRequestId,
        properties: { reused: accepted.reused },
      })
      .catch(() => undefined);
    if (!accepted.reused && env.PUBLIC_SCAN_PROCESSING === "inline") {
      after(async () => {
        await runPersistedScan(accepted.token).catch(() => undefined);
      });
    }
    const response = NextResponse.json(
      { token: accepted.token, status: "QUEUED", reused: accepted.reused },
      { status: accepted.reused ? 200 : 202, headers: { "cache-control": "no-store" } },
    );
    if (analyticsSession?.rawSessionToSet) {
      response.headers.set(
        "set-cookie",
        analyticsSessionCookie(
          analyticsSession.rawSessionToSet,
          env.APP_URL.startsWith("https://"),
        ),
      );
    }
    return response;
  } catch (error) {
    if (error instanceof PublicScanError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "The request could not be accepted." }, { status: 500 });
  }
}
