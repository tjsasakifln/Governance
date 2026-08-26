#!/usr/bin/env bash
set -euo pipefail

SELF="$(readlink -f -- "${BASH_SOURCE[0]}")"
SCRIPT_DIR="$(cd -- "$(dirname -- "$SELF")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

mode=""
release_sha=""
reload=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode)
      mode="${2:?missing mode}"
      shift 2
      ;;
    --release-sha)
      release_sha="${2:?missing release SHA}"
      shift 2
      ;;
    --reload)
      reload=true
      shift
      ;;
    *)
      echo "unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

require_root_or_fixture
[[ "$mode" == "full" || "$mode" == "http-acme" ]] || {
  echo "--mode must be full or http-acme" >&2
  exit 2
}

enabled_dir="$(config_value NGINX_ENABLED_DIR)"
validate_enabled_dir "$enabled_dir"
enabled_link="$(root_path "$enabled_dir/confenge.com.br.conf")"
available="$(root_path /etc/nginx/confenge-public-edge/available)"
current="$(root_path /opt/confenge-web/current)"

if [[ -e "$enabled_link" && ! -L "$enabled_link" ]]; then
  echo "refusing to replace non-symlink enabled vhost" >&2
  exit 1
fi

if [[ "$mode" == "full" ]]; then
  [[ -n "$release_sha" ]] || {
    echo "full mode requires --release-sha" >&2
    exit 2
  }
  validate_release "$release_sha"
  validate_certificate_files
  vhost_target="$available/confenge.com.br.conf"
  release_target="$(root_path "/opt/confenge-web/releases/$release_sha")"
else
  [[ -z "$release_sha" ]] || {
    echo "http-acme mode does not accept a release SHA" >&2
    exit 2
  }
  vhost_target="$available/confenge.com.br.acme-http.conf"
  release_target=""
fi
[[ -f "$vhost_target" ]] || {
  echo "prepared vhost is absent: $vhost_target" >&2
  exit 1
}

before="$(mktemp)"
after="$(mktemp)"
trap 'rm -f "$before" "$after"' EXIT
protected_vhost_snapshot "$before"

previous_vhost=""
previous_current=""
[[ -L "$enabled_link" ]] && previous_vhost="$(readlink "$enabled_link")"
[[ -L "$current" ]] && previous_current="$(readlink "$current")"

if [[ "$mode" == "full" ]]; then
  atomic_symlink "$release_target" "$current"
fi
atomic_symlink "$vhost_target" "$enabled_link"

if ! nginx_configtest; then
  restore_symlink "$enabled_link" "$previous_vhost"
  if [[ "$mode" == "full" ]]; then
    restore_symlink "$current" "$previous_current"
  fi
  nginx_configtest || true
  echo "configtest failed; release and vhost symlinks restored" >&2
  exit 1
fi

protected_vhost_snapshot "$after"
if ! assert_protected_vhosts_unchanged "$before" "$after"; then
  restore_symlink "$enabled_link" "$previous_vhost"
  if [[ "$mode" == "full" ]]; then
    restore_symlink "$current" "$previous_current"
  fi
  exit 1
fi

transaction_dir="$(root_path /var/lib/confenge-public-edge/transactions)"
install -d -m 0700 "$transaction_dir"
transaction="$transaction_dir/$(date -u +%Y%m%dT%H%M%S)-$$.state"
umask 077
{
  printf 'mode=%s\n' "$mode"
  printf 'release_sha=%s\n' "$release_sha"
  printf 'previous_vhost=%s\n' "$previous_vhost"
  printf 'previous_current=%s\n' "$previous_current"
  printf 'dns_changed=false\n'
} >"$transaction"

if [[ "$reload" == true ]]; then
  nginx_reload
fi

printf '%s\n' \
  "mode=$mode" \
  "configtest=PASS" \
  "reloaded=$reload" \
  "dns_changed=false" \
  "transaction=$transaction"
