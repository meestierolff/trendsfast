import { expect, test } from "@playwright/test";

test("landing page is result-first and honest", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Know what to distribute next." })).toBeVisible();
  await expect(page.getByLabel("Product URL").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Run a free scan" }).first()).toBeVisible();
  await expect(page.getByText("Founder-reviewed alpha", { exact: true })).toBeVisible();
  await expect(page.getByText("No auto-posting", { exact: true })).toBeVisible();
  await expect(page.getByText("Fixture example", { exact: true })).toBeVisible();
  await expect(page.getByText(/trusted by/i)).toHaveCount(0);
});

test("interactive example includes all four honest outcomes", async ({ page }) => {
  await page.goto("/");

  for (const action of ["PUBLISH", "REPLY", "REMIX", "WAIT"]) {
    await page.getByRole("button", { name: action, exact: true }).click();
    await expect(page.locator('[data-testid="example-action"]')).toHaveText(action);
  }
});

test("source page exposes legal and beta status", async ({ page }) => {
  await page.goto("/sources");

  await expect(
    page.getByRole("heading", { name: "Source status, without theater." }),
  ).toBeVisible();
  await expect(page.getByText("Reddit automation")).toBeVisible();
  await expect(page.getByText("LEGAL_REVIEW", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("X", { exact: true })).toBeVisible();
  await expect(page.getByText("BETA", { exact: true }).first()).toBeVisible();
});

test("mobile navigation and primary action stay usable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const input = page.getByLabel("Product URL").first();
  const submit = page.getByRole("button", { name: "Run a free scan" }).first();
  await expect(input).toBeInViewport();
  await expect(submit).toBeInViewport();
});
