#!/usr/bin/env bash
set -euo pipefail

key_dir="${FLOWSCOPE_CONFIG_DIR:-${HOME:?HOME is required}/.flowscope}"
key_file="${FLOWSCOPE_ZAP_KEY_FILE:-$key_dir/zap-api-key}"

if [[ ! -e "$key_file" ]]; then
  umask 077
  mkdir -p "$(dirname -- "$key_file")"
  key="$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')"
  [[ "$key" =~ ^[0-9a-f]+$ && ${#key} -eq 64 ]] \
    || { echo "Failed to generate a local API key." >&2; exit 1; }
  printf '%s\n' "$key" > "$key_file"
fi

if [[ -L "$key_file" || ! -f "$key_file" ]]; then
  echo "ZAP key must be a regular file, not a link: $key_file" >&2
  exit 1
fi
chmod 600 "$key_file"
key="$(tr -d '\r\n' < "$key_file")"
[[ "$key" =~ ^[A-Za-z0-9._~-]+$ && ${#key} -ge 32 && ${#key} -le 256 ]] \
  || { echo "Invalid ZAP key file: $key_file" >&2; exit 1; }

echo "FlowScope ZAP API key is ready at $key_file. The key value was not printed."
