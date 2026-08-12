import { authorizeOpsActionRequest } from "../../_security";

export const runtime = "nodejs";

const headers = {
  "cache-control": "no-store, max-age=0",
  pragma: "no-cache",
  "x-content-type-options": "nosniff",
};

/** Checkout is available only from a private, delivered result capability. */
export async function POST(request: Request) {
  const authorization = authorizeOpsActionRequest(request);
  if (!authorization.ok) {
    return Response.json({ error: authorization.error }, { status: authorization.status, headers });
  }
  return Response.json(
    { error: "Checkout starts only from a private delivered Next Move." },
    { status: 410, headers },
  );
}
