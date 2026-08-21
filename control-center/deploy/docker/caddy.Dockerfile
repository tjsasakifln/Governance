FROM caddy:2.8-alpine@sha256:af32e97399febea808609119bb21544d0265c58a02836576e32a2d082c262c17

# BusyBox wget is already in this image; do not apk-add a healthcheck chain.
# Default hook; compose also bind-mounts Caddyfile so operators can edit without rebuild.
COPY Caddyfile /etc/caddy/Caddyfile
