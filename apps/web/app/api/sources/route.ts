import { listPublicSourceStatuses } from "../../../lib/source-projection-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const sources = await listPublicSourceStatuses();
  return Response.json(
    { sources },
    {
      headers: {
        "cache-control": "private, no-store, max-age=0",
        "x-content-type-options": "nosniff",
      },
    },
  );
}
