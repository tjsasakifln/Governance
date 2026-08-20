FROM postgres:16-alpine

# UTC internally. Presentation (America/Sao_Paulo) belongs to consumers, not this cluster.
ENV TZ=UTC
ENV PGTZ=UTC

COPY docker/postgres/init-control-center.sql /docker-entrypoint-initdb.d/001-control-center.sql
