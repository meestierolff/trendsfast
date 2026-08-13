#!/usr/bin/env bash
set -euo pipefail

private_root=".var/private"

mkdir -p "$private_root/dogfood" "$private_root/release-evidence"
chmod 0700 "$private_root" "$private_root/dogfood" "$private_root/release-evidence"

for private_file in "$private_root/managed-policy.env" "$private_root/provider-prices.env"; do
  if [[ ! -e "$private_file" ]]; then
    (umask 077 && touch "$private_file")
  fi
  chmod 0600 "$private_file"
done

printf '%s\n' "Private state is ready under .var/private (directories 0700; files 0600)."
