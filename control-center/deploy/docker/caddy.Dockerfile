FROM caddy:2.11-alpine@sha256:5f5c8640aae01df9654968d946d8f1a56c497f1dd5c5cda4cf95ab7c14d58648

# BusyBox wget is already in this image; do not apk-add a healthcheck chain.
# Default hook; compose also bind-mounts Caddyfile so operators can edit without rebuild.
COPY Caddyfile /etc/caddy/Caddyfile
