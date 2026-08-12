import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createDatabaseFromEnv,
  createRepositories,
  ReviewVersionConflictError,
} from "@trendsfast/database";
import {
  buildQueryPlan,
  createFixtureProviderRegistry,
  createProviderContext,
  projectContextToProductQueryContext,
} from "@trendsfast/providers";
import { ProjectContextSchema } from "@trendsfast/schemas";

import {
  createDatabaseProcessingStore,
  measurementFragment,
  storedSignal,
} from "../src/database-store";
import { decideDeterministically } from "../src/decision";
import { inferFixtureProjectContext } from "../src/context";
import { createProviderRunner } from "../src/provider-runner";
import { processScan } from "../src/state-machine";

const databaseDescribe = process.env.RUN_DATABASE_INTEGRATION === "1" ? describe : describe.skip;

databaseDescribe("persisted fixture scan", () => {
  const client = createDatabaseFromEnv();
  const repositories = createRepositories(client.db);
  const url = `https://integration-${process.pid}.example`;
  const cleanupUrls = new Set([url]);
  let publicId = "";

  function fixtureDependencies(actionable = false) {
    return {
      store: createDatabaseProcessingStore(repositories),
      inferContext: inferFixtureProjectContext,
      planQueries: (
        context: Parameters<typeof projectContextToProductQueryContext>[0],
        options: Parameters<typeof buildQueryPlan>[1],
      ) => buildQueryPlan(projectContextToProductQueryContext(context), options),
      providers: createProviderRunner({
        registry: createFixtureProviderRegistry(),
        context: createProviderContext({ credentialMode: "fixture" }),
      }),
      decide: actionable
        ? async (input: Parameters<typeof decideDeterministically>[0]) => {
            const base = await decideDeterministically(input);
            const hackerNews = input.signals.find((signal) => signal.source === "hacker_news");
            const github = input.signals.find((signal) => signal.source === "github");
            if (!hackerNews || !github) {
              throw new Error("The actionable fixture requires two independent stored sources");
            }
            return {
              ...base,
              move: {
                ...base.move,
                action: "PUBLISH" as const,
                priority: 80,
                confidence: 0.8,
              },
              whyNow: "Two independent fixture sources support the bounded repository review test.",
              signalClass: "CORROBORATED_SIGNAL" as const,
              independentSourceCount: 2,
              evidenceSignalIds: [hackerNews.id, github.id],
              confidenceRationale:
                "The integration fixture intentionally exercises the actionable review path.",
            };
          }
        : decideDeterministically,
      maxCostUsd: 0.25,
      maxDurationMs: 30_000,
    };
  }

  async function createProcessedScan(label: string, exactUrl?: string) {
    const scanUrl = exactUrl ?? `https://trendsfast.com/${label}-${process.pid}`;
    cleanupUrls.add(scanUrl);
    const created = await repositories.scans.createRequest({
      request: { product_url: scanUrl },
      origin: "FIXTURE",
    });
    const processed = await processScan(created.request.publicId, fixtureDependencies(true));
    expect(processed.state).toBe("REVIEW_REQUIRED");
    const detail = await repositories.scans.getStatusByPublicId(created.request.publicId);
    if (!detail?.run || !detail.move || !detail.context || !detail.project) {
      throw new Error("The fixture review draft was not persisted");
    }
    return { scanUrl, publicId: created.request.publicId, processed, detail };
  }

  beforeAll(async () => {
    const created = await repositories.scans.createRequest({
      request: { product_url: url },
      origin: "FIXTURE",
    });
    publicId = created.request.publicId;
  });

  afterAll(async () => {
    for (const normalizedUrl of cleanupUrls) {
      await repositories.privacy.deleteProjectData({ normalizedUrl });
    }
    await client.close();
  });

  it("persists, reviews, delivers, and safely retries one bounded decision", async () => {
    const dependencies = fixtureDependencies();

    const processed = await processScan(publicId, dependencies);
    expect(processed.state).toBe("REVIEW_REQUIRED");
    expect(processed.costUsd).toBe(0);

    const pending = await repositories.scans.getStatusByPublicId(publicId);
    expect(pending?.request.state).toBe("REVIEW_REQUIRED");
    expect(pending?.move?.founderReviewed).toBe(false);
    expect(pending?.move?.autoPublish).toBe(false);
    expect(pending?.evidence.length).toBeGreaterThan(0);
    if (!pending?.move) throw new Error("The persisted draft is missing");

    if (pending.move.action !== "WAIT") {
      const originalSourceCount = pending.move.independentSourceCount;
      const manual = await repositories.manualEvidence.add({
        scanPublicId: publicId,
        signal: {
          id: "manual_integration_signal",
          source: "manual",
          sourceId: "manual_integration_unrelated",
          url: "https://example.com/unrelated-post",
          title: "An unrelated founder-observed post",
          observedAt: new Date().toISOString(),
          metrics: {},
          queryId: "manual_integration_query",
          provenance: {
            provider: "MANUAL_FOUNDER_EVIDENCE",
            requestId: "manual_integration_request",
            retrievedAt: new Date().toISOString(),
            cached: false,
            rawPayloadHash: "0123456789abcdef0123456789abcdef",
          },
        },
        sourceLabel: "Unrelated founder observation",
        reason: "Stored only to prove post-hoc evidence cannot qualify this recommendation.",
        reviewerId: "integration-founder",
        deployment: {
          deploymentEnvironment: "local",
          releaseSha: null,
          deploymentHost: null,
          deploymentId: null,
        },
      });
      expect(manual.receipt).toMatchObject({
        bindingRole: "SUPPLEMENTAL",
        verified: false,
      });
      await repositories.scanData.bindEvidence({
        nextMoveId: pending.move.id,
        signalId: manual.signal.id,
        evidenceReceiptId: manual.receipt.id,
        expectedVersion: pending.move.reviewVersion,
        reason: "The founder checked the URL, but it remains supplemental to the prior synthesis.",
        reviewerId: "integration-founder",
        verified: true,
      });
      await expect(
        repositories.reviews.approve({
          nextMoveId: pending.move.id,
          reviewerId: "integration-founder",
          expectedVersion: pending.move.reviewVersion,
        }),
      ).rejects.toThrow("requires verified stored evidence");
      const afterManual = await repositories.scans.getStatusByPublicId(publicId);
      expect(afterManual?.move?.independentSourceCount).toBe(originalSourceCount);
      expect(
        afterManual?.evidence.find((receipt) => receipt.id === manual.receipt.id)?.bindingRole,
      ).toBe("SUPPLEMENTAL");

      const decisionReceipts = pending.evidence.filter(
        (receipt) => receipt.bindingRole === "DECISION_SUPPORT",
      );
      if (decisionReceipts.length === 0) {
        throw new Error("An actionable move requires persisted decision-support evidence");
      }
      await expect(
        repositories.scanData.bindEvidence({
          nextMoveId: pending.move.id,
          signalId: decisionReceipts[0]!.signalId,
          evidenceReceiptId: decisionReceipts[0]!.id,
          expectedVersion: pending.move.reviewVersion,
          reason: decisionReceipts[0]!.reason,
          verified: true,
        }),
      ).rejects.toThrow(/reviewer identity/i);
      await expect(
        repositories.scanData.bindEvidence({
          nextMoveId: pending.move.id,
          signalId: decisionReceipts[0]!.signalId,
          evidenceReceiptId: decisionReceipts[0]!.id,
          expectedVersion: pending.move.reviewVersion,
          reason: decisionReceipts[0]!.reason,
          reviewerId: "integration-founder",
          verified: false,
        }),
      ).rejects.toThrow(/verified=true/i);
      for (const [index, receipt] of decisionReceipts.entries()) {
        await repositories.scanData.bindEvidence({
          nextMoveId: pending.move.id,
          signalId: receipt.signalId,
          evidenceReceiptId: receipt.id,
          expectedVersion: pending.move.reviewVersion,
          reason: receipt.reason,
          reviewerId: "integration-founder",
          verified: true,
        });
        if (index === 0 && decisionReceipts.length > 1) {
          await expect(
            repositories.reviews.approve({
              nextMoveId: pending.move.id,
              reviewerId: "integration-founder",
              expectedVersion: pending.move.reviewVersion,
            }),
          ).rejects.toThrow(/every decision-support receipt/i);
        }
      }
      const evidenceAudit = await repositories.reviews.listEvents(pending.request.id);
      expect(
        evidenceAudit.some(
          (event) =>
            event.action === "EVIDENCE_VERIFIED" &&
            event.reviewerId === "integration-founder" &&
            event.nextMoveId === pending.move!.id,
        ),
      ).toBe(true);
    }
    await repositories.reviews.approve({
      nextMoveId: pending.move.id,
      reviewerId: "integration-founder",
      expectedVersion: pending.move.reviewVersion,
    });
    const delivery = await repositories.delivery.deliver({
      nextMoveId: pending.move.id,
      reviewerId: "integration-founder",
      expiresAt: new Date(Date.now() + 7 * 86_400_000),
    });
    expect(delivery.created).toBe(true);
    if (!delivery.created) throw new Error("The integration delivery was not issued");

    const result = await repositories.delivery.getResultByToken(delivery.rawToken, false);
    expect(result?.move.state).toBe("READY");
    expect(result?.move.founderReviewed).toBe(true);
    expect(result?.move.autoPublish).toBe(false);

    await expect(
      repositories.reviews.convertToWait({
        nextMoveId: pending.move.id,
        reviewerId: "stale-integration-founder",
        expectedVersion: pending.move.reviewVersion,
        reason: "A stale review action must not rewrite a delivered move.",
        validUntil: new Date(Date.now() + 86_400_000),
      }),
    ).rejects.toThrow(/review draft/i);
    const deliveredReceipt = pending.evidence[0];
    if (deliveredReceipt) {
      await expect(
        repositories.scanData.bindEvidence({
          nextMoveId: pending.move.id,
          signalId: deliveredReceipt.signalId,
          evidenceReceiptId: deliveredReceipt.id,
          expectedVersion: pending.move.reviewVersion,
          reason: "A stale evidence verification must not rewrite a delivered receipt.",
          reviewerId: "stale-integration-founder",
          verified: true,
        }),
      ).rejects.toThrow(/review draft/i);
      await expect(
        repositories.reviews.rejectEvidence({
          evidenceReceiptId: deliveredReceipt.id,
          reviewerId: "stale-integration-founder",
          expectedVersion: pending.move.reviewVersion,
          reason: "A stale evidence rejection must not rewrite a delivered receipt.",
        }),
      ).rejects.toThrow(/review draft/i);
    }

    const retried = await processScan(publicId, dependencies);
    expect(retried.state).toBe("READY");
    expect(retried.costUsd).toBe(0);
    expect((await repositories.costs.totalsForScan(processed.runId!)).actualCostUsd).toBe(0);
  });

  it("serializes edit-and-approve, preserves immutable decision data, and delivers only current evidence", async () => {
    const { publicId: editPublicId, detail } = await createProcessedScan("integration-edit");
    const move = detail.move!;
    const context = detail.context!;
    const run = detail.run!;
    expect(move.action).not.toBe("WAIT");
    const decisionReceipts = detail.evidence.filter(
      (receipt) => receipt.bindingRole === "DECISION_SUPPORT",
    );
    expect(decisionReceipts.length).toBeGreaterThan(1);
    const receipt = decisionReceipts[0]!;

    await expect(
      repositories.reviews.convertToWait({
        nextMoveId: move.id,
        reviewerId: " ",
        expectedVersion: move.reviewVersion,
        reason: "This otherwise meaningful reason must still require a reviewer.",
        validUntil: new Date(Date.now() + 86_400_000),
      }),
    ).rejects.toThrow(/reviewer identity/i);
    await expect(
      repositories.reviews.convertToWait({
        nextMoveId: move.id,
        reviewerId: "integration-founder",
        expectedVersion: move.reviewVersion,
        reason: "too short",
        validUntil: new Date(Date.now() + 86_400_000),
      }),
    ).rejects.toThrow(/meaningful reason/i);
    await expect(
      repositories.reviews.rejectEvidence({
        evidenceReceiptId: receipt.id,
        reviewerId: " ",
        expectedVersion: move.reviewVersion,
        reason: "This otherwise meaningful reason must still require a reviewer.",
      }),
    ).rejects.toThrow(/reviewer identity/i);
    await expect(
      repositories.reviews.rejectEvidence({
        evidenceReceiptId: receipt.id,
        reviewerId: "integration-founder",
        expectedVersion: move.reviewVersion,
        reason: "too short",
      }),
    ).rejects.toThrow(/meaningful reason/i);

    for (const current of decisionReceipts) {
      const verified = await repositories.scanData.bindEvidence({
        nextMoveId: move.id,
        signalId: current.signalId,
        evidenceReceiptId: current.id,
        expectedVersion: move.reviewVersion,
        reason: current.reason,
        reviewerId: "integration-founder",
        verified: true,
      });
      expect(verified.reviewedBy).toBe("integration-founder");
      expect(verified.verifiedAt).toBeInstanceOf(Date);
    }

    const contextValue = ProjectContextSchema.parse(context);
    const validUntil = new Date(Date.now() + 2 * 86_400_000);
    const baseEdits = {
      topic: `${move.topic} · founder edit`,
      angle: move.angle,
      channel: move.channel,
      format: move.format,
      hook: move.hook,
      outline: [...move.outline],
      cta: move.cta,
      whyNow: move.whyNow,
      limitations: [...move.limitations],
      validUntil,
      confidenceRationale:
        move.confidenceRationale ?? "The verified current receipts still support this action.",
    };
    await expect(
      repositories.reviews.editAndApprove({
        nextMoveId: move.id,
        reviewerId: "integration-founder",
        expectedVersion: move.reviewVersion,
        reason: "A channel outside the reviewed context must fail the quality floor.",
        edits: { ...baseEdits, channel: "unreviewed_channel" },
      }),
    ).rejects.toThrow(/channel.*current.*context/i);
    await expect(
      repositories.reviews.editAndApprove({
        nextMoveId: move.id,
        reviewerId: "integration-founder",
        expectedVersion: move.reviewVersion,
        reason: "A format outside the reviewed context must fail the quality floor.",
        edits: { ...baseEdits, format: "unreviewed_format" },
      }),
    ).rejects.toThrow(/format.*current.*context/i);
    expect(contextValue.suitableChannels).toContain(baseEdits.channel);
    expect(contextValue.availableFormats).toContain(baseEdits.format);

    const beforeSignals = await repositories.scanData.listSignalsForRun(run.id);
    const beforeCosts = await repositories.costs.totalsForScan(run.id);
    const attempts = await Promise.allSettled([
      repositories.reviews.editAndApprove({
        nextMoveId: move.id,
        reviewerId: "integration-founder-a",
        expectedVersion: move.reviewVersion,
        reason: "Founder A tightened the topic after reviewing the same immutable receipts.",
        edits: { ...baseEdits, topic: `${move.topic} · founder edit A` },
      }),
      repositories.reviews.editAndApprove({
        nextMoveId: move.id,
        reviewerId: "integration-founder-b",
        expectedVersion: move.reviewVersion,
        reason: "Founder B concurrently tightened the topic from the same loaded version.",
        edits: { ...baseEdits, topic: `${move.topic} · founder edit B` },
      }),
    ]);
    const fulfilled = attempts.filter((attempt) => attempt.status === "fulfilled");
    const rejected = attempts.filter((attempt) => attempt.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      ReviewVersionConflictError,
    );

    const edited = await repositories.scans.getStatusByPublicId(editPublicId);
    if (!edited?.move) throw new Error("The edited move was not persisted");
    expect(edited.move).toMatchObject({
      action: move.action,
      opportunityId: move.opportunityId,
      priority: move.priority,
      confidence: move.confidence,
      signalClass: move.signalClass,
      reviewVersion: move.reviewVersion + 1,
      state: "APPROVED",
      founderReviewed: true,
    });
    expect(edited.move.independentSourceCount).toBe(move.independentSourceCount);
    expect(edited.evidence).toHaveLength(detail.evidence.length);
    expect(
      edited.evidence.every((current) => current.moveVersion === edited.move!.reviewVersion),
    ).toBe(true);
    expect(new Set(edited.evidence.map((current) => current.signalId))).toEqual(
      new Set(detail.evidence.map((current) => current.signalId)),
    );
    expect(await repositories.scanData.listSignalsForRun(run.id)).toEqual(beforeSignals);
    expect(await repositories.costs.totalsForScan(run.id)).toEqual(beforeCosts);

    const revisions = await repositories.reviews.listRevisions(move.id);
    const editRevision = revisions.find((revision) => revision.changeKind === "EDIT_AND_APPROVE");
    expect(editRevision).toMatchObject({
      version: move.reviewVersion + 1,
      reason: expect.stringMatching(/immutable receipts|same loaded version/),
      promptVersion: move.promptVersion,
      scoreVersion: move.scoreVersion,
    });
    expect(editRevision?.retainedEvidenceIds.sort()).toEqual(
      detail.evidence.map((current) => current.signalId).sort(),
    );
    expect(editRevision?.before).toEqual(expect.objectContaining({ action: move.action }));
    expect(editRevision?.after).toEqual(expect.objectContaining({ action: move.action }));

    const delivery = await repositories.delivery.deliver({
      nextMoveId: move.id,
      reviewerId: "integration-founder",
      expiresAt: new Date(Date.now() + 7 * 86_400_000),
    });
    if (!delivery.created) throw new Error("The edited move delivery was not issued");
    const delivered = await repositories.delivery.getResultByToken(delivery.rawToken, false);
    expect(delivered?.evidence).toHaveLength(edited.evidence.length);
    expect(
      delivered?.evidence.every((current) => current.moveVersion === delivered.move.reviewVersion),
    ).toBe(true);
  });

  it("versions corrected context, preserves a stale proposal audit, and recomputes without external calls", async () => {
    const { publicId: contextPublicId, detail } = await createProcessedScan("integration-context");
    const move = detail.move!;
    const context = detail.context!;
    const run = detail.run!;
    const project = detail.project!;
    expect(move.action).not.toBe("WAIT");

    const manual = await repositories.manualEvidence.add({
      scanPublicId: contextPublicId,
      signal: {
        id: "manual_context_rejection",
        source: "manual",
        sourceId: `manual_context_rejection_${process.pid}`,
        url: `https://manual-context-${process.pid}.example/rejected`,
        title: "Founder-rejected manual observation",
        observedAt: new Date().toISOString(),
        metrics: {},
        queryId: "manual_context_rejection_query",
        provenance: {
          provider: "MANUAL_FOUNDER_EVIDENCE",
          requestId: `manual_context_rejection_${process.pid}`,
          retrievedAt: new Date().toISOString(),
          cached: false,
          rawPayloadHash: "abcdef0123456789abcdef0123456789",
        },
      },
      sourceLabel: "Founder-rejected observation",
      reason: "Bind the observation only so rejection can be preserved across recompute.",
      reviewerId: "integration-founder",
      deployment: {
        deploymentEnvironment: "local",
        releaseSha: null,
        deploymentHost: null,
        deploymentId: null,
      },
    });
    await repositories.reviews.rejectEvidence({
      evidenceReceiptId: manual.receipt.id,
      reviewerId: "integration-founder",
      expectedVersion: move.reviewVersion,
      reason: "This observation is unrelated and must never re-enter the recommendation.",
    });
    await expect(
      repositories.reviews.recomputeFromStoredEvidence({
        nextMoveId: move.id,
        reviewerId: "integration-founder",
        expectedVersion: move.reviewVersion,
        reason: "A rejected signal must be refused even through a direct repository call.",
        draft: {
          move: {
            action: move.action,
            channel: move.channel,
            topic: move.topic,
            angle: move.angle,
            format: move.format,
            hook: move.hook,
            outline: move.outline,
            cta: move.cta,
            priority: move.priority,
            confidence: Number(move.confidence),
            validUntil: new Date(Date.now() + 2 * 86_400_000).toISOString(),
          },
          whyNow: move.whyNow,
          signalClass: move.signalClass,
          independentSourceCount: move.independentSourceCount,
          saturation: move.saturation,
          limitations: move.limitations,
          evidenceSignalIds: [manual.signal.id],
          promptVersion: move.promptVersion,
          scoreVersion: move.scoreVersion,
          ...(move.confidenceRationale === null
            ? {}
            : { confidenceRationale: move.confidenceRationale }),
        },
      }),
    ).rejects.toThrow(/rejected evidence cannot re-enter/i);

    const contextBefore = ProjectContextSchema.parse(context);
    const contextVersionsBefore = await repositories.reviews.listContextVersions(project.id);
    const sourceRunsBefore = await repositories.scanData.listSourceRuns(run.id);
    const costsBefore = await repositories.costs.totalsForScan(run.id);
    const evidenceBefore = await repositories.reviews.listEvidenceHistory(move.id);
    const rejectedSignalIds = new Set(
      evidenceBefore
        .filter(
          (receipt) =>
            receipt.moveVersion === move.reviewVersion && receipt.availability === "REJECTED",
        )
        .map((receipt) => receipt.signalId),
    );
    const storedSignals = (await repositories.scanData.listSignalsForRun(run.id)).filter(
      ({ signal }) => !rejectedSignalIds.has(signal.id),
    );
    const correctedContext = ProjectContextSchema.parse({
      ...contextBefore,
      audience: `${contextBefore.audience} who need a same-day distribution decision`,
      assumptions: [
        ...contextBefore.assumptions,
        "The founder confirmed the narrower audience during review.",
      ],
    });
    const recomputedDraft = await decideDeterministically({
      context: correctedContext,
      signals: storedSignals.map(storedSignal),
      measurements: sourceRunsBefore.flatMap((sourceRun) =>
        measurementFragment(sourceRun.providerPayloadFragment),
      ),
      coverage: Object.fromEntries(
        sourceRunsBefore.map((sourceRun) => [sourceRun.source, sourceRun.state]),
      ),
      now: new Date(),
    });
    expect(recomputedDraft.evidenceSignalIds).not.toContain(manual.signal.id);

    const recomputed = await repositories.reviews.recomputeFromStoredEvidence({
      nextMoveId: move.id,
      reviewerId: "integration-founder",
      expectedVersion: move.reviewVersion,
      reason: "Correct the audience and rerank only the already stored eligible evidence.",
      draft: recomputedDraft,
      contextCorrection: correctedContext,
    });
    expect(recomputed).toMatchObject({
      providerCallsMade: 0,
      modelSynthesisPerformed: false,
    });
    expect(await repositories.scanData.listSourceRuns(run.id)).toEqual(sourceRunsBefore);
    expect(await repositories.costs.totalsForScan(run.id)).toEqual(costsBefore);

    const current = await repositories.scans.getStatusByPublicId(contextPublicId);
    if (!current?.move || !current.context)
      throw new Error("The recomputed move was not persisted");
    expect(current.move).toMatchObject({
      reviewVersion: move.reviewVersion + 2,
      proposalStale: false,
      state: "DRAFT",
      founderReviewed: false,
    });
    expect(ProjectContextSchema.parse(current.context).audience).toBe(correctedContext.audience);
    expect(current.evidence.length).toBeGreaterThan(0);
    expect(
      current.evidence.every((receipt) => receipt.moveVersion === current.move!.reviewVersion),
    ).toBe(true);
    expect(
      current.evidence.every(
        (receipt) =>
          !receipt.verified && receipt.reviewedBy === null && receipt.verifiedAt === null,
      ),
    ).toBe(true);
    expect(current.evidence.map((receipt) => receipt.signalId)).not.toContain(manual.signal.id);
    const staleReceipt = detail.evidence[0];
    if (!staleReceipt) throw new Error("The stale-verification regression requires prior evidence");
    await expect(
      repositories.scanData.bindEvidence({
        nextMoveId: move.id,
        signalId: staleReceipt.signalId,
        evidenceReceiptId: staleReceipt.id,
        expectedVersion: move.reviewVersion,
        reason: staleReceipt.reason,
        reviewerId: "stale-integration-founder",
        verified: true,
      }),
    ).rejects.toBeInstanceOf(ReviewVersionConflictError);
    await expect(
      repositories.reviews.approve({
        nextMoveId: move.id,
        reviewerId: "integration-founder",
        expectedVersion: current.move.reviewVersion,
      }),
    ).rejects.toThrow(/renewed founder review/i);

    const contextVersionsAfter = await repositories.reviews.listContextVersions(project.id);
    expect(contextVersionsAfter).toHaveLength(contextVersionsBefore.length + 1);
    expect(contextVersionsAfter.at(-1)).toMatchObject({
      version: contextVersionsBefore.at(-1)!.version + 1,
      isCurrent: true,
      createdBy: "integration-founder",
      model: null,
    });
    expect(contextVersionsAfter.at(-1)?.context).toEqual(correctedContext);
    expect(contextVersionsAfter.at(-2)?.context).toEqual(contextVersionsBefore.at(-1)?.context);

    const revisions = await repositories.reviews.listRevisions(move.id);
    expect(revisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          version: move.reviewVersion + 1,
          changeKind: "CONTEXT_CORRECTION",
          after: expect.objectContaining({ proposalStale: true }),
        }),
        expect.objectContaining({
          version: move.reviewVersion + 2,
          changeKind: "STORED_EVIDENCE_RECOMPUTE",
        }),
      ]),
    );
    const opportunities = await repositories.scanData.listOpportunitiesForRun(run.id);
    expect(opportunities.at(-1)).toMatchObject({
      moveVersion: move.reviewVersion + 2,
      passesQualityFloor: recomputedDraft.move.action !== "WAIT",
      scoreVersion: recomputedDraft.scoreVersion,
    });

    for (const receiptToReview of current.evidence.filter(
      (receipt) => receipt.bindingRole === "DECISION_SUPPORT",
    )) {
      await repositories.scanData.bindEvidence({
        nextMoveId: move.id,
        signalId: receiptToReview.signalId,
        evidenceReceiptId: receiptToReview.id,
        expectedVersion: current.move!.reviewVersion,
        reason: receiptToReview.reason,
        reviewerId: "integration-founder",
        verified: true,
      });
    }
    await repositories.reviews.approve({
      nextMoveId: move.id,
      reviewerId: "integration-founder",
      expectedVersion: current.move.reviewVersion,
    });
    const approved = await repositories.scans.getStatusByPublicId(contextPublicId);
    expect(approved?.move).toMatchObject({ state: "APPROVED", founderReviewed: true });
    expect(approved?.evidence.every((receipt) => receipt.verifiedAt instanceof Date)).toBe(true);
    const audit = await repositories.reviews.listEvents(detail.request.id);
    expect(audit.map((event) => event.action)).toEqual(
      expect.arrayContaining([
        "CONTEXT_EDITED",
        "RECOMPUTED_FROM_STORED_EVIDENCE",
        "EVIDENCE_VERIFIED",
        "APPROVED",
      ]),
    );
  });

  it("versions a WAIT conversion, preserves its immutable lineage, and drops prior evidence bindings", async () => {
    const { publicId: waitPublicId, detail } = await createProcessedScan("integration-wait");
    const move = detail.move!;
    expect(move.action).not.toBe("WAIT");
    expect(detail.evidence.length).toBeGreaterThan(0);

    const reason = "The stored evidence no longer clears the founder-reviewed quality floor.";
    const converted = await repositories.reviews.convertToWait({
      nextMoveId: move.id,
      reviewerId: "integration-founder",
      expectedVersion: move.reviewVersion,
      reason,
      validUntil: new Date(Date.now() + 86_400_000),
    });
    expect(converted).toMatchObject({
      action: "WAIT",
      state: "APPROVED",
      founderReviewed: true,
      reviewVersion: move.reviewVersion + 1,
      independentSourceCount: 0,
    });

    const current = await repositories.scans.getStatusByPublicId(waitPublicId);
    expect(current?.move?.reviewVersion).toBe(move.reviewVersion + 1);
    expect(current?.evidence).toEqual([]);
    const evidenceHistory = await repositories.reviews.listEvidenceHistory(move.id);
    expect(evidenceHistory.length).toBe(detail.evidence.length);
    expect(evidenceHistory.every((receipt) => receipt.moveVersion === move.reviewVersion)).toBe(
      true,
    );
    const revisions = await repositories.reviews.listRevisions(move.id);
    expect(revisions.at(-1)).toMatchObject({
      version: move.reviewVersion + 1,
      changeKind: "CONVERT_TO_WAIT",
      retainedEvidenceIds: [],
      before: expect.objectContaining({
        action: move.action,
        reviewVersion: move.reviewVersion,
        projectContextVersionId: move.projectContextVersionId,
      }),
      after: expect.objectContaining({
        action: "WAIT",
        reviewVersion: move.reviewVersion + 1,
        projectContextVersionId: move.projectContextVersionId,
      }),
    });
    await expect(
      repositories.reviews.convertToWait({
        nextMoveId: move.id,
        reviewerId: "stale-integration-founder",
        expectedVersion: move.reviewVersion,
        reason: "A stale founder tab must not rewrite the newer WAIT proposal lineage.",
        validUntil: new Date(Date.now() + 86_400_000),
      }),
    ).rejects.toBeInstanceOf(ReviewVersionConflictError);
  });

  it("allows exactly one competing context correction across two drafts for the same project", async () => {
    const sharedUrl = `https://trendsfast.com/context-correction-race-${process.pid}`;
    const first = await createProcessedScan("context-race-first", sharedUrl);
    const second = await createProcessedScan("context-race-second", sharedUrl);
    const project = first.detail.project;
    const secondProject = second.detail.project;
    const firstRun = first.detail.run;
    if (!project || !secondProject || !firstRun) {
      throw new Error("The shared-context race requires a persisted project and scan runs");
    }
    expect(project.id).toBe(secondProject.id);
    expect(first.detail.move.projectContextVersionId).not.toBe(
      second.detail.move.projectContextVersionId,
    );

    const sharedContextVersionId = second.detail.move.projectContextVersionId;
    await Promise.all([
      client.pool.query("UPDATE scan_runs SET project_context_version_id = $1 WHERE id = $2", [
        sharedContextVersionId,
        firstRun.id,
      ]),
      client.pool.query("UPDATE next_moves SET project_context_version_id = $1 WHERE id = $2", [
        sharedContextVersionId,
        first.detail.move.id,
      ]),
    ]);
    const [firstDraft, secondDraft] = await Promise.all([
      repositories.scans.getStatusByPublicId(first.publicId),
      repositories.scans.getStatusByPublicId(second.publicId),
    ]);
    if (!firstDraft?.move || !firstDraft.context || !secondDraft?.move || !secondDraft.context) {
      throw new Error("The shared-context race requires two persisted review drafts");
    }
    expect(firstDraft.move.projectContextVersionId).toBe(sharedContextVersionId);
    expect(secondDraft.move.projectContextVersionId).toBe(sharedContextVersionId);
    expect(firstDraft.move.id).not.toBe(secondDraft.move.id);
    expect(firstDraft.move.scanRunId).not.toBe(secondDraft.move.scanRunId);
    expect(firstDraft.move.scanRequestId).not.toBe(secondDraft.move.scanRequestId);
    expect(firstDraft.request.state).toBe("REVIEW_REQUIRED");
    expect(secondDraft.request.state).toBe("REVIEW_REQUIRED");

    const baseContext = ProjectContextSchema.parse(secondDraft.context);
    const corrections = [
      ProjectContextSchema.parse({
        ...baseContext,
        audience: `${baseContext.audience} in the first founder-reviewed segment`,
        assumptions: [...baseContext.assumptions, "The first founder confirmed this segment."],
      }),
      ProjectContextSchema.parse({
        ...baseContext,
        audience: `${baseContext.audience} in the second founder-reviewed segment`,
        assumptions: [...baseContext.assumptions, "The second founder confirmed this segment."],
      }),
    ] as const;
    const buildDraft = (move: typeof firstDraft.move, evidence: typeof firstDraft.evidence) => ({
      move: {
        action: move.action,
        channel: move.channel,
        topic: move.topic,
        angle: move.angle,
        format: move.format,
        hook: move.hook,
        outline: move.outline,
        cta: move.cta,
        priority: move.priority,
        confidence: Number(move.confidence),
        validUntil: new Date(Date.now() + 2 * 86_400_000).toISOString(),
      },
      whyNow: move.whyNow,
      signalClass: move.signalClass,
      independentSourceCount: move.independentSourceCount,
      saturation: move.saturation,
      limitations: move.limitations,
      evidenceSignalIds: evidence
        .filter(
          (receipt) =>
            receipt.moveVersion === move.reviewVersion &&
            receipt.bindingRole === "DECISION_SUPPORT" &&
            receipt.availability === "AVAILABLE",
        )
        .map((receipt) => receipt.signalId),
      promptVersion: move.promptVersion,
      scoreVersion: move.scoreVersion,
      ...(move.confidenceRationale === null
        ? {}
        : { confidenceRationale: move.confidenceRationale }),
    });
    const contextVersionsBefore = await repositories.reviews.listContextVersions(project.id);

    const firstCorrectionClient = createDatabaseFromEnv();
    const secondCorrectionClient = createDatabaseFromEnv();
    const firstCorrectionRepositories = createRepositories(firstCorrectionClient.db);
    const secondCorrectionRepositories = createRepositories(secondCorrectionClient.db);
    const settled = await Promise.allSettled([
      firstCorrectionRepositories.reviews.recomputeFromStoredEvidence({
        nextMoveId: firstDraft.move.id,
        reviewerId: "integration-founder-first",
        expectedVersion: firstDraft.move.reviewVersion,
        reason: "Race the first bounded founder context correction against the second draft.",
        draft: buildDraft(firstDraft.move, firstDraft.evidence),
        contextCorrection: corrections[0],
      }),
      secondCorrectionRepositories.reviews.recomputeFromStoredEvidence({
        nextMoveId: secondDraft.move.id,
        reviewerId: "integration-founder-second",
        expectedVersion: secondDraft.move.reviewVersion,
        reason: "Race the second bounded founder context correction against the first draft.",
        draft: buildDraft(secondDraft.move, secondDraft.evidence),
        contextCorrection: corrections[1],
      }),
    ]);
    await Promise.all([firstCorrectionClient.close(), secondCorrectionClient.close()]);

    const winnerIndexes = settled.flatMap((result, index) =>
      result.status === "fulfilled" ? [index] : [],
    );
    expect(winnerIndexes).toHaveLength(1);
    const winnerIndex = winnerIndexes[0]!;
    const losingResult = settled[1 - winnerIndex];
    expect(losingResult?.status).toBe("rejected");
    if (losingResult?.status !== "rejected") {
      throw new Error("The losing correction unexpectedly succeeded");
    }
    expect(losingResult.reason).toBeInstanceOf(ReviewVersionConflictError);

    const contextVersionsAfter = await repositories.reviews.listContextVersions(project.id);
    expect(contextVersionsAfter).toHaveLength(contextVersionsBefore.length + 1);
    const currentContexts = contextVersionsAfter.filter((context) => context.isCurrent);
    expect(currentContexts).toHaveLength(1);
    expect(currentContexts[0]?.context).toEqual(corrections[winnerIndex]);

    const persistedDrafts = await Promise.all([
      repositories.scans.getStatusByPublicId(first.publicId),
      repositories.scans.getStatusByPublicId(second.publicId),
    ]);
    expect(persistedDrafts[winnerIndex]?.move).toMatchObject({
      reviewVersion:
        (winnerIndex === 0 ? firstDraft.move.reviewVersion : secondDraft.move.reviewVersion) + 2,
      projectContextVersionId: currentContexts[0]?.id,
      proposalStale: false,
    });
    expect(persistedDrafts[1 - winnerIndex]?.move).toMatchObject({
      reviewVersion:
        winnerIndex === 0 ? secondDraft.move.reviewVersion : firstDraft.move.reviewVersion,
      projectContextVersionId: sharedContextVersionId,
      proposalStale: false,
    });

    const losingDraft = persistedDrafts[1 - winnerIndex];
    if (!losingDraft?.move) throw new Error("The losing stale-context draft disappeared");
    const losingEvidence = losingDraft.evidence;
    const losingRecomputeDraft = buildDraft(losingDraft.move, losingEvidence);
    await expect(
      repositories.reviews.approve({
        nextMoveId: losingDraft.move.id,
        reviewerId: "stale-context-founder",
        expectedVersion: losingDraft.move.reviewVersion,
      }),
    ).rejects.toBeInstanceOf(ReviewVersionConflictError);
    await expect(
      repositories.reviews.editAndApprove({
        nextMoveId: losingDraft.move.id,
        reviewerId: "stale-context-founder",
        expectedVersion: losingDraft.move.reviewVersion,
        reason: "A stale project context must block edits even when the move version matches.",
        edits: {
          topic: `${losingDraft.move.topic} with a stale-context edit`,
          angle: losingDraft.move.angle,
          channel: losingDraft.move.channel,
          format: losingDraft.move.format,
          hook: losingDraft.move.hook,
          outline: losingDraft.move.outline,
          cta: losingDraft.move.cta,
          whyNow: losingDraft.move.whyNow,
          limitations: losingDraft.move.limitations,
          validUntil: new Date(Date.now() + 2 * 86_400_000),
          confidenceRationale:
            losingDraft.move.confidenceRationale ??
            "The current stored evidence remains bounded by the original deterministic score.",
        },
      }),
    ).rejects.toBeInstanceOf(ReviewVersionConflictError);
    await expect(
      repositories.reviews.recomputeFromStoredEvidence({
        nextMoveId: losingDraft.move.id,
        reviewerId: "stale-context-founder",
        expectedVersion: losingDraft.move.reviewVersion,
        reason: "A stale project context must block stored-evidence recomputation.",
        draft: losingRecomputeDraft,
      }),
    ).rejects.toBeInstanceOf(ReviewVersionConflictError);
    await expect(
      repositories.reviews.convertToWait({
        nextMoveId: losingDraft.move.id,
        reviewerId: "stale-context-founder",
        expectedVersion: losingDraft.move.reviewVersion,
        reason: "A stale project context must block conversion to a WAIT recommendation.",
        validUntil: new Date(Date.now() + 86_400_000),
      }),
    ).rejects.toBeInstanceOf(ReviewVersionConflictError);

    const winningDraft = persistedDrafts[winnerIndex];
    if (!winningDraft?.move) throw new Error("The winning corrected draft disappeared");
    await expect(
      repositories.reviews.approve({
        nextMoveId: winningDraft.move.id,
        reviewerId: "stale-tab-founder",
        expectedVersion:
          winnerIndex === 0 ? firstDraft.move.reviewVersion : secondDraft.move.reviewVersion,
      }),
    ).rejects.toBeInstanceOf(ReviewVersionConflictError);
  }, 15_000);
});
