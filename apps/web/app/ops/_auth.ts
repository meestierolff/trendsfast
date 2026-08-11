import { cookies } from "next/headers";

import { createCsrfToken, verifyOpsSession } from "../../lib/ops-session";

export type OpsPageAuthorization = {
  csrfToken: string;
  reviewerId: string;
};

export async function getOpsPageAuthorization(): Promise<OpsPageAuthorization | null> {
  const secret = process.env.SESSION_SECRET ?? "";
  if (secret.length < 32) return null;

  const cookieStore = await cookies();
  const sessionToken = cookieStore.get("tf_ops_session")?.value;
  const session = verifyOpsSession(sessionToken, { secret });
  if (!session || !sessionToken) return null;

  return {
    csrfToken: createCsrfToken(sessionToken, secret),
    reviewerId: `founder:${session.nonce.slice(0, 12)}`,
  };
}
