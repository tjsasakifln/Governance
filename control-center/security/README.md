# Control Center — security edge

Single-user fail-closed reverse-proxy authentication for the private Confenge Control Center. This is **not** chat, not an ERP, not a homemade identity store, and not a replacement for origin systems.

Ownership path: `control-center/security/` only.

Identity is delegated to **Authelia** (TOTP + WebAuthn) behind **Caddy** `forward_auth`. Agents and HTTP services later consume `Remote-User` / `Remote-Groups` / `Remote-Name` / `Remote-Email` from a trusted hop. They do not receive the whole company memory from this package.

## Decisions

1. No Control Center user database, login UI, or password-reset flow.
2. No “secret URL” as access control. No identity or password hardcoded in source, fixtures, logs, URLs, analytics, or a client bundle.
3. TLS terminates at Caddy. Authelia `/api/authz/forward-auth` is the authorization URI.
4. After a successful forward-auth, Caddy injects `Remote-User Remote-Groups Remote-Name Remote-Email`. The app trusts those headers **only** from `CC_TRUSTED_PROXY_CIDRS` (immediate TCP peer; never `X-Forwarded-For`).
5. Missing, empty, spoofed, or untrusted-source identity is denied (fail-closed).
6. Session: inactivity + expiration; `remember_me` disabled. Cookies: Secure, HttpOnly, SameSite=lax (or strict). CSRF = same-site cookie + CORS deny-by-default.
7. Brute-force: Authelia `regulation` (`max_retries` / `find_time` / `ban_time`). Standard Caddy has no required rate-limit plugin.
8. PostgreSQL, Redis, and NATS stay off the public network (`internal: true`, no public publish). Loopback bind is allowed; `0.0.0.0` is not.
9. Secrets enter via environment variables or secret files. Git holds placeholders only.
10. Public unauthenticated app routes: `/healthz` and `/livez` only. Body is `{"status":"ok"}` — no identity, internals, or operational state.
11. Single human operator (`group:operators`) with MFA. `ActorRef.id` later maps from `Remote-User`; never a password.
12. This wave does not publish DNS, issue public certificates, or change a live host.

See `THREAT-MODEL.md`, `ADAPTER.md`, and `docs/forward-auth.contract.json`.

## Layout

```
src/                 shipped contract, policy parser, validator, CLI
examples/valid/      Caddy + Authelia + compose + policy + health
examples/invalid/    named banned patterns
scripts/consume-validate.ts
threat-model.json
```

## Run validation and tests

Requires Node.js ≥ 20. Do **not** boot Authelia, Caddy, Docker, or a VPS for this package.

```bash
cd control-center/security
npm install
npm test
npm run typecheck
npx tsx src/cli.ts examples/valid
npx tsx src/cli.ts examples/invalid/hardcoded-password
npx tsx scripts/consume-validate.ts examples/valid
```

The CLI prints `ACCEPT` or `REJECT` plus JSON `{ ok, bundle, errors }`. Exit 0 only when accepted. Each error names a control id (`C-FORWARD-AUTH`, `C-SECRET-INJECTION`, …).

## Environment / secret files

No live values. Example names (see `examples/valid/env.example`):

| Name | Kind | Purpose |
|---|---|---|
| `CC_PUBLIC_DOMAIN` | env | App hostname (documentation: example.invalid) |
| `CC_AUTH_DOMAIN` | env | Authelia hostname |
| `CC_COOKIE_DOMAIN` | env | Parent cookie domain |
| `CC_APP_UPSTREAM` | env | Caddy upstream for the app |
| `AUTHELIA_URL` | env | Caddy upstream for Authelia |
| `CC_APP_IMAGE` | env | App image placeholder |
| `CC_SECRET_DIR` | env | Directory of secret files at deploy |
| `CC_TRUSTED_PROXY_CIDRS` | env | CIDRs of Caddy (immediate hop) |
| `CC_OPERATOR_USER` | env | Single operator username |
| `CC_OPERATOR_DISPLAY_NAME` | env | Display name |
| `CC_OPERATOR_EMAIL` | env | Email |
| `CC_OPERATOR_PASSWORD_HASH` | env | Argon2 hash **injected at deploy** |
| `CC_TLS_CERT_FILE` / `CC_TLS_KEY_FILE` | env | TLS material paths |
| `authelia_jwt` | secret file | Authelia JWT |
| `authelia_session` | secret file | Session secret |
| `authelia_storage` | secret file | Storage encryption key |
| `authelia_postgres_password` | secret file | Authelia DB password |
| `postgres_password` | secret file | Postgres password |
| `tls_cert` / `tls_key` | secret file | Edge TLS |

Absence of a secret at deploy is fail-closed in Authelia/Caddy. This validator rejects hardcoded substitutes in git.

## Expected convergence

Later campaign (not this PR):

- HTTP, MCP, and UI workstreams call `parseForwardAuthIdentity` / `isPublicUnauthenticatedPath` instead of synthesizing an actor.
- Persistence, collectors, and the cockpit stay behind this edge; they are not patched here.
- Do not wire this tree into the Governance root README, `commercial/`, `decisions/`, `scripts/`, Warmbly, web-cfg, extra-cli, or PR Governance #8.

Canonical field names for later `ActorRef` ingestion are in `ADAPTER.md`.
