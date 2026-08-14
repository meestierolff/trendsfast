#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/_catalog.sh"

require_sandbox_key_rotated
require_cli_identity
mode="sandbox"

preflight_catalog_before_mutation "$mode"
if [[ "$catalog_price_count" -eq 1 ]]; then
  printf '%s\n' "$catalog_preflight_verification_json"
  exit 0
fi

if [[ "$catalog_product_count" -eq 0 ]]; then
  product_json="$(stripe_catalog "$mode" products create \
    --name="$product_name" \
    --description="$product_description" \
    -d "metadata[catalog_key]=${catalog_key}" \
    -d "metadata[plan]=founder" \
    -d "metadata[project_limit]=1" \
    -d "metadata[scheduled_runs_per_day]=1" \
    -d "metadata[on_demand_runs_per_month]=10" \
    -d "metadata[history_days]=30" \
    --idempotency="trendsfast-sandbox-founder-product-v1" --confirm)"
  product_id="$(printf '%s' "$product_json" | json_field 'json => json.id')"
  validate_product_json "$mode" "$product_json"
  reconcile_catalog_product "$mode"
  if [[ "$catalog_product_count" -ne 1 || "$catalog_product_id" != "$product_id" ]]; then
    echo "Stripe Product reconciliation changed after creation; refusing to continue." >&2
    exit 1
  fi
else
  product_id="$catalog_product_id"
fi
if [[ ! "$product_id" =~ ^prod_[A-Za-z0-9]+$ ]]; then
  echo "Stripe did not return a safe Founder product ID." >&2
  exit 1
fi

product_json="$(stripe_catalog "$mode" products retrieve "$product_id")"
validate_product_json "$mode" "$product_json"

price_json="$(stripe_catalog "$mode" prices create \
  --product="$product_id" \
  --currency=eur \
  --unit-amount=3900 \
  --tax-behavior=exclusive \
  --billing-scheme=per_unit \
  --recurring.interval=month \
  --recurring.interval-count=1 \
  --recurring.usage-type=licensed \
  --lookup-key="$lookup_key" \
  -d "metadata[plan]=founder" \
  --idempotency="trendsfast-sandbox-founder-price-eur-v1" --confirm)"
price_id="$(printf '%s' "$price_json" | json_field 'json => json.id')"
verify_catalog_json "$mode" "$price_json" "$product_json" >/dev/null
reconcile_lookup_price "$mode"
if [[ "$catalog_price_count" -ne 1 || "$catalog_price_id" != "$price_id" ]]; then
  echo "Stripe Price reconciliation changed after creation; refusing to continue." >&2
  exit 1
fi
if [[ ! "$price_id" =~ ^price_[A-Za-z0-9]+$ ]]; then
  echo "Stripe did not return a safe Founder price ID." >&2
  exit 1
fi

verified_product_json="$(stripe_catalog "$mode" products retrieve "$product_id")"
verify_catalog_json "$mode" "$catalog_price_json" "$verified_product_json"
