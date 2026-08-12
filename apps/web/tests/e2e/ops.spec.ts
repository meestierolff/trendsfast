import { expect, test } from "@playwright/test";

test("ops requires founder authentication", async ({ page }) => {
  await page.goto("/ops");

  await expect(page.getByRole("heading", { name: "Founder operations" })).toBeVisible();
  await expect(page.getByLabel("Operations token")).toBeVisible();
  await expect(page.getByText(/temporary founder control/i)).toBeVisible();
});

test("founder reviews, approves, and privately delivers a persisted scan", async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  const opsToken = process.env.OPS_TOKEN;
  test.skip(!opsToken, "OPS_TOKEN is required for the founder delivery journey.");
  if (!opsToken) return;

  // The commercial boundary deliberately allows one accepted free submission
  // per requester/day. Model the two browser projects as distinct clients at
  // the trusted local proxy so desktop and mobile each exercise the full flow.
  const requesterOctet = 20 + (Date.now() % 200);
  await page.setExtraHTTPHeaders({
    "X-Forwarded-For": `${testInfo.project.name === "mobile" ? "198.51.100" : "192.0.2"}.${requesterOctet}`,
  });

  const host = `ops-${testInfo.project.name}-${testInfo.retry}-${Date.now()}.example.com`;
  await page.goto("/");
  await page.getByLabel("Product URL").first().fill(`https://${host}`);
  await page.getByRole("button", { name: "Find my next move" }).first().click();
  await page.waitForURL(/\/scan\/requested\/scan_[A-Za-z0-9_.-]+$/);
  const scanId = page.url().split("/").at(-1);
  expect(scanId).toMatch(/^scan_[A-Za-z0-9_.-]+$/);
  if (!scanId) return;

  await expect
    .poll(
      async () => {
        const response = await page.request.get(`/api/scans/${scanId}/status`);
        const body = (await response.json()) as { state?: string };
        return body.state;
      },
      { timeout: 30_000 },
    )
    .toBe("REVIEW_REQUIRED");

  await page.goto("/ops");
  await page.getByLabel("Operations token").fill(opsToken);
  await page.getByRole("button", { name: "Enter operations" }).click();
  await expect(page.getByText("PRIVATE / REVIEW QUEUE")).toBeVisible();

  await page.goto(`/ops/${scanId}`);
  await expect(page.getByText("REVIEW PENDING", { exact: true })).toBeVisible();
  const verifyButtons = page.getByRole("button", { name: "Verify receipt" });
  await expect(verifyButtons.first()).toBeVisible();
  let verifiedReceiptCount = 0;
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
    verifiedReceiptCount += 1;
    expect(verifiedReceiptCount).toBeLessThanOrEqual(10);
  }
  expect(verifiedReceiptCount).toBeGreaterThan(0);

  const approvalResponse = page.waitForResponse(
    (candidate) =>
      candidate.url().includes("/actions/approve") && candidate.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Approve move" }).click();
  expect((await approvalResponse).status()).toBe(200);
  await expect(page.getByRole("button", { name: "Issue private link" })).toBeVisible();

  const deliveryResponse = page.waitForResponse(
    (candidate) =>
      candidate.url().includes("/actions/deliver") && candidate.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Issue private link" }).click();
  const delivered = await deliveryResponse;
  expect(delivered.status()).toBe(200);
  const delivery = (await delivered.json()) as {
    created?: boolean;
    deliveryToken?: string | null;
    deliveryUrl?: string | null;
  };
  expect(delivery).toMatchObject({ created: true });
  expect(delivery.deliveryToken).toMatch(/^scan_[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  expect(delivery.deliveryUrl).toContain("/scan/");

  await expect(page.getByLabel("Private result URL")).toHaveValue(delivery.deliveryUrl ?? "");
  if (!delivery.deliveryUrl) return;
  const resultResponse = await page.goto(delivery.deliveryUrl);
  expect(resultResponse?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Your next distribution move." })).toBeVisible();
  await expect(page.getByText(/Founder-reviewed/).first()).toBeVisible();

  await page.goto(`/ops/${scanId}`);
  await expect(page.getByText("This review is closed.")).toBeVisible();
  await expect(page.getByText("ONE-TIME DELIVERY TOKEN", { exact: true })).toHaveCount(0);
});
