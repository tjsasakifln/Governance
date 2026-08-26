#!/usr/bin/env bash
set -euo pipefail

SELF="$(readlink -f -- "${BASH_SOURCE[0]}")"
SCRIPT_DIR="$(cd -- "$(dirname -- "$SELF")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

state=prepared
while [[ $# -gt 0 ]]; do
  case "$1" in
    --state)
      state="${2:?missing state}"
      shift 2
      ;;
    *)
      echo "unknown argument: $1" >&2
      exit 2
      ;;
  esac
done
[[ "$state" == "prepared" || "$state" == "live" ]] || {
  echo "--state must be prepared or live" >&2
  exit 2
}

require_root_or_fixture
runtime_port="$(config_value RUNTIME_PORT)"
runtime_health_path="$(config_value RUNTIME_HEALTH_PATH)"
disk_warn="$(config_value DISK_WARN_PCT)"
disk_crit="$(config_value DISK_CRIT_PCT)"
tls_warn_days="$(config_value TLS_WARN_DAYS)"
tls_crit_days="$(config_value TLS_CRIT_DAYS)"
validate_runtime_port "$runtime_port"

hard_fail=0
pending=0

emit() {
  local check="$1"
  local status="$2"
  local detail="$3"
  printf 'check=%s status=%s detail=%s\n' "$check" "$status" "$detail"
}

pending_or_fail() {
  local check="$1"
  local detail="$2"
  if [[ "$state" == "prepared" ]]; then
    emit "$check" PENDING "$detail"
    pending=$((pending + 1))
  else
    emit "$check" FAIL "$detail"
    hard_fail=$((hard_fail + 1))
  fi
}

web_root="$(root_path /opt/confenge-web)"
disk_pct="$(df -P "$web_root" | awk 'NR == 2 { gsub(/%/, "", $5); print $5 }')"
if [[ ! "$disk_pct" =~ ^[0-9]+$ ]]; then
  emit disk FAIL unreadable
  hard_fail=$((hard_fail + 1))
elif (( disk_pct >= disk_crit )); then
  emit disk FAIL "used_pct=$disk_pct,crit=$disk_crit"
  hard_fail=$((hard_fail + 1))
elif (( disk_pct >= disk_warn )); then
  emit disk WARN "used_pct=$disk_pct,warn=$disk_warn"
else
  emit disk PASS "used_pct=$disk_pct"
fi

if nginx_configtest >/dev/null 2>&1; then
  emit nginx_config PASS configtest_ok
else
  emit nginx_config FAIL configtest_failed
  hard_fail=$((hard_fail + 1))
fi

current="$(root_path /opt/confenge-web/current)"
if [[ ! -L "$current" ]]; then
  pending_or_fail release_symlink missing
else
  target="$(readlink "$current")"
  if [[ "$target" == *PREPARED_NOT_LIVE* ]]; then
    pending_or_fail release_symlink prepared_placeholder
  elif [[ -f "$current/_site/index.html" && -f "$current/_site/404.html" ]]; then
    emit release_symlink PASS "target=$target"
  else
    pending_or_fail release_symlink target_incomplete
  fi
fi

snippet_root="$(root_path /etc/confenge/web/current)"
contract_validator="$SCRIPT_DIR/validate-web-cfg-contract.py"
if contract_result="$("$contract_validator" "$snippet_root" 2>/dev/null)"; then
  contract_hash="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["contract_hash"])' <<<"$contract_result")"
  emit web_cfg_contract PASS "schema=confenge.http-host-contract-manifest/v1,hash=$contract_hash"
else
  pending_or_fail web_cfg_contract missing_or_invalid
fi

build_info="$current/_site/.well-known/build-info.json"
if [[ -f "$build_info" ]]; then
  release_sha="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1], encoding="utf-8")).get("commit", ""))' "$build_info" 2>/dev/null || true)"
  if [[ "$release_sha" =~ ^[0-9a-f]{40}([0-9a-f]{24})?$ ]]; then
    emit origin_release_sha PASS "$release_sha"
  else
    pending_or_fail origin_release_sha invalid_or_missing
  fi
else
  pending_or_fail origin_release_sha build_info_absent
fi

runtime_url="http://127.0.0.1:${runtime_port}${runtime_health_path}"
if curl --silent --show-error --fail --max-time 3 "$runtime_url" >/dev/null 2>&1; then
  emit runtime_loopback PASS "$runtime_url"
else
  pending_or_fail runtime_loopback "$runtime_url"
fi

cert_dir="$(root_path /etc/letsencrypt/live/confenge.com.br)"
cert="$cert_dir/fullchain.pem"
key="$cert_dir/privkey.pem"
if [[ ! -r "$cert" || ! -r "$key" ]]; then
  pending_or_fail tls_certificate absent
else
  crit_seconds=$((tls_crit_days * 86400))
  warn_seconds=$((tls_warn_days * 86400))
  san="$(openssl x509 -in "$cert" -noout -ext subjectAltName 2>/dev/null || true)"
  key_mode="$(stat -Lc '%a' "$key" 2>/dev/null || true)"
  key_owner="$(stat -Lc '%U' "$key" 2>/dev/null || true)"
  if [[ "$key_owner" != root || ( "$key_mode" != 600 && "$key_mode" != 640 ) ]]; then
    emit tls_certificate FAIL "private_key_permissions=${key_mode:-unknown},owner=${key_owner:-unknown}"
    hard_fail=$((hard_fail + 1))
  elif [[ "$san" != *"DNS:confenge.com.br"* || "$san" != *"DNS:www.confenge.com.br"* ]]; then
    emit tls_certificate FAIL san_mismatch
    hard_fail=$((hard_fail + 1))
  elif ! openssl x509 -in "$cert" -noout -checkend "$crit_seconds" >/dev/null 2>&1; then
    emit tls_certificate FAIL "expires_within_days=$tls_crit_days"
    hard_fail=$((hard_fail + 1))
  elif ! openssl x509 -in "$cert" -noout -checkend "$warn_seconds" >/dev/null 2>&1; then
    emit tls_certificate WARN "expires_within_days=$tls_warn_days"
  else
    expiry="$(openssl x509 -in "$cert" -noout -enddate | cut -d= -f2-)"
    emit tls_certificate PASS "not_after=$expiry"
  fi
fi

enabled_dir="$(config_value NGINX_ENABLED_DIR)"
enabled_link="$(root_path "$enabled_dir/confenge.com.br.conf")"
if [[ -L "$enabled_link" ]]; then
  enabled_target="$(readlink "$enabled_link")"
  if [[ "$enabled_target" == *.acme-http.conf ]]; then
    if [[ "$state" == "live" ]]; then
      emit public_vhost FAIL http_acme_bootstrap_only
      hard_fail=$((hard_fail + 1))
    else
      emit public_vhost PENDING http_acme_bootstrap
      pending=$((pending + 1))
    fi
  else
    emit public_vhost PASS full_vhost_enabled
  fi
else
  pending_or_fail public_vhost disabled
fi

if (( hard_fail > 0 )); then
  printf 'overall=FAILED hard_failures=%d pending=%d dns_changed=UNOBSERVED\n' "$hard_fail" "$pending"
  exit 1
fi
if [[ "$state" == "prepared" ]]; then
  printf 'overall=PREPARED_NOT_LIVE hard_failures=0 pending=%d dns_changed=false\n' "$pending"
else
  printf 'overall=READY hard_failures=0 pending=0 dns_changed=operator_verified\n'
fi
