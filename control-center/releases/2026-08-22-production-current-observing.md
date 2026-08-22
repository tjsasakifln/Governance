# Production-current observing evidence — 2026-08-22

Campaign `CONFENGE-GOVERNANCE-CONTROL-CENTER-FINAL-PRODUCTION-01`.

**FINAL_VERDICT=CONTROL_CENTER_PRODUCTION_CURRENT_AND_OBSERVING**

Control Center production checkout and collector image are on approved `origin/main` after PRs #44 / #45 / #46. MFA, edge, and persistence are healthy. A live Warmbly collector cycle persists commercial and clients snapshots, keeps intel `exceptions_total` distinct from the shown cap, and does not repeat `persist_partial` from payloads over 512 KiB. Control Center has no `SEND_EMAIL` capability and did not mutate Warmbly. The first bounded email cohort is not dispatched; observation is live and ready.

## SHA

- `MAIN_SHA` / `DEPLOYED_SHA` / operational code SHA: `e1f9b6920adb080672da4fc68c92f633e1e8322e` (`fix(control-center): keep mapper intel_exceptions_total (PR 46)`).
- Host checkout `/opt/confenge-control-center` is that SHA (detached HEAD). Host-only overlay: Authelia `auth_secure_headers` on the production Caddyfile (HSTS/CSP for `auth.ops`); backups of that file are untracked. Not reverted.
- Collector image `confenge-control-center-collector:local` `sha256:de64f55a1ce5016957fdb7fc453b40f2de62b02fef5431ea445ac55301041a0e` created `2026-08-22T00:27:14Z` (after PR #46 merge). Web/context/mcp images remain the post-#44 build; PRs #45/#46 did not change those services. No aesthetic rebuild this round.
- This evidence commit, if merged, is documentation only. Runtime images stay on `e1f9b69`. Host git checkout is fast-forwarded to the new `origin/main` after merge so `DEPLOYED_SHA` tracks current main without restarting services.
- Governance PR #8 remains open and was not opened, edited, merged, or absorbed.

## Topology / edge

Project `confenge-control-center` on `v2202607385716487230` (`159.195.18.88`).

- nginx `:80`/`:443` → Caddy `127.0.0.1:18080` → Authelia `forward_auth` → web/context.
- Public `/ready` on ops Host = 404. Caddy `/healthz` `{"status":"ok"}` twice.
- Internal `/ready` twice, non-empty JSON `"ready": true` for context, collector, web, mcp.
- Postgres alias `cc-postgres`. Collector `CONTROL_CENTER_DATABASE_URL` host `cc-postgres`.
- Reserved IPs unchanged: Caddy `10.89.0.2`, context `10.89.0.4`, MCP `10.89.0.6`, collector `10.89.0.7`.
- Unauthenticated `https://ops.confenge.com.br/` → 302 Authelia. `https://auth.ops.confenge.com.br/` 200.
- MFA enforced: `totp_configurations=1`, `webauthn_credentials=1`, Authelia policy `two_factor`. MFA was not disabled.
- Encrypted backups present under `/var/backups/confenge-control-center/encrypted/` (latest `cc-pg-2026-08-21T23-37-47-797Z.dump.enc` + sidecar meta). Not restored over production.
- MCP private + bearer. No `mcp.confenge.com.br`.

## Tests (this round, `e1f9b69`)

| Suite | Result |
| --- | --- |
| `@confenge/control-center-collector` persist-payload, persist-project, projectors | 32 pass |
| `@confenge/control-center-warmbly-connector` collect, envelope, http-safety | 27 pass |
| `@confenge/control-center-web-shell` honesty-http, commercial-ops | 76 pass |
| `@confenge/control-center-context` operator-actions + operator-actions-pg | 50 pass |
| `@confenge/control-center-persistence` operator-actions + migrate/invariants | 32 pass |
| `@confenge/control-center-contracts` | 99 pass |
| `@confenge/control-center-commercial-readmodel` mutation-surface | 23 pass |
| `@confenge/control-center-deploy` including backup encrypt/verify/restore | 20 pass |
| image-scan | skipped (no image rebuild) |
| Playwright e2e | local `libnspr4` missing; UI unchanged this round. Prior CI e2e on `80e75e6` (PR #44) remains the UI bar |

No P0/P1 found. Existing tests that assert persist truncation, `exceptions_total`/`exceptions_shown`/`exceptions_capped`, optional-upstream 5xx as gap, honesty HTTP, `SEND_EMAIL` refusal, and operator idempotency still pass.

## Collector (live, post-#45/#46)

Canonical evidence run (scheduler tick, not a local re-implementation):

- `run_id`: `cc:collector-run:01M0KJH82KGT6TG319BJ16HDCT`
- `status`: `DONE` (not `PARTIAL`)
- `freshness_status`: `FRESH`
- `error_code`: null
- `stats`: `projected=2`, `collectFailed=false`, `snapshotFailed=false`, `observationFailed=false`
- observation `cc:source-observation:01M0KJH832ME7RAWJHSFBHSTDM` (182649 bytes, `_persist_truncation` absent)
- commercial snapshot `cc:operational-snapshot:01M0KJH83XKGZVEFJ2SEGAHHCV` (338827 bytes < 512 KiB, FRESH)
- clients snapshot `cc:operational-snapshot:01M0KJH84Z9BT1NGFST7FGC71J` (441 bytes; `client_360=partial_warmbly_only`)

Intel exceptions: `exceptions_total=362`, `exceptions_shown=50`, `exceptions_capped=true`. Live Warmbly `GET /v1/confenge/intel/exceptions` array length 362. Shown list is capped; total is the real total.

Optional `GET /v1/campaigns` is HTTP 500 (`Warmbly upstream 500 on /v1/campaigns`). `GET /v1/campaigns-overview` is 200. Required CRM/intel reads are 200. Envelope freshness remains `FRESH` (optional 5xx did not contaminate required truth). `GET /v1/confenge/ops/health` is 404 (documented gap). Asaas latest is `UNKNOWN` (not FRESH). PNCP is `DONE`/`ERROR` honest (`SOURCE_UNCONFIGURED`).

Historical `persist_partial` (4 Warmbly runs, 2026-08-21 23:40–23:56 UTC, post-#44 pre-#45) did not recur after the collector rebuild. Every Warmbly finish since `2026-08-22T00:27Z` is `DONE`.

Warmbly read-only credential is already injected as `WARMBLY_API_TOKEN` on the collector (host overlay `/etc/confenge/control-center/docker-compose.collector-env.yml`). Not a human password. Not `SEND_CAMPAIGNS`. Intel GETs used that credential.

Observed `auto_send`: `{enabled: false, observed: false, source: "warmbly.confenge.status"}`.

## Commercial surfaces

Authenticated/internal hop `GET /v1/domains/commercial?scope=commercial` twice: HTTP 200, `cache-control: no-store`, 316543 bytes, same snapshot. Cockpit hashes:

- `#/comercial` / `#/comercial/visao` (Visão)
- `#/comercial/cohorts` (Coortes)
- `#/comercial/atividade`
- `#/comercial/pipeline`
- `#/comercial/excecoes`
- `#/crescimento`

Semantics on the live read model: `reply_rate.denominator` is contacted (0 on empty windows; ratio omitted, not fabricated). Acquisition join rule is `durable_contact_account_or_lead_id`. Inbound-truth scoreboard is labeled separately from acquisition cohorts. `route_class` / `cohort_id` / `policy_version` / `provider` are absent (null) because Warmbly did not supply them — not invented. Attempted / delivered / bounce / reply are not fabricated for an undispatched cohort.

`POST /v1/operator-actions` with `SEND_EMAIL` → HTTP 403 `operator_action_forbidden`. Table contains `ACKNOWLEDGE_EXCEPTION=1`, `SEND_EMAIL=0`. Connector allowlist has no send/start/import/resolve mutation.

## Warmbly (observe only)

- Production SHA `CONFENGE_REPOSITORY_SHA=c8128f1e9baf8f67d97021530c7d0cbcbc707612` (checkout `/opt/warmbly-confenge`, PR #105). Backend started `2026-08-21T23:05:25Z`. **Not restarted this round.**
- `/ready`: `live=true` `ready=true`.
- `CONFENGE_AUTO_SEND_ENABLED=false`. `CONFENGE_GREEN_AUTORUN_ENABLED=false`.
- `GET /v1/confenge/status`: `auto_send_enabled=false`, `require_human_approval=true`, `pilot_cohort_state=ready`, prepared=10, approved=0, sent=0.
- Intel scoreboard: `dispatch_attempted=false`, `auto_send_enabled=false`, `include_synthetic=false`.
- `https://api.confenge.com.br/api/v1/webhooks/confenge/inbound/health` READY, `auto_send_enabled=false`, `dispatch_attempted=false` (twice).
- Campaigns overview: total=1, draft=1, active=0.

Control Center did not POST resolve, send, authorize, or enroll.

## First cohort

Not dispatched. Prepared bounded cohort exists (`pilot_cohort_prepared=10`, `sent=0`). No events invented. Last live recheck is collector run `01M0KJH82KGT6TG319BJ16HDCT` with commercial snapshot persisted. Observation is ready.

## Gaps (honest, not closed by fixture)

- First bounded email cohort not yet dispatched (`dispatch_attempted=false`, `pilot_cohort_sent=0`).
- Client 360 is `partial_warmbly_only`. Not complete. Asaas/Governance client sources UNKNOWN.
- GSC/GA4 not live-proven. Organic scoreboard recommendation `NEEDS_WEB_CFG_EVENT`.
- Asaas collector `UNKNOWN` (secret/upstream). Not declared proven.
- Optional Warmbly `GET /v1/campaigns` still 500; overview + required CRM remain the truth plane.
- PNCP `ERROR` / `SOURCE_UNCONFIGURED`.
- Local Playwright `libnspr4` missing.

## Rollback

Keep volumes `confenge-cc-postgres-edge`. Do not restore the encrypted drill over production. Do not touch Warmbly, host Postgres, extra-cli, or nginx `api.confenge.com.br`. Roll back Control Center images/checkout to `e1f9b6920adb080672da4fc68c92f633e1e8322e` with production-edge compose + host overlays `docker-compose.collector-env.yml` and `docker-compose.web-actor.yml`. Preserve the Authelia Caddyfile host overlay.

Images at evidence time:

| service | image | id |
| --- | --- | --- |
| web | confenge-control-center-web:local | sha256:146ba58d7136a4417a6e8f368cbef75607ebd8da5538663661c270b4b586e30a |
| context | confenge-control-center-context:local | sha256:fb36b6d75cb1ae40c904a32014fccf61ec821b7f0a057514ade5b9f010464191 |
| mcp | confenge-control-center-mcp:local | sha256:cf72a1ae8c8761b392e8f4e5ce46d852c71f854bc1176fd13a1ac2ca222b11cd |
| collector | confenge-control-center-collector:local | sha256:de64f55a1ce5016957fdb7fc453b40f2de62b02fef5431ea445ac55301041a0e |
| postgres | postgres:16-alpine@sha256:cf78e76683b9ca8c5733cbbdce6c9262b45b6767934dd0a95e671f9a0fc20685 | sha256:75f5a96988cdf694a215073c3e9c001b706b371e2f94df3967f2efdec2787f6b |
| caddy | caddy:2.9-alpine@sha256:b4e3952384eb9524a887633ce65c752dd7c71314d2c2acf98cd5c715aaa534f0 | sha256:51f0c496a59a692cbf86a9973f1ecdc68ac444c1b97ac0b87e0ea90f0597fe69 |
| authelia | authelia/authelia:4.39@sha256:1b363e9279e742397966333f364e0876ae02bf5c876de73e83af6d48c57ff51b | sha256:4a87c7d1276f351a9d2b2139a676bb9aba16692825c858523c9c002744d0aa59 |

## Verdict

`CONTROL_CENTER_PRODUCTION_CURRENT_AND_OBSERVING`

Not `READY_FOR_PRODUCTION`. Not `READY_FOR_OPERATIONAL_RELEASE`. Not `GO_FOR_CONTROLLED_EMAIL_PILOT`.
