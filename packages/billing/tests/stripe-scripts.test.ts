import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const scripts = [
  "bootstrap-sandbox.sh",
  "verify-sandbox.sh",
  "test-webhook.sh",
  "bootstrap-live.sh",
  "verify-live.sh",
] as const;

function source(name: (typeof scripts)[number] | "_catalog.sh") {
  return readFileSync(resolve(root, "scripts/stripe", name), "utf8");
}

describe("Stripe operator scripts", () => {
  it("exposes the required executable command surface and removes legacy helpers", () => {
    const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(packageJson.scripts).toMatchObject({
      "stripe:bootstrap-sandbox": "./scripts/stripe/bootstrap-sandbox.sh",
      "stripe:verify-sandbox": "./scripts/stripe/verify-sandbox.sh",
      "stripe:test-webhook": "./scripts/stripe/test-webhook.sh",
      "stripe:bootstrap-live": "./scripts/stripe/bootstrap-live.sh",
      "stripe:verify-live": "./scripts/stripe/verify-live.sh",
    });
    for (const script of scripts) {
      expect(statSync(resolve(root, "scripts/stripe", script)).mode & 0o111).not.toBe(0);
    }
    expect(existsSync(resolve(root, "scripts/stripe/bootstrap-test.sh"))).toBe(false);
    expect(existsSync(resolve(root, "scripts/stripe/verify-test-config.sh"))).toBe(false);
  });

  it("fails closed until the compromised sandbox credential is confirmed rotated", () => {
    expect(source("_catalog.sh")).toContain("STRIPE_SANDBOX_KEY_ROTATED");
    for (const script of [
      "bootstrap-sandbox.sh",
      "verify-sandbox.sh",
      "test-webhook.sh",
    ] as const) {
      expect(source(script)).toContain("require_sandbox_key_rotated");
      expect(source(script)).toContain("require_cli_identity");
    }
  });

  it("requires both explicit catalog acknowledgements before any live catalog operation", () => {
    for (const script of ["bootstrap-live.sh", "verify-live.sh"] as const) {
      expect(source(script)).toContain('I_UNDERSTAND_LIVE_STRIPE:-}" != "YES"');
      expect(source(script)).toContain('STRIPE_LIVE_CATALOG_APPROVED:-}" != "YES"');
      expect(source(script).indexOf("I_UNDERSTAND_LIVE_STRIPE")).toBeLessThan(
        source(script).indexOf("require_cli_identity"),
      );
    }
  });

  it("uses one forwarding listener and captures only that listener's redacted secret", () => {
    const webhook = source("test-webhook.sh");
    expect(webhook.match(/\bstripe listen\b/g)).toHaveLength(1);
    expect(webhook).not.toContain("--print-secret");
    expect(webhook).toContain('flag: "wx"');
    expect(webhook).toContain("[REDACTED_WEBHOOK_SECRET]");
    expect(webhook).toContain('git -C "$script_dir" rev-parse --show-toplevel');
    expect(webhook).toContain('canonical_parent="$(cd "$target_parent" && pwd -P)"');
    expect(webhook).not.toContain('"$PWD"/*');
    expect(webhook).toContain("checkout.session.completed");
    expect(webhook).toContain("invoice.payment_failed");
  });

  it("rejects repository targets even when invoked elsewhere or reached through a symlink", () => {
    const temporary = mkdtempSync(resolve(tmpdir(), "trendsfast-stripe-script-"));
    try {
      const fakeBin = resolve(temporary, "bin");
      const fakeStripe = resolve(fakeBin, "stripe");
      const repositoryLink = resolve(temporary, "repository-link");
      mkdirSync(fakeBin);
      writeFileSync(fakeStripe, "#!/usr/bin/env bash\nexit 0\n", { mode: 0o700 });
      chmodSync(fakeStripe, 0o700);
      symlinkSync(root, repositoryLink, "dir");
      for (const target of [
        resolve(root, ".forbidden-webhook-secret"),
        resolve(repositoryLink, ".forbidden-webhook-secret"),
      ]) {
        const result = spawnSync("bash", [resolve(root, "scripts/stripe/test-webhook.sh")], {
          cwd: resolve(root, "scripts/stripe"),
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
            STRIPE_SANDBOX_KEY_ROTATED: "YES",
            STRIPE_WEBHOOK_SECRET_FILE: target,
          },
        });
        expect(result.status).toBe(1);
        expect(result.stderr).toContain("must be outside the repository");
        expect(existsSync(target)).toBe(false);
      }
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  });

  it("pins the API version and creates only the stable Product and Price catalog", () => {
    const catalog = source("_catalog.sh");
    const bootstraps = `${source("bootstrap-sandbox.sh")}\n${source("bootstrap-live.sh")}`;
    expect(catalog).toContain('stripe_api_version="2026-07-29.dahlia"');
    expect(catalog).toContain('lookup_key="trendsfast_founder_monthly_eur"');
    expect(catalog).toContain('price?.currency !== "eur"');
    expect(catalog).toContain('price?.tax_behavior !== "exclusive"');
    expect(bootstraps).toContain("--currency=eur");
    expect(bootstraps).toContain("--tax-behavior=exclusive");
    expect(bootstraps).toContain("products create");
    expect(bootstraps).toContain("prices create");
    for (const script of [
      "bootstrap-sandbox.sh",
      "verify-sandbox.sh",
      "bootstrap-live.sh",
      "verify-live.sh",
    ] as const) {
      expect(source(script)).toContain("verify_catalog_json");
    }
    expect(source("test-webhook.sh")).not.toMatch(/product_id|price_id|verify_catalog_json/);
    expect(bootstraps).not.toMatch(/coupon|promotion[_ -]?code|plans create/i);
    expect(`${catalog}\n${bootstraps}`).not.toContain("config --list");
  });
});
