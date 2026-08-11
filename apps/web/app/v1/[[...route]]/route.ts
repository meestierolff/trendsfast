import { after } from "next/server";

import { createV1Api } from "../../../lib/v1-api";
import { createV1Service } from "../../../lib/v1-service";
import { runPersistedScan } from "../../../lib/scan-processing";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

function handler(request: Request) {
  const app = createV1Api(
    createV1Service({
      schedule(publicId) {
        after(async () => {
          await runPersistedScan(publicId).catch(() => undefined);
        });
      },
    }),
  );
  return app.fetch(request);
}

export const GET = handler;
export const POST = handler;
