import { expect, test } from "@playwright/test";

test("native magic-link form preserves its tuple Origin", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "One Chromium navigation covers this contract.");

  const login = await page.goto("/login");
  expect(login?.status()).toBe(200);
  expect(login?.headers()["referrer-policy"]).toBe("strict-origin");
  await expect(page.locator('meta[name="referrer"]')).toHaveAttribute("content", "strict-origin");
  const expectedOrigin = new URL(page.url()).origin;

  const email = page.locator("#login-email");
  await email.evaluate((element) => {
    const input = element as HTMLInputElement;
    input.disabled = false;
    input.type = "text";
  });
  await email.fill("invalid");

  const form = page.locator('form[action="/auth/magic-link"]');
  const [request, response] = await Promise.all([
    page.waitForRequest(
      (candidate) =>
        candidate.method() === "POST" && new URL(candidate.url()).pathname === "/auth/magic-link",
    ),
    page.waitForResponse(
      (candidate) =>
        candidate.request().method() === "POST" &&
        new URL(candidate.url()).pathname === "/auth/magic-link",
    ),
    form.evaluate((element) => (element as HTMLFormElement).submit()),
  ]);

  expect(await request.headerValue("origin")).toBe(expectedOrigin);
  expect(await request.headerValue("sec-fetch-site")).toBe("same-origin");
  expect(await request.headerValue("referer")).toBe(`${expectedOrigin}/`);
  expect(response.status()).toBe(303);
  expect(await response.headerValue("referrer-policy")).toBe("no-referrer");
  expect(await response.headerValue("cache-control")).toContain("no-store");
  const location = await response.headerValue("location");
  expect(location).not.toBeNull();
  const redirect = new URL(location ?? "", expectedOrigin);
  expect({
    origin: redirect.origin,
    pathname: redirect.pathname,
    error: redirect.searchParams.get("error"),
  }).toEqual({ origin: expectedOrigin, pathname: "/login", error: "invalid_email" });
  await page.waitForURL(/\/login\?error=invalid_email$/u);
  await expect(page.getByText("Enter a valid e-mail address.", { exact: true })).toBeVisible();
});

test("native project-claim navigation sends only its tuple Origin", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "One Chromium navigation covers this contract.");

  const login = await page.goto("/login");
  expect(login?.status()).toBe(200);
  expect(login?.headers()["referrer-policy"]).toBe("strict-origin");
  const expectedOrigin = new URL(page.url()).origin;

  // The deliberately invalid token is rejected before any repository read or
  // claim persistence while still exercising the native navigation boundary.
  await page.evaluate(() => {
    const form = document.createElement("form");
    form.action = "/api/project-claims";
    form.method = "post";
    const token = document.createElement("input");
    token.name = "deliveryToken";
    token.value = "invalid";
    form.append(token);
    document.body.append(form);
  });
  const form = page.locator('form[action$="/api/project-claims"]');
  const [request, response] = await Promise.all([
    page.waitForRequest(
      (candidate) =>
        candidate.method() === "POST" &&
        new URL(candidate.url()).pathname === "/api/project-claims",
    ),
    page.waitForResponse(
      (candidate) =>
        candidate.request().method() === "POST" &&
        new URL(candidate.url()).pathname === "/api/project-claims",
    ),
    form.evaluate((element) => (element as HTMLFormElement).submit()),
  ]);

  expect(await request.headerValue("origin")).toBe(expectedOrigin);
  expect(await request.headerValue("sec-fetch-site")).toBe("same-origin");
  expect(await request.headerValue("referer")).toBe(`${expectedOrigin}/`);
  expect(response.status()).toBe(303);
  expect(await response.headerValue("referrer-policy")).toBe("no-referrer");
  expect(await response.headerValue("cache-control")).toContain("no-store");
  const location = await response.headerValue("location");
  expect(location).not.toBeNull();
  const redirect = new URL(location ?? "", expectedOrigin);
  expect({
    origin: redirect.origin,
    pathname: redirect.pathname,
    error: redirect.searchParams.get("error"),
  }).toEqual({ origin: expectedOrigin, pathname: "/login", error: "claim_invalid" });
});
