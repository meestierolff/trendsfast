import { describe, expect, it } from "vitest";

import { resolveApiAuthOutcome } from "../src/index";

describe("API key expiry", () => {
  const now = new Date("2026-08-11T12:00:00.000Z");

  it("rejects an expired valid key while allowing a future expiry", () => {
    expect(resolveApiAuthOutcome({ status: "ACTIVE", expiresAt: new Date(now) }, true, now)).toBe(
      "EXPIRED",
    );
    expect(
      resolveApiAuthOutcome(
        { status: "ACTIVE", expiresAt: new Date("2026-08-11T12:00:01.000Z") },
        true,
        now,
      ),
    ).toBe("SUCCESS");
    expect(resolveApiAuthOutcome({ status: "ACTIVE", expiresAt: null }, true, now)).toBe("SUCCESS");
  });

  it("does not reveal expiry until the presented secret is valid", () => {
    const expired = { status: "ACTIVE" as const, expiresAt: new Date(now) };
    expect(resolveApiAuthOutcome(expired, false, now)).toBe("INVALID");
    expect(resolveApiAuthOutcome({ ...expired, status: "REVOKED" }, true, now)).toBe("REVOKED");
  });
});
