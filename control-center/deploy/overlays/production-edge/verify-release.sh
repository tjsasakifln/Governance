#!/usr/bin/env bash
# Reconcile repository SHA -> image digest -> running container for the
# control-center services. "Health 200" only proves a process answered; it
# says nothing about which code answered. This script is the acceptance gate.
#
# Usage: verify-release.sh <expected-sha> [service...]
set -euo pipefail

EXPECTED="${1:?usage: verify-release.sh <expected-sha> [service...]}"
shift || true
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

  echo "--- ${svc}"
  echo "    container   : ${container} (running=${running})"
  echo "    image ref   : ${image_ref}"
  echo "    image id    : ${image_id}"
  echo "    image label : ${label:-<none>}"
  echo "    runtime env : ${envsha:-<none>}"

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
  # Accept a short SHA prefix so a 12-character tag reconciles with a full SHA.
  case "$EXPECTED" in
    "$label"*) ;;
    *) echo "    -> FAIL: image label ${label} does not match expected ${EXPECTED}"; fail=1; continue ;;
  esac
  if [ -n "$envsha" ]; then
    case "$EXPECTED" in
      "$envsha"*) ;;
      *) echo "    -> FAIL: runtime CC_RELEASE_SHA ${envsha} does not match expected ${EXPECTED}"; fail=1; continue ;;
    esac
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
