import { expect, test } from "@playwright/test";

const publicRoutes = [
  "/",
  "/agents",
  "/docs",
  "/channels",
  "/news",
  "/blog",
  "/pricing",
  "/sources",
  "/open-source",
  "/open",
  "/social-media-trend-api",
  "/trend-detection-api",
  "/content-distribution-api",
] as const;

test("landing page leads with the URL-first product promise", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", {
      name: "Spot the trends your users care about. Know what to distribute next.",
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Social media and search trend intelligence for AI agents", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Product URL").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Find my next move" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "See it in action" }).first()).toBeVisible();
  await expect(page.getByText("Founder-reviewed", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Evidence-linked", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Private by default", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("No auto-posting", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Product demo using example data.", { exact: true })).toBeVisible();
  await expect(page.getByText(/trusted by/i)).toHaveCount(0);
});

test("interactive example includes all four honest outcomes", async ({ page }) => {
  await page.goto("/");

  const demo = page.getByTestId("interactive-demo").first();
  for (const action of ["PUBLISH", "REPLY", "REMIX", "WAIT"]) {
    await demo.getByRole("button", { name: action, exact: true }).click();
    await expect(demo.locator('[data-testid="example-action"]')).toHaveText(action);
  }
});

test("public source labels stay friendly while technical truth remains available", async ({
  page,
}) => {
  await page.goto("/sources");

  await expect(
    page.getByRole("heading", { name: "Every source, honestly labeled." }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Reddit automation", exact: true })).toBeVisible();
  await expect(page.getByText("Permission required", { exact: true })).toBeVisible();
  await expect(page.getByText("Coming soon", { exact: true }).first()).toBeVisible();

  const technical = page.locator("summary", { hasText: /technical source state/i }).first();
  await technical.click();
  await expect(page.getByText("UNVERIFIED", { exact: true }).first()).toBeVisible();
});

test("desktop navigation exposes every launch route", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "Desktop-only navigation assertion");
  await page.goto("/");

  const navigation = page.getByRole("navigation", { name: "Primary navigation" });
  for (const label of ["AI Agents", "Dev Docs", "Channels", "News", "Blog", "Pricing", "GitHub"]) {
    await expect(navigation.getByRole("link", { name: label, exact: true })).toBeVisible();
  }
  await expect(page.getByRole("link", { name: "Run a free scan" }).first()).toBeVisible();
});

test("mobile navigation is operable and the primary action stays usable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const toggle = page.getByRole("button", { name: "Open navigation" });
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(page.getByRole("navigation", { name: "Primary navigation" })).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: "Primary navigation" })
      .getByRole("link", { name: "Pricing", exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Close navigation" }).click();
  const input = page.getByLabel("Product URL").first();
  const submit = page.getByRole("button", { name: "Find my next move" }).first();
  await expect(input).toBeInViewport();
  await expect(submit).toBeInViewport();
  await expect(page.locator("body")).not.toHaveCSS("overflow-x", "scroll");
});

test("every public launch route renders", async ({ page }) => {
  for (const route of publicRoutes) {
    const response = await page.goto(route);
    expect(response?.status(), route).toBe(200);
    await expect(page.locator("h1"), route).toBeVisible();
  }
});
