import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

import type { ApiKeyEnvironment } from "@trendsfast/schemas";

const API_KEY_PATTERN = /^tf_(test|live)_([A-Za-z0-9_-]{8,32})\.([A-Za-z0-9_-]{32,128})$/;
const SCRYPT_COST = 16_384;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELISM = 1;
const HASH_LENGTH = 32;

const encode = (bytes: number) => randomBytes(bytes).toString("base64url");

export type ParsedApiKey = {
  environment: ApiKeyEnvironment;
  prefix: string;
  secret: string;
};

export type IssuedApiKey = ParsedApiKey & {
  rawKey: string;
  secretHash: string;
};

export function parseApiKey(rawKey: string): ParsedApiKey | null {
  const match = API_KEY_PATTERN.exec(rawKey);
  if (!match?.[1] || !match[2] || !match[3]) return null;

  return {
    environment: match[1] as ApiKeyEnvironment,
    prefix: match[2],
    secret: match[3],
  };
}

const withPepper = (secret: string, pepper?: string) =>
  pepper ? `${secret}\u0000${pepper}` : secret;

export async function hashApiKeySecret(secret: string, pepper?: string): Promise<string> {
  if (secret.length < 32) throw new Error("API key secret is too short");

  const salt = encode(16);
  const digest = scryptSync(withPepper(secret, pepper), salt, HASH_LENGTH, {
    N: SCRYPT_COST,
    r: SCRYPT_BLOCK_SIZE,
    p: SCRYPT_PARALLELISM,
    maxmem: 64 * 1024 * 1024,
  });

  return [
    "scrypt",
    SCRYPT_COST,
    SCRYPT_BLOCK_SIZE,
    SCRYPT_PARALLELISM,
    salt,
    digest.toString("base64url"),
  ].join("$");
}

export async function verifyApiKeySecret(
  candidate: string,
  encodedHash: string,
  pepper?: string,
): Promise<boolean> {
  try {
    const [algorithm, cost, blockSize, parallelism, salt, expected] = encodedHash.split("$");
    if (algorithm !== "scrypt" || !cost || !blockSize || !parallelism || !salt || !expected) {
      return false;
    }

    const expectedBuffer = Buffer.from(expected, "base64url");
    if (expectedBuffer.length !== HASH_LENGTH) return false;

    const candidateBuffer = scryptSync(withPepper(candidate, pepper), salt, expectedBuffer.length, {
      N: Number(cost),
      r: Number(blockSize),
      p: Number(parallelism),
      maxmem: 64 * 1024 * 1024,
    });

    return timingSafeEqual(candidateBuffer, expectedBuffer);
  } catch {
    return false;
  }
}

export async function createApiKey(
  environment: ApiKeyEnvironment,
  pepper?: string,
): Promise<IssuedApiKey> {
  const prefix = encode(6);
  const secret = encode(32);
  const rawKey = `tf_${environment}_${prefix}.${secret}`;
  const secretHash = await hashApiKeySecret(secret, pepper);

  return { environment, prefix, secret, rawKey, secretHash };
}

export async function verifyApiKey(
  rawKey: string,
  encodedHash: string,
  pepper?: string,
): Promise<boolean> {
  const parsed = parseApiKey(rawKey);
  if (!parsed) return false;
  return verifyApiKeySecret(parsed.secret, encodedHash, pepper);
}
