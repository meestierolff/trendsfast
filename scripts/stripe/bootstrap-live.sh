#!/usr/bin/env bash
set -euo pipefail

if [[ "${I_UNDERSTAND_LIVE_STRIPE:-}" != "YES" ]]; then
  echo "Refusing live Stripe changes. Re-run only after approval with I_UNDERSTAND_LIVE_STRIPE=YES." >&2
  exit 1
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STRIPE_CLI_LIVE_MODE=1 I_UNDERSTAND_LIVE_STRIPE=YES \
  "${script_dir}/bootstrap-test.sh"
