import { createHmac } from "node:crypto";

const DENIED_HOSTS = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
  "metadata.google.internal.",
]);

function obviousPrivateIp(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (normalized === "::1" || normalized === "::" || normalized.startsWith("fe80:")) return true;
  const parts = normalized.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255))
    return false;
  const [a = 0, b = 0] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

export function normalizePublicSubmission(value: unknown): string {
  if (typeof value !== "string" || value.length > 2048)
    throw new Error("Enter a valid public product URL.");
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("Enter a complete URL beginning with https:// or http://.");
  }
  if (!["https:", "http:"].includes(url.protocol))
    throw new Error("Only public HTTP and HTTPS URLs are supported.");
  if (url.username || url.password)
    throw new Error("URLs containing credentials are not accepted.");
  const hostname = url.hostname.toLowerCase();
  if (DENIED_HOSTS.has(hostname) || hostname.endsWith(".localhost") || obviousPrivateIp(hostname)) {
    throw new Error("Private and local network addresses are not accepted.");
  }
  url.hash = "";
  url.username = "";
  url.password = "";
  return url.toString();
}

export function anonymizeAddress(address: string, pepper: string): string {
  return createHmac("sha256", pepper).update(address.trim()).digest("hex");
}

export function clientAddress(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip")?.trim() || "unknown";
}
