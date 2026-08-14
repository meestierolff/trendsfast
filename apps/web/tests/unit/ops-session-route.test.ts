import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  admit: vi.fn(),
  surface: "ops" as "ops" | "public",
  env: {
    API_KEY_PEPPER: "ops-login-fingerprint-pepper-at-least-32-characters",
    SESSION_SECRET: "ops-login-session-secret-at-least-32-characters",
  },
}));

vi.mock("@trendsfast/config", () => ({
  deploymentSurface: () => mocks.surface,
  loadEnv: () => mocks.env,
}));
vi.mock("../../lib/server-database", () => ({
  getOpsRepositories: () => ({ authAdmission: { admit: mocks.admit } }),
}));

import { POST } from "../../app/api/ops/session/route";

const origin = "https://ops.trendsfast.test";
const opsToken = "founder-ops-token-that-is-at-least-32-characters";
let requestNumber = 0;

function loginRequest(token: unknown): Request {
  requestNumber += 1;
  return new Request(`${origin}/api/ops/session`, {
    method: "POST",
    headers: {
      origin,
      "content-type": "application/json",
      "sec-fetch-site": "same-origin",
      "x-forwarded-for": `203.0.113.${requestNumber}`,
    },
    body: JSON.stringify({ token }),
  });
}

beforeEach(() => {
  mocks.surface = "ops";
  mocks.admit.mockReset().mockResolvedValue(true);
  vi.stubEnv("APP_URL", origin);
  vi.stubEnv("OPS_TOKEN", opsToken);
  vi.stubEnv("SESSION_SECRET", mocks.env.SESSION_SECRET);
});

afterEach(() => vi.unstubAllEnvs());

describe("operations session route admission", () => {
  it("rejects an invalid founder token before durable database admission", async () => {
    const response = await POST(loginRequest("incorrect-founder-token-with-enough-entropy"));

    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(mocks.admit).not.toHaveBeenCalled();
  });

  it("fails closed outside the exact operations deployment surface", async () => {
    mocks.surface = "public";

    const response = await POST(loginRequest(opsToken));

    expect(response.status).toBe(403);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(mocks.admit).not.toHaveBeenCalled();
  });

  it("keeps valid credentials behind durable cross-instance admission", async () => {
    mocks.admit.mockResolvedValue(false);

    const response = await POST(loginRequest(opsToken));

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("300");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(mocks.admit).toHaveBeenCalledTimes(1);
    expect(mocks.admit).toHaveBeenCalledWith(
      expect.objectContaining({
        namespace: "ops",
        fingerprintHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
    );
    expect(JSON.stringify(mocks.admit.mock.calls[0]?.[0])).not.toContain(opsToken);
  });

  it("issues a private session only after both admission layers accept", async () => {
    const response = await POST(loginRequest(opsToken));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(mocks.admit).toHaveBeenCalledTimes(1);
    expect(response.headers.get("set-cookie")).toContain("tf_ops_session=");
  });
});
