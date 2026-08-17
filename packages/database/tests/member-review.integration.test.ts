import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import {
  createDatabaseFromEnv,
  createRepositories,
  deliveryTokens,
  evidenceReceipts,
  nextMoves,
  outcomes,
  projectContextVersions,
  reviewEvents,
  scanRequests,
  scanRuns,
} from "../src/index";

const databaseDescribe = process.env.RUN_DATABASE_INTEGRATION === "1" ? describe : describe.skip;

function waitContract(validUntil: Date) {
  const boundary = validUntil.toISOString();
  return {
    decisionContractVersion: "next-move-v1",
    actionDetails: {
      action: "WAIT",
      considered_opportunity: "A bounded member-review fixture",
      failure_reasons: ["WEAK_EVIDENCE"],
      do_not_act_on: ["Do not publish from this fixture."],
      watch_conditions: ["Wait for stronger independent evidence."],
      recheck_at: boundary,
    },
    trendWindow: {
      state: "UNKNOWN",
      basis: "UNKNOWN",
      last_confirmed_at: boundary,
      valid_until: boundary,
      recheck_at: boundary,
      confidence: 0.2,
      explanation: "The fixture intentionally makes no measured timing claim.",
    },
    breakoutPotential: {
      level: "unknown",
      basis: "INSUFFICIENT_DATA",
      factors: {
        audience_relevance: 0,
        timing: 0,
        novelty: 0,
        product_credibility: 0,
        format_fit: 0,
        saturation_risk: 0,
      },
      explanation: "The fixture intentionally makes no breakout claim.",
    },
  } as const;
}

databaseDescribe("authenticated project-owner review boundary", () => {
  const client = createDatabaseFromEnv();
  const repositories = createRepositories(client.db);
  const cleanupUrls: string[] = [];

  afterAll(async () => {
    for (const normalizedUrl of cleanupUrls) {
      await repositories.privacy.deleteProjectData({ normalizedUrl });
    }
    await client.close();
  });

  async function reviewFixture() {
    const authUserId = randomUUID();
    const url = `https://member-review-${randomUUID()}.example`;
    cleanupUrls.push(`${url}/`);
    const owned = await repositories.members.createOrReuseOwnedProject({
      identity: {
        authUserId,
        email: `review-${randomUUID()}@example.com`,
        projectEntryEligible: true,
      },
      url,
    });
    const context = await repositories.scanData.addProjectContext({
      projectId: owned.project.id,
      context: {
        name: "Member review fixture",
        url: `${url}/`,
        category: "software product",
        audience: "Founder operators",
        problem: "A proposal needs a safe owner review boundary",
        desiredOutcome: "Review one exact proposal",
        credibleClaims: [],
        alternatives: [],
        competitors: [],
        markets: [],
        language: "en",
        suitableChannels: ["x"],
        availableFormats: ["founder_text"],
        credibleTopics: ["distribution"],
        assumptions: ["This is an integration fixture"],
      },
      createdBy: `member:${authUserId}`,
    });
    const [request] = await client.db
      .insert(scanRequests)
      .values({
        publicId: `scan_${randomUUID()}`,
        projectId: owned.project.id,
        origin: "FIXTURE",
        state: "REVIEW_REQUIRED",
        submittedUrl: url,
        normalizedUrl: `${url}/`,
      })
      .returning();
    if (!request) throw new Error("Could not create member review request");
    const [run] = await client.db
      .insert(scanRuns)
      .values({
        scanRequestId: request.id,
        projectContextVersionId: context.id,
        attempt: 1,
        state: "REVIEW_REQUIRED",
      })
      .returning();
    if (!run) throw new Error("Could not create member review run");
    const validUntil = new Date(Date.now() + 60 * 60_000);
    const [move] = await client.db
      .insert(nextMoves)
      .values({
        publicId: `move_${randomUUID()}`,
        scanRequestId: request.id,
        scanRunId: run.id,
        projectContextVersionId: context.id,
        state: "DRAFT",
        action: "WAIT",
        channel: "none",
        topic: "Wait for stronger evidence",
        angle: "Do not force a distribution move.",
        format: "none",
        hook: "Wait",
        outline: ["Wait"],
        cta: "Recheck",
        priority: 0,
        confidence: "0.2",
        whyNow: "The quality floor did not support action.",
        signalClass: "INSUFFICIENT_SIGNAL",
        independentSourceCount: 0,
        saturation: "unknown",
        promptVersion: "member-review-test",
        scoreVersion: "member-review-test",
        validUntil,
        ...waitContract(validUntil),
      })
      .returning();
    if (!move) throw new Error("Could not create member review move");
    const sourceRun = await repositories.scanData.createSourceRun({
      scanRunId: run.id,
      source: "website",
      provider: "member-review-fixture",
      maxCalls: 1,
    });
    const observedAt = new Date().toISOString();
    const signal = await repositories.scanData.upsertSignal(sourceRun.id, {
      id: `signal_${randomUUID()}`,
      source: "website",
      sourceId: `website_${randomUUID()}`,
      url: `${url}/evidence`,
      title: "Bounded website evidence",
      observedAt,
      metrics: {},
      queryId: `query_${randomUUID()}`,
      provenance: {
        provider: "member-review-fixture",
        retrievedAt: observedAt,
        cached: true,
      },
    });
    const [receipt] = await client.db
      .insert(evidenceReceipts)
      .values({
        nextMoveId: move.id,
        signalId: signal.id,
        moveVersion: 1,
        source: "website",
        provider: "member-review-fixture",
        canonicalUrl: `${url}/evidence`,
        title: "Bounded website evidence",
        observedAt: new Date(observedAt),
        reason: "This receipt documents the exact weak evidence considered by WAIT.",
        bindingRole: "DECISION_SUPPORT",
      })
      .returning();
    if (!receipt) throw new Error("Could not create member review receipt");
    return { authUserId, project: owned.project, request, run, move, receipt };
  }

  it("fences IDOR, version, exact evidence, unavailable evidence, and concurrent SKIP", async () => {
    const fixture = await reviewFixture();
    const input = {
      authUserId: fixture.authUserId,
      projectId: fixture.project.id,
      nextMoveId: fixture.move.id,
      expectedVersion: 1,
      evidenceReceiptIds: [fixture.receipt.id],
    };

    await client.db.update(scanRuns).set({ state: "READY" }).where(eq(scanRuns.id, fixture.run.id));
    await expect(
      repositories.members.getProjectDashboard({
        authUserId: fixture.authUserId,
        projectId: fixture.project.id,
      }),
    ).resolves.toMatchObject({ latest: null });
    await client.db
      .update(scanRuns)
      .set({ state: "REVIEW_REQUIRED" })
      .where(eq(scanRuns.id, fixture.run.id));
    await expect(
      repositories.members.getProjectDashboard({
        authUserId: fixture.authUserId,
        projectId: fixture.project.id,
      }),
    ).resolves.toMatchObject({
      latest: { move: { id: fixture.move.id, state: "DRAFT" } },
    });

    await client.db
      .update(nextMoves)
      .set({ proposalStale: true })
      .where(eq(nextMoves.id, fixture.move.id));
    await expect(
      repositories.members.getProjectDashboard({
        authUserId: fixture.authUserId,
        projectId: fixture.project.id,
      }),
    ).resolves.toMatchObject({ latest: null });
    await client.db
      .update(nextMoves)
      .set({ proposalStale: false })
      .where(eq(nextMoves.id, fixture.move.id));

    await client.db
      .update(projectContextVersions)
      .set({ isCurrent: false })
      .where(eq(projectContextVersions.id, fixture.move.projectContextVersionId));
    await expect(
      repositories.members.getProjectDashboard({
        authUserId: fixture.authUserId,
        projectId: fixture.project.id,
      }),
    ).resolves.toMatchObject({ latest: null });
    await client.db
      .update(projectContextVersions)
      .set({ isCurrent: true })
      .where(eq(projectContextVersions.id, fixture.move.projectContextVersionId));

    await expect(
      repositories.memberReviews.attestCurrentEvidence({
        ...input,
        authUserId: randomUUID(),
      }),
    ).rejects.toMatchObject({ name: "MemberReviewAuthorizationError" });
    await expect(
      repositories.memberReviews.attestCurrentEvidence({ ...input, expectedVersion: 2 }),
    ).rejects.toMatchObject({ name: "MemberReviewConflictError" });
    await expect(
      repositories.memberReviews.attestCurrentEvidence({ ...input, evidenceReceiptIds: [] }),
    ).rejects.toMatchObject({ name: "MemberReviewEvidenceError" });

    await client.db
      .update(evidenceReceipts)
      .set({ availability: "REJECTED" })
      .where(eq(evidenceReceipts.id, fixture.receipt.id));
    await expect(repositories.memberReviews.attestCurrentEvidence(input)).rejects.toMatchObject({
      name: "MemberReviewEvidenceError",
    });
    await client.db
      .update(evidenceReceipts)
      .set({ availability: "AVAILABLE" })
      .where(eq(evidenceReceipts.id, fixture.receipt.id));

    const prepared = await repositories.memberReviews.attestCurrentEvidence(input);
    expect(prepared).toMatchObject({ phase: "DRAFT", reviewVersion: 1 });
    expect(
      await client.db
        .select({ verified: evidenceReceipts.verified, reviewedBy: evidenceReceipts.reviewedBy })
        .from(evidenceReceipts)
        .where(eq(evidenceReceipts.id, fixture.receipt.id)),
    ).toEqual([{ verified: true, reviewedBy: prepared.reviewerId }]);

    await expect(
      repositories.reviews.approve({
        nextMoveId: fixture.move.id,
        expectedVersion: 1,
        reviewerId: prepared.reviewerId,
        ownerAuthorization: {
          authUserId: randomUUID(),
          projectId: fixture.project.id,
        },
      }),
    ).rejects.toThrow("Project owner authorization is required");
    await repositories.reviews.approve({
      nextMoveId: fixture.move.id,
      expectedVersion: 1,
      reviewerId: prepared.reviewerId,
      ownerAuthorization: {
        authUserId: fixture.authUserId,
        projectId: fixture.project.id,
      },
    });
    await expect(repositories.memberReviews.skipCurrentProposalOnce(input)).rejects.toMatchObject({
      name: "MemberReviewConflictError",
    });
    await expect(
      repositories.delivery.deliver({
        nextMoveId: fixture.move.id,
        reviewerId: prepared.reviewerId,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60_000),
        ownerAuthorization: {
          authUserId: randomUUID(),
          projectId: fixture.project.id,
        },
      }),
    ).rejects.toThrow("Project owner authorization is required");
    const delivery = await repositories.delivery.deliver({
      nextMoveId: fixture.move.id,
      reviewerId: prepared.reviewerId,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60_000),
      ownerAuthorization: {
        authUserId: fixture.authUserId,
        projectId: fixture.project.id,
      },
    });
    expect(delivery.created).toBe(true);
    await expect(
      repositories.members.recordProjectOutcome({
        authUserId: fixture.authUserId,
        projectId: fixture.project.id,
        nextMoveId: fixture.move.id,
        kind: "SKIPPED" as never,
      }),
    ).rejects.toThrow(/outcome kind/i);

    await expect(
      repositories.memberReviews.skipCurrentProposalOnce({
        ...input,
      }),
    ).rejects.toMatchObject({ name: "MemberReviewConflictError" });

    const skippedFixture = await reviewFixture();
    const skippedInput = {
      authUserId: skippedFixture.authUserId,
      projectId: skippedFixture.project.id,
      nextMoveId: skippedFixture.move.id,
      expectedVersion: 1,
      evidenceReceiptIds: [skippedFixture.receipt.id],
    };
    const skips = await Promise.all([
      repositories.memberReviews.skipCurrentProposalOnce(skippedInput),
      repositories.memberReviews.skipCurrentProposalOnce(skippedInput),
    ]);
    expect(skips.map((result) => result.created).sort()).toEqual([false, true]);
    expect(
      await client.db
        .select({ id: outcomes.id })
        .from(outcomes)
        .where(eq(outcomes.nextMoveId, skippedFixture.move.id)),
    ).toHaveLength(1);
    expect(
      await client.db
        .select({ state: nextMoves.state, founderReviewed: nextMoves.founderReviewed })
        .from(nextMoves)
        .where(eq(nextMoves.id, skippedFixture.move.id)),
    ).toEqual([{ state: "REJECTED", founderReviewed: true }]);
    expect(
      await client.db
        .select({ state: scanRequests.state, failureCode: scanRequests.failureCode })
        .from(scanRequests)
        .where(eq(scanRequests.id, skippedFixture.request.id)),
    ).toEqual([{ state: "FAILED", failureCode: "FOUNDER_SKIPPED" }]);
    expect(
      await client.db
        .select({ state: scanRuns.state, failureCode: scanRuns.failureCode })
        .from(scanRuns)
        .where(eq(scanRuns.id, skippedFixture.run.id)),
    ).toEqual([{ state: "FAILED", failureCode: "FOUNDER_SKIPPED" }]);
    expect(
      await client.db
        .select({ id: deliveryTokens.id })
        .from(deliveryTokens)
        .where(eq(deliveryTokens.nextMoveId, skippedFixture.move.id)),
    ).toEqual([]);
    expect(
      await client.db
        .select({ action: reviewEvents.action, reviewerId: reviewEvents.reviewerId })
        .from(reviewEvents)
        .where(eq(reviewEvents.nextMoveId, skippedFixture.move.id)),
    ).toEqual(
      expect.arrayContaining([
        {
          action: "MARKED_FAILED",
          reviewerId: expect.stringMatching(/^member:/),
        },
      ]),
    );
    await expect(
      repositories.memberReviews.attestCurrentEvidence(skippedInput),
    ).rejects.toMatchObject({ name: "MemberReviewConflictError" });
  });

  it("rejects an expired proposal at attestation, approval, and delivery", async () => {
    const expired = await reviewFixture();
    const expiredAt = new Date(Date.now() - 60_000);
    await client.db
      .update(nextMoves)
      .set({ validUntil: expiredAt, trendWindow: waitContract(expiredAt).trendWindow })
      .where(eq(nextMoves.id, expired.move.id));
    const input = {
      authUserId: expired.authUserId,
      projectId: expired.project.id,
      nextMoveId: expired.move.id,
      expectedVersion: 1,
      evidenceReceiptIds: [expired.receipt.id],
    };

    await expect(repositories.memberReviews.attestCurrentEvidence(input)).rejects.toMatchObject({
      name: "MemberReviewConflictError",
    });
    await expect(
      repositories.reviews.approve({
        nextMoveId: expired.move.id,
        expectedVersion: 1,
        reviewerId: `member:${expired.authUserId}`,
        ownerAuthorization: {
          authUserId: expired.authUserId,
          projectId: expired.project.id,
        },
      }),
    ).rejects.toThrow(/expired before approval/i);

    const approved = await reviewFixture();
    const approvedExpiredAt = new Date(Date.now() - 60_000);
    await client.db
      .update(nextMoves)
      .set({
        state: "APPROVED",
        founderReviewed: true,
        approvedAt: new Date(),
        validUntil: approvedExpiredAt,
        trendWindow: waitContract(approvedExpiredAt).trendWindow,
      })
      .where(eq(nextMoves.id, approved.move.id));
    await expect(
      repositories.delivery.deliver({
        nextMoveId: approved.move.id,
        reviewerId: `member:${approved.authUserId}`,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60_000),
        ownerAuthorization: {
          authUserId: approved.authUserId,
          projectId: approved.project.id,
        },
      }),
    ).rejects.toThrow(/stale/i);
  });
});
