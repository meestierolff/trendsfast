import { describe, expect, it } from "vitest";

import {
  createApiKey,
  createDeliveryToken,
  createPublicScanToken,
  digestNextMoveRequest,
  digestNextMoveRequestWithContext,
  hashOpaqueToken,
  parseApiKey,
  redactSecrets,
  verifyApiKey,
  verifyOpaqueToken,
} from "../src/index";

describe("API key handling", () => {
  it("generates the documented key shape and stores a one-way hash", async () => {
    const issued = await createApiKey("test");

    expect(issued.rawKey).toMatch(/^tf_test_[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{32,}$/);
    expect(issued.secretHash).not.toContain(issued.secret);
    expect(parseApiKey(issued.rawKey)).toMatchObject({
      environment: "test",
      prefix: issued.prefix,
    });
    await expect(verifyApiKey(issued.rawKey, issued.secretHash)).resolves.toBe(true);
    await expect(verifyApiKey(`${issued.rawKey}tampered`, issued.secretHash)).resolves.toBe(false);
  });

  it("can bind managed hashes to a server-only pepper", async () => {
    const issued = await createApiKey("live", "managed-pepper".repeat(4));
    await expect(
      verifyApiKey(issued.rawKey, issued.secretHash, "managed-pepper".repeat(4)),
    ).resolves.toBe(true);
    await expect(verifyApiKey(issued.rawKey, issued.secretHash)).resolves.toBe(false);
  });

  it("hashes private delivery tokens and compares them safely", () => {
    const issued = createDeliveryToken();
    const digest = hashOpaqueToken(issued.rawToken);

    expect(digest).not.toContain(issued.rawToken);
    expect(verifyOpaqueToken(issued.rawToken, digest)).toBe(true);
    expect(verifyOpaqueToken(`${issued.rawToken}x`, digest)).toBe(false);
  });

  it("issues 256-bit public scan capabilities", () => {
    const token = createPublicScanToken();

    expect(token).toMatch(/^scan_[A-Za-z0-9_-]{43}$/);
    expect(createPublicScanToken()).not.toBe(token);
  });

  it("redacts provider, bearer, database, and TrendsFast credentials", () => {
    const value = redactSecrets(
      "Authorization: Bearer abc.def; tf_live_visible.supersecret; " +
        "postgresql://admin:password@localhost/db; XAI_API_KEY=xai-secret",
    );

    expect(value).not.toContain("supersecret");
    expect(value).not.toContain("password");
    expect(value).not.toContain("xai-secret");
    expect(value).toContain("[REDACTED]");
  });
});

describe("semantic API request digests", () => {
  it("is stable across immaterial URL representation and schema trimming", () => {
    const left = digestNextMoveRequest({
      product_url: "https://EXAMPLE.com:443/path?a=1&b=2#ignored",
      goal: " qualified_signups ",
      preferred_channels: ["x", " linkedin "],
      available_formats: ["screen_recording", "founder_text"],
    });
    const right = digestNextMoveRequest({
      product_url: "https://example.com/path?a=1&b=2",
      goal: "qualified_signups",
      preferred_channels: ["x", "linkedin"],
      available_formats: ["screen_recording", "founder_text"],
    });
    expect(left).toBe(right);
    expect(left).toMatch(/^next-move-request-v2:sha256:[a-f0-9]{64}$/);
  });

  it("changes when a material request field changes", () => {
    const base = digestNextMoveRequest({
      product_url: "https://example.com",
      goal: "qualified_signups",
    });
    expect(
      digestNextMoveRequest({
        product_url: "https://example.com",
        goal: "awareness",
      }),
    ).not.toBe(base);
  });

  it("canonicalizes legacy goal and new objective to the same request meaning", () => {
    expect(
      digestNextMoveRequest({
        product_url: "https://example.com",
        goal: "qualified_signups",
      }),
    ).toBe(
      digestNextMoveRequest({
        product_url: "https://example.com",
        objective: "qualified_signups",
      }),
    );
  });

  it("pins claimed-project idempotency to the accepted context version", () => {
    const request = { product_url: "https://example.com", objective: "Grow responsibly" };
    expect(digestNextMoveRequestWithContext(request, "context_v1")).not.toBe(
      digestNextMoveRequestWithContext(request, "context_v2"),
    );
    expect(digestNextMoveRequestWithContext(request)).toBe(digestNextMoveRequest(request));
  });

  it("preserves array and query ordering because either can carry request meaning", () => {
    const base = digestNextMoveRequest({
      product_url: "https://example.com/?a=1&b=2",
      preferred_channels: ["x", "linkedin"],
    });
    expect(
      digestNextMoveRequest({
        product_url: "https://example.com/?a=1&b=2",
        preferred_channels: ["linkedin", "x"],
      }),
    ).not.toBe(base);
    expect(
      digestNextMoveRequest({
        product_url: "https://example.com/?b=2&a=1",
        preferred_channels: ["x", "linkedin"],
      }),
    ).not.toBe(base);
  });
});
