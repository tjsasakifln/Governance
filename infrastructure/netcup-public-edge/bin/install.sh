#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PACK_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

runtime_port=18100
nginx_enabled_dir=/etc/nginx/conf.d
nginx_user=www-data

while [[ $# -gt 0 ]]; do
  case "$1" in
    --runtime-port)
      runtime_port="${2:?missing runtime port}"
      shift 2
      ;;
    --nginx-enabled-dir)
      nginx_enabled_dir="${2:?missing NGINX enabled dir}"
      shift 2
      ;;
    --nginx-user)
      nginx_user="${2:?missing NGINX user}"
      shift 2
      ;;
    *)
      echo "unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

require_root_or_fixture
validate_runtime_port "$runtime_port"
validate_enabled_dir "$nginx_enabled_dir"

nginx_root="$(root_path /etc/nginx)"
[[ -d "$nginx_root" ]] || {
  echo "NGINX root is absent: $nginx_root" >&2
  exit 1
}

# The first write is a recoverable backup of the existing NGINX tree.
backup_dir="$(root_path /var/backups/confenge-public-edge)"
mkdir -p "$backup_dir"
chmod 0700 "$backup_dir"
backup="$backup_dir/nginx-$(date -u +%Y%m%dT%H%M%S)-$$.tar.gz"
tar -C "${EDGE_ROOT_PREFIX:-/}" -czf "$backup" etc/nginx
chmod 0600 "$backup"

before="$(mktemp)"
after="$(mktemp)"
trap 'rm -f "$before" "$after"' EXIT
protected_vhost_snapshot "$before"

if [[ -z "$EDGE_ROOT_PREFIX" ]]; then
  getent group confenge-web >/dev/null || groupadd --system confenge-web
  if ! id -u confenge-deploy >/dev/null 2>&1; then
    useradd --system --gid confenge-web --home-dir /opt/confenge-web --shell /usr/sbin/nologin confenge-deploy
  fi
  id -u "$nginx_user" >/dev/null 2>&1 || {
    echo "NGINX worker user $nginx_user does not exist; pass --nginx-user explicitly" >&2
    exit 1
  }
  usermod -a -G confenge-web "$nginx_user"
  owner=confenge-deploy
  group=confenge-web
  admin_owner=root
else
  owner="$(id -u)"
  group="$(id -g)"
  admin_owner="$owner"
fi

install -d -m 0755 "$(root_path /opt/confenge-web)"
install -d -m 2750 -o "$owner" -g "$group" "$(root_path /opt/confenge-web/releases)"
install -d -m 2770 -o "$owner" -g "$group" "$(root_path /opt/confenge-web/shared)"
current="$(root_path /opt/confenge-web/current)"
if [[ ! -e "$current" && ! -L "$current" ]]; then
  ln -s releases/PREPARED_NOT_LIVE "$current"
fi

install -d -m 0755 "$(root_path /etc/confenge)" "$(root_path /etc/confenge/web)"
snippet_link="$(root_path /etc/confenge/web/current)"
snippet_target="$(root_path /opt/confenge-web/current/nginx)"
if [[ -L "$snippet_link" ]]; then
  [[ "$(readlink "$snippet_link")" == "$snippet_target" ]] || {
    echo "refusing to replace unexpected $snippet_link" >&2
    exit 1
  }
elif [[ -e "$snippet_link" ]]; then
  echo "refusing to replace non-symlink $snippet_link" >&2
  exit 1
else
  ln -s "$snippet_target" "$snippet_link"
fi

install -d -m 0750 -o "$admin_owner" -g "$group" "$(root_path /var/log/confenge-web)"
install -d -m 0755 "$(root_path /var/lib/letsencrypt/.well-known/acme-challenge)"
install -d -m 0700 "$(root_path /var/lib/confenge-public-edge/transactions)"

available_dir="$(root_path /etc/nginx/confenge-public-edge/available)"
install -d -m 0755 "$available_dir"
install -d -m 0755 "$(root_path "$nginx_enabled_dir")"

enabled_link="$(root_path "$nginx_enabled_dir/confenge.com.br.conf")"
config_path="$(root_path /etc/confenge/web-edge.conf)"
if [[ -L "$enabled_link" && -f "$config_path" ]]; then
  previous_port="$(awk -F= '$1 == "RUNTIME_PORT" { print $2 }' "$config_path")"
  if [[ -n "$previous_port" && "$previous_port" != "$runtime_port" ]]; then
    echo "refusing runtime port change while public site link is enabled" >&2
    exit 1
  fi
elif [[ -e "$enabled_link" ]]; then
  echo "refusing to overwrite non-symlink enabled vhost $enabled_link" >&2
  exit 1
fi

rendered="$(mktemp)"
sed "s/__RUNTIME_PORT__/$runtime_port/g" "$PACK_ROOT/nginx/confenge.com.br.conf.template" >"$rendered"
install -m 0644 "$rendered" "$available_dir/confenge.com.br.conf"
rm -f "$rendered"
install -m 0644 "$PACK_ROOT/nginx/confenge.com.br.acme-http.conf" "$available_dir/confenge.com.br.acme-http.conf"
install -m 0644 "$PACK_ROOT/nginx/runtime-proxy.conf" "$(root_path /etc/nginx/confenge-public-edge/runtime-proxy.conf)"

config_tmp="$(mktemp)"
sed \
  -e "s/^RUNTIME_PORT=.*/RUNTIME_PORT=$runtime_port/" \
  -e "s|^NGINX_ENABLED_DIR=.*|NGINX_ENABLED_DIR=$nginx_enabled_dir|" \
  "$PACK_ROOT/config/edge.conf" >"$config_tmp"
install -m 0640 -o "$admin_owner" -g "$group" "$config_tmp" "$config_path"
rm -f "$config_tmp"

install -d -m 0755 "$(root_path /etc/logrotate.d)" "$(root_path /etc/letsencrypt/renewal-hooks/deploy)"
install -m 0644 "$PACK_ROOT/logrotate/confenge-web" "$(root_path /etc/logrotate.d/confenge-web)"
install -m 0755 "$PACK_ROOT/certbot/confenge-web-nginx-deploy-hook" \
  "$(root_path /etc/letsencrypt/renewal-hooks/deploy/confenge-web-nginx)"

libexec="$(root_path /usr/local/libexec/confenge-public-edge)"
sbin="$(root_path /usr/local/sbin)"
install -d -m 0755 "$libexec" "$sbin"
for script in lib.sh switch.sh rollback.sh readiness.sh; do
  install -m 0755 "$PACK_ROOT/bin/$script" "$libexec/$script"
done
for command in switch rollback readiness; do
  link="$sbin/confenge-web-$command"
  target="$(root_path "/usr/local/libexec/confenge-public-edge/$command.sh")"
  if [[ -L "$link" ]]; then
    [[ "$(readlink "$link")" == "$target" ]] || {
      echo "refusing to replace unexpected command link $link" >&2
      exit 1
    }
  elif [[ -e "$link" ]]; then
    echo "refusing to replace non-symlink command $link" >&2
    exit 1
  else
    ln -s "$target" "$link"
  fi
done

protected_vhost_snapshot "$after"
assert_protected_vhosts_unchanged "$before" "$after"
nginx_configtest

printf '%s\n' \
  "NETCUP_PUBLIC_EDGE_PREPARED" \
  "DNS_UNCHANGED" \
  "CERT_NOT_ASSUMED" \
  "nginx_backup=$backup" \
  "enabled=false" \
  "reloaded=false"
