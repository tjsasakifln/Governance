#!/usr/bin/env bash
# Reconcile repository SHA -> image digest -> running container for the
# control-center services. "Health 200" only proves a process answered; it
# says nothing about which code answered. This script is the acceptance gate.
#
# Usage: verify-release.sh <expected-sha> [service...]
set -euo pipefail

EXPECTED="${1:?usage: verify-release.sh <expected-sha> [service...]}"
shift || true
BASELINE="64ece7d38abacd3adeaa02735b4f22af66caab0f"
if [[ ! "$EXPECTED" =~ ^[0-9a-f]{40}$ ]]; then
  echo "FAIL release: expected SHA must be the full lowercase 40-character commit identity"
  exit 1
fi
if ! git cat-file -e "${EXPECTED}^{commit}" 2>/dev/null; then
  echo "FAIL release: expected SHA is not a commit in this repository"
  exit 1
fi
if ! REPOSITORY_HEAD=$(git rev-parse HEAD 2>/dev/null); then
  echo "FAIL release: repository HEAD could not be resolved"
  exit 1
fi
if [ "$REPOSITORY_HEAD" != "$EXPECTED" ]; then
  echo "FAIL release: checkout HEAD ${REPOSITORY_HEAD} does not exactly match expected ${EXPECTED}"
  exit 1
fi
if ! SOURCE_STATUS=$(git status --porcelain=v1 --untracked-files=all); then
  echo "FAIL release: repository source status could not be inspected"
  exit 1
fi
if [ -n "$SOURCE_STATUS" ]; then
  echo "FAIL release: checkout contains tracked or untracked changes; image provenance is not reproducible"
  exit 1
fi
if ! git merge-base --is-ancestor "$BASELINE" "$EXPECTED"; then
  echo "FAIL release: ${EXPECTED} does not descend from required baseline ${BASELINE}"
  exit 1
fi
SERVICES=("$@")
if [ ${#SERVICES[@]} -eq 0 ]; then
  SERVICES=(web context)
fi

fail=0
for svc in "${SERVICES[@]}"; do
  container="confenge-control-center-${svc}-1"
  if ! docker inspect "$container" >/dev/null 2>&1; then
    echo "FAIL ${svc}: container ${container} not found"
    fail=1
    continue
  fi

  image_ref=$(docker inspect "$container" --format '{{.Config.Image}}')
  image_id=$(docker inspect "$container" --format '{{.Image}}')
  label=$(docker inspect "$image_id" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' 2>/dev/null || echo "")
  envsha=$(docker inspect "$container" --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n 's/^CC_RELEASE_SHA=//p' | head -1)
  running=$(docker inspect "$container" --format '{{.State.Running}}')
  runtime_http=""
  case "$svc" in
    context) runtime_endpoint="http://127.0.0.1:8080/v1/runtime-identity" ;;
    web) runtime_endpoint="http://127.0.0.1:8080/runtime-identity" ;;
    *) runtime_endpoint="" ;;
  esac
  if [ -n "$runtime_endpoint" ]; then
    runtime_http=$(docker exec "$container" node -e '
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
    ' "$runtime_endpoint" "control-center-${svc}" "$BASELINE" 2>/dev/null || true)
  fi

  echo "--- ${svc}"
  echo "    container   : ${container} (running=${running})"
  echo "    image ref   : ${image_ref}"
  echo "    image id    : ${image_id}"
  echo "    image label : ${label:-<none>}"
  echo "    runtime env : ${envsha:-<none>}"
  echo "    runtime HTTP: ${runtime_http:-<none>}"

  if [ "$running" != "true" ]; then
    echo "    -> FAIL: container is not running"
    fail=1
    continue
  fi
  if [ -z "$label" ] || [ "$label" = "local" ] || [ "$label" = "unknown" ]; then
    echo "    -> FAIL: image carries no release revision label; it cannot be proven"
    fail=1
    continue
  fi
  if [ "$label" != "$EXPECTED" ]; then
    echo "    -> FAIL: image label ${label} does not exactly match expected ${EXPECTED}"
    fail=1
    continue
  fi
  if [ "$svc" = "context" ] || [ "$svc" = "web" ]; then
    if [ -z "$envsha" ]; then
      echo "    -> FAIL: runtime has no CC_RELEASE_SHA"
      fail=1
      continue
    fi
    if [ "$envsha" != "$EXPECTED" ]; then
      echo "    -> FAIL: runtime CC_RELEASE_SHA ${envsha} does not exactly match expected ${EXPECTED}"
      fail=1
      continue
    fi
    if [ -z "$runtime_http" ]; then
      echo "    -> FAIL: runtime HTTP identity is absent or unpinned"
      fail=1
      continue
    fi
    if [ "$runtime_http" != "$EXPECTED" ]; then
      echo "    -> FAIL: runtime HTTP identity ${runtime_http:-<none>} does not exactly match expected ${EXPECTED}"
      fail=1
      continue
    fi
  fi
  echo "    -> OK: repo ${EXPECTED} reconciles with image label and runtime"
done

if [ "$fail" -ne 0 ]; then
  echo
  echo "RELEASE VERIFICATION FAILED - do not treat this deploy as done"
  exit 1
fi
echo
echo "RELEASE VERIFICATION PASSED for ${EXPECTED}"
