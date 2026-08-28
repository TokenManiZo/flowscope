#!/usr/bin/env bash
set -euo pipefail

script_dir="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)"
repo_dir="$(CDPATH='' cd -- "$script_dir/.." && pwd)"
key_file="${FLOWSCOPE_ZAP_KEY_FILE:-${FLOWSCOPE_CONFIG_DIR:-${HOME:?HOME is required}/.flowscope}/zap-api-key}"

if [[ -f "$key_file" ]]; then
  FLOWSCOPE_ZAP_KEY_FILE="$key_file"
else
  FLOWSCOPE_ZAP_KEY_FILE="/dev/null"
fi
export FLOWSCOPE_ZAP_KEY_FILE
docker compose --project-name flowscope-zap --file "$repo_dir/infra/zap/compose.yaml" down
