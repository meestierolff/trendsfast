import { loadPublicSourceProjection } from "../../../lib/source-projection-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const projection = await loadPublicSourceProjection();
  return Response.json(
    { sources: projection.sources },
    {
      headers: {
        "cache-control": "private, no-store, max-age=0",
        "x-trendsfast-source-projection-state": projection.state,
        "x-content-type-options": "nosniff",
      },
    },
  );
}
