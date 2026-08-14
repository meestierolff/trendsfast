#!/usr/bin/env bash
set -euo pipefail

if [[ "${I_UNDERSTAND_LIVE_STRIPE:-}" != "YES" || "${STRIPE_LIVE_CATALOG_APPROVED:-}" != "YES" ]]; then
  echo "Live catalog verification requires both catalog acknowledgements." >&2
  exit 1
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/_catalog.sh"
require_cli_identity
require_expected_live_account
preflight_catalog_before_mutation live
if [[ "$catalog_price_count" -ne 1 || -z "$catalog_price_json" ]]; then
  echo "Founder live price is missing or duplicated." >&2
  exit 1
fi
printf '%s\n' "$catalog_preflight_verification_json"
