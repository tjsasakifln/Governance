#!/usr/bin/env bash
set -euo pipefail

SELF="$(readlink -f -- "${BASH_SOURCE[0]}")"
SCRIPT_DIR="$(cd -- "$(dirname -- "$SELF")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

release_sha=""
disable=false
reload=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --release-sha)
      release_sha="${2:?missing release SHA}"
      shift 2
      ;;
    --disable)
      disable=true
      shift
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
if [[ -n "$release_sha" && "$disable" == true ]] || [[ -z "$release_sha" && "$disable" == false ]]; then
  echo "choose exactly one of --release-sha or --disable" >&2
  exit 2
fi

if [[ -n "$release_sha" ]]; then
  args=(--mode full --release-sha "$release_sha")
  [[ "$reload" == true ]] && args+=(--reload)
  exec "$SCRIPT_DIR/switch.sh" "${args[@]}"
fi

enabled_dir="$(config_value NGINX_ENABLED_DIR)"
validate_enabled_dir "$enabled_dir"
enabled_link="$(root_path "$enabled_dir/confenge.com.br.conf")"
if [[ ! -L "$enabled_link" ]]; then
  echo "public edge is already disabled"
  exit 0
fi
target="$(readlink "$enabled_link")"
case "$target" in
  "$(root_path /etc/nginx/confenge-public-edge/available)"/*) ;;
  *)
    echo "refusing to unlink a vhost not owned by this pack" >&2
    exit 1
    ;;
esac

before="$(mktemp)"
after="$(mktemp)"
trap 'rm -f "$before" "$after"' EXIT
protected_vhost_snapshot "$before"
unlink "$enabled_link"
if ! nginx_configtest; then
  atomic_symlink "$target" "$enabled_link"
  nginx_configtest || true
  echo "disable configtest failed; vhost link restored" >&2
  exit 1
fi
protected_vhost_snapshot "$after"
assert_protected_vhosts_unchanged "$before" "$after"
if [[ "$reload" == true ]]; then
  nginx_reload
fi
printf '%s\n' "public_edge=disabled" "configtest=PASS" "reloaded=$reload" "dns_changed=false"
