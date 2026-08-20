FROM caddy:2.8-alpine

RUN apk add --no-cache wget

# Default hook; compose also bind-mounts Caddyfile so operators can edit without rebuild.
COPY Caddyfile /etc/caddy/Caddyfile
