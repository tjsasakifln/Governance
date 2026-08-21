# Internal production evidence — 2026-08-21

Campaign `CONFENGE-CONTROL-CENTER-INTERNAL-PRODUCTION-LAUNCH-01`.

**FINAL_VERDICT=HUMAN_GATE_MFA_ENROLLMENT**

Control Center is deployed, authenticated at the edge, persistent, and usable after founder MFA enrollment. Authelia policy requires 2FA. No TOTP or WebAuthn credential is enrolled yet. MFA was not disabled.

## SHA

- `PRE_RELEASE_SHA` / `RELEASE_SHA` / `DEPLOYED_SHA`: `3d5e21c344be95549cca1e9f0b5073a8efb9ff08`
- `origin/main` matched the expected freeze SHA (no silent drift).
- Governance PR #8 remains open and was not absorbed.

CI on that SHA: control-center, control-center-image-scan, commercial-authority all **success**.

## Topology

nginx `:443` → `127.0.0.1:18080` Caddy → Authelia `forward_auth` → web/context.

- Project `confenge-control-center` on host `v2202607385716487230` (`159.195.18.88`).
- Caddy loopback only (`18080`/`18443`). nginx still owns public 80/443.
- MCP private + bearer. No `mcp.confenge.com.br`.
- Postgres alias `cc-postgres`. Collector `CONTROL_CENTER_DATABASE_URL` host `cc-postgres`.
- Reserved IPs: Caddy `10.89.0.2`, MCP `10.89.0.6`, collector `10.89.0.7`.
- Collector starts without `Dynamic require of events`.

## Auth / MFA

- Unauthenticated `https://ops.confenge.com.br/` → 302 to Authelia.
- `https://auth.ops.confenge.com.br/` 200, TLS Let's Encrypt through 2026-11-19.
- Operators require 2FA (policy). `totp_configurations=0`, `webauthn_credentials=0`.
- Operator user enabled. Recover bootstrap password only from `/root/.confenge/control-center/bootstrap-operator-password` (mode 0600). Never git/logs.

Enrollment:

1. Open https://auth.ops.confenge.com.br/
2. Authenticate with bootstrap operator user/password from that path.
3. Register TOTP or WebAuthn/passkey.
4. Validate login to https://ops.confenge.com.br/
5. Return to this campaign / re-run the goal.

## Data plane

- Migrations: `001_init`, `002_current_state`, `003_durable_operational_data_plane`.
- Governance bootstrap: 74 candidates, 0 unclassifiable; apply-1 inserted 74; apply-2 inserted 0 / skipped 74.
- Required `/v1/*` endpoints 200 with `scope=company` (attention also needs `horizon=today`). None 404.
- Directive smoke ids created; agent POST decision → 403 `agent_mutation_forbidden`.
- MCP `report_session_result` / `report_blocker` → AgentActivity ids listed in the JSON companion.

Collectors (honest):

| Source | Status | Freshness |
| --- | --- | --- |
| github | DONE | FRESH |
| infra | UNKNOWN | UNKNOWN (`missing_credentials` / allowlist) |
| pncp | DONE | ERROR (extra-cli timers failed; not flipped to FRESH) |
| warmbly | FAILED | ERROR (`missing_credentials`) |
| asaas | FAILED | ERROR (`missing_credentials`) |

## Durability

- Encrypted backup + restore to a **new** postgres volume: `same_content=true`, ciphertext ≠ plaintext. Backup kept under `/var/backups/confenge-control-center/encrypted/`.
- Restart of Control Center services only: all healthy; directives, AgentActivity, observations persist. Warmbly not restarted.

## Warmbly / API

- Warmbly SHA `93dd039d7b9b310458beff8a6bd8819a61da6399`, backend `92e98e3217ad…`, restarts=0.
- `/ready` live=true ready=true. `CONFENGE_AUTO_SEND_ENABLED=false`.
- `https://api.confenge.com.br/api/v1/webhooks/confenge/inbound/health` READY, `auto_send_enabled=false`.
- `WARMBLY_REGRESSION=false`. `ASAAS_MUTATIONS=0`. `COMMERCIAL_SENDS=0`.

## Intranet

Not activated. Convenience residual until `OPS_HOST_AUTHENTICATED_AND_HEALTHY=true` (MFA).

## Residuals

- HUMAN_GATE_MFA_ENROLLMENT
- Asaas read / Warmbly read BLOCKED_BY_SECRET (shown as ERROR, not FRESH)
- Infra allowlist UNKNOWN
- PNCP ERROR honest
- Codex MCP client NOT_TESTED_CLIENT_MISSING
