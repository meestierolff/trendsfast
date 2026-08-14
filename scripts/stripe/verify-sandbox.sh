#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/_catalog.sh"

require_sandbox_key_rotated
require_cli_identity
preflight_catalog_before_mutation sandbox
if [[ "$catalog_price_count" -ne 1 || -z "$catalog_price_json" ]]; then
  echo "Founder sandbox price is missing or duplicated." >&2
  exit 1
fi
printf '%s\n' "$catalog_preflight_verification_json"
