import { NextResponse } from "next/server";

import { PRIVATE_RESPONSE_HEADERS } from "../../../../../lib/private-scan-api";
import { getScanStatusByToken } from "../../../../../lib/scan-view-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const status = await getScanStatusByToken(token);
  return NextResponse.json(status, {
    status: status.found ? 200 : 404,
    headers: PRIVATE_RESPONSE_HEADERS,
  });
}
