# production-edge overlay

Canonical compose: `docker-compose.production-edge.yml`.

- Caddy publishes `127.0.0.1:18080` and optional `127.0.0.1:18443` only.
- Redis 7, Authelia, unpublished Postgres (`control_center` + `authelia` roles).
- Datastores on `cc_internal` (`internal: true`). Edge traffic on `cc_edge`.
- Collector has no datastore/volume access. Warmbly network is opt-in via `docker-compose.warmbly-collector.override.yml`.

Do **not** `docker compose up` this file as project `confenge-control-center` in this campaign. Rehearsal: `rehearse-isolated.sh` (`--project-name cc-edge-rehearsal`, host ports 28080/28443).
