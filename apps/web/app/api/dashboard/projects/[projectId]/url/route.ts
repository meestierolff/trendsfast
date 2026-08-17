import { PublicHttpUrlSchema } from "@trendsfast/schemas";
import { MemberProjectBusyError } from "@trendsfast/database";
import { z } from "zod";

import { getVerifiedAuthSubject } from "@/lib/auth-session";
import { readBoundedJsonBody } from "@/lib/bounded-json";
import { acceptsPrivateMutation, PRIVATE_RESPONSE_HEADERS } from "@/lib/private-scan-api";
import { getMemberRepositories } from "@/lib/server-database";
import { normalizePublicSubmission } from "@/lib/request-security";

export const runtime = "nodejs";

const BodySchema = z.object({ url: PublicHttpUrlSchema }).strict();

function json(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: PRIVATE_RESPONSE_HEADERS });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  if (!acceptsPrivateMutation(request)) return json({ error: "Request rejected." }, 403);
  const authUserId = await getVerifiedAuthSubject();
  if (!authUserId) return json({ error: "Sign in is required." }, 401);
  const { projectId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(projectId)) return json({ error: "Project not found." }, 404);
  const bounded = await readBoundedJsonBody(request, 4_096);
  if (!bounded.ok) {
    return json(
      { error: bounded.reason === "payload_too_large" ? "Request too large." : "Invalid JSON." },
      bounded.reason === "payload_too_large" ? 413 : 400,
    );
  }
  const body = BodySchema.safeParse(bounded.value);
  if (!body.success) return json({ error: "Enter a valid public HTTP(S) project URL." }, 400);
  let url: string;
  try {
    url = normalizePublicSubmission(body.data.url);
  } catch {
    return json({ error: "Private and local network URLs are not accepted." }, 400);
  }

  try {
    const result = await getMemberRepositories().members.updateProjectUrl({
      authUserId,
      projectId,
      url,
    });
    return json({
      ok: true,
      changed: result.changed,
      url: result.project.url,
      requiresRefresh: result.changed,
    });
  } catch (error) {
    if (error instanceof MemberProjectBusyError) {
      return json(
        { error: "Wait for the current proposal run to finish before changing URL." },
        409,
      );
    }
    if (error instanceof Error && error.message.includes("already owned by another project")) {
      return json({ error: "That URL already belongs to another claimed project." }, 409);
    }
    return json({ error: "The project URL could not be updated." }, 403);
  }
}
