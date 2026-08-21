# BASELINE — CONFENGE-CONTROL-CENTER-OPERATIONAL-COMPLETION-01

Recorded before mutation. Production was not changed.

## Governance

- repository: `tjsasakifln/Governance`
- campaign branch: `campaign/CONFENGE-CONTROL-CENTER-OPERATIONAL-COMPLETION-01`
- BASE_SHA (`origin/main` at branch creation): `c5c7a3010fe8278df4fb18ca07a7d37215c33a22`
- HEAD at campaign start: `c5c7a3010fe8278df4fb18ca07a7d37215c33a22`
- Control Center already on main via PR #32
- docs-only main commits after the last operational deploy:
  - `3d5e21c344be95549cca1e9f0b5073a8efb9ff08` — last observed production-shape SHA (`DEPLOYED_SHA`)
  - subsequent main commits are documentation / founder-actor / MFA evidence (#40–#43)
- PR #8 remains independent and must not be touched:
  - https://github.com/tjsasakifln/Governance/pull/8
  - `feat(partners): founder-approved referral and co-sell authority v1`
  - head `grok/confenge-partner-program-governance-01` @ `6dfa10420a03412e1ce60fe38729298cd4ae22d1`

## Companion HEADs observed at start

Inspected locally; not mutated in this campaign unless a later residual documents an isolated companion PR.

- Warmbly open PR #104 is context-only and is not merged/absorbed:
  - https://github.com/tjsasakifln/warmbly/pull/104
  - `feat(confenge): controlled-eligible routes and bounded cohort auth`
- web-cfg PR #218 is already closed/merged (`feat(intranet): activate 302 gateway to ops.confenge.com.br`). Do not redo.
- Canonical commercial gate: `real_money_mutation_approved=false` in `commercial/gates/production-gates.v1.json`.
- Warmbly auto-send remains disabled (`CONFENGE_AUTO_SEND_ENABLED=false`).

## Production

- This campaign does **not** deploy.
- `DEPLOYED_SHA` observed in git history: `3d5e21c344be95549cca1e9f0b5073a8efb9ff08`
- Live `ops.confenge.com.br` is behind nginx → Caddy → Authelia. Founder MFA enrolled. `/intranet` 302 already live.

## Material gap vs the live cockpit (verified in tree)

Collectors persist `snapshot_kind = {collector}-snapshot`. The operational assembler only consumes `snapshot_kind ∈ {commercial,finance,clients,engineering,infrastructure,pncp}`. Domain projectors exist as packages but are not on the persist path. Warmbly collect output has `counts`/`attention`, not the cockpit funnel schema. Engineering destination is scoped to `repo:tjsasakifln/Governance` only.
