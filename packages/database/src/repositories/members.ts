import { and, desc, eq, gt, inArray, isNull, lte, sql } from "drizzle-orm";

import {
  createPublicScanToken,
  digestNextMoveRequestWithContext,
  hashOpaqueToken,
} from "@trendsfast/core";
import {
  ContentCapabilitiesSchema,
  ContextProvenanceSchema,
  GenerationLevelSchema,
  ProjectNextMoveRequestSchema,
  ProjectContextSchema,
  ProjectEntityTypeSchema,
  VoiceProfileSchema,
  type ContentCapabilities,
  type ContentCapabilityName,
  type ContextProvenance,
  type ProjectContext,
  type ProjectEntityType,
  type VoiceProfile,
} from "@trendsfast/schemas";

import type { TrendsFastDatabase } from "../client";
import {
  deliveryTokens,
  evidenceReceipts,
  feedbackEvents,
  founderEntitlementGrants,
  founderUsageEvents,
  nextMoves,
  outcomes,
  projectClaims,
  projectContextVersions,
  projectEntitlements,
  projectMemberships,
  projects,
  scanRequests,
  scanRuns,
  userProfiles,
} from "../schema";
import { ApiKeyRepository, type ApiKeyScope } from "./api-keys";
import { admitFounderUsage, lockProjectEntitlementScope } from "./founder-usage";
import { normalizeProductUrl } from "./lifecycle";
import { lockProjectClaimDeliveryScope } from "./project-claim-lock";

const CLAIM_HASH = /^sha256:[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type VerifiedMemberIdentity = {
  authUserId: string;
  email: string;
  displayName?: string | null;
  avatarUrl?: string | null;
};

export type ProjectAuthorization = {
  userProfileId: string;
  projectId: string;
  role: "OWNER" | "MEMBER";
};

export type ProjectClaimConsumption =
  | { status: "CLAIMED" | "ALREADY_OWNER"; projectId: string; userProfileId: string }
  | { status: "OWNERSHIP_CONFLICT"; userProfileId: string }
  | { status: "NOT_FOUND" | "EXPIRED" | "INVALIDATED" | "REPLAYED" };

export type MemberRefreshResult =
  | { status: "CREATED" | "REUSED"; publicId: string }
  | { status: "IDEMPOTENCY_CONFLICT" }
  | { status: "USAGE_LIMITED"; reason: "ENTITLEMENT_INACTIVE" | "ON_DEMAND_MONTHLY_LIMIT" };

function requiredUuid(value: string, label: string): string {
  const normalized = value.trim();
  if (!UUID.test(normalized)) throw new Error(`${label} is invalid`);
  return normalized;
}

function normalizedIdentity(input: VerifiedMemberIdentity): Required<VerifiedMemberIdentity> {
  const authUserId = requiredUuid(input.authUserId, "Verified auth user ID");
  const email = input.email.trim().toLocaleLowerCase("en");
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+$/.test(email)) {
    throw new Error("Verified auth email is invalid");
  }
  const displayName = (input.displayName ?? "").trim().slice(0, 200);
  const avatarUrl = (input.avatarUrl ?? "").trim();
  if (avatarUrl) {
    const parsed = new URL(avatarUrl);
    if (!["http:", "https:"].includes(parsed.protocol) || avatarUrl.length > 2_048) {
      throw new Error("Verified profile avatar URL is invalid");
    }
  }
  return { authUserId, email, displayName, avatarUrl };
}

async function authorizationIn(
  db: TrendsFastDatabase,
  authUserId: string,
  projectId: string,
): Promise<ProjectAuthorization | null> {
  const [record] = await db
    .select({
      userProfileId: userProfiles.id,
      projectId: projectMemberships.projectId,
      role: projectMemberships.role,
    })
    .from(userProfiles)
    .innerJoin(projectMemberships, eq(projectMemberships.userProfileId, userProfiles.id))
    .where(
      and(
        eq(userProfiles.authUserId, requiredUuid(authUserId, "Verified auth user ID")),
        eq(projectMemberships.projectId, requiredUuid(projectId, "Project ID")),
      ),
    )
    .limit(1);
  return record ?? null;
}

async function requireOwner(
  db: TrendsFastDatabase,
  authUserId: string,
  projectId: string,
): Promise<ProjectAuthorization> {
  const authorization = await authorizationIn(db, authUserId, projectId);
  if (!authorization || authorization.role !== "OWNER") {
    throw new Error("Project owner authorization is required");
  }
  return authorization;
}

function publicKeyView(record: Awaited<ReturnType<ApiKeyRepository["list"]>>[number]) {
  return {
    id: record.id,
    projectId: record.projectId,
    name: record.name,
    visiblePrefix: record.visiblePrefix,
    scopes: record.scopes,
    environment: record.environment,
    status: record.status,
    createdAt: record.createdAt,
    lastUsedAt: record.lastUsedAt,
    expiresAt: record.expiresAt,
    revokedAt: record.revokedAt,
  };
}

async function availableClaimDelivery(
  db: TrendsFastDatabase,
  input: { deliveryTokenId: string; projectId: string; now: Date },
) {
  const [delivery] = await db
    .select({
      id: deliveryTokens.id,
      projectId: scanRequests.projectId,
      status: deliveryTokens.status,
      expiresAt: deliveryTokens.expiresAt,
      moveState: nextMoves.state,
      founderReviewed: nextMoves.founderReviewed,
      autoPublish: nextMoves.autoPublish,
      proposalStale: nextMoves.proposalStale,
      requestState: scanRequests.state,
      contextProjectId: projectContextVersions.projectId,
      contextIsCurrent: projectContextVersions.isCurrent,
    })
    .from(deliveryTokens)
    .innerJoin(nextMoves, eq(nextMoves.id, deliveryTokens.nextMoveId))
    .innerJoin(scanRequests, eq(scanRequests.id, nextMoves.scanRequestId))
    .innerJoin(
      projectContextVersions,
      eq(projectContextVersions.id, nextMoves.projectContextVersionId),
    )
    .where(eq(deliveryTokens.id, input.deliveryTokenId))
    .limit(1);
  if (
    !delivery ||
    delivery.projectId !== input.projectId ||
    delivery.contextProjectId !== input.projectId ||
    !delivery.contextIsCurrent ||
    !inArrayValue(delivery.status, ["ACTIVE", "DELIVERED"]) ||
    delivery.expiresAt <= input.now ||
    delivery.moveState !== "READY" ||
    delivery.requestState !== "READY" ||
    !delivery.founderReviewed ||
    delivery.autoPublish ||
    delivery.proposalStale
  ) {
    return null;
  }
  return delivery;
}

export class MemberRepository {
  private readonly apiKeys: ApiKeyRepository;

  constructor(
    private readonly db: TrendsFastDatabase,
    apiKeyPepper?: string,
  ) {
    this.apiKeys = new ApiKeyRepository(db, apiKeyPepper);
  }

  async createClaimForDelivery(input: {
    deliveryTokenId: string;
    projectId: string;
    claimHash: string;
    expiresAt: Date;
    now?: Date;
  }) {
    const now = input.now ?? new Date();
    const deliveryTokenId = requiredUuid(input.deliveryTokenId, "Delivery token ID");
    const projectId = requiredUuid(input.projectId, "Project ID");
    if (!CLAIM_HASH.test(input.claimHash)) throw new Error("Project claim hash is invalid");
    if (input.expiresAt <= now || input.expiresAt.getTime() - now.getTime() > 15 * 60_000) {
      throw new Error("Project claim expiry is invalid");
    }
    return this.db.transaction(async (tx) => {
      const transactional = tx as unknown as TrendsFastDatabase;
      await lockProjectClaimDeliveryScope(transactional, deliveryTokenId);
      await tx.execute(sql`SELECT id FROM projects WHERE id = ${projectId} FOR UPDATE`);
      const delivery = await availableClaimDelivery(transactional, {
        deliveryTokenId,
        projectId,
        now,
      });
      if (!delivery || input.expiresAt > delivery.expiresAt) {
        throw new Error("Project claim delivery is unavailable");
      }
      await tx
        .update(projectClaims)
        .set({ invalidatedAt: now })
        .where(
          and(
            eq(projectClaims.deliveryTokenId, delivery.id),
            isNull(projectClaims.consumedAt),
            isNull(projectClaims.invalidatedAt),
          ),
        );
      const [claim] = await tx
        .insert(projectClaims)
        .values({
          projectId,
          deliveryTokenId: delivery.id,
          claimSecretHash: input.claimHash,
          expiresAt: input.expiresAt,
          createdAt: now,
        })
        .returning({ id: projectClaims.id, expiresAt: projectClaims.expiresAt });
      if (!claim) throw new Error("Could not create project claim");
      return claim;
    });
  }

  async consumeProjectClaim(input: {
    claimHash: string;
    identity: VerifiedMemberIdentity;
    now?: Date;
  }): Promise<ProjectClaimConsumption> {
    if (!CLAIM_HASH.test(input.claimHash)) return { status: "NOT_FOUND" };
    const identity = normalizedIdentity(input.identity);
    const now = input.now ?? new Date();
    return this.db.transaction(async (tx) => {
      const [claimIdentity] = await tx
        .select({
          id: projectClaims.id,
          projectId: projectClaims.projectId,
          deliveryTokenId: projectClaims.deliveryTokenId,
        })
        .from(projectClaims)
        .where(eq(projectClaims.claimSecretHash, input.claimHash))
        .limit(1);
      if (!claimIdentity) return { status: "NOT_FOUND" } as const;

      const transactional = tx as unknown as TrendsFastDatabase;
      await lockProjectClaimDeliveryScope(transactional, claimIdentity.deliveryTokenId);
      const [claim] = await tx
        .select()
        .from(projectClaims)
        .where(eq(projectClaims.id, claimIdentity.id))
        .limit(1)
        .for("update");
      if (!claim) return { status: "NOT_FOUND" } as const;
      if (claim.consumedAt) return { status: "REPLAYED" } as const;
      if (claim.invalidatedAt) return { status: "INVALIDATED" } as const;
      if (claim.expiresAt <= now) return { status: "EXPIRED" } as const;

      await tx.execute(sql`SELECT id FROM projects WHERE id = ${claim.projectId} FOR UPDATE`);
      const delivery = await availableClaimDelivery(transactional, {
        deliveryTokenId: claim.deliveryTokenId,
        projectId: claim.projectId,
        now,
      });
      if (!delivery) {
        await tx
          .update(projectClaims)
          .set({ invalidatedAt: now })
          .where(
            and(
              eq(projectClaims.id, claim.id),
              isNull(projectClaims.consumedAt),
              isNull(projectClaims.invalidatedAt),
            ),
          );
        return { status: "INVALIDATED" } as const;
      }

      const [profile] = await tx
        .insert(userProfiles)
        .values({
          authUserId: identity.authUserId,
          email: identity.email,
          displayName: identity.displayName || null,
          avatarUrl: identity.avatarUrl || null,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: userProfiles.authUserId,
          set: {
            email: identity.email,
            displayName: identity.displayName || null,
            avatarUrl: identity.avatarUrl || null,
            updatedAt: now,
          },
        })
        .returning({ id: userProfiles.id });
      if (!profile) throw new Error("Could not create the application user profile");

      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`trendsfast:project-owner:${claim.projectId}`}, 0))`,
      );
      const [owner] = await tx
        .select({ userProfileId: projectMemberships.userProfileId })
        .from(projectMemberships)
        .where(
          and(
            eq(projectMemberships.projectId, claim.projectId),
            eq(projectMemberships.role, "OWNER"),
          ),
        )
        .limit(1);
      const outcome = !owner
        ? "CLAIMED"
        : owner.userProfileId === profile.id
          ? "ALREADY_OWNER"
          : "OWNERSHIP_CONFLICT";
      if (!owner) {
        await tx.insert(projectMemberships).values({
          projectId: claim.projectId,
          userProfileId: profile.id,
          role: "OWNER",
          createdAt: now,
          updatedAt: now,
        });
      }
      const [consumed] = await tx
        .update(projectClaims)
        .set({
          consumedAt: now,
          consumedByUserProfileId: profile.id,
          consumptionOutcome: outcome,
        })
        .where(
          and(
            eq(projectClaims.id, claim.id),
            isNull(projectClaims.consumedAt),
            isNull(projectClaims.invalidatedAt),
          ),
        )
        .returning({ id: projectClaims.id });
      if (!consumed) return { status: "REPLAYED" } as const;
      return outcome === "OWNERSHIP_CONFLICT"
        ? ({ status: outcome, userProfileId: profile.id } as const)
        : ({
            status: outcome,
            projectId: claim.projectId,
            userProfileId: profile.id,
          } as const);
    });
  }

  authorizeProject(input: { authUserId: string; projectId: string }) {
    return authorizationIn(this.db, input.authUserId, input.projectId);
  }

  async listOwnedProjects(authUserId: string) {
    return this.db
      .select({ project: projects, role: projectMemberships.role })
      .from(userProfiles)
      .innerJoin(projectMemberships, eq(projectMemberships.userProfileId, userProfiles.id))
      .innerJoin(projects, eq(projects.id, projectMemberships.projectId))
      .where(
        and(
          eq(userProfiles.authUserId, requiredUuid(authUserId, "Verified auth user ID")),
          eq(projectMemberships.role, "OWNER"),
          eq(projects.status, "ACTIVE"),
        ),
      )
      .orderBy(desc(projects.updatedAt));
  }

  async getProjectDashboard(input: { authUserId: string; projectId: string }) {
    await requireOwner(this.db, input.authUserId, input.projectId);
    const [[project], [context], [move]] = await Promise.all([
      this.db.select().from(projects).where(eq(projects.id, input.projectId)).limit(1),
      this.db
        .select()
        .from(projectContextVersions)
        .where(
          and(
            eq(projectContextVersions.projectId, input.projectId),
            eq(projectContextVersions.isCurrent, true),
          ),
        )
        .limit(1),
      this.db
        .select({ move: nextMoves, request: scanRequests })
        .from(nextMoves)
        .innerJoin(scanRequests, eq(scanRequests.id, nextMoves.scanRequestId))
        .where(
          and(
            eq(scanRequests.projectId, input.projectId),
            eq(nextMoves.state, "READY"),
            eq(nextMoves.founderReviewed, true),
            eq(nextMoves.autoPublish, false),
          ),
        )
        .orderBy(desc(nextMoves.deliveredAt), desc(nextMoves.createdAt))
        .limit(1),
    ]);
    if (!project) return null;
    const evidence = move
      ? await this.db
          .select()
          .from(evidenceReceipts)
          .where(
            and(
              eq(evidenceReceipts.nextMoveId, move.move.id),
              eq(evidenceReceipts.moveVersion, move.move.reviewVersion),
            ),
          )
      : [];
    return { project, context: context ?? null, latest: move ?? null, evidence };
  }

  async listProjectHistory(input: { authUserId: string; projectId: string; limit?: number }) {
    await requireOwner(this.db, input.authUserId, input.projectId);
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
    const history = await this.db
      .select({ move: nextMoves, request: scanRequests })
      .from(nextMoves)
      .innerJoin(scanRequests, eq(scanRequests.id, nextMoves.scanRequestId))
      .where(
        and(
          eq(scanRequests.projectId, input.projectId),
          inArray(nextMoves.state, ["READY", "REJECTED"]),
        ),
      )
      .orderBy(desc(nextMoves.createdAt))
      .limit(limit);
    if (history.length === 0) return [];
    const moveIds = history.map((record) => record.move.id);
    const [recordedOutcomes, feedback] = await Promise.all([
      this.db
        .select()
        .from(outcomes)
        .where(inArray(outcomes.nextMoveId, moveIds))
        .orderBy(desc(outcomes.reportedAt)),
      this.db
        .select()
        .from(feedbackEvents)
        .where(inArray(feedbackEvents.nextMoveId, moveIds))
        .orderBy(desc(feedbackEvents.createdAt)),
    ]);
    return history.map((record) => ({
      ...record,
      outcomes: recordedOutcomes.filter((outcome) => outcome.nextMoveId === record.move.id),
      feedback: feedback.filter((event) => event.nextMoveId === record.move.id),
    }));
  }

  async updateProjectContext(input: {
    authUserId: string;
    projectId: string;
    context: ProjectContext;
    entityType: ProjectEntityType;
    contextProvenance: ContextProvenance;
    voiceProfile: VoiceProfile;
    contentCapabilities: ContentCapabilities;
  }) {
    const context = ProjectContextSchema.parse(input.context);
    const entityType = ProjectEntityTypeSchema.parse(input.entityType);
    const requestedContextProvenance = ContextProvenanceSchema.parse(input.contextProvenance);
    const voiceProfile = VoiceProfileSchema.parse(input.voiceProfile);
    const contentCapabilities = ContentCapabilitiesSchema.parse(input.contentCapabilities);
    return this.db.transaction(async (tx) => {
      const transactional = tx as unknown as TrendsFastDatabase;
      const authorization = await requireOwner(transactional, input.authUserId, input.projectId);
      await lockProjectEntitlementScope(transactional, input.projectId);
      await tx.execute(sql`SELECT id FROM projects WHERE id = ${input.projectId} FOR UPDATE`);
      const [project] = await tx
        .select({ normalizedUrl: projects.normalizedUrl })
        .from(projects)
        .where(and(eq(projects.id, input.projectId), eq(projects.status, "ACTIVE")))
        .limit(1);
      if (!project || normalizeProductUrl(context.url) !== project.normalizedUrl) {
        throw new Error("Project context no longer matches the current product URL");
      }
      const existing = await tx
        .select({
          id: projectContextVersions.id,
          version: projectContextVersions.version,
          isCurrent: projectContextVersions.isCurrent,
          contextProvenance: projectContextVersions.contextProvenance,
        })
        .from(projectContextVersions)
        .where(eq(projectContextVersions.projectId, input.projectId))
        .orderBy(desc(projectContextVersions.version));
      const current = existing.find((candidate) => candidate.isCurrent);
      if (!current) {
        throw new Error("A fresh scan must infer context before member corrections can be saved");
      }
      const observedFacts = current.contextProvenance.observed_facts;
      const contextProvenance = ContextProvenanceSchema.parse({
        ...requestedContextProvenance,
        observed_facts: observedFacts,
      });
      const version = (existing[0]?.version ?? 0) + 1;
      await tx
        .update(projectContextVersions)
        .set({ isCurrent: false })
        .where(eq(projectContextVersions.projectId, input.projectId));
      const [created] = await tx
        .insert(projectContextVersions)
        .values({
          projectId: input.projectId,
          version,
          isCurrent: true,
          inferredName: context.name,
          category: context.category,
          audience: context.audience,
          problem: context.problem,
          language: context.language,
          credibleTopics: context.credibleTopics,
          assumptions: context.assumptions,
          context,
          entityType,
          contextProvenance,
          voiceProfile,
          contentCapabilities,
          createdBy: `member:${authorization.userProfileId}`,
        })
        .returning();
      if (!created) throw new Error("Could not create the project context version");
      if (existing.length > 0) {
        await tx
          .update(nextMoves)
          .set({ proposalStale: true, updatedAt: new Date() })
          .where(
            and(
              inArray(
                nextMoves.projectContextVersionId,
                existing.map((record) => record.id),
              ),
              inArray(nextMoves.state, ["DRAFT", "APPROVED", "READY"]),
            ),
          );
      }
      return created;
    });
  }

  async updateProjectUrl(input: {
    authUserId: string;
    projectId: string;
    url: string;
    now?: Date;
  }) {
    const submittedUrl = input.url.trim();
    let parsed: URL;
    try {
      parsed = new URL(submittedUrl);
    } catch {
      throw new Error("Project URL is invalid");
    }
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      !parsed.hostname ||
      submittedUrl.length > 2_048
    ) {
      throw new Error("Project URL is invalid");
    }
    const normalizedUrl = normalizeProductUrl(parsed.toString());
    const now = input.now ?? new Date();
    return this.db.transaction(async (tx) => {
      const transactional = tx as unknown as TrendsFastDatabase;
      await requireOwner(transactional, input.authUserId, input.projectId);
      await lockProjectEntitlementScope(transactional, input.projectId);
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`trendsfast:project-url:${input.projectId}`}, 0))`,
      );
      const [project] = await tx
        .select({ id: projects.id, normalizedUrl: projects.normalizedUrl })
        .from(projects)
        .where(and(eq(projects.id, input.projectId), eq(projects.status, "ACTIVE")))
        .limit(1)
        .for("update");
      if (!project) throw new Error("Project was not found");
      if (project.normalizedUrl === normalizedUrl) {
        const [unchanged] = await tx
          .select()
          .from(projects)
          .where(eq(projects.id, project.id))
          .limit(1);
        if (!unchanged) throw new Error("Project was not found");
        return { project: unchanged, changed: false as const };
      }
      const [conflict] = await tx
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.normalizedUrl, normalizedUrl))
        .limit(1);
      if (conflict && conflict.id !== project.id) {
        throw new Error("This product URL is already owned by another project");
      }
      const currentContexts = await tx
        .select({ id: projectContextVersions.id })
        .from(projectContextVersions)
        .where(
          and(
            eq(projectContextVersions.projectId, project.id),
            eq(projectContextVersions.isCurrent, true),
          ),
        );
      await tx
        .update(projectContextVersions)
        .set({ isCurrent: false })
        .where(
          and(
            eq(projectContextVersions.projectId, project.id),
            eq(projectContextVersions.isCurrent, true),
          ),
        );
      if (currentContexts.length > 0) {
        await tx
          .update(nextMoves)
          .set({ proposalStale: true, updatedAt: now })
          .where(
            and(
              inArray(
                nextMoves.projectContextVersionId,
                currentContexts.map((context) => context.id),
              ),
              inArray(nextMoves.state, ["DRAFT", "APPROVED", "READY"]),
            ),
          );
      }
      const [updated] = await tx
        .update(projects)
        .set({ url: normalizedUrl, normalizedUrl, updatedAt: now })
        .where(eq(projects.id, project.id))
        .returning();
      if (!updated) throw new Error("Could not update the project URL");
      return { project: updated, changed: true as const };
    });
  }

  async recordProjectOutcome(input: {
    authUserId: string;
    projectId: string;
    nextMoveId: string;
    kind: "USED" | "PUBLISHED" | "REPLIED" | "REMIXED" | "SKIPPED";
    notes?: string;
  }) {
    await requireOwner(this.db, input.authUserId, input.projectId);
    const [move] = await this.db
      .select({ id: nextMoves.id, action: nextMoves.action })
      .from(nextMoves)
      .innerJoin(scanRequests, eq(scanRequests.id, nextMoves.scanRequestId))
      .where(and(eq(nextMoves.id, input.nextMoveId), eq(scanRequests.projectId, input.projectId)))
      .limit(1);
    if (!move) throw new Error("Next Move was not found for this project");
    const actionKind = { PUBLISH: "PUBLISHED", REPLY: "REPLIED", REMIX: "REMIXED" } as const;
    if (
      input.kind !== "USED" &&
      input.kind !== "SKIPPED" &&
      (move.action === "WAIT" || actionKind[move.action] !== input.kind)
    ) {
      throw new Error("Outcome kind does not match the Next Move action");
    }
    const [created] = await this.db
      .insert(outcomes)
      .values({
        nextMoveId: move.id,
        kind: input.kind,
        notes: input.notes?.trim().slice(0, 2_000) || null,
      })
      .returning();
    return created ?? null;
  }

  async requestProjectRefresh(input: {
    authUserId: string;
    projectId: string;
    idempotencyKey: string;
    objective?: string;
    preferredChannels?: string[];
    contentCapabilities?: ContentCapabilityName[];
    generationLevel?: "brief" | "draft";
    costReservationUsd: number;
    now?: Date;
  }): Promise<MemberRefreshResult> {
    const projectId = requiredUuid(input.projectId, "Project ID");
    const idempotencyKey = requiredUuid(input.idempotencyKey, "Refresh idempotency key");
    if (!Number.isFinite(input.costReservationUsd) || input.costReservationUsd < 0) {
      throw new Error("Project refresh cost reservation is invalid");
    }
    const now = input.now ?? new Date();
    if (Number.isNaN(now.getTime())) throw new Error("Project refresh time is invalid");
    const requested = ProjectNextMoveRequestSchema.parse({
      ...(input.objective === undefined ? {} : { objective: input.objective }),
      ...(input.preferredChannels === undefined
        ? {}
        : { preferred_channels: input.preferredChannels }),
      ...(input.contentCapabilities === undefined || input.contentCapabilities.length === 0
        ? {}
        : { content_capabilities: input.contentCapabilities }),
      generation_level: GenerationLevelSchema.parse(input.generationLevel ?? "brief"),
    });

    return this.db.transaction(async (tx) => {
      const transactional = tx as unknown as TrendsFastDatabase;
      await requireOwner(transactional, input.authUserId, projectId);
      await lockProjectEntitlementScope(transactional, projectId);
      const [project] = await tx
        .select({ id: projects.id, url: projects.url })
        .from(projects)
        .where(and(eq(projects.id, projectId), eq(projects.status, "ACTIVE")))
        .limit(1)
        .for("update");
      if (!project) throw new Error("Project was not found");
      const [currentContext] = await tx
        .select({
          id: projectContextVersions.id,
          contentCapabilities: projectContextVersions.contentCapabilities,
        })
        .from(projectContextVersions)
        .where(
          and(
            eq(projectContextVersions.projectId, projectId),
            eq(projectContextVersions.isCurrent, true),
          ),
        )
        .limit(1)
        .for("update");
      if (!currentContext && requested.content_capabilities !== undefined) {
        throw new Error("Content capabilities require a current saved context profile");
      }
      const requestedCapabilities = currentContext
        ? (requested.content_capabilities ??
          (Object.entries(currentContext.contentCapabilities)
            .filter(([, enabled]) => enabled)
            .map(([name]) => name) as ContentCapabilityName[]))
        : undefined;
      const persistedCapabilities = requestedCapabilities?.length
        ? requestedCapabilities
        : undefined;
      if (
        currentContext &&
        persistedCapabilities?.some((name) => !currentContext.contentCapabilities[name])
      ) {
        throw new Error("Requested content capabilities are not enabled in the saved profile");
      }
      const request = {
        product_url: project.url,
        ...(requested.objective === undefined ? {} : { objective: requested.objective }),
        ...(requested.preferred_channels === undefined
          ? {}
          : { preferred_channels: requested.preferred_channels }),
        ...(persistedCapabilities === undefined
          ? {}
          : { content_capabilities: persistedCapabilities }),
        generation_level: requested.generation_level,
      };
      const requestPayloadHash = digestNextMoveRequestWithContext(request, currentContext?.id);
      const usage = await admitFounderUsage(transactional, {
        projectId,
        kind: "ON_DEMAND_RUN_ACCEPTED",
        idempotencyKey: `dashboard:${projectId}:${hashOpaqueToken(idempotencyKey)}`,
        occurredAt: now,
      });
      if (usage.status === "LIMITED") {
        return {
          status: "USAGE_LIMITED" as const,
          reason:
            usage.reason === "ON_DEMAND_MONTHLY_LIMIT"
              ? "ON_DEMAND_MONTHLY_LIMIT"
              : "ENTITLEMENT_INACTIVE",
        };
      }
      if (usage.status === "REUSED") {
        if (!usage.event.scanRequestId) {
          throw new Error("Project refresh idempotency is missing its scan request");
        }
        const [existing] = await tx
          .select({
            publicId: scanRequests.publicId,
            requestPayloadHash: scanRequests.requestPayloadHash,
          })
          .from(scanRequests)
          .where(eq(scanRequests.id, usage.event.scanRequestId))
          .limit(1);
        if (!existing) throw new Error("Project refresh idempotency points to a missing scan");
        return existing.requestPayloadHash === requestPayloadHash
          ? { status: "REUSED" as const, publicId: existing.publicId }
          : { status: "IDEMPOTENCY_CONFLICT" as const };
      }

      const [created] = await tx
        .insert(scanRequests)
        .values({
          publicId: createPublicScanToken(),
          projectId,
          origin: "API",
          state: "QUEUED",
          submittedUrl: project.url,
          normalizedUrl: normalizeProductUrl(project.url),
          goal: requested.objective ?? null,
          preferredChannels: requested.preferred_channels ?? null,
          generationLevel: requested.generation_level,
          requestedContentCapabilities: persistedCapabilities ?? null,
          idempotencyKeyHash: hashOpaqueToken(idempotencyKey),
          requestPayloadHash,
          apiCostReservationUsd: input.costReservationUsd.toFixed(6),
          submittedAt: now,
        })
        .returning({ id: scanRequests.id, publicId: scanRequests.publicId });
      if (!created) throw new Error("Could not create the project refresh request");
      const [queuedRun] = await tx
        .insert(scanRuns)
        .values({
          scanRequestId: created.id,
          projectContextVersionId: currentContext?.id ?? null,
          attempt: 1,
          state: "QUEUED",
        })
        .returning({ id: scanRuns.id });
      if (!queuedRun) throw new Error("Could not pin the project refresh context version");
      await tx
        .update(founderUsageEvents)
        .set({ scanRequestId: created.id })
        .where(eq(founderUsageEvents.id, usage.event.id));
      return { status: "CREATED" as const, publicId: created.publicId };
    });
  }

  async listProjectApiKeys(input: { authUserId: string; projectId: string }) {
    await requireOwner(this.db, input.authUserId, input.projectId);
    return (await this.apiKeys.list({ projectId: input.projectId })).map(publicKeyView);
  }

  private async currentAccessExpiry(projectId: string, now: Date): Promise<Date> {
    const [[entitlement], [grant]] = await Promise.all([
      this.db
        .select({ expiresAt: projectEntitlements.periodEnd })
        .from(projectEntitlements)
        .where(
          and(
            eq(projectEntitlements.projectId, projectId),
            eq(projectEntitlements.active, true),
            lte(projectEntitlements.periodStart, now),
            gt(projectEntitlements.periodEnd, now),
          ),
        )
        .orderBy(desc(projectEntitlements.periodEnd))
        .limit(1),
      this.db
        .select({ expiresAt: founderEntitlementGrants.expiresAt })
        .from(founderEntitlementGrants)
        .where(
          and(
            eq(founderEntitlementGrants.projectId, projectId),
            lte(founderEntitlementGrants.createdAt, now),
            gt(founderEntitlementGrants.expiresAt, now),
            isNull(founderEntitlementGrants.revokedAt),
          ),
        )
        .orderBy(desc(founderEntitlementGrants.expiresAt))
        .limit(1),
    ]);
    const expiry = [entitlement?.expiresAt, grant?.expiresAt]
      .filter((candidate): candidate is Date => candidate instanceof Date)
      .sort((left, right) => right.getTime() - left.getTime())[0];
    if (!expiry) throw new Error("Project API keys require an active entitlement or founder grant");
    return expiry;
  }

  async issueProjectApiKey(input: {
    authUserId: string;
    projectId: string;
    name: string;
    scopes?: ApiKeyScope[];
    policy: { rateLimitPerHour: number; providerCostLimitUsd: number };
  }) {
    const authorization = await requireOwner(this.db, input.authUserId, input.projectId);
    const now = new Date();
    const expiresAt = await this.currentAccessExpiry(input.projectId, now);
    const issued = await this.apiKeys.issue({
      name: input.name,
      environment: "live",
      projectId: input.projectId,
      ...(input.scopes ? { scopes: input.scopes } : {}),
      rateLimitPerHour: input.policy.rateLimitPerHour,
      providerCostLimitUsd: input.policy.providerCostLimitUsd,
      expiresAt,
      actorId: `member:${authorization.userProfileId}`,
    });
    return { record: publicKeyView(issued.record), rawKey: issued.rawKey };
  }

  async revokeProjectApiKey(input: { authUserId: string; projectId: string; apiKeyId: string }) {
    const authorization = await requireOwner(this.db, input.authUserId, input.projectId);
    const key = await this.apiKeys.getControlRecord(input.apiKeyId);
    if (!key || key.projectId !== input.projectId) throw new Error("Project API key was not found");
    const revoked = await this.apiKeys.revoke(key.id, `member:${authorization.userProfileId}`);
    return revoked ? publicKeyView(revoked) : null;
  }

  async reissueProjectApiKey(input: {
    authUserId: string;
    projectId: string;
    apiKeyId: string;
    name?: string;
    policy: { rateLimitPerHour: number; providerCostLimitUsd: number };
  }) {
    const authorization = await requireOwner(this.db, input.authUserId, input.projectId);
    const key = await this.apiKeys.getControlRecord(input.apiKeyId);
    if (!key || key.projectId !== input.projectId) throw new Error("Project API key was not found");
    const now = new Date();
    const expiresAt = await this.currentAccessExpiry(input.projectId, now);
    const replaced =
      key.status === "ACTIVE" && (!key.expiresAt || key.expiresAt > now)
        ? await this.apiKeys.rotate({
            apiKeyId: key.id,
            actorId: `member:${authorization.userProfileId}`,
            ...(input.name ? { name: input.name } : {}),
            expiresAt,
            ...input.policy,
          })
        : await this.apiKeys.reissue({
            apiKeyId: key.id,
            actorId: `member:${authorization.userProfileId}`,
            ...(input.name ? { name: input.name } : {}),
            expiresAt,
            ...input.policy,
          });
    return { record: publicKeyView(replaced.record), rawKey: replaced.rawKey };
  }
}

function inArrayValue<T>(value: T, allowed: readonly T[]): boolean {
  return allowed.includes(value);
}
