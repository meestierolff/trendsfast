import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import {
  createDatabaseFromEnv,
  createRepositories,
  analyticsEvents,
  deliveryTokens,
  feedbackEvents,
  nextMoves,
  outcomes,
  projectContextVersions,
  projects,
  scanRequests,
  scanRuns,
} from "../src/index";
import { FIXTURE_PROJECT_CONTEXT } from "../src/seed";

const databaseDescribe = process.env.RUN_DATABASE_INTEGRATION === "1" ? describe : describe.skip;

databaseDescribe("private feedback deduplication", () => {
  const client = createDatabaseFromEnv();
  const repositories = createRepositories(client.db);
  const projectIds: string[] = [];
  const moveIds: string[] = [];

  afterAll(async () => {
    for (const moveId of moveIds) {
      await client.db.delete(analyticsEvents).where(eq(analyticsEvents.nextMoveId, moveId));
    }
    for (const projectId of projectIds) {
      await repositories.privacy.deleteProjectData({ projectId });
    }
    await client.close();
  });

  it("records one feedback choice and one USED outcome for concurrent delivery-token replays", async () => {
    const suffix = randomUUID();
    const completedAt = new Date();
    const [project] = await client.db
      .insert(projects)
      .values({
        publicId: `project_feedback_${suffix}`,
        url: `https://feedback-${suffix}.example`,
        normalizedUrl: `https://feedback-${suffix}.example/`,
      })
      .returning();
    if (!project) throw new Error("feedback project setup failed");
    projectIds.push(project.id);

    const [context] = await client.db
      .insert(projectContextVersions)
      .values({
        projectId: project.id,
        version: 1,
        isCurrent: true,
        inferredName: "Feedback integration",
        category: "test",
        audience: "founders",
        problem: "feedback replay",
        language: "en",
        credibleTopics: ["feedback"],
        assumptions: ["integration test"],
        context: {
          ...FIXTURE_PROJECT_CONTEXT,
          url: `https://feedback-${suffix}.example`,
        },
      })
      .returning();
    const [request] = await client.db
      .insert(scanRequests)
      .values({
        publicId: `scan_feedback_${suffix}`,
        projectId: project.id,
        origin: "OPS",
        state: "READY",
        submittedUrl: `https://feedback-${suffix}.example`,
        normalizedUrl: `https://feedback-${suffix}.example/`,
        completedAt,
      })
      .returning();
    if (!context || !request) throw new Error("feedback request setup failed");
    const [run] = await client.db
      .insert(scanRuns)
      .values({
        scanRequestId: request.id,
        projectContextVersionId: context.id,
        state: "READY",
        completedAt,
      })
      .returning();
    if (!run) throw new Error("feedback run setup failed");
    const [move] = await client.db
      .insert(nextMoves)
      .values({
        publicId: `move_feedback_${suffix}`,
        scanRequestId: request.id,
        scanRunId: run.id,
        projectContextVersionId: context.id,
        state: "READY",
        action: "WAIT",
        channel: "none",
        topic: "Hold",
        angle: "Evidence is not yet strong enough.",
        format: "none",
        hook: "Wait for stronger evidence.",
        outline: ["Observe"],
        cta: "Reassess tomorrow.",
        priority: 1,
        confidence: "0.50000",
        whyNow: "The decision is bounded.",
        signalClass: "INSUFFICIENT_SIGNAL",
        independentSourceCount: 0,
        saturation: "unknown",
        founderReviewed: true,
        autoPublish: false,
        promptVersion: "integration",
        scoreVersion: "integration",
        validUntil: new Date(Date.now() + 86_400_000),
        approvedAt: new Date(),
        deliveredAt: new Date(),
      })
      .returning();
    if (!move) throw new Error("feedback move setup failed");
    moveIds.push(move.id);
    const [token] = await client.db
      .insert(deliveryTokens)
      .values({
        nextMoveId: move.id,
        tokenPrefix: `feedback_${suffix}`.slice(0, 32),
        tokenHash: `feedback-hash-${suffix}`,
        status: "ACTIVE",
        expiresAt: new Date(Date.now() + 86_400_000),
        deliveredAt: new Date(),
      })
      .returning();
    if (!token) throw new Error("feedback token setup failed");

    const attempts = await Promise.all(
      Array.from({ length: 8 }, () =>
        repositories.feedback.record({
          nextMoveId: move.id,
          deliveryTokenId: token.id,
          kind: "USED_OR_PUBLISHED",
        }),
      ),
    );
    expect(attempts.filter((attempt) => attempt.created)).toHaveLength(1);
    expect(new Set(attempts.map((attempt) => attempt.event.id))).toEqual(
      new Set([attempts[0]?.event.id]),
    );

    const replayWithDifferentChoice = await repositories.feedback.record({
      nextMoveId: move.id,
      deliveryTokenId: token.id,
      kind: "NOT_RELEVANT",
    });
    expect(replayWithDifferentChoice).toMatchObject({
      created: false,
      event: { kind: "USED_OR_PUBLISHED" },
    });
    expect(
      await client.db
        .select()
        .from(feedbackEvents)
        .where(eq(feedbackEvents.deliveryTokenId, token.id)),
    ).toHaveLength(1);
    expect(
      await client.db.select().from(outcomes).where(eq(outcomes.nextMoveId, move.id)),
    ).toHaveLength(1);
    const durableAnalytics = await client.db
      .select()
      .from(analyticsEvents)
      .where(eq(analyticsEvents.nextMoveId, move.id));
    expect(durableAnalytics.map((event) => event.name).sort()).toEqual([
      "feedback_submitted",
      "move_used",
    ]);
    expect(durableAnalytics.every((event) => event.properties?.kind === "USED_OR_PUBLISHED")).toBe(
      true,
    );
  });
});
