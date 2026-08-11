import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { recordEvidenceOpenedByToken } = vi.hoisted(() => ({
  recordEvidenceOpenedByToken: vi.fn().mockResolvedValue(true),
}));
vi.mock("../../lib/scan-view-service", () => ({ recordEvidenceOpenedByToken }));

import { POST } from "../../app/api/scans/[token]/evidence/[receiptId]/route";

const origin = "https://trendsfast.test";
const secret = "evidence-analytics-route-test-secret-at-least-32-characters";

beforeEach(() => {
  vi.stubEnv("APP_URL", origin);
  vi.stubEnv("SESSION_SECRET", secret);
  recordEvidenceOpenedByToken.mockReset().mockResolvedValue(true);
});
afterEach(() => vi.unstubAllEnvs());

describe("evidence-open analytics capability route", () => {
  it("passes capability identifiers only to the server resolver and no analytics body", async () => {
    const response = await POST(
      new Request(`${origin}/api/scans/private-token/evidence/receipt-id`, {
        method: "POST",
        headers: { origin, "sec-fetch-site": "same-origin" },
      }),
      { params: Promise.resolve({ token: "private-token", receiptId: "receipt-id" }) },
    );

    expect(response.status).toBe(204);
    expect(recordEvidenceOpenedByToken).toHaveBeenCalledWith("private-token", "receipt-id", {
      anonymousSessionHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      secret,
    });
  });

  it("rejects cross-site and non-empty requests before capability resolution", async () => {
    const crossSite = await POST(
      new Request(`${origin}/api/scans/private-token/evidence/receipt-id`, {
        method: "POST",
        headers: { origin: "https://attacker.test", "sec-fetch-site": "cross-site" },
      }),
      { params: Promise.resolve({ token: "private-token", receiptId: "receipt-id" }) },
    );
    expect(crossSite.status).toBe(403);
    const body = await POST(
      new Request(`${origin}/api/scans/private-token/evidence/receipt-id`, {
        method: "POST",
        headers: { origin, "sec-fetch-site": "same-origin" },
        body: "x",
      }),
      { params: Promise.resolve({ token: "private-token", receiptId: "receipt-id" }) },
    );
    expect(body.status).toBe(413);
    expect(recordEvidenceOpenedByToken).not.toHaveBeenCalled();
  });
});
