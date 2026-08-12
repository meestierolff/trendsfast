#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/_catalog.sh"

require_sandbox_key_rotated
require_cli_identity
price_json="$(stripe_catalog sandbox prices list --lookup-keys="$lookup_key" --limit=10)"
product_id="$(printf '%s' "$price_json" | json_field 'json => json.data?.[0]?.product')"
if [[ -z "$product_id" ]]; then
  echo "Founder sandbox price is missing." >&2
  exit 1
fi
product_json="$(stripe_catalog sandbox products retrieve "$product_id")"
verify_catalog_json sandbox "$price_json" "$product_json"
