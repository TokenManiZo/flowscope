#!/usr/bin/env bash
set -u

failures=0
warnings=0
build_mode=false
check_human=false
check_zap=false
check_explorer=false
mode="full"

usage() {
  cat <<'EOF'
Usage: ./scripts/doctor.sh [--mode human|zap|explorer|full] [--build]

  human    Burp HUMAN listener and FlowScope Web UI
  zap      HUMAN/SCANNER listeners, ZAP API/key/add-ons, Web UI
  explorer Codex CLI/login and FlowScope Web UI
  full     HUMAN, ZAP and Explorer checks (default)
  --build  also check the Maven/JDK source-build toolchain
EOF
}

while (($# > 0)); do
  case "$1" in
    --build) build_mode=true; shift ;;
    --mode)
      (($# >= 2)) || { usage >&2; exit 2; }
      mode="$2"; shift 2 ;;
    --mode=*) mode="${1#--mode=}"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
done

case "$mode" in
  human) check_human=true ;;
  zap) check_human=true; check_zap=true ;;
  explorer) check_explorer=true ;;
  full) check_human=true; check_zap=true; check_explorer=true ;;
  *) printf 'Invalid mode: %s\n' "$mode" >&2; usage >&2; exit 2 ;;
esac

ok() { printf 'OK    %s\n' "$1"; }
warn() { printf 'WARN  %s\n' "$1"; warnings=$((warnings + 1)); }
fail() { printf 'FAIL  %s\n' "$1"; failures=$((failures + 1)); }
has_port() {
  if command -v nc >/dev/null 2>&1; then nc -z 127.0.0.1 "$1" >/dev/null 2>&1; return $?; fi
  (exec 3<>"/dev/tcp/127.0.0.1/$1") >/dev/null 2>&1
}
resolve_codex() {
  if command -v codex >/dev/null 2>&1; then command -v codex; return; fi
  for candidate in "${HOME:?HOME is required}/.local/bin/codex" /opt/homebrew/bin/codex /usr/local/bin/codex /usr/bin/codex; do
    if [[ -x "$candidate" ]]; then printf '%s\n' "$candidate"; return; fi
  done
  return 1
}

printf 'FlowScope environment check (mode: %s)\n' "$mode"

human_port="${FLOWSCOPE_HUMAN_PORT:-8080}"
scanner_port="${FLOWSCOPE_BURP_SCANNER_PORT:-8081}"
web_port="${FLOWSCOPE_WEB_PORT:-17777}"

if $check_human; then
  if has_port "$human_port"; then ok "HUMAN port 127.0.0.1:${human_port} is open"; else fail "HUMAN port 127.0.0.1:${human_port} is closed"; fi
fi
if $check_zap; then
  if has_port "$scanner_port"; then ok "SCANNER port 127.0.0.1:${scanner_port} is open"; else fail "SCANNER port 127.0.0.1:${scanner_port} is closed"; fi

  key_file="${FLOWSCOPE_ZAP_KEY_FILE:-${FLOWSCOPE_CONFIG_DIR:-${HOME:?HOME is required}/.flowscope}/zap-api-key}"
  zap_port="${FLOWSCOPE_ZAP_PORT:-8089}"
  if [[ -f "$key_file" && ! -L "$key_file" ]]; then
    zap_key="$(tr -d '\r\n' < "$key_file")"
    if [[ "$zap_key" =~ ^[A-Za-z0-9._~-]+$ && ${#zap_key} -ge 32 && ${#zap_key} -le 256 ]]; then
      ok "owner-local ZAP key file exists"
    else
      fail "ZAP key file has an invalid format"
    fi
  else
    zap_key="${FLOWSCOPE_ZAP_API_KEY:-}"
    warn "default ZAP key file is absent: $key_file"
  fi

  if command -v curl >/dev/null 2>&1 && [[ -n "$zap_key" ]]; then
    curl_config="$(mktemp "${TMPDIR:-/tmp}/flowscope-doctor.XXXXXX")"
    chmod 600 "$curl_config"
    printf 'header = "X-ZAP-API-Key: %s"\n' "$zap_key" > "$curl_config"
    trap 'rm -f "$curl_config"' EXIT
    zap_version="$(curl --config "$curl_config" --silent --show-error --fail --get \
      "http://127.0.0.1:${zap_port}/JSON/core/view/version/" 2>/dev/null || true)"
    if [[ "$zap_version" == *'2.17.0'* ]]; then ok "ZAP 2.17.0 API is reachable on loopback";
    elif [[ -n "$zap_version" ]]; then warn "ZAP API is reachable but not the tested 2.17.0 baseline: $zap_version";
    else fail "ZAP API is not reachable at 127.0.0.1:${zap_port}"; fi

    proxy_enabled="$(curl --config "$curl_config" --silent --show-error --fail --get \
      "http://127.0.0.1:${zap_port}/JSON/network/view/isHttpProxyEnabled/" 2>/dev/null || true)"
    proxy_value="$(curl --config "$curl_config" --silent --show-error --fail --get \
      "http://127.0.0.1:${zap_port}/JSON/network/view/getHttpProxy/" 2>/dev/null || true)"
    if [[ "$proxy_enabled" == *'true'* && "$proxy_value" == *"$scanner_port"* ]]; then
      ok "ZAP upstream proxy points to the Burp SCANNER listener"
    else
      fail "ZAP upstream proxy is not enabled for Burp SCANNER port ${scanner_port}"
    fi

    addons="$(curl --config "$curl_config" --silent --show-error --fail --get \
      "http://127.0.0.1:${zap_port}/JSON/autoupdate/view/installedAddons/" 2>/dev/null || true)"
    missing_addons=""
    for addon in spider client spiderAjax pscan pscanrules selenium openapi websocket network replacer; do
      [[ "$addons" == *"\"id\":\"$addon\""* ]] || missing_addons="$missing_addons $addon"
    done
    if [[ -z "$missing_addons" ]]; then
      ok "required ZAP crawler/passive/API/WebSocket/Network add-ons are installed"
    else
      fail "missing required ZAP add-on(s):$missing_addons"
    fi
  else
    fail "curl and a local ZAP API key are required for the ZAP check"
  fi
fi

if $check_explorer; then
  if codex_path="$(resolve_codex)"; then
    ok "Codex CLI is available: $codex_path"
    if "$codex_path" login status >/dev/null 2>&1; then
      ok "Codex CLI login is valid for the current OS user"
    else
      fail "Codex CLI is not logged in; run codex and complete ChatGPT sign-in"
    fi
  else
    fail "Codex CLI was not found; install it before using Explorer"
  fi
fi

if has_port "$web_port"; then ok "FlowScope Web UI port ${web_port} is open"; else warn "FlowScope Web UI port ${web_port} is closed; load the JAR in Burp"; fi

if $build_mode; then
  if command -v mvn >/dev/null 2>&1; then
    maven_output="$(mvn -version 2>&1)"
    maven_version="$(printf '%s\n' "$maven_output" | head -n 1 | awk '{print $3}')"
    if [[ "$maven_version" =~ ^3\.([0-9]+)\. ]] && ((BASH_REMATCH[1] >= 9)); then
      ok "Maven ${maven_version} is available"
    else
      fail "Maven 3.9 or newer is required for source builds"
    fi
    maven_java_version="$(printf '%s\n' "$maven_output" | awk -F'[:, ]+' '/Java version:/ {print $3; exit}')"
    java_major="${maven_java_version%%.*}"
    if [[ "$java_major" == "21" ]]; then
      ok "Maven uses JDK ${maven_java_version}"
    else
      fail "Maven must use JDK 21 exactly for source builds"
    fi
  else
    fail "Maven 3.9 or newer is required for source builds"
    fail "Maven JDK could not be checked"
  fi
fi

printf '\nResult: %d failure(s), %d warning(s)\n' "$failures" "$warnings"
[[ "$failures" -eq 0 ]]
