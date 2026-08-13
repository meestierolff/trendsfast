#!/usr/bin/env bash
set -euo pipefail

if [[ "${I_UNDERSTAND_LIVE_STRIPE:-}" != "YES" || "${STRIPE_LIVE_CATALOG_APPROVED:-}" != "YES" ]]; then
  echo "Live catalog verification requires both catalog acknowledgements." >&2
  exit 1
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/_catalog.sh"
require_cli_identity
price_json="$(stripe_catalog live prices list --lookup-keys="$lookup_key" --limit=10)"
product_id="$(printf '%s' "$price_json" | json_field 'json => json.data?.[0]?.product')"
if [[ -z "$product_id" ]]; then
  echo "Founder live price is missing." >&2
  exit 1
fi
product_json="$(stripe_catalog live products retrieve "$product_id")"
verify_catalog_json live "$price_json" "$product_json"
