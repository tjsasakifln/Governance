#!/usr/bin/env bash
# Install only the separately provisioned Warmbly human-gate API credential.
# This never rotates or rewrites database, Authelia, session, MCP, or backup keys.
set -euo pipefail
set +x
export PS4="${PS4-}"

refuse() {
  printf '%s\n' "$1" >&2
  exit 1
}

if [[ "$#" -lt 1 || "$#" -gt 3 ]]; then
  refuse "usage: install-warmbly-operator-token.sh SOURCE_FILE [CC_SECRET_DIR] [RUNTIME_UID:RUNTIME_GID]"
fi

SOURCE_FILE="$1"
DEST_DIR="${2:-/etc/confenge/control-center/secrets}"
RUNTIME_OWNER="${3:-}"
[[ -f "$SOURCE_FILE" && -r "$SOURCE_FILE" ]] || refuse "source credential file is not readable"
[[ "$DEST_DIR" != *"CHANGE_ME"* && "$DEST_DIR" != *"placeholder"* ]] || refuse "refusing placeholder destination"
[[ -z "$RUNTIME_OWNER" || "$RUNTIME_OWNER" =~ ^[0-9]+:[0-9]+$ ]] || refuse "runtime owner must be numeric UID:GID"

credential="$(tr -d '\r\n' < "$SOURCE_FILE")"
[[ "$credential" =~ ^wmbly_[A-Za-z0-9_-]{16,}$ ]] || refuse "source is not a Warmbly API credential"

mkdir -p "$DEST_DIR"
chmod 700 "$DEST_DIR"
DEST_DIR="$(cd "$DEST_DIR" && pwd)"
tmp="$(mktemp "$DEST_DIR/.CC_WARMBLY_OPERATOR_TOKEN.XXXXXX")"
cleanup() { rm -f "$tmp"; }
trap cleanup EXIT
umask 077
printf '%s' "$credential" > "$tmp"
chmod 600 "$tmp"
if [[ -n "$RUNTIME_OWNER" ]]; then
  chown "$RUNTIME_OWNER" "$tmp"
fi
mv -f "$tmp" "$DEST_DIR/CC_WARMBLY_OPERATOR_TOKEN"
trap - EXIT
unset credential
printf 'installed Warmbly operator credential (mode 0600, runtime-readable); value not printed\n'
