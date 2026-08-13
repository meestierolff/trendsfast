import { and, count, eq, inArray, isNull, lt, lte, notExists, or, sql } from "drizzle-orm";

import type { TrendsFastDatabase } from "../client";
import {
  analyticsEvents,
  apiKeyAuthEvents,
  apiKeyManagementEvents,
  apiKeys,
  billingCheckoutSessions,
  deliveryTokens,
  founderLaunchInterestEvents,
  founderLaunchInterests,
  founderEntitlementGrantEvents,
  founderEntitlementGrants,
  founderUsageEvents,
  nextMoves,
  projectMemberships,
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

type ManagedRetentionPurgeRow = {
  retention_cutoff: Date | string;
  deleted_scan_requests: number | string;
  deleted_delivery_tokens: number | string;
  deleted_analytics_events: number | string;
  deleted_founder_launch_interests: number | string;
  remaining_expired_founder_launch_interests: number | string;
  deleted_orphan_projects: number | string;
};

function boundedCount(value: number | string, field: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Managed retention returned an invalid ${field} count`);
  }
  return parsed;
}

export class PrivacyRepository {
  constructor(private readonly db: TrendsFastDatabase) {}

  async deleteProjectData(target: ProjectDeletionTarget) {
    const projectId = typeof target.projectId === "string" ? target.projectId.trim() : "";
    const normalizedUrlInput =
      typeof target.normalizedUrl === "string" ? target.normalizedUrl.trim() : "";
    if (Number(Boolean(projectId)) + Number(Boolean(normalizedUrlInput)) !== 1) {
      throw new Error("Project deletion requires one exact project ID or normalized URL");
    }

    const normalizedTarget = normalizedUrlInput ? normalizeProductUrl(normalizedUrlInput) : null;
    const projectFilter = projectId
      ? eq(projects.id, projectId)
      : eq(projects.normalizedUrl, normalizedTarget!);

    return this.db.transaction(async (tx) => {
      const [project] = await tx
        .select({ id: projects.id, normalizedUrl: projects.normalizedUrl })
        .from(projects)
        .where(projectFilter)
        .limit(1);
      const requestFilter = project
        ? or(
            eq(scanRequests.projectId, project.id),
            eq(scanRequests.normalizedUrl, project.normalizedUrl),
          )
        : eq(scanRequests.normalizedUrl, normalizedTarget!);
      const requestIds = (
        await tx.select({ id: scanRequests.id }).from(scanRequests).where(requestFilter)
      ).map((row) => row.id);
      if (!project && requestIds.length === 0) {
        return {
          found: false as const,
          projectId: null,
          deletedScanRequests: 0,
          deletedApiKeys: 0,
          deletedApiKeyManagementEvents: 0,
          deletedAnalyticsEvents: 0,
        };
      }

      const moveIds = requestIds.length
        ? (
            await tx
              .select({ id: nextMoves.id })
              .from(nextMoves)
              .where(inArray(nextMoves.scanRequestId, requestIds))
          ).map((row) => row.id)
        : [];
      const keyIds = project
        ? (
            await tx
              .select({ id: apiKeys.id })
              .from(apiKeys)
              .where(eq(apiKeys.projectId, project.id))
          ).map((row) => row.id)
        : [];

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
      const deletedKeyManagementEvents = project
        ? await tx
            .delete(apiKeyManagementEvents)
            .where(eq(apiKeyManagementEvents.projectId, project.id))
            .returning({ id: apiKeyManagementEvents.id })
        : [];
      if (project) {
        await tx
          .delete(founderEntitlementGrantEvents)
          .where(eq(founderEntitlementGrantEvents.projectId, project.id));
        await tx.delete(founderUsageEvents).where(eq(founderUsageEvents.projectId, project.id));
        await tx
          .delete(founderEntitlementGrants)
          .where(eq(founderEntitlementGrants.projectId, project.id));
        await tx
          .delete(billingCheckoutSessions)
          .where(eq(billingCheckoutSessions.projectId, project.id));
      }
      const deletedKeys = project
        ? await tx
            .delete(apiKeys)
            .where(eq(apiKeys.projectId, project.id))
            .returning({ id: apiKeys.id })
        : [];
      const deletedRequests = requestIds.length
        ? await tx
            .delete(scanRequests)
            .where(inArray(scanRequests.id, requestIds))
            .returning({ id: scanRequests.id })
        : [];
      if (project) {
        await tx.delete(stripeCustomers).where(eq(stripeCustomers.projectId, project.id));
        await tx.delete(projects).where(eq(projects.id, project.id));
      }

      return {
        found: true as const,
        projectId: project?.id ?? null,
        deletedScanRequests: deletedRequests.length,
        deletedApiKeys: deletedKeys.length,
        deletedApiKeyManagementEvents: deletedKeyManagementEvents.length,
        deletedAnalyticsEvents,
      };
    });
  }

  /** Function-only hosted retention path; policy and cutoff remain database-owned. */
  async purgeManaged(expectedRevision: string) {
    if (!/^[A-Za-z0-9_-]{32,200}$/.test(expectedRevision)) {
      throw new Error("Managed runtime policy revision is invalid");
    }
    const result = await this.db.execute<ManagedRetentionPurgeRow>(sql`
      select retention_cutoff,
             deleted_scan_requests,
             deleted_delivery_tokens,
             deleted_analytics_events,
             deleted_founder_launch_interests,
             remaining_expired_founder_launch_interests,
             deleted_orphan_projects
        from public.trendsfast_purge_retained_data(${expectedRevision})
    `);
    const row = result.rows[0];
    if (!row || result.rows.length !== 1) {
      throw new Error("Managed retention did not return its aggregate result");
    }
    const cutoff =
      row.retention_cutoff instanceof Date ? row.retention_cutoff : new Date(row.retention_cutoff);
    if (Number.isNaN(cutoff.getTime())) {
      throw new Error("Managed retention returned an invalid cutoff");
    }
    return {
      cutoff,
      deletedScanRequests: boundedCount(row.deleted_scan_requests, "scan request"),
      deletedDeliveryTokens: boundedCount(row.deleted_delivery_tokens, "delivery token"),
      deletedAnalyticsEvents: boundedCount(row.deleted_analytics_events, "analytics event"),
      deletedFounderLaunchInterests: boundedCount(
        row.deleted_founder_launch_interests,
        "founder launch interest",
      ),
      remainingExpiredFounderLaunchInterests: boundedCount(
        row.remaining_expired_founder_launch_interests,
        "expired founder launch interest backlog",
      ),
      deletedOrphanProjects: boundedCount(row.deleted_orphan_projects, "orphan project"),
    };
  }

  async purgeExpired(now: Date, retentionDays: number) {
    const cutoff = retentionCutoff(now, retentionDays);
    return this.db.transaction(async (tx) => {
      const founderInterestBatchSize = 500;
      const founderInterestBatchLimit = 20;
      let deletedFounderLaunchInterests = 0;
      for (let batch = 0; batch < founderInterestBatchLimit; batch += 1) {
        const expiredFounderInterests = await tx
          .select({ id: founderLaunchInterests.id })
          .from(founderLaunchInterests)
          .where(lte(founderLaunchInterests.expiresAt, now))
          .limit(founderInterestBatchSize)
          .for("update", { skipLocked: true });
        if (expiredFounderInterests.length === 0) break;
        await tx.insert(founderLaunchInterestEvents).values(
          expiredFounderInterests.map((interest) => ({
            interestReference: interest.id,
            action: "PURGED" as const,
            actorId: "system:retention",
            occurredAt: now,
          })),
        );
        await tx.delete(founderLaunchInterests).where(
          inArray(
            founderLaunchInterests.id,
            expiredFounderInterests.map((interest) => interest.id),
          ),
        );
        deletedFounderLaunchInterests += expiredFounderInterests.length;
        if (expiredFounderInterests.length < founderInterestBatchSize) break;
      }
      const [founderInterestBacklog] = await tx
        .select({ value: count() })
        .from(founderLaunchInterests)
        .where(lte(founderLaunchInterests.expiresAt, now));

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

      const oldAnonymousAnalytics = await tx
        .delete(analyticsEvents)
        .where(lt(analyticsEvents.occurredAt, cutoff))
        .returning({ id: analyticsEvents.id });
      let deletedAnalyticsEvents = oldAnonymousAnalytics.length;
      if (requestIds.length || moveIds.length) {
        const filters = [
          requestIds.length ? inArray(analyticsEvents.scanRequestId, requestIds) : undefined,
          moveIds.length ? inArray(analyticsEvents.nextMoveId, moveIds) : undefined,
        ].filter((value) => value !== undefined);
        const deleted = await tx
          .delete(analyticsEvents)
          .where(or(...filters))
          .returning({ id: analyticsEvents.id });
        deletedAnalyticsEvents += deleted.length;
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
            notExists(
              tx
                .select({ id: founderEntitlementGrants.id })
                .from(founderEntitlementGrants)
                .where(eq(founderEntitlementGrants.projectId, projects.id)),
            ),
            notExists(
              tx
                .select({ id: projectMemberships.id })
                .from(projectMemberships)
                .where(eq(projectMemberships.projectId, projects.id)),
            ),
          ),
        )
        .returning({ id: projects.id });

      return {
        cutoff,
        deletedScanRequests: deletedRequests.length,
        deletedDeliveryTokens: deletedTokens.length,
        deletedAnalyticsEvents,
        deletedFounderLaunchInterests,
        remainingExpiredFounderLaunchInterests: founderInterestBacklog?.value ?? 0,
        deletedOrphanProjects: deletedProjects.length,
      };
    });
  }
}
