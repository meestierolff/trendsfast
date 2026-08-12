import { readBoundedBodyBytes } from "../../../../../lib/bounded-json";
import { getRepositories } from "../../../../../lib/server-database";
import { authorizeOpsActionRequest } from "../../_security";

export const runtime = "nodejs";

const headers = {
  "cache-control": "private, no-store, max-age=0",
  pragma: "no-cache",
  "x-content-type-options": "nosniff",
};

function json(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ interestId: string }> },
) {
  const authorization = authorizeOpsActionRequest(request);
  if (!authorization.ok) return json({ error: authorization.error }, authorization.status);
  const body = await readBoundedBodyBytes(request, 1);
  if (!body.ok || body.value.byteLength !== 0) {
    return json({ error: "Launch-interest deletion does not accept a request body." }, 413);
  }
  const { interestId } = await params;
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(interestId)
  ) {
    return json({ error: "The launch-interest identifier is invalid." }, 400);
  }
  try {
    const result = await getRepositories().founderLaunchInterests.hardDelete({
      id: interestId,
      actorId: authorization.reviewerId,
    });
    if (!result.deleted) return json({ error: "The launch-interest record was not found." }, 404);
    return json({ deleted: true });
  } catch {
    return json({ error: "The launch-interest record could not be deleted." }, 409);
  }
}
