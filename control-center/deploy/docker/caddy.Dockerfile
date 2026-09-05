FROM golang:1.26-alpine@sha256:b6890e35ded5d19118c2bca3d7754dc4e6f694aac2d0aeb92f9807c2879e4230 AS caddy-build

# Rebuild the reviewed upstream Caddy release with the fixed Go modules. The
# source commit is the signed v2.11.4 tag target; both source and builder are
# immutable inputs.
ARG CADDY_SOURCE_COMMIT=e2eee6a7fce366321294c9c2a79f3146891dcbdf
RUN apk add --no-cache git \
 && git clone https://github.com/caddyserver/caddy.git /src \
 && cd /src \
 && git checkout --detach "$CADDY_SOURCE_COMMIT" \
 && test "$(git rev-parse HEAD)" = "$CADDY_SOURCE_COMMIT" \
 && go get golang.org/x/crypto@v0.55.0 google.golang.org/grpc@v1.83.1 \
 && go mod tidy \
 && CGO_ENABLED=0 go build -trimpath -buildvcs=false -o /caddy ./cmd/caddy

FROM caddy:2.11-alpine@sha256:5f5c8640aae01df9654968d946d8f1a56c497f1dd5c5cda4cf95ab7c14d58648

# CVE-2026-56854 and CVE-2026-84304 are fixed in the rebuilt official source.
COPY --from=caddy-build /caddy /usr/bin/caddy

# The pinned upstream image predates the Alpine fix for CVE-2026-14456.
# Fail the build unless the reviewed fixed floor is available.
RUN apk add --no-cache --upgrade 'libcrypto3>=3.5.8-r0' 'libssl3>=3.5.8-r0'

# CVE-2026-11352/11586/12064/8286/8458/8925/8927/9547 in curl/libcurl: fixed
# in 8.22.0-r0. Fail the build unless the reviewed fixed floor is available.
RUN apk add --no-cache --upgrade 'curl>=8.22.0-r0' 'libcurl>=8.22.0-r0'

# BusyBox wget is already in this image; do not apk-add a healthcheck chain.
# Default hook; compose also bind-mounts Caddyfile so operators can edit without rebuild.
COPY Caddyfile /etc/caddy/Caddyfile
