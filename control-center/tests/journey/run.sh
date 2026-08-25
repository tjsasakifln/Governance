#!/usr/bin/env bash
# Founder journey in a real browser, end to end through the real Context
# Service and the real human-gate connector, against a faithful stand-in for
# the Warmbly backend.
#
# Production sits behind Authelia two_factor, which must not be bypassed, so
# fake-edge injects the same Remote-* forward-auth headers Caddy injects AFTER
# Authelia has authenticated. It reproduces the contract downstream of the
# boundary; it does not weaken the boundary.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CC="$(cd "$HERE/../.." && pwd)"
APP="$CC/apps/web-shell"
WORK="$(mktemp -d)"

WPORT=${WPORT:-8099}; CPORT=${CPORT:-8098}; SPORT=${SPORT:-8097}; EPORT=${EPORT:-8096}
# A second edge+shell pair whose forward-auth identity carries both groups.
# APPROVE stays with operators; only idempotent approval reconciliation is
# admins-only. The two fixed identities prove both sides of that boundary.
EPORT2=${EPORT2:-8095}; SPORT2=${SPORT2:-8094}
TOKEN=stub-operator-token
TOKFILE="$WORK/token"; printf %s "$TOKEN" > "$TOKFILE"

PIDS=()
# npx tsx and npx vite fan out into a child chain, so killing only the pid we
# backgrounded orphans the server and leaves its port held for the next run.
# Sweep the ports we own as well.
cleanup() {
  for p in "${PIDS[@]:-}"; do kill "$p" 2>/dev/null; done
  for port in $WPORT $CPORT $SPORT $EPORT $EPORT2 $SPORT2; do
    for pid in $(lsof -t -i ":$port" -sTCP:LISTEN 2>/dev/null); do kill "$pid" 2>/dev/null; done
  done
  rm -rf "$WORK"
}
trap cleanup EXIT

# serve-prod.mjs serves dist/, which is not tracked by git. An absent or stale
# bundle would serve a UI older than the one under test, so build first: a
# journey that proves the previous release is worse than no journey.
echo "building the web shell the journey will drive..."
if ! ( cd "$APP" && npm run build ) >"$WORK/build.log" 2>&1; then
  echo "web shell build failed"; tail -30 "$WORK/build.log"; exit 1
fi

PORT=$WPORT TOKEN=$TOKEN node "$HERE/fake-warmbly.mjs" > "$WORK/warmbly.log" 2>&1 & PIDS+=($!)

( cd "$CC" && HOST=127.0.0.1 PORT=$CPORT NODE_ENV=test \
  CONTEXT_SERVICE_FIXTURE=representative \
  CONTROL_CENTER_FOUNDER_ACTOR_ID=founder-local \
  CC_WARMBLY_OPERATOR_ENABLED=true \
  CC_WARMBLY_BASE_URL=http://127.0.0.1:$WPORT \
  CC_WARMBLY_OPERATOR_TOKEN_FILE="$TOKFILE" \
  CC_WARMBLY_OPERATOR_TRUSTED_HOPS=127.0.0.1/32 \
  CC_OPERATOR_ACTION_TRUSTED_HOPS=127.0.0.1/32 \
  CC_TRUSTED_PROXY_CIDRS=127.0.0.1/32 \
  npx tsx "$HERE/boot-gate-context.ts" > "$WORK/context.log" 2>&1 ) & PIDS+=($!)

PORT=$EPORT UPSTREAM_PORT=$CPORT EDGE_GROUPS="${EDGE_GROUPS:-operators}" \
  node "$HERE/fake-edge.mjs" > "$WORK/edge.log" 2>&1 & PIDS+=($!)

( cd "$APP" && HOST=127.0.0.1 PORT=$SPORT CC_CONTEXT_UPSTREAM=http://127.0.0.1:$EPORT \
  CC_ACTOR_ID=founder-local CC_ACTOR_KIND=human \
  node scripts/serve-prod.mjs > "$WORK/web.log" 2>&1 ) & PIDS+=($!)

PORT=$EPORT2 UPSTREAM_PORT=$CPORT EDGE_GROUPS="operators,admins" \
  node "$HERE/fake-edge.mjs" > "$WORK/edge-admin.log" 2>&1 & PIDS+=($!)

( cd "$APP" && HOST=127.0.0.1 PORT=$SPORT2 CC_CONTEXT_UPSTREAM=http://127.0.0.1:$EPORT2 \
  CC_ACTOR_ID=founder-local CC_ACTOR_KIND=human \
  node scripts/serve-prod.mjs > "$WORK/web-admin.log" 2>&1 ) & PIDS+=($!)

for i in $(seq 1 80); do curl -fsS "http://127.0.0.1:$CPORT/healthz" >/dev/null 2>&1 && break; sleep 0.5; done
for i in $(seq 1 60); do curl -fsS "http://127.0.0.1:$SPORT/healthz" >/dev/null 2>&1 && break; sleep 0.5; done
for i in $(seq 1 60); do curl -fsS "http://127.0.0.1:$SPORT2/healthz" >/dev/null 2>&1 && break; sleep 0.5; done

gate=$(curl -s -o /dev/null -w '%{http_code}' -H 'x-actor-id: founder-local' -H 'x-actor-kind: human' "http://127.0.0.1:$SPORT/v1/warmbly/operator/cohorts")
echo "gate through the shell: $gate"
if [ "$gate" != "200" ]; then
  echo "the human gate is not reachable through the shell; the journey would prove nothing"
  tail -20 "$WORK/context.log"; exit 1
fi

( cd "$APP" && node "$HERE/journey.mjs" "http://127.0.0.1:$SPORT" "http://127.0.0.1:$SPORT2" )
