import { sql } from "drizzle-orm";

import type { TrendsFastDatabase } from "../client";

/**
 * Serializes project-claim creation/consumption with delivery revocation.
 * Call this before locking a project_claims row for the same delivery.
 */
export async function lockProjectClaimDeliveryScope(
  db: TrendsFastDatabase,
  deliveryTokenId: string,
): Promise<void> {
  await db.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`trendsfast:project-claim-delivery:${deliveryTokenId}`}, 0))`,
  );
}
