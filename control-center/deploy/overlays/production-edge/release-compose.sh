#!/usr/bin/env bash
# Execute Docker Compose with the complete Control Center production topology.
# The collector environment overlay is host-owned because it references a
# read-only credential. Its contents must never be copied into the repository.
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
COLLECTOR_ENV_COMPOSE="${CC_COLLECTOR_ENV_COMPOSE:-/etc/confenge/control-center/docker-compose.collector-env.yml}"
WEB_ACTOR_COMPOSE="${CC_WEB_ACTOR_COMPOSE:-/etc/confenge/control-center/docker-compose.web-actor.yml}"

if [ ! -r "$COLLECTOR_ENV_COMPOSE" ]; then
  echo "COMPOSE_ERROR: required collector environment overlay is not readable: $COLLECTOR_ENV_COMPOSE" >&2
  exit 1
fi

COMPOSE=(
  docker compose
  --project-name "${CC_COMPOSE_PROJECT:-confenge-control-center}"
  -f "$SCRIPT_DIR/docker-compose.production-edge.yml"
  -f "$SCRIPT_DIR/docker-compose.warmbly-collector.override.yml"
  -f "$SCRIPT_DIR/docker-compose.warmbly-human-gate.override.yml"
  -f "$COLLECTOR_ENV_COMPOSE"
)

# Preserve the existing host-only actor overlay when present. Current compose
# declares the same values, but silently dropping a live overlay during a
# recreate would make rollback evidence incomplete.
if [ -r "$WEB_ACTOR_COMPOSE" ]; then
  COMPOSE+=(-f "$WEB_ACTOR_COMPOSE")
fi

exec "${COMPOSE[@]}" "$@"
