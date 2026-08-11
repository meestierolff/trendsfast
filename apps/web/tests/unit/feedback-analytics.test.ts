import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { append, record, resolveReadyScanIdentity } = vi.hoisted(() => ({
  append: vi.fn().mockResolvedValue({}),
  record: vi.fn().mockResolvedValue({ id: "feedback-id" }),
  resolveReadyScanIdentity: vi.fn().mockResolvedValue({
    scanRequestId: "00000000-0000-4000-8000-000000000001",
    nextMoveId: "00000000-0000-4000-8000-000000000002",
    deliveryTokenId: "00000000-0000-4000-8000-000000000003",
  }),
}));

vi.mock("../../lib/server-database", () => ({
  getRepositories: () => ({ analytics: { append }, feedback: { record } }),
}));
vi.mock("../../lib/scan-view-service", () => ({ resolveReadyScanIdentity }));

import { POST } from "../../app/api/scans/[token]/feedback/route";

const origin = "http://localhost:3000";

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
  append.mockClear();
  record.mockClear();
  resolveReadyScanIdentity.mockClear();
});

describe("private feedback analytics vocabulary", () => {
  it.each([
    ["WOULD_USE", ["feedback_submitted", "move_would_use"]],
    ["USED_OR_PUBLISHED", ["feedback_submitted", "move_used"]],
    ["REQUEST_ANOTHER_SCAN", ["feedback_submitted", "repeat_scan_requested"]],
    ["NOT_RELEVANT", ["feedback_submitted"]],
  ])("maps %s only to exact launch events", async (kind, names) => {
    const response = await submit(kind);

    expect(response.status).toBe(201);
    expect(append.mock.calls.map(([event]) => event.name)).toEqual(names);
    expect(JSON.stringify(append.mock.calls)).not.toContain("private-token");
  });
});
