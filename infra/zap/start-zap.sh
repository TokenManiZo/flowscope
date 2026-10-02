#!/usr/bin/env bash
set -euo pipefail

flowscope_default_api_allowed_regex() {
  local trusted_host="$1"
  local route_file="$2"
  [[ "$trusted_host" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] || return 1
  local gateway_hex
  gateway_hex="$(awk '$2 == "00000000" { print $3; exit }' "$route_file")"
  [[ "$gateway_hex" =~ ^[0-9A-Fa-f]{8}$ ]] || return 1
  local bridge_gateway
  printf -v bridge_gateway '%d.%d.%d.%d' \
    "$((16#${gateway_hex:6:2}))" "$((16#${gateway_hex:4:2}))" \
    "$((16#${gateway_hex:2:2}))" "$((16#${gateway_hex:0:2}))"
  local trusted_regex="${trusted_host//./\\.}"
  local bridge_regex="${bridge_gateway//./\\.}"
  if [[ "$trusted_host" == "$bridge_gateway" ]]; then
    printf '^(127\\.0\\.0\\.1|zap|%s)$\n' "$trusted_regex"
  else
    printf '^(127\\.0\\.0\\.1|zap|%s|%s)$\n' "$trusted_regex" "$bridge_regex"
  fi
}

flowscope_check_chromium_runtime() {
  local browser="$1"
  local driver="$2"
  local browser_version driver_version browser_major driver_major profile
  if [[ ! -f "$browser" || ! -x "$browser" ]] \
      || ! browser_version="$("$browser" --version 2>/dev/null)"; then
    echo "ZAP Chromium browser cannot execute: $browser." >&2
    return 1
  fi
  if [[ ! -f "$driver" || ! -x "$driver" ]] \
      || ! driver_version="$("$driver" --version 2>/dev/null)"; then
    echo "ZAP Chromium driver cannot execute: $driver." >&2
    return 1
  fi
  browser_major="$(printf '%s\n' "$browser_version" | sed -nE 's/[^0-9]*([0-9]+)(\.[0-9]+).*/\1/p')"
  driver_major="$(printf '%s\n' "$driver_version" | sed -nE 's/[^0-9]*([0-9]+)(\.[0-9]+).*/\1/p')"
  if [[ -z "$browser_major" || -z "$driver_major" || "$browser_major" != "$driver_major" ]]; then
    echo "ZAP Chromium and ChromeDriver major versions do not match." >&2
    return 1
  fi
  profile="$(mktemp -d "${TMPDIR:-/tmp}/flowscope-chromium-check.XXXXXX")" \
    || { echo "ZAP Chromium preflight profile could not be created." >&2; return 1; }
  if ! "$browser" --headless=new --no-sandbox --disable-gpu \
      --user-data-dir="$profile" --dump-dom about:blank >/dev/null 2>&1; then
    rm -rf -- "$profile"
    echo "ZAP Chromium could not start in headless mode." >&2
    return 1
  fi
  rm -rf -- "$profile"
}

if [[ "${BASH_SOURCE[0]}" != "$0" ]]; then
  return 0
fi

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
  api_allowed_regex="$(flowscope_default_api_allowed_regex "$host_gateway" /proc/net/route)" \
    || { echo "Could not resolve the trusted Docker bridge gateway" >&2; exit 2; }
fi
[[ "$api_allowed_regex" != *$'\n'* && ${#api_allowed_regex} -le 512 ]] \
  || { echo "Invalid ZAP_API_ALLOWED_ADDRESS_REGEX" >&2; exit 2; }

runtime_root="/run/flowscope-zap"
[[ -d "$runtime_root" && -w "$runtime_root" ]] \
  || { echo "FlowScope ephemeral ZAP runtime is unavailable" >&2; exit 2; }
runtime_dir="$(mktemp -d "$runtime_root/runtime.XXXXXX")"
chmod 700 "$runtime_dir"
zap_home="$runtime_dir/home"
mkdir -m 700 "$zap_home"
config_file="$runtime_dir/zap.properties"
curl_config="$runtime_dir/curl.conf"
printf 'api.key=%s\napi.addrs.addr.name=%s\napi.addrs.addr.regex=true\nstart.checkForUpdates=false\nstart.checkAddonUpdates=false\nstart.downloadNewRelease=false\nstart.installAddonUpdates=false\n' \
  "$api_key" "$api_allowed_regex" > "$config_file"
printf 'header = "X-ZAP-API-Key: %s"\n' "$api_key" > "$curl_config"
chmod 600 "$config_file" "$curl_config"
trap 'rm -rf "$runtime_dir"' EXIT

if ! flowscope_check_chromium_runtime /usr/bin/chromium /usr/bin/chromedriver; then
  exit 1
fi
export JDK_JAVA_OPTIONS="${JDK_JAVA_OPTIONS:+$JDK_JAVA_OPTIONS }-Dwebdriver.chrome.driver=/usr/bin/chromedriver -Dselenium.chromeBinary=/usr/bin/chromium"

rm -f /tmp/flowscope-zap-ready
zap-x.sh -daemon -dir "$zap_home" -host 0.0.0.0 -port "$zap_port" \
  -configfile "$config_file" \
  -config 'selenium.chromeArgs.arg.argument=--no-sandbox' &
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

# Headless ZAP never clears the Client Map (the client add-on only clears it from its GUI panel), and the
# Client Spider only clicks components that are new to the Map. FlowScope runs this script right before each
# Client Spider. After clearing, it adds the start URL and the client-side routes FlowScope found in the
# app's bundle as unvisited nodes; the Client Spider queues every unvisited node when it starts. It echoes
# "request:node count" so FlowScope accepts only its own reset. Without it FlowScope still crawls and
# reports a warning, so a registration failure does not stop ZAP.
client_map_script="$runtime_dir/flowscope-clear-client-map.js"
cat > "$client_map_script" <<'JS'
var ScriptVars = Java.type("org.zaproxy.zap.extension.script.ScriptVars");
var request = ScriptVars.getGlobalVar("flowscope.clientMap.request");
var seeds = ScriptVars.getGlobalVar("flowscope.clientMap.seeds");
var extension = control.getExtensionLoader().getExtension("ExtensionClientIntegration");
var clientTree = extension.getClass().getDeclaredField("clientTree");
clientTree.setAccessible(true);
var map = clientTree.get(extension);
map.clear();
var added = 0;
if (seeds) {
  seeds.split("\n").forEach(function (url) {
    if (url) {
      map.getOrAddNode(url, false, false);
      added++;
    }
  });
}
ScriptVars.setGlobalVar("flowscope.clientMap.cleared", request + ":" + added);
JS
chmod 600 "$client_map_script"
if ! curl --config "$curl_config" --silent --show-error --fail --get \
    --data-urlencode 'scriptName=flowscope-clear-client-map' \
    --data-urlencode 'scriptType=standalone' \
    --data-urlencode 'scriptEngine=Graal.js' \
    --data-urlencode "fileName=$client_map_script" \
    "$api/JSON/script/action/load/" >/dev/null; then
  echo "Could not register the Client Map reset script; Client Spider may skip pages seen earlier." >&2
fi

touch /tmp/flowscope-zap-ready
wait "$zap_pid"
rm -rf "$runtime_dir"
