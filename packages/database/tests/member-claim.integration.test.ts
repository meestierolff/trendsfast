import { createHash, randomBytes, randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import {
  createDatabaseFromEnv,
  createRepositories,
  deliveryTokens,
  nextMoves,
  projectClaims,
  projectContextVersions,
  projectMemberships,
  scanRequests,
  scanRuns,
  userProfiles,
} from "../src/index";

const databaseDescribe = process.env.RUN_DATABASE_INTEGRATION === "1" ? describe : describe.skip;

function claimHash(): string {
  return `sha256:${createHash("sha256").update(randomBytes(32)).digest("hex")}`;
}

function waitDecisionContract(validUntil: Date) {
  const boundary = validUntil.toISOString();
  return {
    decisionContractVersion: "next-move-v1",
    actionDetails: {
      action: "WAIT",
      considered_opportunity: "A current distribution opportunity",
      failure_reasons: ["WEAK_EVIDENCE"],
      do_not_act_on: ["Do not publish before the evidence improves."],
      watch_conditions: ["Recheck after another independent signal appears."],
      recheck_at: boundary,
    },
    trendWindow: {
      state: "UNKNOWN",
      basis: "UNKNOWN",
      last_confirmed_at: boundary,
      valid_until: boundary,
      recheck_at: boundary,
      confidence: 0.2,
      explanation: "The fixture intentionally has insufficient timing evidence.",
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
      explanation: "The fixture does not claim measured breakout potential.",
    },
  } as const;
}

databaseDescribe("verified member project claims", () => {
  const client = createDatabaseFromEnv();
  const repositories = createRepositories(client.db);
  const urls: string[] = [];

  afterAll(async () => {
    for (const normalizedUrl of urls) {
      await repositories.privacy.deleteProjectData({ normalizedUrl });
    }
    await client.close();
  });

  async function readyDelivery(label: string) {
    const url = `https://${label}-${randomUUID()}.example`;
    urls.push(`${url}/`);
    const project = await repositories.scanData.upsertProject({ url });
    const requestId = randomUUID();
    const runId = randomUUID();
    const context = await repositories.scanData.addProjectContext({
      projectId: project.id,
      context: {
        name: "Member claim fixture",
        url,
        category: "software product",
        audience: "Founder operators",
        problem: "Choosing a current distribution action",
        desiredOutcome: "Act on one reviewed move",
        credibleClaims: [],
        alternatives: [],
        competitors: [],
        markets: [],
        language: "en",
        suitableChannels: ["x"],
        availableFormats: ["founder_text"],
        credibleTopics: ["distribution"],
        assumptions: ["Fixture-only context"],
      },
      createdBy: "test:member-claim",
    });
    const moveId = randomUUID();
    const validUntil = new Date(Date.now() + 60_000);
    await client.db.insert(scanRequests).values({
      id: requestId,
      publicId: `scan_${randomUUID()}`,
      projectId: project.id,
      origin: "FIXTURE",
      state: "READY",
      submittedUrl: url,
      normalizedUrl: `${url}/`,
      completedAt: new Date(),
    });
    await client.db.insert(scanRuns).values({
      id: runId,
      scanRequestId: requestId,
      attempt: 1,
      state: "READY",
      completedAt: new Date(),
    });
    await client.db.insert(nextMoves).values({
      id: moveId,
      publicId: `move_${randomUUID()}`,
      scanRequestId: requestId,
      scanRunId: runId,
      projectContextVersionId: context.id,
      state: "READY",
      action: "WAIT",
      channel: "none",
      topic: "No current evidence",
      angle: "Wait for measured evidence.",
      format: "none",
      hook: "Wait",
      outline: ["Wait"],
      cta: "Recheck",
      priority: 0,
      confidence: "0.8",
      whyNow: "Current coverage is insufficient.",
      signalClass: "INSUFFICIENT_SIGNAL",
      independentSourceCount: 0,
      saturation: "unknown",
      reviewVersion: 1,
      proposalStale: false,
      founderReviewed: true,
      autoPublish: false,
      promptVersion: "test",
      scoreVersion: "test",
      validUntil,
      ...waitDecisionContract(validUntil),
      approvedAt: new Date(),
      deliveredAt: new Date(),
    });
    const [delivery] = await client.db
      .insert(deliveryTokens)
      .values({
        nextMoveId: moveId,
        tokenPrefix: randomUUID().slice(0, 20),
        tokenHash: `sha256:${createHash("sha256").update(randomBytes(32)).digest("hex")}`,
        status: "DELIVERED",
        expiresAt: new Date(Date.now() + 60 * 60_000),
        deliveredAt: new Date(),
      })
      .returning();
    if (!delivery) throw new Error("delivery fixture failed");
    return { project, context, delivery, moveId };
  }

  async function claimProject(
    fixture: Awaited<ReturnType<typeof readyDelivery>>,
    identity: { authUserId: string; email: string },
  ) {
    const hash = claimHash();
    await repositories.members.createClaimForDelivery({
      deliveryTokenId: fixture.delivery.id,
      projectId: fixture.project.id,
      claimHash: hash,
      expiresAt: new Date(Date.now() + 10 * 60_000),
    });
    await expect(
      repositories.members.consumeProjectClaim({ claimHash: hash, identity }),
    ).resolves.toMatchObject({ status: "CLAIMED", projectId: fixture.project.id });
  }

  it("consumes one hash exactly once and reports an ownership conflict without transfer", async () => {
    const { project, delivery } = await readyDelivery("member-claim");
    const now = new Date();
    const firstHash = claimHash();
    await repositories.members.createClaimForDelivery({
      deliveryTokenId: delivery.id,
      projectId: project.id,
      claimHash: firstHash,
      expiresAt: new Date(now.getTime() + 10 * 60_000),
      now,
    });
    const firstIdentity = {
      authUserId: randomUUID(),
      email: `owner-${randomUUID()}@example.com`,
    };
    await expect(
      repositories.members.consumeProjectClaim({ claimHash: firstHash, identity: firstIdentity }),
    ).resolves.toMatchObject({ status: "CLAIMED", projectId: project.id });
    await expect(
      repositories.members.consumeProjectClaim({ claimHash: firstHash, identity: firstIdentity }),
    ).resolves.toEqual({ status: "REPLAYED" });

    const conflictHash = claimHash();
    await repositories.members.createClaimForDelivery({
      deliveryTokenId: delivery.id,
      projectId: project.id,
      claimHash: conflictHash,
      expiresAt: new Date(Date.now() + 10 * 60_000),
    });
    await expect(
      repositories.members.consumeProjectClaim({
        claimHash: conflictHash,
        identity: {
          authUserId: randomUUID(),
          email: `other-${randomUUID()}@example.com`,
        },
      }),
    ).resolves.toMatchObject({ status: "OWNERSHIP_CONFLICT" });

    const owners = await client.db
      .select({ authUserId: userProfiles.authUserId })
      .from(projectMemberships)
      .innerJoin(userProfiles, eq(userProfiles.id, projectMemberships.userProfileId))
      .where(
        and(eq(projectMemberships.projectId, project.id), eq(projectMemberships.role, "OWNER")),
      );
    expect(owners).toEqual([{ authUserId: firstIdentity.authUserId }]);
  });

  it("invalidates an open predecessor and fails closed at the expiry boundary", async () => {
    const { project, delivery } = await readyDelivery("member-expiry");
    const first = claimHash();
    await repositories.members.createClaimForDelivery({
      deliveryTokenId: delivery.id,
      projectId: project.id,
      claimHash: first,
      expiresAt: new Date(Date.now() + 10 * 60_000),
    });
    const second = claimHash();
    const expiresAt = new Date(Date.now() + 5 * 60_000);
    await repositories.members.createClaimForDelivery({
      deliveryTokenId: delivery.id,
      projectId: project.id,
      claimHash: second,
      expiresAt,
    });
    await expect(
      repositories.members.consumeProjectClaim({
        claimHash: first,
        identity: { authUserId: randomUUID(), email: `old-${randomUUID()}@example.com` },
      }),
    ).resolves.toEqual({ status: "INVALIDATED" });
    await expect(
      repositories.members.consumeProjectClaim({
        claimHash: second,
        identity: { authUserId: randomUUID(), email: `expired-${randomUUID()}@example.com` },
        now: expiresAt,
      }),
    ).resolves.toEqual({ status: "EXPIRED" });
    expect(
      await client.db
        .select({ id: projectClaims.id })
        .from(projectClaims)
        .where(eq(projectClaims.projectId, project.id)),
    ).toHaveLength(2);
  });

  it("rejects stale creation and invalidates a claim when delivery truth changes before consume", async () => {
    const stale = await readyDelivery("member-claim-stale-create");
    await client.db
      .update(nextMoves)
      .set({ proposalStale: true })
      .where(eq(nextMoves.id, stale.moveId));
    await expect(
      repositories.members.createClaimForDelivery({
        deliveryTokenId: stale.delivery.id,
        projectId: stale.project.id,
        claimHash: claimHash(),
        expiresAt: new Date(Date.now() + 5 * 60_000),
      }),
    ).rejects.toThrow("Project claim delivery is unavailable");

    const revoked = await readyDelivery("member-claim-revoked");
    const revokedClaim = claimHash();
    await repositories.members.createClaimForDelivery({
      deliveryTokenId: revoked.delivery.id,
      projectId: revoked.project.id,
      claimHash: revokedClaim,
      expiresAt: new Date(Date.now() + 5 * 60_000),
    });
    await repositories.delivery.revoke(revoked.delivery.id);
    await expect(
      repositories.members.consumeProjectClaim({
        claimHash: revokedClaim,
        identity: { authUserId: randomUUID(), email: `revoked-${randomUUID()}@example.com` },
      }),
    ).resolves.toEqual({ status: "INVALIDATED" });

    const superseded = await readyDelivery("member-claim-superseded");
    const supersededClaim = claimHash();
    await repositories.members.createClaimForDelivery({
      deliveryTokenId: superseded.delivery.id,
      projectId: superseded.project.id,
      claimHash: supersededClaim,
      expiresAt: new Date(Date.now() + 5 * 60_000),
    });
    await client.db
      .update(projectContextVersions)
      .set({ isCurrent: false })
      .where(eq(projectContextVersions.id, superseded.context.id));
    await expect(
      repositories.members.consumeProjectClaim({
        claimHash: supersededClaim,
        identity: { authUserId: randomUUID(), email: `stale-${randomUUID()}@example.com` },
      }),
    ).resolves.toEqual({ status: "INVALIDATED" });

    const expiredDelivery = await readyDelivery("member-claim-delivery-expired");
    const expiredClaim = claimHash();
    const beforeExpiry = new Date();
    await repositories.members.createClaimForDelivery({
      deliveryTokenId: expiredDelivery.delivery.id,
      projectId: expiredDelivery.project.id,
      claimHash: expiredClaim,
      expiresAt: new Date(beforeExpiry.getTime() + 5 * 60_000),
      now: beforeExpiry,
    });
    const deliveryExpiry = new Date(beforeExpiry.getTime() + 1_000);
    await client.db
      .update(deliveryTokens)
      .set({ expiresAt: deliveryExpiry })
      .where(eq(deliveryTokens.id, expiredDelivery.delivery.id));
    await expect(
      repositories.members.consumeProjectClaim({
        claimHash: expiredClaim,
        identity: { authUserId: randomUUID(), email: `expired-${randomUUID()}@example.com` },
        now: deliveryExpiry,
      }),
    ).resolves.toEqual({ status: "INVALIDATED" });
  });

  it("isolates every member dashboard read and mutation by verified project ownership", async () => {
    const projectA = await readyDelivery("member-isolation-a");
    const projectB = await readyDelivery("member-isolation-b");
    const ownerA = {
      authUserId: randomUUID(),
      email: `isolation-a-${randomUUID()}@example.com`,
    };
    const ownerB = {
      authUserId: randomUUID(),
      email: `isolation-b-${randomUUID()}@example.com`,
    };
    await claimProject(projectA, ownerA);
    await claimProject(projectB, ownerB);

    await expect(
      repositories.members.getProjectDashboard({
        authUserId: ownerA.authUserId,
        projectId: projectB.project.id,
      }),
    ).rejects.toThrow("Project owner authorization is required");
    await expect(
      repositories.members.listProjectHistory({
        authUserId: ownerA.authUserId,
        projectId: projectB.project.id,
      }),
    ).rejects.toThrow("Project owner authorization is required");
    await expect(
      repositories.members.updateProjectContext({
        authUserId: ownerA.authUserId,
        projectId: projectB.project.id,
        context: {
          name: "Isolation B",
          url: projectB.project.url,
          category: "software product",
          audience: "Founder operators",
          problem: "Project isolation",
          desiredOutcome: "Keep owner data isolated",
          credibleClaims: [],
          alternatives: [],
          competitors: [],
          markets: [],
          language: "en",
          suitableChannels: ["x"],
          availableFormats: ["founder_text"],
          credibleTopics: ["security"],
          assumptions: ["The caller is verified"],
        },
        entityType: "PRODUCT",
        contextProvenance: {
          observed_facts: [],
          inferred_context: [],
          assumptions: ["The caller is verified"],
        },
        voiceProfile: {
          traits: [],
          preferred_phrases: [],
          avoid_phrases: [],
          sample_texts: [],
          sample_urls: [],
        },
        contentCapabilities: {
          founder_text: true,
          founder_on_camera: false,
          screen_recording: false,
          ai_avatar: false,
          carousel: false,
          product_demo: false,
          long_form: false,
        },
      }),
    ).rejects.toThrow("Project owner authorization is required");
    await expect(
      repositories.members.updateProjectUrl({
        authUserId: ownerA.authUserId,
        projectId: projectB.project.id,
        url: `https://forbidden-${randomUUID()}.example`,
      }),
    ).rejects.toThrow("Project owner authorization is required");
    await expect(
      repositories.members.recordProjectOutcome({
        authUserId: ownerA.authUserId,
        projectId: projectB.project.id,
        nextMoveId: projectB.moveId,
        kind: "USED",
      }),
    ).rejects.toThrow("Project owner authorization is required");
    await expect(
      repositories.members.listProjectApiKeys({
        authUserId: ownerA.authUserId,
        projectId: projectB.project.id,
      }),
    ).rejects.toThrow("Project owner authorization is required");

    await expect(
      repositories.members.getProjectDashboard({
        authUserId: ownerB.authUserId,
        projectId: projectB.project.id,
      }),
    ).resolves.toMatchObject({ project: { id: projectB.project.id } });
  });

  it("re-infers a claimed project after a URL change clears its saved context", async () => {
    const fixture = await readyDelivery("member-reinfer");
    const owner = {
      authUserId: randomUUID(),
      email: `reinfer-${randomUUID()}@example.com`,
    };
    await claimProject(fixture, owner);
    const now = new Date();
    await repositories.founderGrants.issueDesignPartnerGrant({
      projectId: fixture.project.id,
      issuedBy: "test:member-reinfer",
      expiresAt: new Date(now.getTime() + 24 * 60 * 60_000),
      now,
    });
    const nextUrl = `https://member-reinfer-next-${randomUUID()}.example`;
    urls.push(`${nextUrl}/`);
    await repositories.members.updateProjectUrl({
      authUserId: owner.authUserId,
      projectId: fixture.project.id,
      url: nextUrl,
      now,
    });
    const currentBefore = await client.db
      .select({ id: projectContextVersions.id })
      .from(projectContextVersions)
      .where(
        and(
          eq(projectContextVersions.projectId, fixture.project.id),
          eq(projectContextVersions.isCurrent, true),
        ),
      );
    expect(currentBefore).toEqual([]);

    const result = await repositories.members.requestProjectRefresh({
      authUserId: owner.authUserId,
      projectId: fixture.project.id,
      idempotencyKey: randomUUID(),
      generationLevel: "brief",
      costReservationUsd: 0,
      now: new Date(now.getTime() + 1_000),
    });
    expect(result).toMatchObject({ status: "CREATED" });
    if (result.status !== "CREATED") throw new Error("member refresh was not created");
    const [request] = await client.db
      .select()
      .from(scanRequests)
      .where(eq(scanRequests.publicId, result.publicId));
    if (!request) throw new Error("member refresh request was not stored");
    const [run] = await client.db
      .select()
      .from(scanRuns)
      .where(eq(scanRuns.scanRequestId, request.id));
    expect(request).toMatchObject({
      submittedUrl: `${nextUrl}/`,
      normalizedUrl: `${nextUrl}/`,
      requestedContentCapabilities: null,
    });
    expect(run?.projectContextVersionId).toBeNull();
  });
});
