import { describe, expect, it, vi } from "vitest";

import {
  acceptFounderLaunchInterest,
  normalizeLaunchInterestEmail,
  parseFounderLaunchInterestBody,
} from "../../lib/founder-launch-interest";

const secret = "founder-launch-interest-test-secret-at-least-32-characters";

describe("founder launch interest", () => {
  it("accepts only explicit consent, a bounded email, an allowlisted source, and an empty trap", () => {
    expect(
      parseFounderLaunchInterestBody({
        email: " Founder@Example.com ",
        consent: true,
        source: "pricing",
        website: "",
      }),
    ).toEqual({
      email: "Founder@Example.com",
      consent: true,
      source: "pricing",
      website: "",
    });
    expect(
      parseFounderLaunchInterestBody({
        email: "founder@example.com",
        consent: false,
        source: "pricing",
        website: "",
      }),
    ).toBeNull();
    expect(
      parseFounderLaunchInterestBody({
        email: "founder@example.com",
        consent: true,
        source: "pricing",
        website: "",
        product: "secret product data",
      }),
    ).toBeNull();
  });

  it("normalizes case for durable dedupe while retaining no extra PII", () => {
    expect(normalizeLaunchInterestEmail(" Founder@Example.COM ")).toBe("founder@example.com");
    expect(() => normalizeLaunchInterestEmail("not-an-email")).toThrow();
  });

  it("returns no email and passes the privacy-safe session identity to the atomic writer", async () => {
    const create = vi.fn().mockResolvedValue({
      id: "00000000-0000-4000-8000-000000000014",
      created: true,
    });
    const result = await acceptFounderLaunchInterest(
      {
        email: "Founder@Example.com",
        source: "pricing",
        anonymousSessionHash: "a".repeat(64),
      },
      {
        secret,
        interests: { create },
        now: new Date("2026-08-11T12:00:00.000Z"),
      },
    );

    expect(result).toEqual({ joined: true });
    expect(JSON.stringify(result)).not.toContain("Founder@Example.com");
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        normalizedEmail: "founder@example.com",
        emailHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        consentVersion: "founder-launch-v1",
        expiresAt: new Date("2027-02-07T12:00:00.000Z"),
        anonymousSessionHash: "a".repeat(64),
      }),
    );
  });

  it("returns the same safe response when the atomic writer reconsents an address", async () => {
    const create = vi.fn().mockResolvedValue({
      id: "00000000-0000-4000-8000-000000000014",
      created: false,
    });
    const result = await acceptFounderLaunchInterest(
      {
        email: "founder@example.com",
        source: "homepage",
        anonymousSessionHash: "b".repeat(64),
      },
      {
        secret,
        interests: { create },
        now: new Date("2026-08-11T12:00:00.000Z"),
      },
    );

    expect(result).toEqual({ joined: true });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ anonymousSessionHash: "b".repeat(64) }),
    );
  });
});
