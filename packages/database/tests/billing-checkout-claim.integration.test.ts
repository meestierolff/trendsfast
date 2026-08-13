import { createHash, randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import {
  apiKeyManagementEvents,
  apiKeys,
  BillingCheckoutConflictError,
  billingCheckoutSessions,
  createDatabaseFromEnv,
  createRepositories,
} from "../src/index";

const databaseDescribe = process.env.RUN_DATABASE_INTEGRATION === "1" ? describe : describe.skip;
const payloadHash = `sha256:${"c".repeat(64)}`;
const configuredProviderCostLimitUsd = 7.25;

databaseDescribe("delivered-result Checkout claim", () => {
  const client = createDatabaseFromEnv();
  const repositories = createRepositories(client.db, {
    apiKeyPepper: "checkout-claim-integration-pepper-at-least-32",
  });
  const projectUrl = `https://checkout-claim-${randomUUID()}.example`;
  const recoveryProjectUrl = `https://checkout-claim-recovery-${randomUUID()}.example`;
  const suffix = randomUUID();

  afterAll(async () => {
    await repositories.privacy.deleteProjectData({ normalizedUrl: `${projectUrl}/` });
    await repositories.privacy.deleteProjectData({ normalizedUrl: `${recoveryProjectUrl}/` });
    await client.close();
  });

  it("rotates a lost delivery claim once under concurrency without changing its Checkout", async () => {
    const now = new Date();
    const project = await repositories.scanData.upsertProject({ url: recoveryProjectUrl });
    const deliveryTokenId = randomUUID();
    const initiatedBy = `delivery:${deliveryTokenId}`;
    const hash = (label: string) =>
      `sha256:${createHash("sha256").update(`${label}:${randomUUID()}`).digest("hex")}`;
    const originalClaimHash = hash("original");
    const checkoutClaimExpiresAt = new Date(now.getTime() + 90 * 60_000);
    const checkoutSessionId = `cs_test_claim_recovery_${suffix}`;
    const { reservation } = await repositories.billing.reserveProjectCheckout({
      projectId: project.id,
      initiatedBy,
      now,
      expiresAt: new Date(now.getTime() + 60 * 60_000),
      checkoutClaimHash: originalClaimHash,
      checkoutClaimExpiresAt,
    });
    await repositories.billing.bindProjectCheckout({
      reservationId: reservation.id,
      stripeCheckoutSessionId: checkoutSessionId,
      livemode: false,
      occurredAt: new Date(now.getTime() + 1_000),
    });

    await expect(
      repositories.billing.reserveProjectCheckout({
        projectId: project.id,
        initiatedBy,
        now: new Date(now.getTime() + 2_000),
        expiresAt: new Date(now.getTime() + 62 * 60_000),
        checkoutClaimHash: hash("lost-response-retry"),
        checkoutClaimExpiresAt: new Date(now.getTime() + 92 * 60_000),
      }),
    ).rejects.toMatchObject({ code: "CHECKOUT_ALREADY_OPEN" });
    await expect(
      repositories.billing.checkoutForDeliveryClaimRecovery({
        projectId: project.id,
        initiatedBy: `delivery:${randomUUID()}`,
      }),
    ).resolves.toBeNull();
    const recoverable = await repositories.billing.checkoutForDeliveryClaimRecovery({
      projectId: project.id,
      initiatedBy,
    });
    expect(recoverable).toMatchObject({
      id: reservation.id,
      projectId: project.id,
      initiatedBy,
      stripeCheckoutSessionId: checkoutSessionId,
      checkoutClaimHash: originalClaimHash,
      checkoutClaimExpiresAt,
      state: "OPEN",
    });

    const candidateClaimHashes = [hash("candidate-a"), hash("candidate-b")];
    const rotations = await Promise.allSettled(
      candidateClaimHashes.map((checkoutClaimHash) =>
        repositories.billing.rotateProjectCheckoutClaim({
          reservationId: reservation.id,
          projectId: project.id,
          initiatedBy,
          stripeCheckoutSessionId: checkoutSessionId,
          expectedCheckoutClaimHash: originalClaimHash,
          checkoutClaimHash,
          occurredAt: new Date(now.getTime() + 3_000),
        }),
      ),
    );
    const fulfilled = rotations.filter((result) => result.status === "fulfilled");
    const rejected = rotations.filter((result) => result.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toBeInstanceOf(BillingCheckoutConflictError);
    const winningClaimHash = fulfilled[0]?.value.checkoutClaimHash;
    expect(candidateClaimHashes).toContain(winningClaimHash);

    const rows = await client.db
      .select()
      .from(billingCheckoutSessions)
      .where(eq(billingCheckoutSessions.projectId, project.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: reservation.id,
      stripeCheckoutSessionId: checkoutSessionId,
      checkoutClaimHash: winningClaimHash,
      checkoutClaimExpiresAt,
      state: "OPEN",
      checkoutClaimConsumedAt: null,
      issuedApiKeyId: null,
    });
    await expect(
      repositories.billing.rotateProjectCheckoutClaim({
        reservationId: reservation.id,
        projectId: project.id,
        initiatedBy,
        stripeCheckoutSessionId: `cs_test_claim_recovery_wrong_${suffix}`,
        expectedCheckoutClaimHash: winningClaimHash ?? originalClaimHash,
        checkoutClaimHash: hash("wrong-session"),
        occurredAt: new Date(now.getTime() + 4_000),
      }),
    ).rejects.toMatchObject({ code: "CHECKOUT_ALREADY_OPEN" });
  });

  it("rolls back a failed consume, issues exactly once under concurrency, renews, and revokes", async () => {
    const now = new Date();
    const periodStart = new Date(now.getTime() - 24 * 60 * 60_000);
    const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60_000);
    const project = await repositories.scanData.upsertProject({ url: projectUrl });
    const claimHash = `sha256:${"d".repeat(64)}`;
    const checkoutSessionId = `cs_test_claim_${suffix}`;
    const subscriptionId = `sub_claim_${suffix}`;
    const customerId = `cus_claim_${suffix}`;
    const unrelatedKey = await repositories.apiKeys.issue({
      projectId: project.id,
      name: "Claim constraint probe",
      scopes: ["next_move:read"],
      environment: "test",
      rateLimitPerHour: 1,
      providerCostLimitUsd: 0,
      actorId: "test:checkout-constraint",
    });
    await expect(
      client.pool.query(
        `INSERT INTO billing_checkout_sessions
          (project_id, initiated_by, expires_at, issued_api_key_id)
         VALUES ($1, 'test:claimless-issued-key', now() + interval '1 hour', $2)`,
        [project.id, unrelatedKey.record.id],
      ),
    ).rejects.toThrow(
      /billing_checkout_claim_shape_check|billing_checkout_claim_consumption_check/,
    );
    const { reservation } = await repositories.billing.reserveProjectCheckout({
      projectId: project.id,
      initiatedBy: `delivery:${randomUUID()}`,
      now,
      expiresAt: new Date(now.getTime() + 60 * 60_000),
      checkoutClaimHash: claimHash,
      checkoutClaimExpiresAt: new Date(now.getTime() + 90 * 60_000),
    });
    await repositories.billing.bindProjectCheckout({
      reservationId: reservation.id,
      stripeCheckoutSessionId: checkoutSessionId,
      livemode: false,
      occurredAt: new Date(now.getTime() + 1_000),
    });
    await expect(
      client.pool.query(
        `UPDATE billing_checkout_sessions SET issued_api_key_id = $1 WHERE id = $2`,
        [unrelatedKey.record.id, reservation.id],
      ),
    ).rejects.toThrow(/billing_checkout_claim_consumption_check/);
    await repositories.billing.projectWebhook({
      event: {
        eventId: `evt_subscription_claim_${suffix}`,
        type: "customer.subscription.created",
        createdAt: new Date(now.getTime() + 2_000),
        livemode: false,
        kind: "subscription",
        subscriptionId,
        checkoutReservationId: reservation.id,
        customerId,
        projectId: project.id,
        priceId: "price_founder",
        status: "active",
        cancelAtPeriodEnd: false,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        rank: 20,
      },
      payloadHash,
      expectedLivemode: false,
      expectedPriceId: "price_founder",
    });
    await repositories.billing.projectWebhook({
      event: {
        eventId: `evt_invoice_claim_${suffix}`,
        type: "invoice.paid",
        createdAt: new Date(now.getTime() + 3_000),
        livemode: false,
        kind: "invoice",
        invoiceId: `in_claim_${suffix}`,
        subscriptionId,
        customerId,
        paymentState: "paid",
        periodStart,
        periodEnd,
        rank: 20,
      },
      payloadHash,
      expectedLivemode: false,
      expectedPriceId: "price_founder",
    });
    expect(
      await repositories.billing.checkoutClaimStatus({
        claimHash,
        stripeCheckoutSessionId: checkoutSessionId,
        now: new Date(now.getTime() + 3_500),
      }),
    ).toMatchObject({ state: "OPEN", entitlementActive: false });
    await expect(
      repositories.billing.consumeCheckoutClaim({
        environment: "test",
        claimHash,
        stripeCheckoutSessionId: checkoutSessionId,
        now: new Date(now.getTime() + 3_500),
        rateLimitPerHour: 37,
        providerCostLimitUsd: configuredProviderCostLimitUsd,
      }),
    ).resolves.toEqual({ status: "WAITING" });
    await repositories.billing.projectWebhook({
      event: {
        eventId: `evt_checkout_claim_${suffix}`,
        type: "checkout.session.completed",
        createdAt: new Date(now.getTime() + 4_000),
        livemode: false,
        kind: "checkout",
        checkoutSessionId,
        checkoutReservationId: reservation.id,
        projectId: project.id,
        customerId,
        subscriptionId,
        grantsEntitlement: false,
      },
      payloadHash,
      expectedLivemode: false,
      expectedPriceId: "price_founder",
    });
    expect(
      await repositories.billing.checkoutClaimStatus({
        claimHash,
        stripeCheckoutSessionId: checkoutSessionId,
        now: new Date(now.getTime() + 4_500),
      }),
    ).toMatchObject({ state: "COMPLETED", entitlementActive: true });
    await client.db
      .update(billingCheckoutSessions)
      .set({ stripeSubscriptionId: `sub_mismatched_${suffix}` })
      .where(eq(billingCheckoutSessions.id, reservation.id));
    expect(
      await repositories.billing.checkoutClaimStatus({
        claimHash,
        stripeCheckoutSessionId: checkoutSessionId,
        now: new Date(now.getTime() + 4_600),
      }),
    ).toMatchObject({ state: "COMPLETED", entitlementActive: false });
    await expect(
      repositories.billing.consumeCheckoutClaim({
        environment: "test",
        claimHash,
        stripeCheckoutSessionId: checkoutSessionId,
        now: new Date(now.getTime() + 4_600),
        rateLimitPerHour: 37,
        providerCostLimitUsd: configuredProviderCostLimitUsd,
      }),
    ).resolves.toEqual({ status: "WAITING" });
    expect(
      await client.db
        .select({ id: apiKeys.id })
        .from(apiKeys)
        .where(and(eq(apiKeys.projectId, project.id), eq(apiKeys.environment, "live"))),
    ).toHaveLength(0);
    await client.db
      .update(billingCheckoutSessions)
      .set({ stripeSubscriptionId: subscriptionId })
      .where(eq(billingCheckoutSessions.id, reservation.id));

    const triggerSuffix = suffix.replaceAll("-", "_");
    await client.pool.query(`
      CREATE OR REPLACE FUNCTION checkout_claim_failure_${triggerSuffix}()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.id = '${reservation.id}'::uuid AND NEW.issued_api_key_id IS NOT NULL THEN
          RAISE EXCEPTION 'forced checkout claim bind failure';
        END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER checkout_claim_failure_${triggerSuffix}
      BEFORE UPDATE ON billing_checkout_sessions
      FOR EACH ROW EXECUTE FUNCTION checkout_claim_failure_${triggerSuffix}();
    `);
    try {
      await expect(
        repositories.billing.consumeCheckoutClaim({
          environment: "test",
          claimHash,
          stripeCheckoutSessionId: checkoutSessionId,
          now: new Date(now.getTime() + 5_000),
          rateLimitPerHour: 37,
          providerCostLimitUsd: configuredProviderCostLimitUsd,
        }),
      ).rejects.toThrow(/billing_checkout_sessions|checkout claim/i);
      const keysAfterFailure = await client.db
        .select({ id: apiKeys.id })
        .from(apiKeys)
        .where(and(eq(apiKeys.projectId, project.id), eq(apiKeys.environment, "live")));
      expect(keysAfterFailure).toHaveLength(0);
      const [claimAfterFailure] = await client.db
        .select()
        .from(billingCheckoutSessions)
        .where(eq(billingCheckoutSessions.id, reservation.id));
      expect(claimAfterFailure).toMatchObject({
        issuedApiKeyId: null,
        checkoutClaimConsumedAt: null,
      });
    } finally {
      await client.pool.query(`
        DROP TRIGGER IF EXISTS checkout_claim_failure_${triggerSuffix} ON billing_checkout_sessions;
        DROP FUNCTION IF EXISTS checkout_claim_failure_${triggerSuffix}();
      `);
    }

    const concurrent = await Promise.all([
      repositories.billing.consumeCheckoutClaim({
        environment: "test",
        claimHash,
        stripeCheckoutSessionId: checkoutSessionId,
        now: new Date(now.getTime() + 6_000),
        rateLimitPerHour: 37,
        providerCostLimitUsd: configuredProviderCostLimitUsd,
      }),
      repositories.billing.consumeCheckoutClaim({
        environment: "test",
        claimHash,
        stripeCheckoutSessionId: checkoutSessionId,
        now: new Date(now.getTime() + 6_000),
        rateLimitPerHour: 37,
        providerCostLimitUsd: configuredProviderCostLimitUsd,
      }),
    ]);
    expect(concurrent.map((result) => result.status).sort()).toEqual([
      "ALREADY_CONSUMED",
      "ISSUED",
    ]);
    const checkoutIssuance = concurrent.find((result) => result.status === "ISSUED");
    expect(checkoutIssuance).toMatchObject({
      rawKey: expect.stringMatching(/^tf_test_/),
    });
    const [issuedBinding] = await client.db
      .select({ issuedApiKeyId: billingCheckoutSessions.issuedApiKeyId })
      .from(billingCheckoutSessions)
      .where(eq(billingCheckoutSessions.id, reservation.id));
    expect(issuedBinding?.issuedApiKeyId).toBeTruthy();
    const projectKeys = await client.db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.id, issuedBinding!.issuedApiKeyId!));
    expect(projectKeys).toHaveLength(1);
    expect(projectKeys[0]).toMatchObject({
      environment: "test",
      status: "ACTIVE",
      scopes: ["next_move:read", "next_move:write"],
      rateLimitPerHour: 37,
      providerCostLimitUsd: "7.2500",
      expiresAt: periodEnd,
    });
    const checkoutIssuedKey = projectKeys[0];
    if (!checkoutIssuedKey) throw new Error("The checkout-issued API key was not stored");

    const rotated = await repositories.apiKeys.rotate({
      apiKeyId: checkoutIssuedKey.id,
      actorId: "founder:checkout-key-rotation",
    });
    expect(rotated).toMatchObject({
      rawKey: expect.stringMatching(/^tf_test_/),
      record: { status: "ACTIVE", expiresAt: periodEnd },
      replaced: { id: checkoutIssuedKey.id },
    });
    const [bindingAfterRotation] = await client.db
      .select({ issuedApiKeyId: billingCheckoutSessions.issuedApiKeyId })
      .from(billingCheckoutSessions)
      .where(eq(billingCheckoutSessions.id, reservation.id));
    expect(bindingAfterRotation?.issuedApiKeyId).toBe(rotated.record.id);

    await repositories.apiKeys.revoke(rotated.record.id, "founder:checkout-key-loss");
    const reissued = await repositories.apiKeys.reissue({
      apiKeyId: rotated.record.id,
      actorId: "founder:checkout-key-reissue",
    });
    expect(reissued).toMatchObject({
      rawKey: expect.stringMatching(/^tf_test_/),
      record: { status: "ACTIVE", expiresAt: periodEnd },
      replaced: { id: rotated.record.id, status: "REVOKED" },
    });
    const [bindingAfterReissue] = await client.db
      .select({ issuedApiKeyId: billingCheckoutSessions.issuedApiKeyId })
      .from(billingCheckoutSessions)
      .where(eq(billingCheckoutSessions.id, reservation.id));
    expect(bindingAfterReissue?.issuedApiKeyId).toBe(reissued.record.id);
    await expect(
      repositories.billing.consumeCheckoutClaim({
        environment: "test",
        claimHash,
        stripeCheckoutSessionId: checkoutSessionId,
        now: new Date(now.getTime() + 6_500),
        rateLimitPerHour: 37,
        providerCostLimitUsd: configuredProviderCostLimitUsd,
      }),
    ).resolves.toEqual({
      status: "ALREADY_CONSUMED",
      visiblePrefix: reissued.record.visiblePrefix,
    });

    const renewedStart = periodEnd;
    const renewedEnd = new Date(periodEnd.getTime() + 31 * 24 * 60 * 60_000);
    await repositories.billing.projectWebhook({
      event: {
        eventId: `evt_subscription_renewed_${suffix}`,
        type: "customer.subscription.updated",
        createdAt: new Date(now.getTime() + 7_000),
        livemode: false,
        kind: "subscription",
        subscriptionId,
        checkoutReservationId: reservation.id,
        customerId,
        projectId: project.id,
        priceId: "price_founder",
        status: "active",
        cancelAtPeriodEnd: false,
        currentPeriodStart: renewedStart,
        currentPeriodEnd: renewedEnd,
        rank: 20,
      },
      payloadHash,
      expectedLivemode: false,
      expectedPriceId: "price_founder",
    });
    await repositories.billing.projectWebhook({
      event: {
        eventId: `evt_invoice_renewed_${suffix}`,
        type: "invoice.paid",
        createdAt: new Date(now.getTime() + 8_000),
        livemode: false,
        kind: "invoice",
        invoiceId: `in_claim_renewed_${suffix}`,
        subscriptionId,
        customerId,
        paymentState: "paid",
        periodStart: renewedStart,
        periodEnd: renewedEnd,
        rank: 20,
      },
      payloadHash,
      expectedLivemode: false,
      expectedPriceId: "price_founder",
    });
    const [renewedKey] = await client.db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.id, reissued.record.id));
    expect(renewedKey).toMatchObject({ status: "ACTIVE", expiresAt: renewedEnd });

    await repositories.billing.projectWebhook({
      event: {
        eventId: `evt_invoice_failed_${suffix}`,
        type: "invoice.payment_failed",
        createdAt: new Date(now.getTime() + 9_000),
        livemode: false,
        kind: "invoice",
        invoiceId: `in_claim_failed_${suffix}`,
        subscriptionId,
        customerId,
        paymentState: "failed",
        periodStart: renewedStart,
        periodEnd: renewedEnd,
        rank: 100,
      },
      payloadHash,
      expectedLivemode: false,
      expectedPriceId: "price_founder",
    });
    const [temporaryFailureKey] = await client.db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.id, reissued.record.id));
    expect(temporaryFailureKey).toMatchObject({ status: "ACTIVE", revokedAt: null });

    await repositories.billing.projectWebhook({
      event: {
        eventId: `evt_subscription_canceled_${suffix}`,
        type: "customer.subscription.deleted",
        createdAt: new Date(now.getTime() + 10_000),
        livemode: false,
        kind: "subscription",
        subscriptionId,
        checkoutReservationId: reservation.id,
        customerId,
        projectId: project.id,
        priceId: "price_founder",
        status: "canceled",
        cancelAtPeriodEnd: false,
        currentPeriodStart: renewedStart,
        currentPeriodEnd: renewedEnd,
        rank: 100,
      },
      payloadHash,
      expectedLivemode: false,
      expectedPriceId: "price_founder",
    });
    const [revokedKey] = await client.db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.id, reissued.record.id));
    expect(revokedKey).toMatchObject({ status: "REVOKED" });
    expect(revokedKey?.revokedAt).not.toBeNull();
    const lifecycleAudit = await client.db
      .select()
      .from(apiKeyManagementEvents)
      .where(eq(apiKeyManagementEvents.projectId, project.id));
    expect(lifecycleAudit.map((event) => event.action)).toEqual(
      expect.arrayContaining(["ISSUED", "ROTATED", "REISSUED", "RENEWED", "REVOKED"]),
    );
    const serializedAudit = JSON.stringify(lifecycleAudit);
    expect(serializedAudit).not.toContain(checkoutIssuance?.rawKey);
    expect(serializedAudit).not.toContain(rotated.rawKey);
    expect(serializedAudit).not.toContain(reissued.rawKey);
  });
});
