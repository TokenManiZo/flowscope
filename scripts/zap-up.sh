#!/usr/bin/env bash
set -euo pipefail

script_dir="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)"
repo_dir="$(CDPATH='' cd -- "$script_dir/.." && pwd)"
key_file="${FLOWSCOPE_ZAP_KEY_FILE:-${FLOWSCOPE_CONFIG_DIR:-${HOME:?HOME is required}/.flowscope}/zap-api-key}"

command -v docker >/dev/null 2>&1 || { echo "Docker is required." >&2; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "Docker Compose v2 is required." >&2; exit 1; }

"$script_dir/zap-key.sh" >/dev/null
FLOWSCOPE_ZAP_API_KEY="$(tr -d '\r\n' < "$key_file")"
[[ "$FLOWSCOPE_ZAP_API_KEY" =~ ^[A-Za-z0-9._~-]+$ \
  && ${#FLOWSCOPE_ZAP_API_KEY} -ge 32 && ${#FLOWSCOPE_ZAP_API_KEY} -le 256 ]] || {
  echo "Invalid ZAP key file: $key_file" >&2
  exit 1
}
FLOWSCOPE_ZAP_KEY_FILE="$key_file"
export FLOWSCOPE_ZAP_KEY_FILE

docker compose --project-name flowscope-zap --file "$repo_dir/infra/zap/compose.yaml" up --detach --build --wait --wait-timeout 120

zap_port="${FLOWSCOPE_ZAP_PORT:-8089}"
curl_config="$(mktemp "${TMPDIR:-/tmp}/flowscope-zap-up.XXXXXX")"
chmod 600 "$curl_config"
printf 'header = "X-ZAP-API-Key: %s"\n' "$FLOWSCOPE_ZAP_API_KEY" > "$curl_config"
trap 'rm -f "$curl_config"' EXIT
for _ in $(seq 1 90); do
  if curl --config "$curl_config" --silent --show-error --fail --get \
      "http://127.0.0.1:${zap_port}/JSON/core/view/version/" >/dev/null 2>&1; then
    echo "FlowScope ZAP is ready at http://127.0.0.1:${zap_port}."
    echo "The API key is stored in $key_file and is read by FlowScope automatically."
    echo "Next: make sure Burp's SCANNER listener is 127.0.0.1:${FLOWSCOPE_BURP_SCANNER_PORT:-8081}, then run scripts/doctor.sh --mode zap."
    exit 0
  fi
  sleep 1
done

echo "ZAP did not become ready. Inspect: docker compose -p flowscope-zap -f infra/zap/compose.yaml logs" >&2
exit 1
