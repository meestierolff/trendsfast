#!/usr/bin/env bash
set -euo pipefail

if ! command -v stripe >/dev/null 2>&1; then
  echo "Stripe CLI is required." >&2
  exit 1
fi

mode="test"
if [[ "${STRIPE_CLI_LIVE_MODE:-0}" == "1" ]]; then
  if [[ "${I_UNDERSTAND_LIVE_STRIPE:-}" != "YES" ]]; then
    echo "Live catalog bootstrap requires I_UNDERSTAND_LIVE_STRIPE=YES." >&2
    exit 1
  fi
  mode="live"
fi

stripe_api() {
  if [[ "$mode" == "live" ]]; then
    stripe "$@" --live
  else
    stripe "$@"
  fi
}

stripe config --list >/dev/null

json_field() {
  local expression="$1"
  node --input-type=module -e "let raw=''; process.stdin.setEncoding('utf8'); process.stdin.on('data', c => raw += c); process.stdin.on('end', () => { const value = (${expression})(JSON.parse(raw)); if (value !== undefined && value !== null) process.stdout.write(String(value)); });"
}

catalog_key="trendsfast_founder"
lookup_key="trendsfast_founder_monthly"
coupon_id="trendsfast_founding_100_12_months"
promotion_code="FOUNDING100"

product_json="$(stripe_api products search --query "metadata['catalog_key']:'${catalog_key}'" --limit=1 --color=off)"
product_id="$(printf '%s' "$product_json" | json_field 'json => json.data?.[0]?.id')"

if [[ -z "$product_id" ]]; then
  product_json="$(stripe_api products create \
    --name="TrendsFast Founder" \
    -d "metadata[catalog_key]=${catalog_key}" \
    -d "metadata[plan]=founder" \
    -d "metadata[project_limit]=1" \
    -d "metadata[scheduled_runs_per_day]=1" \
    -d "metadata[on_demand_runs_per_month]=10" \
    -d "metadata[history_days]=30" \
    --idempotency="trendsfast-${mode}-founder-product-v1" \
    --confirm --color=off)"
  product_id="$(printf '%s' "$product_json" | json_field 'json => json.id')"
fi
if [[ -z "$product_id" ]]; then
  echo "Stripe did not return a Founder product ID." >&2
  exit 1
fi

price_json="$(stripe_api prices list --lookup-keys="$lookup_key" --limit=1 --color=off)"
price_id="$(printf '%s' "$price_json" | json_field 'json => json.data?.[0]?.id')"

if [[ -z "$price_id" ]]; then
  price_json="$(stripe_api prices create \
    --product="$product_id" \
    --currency=usd \
    --unit-amount=3900 \
    --recurring.interval=month \
    --lookup-key="$lookup_key" \
    -d "metadata[plan]=founder" \
    --idempotency="trendsfast-${mode}-founder-price-v1" \
    --confirm --color=off)"
  price_id="$(printf '%s' "$price_json" | json_field 'json => json.id')"
fi
if [[ -z "$price_id" ]]; then
  echo "Stripe did not return a Founder monthly price ID." >&2
  exit 1
fi

coupon_json="$(stripe_api coupons retrieve "$coupon_id" --color=off 2>/dev/null || true)"
stored_coupon_id="$(printf '%s' "$coupon_json" | json_field 'json => json.id')"
if [[ "$stored_coupon_id" != "$coupon_id" ]]; then
  coupon_json="$(stripe_api coupons create \
    --id="$coupon_id" \
    --name="TrendsFast Founding 100 - 12 months" \
    --percent-off=50 \
    --duration=repeating \
    --duration-in-months=12 \
    --max-redemptions=100 \
    --idempotency="trendsfast-${mode}-founding-100-coupon-v1" \
    --confirm --color=off)"
fi
stored_coupon_id="$(printf '%s' "$coupon_json" | json_field 'json => json.id')"
if [[ "$stored_coupon_id" != "$coupon_id" ]]; then
  echo "Stripe did not return the Founding 100 coupon." >&2
  exit 1
fi

promotion_json="$(stripe_api promotion_codes list --code="$promotion_code" --limit=1 --color=off)"
promotion_id="$(printf '%s' "$promotion_json" | json_field 'json => json.data?.[0]?.id')"
if [[ -z "$promotion_id" ]]; then
  promotion_json="$(stripe_api promotion_codes create \
    --promotion.type=coupon \
    --promotion.coupon="$coupon_id" \
    --code="$promotion_code" \
    --active=false \
    --max-redemptions=100 \
    --idempotency="trendsfast-${mode}-founding-100-promotion-v1" \
    --confirm --color=off)"
  promotion_id="$(printf '%s' "$promotion_json" | json_field 'json => json.id')"
fi
if [[ -z "$promotion_id" ]]; then
  echo "Stripe did not return the disabled Founding 100 promotion code." >&2
  exit 1
fi

printf 'mode=%s\nproduct_id=%s\nprice_id=%s\ncoupon_id=%s\npromotion_code_id=%s\n' \
  "$mode" "$product_id" "$price_id" "$coupon_id" "$promotion_id"
