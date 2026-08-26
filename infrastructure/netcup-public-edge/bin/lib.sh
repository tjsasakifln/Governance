#!/usr/bin/env bash
set -euo pipefail

EDGE_ROOT_PREFIX="${CONFENGE_EDGE_ROOT_PREFIX:-}"
EDGE_NGINX_BIN="${CONFENGE_EDGE_NGINX_BIN:-nginx}"
EDGE_SYSTEMCTL_BIN="${CONFENGE_EDGE_SYSTEMCTL_BIN:-systemctl}"

root_path() {
  local absolute="$1"
  if [[ "$absolute" != /* ]]; then
    echo "path must be absolute: $absolute" >&2
    return 1
  fi
  printf '%s%s' "$EDGE_ROOT_PREFIX" "$absolute"
}

require_root_or_fixture() {
  if [[ -n "$EDGE_ROOT_PREFIX" ]]; then
    if [[ "$EDGE_ROOT_PREFIX" != /* || "$EDGE_ROOT_PREFIX" == "/" ]]; then
      echo "CONFENGE_EDGE_ROOT_PREFIX must be a non-root absolute fixture path" >&2
      return 1
    fi
    return 0
  fi
  if [[ "$(id -u)" -ne 0 ]]; then
    echo "run as root (or set CONFENGE_EDGE_ROOT_PREFIX for an isolated test fixture)" >&2
    return 1
  fi
}

config_value() {
  local key="$1"
  local config
  config="$(root_path /etc/confenge/web-edge.conf)"
  [[ -f "$config" ]] || return 1
  awk -F= -v wanted="$key" '$1 == wanted { value=substr($0, index($0, "=")+1) } END { if (value != "") print value; else exit 1 }' "$config"
}

nginx_configtest() {
  "$EDGE_NGINX_BIN" -t
}

nginx_reload() {
  nginx_configtest
  "$EDGE_SYSTEMCTL_BIN" reload nginx
}

validate_runtime_port() {
  local port="$1"
  [[ "$port" =~ ^[0-9]+$ ]] || {
    echo "runtime port must be numeric" >&2
    return 1
  }
  if (( port < 1024 || port > 65535 )); then
    echo "runtime port must be between 1024 and 65535" >&2
    return 1
  fi
  case "$port" in
    18080|18443|28080|28443)
      echo "runtime port $port is reserved by the Control Center edge/rehearsal" >&2
      return 1
      ;;
  esac
}

validate_enabled_dir() {
  local dir="$1"
  if [[ "$dir" != /etc/nginx/* || "$dir" == *".."* ]]; then
    echo "NGINX enabled dir must stay under /etc/nginx" >&2
    return 1
  fi
}

protected_vhost_snapshot() {
  local output="$1"
  local nginx_root
  nginx_root="$(root_path /etc/nginx)"
  : >"$output"
  [[ -d "$nginx_root" ]] || return 0
  while IFS= read -r -d '' file; do
    if grep -Eq '(^|[^[:alnum:].])(api\.confenge\.com\.br|ops\.confenge\.com\.br|auth\.ops\.confenge\.com\.br)([^[:alnum:].]+|$)' "$file" 2>/dev/null; then
      sha256sum "$file" >>"$output"
    fi
  done < <(find "$nginx_root" -type f -print0 | sort -z)
}

assert_protected_vhosts_unchanged() {
  local before="$1"
  local after="$2"
  if ! cmp -s "$before" "$after"; then
    echo "protected api/ops/auth.ops NGINX files changed; refusing operation" >&2
    diff -u "$before" "$after" >&2 || true
    return 1
  fi
}

atomic_symlink() {
  local target="$1"
  local link="$2"
  local tmp="${link}.tmp.$$"
  ln -s "$target" "$tmp"
  mv -Tf "$tmp" "$link"
}

restore_symlink() {
  local link="$1"
  local previous="$2"
  if [[ -n "$previous" ]]; then
    atomic_symlink "$previous" "$link"
  elif [[ -L "$link" ]]; then
    unlink "$link"
  fi
}

validate_release_sha() {
  local sha="$1"
  [[ "$sha" =~ ^[0-9a-f]{40}([0-9a-f]{24})?$ ]] || {
    echo "release SHA must be a lowercase 40- or 64-hex digest" >&2
    return 1
  }
}

validate_release() {
  local sha="$1"
  validate_release_sha "$sha"
  local release
  release="$(root_path "/opt/confenge-web/releases/$sha")"
  local site="$release/_site"
  local snippets="$release/nginx"
  local required=(
    10-redirects.conf
    20-security-headers.conf
    30-content-types.conf
    40-application-locations.conf
    50-static-location-policy.conf
  )

  [[ -f "$site/index.html" && -f "$site/404.html" ]] || {
    echo "release must contain _site/index.html and _site/404.html" >&2
    return 1
  }
  [[ -f "$site/.well-known/build-info.json" ]] || {
    echo "release must contain _site/.well-known/build-info.json" >&2
    return 1
  }
  local name
  for name in "${required[@]}"; do
    [[ -f "$snippets/$name" ]] || {
      echo "release missing nginx/$name" >&2
      return 1
    }
  done
  if find "$snippets" -type f -perm /022 -print -quit | grep -q .; then
    echo "release NGINX snippets must not be group/world writable" >&2
    return 1
  fi

  local uncommented
  uncommented="$(mktemp)"
  sed 's/[[:space:]]*#.*$//' "$snippets"/*.conf >"$uncommented"
  if grep -Eiq '(^|[;{}[:space:]])(server|server_name|listen|upstream|root|alias|ssl_certificate|ssl_certificate_key|real_ip_header|set_real_ip_from|default_server)[[:space:]{]' "$uncommented"; then
    echo "web-cfg snippets attempted to own Governance NGINX structure/hardening" >&2
    rm -f "$uncommented"
    return 1
  fi
  if grep -Eiq '(^|/)(\.git|\.env|secrets?|store|storage|private)(/|[^[:alnum:]_-]|$)' "$uncommented"; then
    echo "web-cfg snippets attempted to bypass protected path policy" >&2
    rm -f "$uncommented"
    return 1
  fi
  if grep -E 'proxy_pass[[:space:]]+' "$uncommented" | grep -Ev 'proxy_pass[[:space:]]+http://confenge_web_runtime;' >/dev/null; then
    echo "dynamic routes may proxy only to confenge_web_runtime" >&2
    rm -f "$uncommented"
    return 1
  fi
  local application_locations application_text location_count security_include_count proxy_count proxy_hardening_count
  application_locations="$snippets/40-application-locations.conf"
  application_text="$(sed 's/[[:space:]]*#.*$//' "$application_locations")"
  location_count="$(grep -Ec '^[[:space:]]*location[[:space:]]' <<<"$application_text" || true)"
  security_include_count="$(grep -Fc 'include /etc/confenge/web/current/20-security-headers.conf;' <<<"$application_text" || true)"
  proxy_count="$(grep -Ec '^[[:space:]]*proxy_pass[[:space:]]+' <<<"$application_text" || true)"
  proxy_hardening_count="$(grep -Fc 'include /etc/nginx/confenge-public-edge/runtime-proxy.conf;' <<<"$application_text" || true)"
  if (( proxy_hardening_count != proxy_count )); then
    echo "every dynamic proxy route must include Governance runtime proxy hardening" >&2
    rm -f "$uncommented"
    return 1
  fi
  if (( security_include_count != location_count )); then
    echo "every generated application location must include web-cfg security headers explicitly" >&2
    rm -f "$uncommented"
    return 1
  fi
  if sed 's/[[:space:]]*#.*$//' \
    "$snippets/10-redirects.conf" "$snippets/30-content-types.conf" \
    | grep -Eq '^[[:space:]]*add_header[[:space:]]+'; then
    echo "redirect/content-type snippets may not shadow security-header inheritance" >&2
    rm -f "$uncommented"
    return 1
  fi
  rm -f "$uncommented"

  local hsts='Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;'
  if ! grep -Fq "$hsts" "$snippets/20-security-headers.conf"; then
    echo "HSTS must remain max-age=31536000; includeSubDomains; preload in this preparation" >&2
    return 1
  fi

  local observed_sha
  observed_sha="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1], encoding="utf-8")).get("commit", ""))' "$site/.well-known/build-info.json")"
  if [[ "$observed_sha" != "$sha" ]]; then
    echo "release directory SHA does not match build-info commit" >&2
    return 1
  fi
}

validate_certificate_files() {
  local live
  live="$(root_path /etc/letsencrypt/live/confenge.com.br)"
  [[ -r "$live/fullchain.pem" && -r "$live/privkey.pem" ]] || {
    echo "confenge.com.br certificate lineage is absent; certificate is not assumed" >&2
    return 1
  }
  if [[ -z "$EDGE_ROOT_PREFIX" ]]; then
    local san key_mode key_owner
    san="$(openssl x509 -in "$live/fullchain.pem" -noout -ext subjectAltName 2>/dev/null || true)"
    [[ "$san" == *"DNS:confenge.com.br"* && "$san" == *"DNS:www.confenge.com.br"* ]] || {
      echo "certificate SAN must contain confenge.com.br and www.confenge.com.br" >&2
      return 1
    }
    key_mode="$(stat -Lc '%a' "$live/privkey.pem")"
    key_owner="$(stat -Lc '%U' "$live/privkey.pem")"
    [[ "$key_owner" == root && ( "$key_mode" == 600 || "$key_mode" == 640 ) ]] || {
      echo "certificate private key must be root-owned mode 0600 or 0640" >&2
      return 1
    }
  fi
}
