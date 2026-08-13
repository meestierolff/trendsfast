import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { getRepositories, hardDelete } = vi.hoisted(() => {
  const hardDelete = vi.fn().mockResolvedValue({ deleted: true });
  return {
    hardDelete,
    getRepositories: vi.fn(() => ({ founderLaunchInterests: { hardDelete } })),
  };
});

vi.mock("../../lib/server-database", () => ({ getOpsRepositories: getRepositories }));

import { DELETE } from "../../app/api/ops/founder-launch-interests/[interestId]/route";
import { createCsrfToken, issueOpsSession } from "../../lib/ops-session";

const origin = "https://trendsfast.test";
const secret = "founder-launch-ops-test-secret-at-least-32-characters";
const interestId = "00000000-0000-4000-8000-000000000014";

function authorizedRequest(body?: string) {
  const session = issueOpsSession({ secret });
  return new Request(`${origin}/api/ops/founder-launch-interests/${interestId}`, {
    method: "DELETE",
    headers: {
      origin,
      cookie: `tf_ops_session=${session}`,
      "x-csrf-token": createCsrfToken(session, secret),
      ...(body === undefined ? {} : { "content-type": "text/plain" }),
    },
    ...(body === undefined ? {} : { body }),
  });
}

beforeEach(() => {
  vi.stubEnv("APP_URL", origin);
  vi.stubEnv("SESSION_SECRET", secret);
  hardDelete.mockReset().mockResolvedValue({ deleted: true });
  getRepositories.mockClear();
});

afterEach(() => vi.unstubAllEnvs());

describe("Founder launch-interest operations", () => {
  it("requires session-bound CSRF and hard-deletes without returning PII", async () => {
    const response = await DELETE(authorizedRequest(), {
      params: Promise.resolve({ interestId }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ deleted: true });
    expect(JSON.stringify(body)).not.toContain("email");
    expect(hardDelete).toHaveBeenCalledWith({
      id: interestId,
      actorId: expect.stringMatching(/^founder:/),
    });
  });

  it("rejects missing authorization and any request body before storage", async () => {
    const unauthorized = await DELETE(
      new Request(`${origin}/api/ops/founder-launch-interests/${interestId}`, {
        method: "DELETE",
        headers: { origin },
      }),
      { params: Promise.resolve({ interestId }) },
    );
    expect(unauthorized.status).toBe(401);

    const bodyRejected = await DELETE(authorizedRequest("x"), {
      params: Promise.resolve({ interestId }),
    });
    expect(bodyRejected.status).toBe(413);
    expect(getRepositories).not.toHaveBeenCalled();
  });
});
