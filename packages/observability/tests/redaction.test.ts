import { describe, expect, it } from "vitest";
import { createLogger, redact } from "../src/index";

describe("secret redaction", () => {
  it("redacts keys, bearer credentials, urls with userinfo and nested secret fields", () => {
    const output = redact({
      authorization: "Bearer tf_live_prefix.supersecret",
      api_key: "provider-secret",
      nested: { password: "hunter2", safe: "visible" },
      database: "postgresql://user:password@host/db",
    });

    expect(JSON.stringify(output)).not.toContain("supersecret");
    expect(JSON.stringify(output)).not.toContain("provider-secret");
    expect(JSON.stringify(output)).not.toContain("hunter2");
    expect(JSON.stringify(output)).not.toContain("user:password");
    expect(output).toMatchObject({ nested: { safe: "visible" } });
  });

  it("redacts adversarial repeated database prefixes without regex backtracking", () => {
    const repeated = "postgres://".repeat(100_000);
    const output = redact(`${repeated}user:password@host/db`);
    const noCredential = redact(repeated);

    expect(String(output)).not.toContain("user:password");
    expect(String(output)).toContain("[REDACTED]@host/db");
    expect(noCredential).toBe(repeated);
  });

  it("keeps useful Error fields while redacting credentials from logs", () => {
    const lines: string[] = [];
    const logger = createLogger({
      sink: {
        info: () => undefined,
        warn: () => undefined,
        error: (line) => lines.push(String(line)),
      },
    });

    logger.error(
      "provider_failed",
      new Error("Upstream rejected Bearer tf_live_prefix.supersecret"),
      { source: "x" },
    );

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('"name":"Error"');
    expect(lines[0]).toContain("Upstream rejected [REDACTED]");
    expect(lines[0]).not.toContain("supersecret");
  });

  it("never forwards the original secret-bearing exception to an external reporter", () => {
    const captured: Array<{ error: unknown; context?: Record<string, unknown> }> = [];
    const logger = createLogger({
      sink: { info: () => undefined, warn: () => undefined, error: () => undefined },
      reporter: {
        captureException: (error, context) =>
          captured.push({ error, ...(context === undefined ? {} : { context }) }),
      },
    });
    const error = Object.assign(
      new Error("Provider rejected Bearer tf_live_prefix.external-secret"),
      { apiKey: "provider-api-key-secret" },
    );

    logger.error("provider_failed", error, {
      authorization: "Bearer another-secret-token-value",
      source: "x",
    });

    expect(captured).toHaveLength(1);
    expect(captured[0]?.error).not.toBe(error);
    expect(captured[0]).toMatchObject({
      error: { name: "Error", apiKey: "[REDACTED]" },
      context: { authorization: "[REDACTED]", source: "x" },
    });
    expect(JSON.stringify(captured)).not.toContain("external-secret");
    expect(JSON.stringify(captured)).not.toContain("provider-api-key-secret");
    expect(JSON.stringify(captured)).not.toContain("another-secret-token-value");
  });
});
