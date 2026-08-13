import { describe, expect, it } from "vitest";

import { reconcileDashboardKeys } from "../../lib/dashboard-api-key-state";

const old = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Codex",
  visiblePrefix: "old-prefix",
  scopes: ["next_move:read", "next_move:write"],
  environment: "live" as const,
  status: "ACTIVE" as const,
  createdAt: "2026-08-13T07:00:00.000Z",
  lastUsedAt: null,
  expiresAt: "2026-09-13T07:00:00.000Z",
  revokedAt: null,
};

describe("dashboard API-key replacement state", () => {
  it("shows the replacement and immediately marks the replaced key inactive", () => {
    const replacement = {
      ...old,
      id: "22222222-2222-4222-8222-222222222222",
      visiblePrefix: "new-prefix",
    };
    expect(
      reconcileDashboardKeys([old], {
        key: replacement,
        replacedKey: { id: old.id, status: "REVOKED" },
      }),
    ).toEqual([replacement, { ...old, status: "REVOKED" }]);
  });
});
