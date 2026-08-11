#!/usr/bin/env bash
set -euo pipefail

if ! command -v stripe >/dev/null 2>&1; then
  echo "Stripe CLI is required." >&2
  exit 1
fi

live_flag=()
mode="test"
if [[ "${STRIPE_CLI_LIVE_MODE:-0}" == "1" ]]; then
  if [[ "${I_UNDERSTAND_LIVE_STRIPE:-}" != "YES" ]]; then
    echo "Live catalog bootstrap requires I_UNDERSTAND_LIVE_STRIPE=YES." >&2
    exit 1
  fi
  live_flag=(--live)
  mode="live"
fi

stripe config --list >/dev/null

json_field() {
  local expression="$1"
  node --input-type=module -e "let raw=''; process.stdin.setEncoding('utf8'); process.stdin.on('data', c => raw += c); process.stdin.on('end', () => { const value = (${expression})(JSON.parse(raw)); if (value !== undefined && value !== null) process.stdout.write(String(value)); });"
}

catalog_key="trendsfast_founder"
lookup_key="trendsfast_founder_monthly"
coupon_id="trendsfast_founding_100_12_months"
promotion_code="FOUNDING100"

product_json="$(stripe products search "${live_flag[@]}" --query "metadata['catalog_key']:'${catalog_key}'" --limit=1 --color=off)"
product_id="$(printf '%s' "$product_json" | json_field 'json => json.data?.[0]?.id')"

if [[ -z "$product_id" ]]; then
  product_json="$(stripe products create "${live_flag[@]}" \
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

price_json="$(stripe prices list "${live_flag[@]}" --lookup-keys="$lookup_key" --limit=1 --color=off)"
price_id="$(printf '%s' "$price_json" | json_field 'json => json.data?.[0]?.id')"

if [[ -z "$price_id" ]]; then
  price_json="$(stripe prices create "${live_flag[@]}" \
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

if ! coupon_json="$(stripe coupons retrieve "${live_flag[@]}" "$coupon_id" --color=off 2>/dev/null)"; then
  coupon_json="$(stripe coupons create "${live_flag[@]}" \
    --id="$coupon_id" \
    --name="TrendsFast Founding 100 — first 12 months" \
    --percent-off=50 \
    --duration=repeating \
    --duration-in-months=12 \
    --max-redemptions=100 \
    --idempotency="trendsfast-${mode}-founding-100-coupon-v1" \
    --confirm --color=off)"
fi

promotion_json="$(stripe promotion_codes list "${live_flag[@]}" --code="$promotion_code" --limit=1 --color=off)"
promotion_id="$(printf '%s' "$promotion_json" | json_field 'json => json.data?.[0]?.id')"
if [[ -z "$promotion_id" ]]; then
  promotion_json="$(stripe promotion_codes create "${live_flag[@]}" \
    --promotion.type=coupon \
    --promotion.coupon="$coupon_id" \
    --code="$promotion_code" \
    --active=false \
    --max-redemptions=100 \
    --idempotency="trendsfast-${mode}-founding-100-promotion-v1" \
    --confirm --color=off)"
  promotion_id="$(printf '%s' "$promotion_json" | json_field 'json => json.id')"
fi

printf 'mode=%s\nproduct_id=%s\nprice_id=%s\ncoupon_id=%s\npromotion_code_id=%s\n' \
  "$mode" "$product_id" "$price_id" "$coupon_id" "$promotion_id"
