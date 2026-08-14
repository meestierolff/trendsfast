import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  surface: "ops" as "ops" | "public",
}));

vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@trendsfast/config", () => ({ deploymentSurface: () => mocks.surface }));

import { getOpsPageAuthorization } from "../../app/ops/_auth";
import { issueOpsSession } from "../../lib/ops-session";

const secret = "ops-page-session-secret-that-is-at-least-32-characters";

beforeEach(() => {
  mocks.surface = "ops";
  mocks.cookies.mockReset().mockResolvedValue({
    get: vi.fn(() => ({ value: issueOpsSession({ secret }) })),
  });
  vi.stubEnv("SESSION_SECRET", secret);
});

afterEach(() => vi.unstubAllEnvs());

describe("operations page authorization", () => {
  it("fails closed before reading cookies outside the exact operations surface", async () => {
    mocks.surface = "public";

    await expect(getOpsPageAuthorization()).resolves.toBeNull();
    expect(mocks.cookies).not.toHaveBeenCalled();
  });

  it("returns a reviewer and CSRF token for a signed ops-surface session", async () => {
    await expect(getOpsPageAuthorization()).resolves.toMatchObject({
      reviewerId: expect.stringMatching(/^founder:/),
      csrfToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
    });
    expect(mocks.cookies).toHaveBeenCalledTimes(1);
  });
});
