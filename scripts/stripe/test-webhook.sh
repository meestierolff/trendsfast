#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/_catalog.sh"

require_sandbox_key_rotated
require_cli_identity
if [[ -z "${STRIPE_WEBHOOK_SECRET_FILE:-}" ]]; then
  echo "Set STRIPE_WEBHOOK_SECRET_FILE to a secure file outside the repository." >&2
  exit 1
fi
repository_root="$(git -C "$script_dir" rev-parse --show-toplevel)"
target_parent="$(dirname "$STRIPE_WEBHOOK_SECRET_FILE")"
target_name="$(basename "$STRIPE_WEBHOOK_SECRET_FILE")"
if [[ "$target_name" == "." || "$target_name" == ".." ]]; then
  echo "The webhook secret target must name a file." >&2
  exit 1
fi
if [[ ! -d "$target_parent" ]]; then
  echo "The webhook secret target parent must already exist." >&2
  exit 1
fi
canonical_repository="$(cd "$repository_root" && pwd -P)"
canonical_parent="$(cd "$target_parent" && pwd -P)"
canonical_target="$canonical_parent/$target_name"
case "$canonical_target" in
  "$canonical_repository"|"$canonical_repository"/*)
    echo "STRIPE_WEBHOOK_SECRET_FILE must be outside the repository." >&2
    exit 1
    ;;
esac
STRIPE_WEBHOOK_SECRET_FILE="$canonical_target"
if [[ -e "$STRIPE_WEBHOOK_SECRET_FILE" ]]; then
  echo "Refusing to overwrite the existing webhook secret file." >&2
  exit 1
fi

umask 077
echo "Starting one listener for secret capture and webhook forwarding."
STRIPE_WEBHOOK_SECRET_FILE="$STRIPE_WEBHOOK_SECRET_FILE" stripe listen \
  --stripe-version="$stripe_api_version" \
  --events checkout.session.completed,customer.subscription.created,customer.subscription.updated,customer.subscription.deleted,invoice.paid,invoice.payment_failed \
  --forward-to http://127.0.0.1:3000/api/billing/webhook 2>&1 \
  | STRIPE_WEBHOOK_SECRET_FILE="$STRIPE_WEBHOOK_SECRET_FILE" node --input-type=module -e '
      import { writeFileSync } from "node:fs";
      const outputPath = process.env.STRIPE_WEBHOOK_SECRET_FILE;
      const secretPattern = /whsec_[A-Za-z0-9_]+/g;
      let pending = "";
      let captured = false;
      function emit(line) {
        const match = line.match(secretPattern)?.[0];
        if (match && !captured) {
          writeFileSync(outputPath, `${match}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
          captured = true;
          process.stdout.write("Webhook signing secret captured from this listener in the secure file; its value was redacted.\n");
        }
        process.stdout.write(line.replace(secretPattern, "[REDACTED_WEBHOOK_SECRET]"));
      }
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (chunk) => {
        pending += chunk;
        let newline;
        while ((newline = pending.indexOf("\n")) >= 0) {
          emit(pending.slice(0, newline + 1));
          pending = pending.slice(newline + 1);
        }
      });
      process.stdin.on("end", () => {
        if (pending) emit(pending);
        if (!captured) {
          process.stderr.write("Stripe listener exited before a signing secret was captured.\n");
          process.exitCode = 1;
        }
      });
    '
