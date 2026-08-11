import { and, asc, eq, inArray } from "drizzle-orm";

import { createPrefixedId, redactRecord, redactSecrets } from "@trendsfast/core";
import {
  NextMoveSchema,
  ProjectContextSchema,
  QueryPlanSchema,
  SignalMetricSnapshotSchema,
  SignalSchema,
  type NextMove,
  type ProjectContext,
  type QueryPlan,
  type Signal,
  type SignalClass,
  type SourceRunState,
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
  scanRequests,
  scanRuns,
  signalMetricSnapshots,
  signals,
  sourceRuns,
} from "../schema";
import { normalizeProductUrl } from "./lifecycle";

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

  async addProjectContext(input: {
    projectId: string;
    context: ProjectContext;
    sourceContentHash?: string;
    promptVersion?: string;
    model?: string;
    createdBy?: string;
  }) {
    const context = ProjectContextSchema.parse(input.context);
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

  async listSignalsForRun(scanRunId: string) {
    return this.db
      .select({ signal: signals, sourceRun: sourceRuns })
      .from(signals)
      .innerJoin(sourceRuns, eq(signals.sourceRunId, sourceRuns.id))
      .where(eq(sourceRuns.scanRunId, scanRunId))
      .orderBy(asc(signals.observedAt));
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
    reason: string;
    reviewerId?: string;
    verified?: boolean;
  }) {
    const [signal] = await this.db
      .select()
      .from(signals)
      .where(eq(signals.id, input.signalId))
      .limit(1);
    if (!signal) throw new Error("Evidence must reference a stored signal");
    const verified = input.verified ?? false;
    const [receipt] = await this.db
      .insert(evidenceReceipts)
      .values({
        nextMoveId: input.nextMoveId,
        signalId: signal.id,
        source: signal.source,
        provider: signal.provider,
        canonicalUrl: signal.canonicalUrl,
        title: signal.title,
        publishedAt: signal.publishedAt,
        observedAt: signal.observedAt,
        reason: redactSecrets(input.reason),
        verified,
        verifiedAt: verified ? new Date() : null,
        reviewedBy: input.reviewerId ?? null,
      })
      .onConflictDoUpdate({
        target: [evidenceReceipts.nextMoveId, evidenceReceipts.signalId],
        set: {
          reason: redactSecrets(input.reason),
          verified,
          verifiedAt: verified ? new Date() : null,
          reviewedBy: input.reviewerId ?? null,
          availability: "AVAILABLE",
        },
      })
      .returning();
    if (!receipt) throw new Error("Could not bind evidence");
    return receipt;
  }
}
