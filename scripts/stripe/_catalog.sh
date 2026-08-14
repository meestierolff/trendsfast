#!/usr/bin/env bash
set -euo pipefail

stripe_api_version="2026-07-29.dahlia"
expected_live_account_id="acct_1SIpOxDzHjCqsazv"
catalog_key="trendsfast_founder"
lookup_key="trendsfast_founder_monthly_eur"
product_name="TrendsFast Founder"
product_description="Founder monitoring for one product with bounded research usage."

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

require_expected_live_account() {
  local identity_json account_id
  if [[ -n "${STRIPE_ACCOUNT:-}" && "$STRIPE_ACCOUNT" != "$expected_live_account_id" ]]; then
    echo "Refusing live Stripe access: STRIPE_ACCOUNT does not match the pinned TrendsFast account." >&2
    exit 1
  fi
  if ! identity_json="$(stripe whoami --format json)"; then
    echo "FOUNDER_ACTION_REQUIRED: stripe login" >&2
    exit 1
  fi
  account_id="$(printf '%s' "$identity_json" | json_field 'json => json.account_id ?? json.account?.id')"
  if [[ "$account_id" != "$expected_live_account_id" ]]; then
    echo "Refusing live Stripe access: the authenticated account is not the pinned TrendsFast account." >&2
    exit 1
  fi
}

require_expected_account_for_mode() {
  local mode="$1"
  if [[ "$mode" == "live" ]]; then
    require_expected_live_account
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
  local response validated_response
  shift
  if [[ "$mode" == "live" ]]; then
    if ! response="$(stripe "$@" --live --stripe-version="$stripe_api_version" --color=off 2>/dev/null)"; then
      echo "Stripe catalog request failed: category=transport code=command_failed" >&2
      return 1
    fi
  else
    if ! response="$(stripe "$@" --stripe-version="$stripe_api_version" --color=off 2>/dev/null)"; then
      echo "Stripe catalog request failed: category=transport code=command_failed" >&2
      return 1
    fi
  fi
  if ! validated_response="$(printf '%s' "$response" | node --input-type=module -e '
    let raw = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (raw += chunk));
    process.stdin.on("end", () => {
      const fail = (category, code) => {
        process.stderr.write(`Stripe catalog request failed: category=${category} code=${code}\n`);
        process.exitCode = 1;
      };
      let payload;
      try {
        payload = JSON.parse(raw);
      } catch {
        fail("protocol", "invalid_json");
        return;
      }
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        fail("protocol", "invalid_response");
        return;
      }
      if (Object.prototype.hasOwnProperty.call(payload, "error")) {
        const error = payload.error && typeof payload.error === "object" ? payload.error : {};
        const categories = new Map([
          ["api_error", "api"],
          ["authentication_error", "authentication"],
          ["card_error", "card"],
          ["idempotency_error", "idempotency"],
          ["invalid_request_error", "invalid_request"],
          ["permission_error", "permission"],
          ["rate_limit_error", "rate_limit"],
        ]);
        const allowedCodes = new Set([
          "idempotency_key_in_use",
          "more_permissions_required",
          "parameter_invalid_integer",
          "parameter_missing",
          "parameter_unknown",
          "rate_limit",
          "resource_missing",
        ]);
        const category = categories.get(error.type) ?? "unclassified";
        const code = allowedCodes.has(error.code) ? error.code : "unclassified";
        fail(category, code);
        return;
      }
      process.stdout.write(raw);
    });
  ')"; then
    return 1
  fi
  printf '%s' "$validated_response"
}

# Stripe's search endpoint is eventually consistent. Walk the strongly-consistent
# list endpoint instead so a recently-created matching Product cannot be missed.
catalog_product_count=0
catalog_product_id=""
reconcile_catalog_product() {
  local mode="$1"
  local starting_after=""
  local page_json page_count page_first_id has_more last_id page_number
  catalog_product_count=0
  catalog_product_id=""
  page_number=0

  while true; do
    page_number=$((page_number + 1))
    if [[ "$page_number" -gt 1000 ]]; then
      echo "Refusing an unbounded Stripe Product reconciliation." >&2
      exit 1
    fi
    if [[ -n "$starting_after" ]]; then
      page_json="$(stripe_catalog "$mode" products list --limit=100 --starting-after="$starting_after")"
    else
      page_json="$(stripe_catalog "$mode" products list --limit=100)"
    fi
    page_count="$(printf '%s' "$page_json" | json_field 'json => (json.data ?? []).filter(product => product?.metadata?.catalog_key === "trendsfast_founder").length')"
    if [[ "$page_count" -gt 0 ]]; then
      page_first_id="$(printf '%s' "$page_json" | json_field 'json => (json.data ?? []).find(product => product?.metadata?.catalog_key === "trendsfast_founder")?.id')"
      catalog_product_count=$((catalog_product_count + page_count))
      if [[ -z "$catalog_product_id" ]]; then
        catalog_product_id="$page_first_id"
      fi
      if [[ "$catalog_product_count" -gt 1 ]]; then
        echo "Refusing to mutate a duplicate Founder product catalog." >&2
        exit 1
      fi
    fi
    has_more="$(printf '%s' "$page_json" | json_field 'json => json.has_more === true')"
    if [[ "$has_more" != "true" ]]; then
      break
    fi
    last_id="$(printf '%s' "$page_json" | json_field 'json => json.data?.at(-1)?.id')"
    if [[ -z "$last_id" || "$last_id" == "$starting_after" ]]; then
      echo "Stripe returned an invalid Product pagination cursor." >&2
      exit 1
    fi
    starting_after="$last_id"
  done
}

# Query both states explicitly. This prevents an inactive Price with the lookup
# key from being ignored and replaced by a second catalog entry.
catalog_price_count=0
catalog_price_id=""
catalog_price_json=""
reconcile_lookup_price() {
  local mode="$1"
  local active_value starting_after page_json page_count page_first_id
  local page_first_json has_more last_id page_number
  catalog_price_count=0
  catalog_price_id=""
  catalog_price_json=""

  for active_value in true false; do
    starting_after=""
    page_number=0
    while true; do
      page_number=$((page_number + 1))
      if [[ "$page_number" -gt 1000 ]]; then
        echo "Refusing an unbounded Stripe Price reconciliation." >&2
        exit 1
      fi
      if [[ -n "$starting_after" ]]; then
        page_json="$(stripe_catalog "$mode" prices list --lookup-keys="$lookup_key" --active="$active_value" --limit=100 --starting-after="$starting_after")"
      else
        page_json="$(stripe_catalog "$mode" prices list --lookup-keys="$lookup_key" --active="$active_value" --limit=100)"
      fi
      page_count="$(printf '%s' "$page_json" | json_field 'json => (json.data ?? []).filter(price => price?.lookup_key === "trendsfast_founder_monthly_eur").length')"
      if [[ "$page_count" -gt 0 ]]; then
        page_first_id="$(printf '%s' "$page_json" | json_field 'json => (json.data ?? []).find(price => price?.lookup_key === "trendsfast_founder_monthly_eur")?.id')"
        page_first_json="$(printf '%s' "$page_json" | json_field 'json => JSON.stringify((json.data ?? []).find(price => price?.lookup_key === "trendsfast_founder_monthly_eur"))')"
        catalog_price_count=$((catalog_price_count + page_count))
        if [[ -z "$catalog_price_id" ]]; then
          catalog_price_id="$page_first_id"
          catalog_price_json="$page_first_json"
        fi
        if [[ "$catalog_price_count" -gt 1 ]]; then
          echo "Refusing to mutate a duplicate Founder price catalog." >&2
          exit 1
        fi
      fi
      has_more="$(printf '%s' "$page_json" | json_field 'json => json.has_more === true')"
      if [[ "$has_more" != "true" ]]; then
        break
      fi
      last_id="$(printf '%s' "$page_json" | json_field 'json => json.data?.at(-1)?.id')"
      if [[ -z "$last_id" || "$last_id" == "$starting_after" ]]; then
        echo "Stripe returned an invalid Price pagination cursor." >&2
        exit 1
      fi
      starting_after="$last_id"
    done
  done
}

# Complete both strongly-consistent catalog inventories before either bootstrap
# is allowed to POST. An existing lookup-key Price is authoritative: retrieve
# and validate its referenced Product, then require that Product to be the sole
# metadata-keyed catalog Product. This prevents drift from creating an orphan
# Product before the existing Price is discovered.
catalog_preflight_verification_json=""
preflight_catalog_before_mutation() {
  local mode="$1"
  local referenced_product_id referenced_product_json verification_json
  catalog_preflight_verification_json=""

  reconcile_lookup_price "$mode"
  reconcile_catalog_product "$mode"
  if [[ "$catalog_price_count" -eq 0 ]]; then
    return 0
  fi
  if [[ "$catalog_price_count" -ne 1 || -z "$catalog_price_id" || -z "$catalog_price_json" ]]; then
    echo "Refusing to mutate an incomplete Founder price catalog." >&2
    return 1
  fi

  referenced_product_id="$(printf '%s' "$catalog_price_json" | json_field 'json => /^prod_[A-Za-z0-9]+$/.test(json?.product ?? "") ? json.product : ""')"
  if [[ -z "$referenced_product_id" ]]; then
    echo "Founder catalog Price does not reference a safe Product ID." >&2
    return 1
  fi
  referenced_product_json="$(stripe_catalog "$mode" products retrieve "$referenced_product_id")"
  if ! verification_json="$(verify_catalog_json "$mode" "$catalog_price_json" "$referenced_product_json")"; then
    printf '%s\n' "$verification_json"
    return 1
  fi
  if [[ "$catalog_product_count" -ne 1 || "$catalog_product_id" != "$referenced_product_id" ]]; then
    echo "Founder Price and metadata-keyed Product inventories do not identify one catalog." >&2
    return 1
  fi

  catalog_preflight_verification_json="$verification_json"
}

validate_product_json() {
  local mode="$1"
  local product_json="$2"
  MODE="$mode" PRODUCT_JSON="$product_json" node --input-type=module -e '
    const mode = process.env.MODE;
    const product = JSON.parse(process.env.PRODUCT_JSON);
    const failures = [];
    const expectedMetadata = {
      catalog_key: "trendsfast_founder",
      plan: "founder",
      project_limit: "1",
      scheduled_runs_per_day: "1",
      on_demand_runs_per_month: "10",
      history_days: "30",
    };
    const expectedLiveMode = mode === "live";
    const safeProductId = /^prod_[A-Za-z0-9]+$/.test(product?.id ?? "") ? product.id : null;
    if (mode !== "live" && mode !== "sandbox") failures.push("invalid catalog mode");
    if (product?.object !== "product") failures.push("Founder object type is not Product");
    if (!safeProductId) failures.push("Founder product ID is invalid");
    if (product?.livemode !== expectedLiveMode) failures.push("Founder product livemode mismatch");
    if (product?.active !== true) failures.push("Founder product is inactive");
    if (product?.name !== "TrendsFast Founder") failures.push("Founder product name mismatch");
    if (product?.description !== "Founder monitoring for one product with bounded research usage.") failures.push("Founder product description mismatch");
    const metadata = product?.metadata ?? {};
    if (JSON.stringify(Object.keys(metadata).sort()) !== JSON.stringify(Object.keys(expectedMetadata).sort())) {
      failures.push("Founder product metadata keys mismatch");
    }
    for (const [key, value] of Object.entries(expectedMetadata)) {
      if (metadata[key] !== value) failures.push(`Founder product metadata mismatch: ${key}`);
    }
    if (failures.length) {
      console.error(JSON.stringify({ ok: false, mode, productId: safeProductId, failures }, null, 2));
      process.exitCode = 1;
    }
  '
}

verify_catalog_json() {
  local mode="$1"
  local price_json="$2"
  local product_json="$3"
  MODE="$mode" PRICE_JSON="$price_json" PRODUCT_JSON="$product_json" node --input-type=module -e '
    const mode = process.env.MODE;
    const price = JSON.parse(process.env.PRICE_JSON);
    const product = JSON.parse(process.env.PRODUCT_JSON);
    const failures = [];
    const expectedLiveMode = mode === "live";
    const safePriceId = /^price_[A-Za-z0-9]+$/.test(price?.id ?? "") ? price.id : null;
    const safeProductId = /^prod_[A-Za-z0-9]+$/.test(product?.id ?? "") ? product.id : null;
    if (mode !== "live" && mode !== "sandbox") failures.push("invalid catalog mode");
    if (price?.object !== "price") failures.push("Founder object type is not Price");
    if (!safePriceId) failures.push("Founder price ID is invalid");
    if (price?.livemode !== expectedLiveMode) failures.push("Founder price livemode mismatch");
    if (price?.active !== true) failures.push("Founder price is inactive");
    if (price?.type !== "recurring") failures.push("Founder price type is not recurring");
    if (price?.billing_scheme !== "per_unit") failures.push("Founder price billing scheme is not per-unit");
    if (price?.unit_amount !== 3900) failures.push("Founder price is not 3900 cents");
    if (price?.currency !== "eur") failures.push("Founder price currency is not EUR");
    if (price?.tax_behavior !== "exclusive") failures.push("Founder price tax behavior is not exclusive");
    if (price?.recurring?.interval !== "month") failures.push("Founder price is not monthly");
    if (price?.recurring?.interval_count !== 1) failures.push("Founder price interval count is not one");
    if (price?.recurring?.usage_type !== "licensed") failures.push("Founder price is not licensed recurring billing");
    if (price?.lookup_key !== "trendsfast_founder_monthly_eur") failures.push("Founder lookup key mismatch");
    if (price?.product !== product?.id) failures.push("Founder price belongs to another product");
    const priceMetadata = price?.metadata ?? {};
    if (JSON.stringify(priceMetadata) !== JSON.stringify({ plan: "founder" })) failures.push("Founder price metadata mismatch");
    const expectedProductMetadata = {
      catalog_key: "trendsfast_founder",
      plan: "founder",
      project_limit: "1",
      scheduled_runs_per_day: "1",
      on_demand_runs_per_month: "10",
      history_days: "30",
    };
    if (product?.object !== "product") failures.push("Founder object type is not Product");
    if (!safeProductId) failures.push("Founder product ID is invalid");
    if (product?.livemode !== expectedLiveMode) failures.push("Founder product livemode mismatch");
    if (product?.active !== true) failures.push("Founder product is inactive");
    if (product?.name !== "TrendsFast Founder") failures.push("Founder product name mismatch");
    if (product?.description !== "Founder monitoring for one product with bounded research usage.") failures.push("Founder product description mismatch");
    const productMetadata = product?.metadata ?? {};
    if (JSON.stringify(Object.keys(productMetadata).sort()) !== JSON.stringify(Object.keys(expectedProductMetadata).sort())) {
      failures.push("Founder product metadata keys mismatch");
    }
    for (const [key, value] of Object.entries(expectedProductMetadata)) {
      if (productMetadata[key] !== value) failures.push(`Founder product metadata mismatch: ${key}`);
    }
    const safe = {
      ok: failures.length === 0,
      mode,
      productId: safeProductId,
      priceId: safePriceId,
      failures,
    };
    console.log(JSON.stringify(safe, null, 2));
    if (failures.length) process.exitCode = 1;
  '
}
