#!/bin/sh
# Create Authelia role + database. Password is read from a Docker secret file.
# Does not print secret material. Does not edit the Postgres image/Dockerfile.
set -eu

PASS_FILE="/run/secrets/authelia_postgres_password"
if [ ! -r "$PASS_FILE" ]; then
  echo "authelia postgres password secret is missing" >&2
  exit 1
fi
AUTHELIA_PASSWORD=$(cat "$PASS_FILE")
if [ -z "$AUTHELIA_PASSWORD" ]; then
  echo "authelia postgres password secret is empty" >&2
  exit 1
fi

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
