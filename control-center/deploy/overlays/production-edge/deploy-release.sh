#!/usr/bin/env bash
# Converge the complete Control Center production release onto an exact main SHA.
# Usage: deploy-release.sh <full-origin-main-sha>
set -euo pipefail

REPO_ROOT="${CC_REPO_ROOT:-/opt/confenge-control-center}"
SECRET_ENV="${CC_SECRET_ENV:-/etc/confenge/control-center/secrets/.env}"
EVIDENCE_DIR="${CC_RELEASE_EVIDENCE_DIR:-/opt/confenge-control-center-release-evidence}"
LOCK_FILE="${CC_RELEASE_LOCK_FILE:-/run/lock/confenge-control-center-release.lock}"
SCRIPT_RELATIVE="control-center/deploy/overlays/production-edge"
TARGET_SHA="${1:-}"

if [ "$#" -ne 1 ] || [[ ! "$TARGET_SHA" =~ ^[0-9a-f]{40}$ ]]; then
  echo "DEPLOY_ERROR: pass exactly one full lowercase 40-character origin/main SHA" >&2
  exit 1
fi

mkdir -p "$(dirname "$LOCK_FILE")"
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "DEPLOY_ERROR: another Control Center release is already running" >&2
  exit 1
fi

cd "$REPO_ROOT"

# Refuse dirty source before checkout or any Docker build. Fetching remote refs
# is safe, but changing the checkout before this gate would obscure provenance.
if [ -n "$(git status --porcelain=v1 --untracked-files=all)" ]; then
  echo "DEPLOY_ERROR: checkout is not clean; no image was built" >&2
  git status --porcelain=v1 --untracked-files=all >&2
  exit 1
fi

git fetch --all --prune --quiet
MAIN_SHA="$(git rev-parse --verify origin/main)"
if [ "$TARGET_SHA" != "$MAIN_SHA" ]; then
  echo "DEPLOY_ERROR: requested SHA is not contemporary origin/main ($MAIN_SHA)" >&2
  echo "DEPLOY_ERROR: rollback uses the recorded image IDs; it is not a release deploy" >&2
  exit 1
fi
if ! git cat-file -e "${TARGET_SHA}^{commit}" 2>/dev/null; then
  echo "DEPLOY_ERROR: requested SHA is not a repository commit" >&2
  exit 1
fi

git checkout --quiet --detach "$TARGET_SHA"
if [ "$(git rev-parse HEAD)" != "$TARGET_SHA" ]; then
  echo "DEPLOY_ERROR: checkout did not terminate at the requested SHA" >&2
  exit 1
fi
if [ -n "$(git status --porcelain=v1 --untracked-files=all)" ]; then
  echo "DEPLOY_ERROR: checkout became dirty; no image was built" >&2
  exit 1
fi

if [ ! -r "$SECRET_ENV" ]; then
  echo "DEPLOY_ERROR: secret environment file is not readable" >&2
  exit 1
fi
set -a
# shellcheck disable=SC1090
. "$SECRET_ENV"
set +a
# A secret file must never be able to replace the certified release identity.
export CC_RELEASE_SHA="$TARGET_SHA"
CC_SECRET_DIR="$(dirname "$SECRET_ENV")"
export CC_SECRET_DIR
unset COMPOSE_FILE COMPOSE_PROJECT_NAME

OVERLAY_DIR="$REPO_ROOT/$SCRIPT_RELATIVE"
COMPOSE="$OVERLAY_DIR/release-compose.sh"
SERVICE_PARSER="$OVERLAY_DIR/release-services.py"

if ! TEMPLATE_SERVICES="$($COMPOSE config --no-interpolate --format json | python3 "$SERVICE_PARSER")"; then
  echo "DEPLOY_ERROR: release service set could not be derived from compose" >&2
  exit 1
fi
if ! RENDERED_SERVICES="$($COMPOSE config --format json | python3 "$SERVICE_PARSER" --expected "$TARGET_SHA")"; then
  echo "DEPLOY_ERROR: rendered compose release identity is inconsistent" >&2
  exit 1
fi
if [ "$TEMPLATE_SERVICES" != "$RENDERED_SERVICES" ]; then
  echo "DEPLOY_ERROR: template and rendered release service sets differ" >&2
  exit 1
fi
mapfile -t RELEASE_SERVICES <<<"$RENDERED_SERVICES"

umask 077
mkdir -p "$EVIDENCE_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
ROLLBACK_RECEIPT="$EVIDENCE_DIR/rollback-point-${STAMP}-to-${TARGET_SHA}.log"
FINAL_RECEIPT="$EVIDENCE_DIR/release-receipt-${STAMP}-${TARGET_SHA}.log"
FAILURE_RECEIPT="$EVIDENCE_DIR/release-failure-${STAMP}-${TARGET_SHA}.log"
DEPLOY_STARTED=false

capture_state() {
  local phase="$1" output="$2" service container image_id
  {
    echo "schema_version=control-center.release-state.v1"
    echo "phase=$phase"
    echo "captured_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "target_sha=$TARGET_SHA"
    for service in "${RELEASE_SERVICES[@]}"; do
      container="$($COMPOSE ps -a -q "$service" 2>/dev/null | head -1)"
      if [ -z "$container" ]; then
        echo "service=$service container=missing"
        continue
      fi
      image_id="$(docker inspect "$container" --format '{{.Image}}')"
      printf 'service=%s running=%s health=%s image_ref=%s image_id=%s revision=%s release_env=%s\n' \
        "$service" \
        "$(docker inspect "$container" --format '{{.State.Running}}')" \
        "$(docker inspect "$container" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}')" \
        "$(docker inspect "$container" --format '{{.Config.Image}}')" \
        "$image_id" \
        "$(docker inspect "$image_id" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' 2>/dev/null || true)" \
        "$(docker inspect "$container" --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n 's/^CC_RELEASE_SHA=//p' | head -1)"
    done
  } >"$output"
}

on_exit() {
  local status=$?
  if [ "$status" -ne 0 ] && [ "$DEPLOY_STARTED" = true ]; then
    set +e
    capture_state failed "$FAILURE_RECEIPT"
    echo "DEPLOY_ERROR: partial-state receipt written to $FAILURE_RECEIPT" >&2
  fi
  exit "$status"
}
trap on_exit EXIT

capture_state rollback_point "$ROLLBACK_RECEIPT"
echo "== rollback receipt: $ROLLBACK_RECEIPT =="
echo "== deploying Control Center $TARGET_SHA =="
echo "== compose-derived release services: ${RELEASE_SERVICES[*]} =="

DEPLOY_STARTED=true
$COMPOSE build "${RELEASE_SERVICES[@]}"
$COMPOSE up -d --wait --wait-timeout "${CC_RELEASE_WAIT_TIMEOUT:-240}" \
  "${RELEASE_SERVICES[@]}" caddy

assert_http_status() {
  local expected="$1" label="$2"
  shift 2
  local actual
  actual="$(curl --silent --show-error --max-time 15 -o /dev/null -w '%{http_code}' "$@")"
  if [ "$actual" != "$expected" ]; then
    echo "HEALTH_ERROR: $label expected HTTP $expected, got $actual" >&2
    return 1
  fi
  echo "$label=$actual"
}

{
  echo "schema_version=control-center.release-receipt.v1"
  echo "deployed_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "release_sha=$TARGET_SHA"
  echo "services=${RELEASE_SERVICES[*]}"
  cd "$REPO_ROOT"
  "$OVERLAY_DIR/verify-release.sh" "$TARGET_SHA"
  assert_http_status 200 loopback_health -H 'Host: ops.confenge.com.br' http://127.0.0.1:18080/healthz
  assert_http_status 302 public_ops https://ops.confenge.com.br/
  assert_http_status 200 public_auth https://auth.ops.confenge.com.br/
} | tee "$FINAL_RECEIPT"

DEPLOY_STARTED=false
trap - EXIT
echo "GO:CONTROL_CENTER_RELEASE_CONVERGED"
echo "receipt=$FINAL_RECEIPT"
