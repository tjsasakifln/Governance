# ADR-NET-NEW-INBOUND-HANDRAISER-001

Status: accepted
Effective: 2026-09-04
Authority: founder decision recorded in [Governance #65](https://github.com/tjsasakifln/Governance/issues/65)
Runtime tracking: [Warmbly #47](https://github.com/tjsasakifln/warmbly/issues/47)

## Current decision

`NET_NEW_INBOUND_HANDRAISER/1.0.0-draft.20260904` is the versioned admission
authority for net-new inbound hand-raisers of the five nuclei, produced on
`CONFENGE_WEB`. Consumers pin canonical name and content hash. They must not
copy the schema as a second authority.

`NET_NEW_INBOUND_HANDRAISER-v1` remains an exact-match authority for existing
pins. This version does not rewrite v1. A v1 string does not activate this
version. Missing, old or unknown version fail closed.

Closed states are only `ACCEPTED`, `REJECTED_WITH_REASON` and `UNKNOWN`.
Accepted net-new is inbound-only. `outbound_eligible` is false.
`auto_send` is false. SMTP, cadence and follow-up are not authorized.
Absence of a prior account is not a discard. Replay is exactly-once logical.
HTTP 2xx is not acceptance; receipt/readback is required.

Conflict `UNKNOWN` never becomes `CLEAR`. Sensitive data enters the public
envelope only as class and protected reference.

## Extra-cli / PNCP live (Governance #1 contemporaneous note)

[extra-cli #543](https://github.com/tjsasakifln/extra-cli/pull/543) canonicalizes
PNCP live as async ingestion and telemetry. The commercial cycle reads the
persisted lake. PNCP live is not commercial authority and is not this inbound
admission. Live Intelligence events (`intel_watch`, `intel_seed`) are not site
inbound submissions under this version. This note does not rewrite first-touch
history and is not a substitute ADR for `CFG-FIRST-TOUCH-ROUTING`.

## Architecture consequence

Governance owns the versioned policy and the pure admit evaluator. web-cfg
produces `CONFENGE_WEB`. Warmbly persists and acts. Meetcfg receives accepted
context only. No parallel CRM, queue, SMTP client or durable commercial
datastore is introduced in Governance.

## Additive note — v1 (2026-09-03)

`NET_NEW_INBOUND_HANDRAISER-v1` was published as the first machine-readable
inbound admission (PR #166 / #167). It remains exact-match ACTIVE for its
own version strings, including historical `intel_watch` / `intel_seed`
origins. This draft version does not inherit those origins.
