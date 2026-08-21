# production-edge overlay

Canonical compose: `docker-compose.production-edge.yml`.

- Caddy publishes `127.0.0.1:18080` and optional `127.0.0.1:18443` only.
- Redis 7, Authelia, unpublished Postgres (`control_center` + `authelia` roles).
- Datastores on `cc_internal` (`internal: true`). Edge traffic on `cc_edge`.
- Collector has no datastore/volume access. Warmbly network is opt-in via `docker-compose.warmbly-collector.override.yml`.

Canonical production apply is `control-center/deploy/PRODUCTION-RUNBOOK.md`. Compose project `confenge-control-center` **is** the production project.

Isolated rehearsal (does not use the production project name): `rehearse-isolated.sh` (`--project-name cc-edge-rehearsal`, host ports 28080/28443).
