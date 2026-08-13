#!/usr/bin/env bash
set -euo pipefail

stripe_api_version="2026-07-29.dahlia"
catalog_key="trendsfast_founder"
lookup_key="trendsfast_founder_monthly_eur"
product_name="TrendsFast Founder"

require_cli_identity() {
  if ! command -v stripe >/dev/null 2>&1; then
    echo "FOUNDER_ACTION_REQUIRED: install Stripe CLI" >&2
    exit 1
  fi
  if ! stripe whoami --format json >/dev/null; then
    echo "FOUNDER_ACTION_REQUIRED: stripe login" >&2
    exit 1
  fi
}

require_sandbox_key_rotated() {
  if [[ "${STRIPE_SANDBOX_KEY_ROTATED:-}" != "YES" ]]; then
    echo "Sandbox Stripe access is blocked until STRIPE_SANDBOX_KEY_ROTATED=YES confirms the exposed credential was revoked and replaced." >&2
    exit 1
  fi
}

json_field() {
  local expression="$1"
  node --input-type=module -e "let raw=''; process.stdin.setEncoding('utf8'); process.stdin.on('data', c => raw += c); process.stdin.on('end', () => { const value = (${expression})(JSON.parse(raw)); if (value !== undefined && value !== null) process.stdout.write(String(value)); });"
}

stripe_catalog() {
  local mode="$1"
  shift
  if [[ "$mode" == "live" ]]; then
    stripe "$@" --live --stripe-version="$stripe_api_version" --color=off
  else
    stripe "$@" --stripe-version="$stripe_api_version" --color=off
  fi
}

verify_catalog_json() {
  local mode="$1"
  local price_json="$2"
  local product_json="$3"
  MODE="$mode" PRICE_JSON="$price_json" PRODUCT_JSON="$product_json" node --input-type=module -e '
    const mode = process.env.MODE;
    const prices = JSON.parse(process.env.PRICE_JSON).data ?? [];
    const price = prices[0];
    const product = JSON.parse(process.env.PRODUCT_JSON);
    const failures = [];
    if (!price) failures.push("missing Founder monthly price");
    if (prices.length !== 1) failures.push("Founder lookup key must resolve to exactly one price");
    if (price?.active !== true) failures.push("Founder price is inactive");
    if (price?.unit_amount !== 3900) failures.push("Founder price is not 3900 cents");
    if (price?.currency !== "eur") failures.push("Founder price currency is not EUR");
    if (price?.tax_behavior !== "exclusive") failures.push("Founder price tax behavior is not exclusive");
    if (price?.recurring?.interval !== "month") failures.push("Founder price is not monthly");
    if (price?.recurring?.usage_type && price.recurring.usage_type !== "licensed") failures.push("Founder price is not licensed recurring billing");
    if (price?.lookup_key !== "trendsfast_founder_monthly_eur") failures.push("Founder lookup key mismatch");
    if (product?.active !== true) failures.push("Founder product is inactive");
    if (product?.name !== "TrendsFast Founder") failures.push("Founder product name mismatch");
    if (price?.product !== product?.id) failures.push("Founder price belongs to another product");
    const expected = {
      catalog_key: "trendsfast_founder",
      plan: "founder",
      project_limit: "1",
      scheduled_runs_per_day: "1",
      on_demand_runs_per_month: "10",
      history_days: "30",
    };
    for (const [key, value] of Object.entries(expected)) {
      if (product?.metadata?.[key] !== value) failures.push(`Founder product metadata mismatch: ${key}`);
    }
    const safe = {
      ok: failures.length === 0,
      mode,
      productId: product?.id ?? null,
      priceId: price?.id ?? null,
      failures,
    };
    console.log(JSON.stringify(safe, null, 2));
    if (failures.length) process.exitCode = 1;
  '
}
