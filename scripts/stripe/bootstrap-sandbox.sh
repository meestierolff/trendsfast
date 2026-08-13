#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/_catalog.sh"

require_sandbox_key_rotated
require_cli_identity
mode="sandbox"

product_search="$(stripe_catalog "$mode" products search --query "metadata['catalog_key']:'${catalog_key}'" --limit=10)"
product_count="$(printf '%s' "$product_search" | json_field 'json => json.data?.length ?? 0')"
if [[ "$product_count" -gt 1 ]]; then
  echo "Refusing to mutate a duplicate Founder product catalog." >&2
  exit 1
fi
product_id="$(printf '%s' "$product_search" | json_field 'json => json.data?.[0]?.id')"
if [[ -z "$product_id" ]]; then
  product_json="$(stripe_catalog "$mode" products create \
    --name="$product_name" \
    --description="Founder monitoring for one product with bounded research usage." \
    -d "metadata[catalog_key]=${catalog_key}" \
    -d "metadata[plan]=founder" \
    -d "metadata[project_limit]=1" \
    -d "metadata[scheduled_runs_per_day]=1" \
    -d "metadata[on_demand_runs_per_month]=10" \
    -d "metadata[history_days]=30" \
    --idempotency="trendsfast-sandbox-founder-product-v1" --confirm)"
  product_id="$(printf '%s' "$product_json" | json_field 'json => json.id')"
fi
if [[ -z "$product_id" ]]; then
  echo "Stripe did not return a safe Founder product ID." >&2
  exit 1
fi

price_list="$(stripe_catalog "$mode" prices list --lookup-keys="$lookup_key" --limit=10)"
price_count="$(printf '%s' "$price_list" | json_field 'json => json.data?.length ?? 0')"
if [[ "$price_count" -gt 1 ]]; then
  echo "Refusing to mutate a duplicate Founder price catalog." >&2
  exit 1
fi
price_id="$(printf '%s' "$price_list" | json_field 'json => json.data?.[0]?.id')"
if [[ -z "$price_id" ]]; then
  price_json="$(stripe_catalog "$mode" prices create \
    --product="$product_id" \
    --currency=eur \
    --unit-amount=3900 \
    --tax-behavior=exclusive \
    --recurring.interval=month \
    --lookup-key="$lookup_key" \
    -d "metadata[plan]=founder" \
    --idempotency="trendsfast-sandbox-founder-price-eur-v1" --confirm)"
  price_id="$(printf '%s' "$price_json" | json_field 'json => json.id')"
fi
if [[ -z "$price_id" ]]; then
  echo "Stripe did not return a safe Founder price ID." >&2
  exit 1
fi

verified_price_json="$(stripe_catalog "$mode" prices list --lookup-keys="$lookup_key" --limit=10)"
verified_product_json="$(stripe_catalog "$mode" products retrieve "$product_id")"
verify_catalog_json "$mode" "$verified_price_json" "$verified_product_json"
