#!/usr/bin/env bash
# Isolated high-port rehearsal of the production-edge overlay.
# NEVER uses project name confenge-control-center.
# NEVER binds host 80/443. NEVER runs DNS, certbot, or nginx reload.
set -euo pipefail
set +x

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$ROOT/../../../.." && pwd)"
GEN="$REPO/control-center/security/production/secrets/generate-local.sh"
COMPOSE="$ROOT/docker-compose.production-edge.yml"
REHEARSAL="$ROOT/docker-compose.rehearsal.yml"
PROJECT="cc-edge-rehearsal"
SECRET_DIR="${CC_REHEARSAL_SECRET_DIR:-}"

if [[ "${PROJECT}" == "confenge-control-center" ]]; then
  echo "refusing productive project name" >&2
  exit 2
fi

if [[ -z "$SECRET_DIR" ]]; then
  SECRET_DIR="$(mktemp -d /tmp/cc-edge-rehearsal-secrets.XXXXXX)"
fi
mkdir -p "$SECRET_DIR"
chmod 700 "$SECRET_DIR"

cleanup() {
  docker compose -p "$PROJECT" -f "$COMPOSE" -f "$REHEARSAL" down -v --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

env -u CI -u GITHUB_ACTIONS "$GEN" "$SECRET_DIR" >/dev/null

set -a
# shellcheck disable=SC1091
source "$SECRET_DIR/.env"
set +a
export CC_SECRET_DIR="$SECRET_DIR"

wait_http() {
  local url="$1"
  local host="$2"
  local expect="$3"
  local i=0
  local body=""
  while [[ $i -lt 60 ]]; do
    body="$(curl -sS -m 2 -H "Host: $host" "$url" || true)"
    if [[ "$body" == "$expect" ]]; then
      return 0
    fi
    i=$((i + 1))
    sleep 2
  done
  echo "timeout waiting for $url host=$host" >&2
  echo "last body: $body" >&2
  docker compose -p "$PROJECT" -f "$COMPOSE" -f "$REHEARSAL" ps -a >&2 || true
  docker logs cc-edge-rehearsal-authelia-1 >&2 || true
  docker logs cc-edge-rehearsal-caddy-1 >&2 || true
  docker logs cc-edge-rehearsal-postgres-1 >&2 || true
  return 1
}

docker compose -p "$PROJECT" -f "$COMPOSE" -f "$REHEARSAL" up -d postgres redis nats authelia caddy

echo "waiting for datastore and edge readiness"
wait_http "http://127.0.0.1:28080/healthz" "ops.confenge.com.br" '{"status":"ok"}'
wait_http "http://127.0.0.1:28080/livez" "ops.confenge.com.br" '{"status":"ok"}'

health="$(curl -sS -m 5 -H 'Host: ops.confenge.com.br' http://127.0.0.1:28080/healthz)"
live="$(curl -sS -m 5 -H 'Host: ops.confenge.com.br' http://127.0.0.1:28080/livez)"
if [[ "$health" != '{"status":"ok"}' || "$live" != '{"status":"ok"}' ]]; then
  echo "health body mismatch" >&2
  exit 1
fi

ready_code="$(curl -sS -m 5 -o /dev/null -w '%{http_code}' -H 'Host: ops.confenge.com.br' http://127.0.0.1:28080/ready || true)"
mcp_public="$(curl -sS -m 5 -o /dev/null -w '%{http_code}' -H 'Host: ops.confenge.com.br' http://127.0.0.1:28080/mcp || true)"
if [[ "$ready_code" != "404" ]]; then
  echo "/ready must not be public on ops Host; got $ready_code" >&2
  exit 1
fi
if [[ "$mcp_public" != "404" ]]; then
  echo "/mcp must not be public on ops Host; got $mcp_public" >&2
  exit 1
fi

docker compose -p "$PROJECT" -f "$COMPOSE" -f "$REHEARSAL" ps postgres redis authelia caddy nats

echo "REHEARSAL_OK"
