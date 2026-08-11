import { describe, expect, it } from "vitest";
import { anonymizeAddress, normalizePublicSubmission } from "../../lib/request-security";

describe("public request boundary", () => {
  it("normalizes an ordinary public URL and removes fragments", () => {
    expect(normalizePublicSubmission(" HTTPS://Example.com/path/#private ")).toBe(
      "https://example.com/path/",
    );
  });

  it("rejects credentials, non-http schemes, localhost and obvious metadata hosts", () => {
    for (const value of [
      "file:///etc/passwd",
      "http://user:password@example.com",
      "http://localhost:3000",
      "http://127.0.0.1",
      "http://169.254.169.254/latest/meta-data",
    ]) {
      expect(() => normalizePublicSubmission(value)).toThrow();
    }
  });

  it("stores a stable keyed address hash instead of the raw address", () => {
    const hash = anonymizeAddress("203.0.113.10", "pepper-pepper-pepper-pepper-pepper");
    expect(hash).toHaveLength(64);
    expect(hash).not.toContain("203.0.113.10");
  });
});
