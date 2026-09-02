FROM golang:1.26-alpine@sha256:b6890e35ded5d19118c2bca3d7754dc4e6f694aac2d0aeb92f9807c2879e4230 AS nats-build

# Rebuild the reviewed upstream NATS release with Go 1.26.8, which includes
# the fixed standard library for CVE-2026-33818, CVE-2026-39821,
# CVE-2026-56853, CVE-2026-56858, CVE-2026-56859, CVE-2026-56860, and
# CVE-2026-56862. The source commit is the signed v2.12.15 tag target.
ARG NATS_SOURCE_COMMIT=8460a428cf3b27c8627595d630f1ccad55786d13
RUN apk add --no-cache git \
 && git clone https://github.com/nats-io/nats-server.git /src \
 && cd /src \
 && git checkout --detach "$NATS_SOURCE_COMMIT" \
 && test "$(git rev-parse HEAD)" = "$NATS_SOURCE_COMMIT" \
 && GOTOOLCHAIN=local CGO_ENABLED=0 go build -trimpath -buildvcs=false -o /nats-server .

FROM nats:2.12.15-alpine@sha256:b270f5e2428354c0335612694d7dd2fb588148e567a5757fdff325ef9c9332e6

COPY --from=nats-build /nats-server /usr/local/bin/nats-server

# Keep the reviewed NATS application release while consuming the available
# Alpine fix for CVE-2026-14456. The lower bound makes stale mirrors fail closed.
RUN apk add --no-cache --upgrade 'libcrypto3>=3.5.8-r0' 'libssl3>=3.5.8-r0'
