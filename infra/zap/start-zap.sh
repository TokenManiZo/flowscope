#!/usr/bin/env bash
set -euo pipefail

zap_port="${ZAP_PORT:-8089}"
api_key_file="${ZAP_API_KEY_FILE:-/run/secrets/flowscope-zap-api-key}"
[[ -f "$api_key_file" && ! -L "$api_key_file" ]] \
  || { echo "ZAP API key file is missing or is not a regular file" >&2; exit 2; }
api_key="$(tr -d '\r\n' < "$api_key_file")"
burp_host="${BURP_PROXY_HOST:-host.docker.internal}"
burp_port="${BURP_PROXY_PORT:-8081}"

[[ "$zap_port" =~ ^[0-9]{1,5}$ ]] || { echo "Invalid ZAP_PORT" >&2; exit 2; }
[[ "$burp_port" =~ ^[0-9]{1,5}$ ]] || { echo "Invalid BURP_PROXY_PORT" >&2; exit 2; }
[[ "$burp_host" =~ ^[A-Za-z0-9._:-]+$ ]] || { echo "Invalid BURP_PROXY_HOST" >&2; exit 2; }
[[ "$api_key" =~ ^[A-Za-z0-9._~-]+$ && ${#api_key} -ge 32 && ${#api_key} -le 256 ]] \
  || { echo "Invalid ZAP_API_KEY" >&2; exit 2; }
api_allowed_regex="${ZAP_API_ALLOWED_ADDRESS_REGEX:-}"
if [[ -z "$api_allowed_regex" ]]; then
  host_gateway="$(getent ahostsv4 "$burp_host" 2>/dev/null | awk 'NR == 1 { print $1 }')"
  [[ "$host_gateway" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] \
    || { echo "Could not resolve the trusted Docker host gateway" >&2; exit 2; }
  gateway_regex="${host_gateway//./\\.}"
  api_allowed_regex="^(127\\.0\\.0\\.1|${gateway_regex})$"
fi
[[ "$api_allowed_regex" != *$'\n'* && ${#api_allowed_regex} -le 512 ]] \
  || { echo "Invalid ZAP_API_ALLOWED_ADDRESS_REGEX" >&2; exit 2; }

runtime_dir="$(mktemp -d /tmp/flowscope-zap.XXXXXX)"
chmod 700 "$runtime_dir"
config_file="$runtime_dir/zap.properties"
curl_config="$runtime_dir/curl.conf"
printf 'api.key=%s\napi.addrs.addr.name=%s\napi.addrs.addr.regex=true\n' \
  "$api_key" "$api_allowed_regex" > "$config_file"
printf 'header = "X-ZAP-API-Key: %s"\n' "$api_key" > "$curl_config"
chmod 600 "$config_file" "$curl_config"
trap 'rm -rf "$runtime_dir"' EXIT

rm -f /tmp/flowscope-zap-ready
zap-x.sh -daemon -host 0.0.0.0 -port "$zap_port" \
  -configfile "$config_file" &
zap_pid=$!

stop_zap() {
  rm -f /tmp/flowscope-zap-ready
  kill -TERM "$zap_pid" 2>/dev/null || true
  wait "$zap_pid" 2>/dev/null || true
  rm -rf "$runtime_dir"
}
trap stop_zap TERM INT

api="http://127.0.0.1:${zap_port}"
for _ in $(seq 1 90); do
  if curl --config "$curl_config" --silent --show-error --fail --get \
      "$api/JSON/core/view/version/" >/dev/null; then
    break
  fi
  if ! kill -0 "$zap_pid" 2>/dev/null; then
    wait "$zap_pid"
    exit $?
  fi
  sleep 1
done

curl --config "$curl_config" --silent --show-error --fail --get \
  --data-urlencode "host=$burp_host" \
  --data-urlencode "port=$burp_port" \
  "$api/JSON/network/action/setHttpProxy/" >/dev/null
curl --config "$curl_config" --silent --show-error --fail --get \
  --data-urlencode 'enabled=true' \
  "$api/JSON/network/action/setHttpProxyEnabled/" >/dev/null

proxy_state="$(curl --config "$curl_config" --silent --show-error --fail --get \
  "$api/JSON/network/view/getHttpProxy/")"
enabled_state="$(curl --config "$curl_config" --silent --show-error --fail --get \
  "$api/JSON/network/view/isHttpProxyEnabled/")"
[[ "$proxy_state" == *"$burp_host"* && "$proxy_state" == *"$burp_port"* ]] || {
  echo "ZAP upstream proxy verification failed" >&2
  stop_zap
  exit 1
}
[[ "$enabled_state" == *'true'* ]] || {
  echo "ZAP upstream proxy is not enabled" >&2
  stop_zap
  exit 1
}

touch /tmp/flowscope-zap-ready
wait "$zap_pid"
rm -rf "$runtime_dir"
