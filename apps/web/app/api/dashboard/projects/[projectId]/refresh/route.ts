import { PRIVATE_RESPONSE_HEADERS } from "@/lib/private-scan-api";

export const runtime = "nodejs";

/**
 * Retired mutation boundary. Dashboard generation now uses the authenticated,
 * project-scoped v1 contract directly so there is only one admission path.
 */
export async function POST() {
  return Response.json(
    {
      error:
        "This refresh route is retired. Use POST /v1/projects/{project_id}/next-move with a project-scoped API key.",
    },
    { status: 410, headers: PRIVATE_RESPONSE_HEADERS },
  );
}
