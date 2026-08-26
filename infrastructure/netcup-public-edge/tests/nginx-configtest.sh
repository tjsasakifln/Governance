#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PACK_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
web_cfg_contract_dir="${WEB_CFG_CONTRACT_DIR:-$PACK_ROOT/nginx/fixtures/web-cfg}"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

mkdir -p "$work/cert" "$work/log" "$work/site/.well-known" "$work/acme/.well-known/acme-challenge"
printf '<!doctype html><title>edge test</title>\n' >"$work/site/index.html"
printf '<!doctype html><title>not found</title>\n' >"$work/site/404.html"
printf '{"commit":"0000000000000000000000000000000000000000"}\n' >"$work/site/.well-known/build-info.json"

openssl req -x509 -newkey rsa:2048 -nodes -days 1 \
  -keyout "$work/cert/privkey.pem" \
  -out "$work/cert/fullchain.pem" \
  -subj /CN=confenge.com.br \
  -addext 'subjectAltName=DNS:confenge.com.br,DNS:www.confenge.com.br' \
  >/dev/null 2>&1

sed 's/__RUNTIME_PORT__/18100/g' "$PACK_ROOT/nginx/confenge.com.br.conf.template" \
  >"$work/confenge.com.br.conf"

run_configtest() {
  local config="$1"
  docker run --rm \
    -v "$PACK_ROOT/nginx/fixtures/nginx.conf:/etc/nginx/nginx.conf:ro" \
    -v "$config:/etc/nginx/conf.d/confenge.com.br.conf:ro" \
    -v "$PACK_ROOT/nginx/runtime-proxy.conf:/etc/nginx/confenge-public-edge/runtime-proxy.conf:ro" \
    -v "$web_cfg_contract_dir:/etc/confenge/web/current:ro" \
    -v "$work/cert:/etc/letsencrypt/live/confenge.com.br:ro" \
    -v "$work/site:/opt/confenge-web/current/_site:ro" \
    -v "$work/acme:/var/lib/letsencrypt" \
    -v "$work/log:/var/log/confenge-web" \
    nginx:1.27-alpine nginx -t -c /etc/nginx/nginx.conf
}

run_configtest "$work/confenge.com.br.conf"
run_configtest "$PACK_ROOT/nginx/confenge.com.br.acme-http.conf"
printf 'nginx_configtest=PASS full=true http_acme=true\n'
