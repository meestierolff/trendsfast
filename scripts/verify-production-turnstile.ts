import { spawnSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseProductionInventory } from "./staged-production-env";

export const TURNSTILE_SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
export const TURNSTILE_PREFLIGHT_TIMEOUT_MS = 10_000;

const INVALID_PREFLIGHT_TOKEN = "trendsfast-production-preflight-intentionally-invalid-v1";
const MAX_RESPONSE_BYTES = 8 * 1024;
const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const inventoryName = ".env.production.local";
const defaultInventoryPath = resolve(repositoryRoot, inventoryName);

const KNOWN_ERROR_CODES = new Set([
  "missing-input-secret",
  "invalid-input-secret",
  "missing-input-response",
  "invalid-input-response",
  "bad-request",
  "timeout-or-duplicate",
  "internal-error",
]);

export class TurnstileProductionPreflightError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TurnstileProductionPreflightError";
  }
}

export interface TurnstilePreflightResult {
  readonly httpStatus: number;
  readonly errorCodes: readonly string[];
  readonly secretRecognized: true;
  readonly invalidTokenRejected: true;
}

export type TurnstilePreflightFetcher = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

interface VerifyOptions {
  readonly fetcher?: TurnstilePreflightFetcher;
  readonly timeoutMs?: number;
}

interface RunOptions extends VerifyOptions {
  readonly inventoryPath?: string;
  readonly isIgnored?: (path: string) => boolean;
  readonly output?: (message: string) => void;
}

function fail(message: string): never {
  throw new TurnstileProductionPreflightError(message);
}

function sanitizeErrorCodes(value: unknown): readonly string[] {
  if (!Array.isArray(value) || !value.every((code) => typeof code === "string")) {
    fail("Turnstile siteverify returned malformed error-code semantics");
  }
  return value.map((code) => (KNOWN_ERROR_CODES.has(code) ? code : "unknown-code"));
}

function sanitizedCodes(codes: readonly string[]): string {
  return codes.length > 0 ? [...new Set(codes)].sort().join(",") : "none";
}

async function readBoundedBody(response: Response): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let byteCount = 0;
  let body = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    byteCount += value.byteLength;
    if (byteCount > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      fail("Turnstile siteverify returned an oversized response");
    }
    body += decoder.decode(value, { stream: true });
  }
  return body + decoder.decode();
}

function parseSiteverifyResponse(body: string): {
  readonly success: boolean;
  readonly errorCodes: readonly string[];
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    fail("Turnstile siteverify returned malformed JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    fail("Turnstile siteverify returned malformed response semantics");
  }
  const record = parsed as Record<string, unknown>;
  if (typeof record.success !== "boolean") {
    fail("Turnstile siteverify returned malformed success semantics");
  }
  return {
    success: record.success,
    errorCodes: sanitizeErrorCodes(record["error-codes"]),
  };
}

/**
 * Submit a known-invalid token. A passing response proves that Cloudflare accepts
 * the configured secret while still rejecting the token; it can never prove a
 * widget hostname association, and it performs no Cloudflare mutation.
 */
export async function verifyProductionTurnstileSecret(
  secret: string,
  options: VerifyOptions = {},
): Promise<TurnstilePreflightResult> {
  if (!secret.trim()) fail("TURNSTILE_SECRET_KEY is missing from the production inventory");
  const timeoutMs = options.timeoutMs ?? TURNSTILE_PREFLIGHT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
    fail("Turnstile preflight timeout must be between 1 and 30000 milliseconds");
  }

  const signal = AbortSignal.timeout(timeoutMs);
  let response: Response;
  try {
    response = await (options.fetcher ?? fetch)(TURNSTILE_SITEVERIFY_URL, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "user-agent": "TrendsFast Turnstile production preflight/1.0",
      },
      body: new URLSearchParams({ secret, response: INVALID_PREFLIGHT_TOKEN }),
      redirect: "error",
      signal,
    });
  } catch (error) {
    if (signal.aborted || (error instanceof Error && error.name === "AbortError")) {
      fail("Turnstile siteverify request timed out or was aborted");
    }
    fail("Turnstile siteverify transport failed; details withheld");
  }

  let body: string;
  try {
    body = await readBoundedBody(response);
  } catch (error) {
    if (error instanceof TurnstileProductionPreflightError) throw error;
    if (signal.aborted || (error instanceof Error && error.name === "AbortError")) {
      fail("Turnstile siteverify request timed out or was aborted");
    }
    fail("Turnstile siteverify response read failed; details withheld");
  }
  const parsed = parseSiteverifyResponse(body);
  const codes = parsed.errorCodes;
  const codeSummary = sanitizedCodes(codes);

  if (codes.includes("invalid-input-secret") || codes.includes("missing-input-secret")) {
    fail(
      `Turnstile rejected the production secret (http=${response.status}; errors=${codeSummary})`,
    );
  }
  if (response.status !== 200 || !response.ok) {
    fail(
      `Turnstile siteverify HTTP semantics failed (http=${response.status}; errors=${codeSummary})`,
    );
  }
  if (parsed.success) {
    fail("Turnstile unexpectedly accepted the deliberately invalid preflight token");
  }
  if (
    !codes.includes("invalid-input-response") ||
    codes.some((code) => code !== "invalid-input-response")
  ) {
    fail(
      `Turnstile did not prove invalid-token rejection (http=${response.status}; errors=${codeSummary})`,
    );
  }

  return {
    httpStatus: response.status,
    errorCodes: codes,
    secretRecognized: true,
    invalidTokenRejected: true,
  };
}

function defaultIgnoredCheck(path: string): boolean {
  const result = spawnSync("git", ["check-ignore", "-q", "--", path], {
    cwd: repositoryRoot,
    stdio: "ignore",
  });
  return result.status === 0;
}

export function readProductionTurnstileSecret(
  path = defaultInventoryPath,
  isIgnored: (candidate: string) => boolean = defaultIgnoredCheck,
): string {
  let metadata;
  try {
    metadata = lstatSync(path);
  } catch {
    fail("The production inventory is unavailable");
  }
  if (metadata.isSymbolicLink() || !metadata.isFile() || (metadata.mode & 0o777) !== 0o600) {
    fail("The production inventory must be a regular mode-0600 file");
  }
  if (!isIgnored(path)) fail("The production inventory must remain ignored by Git");

  let inventory: ReturnType<typeof parseProductionInventory>;
  try {
    inventory = parseProductionInventory(readFileSync(path, "utf8"));
  } catch {
    fail("The production inventory could not be parsed safely");
  }
  const secret = inventory.values.TURNSTILE_SECRET_KEY;
  if (!secret?.trim()) fail("TURNSTILE_SECRET_KEY is missing from the production inventory");
  return secret;
}

export async function runProductionTurnstilePreflight(options: RunOptions = {}): Promise<void> {
  const secret = readProductionTurnstileSecret(
    options.inventoryPath,
    options.isIgnored ?? defaultIgnoredCheck,
  );
  const result = await verifyProductionTurnstileSecret(secret, options);
  (options.output ?? console.info)(
    `Turnstile production preflight passed: secret=recognized; token=rejected; http=${result.httpStatus}; errors=${sanitizedCodes(result.errorCodes)}`,
  );
}

export function reportTurnstilePreflightError(
  error: unknown,
  output: (message: string) => void = console.error,
): void {
  output(
    error instanceof TurnstileProductionPreflightError
      ? error.message
      : "Turnstile production preflight failed; details withheld",
  );
}

async function main(): Promise<void> {
  if (process.argv.length > 2) fail("The Turnstile production preflight accepts no arguments");
  await runProductionTurnstilePreflight();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    reportTurnstilePreflightError(error);
    process.exitCode = 1;
  }
}
