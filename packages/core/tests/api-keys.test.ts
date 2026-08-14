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

  it("redacts operational secrets embedded as raw environment assignments", () => {
    const secrets = {
      API_KEY_PEPPER: "pepper must not escape",
      CRON_SECRET: "cron must not escape",
      OPS_ALERT_WEBHOOK_SECRET: "webhook-must-not-escape",
      TURNSTILE_SECRET_KEY: "turnstile-must-not-escape",
    } as const;
    const value = redactSecrets(
      `API_KEY_PEPPER="${secrets.API_KEY_PEPPER}"; ` +
        `CRON_SECRET='${secrets.CRON_SECRET}'; ` +
        `OPS_ALERT_WEBHOOK_SECRET=${secrets.OPS_ALERT_WEBHOOK_SECRET}; ` +
        `TURNSTILE_SECRET_KEY=${secrets.TURNSTILE_SECRET_KEY}`,
    );

    for (const [name, secret] of Object.entries(secrets)) {
      expect(value).toContain(`${name}=[REDACTED]`);
      expect(value).not.toContain(secret);
    }
  });

  it("redacts structured credential assignments and keeps their surrounding shape", () => {
    const value = redactSecrets(
      '{"api_key":"json-provider-canary","password":"json-password-canary",' +
        '"authorization":"Basic json-auth-canary",' +
        '"safe":"visible"}; api-key: colon-canary; apiKey=assignment-canary; ' +
        "XAI_API_KEY: 'provider-colon-canary'",
    );

    expect(value).toContain('"api_key":"[REDACTED]"');
    expect(value).toContain('"password":"[REDACTED]"');
    expect(value).toContain('"authorization":"[REDACTED]"');
    expect(value).toContain('"safe":"visible"');
    expect(value).toContain("api-key: [REDACTED]");
    expect(value).toContain("apiKey=[REDACTED]");
    expect(value).toContain("XAI_API_KEY: '[REDACTED]'");
    expect(value).not.toMatch(
      /(?:json-provider|json-password|json-auth|colon|assignment|provider-colon)-canary/,
    );
  });

  it("redacts encoded database passwords and bounded URL query credentials", () => {
    const value = redactSecrets(
      "postgresql://runtime:p%40ss%3Aword-canary@db.example.test/app; " +
        "https://one.example.test/path?api_key=query-canary&safe=visible; " +
        "https://two.example.test/path?api%5Fkey=encoded-name-canary&safe=visible; " +
        "https://three.example.test/path?token=%65ncoded-value-canary&page=2; " +
        "https://four.example.test/path?token=%5BREDACTED%5D&safe=visible",
    );

    expect(value).toContain("postgresql://runtime:[REDACTED]@db.example.test/app");
    expect(value).toContain("?api_key=[REDACTED]&safe=visible");
    expect(value).toContain("?api%5Fkey=[REDACTED]&safe=visible");
    expect(value).toContain("?token=[REDACTED]&page=2");
    expect(value).toContain("?token=%5BREDACTED%5D&safe=visible");
    expect(value).not.toMatch(/p%40ss|query-canary|encoded-name-canary|%65ncoded-value-canary/);
  });

  it("redacts recognizable long provider credentials without relying on a field name", () => {
    const credentials = [
      `sk-proj-${"O".repeat(24)}`,
      `xai-${"X".repeat(24)}`,
      `tvly-${"T".repeat(24)}`,
      `ghp_${"G".repeat(36)}`,
      `github_pat_${"H".repeat(40)}`,
      `AIza${"I".repeat(35)}`,
      ["sk", "live", "S".repeat(24)].join("_"),
      `whsec_${"W".repeat(24)}`,
      `sb_secret_${"B".repeat(24)}`,
      `glpat-${"L".repeat(24)}`,
      `xoxb-${"Q".repeat(24)}`,
    ];
    const value = redactSecrets(credentials.join(" "));

    expect(value.match(/\[REDACTED_CREDENTIAL\]/g)).toHaveLength(credentials.length);
    for (const credential of credentials) expect(value).not.toContain(credential);
  });

  it("does not treat ordinary credential prose or short product labels as secrets", () => {
    const prose =
      "Keep the API key after testing; password length is 32; token budget; secret sauce; " +
      '"description":"password reset token and secret storage"; ' +
      "sk-short xai-model tvly-demo github_pat_short AIzaExample; " +
      "https://example.test/?token_budget=10&api_key_hint=documentation";

    expect(redactSecrets(prose)).toBe(prose);
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
