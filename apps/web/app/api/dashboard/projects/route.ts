import {
  MemberProjectEntryAdmissionError,
  ProjectOwnershipConflictError,
  isMemberConfirmedProjectContext,
} from "@trendsfast/database";
import { hashOpaqueToken } from "@trendsfast/core";
import { z } from "zod";

import { getVerifiedAuthIdentity } from "@/lib/auth-session";
import { readBoundedJsonBody } from "@/lib/bounded-json";
import { acceptsPrivateMutation, PRIVATE_RESPONSE_HEADERS } from "@/lib/private-scan-api";
import { normalizePublicSubmission } from "@/lib/request-security";
import { getMemberRepositories, getPublicRepositories } from "@/lib/server-database";
import {
  resolveWebsiteOnlyContext,
  WebsiteContextResolutionError,
} from "@/lib/website-context-service";

export const runtime = "nodejs";
export const maxDuration = 30;

const BodySchema = z.object({ product_url: z.string().trim().min(1).max(2_048) }).strict();
const WEBSITE_CONTEXT_WINDOW_MS = 24 * 60 * 60 * 1_000;

async function admitWebsiteContextRead(input: {
  authUserId: string;
  normalizedUrl: string;
  now: Date;
}): Promise<boolean> {
  const admission = getPublicRepositories().authAdmission;
  const exactUrl = await admission.admit({
    namespace: "member-website-url-v1",
    fingerprintHash: hashOpaqueToken(`${input.authUserId}:${input.normalizedUrl}`),
    now: input.now,
    windowMs: WEBSITE_CONTEXT_WINDOW_MS,
    // A transient DNS/upstream/save failure must not strand a newly admitted
    // project without context for a full day. The separate per-user gate still
    // caps all website reads at three in the same window.
    maxAttemptsPerFingerprint: 3,
    maxAttemptsGlobal: 500,
    maxFingerprintBuckets: 2_000,
  });
  if (!exactUrl) return false;
  return admission.admit({
    namespace: "member-website-user-v1",
    fingerprintHash: hashOpaqueToken(input.authUserId),
    now: input.now,
    windowMs: WEBSITE_CONTEXT_WINDOW_MS,
    maxAttemptsPerFingerprint: 3,
    maxAttemptsGlobal: 100,
    maxFingerprintBuckets: 2_000,
  });
}

function secondsUntilWebsiteContextWindow(now: Date): number {
  const nextWindow =
    (Math.floor(now.getTime() / WEBSITE_CONTEXT_WINDOW_MS) + 1) * WEBSITE_CONTEXT_WINDOW_MS;
  return Math.max(1, Math.ceil((nextWindow - now.getTime()) / 1_000));
}

function json(body: Record<string, unknown>, status = 200, extraHeaders?: HeadersInit) {
  const headers = new Headers(PRIVATE_RESPONSE_HEADERS);
  if (extraHeaders) {
    for (const [name, value] of new Headers(extraHeaders)) headers.set(name, value);
  }
  return Response.json(body, { status, headers });
}

export async function POST(request: Request) {
  if (!acceptsPrivateMutation(request)) return json({ error: "Request rejected." }, 403);
  const identity = await getVerifiedAuthIdentity();
  if (!identity) return json({ error: "Sign in is required." }, 401);
  const bounded = await readBoundedJsonBody(request, 4_096);
  if (!bounded.ok) {
    return json(
      { error: bounded.reason === "payload_too_large" ? "Request too large." : "Invalid JSON." },
      bounded.reason === "payload_too_large" ? 413 : 400,
    );
  }
  const body = BodySchema.safeParse(bounded.value);
  if (!body.success) return json({ error: "Enter a complete public HTTP(S) product URL." }, 400);

  let url: string;
  try {
    url = normalizePublicSubmission(body.data.product_url);
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : "Enter a valid public product URL." },
      400,
    );
  }

  try {
    const members = getMemberRepositories().members;
    const owned = await members.createOrReuseOwnedProject({ identity, url });
    let contextVersion = owned.contextVersion;
    let observedPageCount: number | null = null;
    if (!contextVersion) {
      const now = new Date();
      if (
        !(await admitWebsiteContextRead({
          authUserId: identity.authUserId,
          normalizedUrl: owned.project.normalizedUrl,
          now,
        }))
      ) {
        const retryAfter = secondsUntilWebsiteContextWindow(now);
        return json(
          {
            error:
              "The bounded website-context read limit has been reached. Try again after the current admission window.",
          },
          429,
          { "retry-after": String(retryAfter) },
        );
      }
      const resolved = await resolveWebsiteOnlyContext(owned.project.url);
      observedPageCount = resolved.observedPageCount;
      const saved = await members.saveOwnedWebsiteContext({
        authUserId: identity.authUserId,
        projectId: owned.project.id,
        context: resolved.context,
        ...resolved.profile,
        sourceContentHash: resolved.sourceContentHash,
      });
      contextVersion = saved.contextVersion;
    }
    const confirmed = isMemberConfirmedProjectContext(contextVersion.createdBy);
    return json(
      {
        ok: true,
        projectId: owned.project.id,
        reused: !owned.created,
        contextStatus: confirmed ? "CONFIRMED" : "CONFIRMATION_REQUIRED",
        ...(observedPageCount === null ? {} : { observedPageCount }),
        destination: `/dashboard/projects?project=${encodeURIComponent(owned.project.id)}${confirmed ? "" : "&confirm=1"}`,
      },
      owned.created ? 201 : 200,
    );
  } catch (error) {
    if (error instanceof MemberProjectEntryAdmissionError) {
      if (error.code === "DESIGN_PARTNER_REQUIRED") {
        return json(
          {
            error:
              "Adding a product requires approved Founder access, an active entitlement, or a design-partner grant on an existing owned project.",
          },
          403,
        );
      }
      if (error.code === "DAILY_LIMIT") {
        const retryAfter = Math.max(1, error.retryAfterSeconds ?? 86_400);
        return json(
          { error: "The daily product-entry limit has been reached. Try again later." },
          429,
          { "retry-after": String(retryAfter) },
        );
      }
      return json(
        { error: "This account has reached the product capacity for the current Founder plan." },
        409,
      );
    }
    if (error instanceof ProjectOwnershipConflictError) {
      return json(
        {
          error:
            "That product URL is already bound to another project. Use its private claim flow or an existing owner account.",
        },
        409,
      );
    }
    if (error instanceof WebsiteContextResolutionError) {
      return json({ error: error.message }, 422);
    }
    return json({ error: "The authenticated project could not be prepared." }, 500);
  }
}
