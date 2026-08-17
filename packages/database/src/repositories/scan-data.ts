import { and, asc, desc, eq, inArray, lt, sql } from "drizzle-orm";

import { createPrefixedId, redactRecord, redactSecrets } from "@trendsfast/core";
import {
  CONSERVATIVE_CONTENT_CAPABILITIES,
  EMPTY_CONTEXT_PROVENANCE,
  EMPTY_VOICE_PROFILE,
  ContentCapabilitiesSchema,
  ContextProvenanceSchema,
  NextMoveSchema,
  ProjectContextSchema,
  ProjectEntityTypeSchema,
  QueryPlanSchema,
  SignalMetricSnapshotSchema,
  SignalSchema,
  VoiceProfileSchema,
  VersionedNextMoveSchema,
  type ContentCapabilities,
  type ContextProvenance,
  type NextMove,
  type ProjectContext,
  type ProjectEntityType,
  type QueryPlan,
  type Signal,
  type SignalClass,
  type SourceRunState,
  type VoiceProfile,
  type VersionedNextMove,
} from "@trendsfast/schemas";

import type { TrendsFastDatabase } from "../client";
import {
  clusterMembers,
  clusters,
  evidenceReceipts,
  nextMoves,
  opportunities,
  projectContextVersions,
  projects,
  reviewEvents,
  scanRequests,
  scanRuns,
  signalMetricSnapshots,
  signals,
  sourceRuns,
} from "../schema";
import { normalizeProductUrl } from "./lifecycle";
import { ReviewVersionConflictError } from "./review";

export function sanitizeProviderPayloadFragment(
  input: Readonly<Record<string, unknown>>,
  maxBytes = 64 * 1_024,
): Record<string, unknown> {
  const redacted = redactRecord(input);
  if (Buffer.byteLength(JSON.stringify(redacted), "utf8") > maxBytes) {
    throw new Error("Provider payload fragment exceeds the storage limit");
  }
  return redacted;
}

export class ScanDataRepository {
  constructor(private readonly db: TrendsFastDatabase) {}

  async getProject(projectId: string) {
    const [project] = await this.db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    return project ?? null;
  }

  async getCurrentProjectProfile(projectId: string) {
    const [profile] = await this.db
      .select({ project: projects, contextVersion: projectContextVersions })
      .from(projects)
      .innerJoin(
        projectContextVersions,
        and(
          eq(projectContextVersions.projectId, projects.id),
          eq(projectContextVersions.isCurrent, true),
        ),
      )
      .where(and(eq(projects.id, projectId), eq(projects.status, "ACTIVE")))
      .limit(1);
    return profile ?? null;
  }

  async listProjects(input: { activeOnly?: boolean; limit?: number } = {}) {
    const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);
    return this.db
      .select()
      .from(projects)
      .where(input.activeOnly === false ? undefined : eq(projects.status, "ACTIVE"))
      .orderBy(desc(projects.updatedAt))
      .limit(limit);
  }

  async upsertProject(input: { url: string; name?: string; publicId?: string }) {
    const normalizedUrl = normalizeProductUrl(input.url);
    const [project] = await this.db
      .insert(projects)
      .values({
        publicId: input.publicId ?? createPrefixedId("project"),
        name: input.name ?? null,
        url: input.url,
        normalizedUrl,
      })
      .onConflictDoUpdate({
        target: projects.normalizedUrl,
        set: { name: input.name ?? null, updatedAt: new Date() },
      })
      .returning();
    if (!project) throw new Error("Could not upsert project");
    return project;
  }

  /**
   * Resolves the project identity for context inferred during one fenced scan.
   * A project-scoped request may never be rebound by URL: the exact locked
   * project must still own the normalized URL captured at admission. Only a
   * previously unassigned public request may resolve/create by URL. Legacy
   * unbound API work is rejected instead of inheriting URL-based authority.
   */
  async resolveProjectForInferredContext(input: {
    scanRequestId: string;
    context: ProjectContext;
  }) {
    const context = ProjectContextSchema.parse(input.context);
    const normalizedUrl = normalizeProductUrl(context.url);
    const [request] = await this.db
      .select({
        id: scanRequests.id,
        origin: scanRequests.origin,
        projectId: scanRequests.projectId,
        normalizedUrl: scanRequests.normalizedUrl,
      })
      .from(scanRequests)
      .where(eq(scanRequests.id, input.scanRequestId))
      .limit(1);
    if (!request || request.normalizedUrl !== normalizedUrl) {
      throw new Error("The inferred context no longer matches the admitted scan URL");
    }
    if (!request.projectId) {
      if (request.origin === "API") {
        throw new Error("A project-scoped API scan is missing its project binding");
      }
      if (request.origin === "PUBLIC_FORM") {
        const lockKey = `trendsfast:public-project:${normalizedUrl}`;
        await this.db.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
        const [existingProject] = await this.db
          .select({ id: projects.id })
          .from(projects)
          .where(eq(projects.normalizedUrl, normalizedUrl))
          .limit(1);
        if (existingProject) {
          throw new Error("A public scan cannot replace an existing project context");
        }
        const [created] = await this.db
          .insert(projects)
          .values({
            publicId: createPrefixedId("project"),
            name: context.name,
            url: context.url,
            normalizedUrl,
          })
          .returning();
        if (!created) throw new Error("Could not create the public scan project");
        return created;
      }
      return this.upsertProject({ url: context.url, name: context.name });
    }

    await this.db.execute(sql`SELECT id FROM projects WHERE id = ${request.projectId} FOR UPDATE`);
    const [project] = await this.db
      .select()
      .from(projects)
      .where(eq(projects.id, request.projectId))
      .limit(1);
    if (
      !project ||
      project.status !== "ACTIVE" ||
      project.normalizedUrl !== request.normalizedUrl
    ) {
      throw new Error("The claimed project URL changed before context could be persisted");
    }
    return project;
  }

  async addProjectContext(input: {
    projectId: string;
    context: ProjectContext;
    entityType?: ProjectEntityType;
    contextProvenance?: ContextProvenance;
    voiceProfile?: VoiceProfile;
    contentCapabilities?: ContentCapabilities;
    sourceContentHash?: string;
    promptVersion?: string;
    model?: string;
    createdBy?: string;
  }) {
    const context = ProjectContextSchema.parse(input.context);
    const entityType = ProjectEntityTypeSchema.parse(input.entityType ?? "PRODUCT");
    const contextProvenance = ContextProvenanceSchema.parse(
      input.contextProvenance ?? EMPTY_CONTEXT_PROVENANCE,
    );
    const voiceProfile = VoiceProfileSchema.parse(input.voiceProfile ?? EMPTY_VOICE_PROFILE);
    const contentCapabilities = ContentCapabilitiesSchema.parse(
      input.contentCapabilities ?? CONSERVATIVE_CONTENT_CAPABILITIES,
    );
    return this.db.transaction(async (tx) => {
      const existing = await tx
        .select({ version: projectContextVersions.version })
        .from(projectContextVersions)
        .where(eq(projectContextVersions.projectId, input.projectId));
      const version = existing.reduce((latest, row) => Math.max(latest, row.version), 0) + 1;
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
          sourceContentHash: input.sourceContentHash ?? null,
          promptVersion: input.promptVersion ?? null,
          model: input.model ?? null,
          createdBy: input.createdBy ?? "system",
        })
        .returning();
      if (!created) throw new Error("Could not create project context version");
      return created;
    });
  }

  async attachProject(input: {
    scanRequestId: string;
    projectId: string;
    projectContextVersionId: string;
  }) {
    return this.db.transaction(async (tx) => {
      const [request] = await tx
        .update(scanRequests)
        .set({ projectId: input.projectId, updatedAt: new Date() })
        .where(eq(scanRequests.id, input.scanRequestId))
        .returning();
      await tx
        .update(scanRuns)
        .set({ projectContextVersionId: input.projectContextVersionId })
        .where(eq(scanRuns.scanRequestId, input.scanRequestId));
      return request ?? null;
    });
  }

  async setQueryPlan(scanRunId: string, input: QueryPlan) {
    const queryPlan = QueryPlanSchema.parse(input);
    const [run] = await this.db
      .update(scanRuns)
      .set({
        queryPlan,
        queryPlanVersion: queryPlan.version,
        updatedAt: new Date(),
      })
      .where(eq(scanRuns.id, scanRunId))
      .returning();
    return run ?? null;
  }

  async getContextForRun(scanRunId: string) {
    const [result] = await this.db
      .select({
        run: scanRuns,
        contextVersion: projectContextVersions,
        project: projects,
      })
      .from(scanRuns)
      .innerJoin(
        projectContextVersions,
        eq(scanRuns.projectContextVersionId, projectContextVersions.id),
      )
      .innerJoin(projects, eq(projectContextVersions.projectId, projects.id))
      .where(eq(scanRuns.id, scanRunId))
      .limit(1);
    return result ?? null;
  }

  async updateRunSummary(
    scanRunId: string,
    input: {
      queryPlan?: QueryPlan;
      scoreVersion?: string;
      promptVersion?: string;
      modelInput?: Record<string, unknown>;
      modelOutput?: Record<string, unknown>;
      sourceCoverage?: Record<string, string>;
      signalClass?: SignalClass;
      estimatedCostUsd?: number;
      actualCostUsd?: number;
      hardDeadlineAt?: Date;
    },
  ) {
    const queryPlan = input.queryPlan ? QueryPlanSchema.parse(input.queryPlan) : undefined;
    if ((input.estimatedCostUsd ?? 0) < 0 || (input.actualCostUsd ?? 0) < 0) {
      throw new Error("Scan cost summary cannot be negative");
    }
    const [run] = await this.db
      .update(scanRuns)
      .set({
        queryPlan,
        queryPlanVersion: queryPlan?.version,
        scoreVersion: input.scoreVersion?.slice(0, 100),
        promptVersion: input.promptVersion?.slice(0, 100),
        modelInput: input.modelInput ? redactRecord(input.modelInput) : undefined,
        modelOutput: input.modelOutput ? redactRecord(input.modelOutput) : undefined,
        sourceCoverage: input.sourceCoverage,
        signalClass: input.signalClass,
        estimatedCostUsd:
          input.estimatedCostUsd === undefined ? undefined : input.estimatedCostUsd.toFixed(6),
        actualCostUsd:
          input.actualCostUsd === undefined ? undefined : input.actualCostUsd.toFixed(6),
        hardDeadlineAt: input.hardDeadlineAt,
        updatedAt: new Date(),
      })
      .where(eq(scanRuns.id, scanRunId))
      .returning();
    return run ?? null;
  }

  async createSourceRun(input: {
    scanRunId: string;
    source: typeof sourceRuns.$inferInsert.source;
    provider: string;
    maxCalls: number;
    queryPlanFragment?: Record<string, unknown>;
  }) {
    const [run] = await this.db
      .insert(sourceRuns)
      .values({
        scanRunId: input.scanRunId,
        source: input.source,
        provider: input.provider.slice(0, 100),
        maxCalls: input.maxCalls,
        queryPlanFragment: input.queryPlanFragment ?? null,
      })
      .onConflictDoNothing()
      .returning();
    if (run) return run;
    const [existing] = await this.db
      .select()
      .from(sourceRuns)
      .where(
        and(
          eq(sourceRuns.scanRunId, input.scanRunId),
          eq(sourceRuns.source, input.source),
          eq(sourceRuns.provider, input.provider.slice(0, 100)),
        ),
      )
      .limit(1);
    if (!existing) throw new Error("Could not create source run");
    return existing;
  }

  async updateSourceRun(input: {
    sourceRunId: string;
    state: SourceRunState;
    callsMade: number;
    candidateCount: number;
    durationMs?: number;
    providerPayloadFragment?: Record<string, unknown>;
    failureCode?: string;
    failureMessage?: string;
  }) {
    const now = new Date();
    const [run] = await this.db
      .update(sourceRuns)
      .set({
        state: input.state,
        callsMade: input.callsMade,
        candidateCount: input.candidateCount,
        durationMs: input.durationMs ?? null,
        providerPayloadFragment: input.providerPayloadFragment
          ? sanitizeProviderPayloadFragment(input.providerPayloadFragment)
          : null,
        failureCode: input.failureCode ?? null,
        failureMessage: input.failureMessage
          ? redactSecrets(input.failureMessage).slice(0, 500)
          : null,
        startedAt: input.state === "RUNNING" ? now : undefined,
        completedAt: ["SUCCEEDED", "DEGRADED", "FAILED", "SKIPPED"].includes(input.state)
          ? now
          : undefined,
        updatedAt: now,
      })
      .where(eq(sourceRuns.id, input.sourceRunId))
      .returning();
    return run ?? null;
  }

  async listSourceRuns(scanRunId: string) {
    return this.db
      .select()
      .from(sourceRuns)
      .where(eq(sourceRuns.scanRunId, scanRunId))
      .orderBy(asc(sourceRuns.createdAt));
  }

  async listPublicSourceStatesForRun(scanRunId: string) {
    return this.db
      .select({ source: sourceRuns.source, state: sourceRuns.state })
      .from(sourceRuns)
      .where(eq(sourceRuns.scanRunId, scanRunId))
      .orderBy(asc(sourceRuns.createdAt));
  }

  async listSignalsForRun(scanRunId: string) {
    return this.db
      .select({ signal: signals, sourceRun: sourceRuns })
      .from(signals)
      .innerJoin(sourceRuns, eq(signals.sourceRunId, sourceRuns.id))
      .where(eq(sourceRuns.scanRunId, scanRunId))
      .orderBy(asc(signals.observedAt));
  }

  /** Exact evidence-binding projection; excludes provider request IDs and raw hashes. */
  async listPublicSignalsForRun(scanRunId: string) {
    return this.db
      .select({
        signal: {
          id: signals.id,
          source: signals.source,
          sourceId: signals.sourceId,
          canonicalUrl: signals.canonicalUrl,
          title: signals.title,
          textExcerpt: signals.textExcerpt,
          author: signals.author,
          publishedAt: signals.publishedAt,
          observedAt: signals.observedAt,
          language: signals.language,
          metrics: signals.metrics,
          queryId: signals.queryId,
          provider: signals.provider,
          providerRequestId: sql<null>`null::text`,
          retrievedAt: signals.retrievedAt,
          cached: signals.cached,
          rawPayloadHash: sql<null>`null::text`,
        },
      })
      .from(signals)
      .innerJoin(sourceRuns, eq(signals.sourceRunId, sourceRuns.id))
      .where(eq(sourceRuns.scanRunId, scanRunId))
      .orderBy(asc(signals.observedAt));
  }

  async listMetricSnapshotsForRun(scanRunId: string) {
    return this.db
      .select({ snapshot: signalMetricSnapshots, signal: signals })
      .from(signalMetricSnapshots)
      .innerJoin(signals, eq(signals.id, signalMetricSnapshots.signalId))
      .innerJoin(sourceRuns, eq(sourceRuns.id, signals.sourceRunId))
      .where(eq(sourceRuns.scanRunId, scanRunId))
      .orderBy(asc(signalMetricSnapshots.observedAt));
  }

  /**
   * Loads a bounded history for the exact source-native identities in one run.
   * Historical signal IDs are deliberately remapped to the current stored IDs
   * so the scoring layer can compare like-for-like metric observations only.
   */
  async listHistoricalMetricSnapshotsForRun(scanRunId: string, limitPerSignal = 12) {
    const boundedLimit = Math.min(Math.max(limitPerSignal, 2), 24);
    const currentSignals = await this.listSignalsForRun(scanRunId);
    if (currentSignals.length === 0) return [];
    const metricSignals = currentSignals
      .filter(
        ({ signal, sourceRun }) =>
          sourceRun.state === "SUCCEEDED" &&
          Object.values(signal.metrics).some(
            (value) => typeof value === "number" && Number.isFinite(value),
          ),
      )
      .sort((left, right) => right.signal.observedAt.getTime() - left.signal.observedAt.getTime())
      .slice(0, 40);
    if (metricSignals.length === 0) return [];
    const [currentRun] = await this.db
      .select({ projectId: scanRequests.projectId, createdAt: scanRuns.createdAt })
      .from(scanRuns)
      .innerJoin(scanRequests, eq(scanRequests.id, scanRuns.scanRequestId))
      .where(eq(scanRuns.id, scanRunId))
      .limit(1);
    if (!currentRun) return [];

    const result: Array<{ signalId: string; observedAt: Date; metrics: Signal["metrics"] }> = [];
    for (const { signal: current } of metricSignals) {
      const history = await this.db
        .select({
          observedAt: signalMetricSnapshots.observedAt,
          metrics: signalMetricSnapshots.metrics,
        })
        .from(signalMetricSnapshots)
        .innerJoin(signals, eq(signals.id, signalMetricSnapshots.signalId))
        .innerJoin(sourceRuns, eq(sourceRuns.id, signals.sourceRunId))
        .innerJoin(scanRuns, eq(scanRuns.id, sourceRuns.scanRunId))
        .innerJoin(scanRequests, eq(scanRequests.id, scanRuns.scanRequestId))
        .where(
          and(
            eq(sourceRuns.state, "SUCCEEDED"),
            eq(signals.source, current.source),
            eq(signals.sourceId, current.sourceId),
            currentRun.projectId === null
              ? eq(scanRuns.id, scanRunId)
              : eq(scanRequests.projectId, currentRun.projectId),
            lt(signalMetricSnapshots.observedAt, currentRun.createdAt),
          ),
        )
        .orderBy(desc(signalMetricSnapshots.observedAt))
        .limit(boundedLimit - 1);
      result.push(...history.map((snapshot) => ({ ...snapshot, signalId: current.id })), {
        signalId: current.id,
        observedAt: current.observedAt,
        metrics: current.metrics,
      });
    }
    return result
      .sort((left, right) => left.observedAt.getTime() - right.observedAt.getTime())
      .slice(0, Math.min(metricSignals.length * boundedLimit, 500));
  }

  async upsertSignal(sourceRunId: string, input: Signal) {
    const signal = SignalSchema.parse(input);
    return this.db.transaction(async (tx) => {
      const [stored] = await tx
        .insert(signals)
        .values({
          sourceRunId,
          source: signal.source,
          sourceId: signal.sourceId,
          canonicalUrl: signal.url,
          title: signal.title ? redactSecrets(signal.title) : null,
          textExcerpt: signal.textExcerpt ? redactSecrets(signal.textExcerpt) : null,
          author: signal.author ?? null,
          publishedAt: signal.publishedAt ? new Date(signal.publishedAt) : null,
          observedAt: new Date(signal.observedAt),
          language: signal.language ?? null,
          metrics: signal.metrics,
          queryId: signal.queryId,
          provider: signal.provenance.provider,
          providerRequestId: signal.provenance.requestId ?? null,
          retrievedAt: new Date(signal.provenance.retrievedAt),
          cached: signal.provenance.cached,
          rawPayloadHash: signal.provenance.rawPayloadHash ?? null,
          provenance: signal.provenance,
        })
        .onConflictDoUpdate({
          target: [signals.sourceRunId, signals.source, signals.sourceId],
          set: {
            canonicalUrl: signal.url,
            title: signal.title ? redactSecrets(signal.title) : null,
            textExcerpt: signal.textExcerpt ? redactSecrets(signal.textExcerpt) : null,
            author: signal.author ?? null,
            publishedAt: signal.publishedAt ? new Date(signal.publishedAt) : null,
            observedAt: new Date(signal.observedAt),
            language: signal.language ?? null,
            metrics: signal.metrics,
            queryId: signal.queryId,
            provider: signal.provenance.provider,
            providerRequestId: signal.provenance.requestId ?? null,
            retrievedAt: new Date(signal.provenance.retrievedAt),
            cached: signal.provenance.cached,
            rawPayloadHash: signal.provenance.rawPayloadHash ?? null,
            provenance: signal.provenance,
          },
        })
        .returning();
      if (!stored) throw new Error("Could not store signal");
      await tx
        .insert(signalMetricSnapshots)
        .values({
          signalId: stored.id,
          observedAt: new Date(signal.observedAt),
          metrics: signal.metrics,
        })
        .onConflictDoUpdate({
          target: [signalMetricSnapshots.signalId, signalMetricSnapshots.observedAt],
          set: { metrics: signal.metrics },
        });
      return stored;
    });
  }

  async addMetricSnapshot(input: {
    signalId: string;
    evidenceReceiptId?: string;
    expectedVersion?: number;
    observedAt: string;
    metrics: Signal["metrics"];
  }) {
    const snapshot = SignalMetricSnapshotSchema.parse(input);
    const [stored] = await this.db
      .insert(signalMetricSnapshots)
      .values({
        signalId: snapshot.signalId,
        observedAt: new Date(snapshot.observedAt),
        metrics: snapshot.metrics,
      })
      .onConflictDoUpdate({
        target: [signalMetricSnapshots.signalId, signalMetricSnapshots.observedAt],
        set: { metrics: snapshot.metrics },
      })
      .returning();
    return stored ?? null;
  }

  async createCluster(input: {
    scanRunId: string;
    dedupeKey: string;
    topic: string;
    summary?: string;
    signalClass: SignalClass;
    independentSourceCount: number;
    saturation: typeof clusters.$inferInsert.saturation;
    scoreComponents?: Record<string, number>;
    members: Array<{ signalId: string; similarity: number; isPrimary?: boolean }>;
  }) {
    if (!input.dedupeKey.trim()) {
      throw new Error("A cluster requires a stable dedupe key");
    }
    if (input.members.length === 0) {
      throw new Error("A cluster requires at least one stored signal");
    }
    if (
      input.independentSourceCount < 0 ||
      input.members.some((member) => member.similarity < 0 || member.similarity > 1)
    ) {
      throw new Error("Cluster counts and similarities are outside valid bounds");
    }
    return this.db.transaction(async (tx) => {
      const storedSignals = await tx
        .select({ id: signals.id })
        .from(signals)
        .innerJoin(sourceRuns, eq(signals.sourceRunId, sourceRuns.id))
        .where(
          and(
            eq(sourceRuns.scanRunId, input.scanRunId),
            inArray(
              signals.id,
              input.members.map((member) => member.signalId),
            ),
          ),
        );
      if (storedSignals.length !== new Set(input.members.map((member) => member.signalId)).size) {
        throw new Error("Every cluster member must belong to the same scan run");
      }
      const [cluster] = await tx
        .insert(clusters)
        .values({
          scanRunId: input.scanRunId,
          dedupeKey: redactSecrets(input.dedupeKey).slice(0, 200),
          topic: redactSecrets(input.topic).slice(0, 500),
          summary: input.summary ? redactSecrets(input.summary).slice(0, 4_000) : null,
          signalClass: input.signalClass,
          independentSourceCount: input.independentSourceCount,
          saturation: input.saturation,
          scoreComponents: input.scoreComponents ?? null,
        })
        .onConflictDoNothing()
        .returning();
      if (!cluster) {
        const [existing] = await tx
          .select()
          .from(clusters)
          .where(
            and(
              eq(clusters.scanRunId, input.scanRunId),
              eq(clusters.dedupeKey, redactSecrets(input.dedupeKey).slice(0, 200)),
            ),
          )
          .limit(1);
        if (!existing) throw new Error("Could not create signal cluster");
        const members = await tx
          .select()
          .from(clusterMembers)
          .where(eq(clusterMembers.clusterId, existing.id));
        return { cluster: existing, members, created: false as const };
      }
      const members = await tx
        .insert(clusterMembers)
        .values(
          input.members.map((member) => ({
            clusterId: cluster.id,
            signalId: member.signalId,
            similarity: member.similarity.toFixed(5),
            isPrimary: member.isPrimary ?? false,
          })),
        )
        .returning();
      return { cluster, members, created: true as const };
    });
  }

  async listClustersForRun(scanRunId: string) {
    return this.db
      .select()
      .from(clusters)
      .where(eq(clusters.scanRunId, scanRunId))
      .orderBy(asc(clusters.createdAt));
  }

  async listOpportunitiesForRun(scanRunId: string) {
    return this.db
      .select()
      .from(opportunities)
      .where(eq(opportunities.scanRunId, scanRunId))
      .orderBy(asc(opportunities.moveVersion), asc(opportunities.rank));
  }

  async createOpportunity(input: {
    scanRunId: string;
    clusterId?: string;
    rank: number;
    actionCandidate: typeof opportunities.$inferInsert.actionCandidate;
    channel: string;
    format: string;
    totalScore: number;
    scoreComponents: Record<string, number>;
    passesQualityFloor: boolean;
    rejectionReason?: string;
    validUntil?: Date;
    scoreVersion: string;
  }) {
    if (input.rank < 1 || input.totalScore < -1 || input.totalScore > 1) {
      throw new Error("Opportunity rank or score is outside valid bounds");
    }
    const [opportunity] = await this.db
      .insert(opportunities)
      .values({
        scanRunId: input.scanRunId,
        clusterId: input.clusterId ?? null,
        rank: input.rank,
        actionCandidate: input.actionCandidate,
        channel: input.channel.slice(0, 100),
        format: input.format.slice(0, 100),
        totalScore: input.totalScore.toFixed(6),
        scoreComponents: input.scoreComponents,
        passesQualityFloor: input.passesQualityFloor,
        rejectionReason: input.rejectionReason
          ? redactSecrets(input.rejectionReason).slice(0, 4_000)
          : null,
        validUntil: input.validUntil ?? null,
        scoreVersion: input.scoreVersion.slice(0, 100),
      })
      .onConflictDoNothing()
      .returning();
    if (opportunity) return opportunity;
    const [existing] = await this.db
      .select()
      .from(opportunities)
      .where(and(eq(opportunities.scanRunId, input.scanRunId), eq(opportunities.rank, input.rank)))
      .limit(1);
    if (!existing) throw new Error("Could not create opportunity");
    return existing;
  }

  async createDraftNextMove(input: {
    scanRequestId: string;
    scanRunId: string;
    projectContextVersionId: string;
    opportunityId?: string;
    move: NextMove;
    versionedMove: VersionedNextMove;
    whyNow: string;
    signalClass: SignalClass;
    independentSourceCount: number;
    saturation: typeof nextMoves.$inferInsert.saturation;
    limitations: string[];
    confidenceRationale?: string;
    promptVersion: string;
    scoreVersion: string;
    publicId?: string;
  }) {
    const move = NextMoveSchema.parse(input.move);
    const versionedMove = VersionedNextMoveSchema.parse(input.versionedMove);
    if (versionedMove.action !== move.action) {
      throw new Error("Versioned action details must match the persisted primary action");
    }
    if (versionedMove.validUntil !== move.validUntil) {
      throw new Error("Versioned trend-window validity must match the primary move validity");
    }
    const [requestIdentity] = await this.db
      .select({ projectId: scanRequests.projectId, normalizedUrl: scanRequests.normalizedUrl })
      .from(scanRequests)
      .where(eq(scanRequests.id, input.scanRequestId))
      .limit(1);
    if (!requestIdentity?.projectId) {
      throw new Error("A draft requires an exact project and context identity");
    }
    await this.db.execute(
      sql`SELECT id FROM projects WHERE id = ${requestIdentity.projectId} FOR UPDATE`,
    );
    const [projectIdentity] = await this.db
      .select({ status: projects.status, normalizedUrl: projects.normalizedUrl })
      .from(projects)
      .where(eq(projects.id, requestIdentity.projectId))
      .limit(1);
    const [contextIdentity] = await this.db
      .select({
        projectId: projectContextVersions.projectId,
        isCurrent: projectContextVersions.isCurrent,
      })
      .from(projectContextVersions)
      .where(eq(projectContextVersions.id, input.projectContextVersionId))
      .limit(1);
    if (
      projectIdentity?.status !== "ACTIVE" ||
      projectIdentity.normalizedUrl !== requestIdentity.normalizedUrl ||
      contextIdentity?.projectId !== requestIdentity.projectId ||
      contextIdentity.isCurrent !== true
    ) {
      throw new Error("The project context changed before the draft could be persisted");
    }
    const [created] = await this.db
      .insert(nextMoves)
      .values({
        publicId: input.publicId ?? createPrefixedId("move"),
        scanRequestId: input.scanRequestId,
        scanRunId: input.scanRunId,
        projectContextVersionId: input.projectContextVersionId,
        opportunityId: input.opportunityId ?? null,
        state: "DRAFT",
        action: move.action,
        channel: move.channel,
        topic: move.topic,
        angle: move.angle,
        format: move.format,
        hook: move.hook,
        outline: move.outline,
        cta: move.cta,
        priority: move.priority,
        confidence: move.confidence.toFixed(5),
        confidenceRationale: input.confidenceRationale ?? null,
        whyNow: input.whyNow,
        signalClass: input.signalClass,
        independentSourceCount: input.independentSourceCount,
        saturation: input.saturation,
        limitations: input.limitations,
        promptVersion: input.promptVersion,
        scoreVersion: input.scoreVersion,
        decisionContractVersion: versionedMove.contractVersion,
        actionDetails: versionedMove.details,
        trendWindow: versionedMove.trendWindow,
        breakoutPotential: versionedMove.breakoutPotential,
        generationLevel: versionedMove.generationLevel,
        draftContent: versionedMove.draftContent ?? null,
        proposalStale: false,
        validUntil: new Date(move.validUntil),
      })
      .onConflictDoNothing()
      .returning();
    if (created) return created;
    const [existing] = await this.db
      .select()
      .from(nextMoves)
      .where(eq(nextMoves.scanRunId, input.scanRunId))
      .limit(1);
    if (!existing) throw new Error("Could not create draft Next Move");
    return existing;
  }

  async bindEvidence(input: {
    nextMoveId: string;
    signalId: string;
    evidenceReceiptId?: string;
    expectedVersion?: number;
    reason: string;
    reviewerId?: string;
    verified?: boolean;
  }) {
    return this.db.transaction(async (tx) => {
      const [identity] = await tx
        .select({
          id: nextMoves.id,
          scanRequestId: nextMoves.scanRequestId,
          scanRunId: nextMoves.scanRunId,
        })
        .from(nextMoves)
        .where(eq(nextMoves.id, input.nextMoveId))
        .limit(1);
      if (!identity) throw new Error("Next Move was not found");
      await tx.execute(
        sql`SELECT id FROM scan_requests WHERE id = ${identity.scanRequestId} FOR UPDATE`,
      );
      await tx.execute(sql`SELECT id FROM scan_runs WHERE id = ${identity.scanRunId} FOR UPDATE`);
      await tx.execute(sql`SELECT id FROM next_moves WHERE id = ${identity.id} FOR UPDATE`);
      const [stored] = await tx
        .select({
          signal: signals,
          sourceRun: sourceRuns,
          move: nextMoves,
          requestState: scanRequests.state,
          runState: scanRuns.state,
        })
        .from(signals)
        .innerJoin(sourceRuns, eq(signals.sourceRunId, sourceRuns.id))
        .innerJoin(nextMoves, eq(nextMoves.id, input.nextMoveId))
        .innerJoin(scanRequests, eq(scanRequests.id, nextMoves.scanRequestId))
        .innerJoin(scanRuns, eq(scanRuns.id, nextMoves.scanRunId))
        .where(and(eq(signals.id, input.signalId), eq(sourceRuns.scanRunId, nextMoves.scanRunId)))
        .limit(1);
      if (!stored) {
        throw new Error("Evidence must reference a stored signal from the same scan run");
      }
      const processingBind =
        stored.requestState === "RUNNING" &&
        stored.runState === "RUNNING" &&
        stored.move.state === "DRAFT" &&
        input.reviewerId === undefined &&
        input.verified !== true;
      const founderReviewStage =
        stored.requestState === "REVIEW_REQUIRED" &&
        stored.runState === "REVIEW_REQUIRED" &&
        stored.move.state === "DRAFT";
      const reviewerId = input.reviewerId?.trim();
      if (
        founderReviewStage &&
        (!Number.isSafeInteger(input.expectedVersion) ||
          input.expectedVersion !== stored.move.reviewVersion)
      ) {
        throw new ReviewVersionConflictError();
      }
      if (founderReviewStage && !input.evidenceReceiptId) {
        throw new Error("Founder review evidence binding requires the current receipt identity");
      }
      if (founderReviewStage && !reviewerId) {
        throw new Error("Founder review evidence binding requires a non-empty reviewer identity");
      }
      if (founderReviewStage && input.verified !== true) {
        throw new Error("Founder review evidence binding requires verified=true");
      }
      const founderReviewBind =
        founderReviewStage && Boolean(reviewerId) && input.verified === true;
      if (!processingBind && !founderReviewBind) {
        throw new Error("Evidence can only be bound to a founder review draft");
      }
      const verified = input.verified ?? false;
      const [before] = await tx
        .select()
        .from(evidenceReceipts)
        .where(
          and(
            eq(evidenceReceipts.nextMoveId, stored.move.id),
            eq(evidenceReceipts.moveVersion, stored.move.reviewVersion),
            eq(evidenceReceipts.signalId, stored.signal.id),
            ...(founderReviewStage && input.evidenceReceiptId
              ? [eq(evidenceReceipts.id, input.evidenceReceiptId)]
              : []),
          ),
        )
        .limit(1);
      const verifiedAt = verified ? new Date() : null;
      if (founderReviewStage && !before) throw new ReviewVersionConflictError();
      const [receipt] = await tx
        .insert(evidenceReceipts)
        .values({
          nextMoveId: stored.move.id,
          moveVersion: stored.move.reviewVersion,
          signalId: stored.signal.id,
          source: stored.signal.source,
          provider: stored.signal.provider,
          canonicalUrl: stored.signal.canonicalUrl,
          title: stored.signal.title,
          publishedAt: stored.signal.publishedAt,
          observedAt: stored.signal.observedAt,
          reason: redactSecrets(input.reason),
          verified,
          verifiedAt,
          reviewedBy: reviewerId ?? null,
        })
        .onConflictDoUpdate({
          target: [
            evidenceReceipts.nextMoveId,
            evidenceReceipts.moveVersion,
            evidenceReceipts.signalId,
          ],
          set: {
            reason: redactSecrets(input.reason),
            verified,
            verifiedAt,
            reviewedBy: reviewerId ?? null,
            availability: "AVAILABLE",
          },
        })
        .returning();
      if (!receipt) throw new Error("Could not bind evidence");
      if (founderReviewBind && reviewerId) {
        await tx.insert(reviewEvents).values({
          scanRequestId: stored.move.scanRequestId,
          scanRunId: stored.move.scanRunId,
          nextMoveId: stored.move.id,
          action: "EVIDENCE_VERIFIED",
          reviewerId,
          before: before
            ? {
                evidenceReceiptId: before.id,
                moveVersion: before.moveVersion,
                verified: before.verified,
                reviewedBy: before.reviewedBy,
                verifiedAt: before.verifiedAt?.toISOString() ?? null,
                availability: before.availability,
              }
            : null,
          after: {
            evidenceReceiptId: receipt.id,
            moveVersion: receipt.moveVersion,
            verified: true,
            reviewedBy: reviewerId,
            verifiedAt: receipt.verifiedAt?.toISOString() ?? null,
            availability: receipt.availability,
          },
          note: redactSecrets(input.reason).slice(0, 4_000),
        });
      }
      return receipt;
    });
  }
}
