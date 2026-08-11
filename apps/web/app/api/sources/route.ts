import { listPublicSourceStatuses } from "../../../lib/source-projection-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const sources = await listPublicSourceStatuses();
  return Response.json(
    { sources },
    {
      headers: {
        "cache-control": "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
        "x-content-type-options": "nosniff",
      },
    },
  );
}
