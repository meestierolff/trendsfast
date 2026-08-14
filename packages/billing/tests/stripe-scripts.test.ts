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

const exactLiveProduct = {
  object: "product",
  id: "prod_TrendsFastFounder",
  livemode: true,
  active: true,
  name: "TrendsFast Founder",
  description: "Founder monitoring for one product with bounded research usage.",
  metadata: {
    catalog_key: "trendsfast_founder",
    plan: "founder",
    project_limit: "1",
    scheduled_runs_per_day: "1",
    on_demand_runs_per_month: "10",
    history_days: "30",
  },
};

const exactLivePrice = {
  object: "price",
  id: "price_TrendsFastFounderMonthly",
  livemode: true,
  active: true,
  type: "recurring",
  billing_scheme: "per_unit",
  unit_amount: 3900,
  currency: "eur",
  tax_behavior: "exclusive",
  recurring: { interval: "month", interval_count: 1, usage_type: "licensed" },
  lookup_key: "trendsfast_founder_monthly_eur",
  product: exactLiveProduct.id,
  metadata: { plan: "founder" },
};

function runFakeLiveBootstrap(options: {
  accountId: string;
  product?: typeof exactLiveProduct;
  price?: typeof exactLivePrice;
  catalogProducts?: object[];
  retrievedProduct?: object;
  productCreateResponse?: object;
  script?: "bootstrap-live.sh" | "verify-live.sh";
}) {
  const temporary = mkdtempSync(resolve(tmpdir(), "trendsfast-stripe-catalog-"));
  try {
    const fakeBin = resolve(temporary, "bin");
    const fakeStripe = resolve(fakeBin, "stripe");
    const tracePath = resolve(temporary, "trace.txt");
    mkdirSync(fakeBin);
    writeFileSync(
      fakeStripe,
      `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$STRIPE_FAKE_TRACE"
case "$1 $2" in
  "whoami --format") printf '%s' "$STRIPE_FAKE_IDENTITY_JSON" ;;
  "products list") printf '%s' "$STRIPE_FAKE_PRODUCT_LIST_JSON" ;;
  "products retrieve") printf '%s' "$STRIPE_FAKE_PRODUCT_JSON" ;;
  "products create") printf '%s' "$STRIPE_FAKE_PRODUCT_CREATE_JSON" ;;
  "prices list")
    if [[ " $* " == *" --active=true "* ]]; then
      printf '%s' "$STRIPE_FAKE_ACTIVE_PRICE_LIST_JSON"
    else
      printf '%s' '{"data":[],"has_more":false}'
    fi
    ;;
  *) printf '%s\\n' "unexpected fake Stripe command: $*" >&2; exit 70 ;;
esac
`,
      { mode: 0o700 },
    );
    const product = options.product;
    const price = options.price;
    const result = spawnSync(
      "bash",
      [resolve(root, "scripts/stripe", options.script ?? "bootstrap-live.sh")],
      {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
          I_UNDERSTAND_LIVE_STRIPE: "YES",
          STRIPE_LIVE_CATALOG_APPROVED: "YES",
          STRIPE_FAKE_TRACE: tracePath,
          STRIPE_FAKE_IDENTITY_JSON: JSON.stringify({ account_id: options.accountId }),
          STRIPE_FAKE_PRODUCT_JSON: JSON.stringify(options.retrievedProduct ?? product ?? {}),
          STRIPE_FAKE_PRODUCT_CREATE_JSON: JSON.stringify(
            options.productCreateResponse ?? product ?? {},
          ),
          STRIPE_FAKE_PRODUCT_LIST_JSON: JSON.stringify({
            data: options.catalogProducts ?? (product ? [product] : []),
            has_more: false,
          }),
          STRIPE_FAKE_ACTIVE_PRICE_LIST_JSON: JSON.stringify({
            data: price ? [price] : [],
            has_more: false,
          }),
        },
      },
    );
    return {
      ...result,
      trace: existsSync(tracePath) ? readFileSync(tracePath, "utf8") : "",
    };
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
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
    const catalogMutations = `${catalog}\n${bootstraps}`;
    expect(catalog).toContain('stripe_api_version="2026-07-29.dahlia"');
    expect(catalog).toContain('expected_live_account_id="acct_1SIpOxDzHjCqsazv"');
    expect(catalog).toContain('lookup_key="trendsfast_founder_monthly_eur"');
    expect(catalog).toContain("price?.livemode !== expectedLiveMode");
    expect(catalog).toContain('price?.type !== "recurring"');
    expect(catalog).toContain('price?.billing_scheme !== "per_unit"');
    expect(catalog).toContain("price?.recurring?.interval_count !== 1");
    expect(catalog).toContain('price?.recurring?.usage_type !== "licensed"');
    expect(catalog).toContain('price?.currency !== "eur"');
    expect(catalog).toContain('price?.tax_behavior !== "exclusive"');
    expect(bootstraps).toContain("--currency=eur");
    expect(bootstraps).toContain("--tax-behavior=exclusive");
    expect(bootstraps).toContain("--billing-scheme=per_unit");
    expect(bootstraps).toContain("--recurring.interval-count=1");
    expect(bootstraps).toContain("--recurring.usage-type=licensed");
    expect(bootstraps).toContain("products create");
    expect(bootstraps).toContain("prices create");
    for (const script of ["bootstrap-sandbox.sh", "bootstrap-live.sh"] as const) {
      expect(source(script)).toContain("verify_catalog_json");
    }
    for (const script of ["verify-sandbox.sh", "verify-live.sh"] as const) {
      expect(source(script)).toContain("preflight_catalog_before_mutation");
    }
    expect(source("test-webhook.sh")).not.toMatch(/product_id|price_id|verify_catalog_json/);
    expect(bootstraps).not.toMatch(/coupon|promotion[_ -]?code|plans create/i);
    expect(catalogMutations).not.toContain("config --list");

    // The catalog scripts' only mutation boundary is Product/Price creation.
    for (const forbiddenResource of [
      "customers",
      "subscriptions",
      "checkout sessions",
      "checkout.sessions",
      "payment_intents",
      "payment-intents",
      "charges",
    ]) {
      expect(catalogMutations).not.toMatch(
        new RegExp(
          `(?:stripe_catalog|stripe)\\s+[^\\n]*${forbiddenResource}\\s+(?:create|update|delete)`,
          "i",
        ),
      );
    }
    const catalogMutationCalls = [
      ...catalogMutations.matchAll(
        /stripe_catalog\s+(?:"?\$mode"?|live|sandbox)\s+([a-z0-9_.-]+)\s+(create|update|delete)\b/gi,
      ),
    ].map((match) => `${match[1]}:${match[2]}`);
    expect(new Set(catalogMutationCalls)).toEqual(new Set(["products:create", "prices:create"]));
  });

  it("reconciles Product and active/inactive Price inventories before either bootstrap can POST", () => {
    const catalog = source("_catalog.sh");
    const bootstraps = [source("bootstrap-live.sh"), source("bootstrap-sandbox.sh")];
    expect(catalog).not.toContain("products search");
    expect(catalog).toContain("products list --limit=100");
    expect(catalog).toContain("for active_value in true false");
    expect(catalog).toContain('prices list --lookup-keys="$lookup_key" --active="$active_value"');
    expect(catalog).toContain('reconcile_catalog_product "$mode"');
    expect(catalog).toContain('reconcile_lookup_price "$mode"');
    expect(catalog).toContain('products retrieve "$referenced_product_id"');
    expect(catalog).toContain("Founder product metadata keys mismatch");
    expect(catalog).toContain("Founder product description mismatch");
    const preflightBody = catalog.slice(catalog.indexOf("preflight_catalog_before_mutation()"));
    expect(preflightBody.indexOf('reconcile_lookup_price "$mode"')).toBeLessThan(
      preflightBody.indexOf('reconcile_catalog_product "$mode"'),
    );
    for (const bootstrap of bootstraps) {
      const preflight = bootstrap.indexOf('preflight_catalog_before_mutation "$mode"');
      expect(preflight).toBeGreaterThan(-1);
      expect(preflight).toBeLessThan(bootstrap.indexOf('stripe_catalog "$mode" products create'));
      expect(preflight).toBeLessThan(bootstrap.indexOf('stripe_catalog "$mode" prices create'));
      expect(bootstrap.indexOf('validate_product_json "$mode" "$product_json"')).toBeLessThan(
        bootstrap.indexOf('stripe_catalog "$mode" prices create'),
      );
    }
    expect(bootstraps[0]).toContain("require_expected_live_account");
    expect(bootstraps[0]).toContain("require_expected_account_for_mode");
  });

  it("rejects a non-pinned live account before catalog reads or POSTs", () => {
    const result = runFakeLiveBootstrap({
      accountId: "acct_NotTrendsFast",
      product: exactLiveProduct,
      price: exactLivePrice,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("not the pinned TrendsFast account");
    expect(result.trace).not.toMatch(/products|prices|create/);
  });

  it("rejects exact Product drift after both inventories are read and before creation", () => {
    const driftedProduct = {
      ...exactLiveProduct,
      description: "Drifted description",
    };
    const result = runFakeLiveBootstrap({
      accountId: "acct_1SIpOxDzHjCqsazv",
      product: driftedProduct,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Founder product description mismatch");
    expect(result.trace).toContain("products list");
    expect(result.trace).toContain(
      "prices list --lookup-keys=trendsfast_founder_monthly_eur --active=true",
    );
    expect(result.trace).toContain("products retrieve");
    expect(result.trace).not.toContain(" create ");
  });

  it("validates an existing Price's referenced Product before any Product POST", () => {
    const driftedReferencedProduct = {
      ...exactLiveProduct,
      metadata: { plan: "founder" },
    };
    const result = runFakeLiveBootstrap({
      accountId: "acct_1SIpOxDzHjCqsazv",
      catalogProducts: [],
      retrievedProduct: driftedReferencedProduct,
      price: exactLivePrice,
    });

    expect(result.status).toBe(1);
    expect(result.trace).toContain("products list");
    expect(result.trace).toContain(
      "prices list --lookup-keys=trendsfast_founder_monthly_eur --active=true",
    );
    expect(result.trace).toContain(`products retrieve ${exactLiveProduct.id}`);
    expect(result.trace).not.toContain(" create ");
    expect(result.stdout).toContain("Founder product metadata keys mismatch");
  });

  it("reads both active and inactive lookup-key Prices and emits only sanitized catalog IDs", () => {
    const result = runFakeLiveBootstrap({
      accountId: "acct_1SIpOxDzHjCqsazv",
      product: exactLiveProduct,
      price: exactLivePrice,
    });
    expect(result.status).toBe(0);
    expect(result.trace).toContain(
      "prices list --lookup-keys=trendsfast_founder_monthly_eur --active=true",
    );
    expect(result.trace).toContain(
      "prices list --lookup-keys=trendsfast_founder_monthly_eur --active=false",
    );
    expect(result.trace).not.toContain(" create ");
    expect(result.stdout).toContain(exactLiveProduct.id);
    expect(result.stdout).toContain(exactLivePrice.id);
    expect(result.stdout).not.toContain("catalog_key");
    expect(result.stdout).not.toContain("scheduled_runs_per_day");
  });

  it("makes read-only verification reject a duplicate metadata-keyed Product inventory", () => {
    const duplicateProduct = { ...exactLiveProduct, id: "prod_TrendsFastFounderDuplicate" };
    const result = runFakeLiveBootstrap({
      accountId: "acct_1SIpOxDzHjCqsazv",
      catalogProducts: [exactLiveProduct, duplicateProduct],
      retrievedProduct: exactLiveProduct,
      price: exactLivePrice,
      script: "verify-live.sh",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("duplicate Founder product catalog");
    expect(result.trace).toContain("products list");
    expect(result.trace).not.toContain(" create ");
  });

  it("fails strict live Price verification and redacts a malformed ID", () => {
    const driftedPrice = {
      ...exactLivePrice,
      id: "malformed-price-id",
      livemode: false,
      type: "one_time",
      billing_scheme: "tiered",
      unit_amount: 4000,
      currency: "usd",
      tax_behavior: "inclusive",
      recurring: { interval: "year", interval_count: 2, usage_type: "metered" },
      product: "prod_AnotherProduct",
    };
    const result = runFakeLiveBootstrap({
      accountId: "acct_1SIpOxDzHjCqsazv",
      product: exactLiveProduct,
      price: driftedPrice,
    });
    expect(result.status).toBe(1);
    for (const failure of [
      "Founder price ID is invalid",
      "Founder price livemode mismatch",
      "Founder price type is not recurring",
      "Founder price billing scheme is not per-unit",
      "Founder price is not 3900 cents",
      "Founder price currency is not EUR",
      "Founder price tax behavior is not exclusive",
      "Founder price is not monthly",
      "Founder price interval count is not one",
      "Founder price is not licensed recurring billing",
      "Founder price belongs to another product",
    ]) {
      expect(result.stdout).toContain(failure);
    }
    expect(result.stdout).not.toContain("malformed-price-id");
  });

  it("fails closed on an exit-zero Stripe error envelope without exposing raw error details", () => {
    const result = runFakeLiveBootstrap({
      accountId: "acct_1SIpOxDzHjCqsazv",
      productCreateResponse: {
        error: {
          type: "invalid_request_error",
          code: "more_permissions_required",
          message: "SENSITIVE_STRIPE_ERROR_MESSAGE",
          request_log_url: "https://dashboard.stripe.invalid/SENSITIVE_REQUEST_LOG_URL",
        },
      },
    });
    expect(result.status).toBe(1);
    expect(result.trace).toContain("products create");
    expect(result.trace).toContain("prices list");
    expect(result.trace).not.toContain("prices create");
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(
      "Stripe catalog request failed: category=invalid_request code=more_permissions_required",
    );
    expect(result.stderr).not.toContain("SENSITIVE_STRIPE_ERROR_MESSAGE");
    expect(result.stderr).not.toContain("SENSITIVE_REQUEST_LOG_URL");
    expect(result.stderr).not.toContain("request_log_url");
  });
});
