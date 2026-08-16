import { expect, test } from "@playwright/test";

const unknownToken = "not-a-valid-private-token!";
const fixtureToken = "scan_fixture_trendsfast";

test("reviewed fixture result stays private and records customer signals", async ({ page }) => {
  const statusResponse = await page.request.get(`/api/scans/${fixtureToken}/status`);
  expect(statusResponse.status()).toBe(200);
  expect(await statusResponse.json()).toMatchObject({
    found: true,
    state: "READY",
    founderReview: true,
    resultToken: fixtureToken,
  });

  const response = await page.goto(`/scan/${fixtureToken}`);
  expect(response?.status()).toBe(200);
  expect(response?.headers()["cache-control"]).toMatch(/no-store|no-cache/);
  expect(response?.headers()["referrer-policy"]).toBe("strict-origin");
  await expect(page.getByRole("heading", { name: "Your next distribution move." })).toBeVisible();
  await expect(page.getByText(/Founder-reviewed|Founder reviewed/).first()).toBeVisible();
  await expect(page.getByText("auto_publish=false", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "The proof behind the move." })).toBeVisible();

  const feedbackResponse = page.waitForResponse(
    (candidate) => candidate.url().includes("/feedback") && candidate.request().method() === "POST",
  );
  await page.getByRole("button", { name: "I would use this" }).click();
  expect([200, 201]).toContain((await feedbackResponse).status());
  await expect(page.getByText("Feedback recorded. Thank you.")).toBeVisible();

  await page.getByLabel("I explicitly consent to public sharing").check();
  const consentResponse = page.waitForResponse(
    (candidate) =>
      candidate.url().includes("/share-consent") && candidate.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Allow public sharing" }).click();
  expect((await consentResponse).status()).toBe(200);
  await expect(page.getByText("Public-share consent recorded.")).toBeVisible();
});

test("unknown scan requests do not fall back to demo content", async ({ page }) => {
  const response = await page.goto(`/scan/requested/${unknownToken}`);

  expect(response?.status()).toBe(404);
  await expect(
    page.getByRole("heading", { name: "This private scan link is not available." }),
  ).toBeVisible();
  await expect(page.getByText(/fixture example/i)).toHaveCount(0);
  await expect(page.getByText(/% complete/i)).toHaveCount(0);
});

test("unknown delivery tokens never expose a result", async ({ page }) => {
  const response = await page.goto(`/scan/${unknownToken}`);

  expect(response?.status()).toBe(404);
  await expect(
    page.getByRole("heading", { name: "This private result is not available." }),
  ).toBeVisible();
  await expect(page.getByText("Your next distribution move", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/fixture example/i)).toHaveCount(0);
});

test("private scan pages remain usable at a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto(`/scan/requested/${unknownToken}`);

  const heading = page.getByRole("heading", { name: "This private scan link is not available." });
  await expect(heading).toBeVisible();
  await expect(heading).toBeInViewport();
  await expect(page.locator("body")).not.toHaveCSS("overflow-x", "scroll");
});
