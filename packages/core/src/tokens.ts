import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

const TOKEN_PATTERN = /^scan_([A-Za-z0-9_-]{8,32})\.([A-Za-z0-9_-]{32,128})$/;

export type IssuedDeliveryToken = {
  rawToken: string;
  tokenPrefix: string;
  tokenHash: string;
};

export function hashOpaqueToken(rawToken: string): string {
  return `sha256:${createHash("sha256").update(rawToken, "utf8").digest("hex")}`;
}

export function verifyOpaqueToken(rawToken: string, encodedHash: string): boolean {
  const candidate = Buffer.from(hashOpaqueToken(rawToken), "utf8");
  const expected = Buffer.from(encodedHash, "utf8");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export function createDeliveryToken(): IssuedDeliveryToken {
  const tokenPrefix = randomBytes(6).toString("base64url");
  const rawToken = `scan_${tokenPrefix}.${randomBytes(32).toString("base64url")}`;
  return {
    rawToken,
    tokenPrefix,
    tokenHash: hashOpaqueToken(rawToken),
  };
}

/** Public scan status URLs are bearer capabilities and use a 256-bit secret. */
export function createPublicScanToken(): string {
  return `scan_${randomBytes(32).toString("base64url")}`;
}

export function parseDeliveryToken(rawToken: string): { tokenPrefix: string } | null {
  const match = TOKEN_PATTERN.exec(rawToken);
  return match?.[1] ? { tokenPrefix: match[1] } : null;
}

export function createPrefixedId(prefix: string): string {
  if (!/^[a-z][a-z0-9_]{1,20}$/.test(prefix)) {
    throw new Error("ID prefix must be lowercase alphanumeric snake case");
  }
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}
