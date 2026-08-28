#!/usr/bin/env bash
set -euo pipefail

script_dir="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)"
repo_dir="$(CDPATH='' cd -- "$script_dir/.." && pwd)"
key_dir="${FLOWSCOPE_CONFIG_DIR:-${HOME:?HOME is required}/.flowscope}"
key_file="${FLOWSCOPE_ZAP_KEY_FILE:-$key_dir/zap-api-key}"

command -v docker >/dev/null 2>&1 || { echo "Docker is required." >&2; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "Docker Compose v2 is required." >&2; exit 1; }

if [[ ! -f "$key_file" ]]; then
  umask 077
  mkdir -p "$key_dir"
  key="$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')"
  [[ "$key" =~ ^[0-9a-f]+$ && ${#key} -eq 64 ]] \
    || { echo "Failed to generate a local API key." >&2; exit 1; }
  printf '%s\n' "$key" > "$key_file"
fi

if [[ -L "$key_file" || ! -f "$key_file" ]]; then
  echo "ZAP key must be a regular file, not a link: $key_file" >&2
  exit 1
fi
chmod 600 "$key_file" 2>/dev/null || true
FLOWSCOPE_ZAP_API_KEY="$(tr -d '\r\n' < "$key_file")"
[[ "$FLOWSCOPE_ZAP_API_KEY" =~ ^[A-Za-z0-9._~-]+$ \
  && ${#FLOWSCOPE_ZAP_API_KEY} -ge 32 && ${#FLOWSCOPE_ZAP_API_KEY} -le 256 ]] || {
  echo "Invalid ZAP key file: $key_file" >&2
  exit 1
}
FLOWSCOPE_ZAP_KEY_FILE="$key_file"
export FLOWSCOPE_ZAP_KEY_FILE

docker compose --project-name flowscope-zap --file "$repo_dir/infra/zap/compose.yaml" up --detach

zap_port="${FLOWSCOPE_ZAP_PORT:-8089}"
for _ in $(seq 1 90); do
  if curl --silent --show-error --fail --get \
      --data-urlencode "apikey=$FLOWSCOPE_ZAP_API_KEY" \
      "http://127.0.0.1:${zap_port}/JSON/core/view/version/" >/dev/null 2>&1; then
    echo "FlowScope ZAP is ready at http://127.0.0.1:${zap_port}."
    echo "The API key is stored in $key_file and is read by FlowScope automatically."
    echo "Next: make sure Burp's SCANNER listener is 127.0.0.1:${FLOWSCOPE_BURP_SCANNER_PORT:-8081}, then run scripts/doctor.sh."
    exit 0
  fi
  sleep 1
done

echo "ZAP did not become ready. Inspect: docker compose -p flowscope-zap -f infra/zap/compose.yaml logs" >&2
exit 1
