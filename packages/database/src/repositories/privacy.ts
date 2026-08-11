import { and, eq, inArray, isNull, lt, notExists, or } from "drizzle-orm";

import type { TrendsFastDatabase } from "../client";
import {
  analyticsEvents,
  apiKeyAuthEvents,
  apiKeyManagementEvents,
  apiKeys,
  deliveryTokens,
  nextMoves,
  projects,
  scanRequests,
  stripeCustomers,
} from "../schema";
import { normalizeProductUrl } from "./lifecycle";

export type ProjectDeletionTarget =
  { projectId: string; normalizedUrl?: never } | { projectId?: never; normalizedUrl: string };

export function retentionCutoff(now: Date, retentionDays: number): Date {
  if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 365) {
    throw new Error("Retention days must be an integer between 1 and 365");
  }
  if (Number.isNaN(now.getTime())) throw new Error("Retention time is invalid");
  return new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1_000);
}

export class PrivacyRepository {
  constructor(private readonly db: TrendsFastDatabase) {}

  async deleteProjectData(target: ProjectDeletionTarget) {
    if (
      ("projectId" in target && !target.projectId) ||
      ("normalizedUrl" in target && !target.normalizedUrl)
    ) {
      throw new Error("Project deletion requires one exact project ID or normalized URL");
    }

    const projectFilter =
      "projectId" in target && target.projectId
        ? eq(projects.id, target.projectId)
        : eq(
            projects.normalizedUrl,
            normalizeProductUrl((target as { normalizedUrl: string }).normalizedUrl),
          );

    return this.db.transaction(async (tx) => {
      const [project] = await tx
        .select({ id: projects.id })
        .from(projects)
        .where(projectFilter)
        .limit(1);
      if (!project) {
        return {
          found: false as const,
          projectId: null,
          deletedScanRequests: 0,
          deletedApiKeys: 0,
          deletedApiKeyManagementEvents: 0,
          deletedAnalyticsEvents: 0,
        };
      }

      const requestIds = (
        await tx
          .select({ id: scanRequests.id })
          .from(scanRequests)
          .where(eq(scanRequests.projectId, project.id))
      ).map((row) => row.id);
      const moveIds = requestIds.length
        ? (
            await tx
              .select({ id: nextMoves.id })
              .from(nextMoves)
              .where(inArray(nextMoves.scanRequestId, requestIds))
          ).map((row) => row.id)
        : [];
      const keyIds = (
        await tx.select({ id: apiKeys.id }).from(apiKeys).where(eq(apiKeys.projectId, project.id))
      ).map((row) => row.id);

      let deletedAnalyticsEvents = 0;
      const analyticsFilters = [
        requestIds.length ? inArray(analyticsEvents.scanRequestId, requestIds) : undefined,
        moveIds.length ? inArray(analyticsEvents.nextMoveId, moveIds) : undefined,
        keyIds.length ? inArray(analyticsEvents.apiKeyId, keyIds) : undefined,
      ].filter((value) => value !== undefined);
      if (analyticsFilters.length) {
        const deleted = await tx
          .delete(analyticsEvents)
          .where(or(...analyticsFilters))
          .returning({ id: analyticsEvents.id });
        deletedAnalyticsEvents = deleted.length;
      }
      if (keyIds.length) {
        await tx.delete(apiKeyAuthEvents).where(inArray(apiKeyAuthEvents.apiKeyId, keyIds));
      }
      const deletedKeyManagementEvents = await tx
        .delete(apiKeyManagementEvents)
        .where(eq(apiKeyManagementEvents.projectId, project.id))
        .returning({ id: apiKeyManagementEvents.id });
      const deletedKeys = await tx
        .delete(apiKeys)
        .where(eq(apiKeys.projectId, project.id))
        .returning({ id: apiKeys.id });
      const deletedRequests = await tx
        .delete(scanRequests)
        .where(eq(scanRequests.projectId, project.id))
        .returning({ id: scanRequests.id });
      await tx.delete(stripeCustomers).where(eq(stripeCustomers.projectId, project.id));
      await tx.delete(projects).where(eq(projects.id, project.id));

      return {
        found: true as const,
        projectId: project.id,
        deletedScanRequests: deletedRequests.length,
        deletedApiKeys: deletedKeys.length,
        deletedApiKeyManagementEvents: deletedKeyManagementEvents.length,
        deletedAnalyticsEvents,
      };
    });
  }

  async purgeExpired(now: Date, retentionDays: number) {
    const cutoff = retentionCutoff(now, retentionDays);
    return this.db.transaction(async (tx) => {
      const expiredRequests = await tx
        .select({ id: scanRequests.id })
        .from(scanRequests)
        .where(
          or(
            and(
              inArray(scanRequests.state, ["READY", "FAILED"]),
              or(
                lt(scanRequests.completedAt, cutoff),
                and(isNull(scanRequests.completedAt), lt(scanRequests.submittedAt, cutoff)),
              ),
            ),
            and(
              inArray(scanRequests.state, ["QUEUED", "RUNNING", "REVIEW_REQUIRED"]),
              lt(scanRequests.submittedAt, cutoff),
            ),
          ),
        );
      const requestIds = expiredRequests.map((row) => row.id);
      const moveIds = requestIds.length
        ? (
            await tx
              .select({ id: nextMoves.id })
              .from(nextMoves)
              .where(inArray(nextMoves.scanRequestId, requestIds))
          ).map((row) => row.id)
        : [];

      let deletedAnalyticsEvents = 0;
      if (requestIds.length || moveIds.length) {
        const filters = [
          requestIds.length ? inArray(analyticsEvents.scanRequestId, requestIds) : undefined,
          moveIds.length ? inArray(analyticsEvents.nextMoveId, moveIds) : undefined,
        ].filter((value) => value !== undefined);
        const deleted = await tx
          .delete(analyticsEvents)
          .where(or(...filters))
          .returning({ id: analyticsEvents.id });
        deletedAnalyticsEvents = deleted.length;
      }
      const deletedRequests = requestIds.length
        ? await tx
            .delete(scanRequests)
            .where(inArray(scanRequests.id, requestIds))
            .returning({ id: scanRequests.id })
        : [];
      const deletedTokens = await tx
        .delete(deliveryTokens)
        .where(lt(deliveryTokens.expiresAt, now))
        .returning({ id: deliveryTokens.id });

      const deletedProjects = await tx
        .delete(projects)
        .where(
          and(
            lt(projects.updatedAt, cutoff),
            notExists(
              tx
                .select({ id: scanRequests.id })
                .from(scanRequests)
                .where(eq(scanRequests.projectId, projects.id)),
            ),
            notExists(
              tx.select({ id: apiKeys.id }).from(apiKeys).where(eq(apiKeys.projectId, projects.id)),
            ),
            notExists(
              tx
                .select({ id: stripeCustomers.id })
                .from(stripeCustomers)
                .where(eq(stripeCustomers.projectId, projects.id)),
            ),
          ),
        )
        .returning({ id: projects.id });

      return {
        cutoff,
        deletedScanRequests: deletedRequests.length,
        deletedDeliveryTokens: deletedTokens.length,
        deletedAnalyticsEvents,
        deletedOrphanProjects: deletedProjects.length,
      };
    });
  }
}
