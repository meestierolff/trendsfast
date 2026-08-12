import { z } from "zod";

import { getRepositories } from "../../../../../../lib/server-database";
import { authorizeOpsActionRequest } from "../../../_security";

export const runtime = "nodejs";

const headers = {
  "cache-control": "no-store, max-age=0",
  pragma: "no-cache",
  "x-content-type-options": "nosniff",
};

export async function POST(request: Request, context: { params: Promise<{ grantId: string }> }) {
  const authorization = authorizeOpsActionRequest(request);
  if (!authorization.ok) {
    return Response.json({ error: authorization.error }, { status: authorization.status, headers });
  }
  const parsed = z
    .string()
    .uuid()
    .safeParse((await context.params).grantId);
  if (!parsed.success) {
    return Response.json(
      { error: "The design-partner grant ID is invalid." },
      { status: 400, headers },
    );
  }
  const result = await getRepositories().founderGrants.revoke({
    grantId: parsed.data,
    revokedBy: authorization.reviewerId,
  });
  if (!result) {
    return Response.json(
      { error: "The design-partner grant was not found." },
      { status: 404, headers },
    );
  }
  return Response.json({ ok: true, grant: result.grant, revoked: result.revoked }, { headers });
}
