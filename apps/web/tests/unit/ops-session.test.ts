import { describe, expect, it } from "vitest";
import {
  createCsrfToken,
  issueOpsSession,
  verifyCsrfToken,
  verifyOpsSession,
} from "../../lib/ops-session";

const secret = "a-secret-long-enough-for-tests-1234567890";

describe("temporary founder session", () => {
  it("validates an untampered, unexpired token", () => {
    const token = issueOpsSession({ secret, now: new Date("2026-08-11T08:00:00.000Z") });
    expect(
      verifyOpsSession(token, { secret, now: new Date("2026-08-11T09:00:00.000Z") }),
    ).not.toBeNull();
  });

  it("rejects tampering and expiry", () => {
    const token = issueOpsSession({
      secret,
      now: new Date("2026-08-11T08:00:00.000Z"),
      ttlSeconds: 60,
    });
    expect(
      verifyOpsSession(`${token}x`, { secret, now: new Date("2026-08-11T08:00:10.000Z") }),
    ).toBeNull();
    expect(
      verifyOpsSession(token, { secret, now: new Date("2026-08-11T08:02:00.000Z") }),
    ).toBeNull();
  });

  it("binds CSRF tokens to an authenticated session", () => {
    const session = issueOpsSession({ secret });
    const csrf = createCsrfToken(session, secret);
    expect(verifyCsrfToken(session, csrf, secret)).toBe(true);
    expect(verifyCsrfToken(`${session}x`, csrf, secret)).toBe(false);
  });
});
