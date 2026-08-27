# production-edge overlay

Canonical compose: `docker-compose.production-edge.yml`.

- Caddy publishes `127.0.0.1:18080` and optional `127.0.0.1:18443` only.
- Redis 7, Authelia, unpublished Postgres (`control_center` + `authelia` roles).
- Datastores on `cc_internal` (`internal: true`). Edge traffic on `cc_edge`.
- Collector has no datastore/volume access. Production release apply always
  includes its read-only Warmbly network via
  `docker-compose.warmbly-collector.override.yml` and requires the host-owned
  `/etc/confenge/control-center/docker-compose.collector-env.yml`. The wrapper
  `release-compose.sh` is the single compose entrypoint for release apply and
  verification, so a recreate cannot silently drop either overlay.
- The human gate uses the separately reviewed `docker-compose.warmbly-human-gate.override.yml`: only `context` joins Warmbly's application network and receives a file-backed, permission-mask `196` credential. It exposes no send route.

Canonical production apply is `control-center/deploy/PRODUCTION-RUNBOOK.md`. Compose project `confenge-control-center` **is** the production project.

`deploy-release.sh <full-origin-main-sha>` derives every release-stamped service
from normalized compose, builds and waits for the complete set, verifies the
same set, and writes mode-0600 rollback/final receipts outside the checkout.

Isolated rehearsal (does not use the production project name): `rehearse-isolated.sh` (`--project-name cc-edge-rehearsal`, host ports 28080/28443).
