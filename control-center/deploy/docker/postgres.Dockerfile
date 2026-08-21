FROM postgres:16-alpine@sha256:cf78e76683b9ca8c5733cbbdce6c9262b45b6767934dd0a95e671f9a0fc20685

# UTC internally. Presentation (America/Sao_Paulo) belongs to consumers, not this cluster.
ENV TZ=UTC
ENV PGTZ=UTC

COPY docker/postgres/init-control-center.sql /docker-entrypoint-initdb.d/001-control-center.sql
