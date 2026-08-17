import { z } from "zod";

import { getVerifiedAuthSubject } from "@/lib/auth-session";
import { readBoundedJsonBody } from "@/lib/bounded-json";
import { acceptsPrivateMutation, PRIVATE_RESPONSE_HEADERS } from "@/lib/private-scan-api";
import { getMemberRepositories } from "@/lib/server-database";

export const runtime = "nodejs";

const BodySchema = z
  .object({
    nextMoveId: z.string().uuid(),
    kind: z.enum(["USED", "PUBLISHED", "REPLIED", "REMIXED"]),
    notes: z.string().trim().max(2_000).optional(),
  })
  .strict();

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
  if (!body.success) return json({ error: "Outcome is invalid." }, 400);
  try {
    const result = await getMemberRepositories().members.recordProjectOutcome({
      authUserId,
      projectId,
      nextMoveId: body.data.nextMoveId,
      kind: body.data.kind,
      ...(body.data.notes ? { notes: body.data.notes } : {}),
    });
    if (!result) return json({ error: "Next Move not found." }, 404);
    return json({ ok: true, outcome: { id: result.id, kind: result.kind } }, 201);
  } catch {
    return json({ error: "The outcome could not be saved." }, 403);
  }
}
