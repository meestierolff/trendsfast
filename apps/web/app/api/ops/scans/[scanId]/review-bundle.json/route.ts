import { authorizeOpsReadRequest } from "../../../_security";
import { getRepositories } from "../../../../../../lib/server-database";
import { buildReviewBundle } from "../../../../../../lib/review-bundle-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const privateHeaders = {
  "cache-control": "private, no-store, max-age=0",
  pragma: "no-cache",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-robots-tag": "noindex, nofollow",
} as const;

export async function GET(request: Request, { params }: { params: Promise<{ scanId: string }> }) {
  const authorization = authorizeOpsReadRequest(request);
  if (!authorization.ok) {
    return Response.json(
      { error: authorization.error },
      { status: authorization.status, headers: privateHeaders },
    );
  }
  const { scanId } = await params;
  if (!/^[A-Za-z0-9_.-]{1,100}$/.test(scanId)) {
    return Response.json(
      { error: "The scan identifier is invalid." },
      { status: 400, headers: privateHeaders },
    );
  }
  const bundle = await buildReviewBundle(getRepositories(), scanId);
  if (!bundle) {
    return Response.json(
      { error: "The review bundle was not found." },
      { status: 404, headers: privateHeaders },
    );
  }
  return Response.json(bundle, {
    headers: {
      ...privateHeaders,
      "content-disposition": `attachment; filename="trendsfast-${encodeURIComponent(scanId)}-review.json"`,
    },
  });
}
