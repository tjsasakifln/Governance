FROM postgres:16-alpine@sha256:cf78e76683b9ca8c5733cbbdce6c9262b45b6767934dd0a95e671f9a0fc20685

# The pinned upstream image predates the Alpine fix for CVE-2026-14456.
# Fail the build unless the reviewed fixed floor is available.
RUN apk add --no-cache --upgrade 'libcrypto3>=3.5.8-r0' 'libssl3>=3.5.8-r0'

# UTC internally. Presentation (America/Sao_Paulo) belongs to consumers, not this cluster.
ENV TZ=UTC
ENV PGTZ=UTC

COPY docker/postgres/init-control-center.sql /docker-entrypoint-initdb.d/001-control-center.sql
