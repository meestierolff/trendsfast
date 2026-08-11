#!/usr/bin/env bash
set -euo pipefail

if ! command -v stripe >/dev/null 2>&1; then
  echo "Stripe CLI is required." >&2
  exit 1
fi

stripe config --list >/dev/null

price_json="$(stripe prices list --lookup-keys=trendsfast_founder_monthly --limit=1 --color=off)"
product_id="$(printf '%s' "$price_json" | node --input-type=module -e "let raw=''; process.stdin.setEncoding('utf8'); process.stdin.on('data', c => raw += c); process.stdin.on('end', () => process.stdout.write(JSON.parse(raw).data?.[0]?.product ?? '')); ")"
if [[ -z "$product_id" ]]; then
  echo "Founder monthly price is missing." >&2
  exit 1
fi
product_json="$(stripe products retrieve "$product_id" --color=off)"
coupon_json="$(stripe coupons retrieve trendsfast_founding_100_12_months --color=off)"
promotion_json="$(stripe promotion_codes list --code=FOUNDING100 --limit=1 --color=off)"

PRICE_JSON="$price_json" PRODUCT_JSON="$product_json" COUPON_JSON="$coupon_json" PROMOTION_JSON="$promotion_json" \
  node --input-type=module -e '
    const price = JSON.parse(process.env.PRICE_JSON).data?.[0];
    const product = JSON.parse(process.env.PRODUCT_JSON);
    const coupon = JSON.parse(process.env.COUPON_JSON);
    const promotion = JSON.parse(process.env.PROMOTION_JSON).data?.[0];
    const failures = [];
    if (!price) failures.push("missing founder monthly price");
    if (price && price.unit_amount !== 3900) failures.push("founder price is not 3900 cents");
    if (price && price.currency !== "usd") failures.push("founder price currency is not USD");
    if (price && price.recurring?.interval !== "month") failures.push("founder price is not monthly");
    if (price && price.lookup_key !== "trendsfast_founder_monthly") failures.push("lookup key mismatch");
    if (product.name !== "TrendsFast Founder") failures.push("Founder product name mismatch");
    const metadata = product.metadata ?? {};
    const expectedMetadata = {
      catalog_key: "trendsfast_founder",
      plan: "founder",
      project_limit: "1",
      scheduled_runs_per_day: "1",
      on_demand_runs_per_month: "10",
      history_days: "30",
    };
    for (const [key, value] of Object.entries(expectedMetadata)) {
      if (metadata[key] !== value) failures.push(`Founder product metadata mismatch: ${key}`);
    }
    if (coupon.percent_off !== 50) failures.push("Founding 100 coupon is not 50 percent");
    if (coupon.duration !== "repeating" || coupon.duration_in_months !== 12) failures.push("Founding 100 duration mismatch");
    if (coupon.max_redemptions !== 100) failures.push("Founding 100 redemption cap mismatch");
    if (!promotion) failures.push("missing Founding 100 promotion code");
    if (promotion?.active !== false) failures.push("Founding 100 promotion must remain disabled");
    console.log(JSON.stringify({
      ok: failures.length === 0,
      priceId: price?.id ?? null,
      productId: product?.id ?? null,
      couponId: coupon?.id ?? null,
      promotionCodeId: promotion?.id ?? null,
      failures,
    }, null, 2));
    if (failures.length) process.exitCode = 1;
  '
