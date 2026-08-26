FROM caddy:2.11-alpine@sha256:5f5c8640aae01df9654968d946d8f1a56c497f1dd5c5cda4cf95ab7c14d58648

# The pinned upstream image predates the Alpine fix for CVE-2026-14456.
# Fail the build unless the reviewed fixed floor is available.
RUN apk add --no-cache --upgrade 'libcrypto3>=3.5.8-r0' 'libssl3>=3.5.8-r0'

# BusyBox wget is already in this image; do not apk-add a healthcheck chain.
# Default hook; compose also bind-mounts Caddyfile so operators can edit without rebuild.
COPY Caddyfile /etc/caddy/Caddyfile
