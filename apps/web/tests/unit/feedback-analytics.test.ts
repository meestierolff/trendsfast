import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { record, resolveReadyScanIdentity } = vi.hoisted(() => ({
  record: vi.fn().mockResolvedValue({
    event: { id: "feedback-id", kind: "WOULD_USE" },
    created: true,
  }),
  resolveReadyScanIdentity: vi.fn().mockResolvedValue({
    scanRequestId: "00000000-0000-4000-8000-000000000001",
    nextMoveId: "00000000-0000-4000-8000-000000000002",
    deliveryTokenId: "00000000-0000-4000-8000-000000000003",
  }),
}));

vi.mock("../../lib/server-database", () => ({
  getRepositories: () => ({ feedback: { record } }),
}));
vi.mock("../../lib/scan-view-service", () => ({ resolveReadyScanIdentity }));

import { POST } from "../../app/api/scans/[token]/feedback/route";

const origin = new URL(process.env.APP_URL ?? "http://localhost:3000").origin;

async function submit(kind: string) {
  return POST(
    new Request(`${origin}/api/scans/private-token/feedback`, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ kind }),
    }),
    { params: Promise.resolve({ token: "private-token" }) },
  );
}

beforeEach(() => {
  record.mockReset().mockResolvedValue({
    event: { id: "feedback-id", kind: "WOULD_USE" },
    created: true,
  });
  resolveReadyScanIdentity.mockClear();
});

describe("private feedback route", () => {
  it.each(["WOULD_USE", "USED_OR_PUBLISHED", "REQUEST_ANOTHER_SCAN", "NOT_RELEVANT"])(
    "accepts the %s repository-backed choice",
    async (kind) => {
      record.mockResolvedValueOnce({ event: { id: "feedback-id", kind }, created: true });

      const response = await submit(kind);

      expect(response.status).toBe(201);
      expect(record).toHaveBeenCalledWith(
        expect.objectContaining({ kind, deliveryTokenId: expect.any(String) }),
      );
    },
  );

  it("treats a same-kind delivery-token replay as idempotent", async () => {
    record.mockResolvedValueOnce({
      event: { id: "feedback-id", kind: "USED_OR_PUBLISHED" },
      created: false,
    });

    const response = await submit("USED_OR_PUBLISHED");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ recorded: true, duplicate: true });
  });

  it("rejects a later conflicting choice instead of claiming it was stored", async () => {
    record.mockResolvedValueOnce({
      event: { id: "feedback-id", kind: "WOULD_USE" },
      created: false,
    });

    const response = await submit("NOT_RELEVANT");

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "Feedback was already recorded for this result.",
    });
  });
});
