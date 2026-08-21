#!/usr/bin/env bash
# Generate production-edge secrets into a gitignored directory.
# Writes mode 0600 files. Prints no secret values. Refuses placeholders.
# Must not run in CI. This campaign does not apply the generated material.
set -euo pipefail
set +x
export PS4="${PS4-}"

refuse() {
  printf '%s\n' "$1" >&2
  exit 1
}

if [[ "${CI:-}" == "true" || "${GITHUB_ACTIONS:-}" == "true" || "${GITLAB_CI:-}" == "true" || "${CIRCLECI:-}" == "true" || "${BUILDKITE:-}" == "true" || "${TF_BUILD:-}" == "True" ]]; then
  refuse "refusing to generate secrets in CI"
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="${1:-"$SCRIPT_DIR/local"}"

if [[ "$DEST" == *"CHANGE_ME"* || "$DEST" == *"placeholder"* ]]; then
  refuse "refusing destination that looks like a placeholder"
fi

mkdir -p "$DEST"
chmod 700 "$DEST"
DEST="$(cd "$DEST" && pwd)"

is_placeholder() {
  local value="$1"
  local lowered
  lowered="$(printf '%s' "$value" | tr '[:upper:]' '[:lower:]')"
  if [[ -z "$value" ]]; then
    return 0
  fi
  case "$lowered" in
    change_me|changeme|change-me|replace-me|replaceme|placeholder|todo|fixme|password|secret|hunter2|example|xxx|xxxx|1234|12345|test|sample)
      return 0
      ;;
  esac
  if [[ "$lowered" == *"example.invalid"* || "$lowered" == *"changeme"* || "$lowered" == *"replace-me"* || "$lowered" == *"your-"* ]]; then
    return 0
  fi
  return 1
}

write_secret() {
  local name="$1"
  local value="$2"
  local path="$DEST/$name"
  if is_placeholder "$value"; then
    refuse "refusing placeholder value for $name"
  fi
  umask 077
  printf '%s' "$value" > "$path"
  chmod 600 "$path"
}

rand_hex() {
  local bytes="${1:-32}"
  openssl rand -hex "$bytes"
}

OPERATOR_USER="${CC_OPERATOR_USER:-operator}"
OPERATOR_EMAIL="${CC_OPERATOR_EMAIL:-operator@ops.confenge.com.br}"
OPERATOR_DISPLAY="${CC_OPERATOR_DISPLAY_NAME:-Control Center Operator}"
PUBLIC_DOMAIN="${CC_PUBLIC_DOMAIN:-ops.confenge.com.br}"
AUTH_DOMAIN="${CC_AUTH_DOMAIN:-auth.ops.confenge.com.br}"
COOKIE_DOMAIN="${CC_COOKIE_DOMAIN:-ops.confenge.com.br}"
TRUSTED_CIDRS="${CC_TRUSTED_PROXY_CIDRS:-10.89.0.0/24,127.0.0.1/32,::1/128}"

if is_placeholder "$OPERATOR_USER" || is_placeholder "$OPERATOR_EMAIL" || is_placeholder "$OPERATOR_DISPLAY"; then
  refuse "refusing placeholder operator identity"
fi
if [[ "$PUBLIC_DOMAIN" != "ops.confenge.com.br" ]]; then
  refuse "CC_PUBLIC_DOMAIN must be ops.confenge.com.br"
fi
if [[ "$AUTH_DOMAIN" != "auth.ops.confenge.com.br" ]]; then
  refuse "CC_AUTH_DOMAIN must be auth.ops.confenge.com.br"
fi
if [[ "$COOKIE_DOMAIN" != "ops.confenge.com.br" ]]; then
  refuse "CC_COOKIE_DOMAIN must be ops.confenge.com.br"
fi
if is_placeholder "$TRUSTED_CIDRS"; then
  refuse "refusing placeholder CC_TRUSTED_PROXY_CIDRS"
fi

POSTGRES_PASSWORD="$(rand_hex 24)"
AUTHELIA_PG_PASSWORD="$(rand_hex 24)"
AUTHELIA_JWT="$(rand_hex 32)"
AUTHELIA_SESSION="$(rand_hex 32)"
AUTHELIA_STORAGE="$(rand_hex 32)"
BACKUP_KEY="$(rand_hex 32)"
MCP_TOKEN="$(rand_hex 32)"
FOUNDER_ID="$(rand_hex 16)"
if [[ -n "${CC_OPERATOR_PASSWORD:-}" ]]; then
  if is_placeholder "$CC_OPERATOR_PASSWORD"; then
    refuse "refusing placeholder CC_OPERATOR_PASSWORD"
  fi
  OPERATOR_PASSWORD="$CC_OPERATOR_PASSWORD"
else
  OPERATOR_PASSWORD="$(rand_hex 24)"
fi

HASH_FILE="$(mktemp)"
chmod 600 "$HASH_FILE"
if ! openssl passwd -6 -stdin <<<"$OPERATOR_PASSWORD" > "$HASH_FILE"; then
  rm -f "$HASH_FILE"
  refuse "failed to hash operator password"
fi
OPERATOR_HASH="$(cat "$HASH_FILE")"
rm -f "$HASH_FILE"
if is_placeholder "$OPERATOR_HASH" || [[ ! "$OPERATOR_HASH" == \$6\$* ]]; then
  refuse "operator password hash was not produced"
fi

DATABASE_URL="postgres://control_center:${POSTGRES_PASSWORD}@postgres:5432/control_center"

write_secret "POSTGRES_PASSWORD" "$POSTGRES_PASSWORD"
write_secret "CONTROL_CENTER_DATABASE_URL" "$DATABASE_URL"
write_secret "CONTROL_CENTER_BACKUP_KEY" "$BACKUP_KEY"
write_secret "CONFENGE_MCP_AUTH_TOKEN" "$MCP_TOKEN"
write_secret "CONTROL_CENTER_FOUNDER_ACTOR_ID" "$FOUNDER_ID"
write_secret "authelia_jwt" "$AUTHELIA_JWT"
write_secret "authelia_session" "$AUTHELIA_SESSION"
write_secret "authelia_storage" "$AUTHELIA_STORAGE"
write_secret "authelia_postgres_password" "$AUTHELIA_PG_PASSWORD"
write_secret "CC_OPERATOR_PASSWORD_HASH" "$OPERATOR_HASH"
write_secret "CC_OPERATOR_USER" "$OPERATOR_USER"
write_secret "CC_OPERATOR_EMAIL" "$OPERATOR_EMAIL"
write_secret "CC_PUBLIC_DOMAIN" "$PUBLIC_DOMAIN"
write_secret "CC_AUTH_DOMAIN" "$AUTH_DOMAIN"
write_secret "CC_COOKIE_DOMAIN" "$COOKIE_DOMAIN"
write_secret "CC_TRUSTED_PROXY_CIDRS" "$TRUSTED_CIDRS"

umask 077
cat > "$DEST/users.yml" <<USERS
users:
  ${OPERATOR_USER}:
    disabled: false
    displayname: "${OPERATOR_DISPLAY}"
    password: "${OPERATOR_HASH}"
    email: "${OPERATOR_EMAIL}"
    groups:
      - operators
USERS
chmod 600 "$DEST/users.yml"

umask 077
{
  printf 'CC_SECRET_DIR=%q\n' "$DEST"
  printf 'CC_PUBLIC_DOMAIN=%q\n' "$PUBLIC_DOMAIN"
  printf 'CC_AUTH_DOMAIN=%q\n' "$AUTH_DOMAIN"
  printf 'CC_COOKIE_DOMAIN=%q\n' "$COOKIE_DOMAIN"
  printf 'CC_TRUSTED_PROXY_CIDRS=%q\n' "$TRUSTED_CIDRS"
  printf 'CC_OPERATOR_USER=%q\n' "$OPERATOR_USER"
  printf 'CC_OPERATOR_EMAIL=%q\n' "$OPERATOR_EMAIL"
  printf 'CC_OPERATOR_DISPLAY_NAME=%q\n' "$OPERATOR_DISPLAY"
  printf 'POSTGRES_PASSWORD=%q\n' "$POSTGRES_PASSWORD"
  printf 'CONTROL_CENTER_DATABASE_URL=%q\n' "$DATABASE_URL"
  printf 'CONTROL_CENTER_BACKUP_KEY=%q\n' "$BACKUP_KEY"
  printf 'CONFENGE_MCP_AUTH_TOKEN=%q\n' "$MCP_TOKEN"
  printf 'CONTROL_CENTER_FOUNDER_ACTOR_ID=%q\n' "$FOUNDER_ID"
} > "$DEST/.env"
chmod 600 "$DEST/.env"

printf 'wrote secret files to destination (mode 0600); values not printed\n'
