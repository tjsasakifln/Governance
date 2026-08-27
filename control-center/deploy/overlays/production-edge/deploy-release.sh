#!/usr/bin/env bash
# Roll the Control Center production edge onto an exact repository SHA.
#
# This replaces an unversioned host script that rebuilt only context, mcp and
# web. The collector is built from the same repository and its image tag carries
# the release SHA too, so leaving it out meant a merged connector change (the
# Warmbly payload contract lives in connectors/warmbly) stayed unshipped while
# every health check reported green — and `verify-release.sh collector` would
# have failed if anyone had thought to run it.
#
# Every service whose image tag interpolates CC_RELEASE_SHA must be rebuilt, or
# compose looks for a tag that was never produced.
#
# Usage: deploy-release.sh [sha]     (default: current origin/main)
set -euo pipefail

REPO_ROOT="${CC_REPO_ROOT:-/opt/confenge-control-center}"
SECRET_ENV="${CC_SECRET_ENV:-/etc/confenge/control-center/secrets/.env}"

# Services whose image tag carries the release SHA. Keep in step with
# docker-compose.production-edge.yml; verify-release.sh checks the same set.
RELEASE_SERVICES=(context mcp collector web)
# Started alongside them but not release-stamped.
EDGE_SERVICES=(caddy)

cd "$REPO_ROOT"
git fetch --quiet origin
TARGET_SHA="${1:-$(git rev-parse origin/main)}"
[[ "$TARGET_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "DEPLOY_ERROR: full 40-character SHA required" >&2; exit 1; }
git checkout --quiet -B main "$TARGET_SHA"

# Provenance is only meaningful from a clean checkout. Untracked editor and
# backup leftovers are enough to make the attestation unprovable, so surface
# them here instead of at the end, after the images are already built.
if [ -n "$(git status --porcelain=v1 --untracked-files=all)" ]; then
  echo "DEPLOY_ERROR: checkout is not clean; image provenance would be unprovable:" >&2
  git status --porcelain=v1 --untracked-files=all >&2
  exit 1
fi

export CC_RELEASE_SHA="$TARGET_SHA"
echo "== deploying Control Center $CC_RELEASE_SHA =="

cd control-center/deploy/overlays/production-edge
set -a; . "$SECRET_ENV"; set +a
export CC_SECRET_DIR="$(dirname "$SECRET_ENV")"

COMPOSE="docker compose -f docker-compose.production-edge.yml -f docker-compose.warmbly-human-gate.override.yml"
echo "== building ${RELEASE_SERVICES[*]} =="
$COMPOSE build "${RELEASE_SERVICES[@]}"
echo "== up =="
$COMPOSE up -d "${RELEASE_SERVICES[@]}" "${EDGE_SERVICES[@]}"

echo "== provenance =="
cd "$REPO_ROOT"
./control-center/deploy/overlays/production-edge/verify-release.sh "$CC_RELEASE_SHA" "${RELEASE_SERVICES[@]}"

echo "== health =="
curl -sS -H 'Host: ops.confenge.com.br' -o /dev/null -w 'internal:%{http_code}\n' http://127.0.0.1:18080/healthz
curl -sS -o /dev/null -w 'public:%{http_code} -> %{redirect_url}\n' https://ops.confenge.com.br/
curl -sS -o /dev/null -w 'authelia:%{http_code}\n' https://auth.ops.confenge.com.br/
