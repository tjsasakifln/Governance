#!/bin/sh
# Create Authelia role + database. Password is read from a Docker secret file.
# Does not print secret material. Does not edit the Postgres image/Dockerfile.
set -eu

# The official postgres image reads *_FILE secrets as root, then runs this
# script as uid postgres, which cannot read 0600 Docker secret files.
# Inject the Authelia role password via env (same value as Docker secret).
if [ -z "${AUTHELIA_POSTGRES_PASSWORD:-}" ]; then
  echo "AUTHELIA_POSTGRES_PASSWORD is missing" >&2
  exit 1
fi
AUTHELIA_PASSWORD="$AUTHELIA_POSTGRES_PASSWORD"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set=authelia_password="$AUTHELIA_PASSWORD" <<'SQL'
CREATE USER authelia WITH PASSWORD :'authelia_password';
CREATE DATABASE authelia OWNER authelia;
GRANT ALL PRIVILEGES ON DATABASE authelia TO authelia;
SQL

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname authelia <<'SQL'
GRANT ALL ON SCHEMA public TO authelia;
ALTER SCHEMA public OWNER TO authelia;
SQL

unset AUTHELIA_PASSWORD
