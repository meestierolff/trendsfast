import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

const FIXTURE_API_KEY = "tf_test_fixture1.fixture-only-key-not-for-production-000000000000";
const API_HEADERS = {
  Authorization: `Bearer ${FIXTURE_API_KEY}`,
  "Content-Type": "application/json",
};
const REQUEST = {
  product_url: "https://trendsfast.com",
  goal: "qualified_signups",
  market: "US",
  language: "en",
  preferred_channels: ["x", "linkedin"],
  available_formats: ["founder_text", "screen_recording"],
};

test("project API creates, reviews, delivers, polls, and replays one Next Move", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "One full API lifecycle is sufficient per run.");
  test.setTimeout(60_000);
  const opsToken = process.env.OPS_TOKEN;
  test.skip(!opsToken, "OPS_TOKEN is required for the founder-reviewed API journey.");
  if (!opsToken) return;

  const idempotencyKey = randomUUID();
  const createResponse = await page.request.post("/v1/next-move", {
    headers: { ...API_HEADERS, "Idempotency-Key": idempotencyKey },
    data: REQUEST,
  });
  expect(createResponse.status()).toBe(202);
  const accepted = (await createResponse.json()) as {
    id?: string;
    status?: string;
    status_url?: string;
  };
  expect(accepted.id).toMatch(/^scan_[A-Za-z0-9_-]+$/);
  expect(accepted.status_url).toContain(`/v1/next-moves/${accepted.id}`);
  if (!accepted.id) return;

  await expect
    .poll(
      async () => {
        const response = await page.request.get(`/v1/next-moves/${accepted.id}`, {
          headers: API_HEADERS,
        });
        return ((await response.json()) as { status?: string }).status;
      },
      { timeout: 30_000 },
    )
    .toBe("REVIEW_REQUIRED");

  await page.goto("/ops");
  await page.getByLabel("Operations token").fill(opsToken);
  await page.getByRole("button", { name: "Enter operations" }).click();
  await expect(page.getByText("PRIVATE / REVIEW QUEUE")).toBeVisible();
  await page.goto(`/ops/${accepted.id}`);
  await expect(page.getByText("REVIEW PENDING", { exact: true })).toBeVisible();

  const verifyButtons = page.getByRole("button", { name: "Verify receipt" });
  while ((await verifyButtons.count()) > 0) {
    const countBeforeVerification = await verifyButtons.count();
    const verificationResponse = page.waitForResponse(
      (candidate) =>
        candidate.url().includes("/actions/verify-evidence") &&
        candidate.request().method() === "POST",
    );
    await verifyButtons.first().click();
    expect((await verificationResponse).status()).toBe(200);
    await expect.poll(() => verifyButtons.count()).toBe(countBeforeVerification - 1);
  }

  const approvalResponse = page.waitForResponse(
    (candidate) =>
      candidate.url().includes("/actions/approve") && candidate.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Approve move" }).click();
  expect((await approvalResponse).status()).toBe(200);
  const deliveryResponse = page.waitForResponse(
    (candidate) =>
      candidate.url().includes("/actions/deliver") && candidate.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Issue private link" }).click();
  expect((await deliveryResponse).status()).toBe(200);

  const readyResponse = await page.request.get(`/v1/next-moves/${accepted.id}`, {
    headers: API_HEADERS,
  });
  expect(readyResponse.status()).toBe(200);
  const ready = (await readyResponse.json()) as {
    id?: string;
    status?: string;
    founder_reviewed?: boolean;
    auto_publish?: boolean;
    next_move?: { action?: string };
    evidence?: unknown[];
  };
  expect(ready).toMatchObject({
    id: accepted.id,
    status: "READY",
    founder_reviewed: true,
    auto_publish: false,
  });
  expect(["PUBLISH", "REPLY", "REMIX", "WAIT"]).toContain(ready.next_move?.action);
  expect(ready.evidence?.length).toBeGreaterThan(0);

  const replayResponse = await page.request.post("/v1/next-move", {
    headers: { ...API_HEADERS, "Idempotency-Key": idempotencyKey },
    data: REQUEST,
  });
  expect(replayResponse.status()).toBe(200);
  await expect(replayResponse.json()).resolves.toMatchObject({ id: accepted.id, status: "READY" });

  const conflictResponse = await page.request.post("/v1/next-move", {
    headers: { ...API_HEADERS, "Idempotency-Key": idempotencyKey },
    data: { ...REQUEST, goal: "waitlist_signups" },
  });
  expect(conflictResponse.status()).toBe(409);
  await expect(conflictResponse.json()).resolves.toMatchObject({
    error: { code: "CONFLICT" },
  });
});
