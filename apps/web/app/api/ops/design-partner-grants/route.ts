import { z } from "zod";

import { readBoundedJsonBody } from "../../../../lib/bounded-json";
import { getOpsRepositories } from "../../../../lib/server-database";
import { authorizeOpsActionRequest } from "../_security";

export const runtime = "nodejs";

const BodySchema = z
  .object({
    projectId: z.string().uuid(),
    durationDays: z.number().int().min(1).max(30).default(30),
  })
  .strict();

const headers = {
  "cache-control": "no-store, max-age=0",
  pragma: "no-cache",
  "x-content-type-options": "nosniff",
};

export async function POST(request: Request) {
  const authorization = authorizeOpsActionRequest(request);
  if (!authorization.ok) {
    return Response.json({ error: authorization.error }, { status: authorization.status, headers });
  }
  if (!(request.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
    return Response.json(
      { error: "Design-partner grant issuance requires a JSON request body." },
      { status: 415, headers },
    );
  }
  const bounded = await readBoundedJsonBody(request, 8 * 1_024);
  if (!bounded.ok && bounded.reason === "payload_too_large") {
    return Response.json(
      { error: "The grant request body is too large." },
      { status: 413, headers },
    );
  }
  const body = BodySchema.safeParse(bounded.ok ? bounded.value : undefined);
  if (!body.success) {
    return Response.json(
      { error: "The design-partner grant is invalid." },
      { status: 400, headers },
    );
  }

  const now = new Date();
  try {
    const result = await getOpsRepositories().founderGrants.issueDesignPartnerGrant({
      projectId: body.data.projectId,
      issuedBy: authorization.reviewerId,
      now,
      expiresAt: new Date(now.getTime() + body.data.durationDays * 86_400_000),
    });
    return Response.json(
      { ok: true, grant: result.grant, created: result.created },
      { status: result.created ? 201 : 200, headers },
    );
  } catch {
    return Response.json(
      { error: "The design-partner grant could not be issued." },
      { status: 409, headers },
    );
  }
}
