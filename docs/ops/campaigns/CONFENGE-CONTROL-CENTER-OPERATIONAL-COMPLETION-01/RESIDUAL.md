# RESIDUALS

## CREDENTIAL_GATE

- Live Warmbly, Asaas, GitHub, PNCP file, and infra allowlist reads were not executed against production in this campaign (read-only live validation is allowed; secrets were not injected here).
- `HUMAN_GATE_ASAAS_READ_CREDENTIAL` remains if production still lacks Asaas read credentials (`BLOCKED_BY_SECRET`).
- `GITHUB_REPOS` must be set in the uncommitted production env to the recommended allowlist. This campaign documents it; it does not apply production env.

## FOUNDER_AUTHORITY_GATE

- `real_money_mutation_approved=false` still. No Asaas mutation was performed or enabled.
- Warmbly auto-send remains disabled. This campaign does not enable it.
- Operator actions persist as Control Center audit records only. Mapping them onto Warmbly `POST /confenge/intel/exceptions/:id/resolve` is an explicit later founder decision.

## EXTERNAL_SERVICE_GATE

- Warmbly PR #104 (controlled-eligible routes / bounded cohort auth) was inspected and **not** merged. If main's intel scoreboard 404s in production, the Control Center shows the gap (`NO_DATA` / unavailable), it does not invent cohorts.
- GSC/GA4 search-visibility hops stay BLOCKED until a durable ingest contract exists. Adapter boundary is present via Warmbly scoreboard stages 1–2.

## LIVE_ENVIRONMENT_GATE

- Playwright Chromium starts then exits 127: missing `libnspr4.so`. Reproduced on two consecutive e2e launches. Host cannot `apt-get install` without sudo password. No screenshots; `MOBILE_FIRST_PROVEN_360_390_430=false`.

## CODE_BLOCKER

- Playwright visual matrix at 360/390/430/desktop was **not** re-run in a headed browser in this environment (Playwright MCP failed to connect; Chromium missing `libnspr4.so`). Honesty of omitted≠zero, Crescimento hops, client sources, and operator banners is covered by shipped HTTP paint tests, not by screenshots.
- Operational envelope v1 was not broken to add a seventh `growth` domain (additionalProperties: false). Growth/inbound is served via Comercial operations + Crescimento destination + PNCP domain.

## NOT DONE ON PURPOSE

- No production deploy, nginx, DNS, TLS, Authelia, or Warmbly live mutation.
- No companion PRs in warmbly / extra-cli / web-cfg.
- PR #8 untouched.
