# Threat model — Control Center security edge

Private 24/7 single-operator cockpit. Identity is Authelia behind Caddy ForwardAuth. This package does not invent a user database.

Assumptions: the operator is one human; MCP/agents are later consumers of scoped context, not of this login; financial/provider mutations stay forbidden; DNS and live hosts are not changed in this wave.

## Threats → controls

| ID | Threat | Controls |
|---|---|---|
| T-SPOOF-HEADERS | Client injects `Remote-User` / `Remote-Groups` / `Remote-Name` / `Remote-Email`, or spoofs `X-Forwarded-For` | C-TRUSTED-HOP, C-FAIL-CLOSED-IDENTITY, C-FORWARD-AUTH, C-COPY-HEADERS |
| T-SECRET-URL | Unguessable path/hostname used as the only gate | C-IDP-MFA, C-NO-SECRET-URL-GATE, C-FORWARD-AUTH |
| T-BRUTE-FORCE | Password/TOTP guessing on the portal | C-REGULATION, C-SESSION-TIMEOUT |
| T-DATASTORE-EXPOSURE | Postgres/Redis/NATS bound to a public address | C-INTERNAL-DATASTORES |
| T-SECRET-LEAK | Secrets in git, logs, URLs, health, analytics, client bundle | C-SECRET-INJECTION, C-MINIMAL-HEALTH, C-LOG-REDACTION |

Machine copy: `threat-model.json`. The validator and tests require these IDs and control mappings.

## Control notes

- **C-TRUSTED-HOP** — App trusts identity headers only from configured proxy CIDRs (`CC_TRUSTED_PROXY_CIDRS`). Immediate TCP peer; never `X-Forwarded-For`.
- **C-FAIL-CLOSED-IDENTITY** — Missing, empty, spoofed, or untrusted-source identity is denied. No anonymous app session.
- **C-FORWARD-AUTH / C-COPY-HEADERS** — Caddy `forward_auth` to Authelia `/api/authz/forward-auth` and `copy_headers Remote-User Remote-Groups Remote-Name Remote-Email`.
- **C-IDP-MFA** — Authelia TOTP and WebAuthn enabled. `access_control.default_policy: deny` plus `two_factor`.
- **C-NO-SECRET-URL-GATE** — Architecture must not depend on a hidden URL or hardcoded password.
- **C-REGULATION** — Authelia `max_retries` / `find_time` / `ban_time`. Standard Caddy has no built-in IP rate-limit module; do not require a Caddy plugin.
- **C-SESSION-TIMEOUT** — Inactivity + absolute expiration; `remember_me` disabled. Cookies: Secure, HttpOnly, SameSite=lax|strict.
- **C-INTERNAL-DATASTORES** — Postgres (5432), Redis (6379), NATS (4222/6222/8222) on an `internal: true` Docker network, no public publish. Loopback bind is acceptable; `0.0.0.0` is not.
- **C-SECRET-INJECTION** — Env or secret files only. Placeholders in git.
- **C-MINIMAL-HEALTH** — `/healthz` and `/livez` are the only unauthenticated app routes. Body is `{"status":"ok"}`.
- **C-LOG-REDACTION** — Structured logs; secret/PII keys redacted.
- **C-SECURE-HEADERS / C-CORS-DENY / C-COOKIE-POLICY / C-TLS** — TLS at Caddy; HSTS and related headers; CORS deny-by-default; CSRF = same-site cookie + CORS deny.

## Out of scope this wave

Live DNS, real certificates against public names, VPS changes, multi-user SSO, LDAP/OIDC federation, full RBAC, Authelia/Caddy in CI, homemade login UI.
