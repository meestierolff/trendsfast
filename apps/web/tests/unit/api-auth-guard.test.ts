import { describe, expect, it } from "vitest";

import {
  apiKeyEnvironmentMatchesProviderMode,
  InProcessInvalidApiKeyLimiter,
  parseStrictBearerApiKey,
} from "../../lib/api-auth-guard";

const TEST_KEY = "tf_test_prefix12.abcdefghijklmnopqrstuvwxyz123456";

describe("API authentication guard", () => {
  it("accepts only a size-bounded canonical TrendsFast bearer key", () => {
    expect(parseStrictBearerApiKey(`Bearer ${TEST_KEY}`)).toBe(TEST_KEY);
    expect(parseStrictBearerApiKey("Basic abc")).toBeNull();
    expect(parseStrictBearerApiKey("Bearer tf_test_short.too-short")).toBeNull();
    expect(parseStrictBearerApiKey(`Bearer tf_test_prefix12.${"x".repeat(2_000)}`)).toBeNull();
  });

  it("maps test keys only to fixture processing and live keys only to live modes", () => {
    expect(apiKeyEnvironmentMatchesProviderMode("test", "fixture")).toBe(true);
    expect(apiKeyEnvironmentMatchesProviderMode("test", "managed")).toBe(false);
    expect(apiKeyEnvironmentMatchesProviderMode("test", "byok")).toBe(false);
    expect(apiKeyEnvironmentMatchesProviderMode("live", "fixture")).toBe(false);
    expect(apiKeyEnvironmentMatchesProviderMode("live", "managed")).toBe(true);
    expect(apiKeyEnvironmentMatchesProviderMode("live", "byok")).toBe(true);
  });

  it("releases successful/error work and expires invalid attempts after the sliding window", () => {
    const limiter = new InProcessInvalidApiKeyLimiter({
      maxInvalidAttempts: 1,
      windowMs: 1_000,
      maxFingerprints: 10,
    });
    const released = limiter.reserve("fingerprint", 0);
    expect(released).not.toBeNull();
    released?.release();
    expect(limiter.reserve("fingerprint", 0)).not.toBeNull();

    const invalidLimiter = new InProcessInvalidApiKeyLimiter({
      maxInvalidAttempts: 1,
      windowMs: 1_000,
      maxFingerprints: 10,
    });
    invalidLimiter.reserve("fingerprint", 0)?.markInvalid(0);
    expect(invalidLimiter.reserve("fingerprint", 999)).toBeNull();
    expect(invalidLimiter.reserve("fingerprint", 1_001)).not.toBeNull();
  });

  it("uses a shared overflow bucket to cap attacker-controlled fingerprint cardinality", () => {
    const limiter = new InProcessInvalidApiKeyLimiter({
      maxInvalidAttempts: 1,
      windowMs: 60_000,
      maxFingerprints: 2,
    });
    limiter.reserve("first", 0)?.markInvalid(0);
    limiter.reserve("second", 0)?.markInvalid(0);
    expect(limiter.reserve("third", 0)).toBeNull();
  });

  it("applies a process-wide invalid-attempt ceiling across rotating fingerprints", () => {
    const limiter = new InProcessInvalidApiKeyLimiter({
      maxInvalidAttempts: 2,
      maxGlobalInvalidAttempts: 3,
      windowMs: 60_000,
      maxFingerprints: 100,
    });
    limiter.reserve("first", 0)?.markInvalid(0);
    limiter.reserve("second", 0)?.markInvalid(0);
    limiter.reserve("third", 0)?.markInvalid(0);

    expect(limiter.reserve("fourth", 0)).toBeNull();
    expect(limiter.reserve("fourth", 60_001)).not.toBeNull();
  });
});
