import { chmodSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  TURNSTILE_SITEVERIFY_URL,
  TurnstileProductionPreflightError,
  readProductionTurnstileSecret,
  reportTurnstilePreflightError,
  runProductionTurnstilePreflight,
  verifyProductionTurnstileSecret,
} from "../../../scripts/verify-production-turnstile";

const SECRET = "production-turnstile-secret-that-must-never-be-printed";

function siteverifyResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function privateInventory(mode = 0o600): string {
  const directory = mkdtempSync(join(tmpdir(), "tf-turnstile-test-"));
  const path = join(directory, ".env.production.local");
  writeFileSync(path, `TURNSTILE_SECRET_KEY=${JSON.stringify(SECRET)}\n`, { mode: 0o600 });
  chmodSync(path, mode);
  return path;
}

describe("production Turnstile credential preflight", () => {
  it("passes only when a recognized secret rejects the deliberately invalid token", async () => {
    let capturedUrl: string | URL | undefined;
    let capturedRequest: RequestInit | undefined;
    const fetcher = vi.fn(async (input: string | URL, init?: RequestInit) => {
      capturedUrl = input;
      capturedRequest = init;
      return siteverifyResponse({ success: false, "error-codes": ["invalid-input-response"] });
    });

    await expect(verifyProductionTurnstileSecret(SECRET, { fetcher })).resolves.toEqual({
      httpStatus: 200,
      errorCodes: ["invalid-input-response"],
      secretRecognized: true,
      invalidTokenRejected: true,
    });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(capturedUrl).toBe(TURNSTILE_SITEVERIFY_URL);
    expect(capturedRequest).toMatchObject({ method: "POST", redirect: "error" });
    const body = String(capturedRequest?.body);
    expect(body).toContain(`secret=${encodeURIComponent(SECRET)}`);
    expect(body).toContain("response=trendsfast-production-preflight-intentionally-invalid-v1");
  });

  it("fails closed when Cloudflare rejects the production secret", async () => {
    const fetcher = vi.fn(async () =>
      siteverifyResponse({
        success: false,
        "error-codes": ["invalid-input-secret", "invalid-input-response"],
      }),
    );

    await expect(verifyProductionTurnstileSecret(SECRET, { fetcher })).rejects.toThrow(
      "Turnstile rejected the production secret",
    );
  });

  it("fails closed on malformed, non-rejecting, and ambiguous responses", async () => {
    await expect(
      verifyProductionTurnstileSecret(SECRET, {
        fetcher: async () => new Response("not-json", { status: 200 }),
      }),
    ).rejects.toThrow("malformed JSON");
    await expect(
      verifyProductionTurnstileSecret(SECRET, {
        fetcher: async () => siteverifyResponse({ success: true, "error-codes": [] }),
      }),
    ).rejects.toThrow("unexpectedly accepted");
    await expect(
      verifyProductionTurnstileSecret(SECRET, {
        fetcher: async () => siteverifyResponse({ success: false, "error-codes": ["bad-request"] }),
      }),
    ).rejects.toThrow("did not prove invalid-token rejection");
    await expect(
      verifyProductionTurnstileSecret(SECRET, {
        fetcher: async () =>
          siteverifyResponse({
            success: false,
            "error-codes": ["invalid-input-response", `unknown-${SECRET}`],
          }),
      }),
    ).rejects.toThrow("errors=invalid-input-response,unknown-code");
  });

  it("distinguishes sanitized transport and timeout failures", async () => {
    const leakedTransport = new Error(`transport leaked ${SECRET}`);
    await expect(
      verifyProductionTurnstileSecret(SECRET, {
        fetcher: async () => {
          throw leakedTransport;
        },
      }),
    ).rejects.toThrow("transport failed; details withheld");
    await expect(
      verifyProductionTurnstileSecret(SECRET, {
        fetcher: async () => {
          throw new DOMException(`timeout leaked ${SECRET}`, "AbortError");
        },
      }),
    ).rejects.toThrow("timed out or was aborted");
  });

  it("reads only an ignored regular mode-0600 inventory as inert data", () => {
    const path = privateInventory();
    expect(readProductionTurnstileSecret(path, () => true)).toBe(SECRET);
    expect(() => readProductionTurnstileSecret(path, () => false)).toThrow("remain ignored");
    expect(() => readProductionTurnstileSecret(privateInventory(0o640), () => true)).toThrow(
      "regular mode-0600 file",
    );
    const symlinkPath = join(mkdtempSync(join(tmpdir(), "tf-turnstile-link-")), "inventory.env");
    symlinkSync(path, symlinkPath);
    expect(() => readProductionTurnstileSecret(symlinkPath, () => true)).toThrow(
      "regular mode-0600 file",
    );
  });

  it("never includes the secret in success or failure output", async () => {
    const path = privateInventory();
    const stdout: string[] = [];
    await runProductionTurnstilePreflight({
      inventoryPath: path,
      isIgnored: () => true,
      fetcher: async () =>
        siteverifyResponse({ success: false, "error-codes": ["invalid-input-response"] }),
      output: (message) => stdout.push(message),
    });
    expect(stdout.join("\n")).toContain("secret=recognized; token=rejected");
    expect(stdout.join("\n")).not.toContain(SECRET);

    const stderr: string[] = [];
    reportTurnstilePreflightError(
      new TurnstileProductionPreflightError(
        "Turnstile siteverify transport failed; details withheld",
      ),
      (message) => stderr.push(message),
    );
    reportTurnstilePreflightError(new Error(`unexpected leaked ${SECRET}`), (message) =>
      stderr.push(message),
    );
    expect(stderr.join("\n")).not.toContain(SECRET);
  });
});
