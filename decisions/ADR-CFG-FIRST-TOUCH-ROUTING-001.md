# ADR-CFG-FIRST-TOUCH-ROUTING-001

Status: accepted
Effective: 2026-08-25
Authority: founder decision recorded in [Governance #129](https://github.com/tjsasakifln/Governance/issues/129)
Runtime tracking: [Warmbly #41](https://github.com/tjsasakifln/warmbly/issues/41)

## Current decision

`CFG-FIRST-TOUCH-ROUTING-v3` is the only active first-touch routing policy.
Consumers pin its canonical name exactly; missing, v1, v2, partial or unknown
versions fail closed. A delegated decision is recorded as
`DELEGATED_POLICY_APPROVE`; it is never represented as a human click or as
`HUMAN_APPROVE`.

Every v3 hard gate must pass. Any `UNKNOWN`, conflict, failure or material
drift invalidates the delegated decision and routes the item to the existing
human exception path. The policy covers approval and scheduling only: it does
not authorize follow-ups, provider dispatch or SMTP. The kill switch and global
dispatch pause remain non-bypassable, and a zero-SMTP canary may only reach
`QUEUED`.

The global dispatch pause and kill switch are revocable transport controls, not
material message inputs. Their activation defers or blocks provider handoff but
does not erase an otherwise valid approval. This distinction permits a
zero-SMTP canary to reach the existing `QUEUED` state while dispatch remains
paused; neither control may ever be bypassed.

## Superseded decision

Before this ADR, Governance #129 and Warmbly #41 required human review or a
human cohort/policy authorization before every first touch could advance. That
decision remains historical and still governs messages outside the active v3
policy.

## Architecture consequence

extra-cli remains the authority for target identity, typed buyer/supplier role,
recipient and evidence. Warmbly remains the authority for drafts, approvals,
scheduling, queue, suppression, idempotency, readback and transport controls.
Governance owns only the versioned policy. No parallel CRM, lead base, queue,
scheduler or raw PNCP reinterpretation is introduced.

## Additive note — v2 (2026-08-27)

`CFG-FIRST-TOUCH-ROUTING-v2` is retained only as machine-readable historical
evidence. v1 and v2 are `SUPERSEDED` and must not activate a consumer.

v2 separates source operational health (crawler / target-fit / publication /
age; `FRESH` / `DEGRADED` / `STALE` / `UNKNOWN`) from commercial authority
(the last fully proven population binding) from transport authority
(mailbox, pause, kill switch, window). Operational source degradation does
not automatically revoke a previously proven commercial authorization.
v2 activates only on exact version match; unknown or missing version is
fail-closed. The policy still does not authorize SMTP or provider dispatch.

## Additive note — v3 (2026-08-28)

`CFG-FIRST-TOUCH-ROUTING-v3` is the current authority. v1 and v2 remain
machine-readable only as superseded historical artifacts; neither may activate
a consumer.

v3 replaces the v2 commercial age bands with `COMMERCIAL_AUTHORITY/2.0`. The
canonical, non-negotiable business rule is:

> CONFENGE commercial qualification is based on qualifying public engineering contracting evidence within a rolling three-year window. PNCP/source freshness is acquisition health and MUST NOT by itself revoke, hold, dequeue or block transport for an otherwise valid commercially-qualified member.

Consequences recorded here so the next reader does not have to rediscover them:

- commercial states are `QUALIFIED` / `EXPIRED` / `REVOKED` / `UNKNOWN`. The v2
  bands `CURRENT` (24h), `DEGRADED` (72h), `FROZEN_FOR_NEW_ADMISSION` (168h) and
  age-based `EXPIRED` are abolished. There is no TTL and no grace period;
- a company qualifies as CONTRACTED SUPPLIER / FORNECEDORA, never as the
  contracting body, on a public engineering work or service whose contracting act
  falls inside the rolling three-year window;
- the qualifying date follows a deterministic precedence over
  `v_contracts_canonical_v2`: `data_assinatura` -> `data_inicio` ->
  `data_publicacao` -> `data_publicacao_fonte`. `data_fim` is excluded because it
  is an execution-end estimate, frequently null, and would make the window
  non-deterministic;
- `qualified_until` is derived as contracting date + 3 years with forward calendar
  normalization, never declared by the producer;
- explicit deactivation blocks immediately and beats everything;
- the readiness blocker `source_health_not_fresh_strict_fallback` is retired and
  replaced by `commercial_authority_missing`. Source health stays observable and
  alarmable, is presented as an acquisition-plan condition, and is not a member of
  the transport-time conjunction.

v3 activates only on exact version match; a v1, v2, unknown or missing version
is fail-closed. It does not authorize SMTP or provider dispatch. Governance
#129 is the sole human record for `NO_GO` or a bounded GO: without an explicit
human decision and a new additive transport policy, transport remains
fail-closed.
