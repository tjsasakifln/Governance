#!/usr/bin/env bash
# Reconcile compose -> repository SHA -> image -> container -> runtime health.
# Usage: verify-release.sh <expected-sha>
set -euo pipefail

EXPECTED="${1:-}"
BASELINE="64ece7d38abacd3adeaa02735b4f22af66caab0f"
if [ "$#" -ne 1 ] || [[ ! "$EXPECTED" =~ ^[0-9a-f]{40}$ ]]; then
  echo "FAIL release: pass exactly one full lowercase 40-character commit identity"
  exit 1
fi
if ! git cat-file -e "${EXPECTED}^{commit}" 2>/dev/null; then
  echo "FAIL release: expected SHA is not a commit in this repository"
  exit 1
fi
REPOSITORY_HEAD="$(git rev-parse HEAD 2>/dev/null)" || {
  echo "FAIL release: repository HEAD could not be resolved"
  exit 1
}
if [ "$REPOSITORY_HEAD" != "$EXPECTED" ]; then
  echo "FAIL release: checkout HEAD ${REPOSITORY_HEAD} does not exactly match expected ${EXPECTED}"
  exit 1
fi
SOURCE_STATUS="$(git status --porcelain=v1 --untracked-files=all)" || {
  echo "FAIL release: repository source status could not be inspected"
  exit 1
}
if [ -n "$SOURCE_STATUS" ]; then
  echo "FAIL release: checkout contains tracked or untracked changes; image provenance is not reproducible"
  exit 1
fi
if ! git merge-base --is-ancestor "$BASELINE" "$EXPECTED"; then
  echo "FAIL release: ${EXPECTED} does not descend from required baseline ${BASELINE}"
  exit 1
fi

REPO_ROOT="$(git rev-parse --show-toplevel)"
OVERLAY_DIR="$REPO_ROOT/control-center/deploy/overlays/production-edge"
COMPOSE="$OVERLAY_DIR/release-compose.sh"
SERVICE_PARSER="$OVERLAY_DIR/release-services.py"
SECRET_ENV="${CC_SECRET_ENV:-/etc/confenge/control-center/secrets/.env}"
if [ ! -r "$SECRET_ENV" ]; then
  echo "FAIL release: secret environment file is not readable"
  exit 1
fi
set -a
# shellcheck disable=SC1090
. "$SECRET_ENV"
set +a
export CC_RELEASE_SHA="$EXPECTED"
CC_SECRET_DIR="$(dirname "$SECRET_ENV")"
export CC_SECRET_DIR
unset COMPOSE_FILE COMPOSE_PROJECT_NAME
if ! SERVICE_ROWS="$($COMPOSE config --format json | python3 "$SERVICE_PARSER" --expected "$EXPECTED" --format tsv)"; then
  echo "FAIL release: release service set could not be derived from rendered compose"
  exit 1
fi

fail=0
while IFS=$'\t' read -r svc expected_image; do
  [ -n "$svc" ] || continue
  container="$($COMPOSE ps -a -q "$svc" 2>/dev/null | head -1)"
  if [ -z "$container" ] || ! docker inspect "$container" >/dev/null 2>&1; then
    echo "FAIL ${svc}: compose container not found"
    fail=1
    continue
  fi

  image_ref="$(docker inspect "$container" --format '{{.Config.Image}}')"
  image_id="$(docker inspect "$container" --format '{{.Image}}')"
  label="$(docker inspect "$image_id" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' 2>/dev/null || true)"
  service_label="$(docker inspect "$image_id" --format '{{index .Config.Labels "br.com.confenge.service"}}' 2>/dev/null || true)"
  envsha="$(docker inspect "$container" --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n 's/^CC_RELEASE_SHA=//p' | head -1)"
  running="$(docker inspect "$container" --format '{{.State.Running}}')"
  health="$(docker inspect "$container" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}')"
  runtime_http=""
  case "$svc" in
    context) runtime_endpoint="http://127.0.0.1:8080/v1/runtime-identity" ;;
    web) runtime_endpoint="http://127.0.0.1:8080/runtime-identity" ;;
    *) runtime_endpoint="" ;;
  esac
  if [ -n "$runtime_endpoint" ]; then
    runtime_http="$(docker exec "$container" node -e '
      const [endpoint, expectedService, expectedBaseline] = process.argv.slice(1);
      fetch(endpoint, { signal: AbortSignal.timeout(5000) }).then(async (response) => {
        if (!response.ok) throw new Error(`status_${response.status}`);
        const body = await response.json();
        if (body.schema_version !== "control-center.runtime-identity.v1") throw new Error("schema_mismatch");
        if (body.service !== expectedService) throw new Error("service_mismatch");
        if (body.required_baseline_sha !== expectedBaseline) throw new Error("baseline_mismatch");
        if (body.production_required !== true) throw new Error("production_gate_disabled");
        if (body.release_status !== "PINNED") throw new Error("release_not_pinned");
        if (!/^[0-9a-f]{40}$/.test(String(body.release_sha ?? ""))) throw new Error("release_invalid");
        process.stdout.write(String(body.release_sha ?? ""));
      }).catch(() => process.exit(2));
    ' "$runtime_endpoint" "control-center-${svc}" "$BASELINE" 2>/dev/null || true)"
  fi

  echo "--- ${svc}"
  echo "    image ref   : ${image_ref}"
  echo "    image id    : ${image_id}"
  echo "    image label : ${label:-<none>}"
  echo "    runtime env : ${envsha:-<none>}"
  echo "    runtime HTTP: ${runtime_http:-n/a}"
  echo "    health      : ${health}"

  if [ "$running" != true ] || [ "$health" != healthy ]; then
    echo "    -> FAIL: container is not running and healthy"
    fail=1
  elif [ "$image_ref" != "$expected_image" ]; then
    echo "    -> FAIL: image ref does not match rendered compose"
    fail=1
  elif [ "$service_label" != "$svc" ]; then
    echo "    -> FAIL: image service label ${service_label:-<none>} does not match ${svc}"
    fail=1
  elif [ "$label" != "$EXPECTED" ]; then
    echo "    -> FAIL: image label ${label:-<none>} does not exactly match expected ${EXPECTED}"
    fail=1
  elif [ "$envsha" != "$EXPECTED" ]; then
    echo "    -> FAIL: runtime CC_RELEASE_SHA ${envsha:-<none>} does not exactly match expected ${EXPECTED}"
    fail=1
  elif [ -n "$runtime_endpoint" ] && [ "$runtime_http" != "$EXPECTED" ]; then
    echo "    -> FAIL: runtime HTTP identity ${runtime_http:-<none>} does not exactly match expected ${EXPECTED}"
    fail=1
  elif [ "$svc" = collector ]; then
    if ! docker inspect "$container" --format '{{range .Config.Env}}{{println .}}{{end}}' |
      awk -F= '$1 == "WARMBLY_API_TOKEN" && length($2) > 0 { found=1 } END { exit !found }'; then
      echo "    -> FAIL: collector lost its read-only Warmbly credential"
      fail=1
    elif ! docker inspect "$container" --format '{{json .NetworkSettings.Networks}}' |
      python3 -c 'import json, os, sys; networks=json.load(sys.stdin); raise SystemExit(0 if os.environ.get("WARMBLY_DOCKER_NETWORK", "warmbly-confenge_default") in networks else 1)'; then
      echo "    -> FAIL: collector lost its Warmbly network"
      fail=1
    else
      echo "    -> OK: collector release and read-only observation topology converge"
    fi
  else
    echo "    -> OK: repo, compose, image, runtime and health converge"
  fi
done <<<"$SERVICE_ROWS"

if [ "$fail" -ne 0 ]; then
  echo
  echo "RELEASE VERIFICATION FAILED - health alone is not release evidence"
  exit 1
fi
echo
echo "RELEASE VERIFICATION PASSED for ${EXPECTED}"
