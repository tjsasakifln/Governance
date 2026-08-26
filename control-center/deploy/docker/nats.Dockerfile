FROM nats:2.12.6-alpine@sha256:1cfc36e2e5e638243d8c722f72c954cd0ec4b15ee82fadbc718ce12e2b3c1652

# Keep the reviewed NATS application patch while consuming the available
# Alpine fix for CVE-2026-14456. The lower bound makes stale mirrors fail closed.
RUN apk add --no-cache --upgrade 'libcrypto3>=3.5.8-r0' 'libssl3>=3.5.8-r0'
