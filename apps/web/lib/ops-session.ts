import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

type OpsPayload = { expiresAt: number; nonce: string };

function sign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function issueOpsSession(input: {
  secret: string;
  now?: Date;
  ttlSeconds?: number;
}): string {
  const payload: OpsPayload = {
    expiresAt:
      Math.floor((input.now ?? new Date()).getTime() / 1000) + (input.ttlSeconds ?? 8 * 60 * 60),
    nonce: randomBytes(18).toString("base64url"),
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${sign(encoded, input.secret)}`;
}

export function verifyOpsSession(
  token: string | undefined,
  input: { secret: string; now?: Date },
): OpsPayload | null {
  if (!token) return null;
  const [encoded, signature, extra] = token.split(".");
  if (!encoded || !signature || extra || !safeEqual(signature, sign(encoded, input.secret)))
    return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as OpsPayload;
    if (!payload.nonce || !Number.isSafeInteger(payload.expiresAt)) return null;
    if (payload.expiresAt <= Math.floor((input.now ?? new Date()).getTime() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function createCsrfToken(sessionToken: string, secret: string): string {
  return sign(`csrf:${sessionToken}`, secret);
}

export function verifyCsrfToken(
  sessionToken: string,
  token: string | undefined,
  secret: string,
): boolean {
  return Boolean(token && safeEqual(token, createCsrfToken(sessionToken, secret)));
}
