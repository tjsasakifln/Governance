FROM nats:2.12.15-alpine@sha256:b270f5e2428354c0335612694d7dd2fb588148e567a5757fdff325ef9c9332e6

# Keep the reviewed NATS application patch while consuming the available
# Alpine fix for CVE-2026-14456. The lower bound makes stale mirrors fail closed.
RUN apk add --no-cache --upgrade 'libcrypto3>=3.5.8-r0' 'libssl3>=3.5.8-r0'
